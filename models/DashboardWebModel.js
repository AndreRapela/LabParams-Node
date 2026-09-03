const pool = require('../config/database');
const { resolverStatusOperacionalSql } = require('../utils/conformidade');

const EMPTY_STATISTICS = Object.freeze({
  compliant_count: 0,
  alert_count: 0,
  critical_count: 0,
  non_compliant_count: 0,
  informative_count: 0,
  total_parameters: 0,
});

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summaryFromRow(row, fallbackTotal = 0) {
  if (!row) return { ...EMPTY_STATISTICS, total_parameters: fallbackTotal };
  return {
    compliant_count: numberOrZero(row.compliant_count),
    alert_count: numberOrZero(row.alert_count),
    critical_count: numberOrZero(row.critical_count),
    non_compliant_count: numberOrZero(row.non_compliant_count),
    informative_count: numberOrZero(row.informative_count),
    total_parameters: row.total_count === undefined
      ? fallbackTotal
      : numberOrZero(row.total_count),
  };
}

function stripSummary(row) {
  const {
    total_count: _totalCount,
    compliant_count: _compliantCount,
    alert_count: _alertCount,
    critical_count: _criticalCount,
    non_compliant_count: _nonCompliantCount,
    informative_count: _informativeCount,
    ...clean
  } = row;
  return clean;
}

class DashboardWebModel {
  static async getDashboardData(filters = {}, options = {}) {
    const {
      matriz_id: matrixId,
      legislacao_id: legislationId,
      amostra_numero: sampleNumber,
      parametro_id: parameterIds,
      data_coleta: collectionDate,
      data_publicacao: publicationDate,
    } = filters;
    const page = Number(options.page ?? 1);
    const pageSize = Number(options.pageSize ?? 100);
    const offset = Number(options.offset ?? ((page - 1) * pageSize));
    const requestedStatuses = Array.isArray(options.statuses) ? options.statuses : [];

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

    const statusExpression = await resolverStatusOperacionalSql(pool, 'ra');
    const baseCte = `
      with classified as (
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
          ra.snapshot_analitico->'referencia_legal'->>'legislacao_nome' as legislacao_nome,
          ${statusExpression} as status_operacional
        from resultado_analise ra
        join amostra a on a.id = ra.amostra_id
        where ${clauses.join(' and ')}
      )`;

    let statusClause = '';
    if (requestedStatuses.length) {
      values.push(requestedStatuses);
      statusClause = `where status_operacional = any($${values.length}::text[])`;
    }
    const aggregateSql = `
      (count(*) filter (where status_operacional = 'conforme') over ())::int
        as compliant_count,
      (count(*) filter (where status_operacional = 'alerta') over ())::int
        as alert_count,
      (count(*) filter (where status_operacional = 'critico') over ())::int
        as critical_count,
      (count(*) filter (where status_operacional = 'nao-conforme') over ())::int
        as non_compliant_count,
      (count(*) filter (where status_operacional = 'informativo') over ())::int
        as informative_count`;

    const filterValues = [...values];
    values.push(pageSize, offset);
    const result = await pool.query(`
      ${baseCte}
      select classified.*,
        count(*) over()::int as total_count,
        ${aggregateSql}
      from classified
      ${statusClause}
      order by datacoleta desc, id desc
      limit $${values.length - 1} offset $${values.length}
    `, values);

    let statistics = summaryFromRow(result.rows[0], result.rows.length);
    if (!result.rows.length && offset > 0) {
      const fallback = await pool.query(`
        ${baseCte}, filtered as (
          select status_operacional from classified ${statusClause}
        )
        select
          count(*)::int as total_count,
          count(*) filter (where status_operacional = 'conforme')::int as compliant_count,
          count(*) filter (where status_operacional = 'alerta')::int as alert_count,
          count(*) filter (where status_operacional = 'critico')::int as critical_count,
          count(*) filter (where status_operacional = 'nao-conforme')::int as non_compliant_count,
          count(*) filter (where status_operacional = 'informativo')::int as informative_count
        from filtered
      `, filterValues);
      statistics = summaryFromRow(fallback.rows[0]);
    }

    return {
      rows: result.rows.map(stripSummary),
      total: statistics.total_parameters,
      page,
      pageSize,
      statistics,
    };
  }
}

module.exports = DashboardWebModel;
