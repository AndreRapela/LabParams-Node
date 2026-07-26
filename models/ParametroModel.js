// models/ParametroModel.js
const pool = require('../config/database');

class ParametroModel {

  static async findAll() {
    try {
      const query = `
        SELECT 
          p.id,
          p.nome,
          p.unidade_medida,
          p.valor_parametro,
          p.limite_minimo,
          p.limite_maximo,
          p.legislacao_id,
          p.matriz_id,
          p.created_at,
          m.nome AS matriz_nome,
          l.sigla AS legislacao_sigla,
          l.nome AS legislacao_nome
        FROM parametro p
        LEFT JOIN matriz m ON p.matriz_id = m.id
        LEFT JOIN legislacao l ON p.legislacao_id = l.id
        WHERE p.valor_parametro IS NOT NULL
        ORDER BY p.nome ASC
      `;
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Erro ao buscar parâmetros:', error);
      throw error;
    }
  }

  static async update(id, dados) {
    try {
      const query = `
        UPDATE parametro
        SET 
          nome = $1,
          unidade_medida = $2,
          limite_minimo = $3,
          limite_maximo = $4,
          legislacao_id = $5,
          matriz_id = $6,
          valor_parametro = $7
        WHERE id = $8
        RETURNING *;
      `;

      const values = [
        dados.nome,
        dados.unidade_medida,
        dados.limite_minimo,
        dados.limite_maximo,
        dados.legislacao_id,
        dados.matriz_id,
        dados.valor_parametro,
        id
      ];

      const result = await pool.query(query, values);
      return result.rows[0];

    } catch (error) {
      console.error("Erro no model ao atualizar parâmetro:", error);
      throw error;
    }
  }

static async findAllGerenciamento() {
  const result = await pool.query(`
    SELECT 
      p.id,
      p.nome,
      p.unidade_medida,
      p.valor_parametro,
      p.limite_minimo,
      p.limite_maximo,

      p.matriz_id,
      m.nome AS matriz_nome,

      p.legislacao_id,
      l.nome AS legislacao_nome,
      l.sigla AS legislacao_sigla
    FROM parametro p
    JOIN matriz m ON m.id = p.matriz_id
    JOIN legislacao l ON l.id = p.legislacao_id
    ORDER BY p.nome ASC
  `);

  return result.rows;
}

static async updateGerenciamento(id, dados) {
  const result = await pool.query(`
    UPDATE parametro
    SET
      valor_parametro = $1,
      matriz_id = $2,
      legislacao_id = $3
    WHERE id = $4
    RETURNING *;
  `, [
    dados.valor_parametro,
    dados.matriz_id,
    dados.legislacao_id,
    id
  ]);

  return result.rows[0];
}


}

module.exports = ParametroModel;
