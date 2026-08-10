const pool = require('../config/database');

class GraficoParametroModel {
  static async getDadosGrafico() {
    const result = await pool.query(`
      select
        ra.parametro_id,
        coalesce(
          ra.snapshot_analitico->'parametro'->>'nome',
          ra.parametro_nome_aplicado
        ) as parametro,
        coalesce(
          ra.snapshot_analitico->'parametro'->>'unidade_medida',
          ra.unidade_medida_aplicada
        ) as unidade_medida,
        round(avg(ra.valor_medido)::numeric, 6) as valor_medio,
        min(ra.valor_medido) as valor_minimo_observado,
        max(ra.valor_medido) as valor_maximo_observado,
        count(*)::int as total_analises,
        max(ra.datacoleta) as ultima_coleta
      from resultado_analise ra
      join amostra a on a.id = ra.amostra_id and a.deleted_at is null
      where ra.deleted_at is null
        and ra.status_resultado = 'publicado'
        and ra.valor_medido is not null
      group by ra.parametro_id,
        coalesce(
          ra.snapshot_analitico->'parametro'->>'nome',
          ra.parametro_nome_aplicado
        ),
        coalesce(
          ra.snapshot_analitico->'parametro'->>'unidade_medida',
          ra.unidade_medida_aplicada
        )
      order by parametro asc
    `);
    return result.rows;
  }
}

module.exports = GraficoParametroModel;
