const pool = require('../config/database');

class MatrizModel {
  static async findAll() {
    const result = await pool.query(`
      SELECT id, nome
      FROM matriz
      ORDER BY nome ASC
    `);
    return result.rows;
  }
}

module.exports = MatrizModel;
