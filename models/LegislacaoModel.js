const pool = require('../config/database');

class LegislacaoModel {
  static async findAll() {
    const result = await pool.query(`
      SELECT id, nome, sigla
      FROM legislacao
      ORDER BY sigla ASC
    `);
    return result.rows;
  }
}

module.exports = LegislacaoModel;
