const pool = require('../config/database');
const {
  avaliarStatusOperacional,
  resolverStatusOperacionalSql,
} = require('../utils/conformidade');

const STATUS_LABELS = Object.freeze({
  alerta: 'ALERTA',
  'nao-conforme': 'NÃO CONFORME',
  critico: 'CRÍTICO',
});

function mensagemLimite(item) {
  if (item.criterio_legal) return `(${item.criterio_legal})`;
  const partes = [
    item.limite_minimo !== null && item.limite_minimo !== undefined
      ? `mín. ${item.limite_minimo}` : null,
    item.limite_maximo !== null && item.limite_maximo !== undefined
      ? `máx. ${item.limite_maximo}` : null,
  ].filter(Boolean);
  return partes.length ? `(${partes.join(' · ')})` : '';
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapAlert(item) {
  const classification = Object.hasOwn(STATUS_LABELS, item.status_operacional)
    ? item.status_operacional
    : avaliarStatusOperacional(item);
  if (!STATUS_LABELS[classification]) return null;
  const {
    total_count: _totalCount,
    alert_count: _AlertCount,
    non_compliant_count: _nonCompliantCount,
    critical_count: _criticalCount,
    status_operacional: _databaseStatus,
    publicado_em_ordem: _publishedOrder,
    ...data
  } = item;
  return {
    ...data,
    status: STATUS_LABELS[classification],
    status_code: classification,
    mensagem_limite: mensagemLimite(item),
  };
}

function statsFromRow(row, mappedRows = []) {
  if (row?.total_count !== undefined) {
    return {
      total: numberOrZero(row.total_count),
      alerta: numberOrZero(row.alert_count),
      naoConforme: numberOrZero(row.non_compliant_count),
      critico: numberOrZero(row.critical_count),
    };
  }
  return {
    total: mappedRows.length,
    alerta: mappedRows.filter((item) => item.status_code === 'alerta').length,
    naoConforme: mappedRows.filter((item) => item.status_code === 'nao-conforme').length,
    critico: mappedRows.filter((item) => item.status_code === 'critico').length,
  };
}

class AlertasModel {
  static async getAlertas(options = {}) {
    const page = Number(options.page ?? 1);
    const pageSize = Number(options.pageSize ?? 100);
    const offset = Number(options.offset ?? ((page - 1) * pageSize));
    const requestedStatuses = Array.isArray(options.statuses) ? options.statuses : [];
    const search = String(options.search ?? '').trim();
    const values = [];
    const clauses = [
      'ra.deleted_at is null',
      "ra.status_resultado = 'publicado'",
      'a.deleted_at is null',
    ];

    if (search) {
      values.push(`%${search}%`);
      clauses.push(`(
        coalesce(ra.snapshot_analitico->'parametro'->>'nome', ra.parametro_nome_aplicado)
          ilike $${values.length}
        or coalesce(ra.snapshot_analitico->'matriz'->>'nome', ra.matriz)
          ilike $${values.length}
        or coalesce(ra.snapshot_analitico->'referencia_legal'->>'contexto_nome', '')
          ilike $${values.length}
        or a.codigo_amostra ilike $${values.length}
        or a.numero_da_amostra ilike $${values.length}
      )`);
    }

    const statusExpression = await resolverStatusOperacionalSql(pool, 'ra');
    const baseCte = `
      with classified as (
        select
          ra.id, ra.valor_medido, ra.valor_qualitativo,
          coalesce(ra.publicado_em, ra.datadapublicacao, ra.created_at) as data_alerta,
          ra.publicado_em as publicado_em_ordem,
          coalesce(
            ra.snapshot_analitico->'parametro'->>'nome',
            ra.parametro_nome_aplicado
          ) as parametro_nome,
          coalesce(
            ra.snapshot_analitico->'parametro'->>'unidade_medida',
            ra.unidade_medida_aplicada
          ) as unidade_medida,
          ra.limite_minimo_aplicado as limite_minimo,
          ra.limite_maximo_aplicado as limite_maximo,
          ra.tipo_limite_aplicado as tipo_limite,
          ra.criterio_legal_aplicado as criterio_legal,
          coalesce(ra.snapshot_analitico->'matriz'->>'nome', ra.matriz) as matriz_nome,
          ra.snapshot_analitico->'referencia_legal'->>'contexto_nome' as contexto_nome,
          a.codigo_amostra,
          a.numero_da_amostra,
          ${statusExpression} as status_operacional
        from resultado_analise ra
        join amostra a on ra.amostra_id = a.id
        where ${clauses.join(' and ')}
      )`;

    const statusFilters = [
      "status_operacional in ('alerta', 'nao-conforme', 'critico')",
    ];
    if (requestedStatuses.length) {
      values.push(requestedStatuses);
      statusFilters.push(`status_operacional = any($${values.length}::text[])`);
    }
    const statusClause = `where ${statusFilters.join(' and ')}`;
    const filterValues = [...values];
    values.push(pageSize, offset);

    const result = await pool.query(`
      ${baseCte}
      select classified.*,
        count(*) over()::int as total_count,
        (count(*) filter (where status_operacional = 'alerta') over ())::int as alert_count,
        (count(*) filter (where status_operacional = 'nao-conforme') over ())::int
          as non_compliant_count,
        (count(*) filter (where status_operacional = 'critico') over ())::int as critical_count
      from classified
      ${statusClause}
      order by publicado_em_ordem desc, id desc
      limit $${values.length - 1} offset $${values.length}
    `, values);

    let mappedRows = result.rows.map(mapAlert).filter(Boolean);
    let stats = statsFromRow(result.rows[0], mappedRows);
    if (!result.rows.length && offset > 0) {
      const fallback = await pool.query(`
        ${baseCte}, filtered as (
          select status_operacional from classified ${statusClause}
        )
        select
          count(*)::int as total_count,
          count(*) filter (where status_operacional = 'alerta')::int as alert_count,
          count(*) filter (where status_operacional = 'nao-conforme')::int
            as non_compliant_count,
          count(*) filter (where status_operacional = 'critico')::int as critical_count
        from filtered
      `, filterValues);
      stats = statsFromRow(fallback.rows[0]);
      mappedRows = [];
    }

    return {
      rows: mappedRows,
      total: stats.total,
      page,
      pageSize,
      stats,
    };
  }
}

module.exports = AlertasModel;
