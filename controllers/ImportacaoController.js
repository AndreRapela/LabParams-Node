// controllers/ImportacaoController.js
const ImportacaoModel = require('../models/ImportacaoModel');
const XLSX = require('xlsx');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const VALIDATION_BATCH_SIZE = 10;

class ImportacaoController {

  static async importarResultadosAnalise(req, res) {
    let arquivoPath = null;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Nenhum arquivo foi enviado',
          error: 'É necessário enviar um arquivo CSV, XLS ou XLSX'
        });
      }

      arquivoPath = req.file.path;
      const extensao = path.extname(req.file.originalname).toLowerCase();

      if (!['.csv', '.xls', '.xlsx'].includes(extensao)) {
        return res.status(400).json({
          success: false,
          message: 'Formato de arquivo não suportado',
          error: 'Apenas arquivos CSV, XLS e XLSX são aceitos'
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
          exemplo: 'Cabeçalho esperado: datacoleta, valor_medido, legislacao, matriz, numerodaamostra, codigodaamostra, parametro'
        });
      }

      const dadosValidos = [];
      const errosValidacao = [];

      for (let start = 0; start < linhas.length; start += VALIDATION_BATCH_SIZE) {
        const batch = linhas.slice(start, start + VALIDATION_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((linha, index) =>
            ImportacaoModel.validarLinha(linha, start + index + 2)
          )
        );

        for (let index = 0; index < results.length; index++) {
          const result = results[index];
          if (result.sucesso) {
            dadosValidos.push(result.dados);
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
        resultadoInsercao = await ImportacaoModel.inserirLote(dadosValidos);
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

      // Se nenhum registro foi inserido, considerar falha parcial
      if (resultadoInsercao.inseridos === 0) {
        resposta.success = false;
        resposta.message = 'Nenhum registro foi inserido no banco de dados';
      }

      const statusCode = resposta.success ? 200 : 207; // 207 = Multi-Status

      return res.status(statusCode).json(resposta);

    } catch (error) {
      console.error('Erro ao processar importação:', error.message);
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
            console.error('Erro ao remover arquivo temporário:', err.message);
          }
        }
      }
    }
  }

  static async lerCSV(caminhoArquivo) {
    return new Promise((resolve, reject) => {
      const resultados = [];
      
      fs.createReadStream(caminhoArquivo)
        .pipe(csv({
          separator: ',', // ou ';' dependendo do formato
          skipEmptyLines: true,
          mapHeaders: ({ header }) =>
            header.replace(/^\uFEFF/, '').trim().toLowerCase()
        }))
        .on('data', (data) => resultados.push(data))
        .on('end', () => resolve(resultados))
        .on('error', (error) => reject(error));
    });
  }

  static async lerExcel(caminhoArquivo) {
    try {
      const workbook = XLSX.readFile(caminhoArquivo);
      const sheetName = workbook.SheetNames[0]; // Primeira aba
      if (!sheetName) throw new Error('A planilha não possui abas');
      const sheet = workbook.Sheets[sheetName];
      
      // Converte para JSON
      const dados = XLSX.utils.sheet_to_json(sheet, {
        raw: false, // Converte datas e números para string
        defval: '', // Valor padrão para células vazias
        blankrows: false // Ignora linhas vazias
      });

      // Normaliza chaves para lowercase
      return dados.map(linha => {
        const linhaNormalizada = {};
        Object.keys(linha).forEach(chave => {
          linhaNormalizada[chave.trim().toLowerCase()] = linha[chave];
        });
        return linhaNormalizada;
      });

    } catch (error) {
      throw new Error(`Erro ao ler arquivo Excel: ${error.message}`);
    }
  }

  static async baixarTemplate(req, res) {
    try {
      const formato = req.query.formato || 'csv'; // csv, xlsx

      const colunas = [
        'datacoleta',
        'valor_medido',
        'legislacao',
        'matriz',
        'numerodaamostra',
        'codigodaamostra',
        'parametro'
      ];

      const exemploLinha = {
        datacoleta: '01/12/2024',
        valor_medido: '0.5',
        legislacao: 'Portaria 888/2021',
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
        const worksheet = XLSX.utils.aoa_to_sheet(dados);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

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
      console.error('Erro ao gerar template:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Erro ao gerar template'
      });
    }
  }
}

module.exports = ImportacaoController;
