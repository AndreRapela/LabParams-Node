const pool = require('../config/database');
const { resolverStatusOperacionalSql } = require('../utils/conformidade');

class DashboardTvModel {
  static async getDashboardData({ parametro_id: parameterIds } = {}) {
    const values = [];
    const clauses = [
      'ra.deleted_at is null',
      "ra.status_resultado = 'publicado'",
      'a.deleted_at is null',
    ];
    if (parameterIds?.length) {
      values.push(parameterIds);
      clauses.push(`ra.parametro_id = any($${values.length})`);
    }

    const statusExpression = await resolverStatusOperacionalSql(pool, 'ra');

    const result = await pool.query(`
      with resultado_atual as (
        select distinct on (ra.parametro_id)
          ra.id,
          ra.valor_medido as valor_parametro,
          ra.valor_qualitativo,
          ra.created_at,
          ra.publicado_em,
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
          ra.snapshot_analitico->'matriz'->>'nome' as matriz_nome,
          ra.snapshot_analitico->'referencia_legal'->>'legislacao_sigla' as legislacao_sigla,
          ra.snapshot_analitico->'referencia_legal'->>'legislacao_nome' as legislacao_nome,
          ${statusExpression} as status_operacional
        from resultado_analise ra
        join amostra a on a.id = ra.amostra_id
        where ${clauses.join(' and ')}
        order by ra.parametro_id,
          ra.publicado_em desc nulls last,
          ra.created_at desc,
          ra.id desc
      )
      select *
      from resultado_atual
      order by publicado_em desc nulls last, created_at desc, id desc
    `, values);
    return result.rows;
  }
}

module.exports = DashboardTvModel;
