const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const AmostraModel = require('./AmostraModel');
const { workflowError } = require('../utils/workflowPiloto');
const logger = require('../utils/logger');
const { randomUUID } = require('crypto');

const IMPORT_TRANSACTION_BATCH_SIZE = 100;

class ImportacaoModel {
  static createValidationCache() {
    return {
      amostras: new Map(),
      matrizes: new Map(),
      legislacoes: new Map(),
    };
  }

  static async queryCached(cache, key, query) {
    if (!(cache instanceof Map)) return query();
    if (!cache.has(key)) cache.set(key, Promise.resolve().then(query));
    return cache.get(key);
  }

  static async validarLinha(linha, numeroLinha, validationCache = null) {
    try {
      const obrigatorios = [
        'datacoleta', 'valor_medido', 'legislacao', 'matriz',
        'numerodaamostra', 'codigodaamostra', 'parametro',
      ];
      const faltando = obrigatorios.filter(
        (campo) => linha[campo] === undefined || String(linha[campo]).trim() === ''
      );
      if (faltando.length) {
        return this.falha(`Campo '${faltando[0]}' é obrigatório`);
      }

      const textoValor = String(linha.valor_medido).trim();
      const valorPossivelmenteNumerico = Number(textoValor.replace(',', '.'));
      const valorQualitativoInformado = ['ausente', 'presente'].includes(textoValor.toLowerCase());
      if ((!Number.isFinite(valorPossivelmenteNumerico) || valorPossivelmenteNumerico < 0) && !valorQualitativoInformado) {
        return this.falha('Valor medido inválido (deve ser número maior ou igual a zero)');
      }

      const dataColeta = this.parseData(linha.datacoleta);
      if (dataColeta > new Date()) return this.falha('Data de coleta não pode ser futura');

      const codigoAmostra = String(linha.codigodaamostra).trim();
      const numeroAmostra = String(linha.numerodaamostra).trim();
      const amostraResult = await this.queryCached(
        validationCache?.amostras,
        `${codigoAmostra}\u0000${numeroAmostra}`,
        () => pool.query(`
          select a.id, a.codigo_amostra, a.numero_da_amostra, a.matriz_id,
                 a.status_amostra, m.nome as matriz_nome
          FROM amostra a
          JOIN matriz m on a.matriz_id = m.id
          WHERE a.codigo_amostra = $1 and a.numero_da_amostra = $2
            and a.deleted_at is null
        `, [codigoAmostra, numeroAmostra])
      );
      if (!amostraResult.rowCount) {
        return this.falha(`Amostra não encontrada (código: ${codigoAmostra}, número: ${numeroAmostra})`);
      }
      const amostra = amostraResult.rows[0];
      if (['concluida', 'rejeitada', 'cancelada'].includes(amostra.status_amostra)) {
        return this.falha(`Amostra no estado '${amostra.status_amostra}' não aceita novos resultados`);
      }

      const nomeMatriz = String(linha.matriz).trim();
      const matrizResult = await this.queryCached(
        validationCache?.matrizes,
        nomeMatriz.toLocaleLowerCase('pt-BR'),
        () => pool.query(
          'SELECT id, nome FROM matriz WHERE lower(nome) = lower($1)',
          [nomeMatriz]
        )
      );
      if (!matrizResult.rowCount) return this.falha(`Matriz '${nomeMatriz}' não encontrada no banco`);
      const matriz = matrizResult.rows[0];
      if (Number(amostra.matriz_id) !== Number(matriz.id)) {
        return this.falha('A matriz informada não corresponde à matriz da amostra');
      }

      const nomeLegislacao = String(linha.legislacao).trim();
      const legislacaoResult = await this.queryCached(
        validationCache?.legislacoes,
        nomeLegislacao.toLocaleLowerCase('pt-BR'),
        () => pool.query(`
          SELECT id, nome, sigla FROM legislacao
          WHERE lower(nome) = lower($1) or lower(sigla) = lower($1)
        `, [nomeLegislacao])
      );
      if (!legislacaoResult.rowCount) {
        return this.falha(`Legislação '${nomeLegislacao}' não encontrada no banco`);
      }
      const legislacao = legislacaoResult.rows[0];

      const nomeParametro = String(linha.parametro).trim();
      const contexto = String(linha.contexto ?? '').trim();
      const parametroResult = await pool.query(`
        select
          p.id, p.nome, p.tipo_resultado, p.tipo_limite,
          p.limite_minimo, p.limite_maximo, p.criterio_texto, p.fonte_referencia,
          p.matriz_id, p.legislacao_id, p.contexto_legislacao_id,
          m.nome as matriz_nome,
          l.nome as legislacao_nome, l.sigla as legislacao_sigla,
          lc.nome as contexto_nome, lc.codigo as contexto_codigo
        FROM parametro p
        JOIN matriz m on p.matriz_id = m.id
        JOIN legislacao l on p.legislacao_id = l.id
        LEFT JOIN legislacao_contexto lc on p.contexto_legislacao_id = lc.id
        WHERE lower(p.nome) = lower($1)
          and p.matriz_id = $2
          and p.legislacao_id = $3
          and ($4 = '' or lower(lc.nome) = lower($4) or lower(lc.codigo) = lower($4))
          and p.ativo = true
          and exists (
            select 1 from amostra_parametro ap
            where ap.amostra_id = $5 and ap.parametro_id = p.id
          )
        order by lc.ordem
        limit 2
      `, [nomeParametro, matriz.id, legislacao.id, contexto, amostra.id]);

      if (!parametroResult.rowCount) {
        return this.falha(
          `Parâmetro '${nomeParametro}' não encontrado no contexto ou fora do escopo da amostra`
        );
      }
      if (!contexto && parametroResult.rowCount > 1) {
        return this.falha('A coluna contexto é obrigatória para esta legislação e parâmetro');
      }
      const parametro = parametroResult.rows[0];

      let valorMedido = valorPossivelmenteNumerico;
      let valorQualitativo = null;
      if (parametro.tipo_resultado === 'qualitativo') {
        if (!valorQualitativoInformado) {
          return this.falha('Resultado qualitativo deve ser Ausente ou Presente');
        }
        valorMedido = null;
        valorQualitativo = textoValor.toLowerCase() === 'ausente' ? 'Ausente' : 'Presente';
      } else if (valorQualitativoInformado) {
        return this.falha('Resultado quantitativo deve possuir um valor numérico');
      }

      const contextoNome = parametro.contexto_nome;
      return {
        sucesso: true,
        erro: null,
        dados: {
          valor_medido: valorMedido,
          valor_qualitativo: valorQualitativo,
          datacoleta: dataColeta.toISOString(),
          datadapublicacao: null,
          amostra_id: amostra.id,
          parametro_id: parametro.id,
          contexto_legislacao_id: parametro.contexto_legislacao_id ?? null,
          codigodaamostra: codigoAmostra,
          numerodaamostra: numeroAmostra,
          matriz: matriz.nome,
          legislacao: contextoNome
            ? `${legislacao.nome} (${legislacao.sigla}) — ${contextoNome}`
            : `${legislacao.nome} (${legislacao.sigla})`,
          limite_minimo_aplicado: parametro.limite_minimo ?? null,
          limite_maximo_aplicado: parametro.limite_maximo ?? null,
          tipo_limite_aplicado: parametro.tipo_limite ?? null,
          criterio_legal_aplicado: parametro.criterio_texto ?? null,
          fonte_legal_aplicada: parametro.fonte_referencia ?? null,
        },
      };
    } catch (error) {
      return this.falha(
        error.message?.startsWith('Data')
          ? error.message
          : `Erro interno ao processar a linha ${numeroLinha}`
      );
    }
  }

