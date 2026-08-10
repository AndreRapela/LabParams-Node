const pool = require('../config/database');

class DashboardWebModel {
  static async getDashboardData(filters = {}) {
    const {
      matriz_id: matrixId,
      legislacao_id: legislationId,
      amostra_numero: sampleNumber,
      parametro_id: parameterIds,
      data_coleta: collectionDate,
      data_publicacao: publicationDate,
    } = filters;

    const values = [];
    const clauses = [
      'ra.deleted_at is null',
      "ra.status_resultado = 'publicado'",
      'a.deleted_at is null',
    ];
    const add = (sql, value) => {
      values.push(value);
      clauses.push(`${sql} $${values.length}`);
    };

    if (matrixId) add('a.matriz_id =', matrixId);
    if (legislationId) {
      add("(ra.snapshot_analitico->'referencia_legal'->>'legislacao_id')::bigint =", legislationId);
    }
    if (sampleNumber) add('a.numero_da_amostra =', sampleNumber);
    if (parameterIds?.length) {
      values.push(parameterIds);
      clauses.push(`ra.parametro_id = any($${values.length})`);
    }
    if (publicationDate) {
      values.push(publicationDate);
      clauses.push(`ra.datadapublicacao >= $${values.length}::date
        and ra.datadapublicacao < ($${values.length}::date + interval '1 day')`);
    }
    if (collectionDate) {
      values.push(collectionDate);
      clauses.push(`ra.datacoleta >= $${values.length}::date
        and ra.datacoleta < ($${values.length}::date + interval '1 day')`);
    }

    const result = await pool.query(`
      select
        ra.id,
        ra.valor_medido as valor_parametro,
        ra.valor_qualitativo,
        ra.datacoleta,
        ra.created_at,
        ra.parametro_id,
        coalesce(
          ra.snapshot_analitico->'parametro'->>'nome',
          ra.parametro_nome_aplicado
        ) as nome,
        coalesce(
          ra.snapshot_analitico->'parametro'->>'unidade_medida',
          ra.unidade_medida_aplicada
        ) as unidade_medida,
        ra.limite_minimo_aplicado as limite_minimo,
        ra.limite_maximo_aplicado as limite_maximo,
        ra.tipo_limite_aplicado as tipo_limite,
        ra.criterio_legal_aplicado as criterio_legal,
        a.codigo_amostra,
        a.numero_da_amostra,
        a.matriz_id,
        ra.snapshot_analitico->'matriz'->>'nome' as matriz_nome,
        (ra.snapshot_analitico->'referencia_legal'->>'legislacao_id')::bigint as legislacao_id,
        ra.snapshot_analitico->'referencia_legal'->>'legislacao_sigla' as legislacao_sigla,
        ra.snapshot_analitico->'referencia_legal'->>'legislacao_nome' as legislacao_nome
      from resultado_analise ra
      join amostra a on a.id = ra.amostra_id
      where ${clauses.join(' and ')}
      order by ra.datacoleta desc
    `, values);
    return result.rows;
  }
}

module.exports = DashboardWebModel;
