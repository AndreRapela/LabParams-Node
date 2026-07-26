const pool = require('../config/database');

class DashboardTvModel {

  static async getDashboardData({ parametro_id }) {
    const params = [];
    let where = 'WHERE 1=1';

    if (parametro_id?.length) {
      where += ` AND p.id = ANY($1)`;
      params.push(parametro_id);
    }

    const query = `
      SELECT
        ra.id,
        ra.valor_medido AS valor_parametro,
        ra.created_at,
        p.id AS parametro_id,
        p.nome,
        p.unidade_medida,
        p.limite_minimo,
        p.limite_maximo,
        m.nome AS matriz_nome,
        l.sigla AS legislacao_sigla,
        l.nome AS legislacao_nome
      FROM resultado_analise ra
      JOIN parametro p ON p.id = ra.parametro_id
      JOIN matriz m ON m.id = p.matriz_id
      JOIN legislacao l ON l.id = p.legislacao_id
      ${where}
      ORDER BY ra.created_at DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }
}

module.exports = DashboardTvModel;
