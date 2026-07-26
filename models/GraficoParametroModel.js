// models/GraficoParametroModel.js
const pool = require('../config/database');

class GraficoParametroModel {

  static async getDadosGrafico() {
    try {
      const query = `
        SELECT 
          p.nome as parametro,
          MIN(p.valor_parametro) as valor_parametro
        FROM parametro p
        WHERE p.valor_parametro IS NOT NULL 
          AND p.limite_minimo IS NOT NULL
          AND p.limite_maximo IS NOT NULL
        GROUP BY p.nome
        ORDER BY p.nome ASC
      `;
      
      const result = await pool.query(query);
      return result.rows;

    } catch (error) {
      console.error('Erro no GraficoParametroModel:', error);
      throw new Error(`Erro ao buscar dados: ${error.message}`);
    }
  }
}

module.exports = GraficoParametroModel;