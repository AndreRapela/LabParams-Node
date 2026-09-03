// controllers/ImportacaoController.js
const ImportacaoModel = require('../models/ImportacaoModel');
const readXlsxFileModule = require('read-excel-file/node');
const writeXlsxFile = require('write-excel-file/node');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { createInflateRaw } = require('zlib');
const { StringDecoder } = require('string_decoder');
const { logSafeError } = require('../utils/safeError');
const VALIDATION_BATCH_SIZE = 10;
const MAX_IMPORT_ROWS = 5_000;
const MAX_XLSX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 128;
const MAX_XLSX_CELLS = 60_000;
const MAX_XLSX_SHARED_STRINGS = 60_000;
const MAX_XLSX_COLUMNS = 64;
const MAX_XLSX_XML_TAGS = 300_000;
const MAX_XLSX_COMPRESSION_RATIO = 200;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

const readXlsxSheet = readXlsxFileModule.readSheet || readXlsxFileModule;

class ImportacaoController {

  static async importarResultadosAnalise(req, res) {
    let arquivoPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo foi enviado',
          error: 'É necessário enviar um arquivo CSV ou XLSX'
        });
      }

      arquivoPath = req.file.path;
      const extensao = path.extname(req.file.originalname).toLowerCase();

      if (!['.csv', '.xlsx'].includes(extensao)) {
        return res.status(400).json({
          success: false,
          message: 'Formato de arquivo não suportado',
          error: 'Apenas arquivos CSV e XLSX são aceitos'
        });
      }

      let linhas = [];

      if (extensao === '.csv') {
        linhas = await ImportacaoController.lerCSV(arquivoPath);
      } else {
        linhas = await ImportacaoController.lerExcel(arquivoPath);
      }

      if (linhas.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo vazio',
          error: 'O arquivo não contém dados para importar'
        });
      }

      if (linhas.length > MAX_IMPORT_ROWS) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo excede o limite de linhas',
          error: `Envie no máximo ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} resultados por importação`,
        });
      }

      const camposEsperados = [
        'datacoleta',
        'valor_medido',
        'legislacao',
        'matriz',
        'numerodaamostra',
        'codigodaamostra',
        'parametro'
      ];

      const primeiraLinha = linhas[0];
      const camposFaltando = camposEsperados.filter(campo => !(campo in primeiraLinha));

      if (camposFaltando.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Estrutura do arquivo incorreta',
          error: `Campos obrigatórios faltando: ${camposFaltando.join(', ')}`,
          exemplo: 'Cabeçalho esperado: datacoleta, valor_medido, legislacao, contexto, matriz, numerodaamostra, codigodaamostra, parametro'
        });
      }

      const dadosValidos = [];
      const errosValidacao = [];
      const validationCache = ImportacaoModel.createValidationCache();

      for (let start = 0; start < linhas.length; start += VALIDATION_BATCH_SIZE) {
        const batch = linhas.slice(start, start + VALIDATION_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((linha, index) =>
            ImportacaoModel.validarLinha(linha, start + index + 2, validationCache)
          )
        );

        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          if (result.sucesso) {
            dadosValidos.push({
              ...result.dados,
              _linha_importacao: start + index + 2,
            });
          } else {
            errosValidacao.push({
              linha: start + index + 2,
              dados: batch[index],
              erro: result.erro,
            });
          }
        }
      }

      let resultadoInsercao = { inseridos: 0, erros: [] };

      if (dadosValidos.length > 0) {
        resultadoInsercao = await ImportacaoModel.inserirLote(dadosValidos, {
          actorUserId: req.user?.id,
          requestId: req.requestId,
        });
      }

      const todosErros = [
        ...errosValidacao,
        ...resultadoInsercao.erros
      ];

      const resposta = {
        success: true,
        message: 'Importação processada com sucesso',
        resumo: {
          total_linhas: linhas.length,
          validadas_com_sucesso: dadosValidos.length,
          inseridas_no_banco: resultadoInsercao.inseridos,
          erros_validacao: errosValidacao.length,
          erros_insercao: resultadoInsercao.erros.length,
          total_erros: todosErros.length
        },
        erros: todosErros.length > 0 ? todosErros : undefined
      };

      let statusCode = 200;
      if (resultadoInsercao.inseridos === 0) {
        resposta.success = false;
        resposta.message = 'Nenhum registro foi inserido no banco de dados';
        statusCode = 422;
      } else if (todosErros.length > 0) {
        resposta.message = 'Importação concluída parcialmente';
        statusCode = 207;
      }

      return res.status(statusCode).json(resposta);

    } catch (error) {
      if (error.code === 'MAX_IMPORT_ROWS') {
        return res.status(400).json({
          success: false,
          message: 'Arquivo excede o limite de linhas',
          error: `Envie no máximo ${MAX_IMPORT_ROWS.toLocaleString('pt-BR')} resultados por importação`,
        });
      }
      if (['INVALID_XLSX', 'XLSX_SECURITY_LIMIT'].includes(error.code)) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo XLSX inválido ou excede os limites de segurança',
          error: 'Verifique o arquivo e envie uma planilha XLSX com até 5.000 resultados.',
        });
      }
      logSafeError('analysis_import_failed', error, {
        request_id: req.requestId || null,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro interno ao processar importação'
      });

    } finally {
      if (arquivoPath) {
        try {
          await fs.promises.unlink(arquivoPath);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            logSafeError('analysis_import_temp_cleanup_failed', err, {
              request_id: req.requestId || null,
            });
          }
        }
      }
    }
  }

  static async lerCSV(caminhoArquivo) {
    return new Promise((resolve, reject) => {
      const resultados = [];
      let settled = false;
      const input = fs.createReadStream(caminhoArquivo);
      const parser = csv({
          separator: ',', // ou ';' dependendo do formato
          skipEmptyLines: true,
          mapHeaders: ({ header }) =>
            header.replace(/^\uFEFF/, '').trim().toLowerCase()
        });
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      input.on('error', fail);
      parser
        .on('data', (data) => {
          if (resultados.length >= MAX_IMPORT_ROWS) {
            const error = new Error(`O arquivo excede ${MAX_IMPORT_ROWS} linhas.`);
            error.code = 'MAX_IMPORT_ROWS';
            input.destroy();
            parser.destroy();
            fail(error);
            return;
          }
          resultados.push(data);
        })
        .on('end', () => {
          if (settled) return;
          settled = true;
          resolve(resultados);
        })
        .on('error', fail);
      input.pipe(parser);
    });
  }

  static criarErroXlsx(mensagem, code = 'INVALID_XLSX') {
    const error = new Error(mensagem);
    error.code = code;
    return error;
  }

  static extrairEntradasZip(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
      throw this.criarErroXlsx('O arquivo não possui uma estrutura ZIP válida.');
    }

    const searchStart = Math.max(0, buffer.length - 65_557);
    let endOffset = -1;
    for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
      if (buffer.readUInt32LE(offset) === ZIP_END_SIGNATURE) {
        const commentLength = buffer.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === buffer.length) {
          endOffset = offset;
          break;
        }
      }
    }
    if (endOffset < 0) {
      throw this.criarErroXlsx('Diretório central do XLSX não encontrado.');
    }

    const diskNumber = buffer.readUInt16LE(endOffset + 4);
    const centralDisk = buffer.readUInt16LE(endOffset + 6);
    const entriesOnDisk = buffer.readUInt16LE(endOffset + 8);
    const entryCount = buffer.readUInt16LE(endOffset + 10);
    const centralSize = buffer.readUInt32LE(endOffset + 12);
    const centralOffset = buffer.readUInt32LE(endOffset + 16);
    if (
      diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount
      || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    ) {
      throw this.criarErroXlsx('Arquivos XLSX multidisco ou ZIP64 não são aceitos.');
    }
    if (entryCount === 0 || entryCount > MAX_XLSX_ENTRIES) {
      throw this.criarErroXlsx('Quantidade de partes do XLSX excede o limite.', 'XLSX_SECURITY_LIMIT');
    }
    const centralEnd = centralOffset + centralSize;
    if (centralOffset < 0 || centralEnd > endOffset || centralEnd > buffer.length) {
      throw this.criarErroXlsx('Diretório central do XLSX está corrompido.');
    }

    const entries = [];
    const names = new Set();
    let cursor = centralOffset;
    let totalCompressed = 0;
    let totalUncompressed = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > centralEnd || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
        throw this.criarErroXlsx('Entrada inválida no diretório central do XLSX.');
      }
      const flags = buffer.readUInt16LE(cursor + 8);
      const method = buffer.readUInt16LE(cursor + 10);
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const localOffset = buffer.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > centralEnd || [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
        throw this.criarErroXlsx('Entrada ZIP64 ou truncada não é aceita.');
      }
      const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
      if (
        !name || name.includes('\\') || name.startsWith('/')
        || name.split('/').includes('..') || names.has(name)
      ) {
        throw this.criarErroXlsx('Nome de entrada inseguro ou duplicado no XLSX.');
      }
      if ((flags & 0x0001) !== 0 || ![0, 8].includes(method)) {
        throw this.criarErroXlsx('O XLSX usa criptografia ou compactação não suportada.');
      }
      if (uncompressedSize > MAX_XLSX_ENTRY_BYTES) {
        throw this.criarErroXlsx('Uma parte descompactada do XLSX excede o limite.', 'XLSX_SECURITY_LIMIT');
      }
      if (
        uncompressedSize > 1024 * 1024
        && uncompressedSize / Math.max(compressedSize, 1) > MAX_XLSX_COMPRESSION_RATIO
      ) {
        throw this.criarErroXlsx('Taxa de compactação suspeita no XLSX.', 'XLSX_SECURITY_LIMIT');
      }

      names.add(name);
      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      entries.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
      cursor = next;
    }

    if (cursor !== centralEnd || totalUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw this.criarErroXlsx('Volume descompactado do XLSX excede o limite.', 'XLSX_SECURITY_LIMIT');
    }
    if (
      totalUncompressed > 1024 * 1024
      && totalUncompressed / Math.max(totalCompressed, 1) > MAX_XLSX_COMPRESSION_RATIO
    ) {
      throw this.criarErroXlsx('Taxa total de compactação suspeita no XLSX.', 'XLSX_SECURITY_LIMIT');
    }
    if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
      throw this.criarErroXlsx('O arquivo não contém as partes obrigatórias de uma planilha XLSX.');
    }

    const occupiedRanges = [];
    for (const entry of entries) {
      if (entry.localOffset + 30 > centralOffset
          || buffer.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_SIGNATURE) {
        throw this.criarErroXlsx('Cabeçalho local inválido no XLSX.');
      }
      const localFlags = buffer.readUInt16LE(entry.localOffset + 6);
      const localMethod = buffer.readUInt16LE(entry.localOffset + 8);
      const localNameLength = buffer.readUInt16LE(entry.localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(entry.localOffset + 28);
      const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + entry.compressedSize;
      const localName = buffer.toString(
        'utf8',
        entry.localOffset + 30,
        entry.localOffset + 30 + localNameLength
      );
      if (
        localName !== entry.name || localMethod !== entry.method
        || localFlags !== entry.flags || (localFlags & 0x0001) !== 0
        || dataStart > dataEnd || dataEnd > centralOffset
      ) {
        throw this.criarErroXlsx('Conteúdo local inconsistente no XLSX.');
      }
      entry.dataStart = dataStart;
      entry.dataEnd = dataEnd;
      occupiedRanges.push([entry.localOffset, dataEnd]);
    }
    occupiedRanges.sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < occupiedRanges.length; index += 1) {
      if (occupiedRanges[index][0] < occupiedRanges[index - 1][1]) {
        throw this.criarErroXlsx('Entradas sobrepostas não são aceitas no XLSX.');
      }
    }
    return entries;
  }

  static colunaExcelParaNumero(referencia) {
    let column = 0;
    for (const char of referencia.toUpperCase()) {
      column = column * 26 + char.charCodeAt(0) - 64;
    }
    return column;
  }

  static analisarTagsXml(text, entryName, counters) {
    const withoutXmlDeclaration = text.replace(/<\?xml(?:\s[^?]*)?\?>/gi, '');
    if (/<!DOCTYPE\b|<!ENTITY\b|<\?/i.test(withoutXmlDeclaration)) {
      throw this.criarErroXlsx(
        'Declarações XML ativas não são aceitas no XLSX.',
        'XLSX_SECURITY_LIMIT'
      );
    }

    const xmlTagPattern = /<[A-Za-z_][\w:.-]*(?:\s[^<>]*)?\/?>/g;
    let xmlTag;
    while ((xmlTag = xmlTagPattern.exec(text)) !== null) {
      counters.xmlTags += 1;
      if (counters.xmlTags > MAX_XLSX_XML_TAGS) {
        throw this.criarErroXlsx('A complexidade XML do XLSX excede o limite.', 'XLSX_SECURITY_LIMIT');
      }
    }

    const isWorksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(entryName);
    const isSharedStrings = entryName.toLowerCase() === 'xl/sharedstrings.xml';
    if (!isWorksheet && !isSharedStrings) return;

    const tagPattern = isWorksheet
      ? /<(row|c)(?:\s[^<>]*)?>/gi
      : /<si(?:\s[^<>]*)?>/gi;
    let match;
    while ((match = tagPattern.exec(text)) !== null) {
      if (isSharedStrings) {
        counters.sharedStrings += 1;
        if (counters.sharedStrings > MAX_XLSX_SHARED_STRINGS) {
          throw this.criarErroXlsx('A tabela de textos do XLSX excede o limite.', 'XLSX_SECURITY_LIMIT');
        }
        continue;
      }

      if (match[1].toLowerCase() === 'row') {
        counters.sheetRows += 1;
        const rowReference = /\br\s*=\s*["'](\d+)["']/i.exec(match[0]);
        const referencedRow = rowReference ? Number(rowReference[1]) : counters.sheetRows;
        if (counters.sheetRows > MAX_IMPORT_ROWS + 1 || referencedRow > MAX_IMPORT_ROWS + 1) {
          throw this.criarErroXlsx('A planilha excede o limite de linhas.', 'MAX_IMPORT_ROWS');
        }
      } else {
        counters.cells += 1;
        const cellReference = /\br\s*=\s*["']([A-Z]+)(\d+)["']/i.exec(match[0]);
        if (!cellReference) {
          throw this.criarErroXlsx('Referência de célula inválida no XLSX.');
        }
        const column = this.colunaExcelParaNumero(cellReference[1]);
        const row = Number(cellReference[2]);
        if (
          counters.cells > MAX_XLSX_CELLS || column > MAX_XLSX_COLUMNS
          || row > MAX_IMPORT_ROWS + 1
        ) {
          throw this.criarErroXlsx('A planilha excede os limites de células.', 'XLSX_SECURITY_LIMIT');
        }
      }
    }
  }

  static async inspecionarXmlCompactado(buffer, entry, counters) {
    const compressed = buffer.subarray(entry.dataStart, entry.dataEnd);
    const input = Readable.from([compressed]);
    const output = entry.method === 8 ? input.pipe(createInflateRaw()) : input;
    const decoder = new StringDecoder('utf8');
    let decodedBytes = 0;
    let pending = '';
    counters.sheetRows = 0;

    try {
      for await (const chunk of output) {
        decodedBytes += chunk.length;
        if (decodedBytes > entry.uncompressedSize || decodedBytes > MAX_XLSX_ENTRY_BYTES) {
          throw this.criarErroXlsx('Conteúdo expandido além do declarado.', 'XLSX_SECURITY_LIMIT');
        }
        pending += decoder.write(chunk);
        const lastTagEnd = pending.lastIndexOf('>');
        if (lastTagEnd >= 0) {
          this.analisarTagsXml(pending.slice(0, lastTagEnd + 1), entry.name, counters);
          pending = pending.slice(lastTagEnd + 1);
        }
        if (pending.length > 4096) {
          const incompleteTagStart = pending.lastIndexOf('<');
          if (incompleteTagStart >= 0) {
            if (pending.length - incompleteTagStart > 4096) {
              throw this.criarErroXlsx('Tag XML excessivamente longa no XLSX.', 'XLSX_SECURITY_LIMIT');
            }
            pending = pending.slice(incompleteTagStart);
          } else {
            pending = pending.slice(-16);
          }
        }
      }
      pending += decoder.end();
      this.analisarTagsXml(pending, entry.name, counters);
    } catch (error) {
      if (['INVALID_XLSX', 'XLSX_SECURITY_LIMIT', 'MAX_IMPORT_ROWS'].includes(error.code)) throw error;
      throw this.criarErroXlsx('Não foi possível descompactar uma parte do XLSX.');
    }
    if (decodedBytes !== entry.uncompressedSize) {
      throw this.criarErroXlsx('Tamanho descompactado inconsistente no XLSX.');
    }
  }

  static async validarArquivoXlsx(caminhoArquivo) {
    const stat = await fs.promises.stat(caminhoArquivo);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_XLSX_ARCHIVE_BYTES) {
      throw this.criarErroXlsx('Tamanho compactado do XLSX excede o limite.', 'XLSX_SECURITY_LIMIT');
    }
    const buffer = await fs.promises.readFile(caminhoArquivo);
    if (buffer.length !== stat.size || buffer.length > MAX_XLSX_ARCHIVE_BYTES) {
      throw this.criarErroXlsx('O arquivo XLSX foi alterado durante a leitura.', 'XLSX_SECURITY_LIMIT');
    }
    const entries = this.extrairEntradasZip(buffer);
    const counters = { cells: 0, sharedStrings: 0, sheetRows: 0, xmlTags: 0 };
    for (const entry of entries) {
      if (/\.(?:xml|rels)$/i.test(entry.name)) {
        await this.inspecionarXmlCompactado(buffer, entry, counters);
      }
    }
    return buffer;
  }

  static async lerExcel(caminhoArquivo) {
    try {
      const xlsxBuffer = await this.validarArquivoXlsx(caminhoArquivo);
      const linhas = await readXlsxSheet(xlsxBuffer, 1);
      if (!linhas.length) return [];

      const cabecalhos = linhas[0].map((valor) =>
        String(valor ?? '').trim().toLowerCase()
      );
      if (cabecalhos.every((valor) => !valor)) {
        throw this.criarErroXlsx('A primeira linha deve conter os cabeçalhos');
      }

      const resultados = linhas.slice(1)
        .filter((linha) => linha.some((valor) => valor !== null && valor !== ''))
        .map((linha) => Object.fromEntries(
          cabecalhos.map((cabecalho, indice) => [
            cabecalho,
            ImportacaoController.normalizarCelulaExcel(linha[indice]),
          ])
        ));
      if (resultados.length > MAX_IMPORT_ROWS) {
        throw this.criarErroXlsx('A planilha excede o limite de linhas.', 'MAX_IMPORT_ROWS');
      }
      return resultados;
    } catch (error) {
      if (['INVALID_XLSX', 'XLSX_SECURITY_LIMIT', 'MAX_IMPORT_ROWS'].includes(error.code)) throw error;
      throw this.criarErroXlsx('Não foi possível ler a planilha XLSX.');
    }
  }

  static normalizarCelulaExcel(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) {
      const dia = String(valor.getUTCDate()).padStart(2, '0');
      const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
      return `${dia}/${mes}/${valor.getUTCFullYear()}`;
    }
    return String(valor).trim();
  }

  static async baixarTemplate(req, res) {
    try {
      const formato = req.query.formato || 'csv'; // csv, xlsx

      const colunas = [
        'datacoleta',
        'valor_medido',
        'legislacao',
        'contexto',
        'matriz',
        'numerodaamostra',
        'codigodaamostra',
        'parametro'
      ];

      const exemploLinha = {
        datacoleta: '01/12/2024',
        valor_medido: '0.5',
        legislacao: 'Portaria 888/2021',
        contexto: 'P888_POTABILIDADE',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-2024-001',
        parametro: 'Turbidez'
      };

      if (formato === 'csv') {
        const csv = [
          colunas.join(','),
          Object.values(exemploLinha).join(',')
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=template_importacao.csv');
        return res.send(csv);

      } else if (formato === 'xlsx') {
        const dados = [colunas, Object.values(exemploLinha)];
        const buffer = await writeXlsxFile(dados, {
          columns: colunas.map(() => ({ width: 24 })),
          stickyRowsCount: 1,
        }).toBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=template_importacao.xlsx');
        return res.send(buffer);

      } else {
        return res.status(400).json({
          success: false,
          message: 'Formato inválido',
          error: 'Use ?formato=csv ou ?formato=xlsx'
        });
      }

    } catch (error) {
      logSafeError('analysis_import_template_failed', error, {
        request_id: req.requestId || null,
      });
      return res.status(500).json({
        success: false,
        message: 'Erro ao gerar template'
      });
    }
  }
}

module.exports = ImportacaoController;