  static parseData(valor) {
    const texto = String(valor).trim();
    let data;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(texto)) {
      const [dia, mes, anoCurto] = texto.split('/').map(Number);
      const ano = anoCurto < 100 ? 2000 + anoCurto : anoCurto;
      data = new Date(ano, mes - 1, dia, 12, 0, 0);
      if (
        data.getFullYear() !== ano ||
        data.getMonth() !== mes - 1 ||
        data.getDate() !== dia
      ) throw new Error('Data de coleta inexistente no calendário');
    } else if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(texto)) {
      const [ano, mes, dia] = texto.slice(0, 10).split('-').map(Number);
      const calendarDate = new Date(Date.UTC(ano, mes - 1, dia));
      if (calendarDate.getUTCFullYear() !== ano
          || calendarDate.getUTCMonth() !== mes - 1
          || calendarDate.getUTCDate() !== dia) {
        throw new Error('Data de coleta inexistente no calendário');
      }
      data = new Date(texto);
    } else {
      throw new Error('Data de coleta deve usar DD/MM/AAAA ou o formato ISO');
    }
    if (Number.isNaN(data.getTime())) throw new Error('Data de coleta inválida');
    return data;
  }

  static falha(erro) {
    return { sucesso: false, dados: null, erro };
  }

  static async inserirLote(resultados, auditContext = {}) {
    if (!Array.isArray(resultados) || resultados.length === 0) {
      return { inseridos: 0, erros: [], amostras_em_analise: [] };
    }

    const importacaoId = auditContext.importacaoId || randomUUID();
    const totalLotes = Math.ceil(resultados.length / IMPORT_TRANSACTION_BATCH_SIZE);
    const erros = [];
    const amostrasAfetadas = new Set();
    let inseridos = 0;

    for (let start = 0; start < resultados.length; start += IMPORT_TRANSACTION_BATCH_SIZE) {
      const lote = resultados
        .slice(start, start + IMPORT_TRANSACTION_BATCH_SIZE)
        .map((item, index) => Number.isInteger(item._linha_importacao)
          ? item
          : { ...item, _linha_importacao: start + index + 1 });
      const numeroLote = Math.floor(start / IMPORT_TRANSACTION_BATCH_SIZE) + 1;
      try {
        const parcial = await this.inserirLoteTransacao(lote, {
          ...auditContext,
          importacaoId,
          numeroLote,
          totalLotes,
          totalImportacao: resultados.length,
        });
        inseridos += parcial.inseridos;
        erros.push(...parcial.erros);
        for (const amostraId of parcial.amostras_em_analise) {
          amostrasAfetadas.add(Number(amostraId));
        }
      } catch (error) {
        if (inseridos === 0) throw error;

        logger.warn('import_batch_failed_after_partial_commit', {
          request_id: auditContext.requestId || null,
          importacao_id: importacaoId,
          lote: numeroLote,
          total_lotes: totalLotes,
          code: error.code || null,
        });
        const mensagem = this.mensagemErroInsercao(error);
        for (let index = start; index < resultados.length; index += 1) {
          const item = resultados[index];
          const { _linha_importacao, ...publicItem } = item;
          erros.push({
            linha: Number.isInteger(_linha_importacao) ? _linha_importacao : index + 1,
            dados: publicItem,
            erro: mensagem,
          });
        }
        break;
      }
    }

    return {
      inseridos,
      erros,
      amostras_em_analise: [...amostrasAfetadas],
    };
  }

  static async inserirLoteTransacao(resultados, auditContext = {}) {
    const client = await pool.connect();
    let inseridos = 0;
    const erros = [];
    const resultadoIds = [];
    const amostrasAfetadas = new Set();
    try {
      await client.query('BEGIN');
      for (let index = 0; index < resultados.length; index += 1) {
        const item = resultados[index];
        const sourceLine = Number.isInteger(item._linha_importacao)
          ? item._linha_importacao
          : index + 1;
        const savepoint = `import_row_${index + 1}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const sampleResult = await client.query(
            'select * from amostra where id=$1 and deleted_at is null for update',
            [item.amostra_id]
          );
          const sample = sampleResult.rows[0];
          if (!sample) {
            throw workflowError('Amostra não encontrada ou arquivada.', 409, 'AMOSTRA_INVALIDA');
          }
          if (['concluida', 'rejeitada', 'cancelada'].includes(sample.status_amostra)) {
            throw workflowError(
              `Amostra no estado "${sample.status_amostra}" não aceita novos resultados.`,
              409,
              'AMOSTRA_BLOQUEADA'
            );
          }

          const inserted = await client.query(`
            with contexto as (
              select
                a.id as amostra_id,
                a.codigo_amostra,
                a.numero_da_amostra,
                a.matriz_id,
                m.nome as matriz_nome,
                p.id as parametro_id,
                p.nome as parametro_nome,
                p.unidade_medida,
                p.tipo_resultado,
                p.categoria,
                p.contexto_legislacao_id,
                p.limite_minimo,
                p.limite_maximo,
                p.tipo_limite,
                p.criterio_texto,
                p.fonte_referencia,
                l.id as legislacao_id,
                l.nome as legislacao_nome,
                l.sigla as legislacao_sigla,
                lc.codigo as contexto_codigo,
                lc.nome as contexto_nome,
                ma.id as metodo_analitico_id,
                case when ma.id is null then null else jsonb_build_object(
                  'id', ma.id,
                  'codigo', ma.codigo,
                  'nome', ma.nome,
                  'versao', ma.versao,
                  'referencia_normativa', ma.referencia_normativa,
                  'principio', ma.principio,
                  'procedimento_resumido', ma.procedimento_resumido,
                  'unidade_resultado', ma.unidade_resultado,
                  'limite_deteccao', ma.limite_deteccao,
                  'limite_quantificacao', ma.limite_quantificacao,
                  'incerteza_padrao', ma.incerteza_padrao
                ) end as metodo_snapshot
              from amostra a
              join amostra_parametro ap on ap.amostra_id = a.id
              join parametro p on p.id = ap.parametro_id
              join matriz m on m.id = a.matriz_id
              join legislacao l on l.id = p.legislacao_id
              join legislacao_contexto lc on lc.id = p.contexto_legislacao_id
              left join metodo_analitico ma
                on ma.id = ap.metodo_analitico_id and ma.ativo = true
              where a.id = $3 and p.id = $4
                and a.deleted_at is null and p.ativo = true and lc.ativo = true
                and (ap.metodo_analitico_id is null or ma.id is not null)
                and (ma.id is null or ma.parametro_id is null or ma.parametro_id = p.id)
                and (ma.id is null or ma.matriz_id is null or ma.matriz_id = a.matriz_id)
            ), snapshot as (
              select c.*, jsonb_build_object(
                'schema_version', 1,
                'versao_resultado', 1,
                'valor_medido', $1::numeric,
                'valor_qualitativo', nullif($2::text, ''),
                'datacoleta', $5::timestamptz,
                'parametro', jsonb_build_object(
                  'id', c.parametro_id,
                  'nome', c.parametro_nome,
                  'unidade_medida', c.unidade_medida,
                  'tipo_resultado', c.tipo_resultado,
                  'categoria', c.categoria
                ),
                'matriz', jsonb_build_object(
                  'id', c.matriz_id,
                  'nome', c.matriz_nome
                ),
                'referencia_legal', jsonb_build_object(
                  'legislacao_id', c.legislacao_id,
                  'legislacao_nome', c.legislacao_nome,
                  'legislacao_sigla', c.legislacao_sigla,
                  'contexto_id', c.contexto_legislacao_id,
                  'contexto_codigo', c.contexto_codigo,
                  'contexto_nome', c.contexto_nome,
                  'limite_minimo', c.limite_minimo,
                  'limite_maximo', c.limite_maximo,
                  'tipo_limite', c.tipo_limite,
                  'criterio', c.criterio_texto,
                  'fonte', c.fonte_referencia
                ),
                'metodo', c.metodo_snapshot
              ) as snapshot_analitico
              from contexto c
            ), novo_resultado as (
              insert into resultado_analise (
                valor_medido, valor_qualitativo, amostra_id, parametro_id,
                contexto_legislacao_id, datacoleta, datadapublicacao,
                codigodaamostra, numerodaamostra, matriz, legislacao,
                limite_minimo_aplicado, limite_maximo_aplicado,
                tipo_limite_aplicado, criterio_legal_aplicado, fonte_legal_aplicada,
                metodo_analitico_id, status_resultado, parametro_nome_aplicado,
                unidade_medida_aplicada, metodo_snapshot, snapshot_analitico, versao
              )
              select
                $1::numeric, nullif($2::text, ''), c.amostra_id, c.parametro_id,
                c.contexto_legislacao_id, $5::timestamptz, null,
                c.codigo_amostra, c.numero_da_amostra, c.matriz_nome,
                concat(c.legislacao_nome, ' (', c.legislacao_sigla, ')',
                  case when c.contexto_nome is null then '' else ' — ' || c.contexto_nome end),
                c.limite_minimo, c.limite_maximo, c.tipo_limite,
                c.criterio_texto, c.fonte_referencia, c.metodo_analitico_id,
                'rascunho', c.parametro_nome, c.unidade_medida,
                c.metodo_snapshot, c.snapshot_analitico, 1
              from snapshot c
              returning id, versao, snapshot_analitico
            ), nova_versao as (
              insert into resultado_versao_snapshot (
                resultado_id, versao, snapshot_analitico, criado_por, request_id
              )
              select id, versao, snapshot_analitico, $6, $7
              from novo_resultado
              returning resultado_id
            ), novo_evento as (
            insert into resultado_workflow_evento (
              resultado_id, status_anterior, status_novo, decisao, comentario,
              actor_user_id, request_id, metadata
            )
            select id, null, 'rascunho', 'criacao',
                   'Resultado criado por importação em lote.', $6, $7, $8::jsonb
            from novo_resultado
            returning resultado_id
            )
            select nr.id
            from novo_resultado nr
            join nova_versao nv on nv.resultado_id = nr.id
            join novo_evento ne on ne.resultado_id = nr.id
          `, [
            item.valor_medido, item.valor_qualitativo ?? null,
            item.amostra_id, item.parametro_id, item.datacoleta,
            auditContext.actorUserId || null,
            auditContext.requestId || null,
            JSON.stringify({ origem: 'importacao', linha: sourceLine }),
          ]);
          if (!inserted.rows?.[0]?.id) {
            throw workflowError(
              'O parâmetro não pertence ao escopo ativo da amostra ou possui método inativo.',
              409,
              'PARAMETRO_FORA_DO_ESCOPO'
            );
          }
          if (['recebida', 'em_triagem', 'aguardando_revisao'].includes(sample.status_amostra)) {
            await AmostraModel.applyStatusTransition(
              client,
              sample,
              'em_analise',
              {
                automatico: true,
                observacao: 'Amostra encaminhada para análise por importação de resultado.',
              },
              auditContext
            );
          }
          inseridos += 1;
          if (inserted.rows?.[0]?.id) resultadoIds.push(inserted.rows[0].id);
          amostrasAfetadas.add(Number(item.amostra_id));
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          logger.warn('import_row_failed', {
            request_id: auditContext.requestId || null,
            linha: sourceLine,
            amostra_id: item.amostra_id,
            parametro_id: item.parametro_id,
            code: error.code || null,
          });
          const { _linha_importacao, ...publicItem } = item;
          erros.push({
            linha: sourceLine,
            dados: publicItem,
            erro: this.mensagemErroInsercao(error),
          });
        }
      }
      if (inseridos > 0) {
        await AuditLogModel.record(client, {
          actorUserId: auditContext.actorUserId,
          requestId: auditContext.requestId,
          action: 'IMPORT',
          entityType: 'resultado_analise',
          metadata: {
            total: resultados.length,
            inseridos,
            erros: erros.length,
            resultado_ids: resultadoIds,
            amostra_ids: [...amostrasAfetadas],
            importacao_id: auditContext.importacaoId || null,
            lote: auditContext.numeroLote || 1,
            total_lotes: auditContext.totalLotes || 1,
            total_importacao: auditContext.totalImportacao || resultados.length,
          },
        });
      }
      await client.query('COMMIT');
      return { inseridos, erros, amostras_em_analise: [...amostrasAfetadas] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static mensagemErroInsercao(error) {
    if (Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500) {
      return error.message;
    }
    if (error?.code === '23505') {
      return 'Já existe um resultado ativo para este parâmetro e amostra.';
    }
    if (error?.code === '23503') {
      return 'A amostra, o parâmetro ou o método informado não está mais disponível.';
    }
    if (error?.code === '23514' || error?.code === '23502') {
      return 'Os dados da linha não atendem às regras de validação do resultado.';
    }
    return 'Não foi possível inserir esta linha. Verifique os dados e tente novamente.';
  }

}

module.exports = ImportacaoModel;
