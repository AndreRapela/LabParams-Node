const pool = require('../config/database');
const { avaliarConformidade } = require('../utils/conformidade');

class AlertasModel {
  static async getAlertas() {
    const result = await pool.query(`
      select
        ra.id, ra.valor_medido, ra.valor_qualitativo, ra.created_at as data_alerta,
        p.nome as parametro_nome, p.unidade_medida,
        coalesce(ra.limite_minimo_aplicado, p.limite_minimo) as limite_minimo,
        coalesce(ra.limite_maximo_aplicado, p.limite_maximo) as limite_maximo,
        coalesce(ra.tipo_limite_aplicado, p.tipo_limite) as tipo_limite,
        coalesce(ra.criterio_legal_aplicado, p.criterio_texto) as criterio_legal,
        m.nome as matriz_nome,
        lc.nome as contexto_nome
      from resultado_analise ra
      join parametro p on ra.parametro_id = p.id
      join amostra a on ra.amostra_id = a.id
      join matriz m on a.matriz_id = m.id
      join legislacao_contexto lc on p.contexto_legislacao_id = lc.id
      where ra.deleted_at is null
        and ra.status_resultado = 'publicado'
        and a.deleted_at is null
      order by ra.created_at desc
    `);

    return result.rows
      .map((item) => {
        const conformidade = avaliarConformidade(item);
        if (conformidade === 'conforme' || conformidade === 'informativo') return null;
        const limite = item.criterio_legal || [
          item.limite_minimo !== null ? `mín. ${item.limite_minimo}` : null,
          item.limite_maximo !== null ? `máx. ${item.limite_maximo}` : null,
        ].filter(Boolean).join(' · ');
        return {
          ...item,
          status: 'NÃO CONFORME',
          mensagem_limite: limite ? `(${limite})` : '',
        };
      })
      .filter(Boolean);
  }
}

module.exports = AlertasModel;
