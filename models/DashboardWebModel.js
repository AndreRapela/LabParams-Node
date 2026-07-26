// models/DashboardWebModel.js
const pool = require('../config/database');

class DashboardWebModel {
  static async getDashboardData(filtros = {}) {
    try {
      const {
        matriz_id,
        legislacao_id,
        amostra_numero,
        parametro_id,
        data_coleta,
        data_publicacao,
        status
      } = filtros;

      const params = [];
      let whereClause = '';
      let idx = 1;

      if (matriz_id) {
        whereClause += ` AND m.id = $${idx++}`;
        params.push(matriz_id);
      }

      if (legislacao_id) {
        whereClause += ` AND l.id = $${idx++}`;
        params.push(legislacao_id);
      }

      if (amostra_numero) {
        whereClause += ` AND a.numero_da_amostra = $${idx++}`;
        params.push(amostra_numero);
      }

      if (parametro_id?.length) {
        whereClause += ` AND p.id = ANY($${idx++})`;
        params.push(parametro_id);
      }

      if (data_publicacao) {
        whereClause += ` AND ra.datadapublicacao >= $${idx}::date AND ra.datadapublicacao < ($${idx++}::date + INTERVAL '1 day')`;
        params.push(data_publicacao);
      }

      if (data_coleta) {
        whereClause += ` AND ra.datacoleta >= $${idx}::date AND ra.datacoleta < ($${idx++}::date + INTERVAL '1 day')`;
        params.push(data_coleta);
      }


      const query = `
        SELECT
          ra.id,
          ra.valor_medido AS valor_parametro,
          ra.datacoleta,
          ra.created_at,

          p.id AS parametro_id,
          p.nome,
          p.unidade_medida,
          p.limite_minimo,
          p.limite_maximo,

          a.codigo_amostra,
          a.numero_da_amostra,

          m.id AS matriz_id,
          m.nome AS matriz_nome,

          l.id AS legislacao_id,
          l.sigla AS legislacao_sigla,
          l.nome AS legislacao_nome

        FROM resultado_analise ra
        LEFT JOIN parametro p ON ra.parametro_id = p.id
        LEFT JOIN amostra a ON ra.amostra_id = a.id
        LEFT JOIN matriz m ON a.matriz_id = m.id
        LEFT JOIN legislacao l ON p.legislacao_id = l.id
        WHERE 1=1
      `;

      const finalQuery =
        query + whereClause + ' ORDER BY ra.datacoleta DESC';

      const result = await pool.query(finalQuery, params);
      return result.rows;

    } catch (error) {
      throw error;
    }
  }
}

module.exports = DashboardWebModel;
