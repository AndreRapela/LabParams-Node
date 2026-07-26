const pool = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

class AmostraModel {

  static async create(dados) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const {
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        parametros_ids
      } = dados;

      if (!codigo_amostra || !numero_da_amostra || !data_coleta || !matriz_id || !usuario_id) {
        throw new Error('Todos os campos obrigatórios (incluindo usuário) devem ser preenchidos.');
      }

      if (new Date(data_coleta) > new Date()) {
        throw new Error('A data da coleta não pode ser futura.');
      }

      const queryAmostra = `
        INSERT INTO amostra 
        (codigo_amostra, numero_da_amostra, data_coleta, localizacao, matriz_id, usuario_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, codigo_amostra
      `;

      const valuesAmostra = [
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id
      ];

      const resultAmostra = await client.query(queryAmostra, valuesAmostra);
      const novaAmostraId = resultAmostra.rows[0].id;

      const parametroIds = this.normalizarParametroIds(parametros_ids);
      if (parametroIds.length) {
        await client.query(
          `INSERT INTO amostra_parametro (amostra_id, parametro_id)
           SELECT $1, unnest($2::int[])`,
          [novaAmostraId, parametroIds]
        );
      }

      await client.query('COMMIT');

      await this.logOperation('CREATE', { id: novaAmostraId, codigo: codigo_amostra, usuario: usuario_id });

      return { id: novaAmostraId, ...dados };

    } catch (error) {
      if (client) await client.query('ROLLBACK');

      if (error.code === '23505') {
        if (error.detail?.includes('codigo_amostra')) throw new Error(`O Código "${dados.codigo_amostra}" já existe.`);
        if (error.detail?.includes('numero_da_amostra')) throw new Error(`O Número "${dados.numero_da_amostra}" já existe.`);
      }

      console.error('Erro ao criar amostra:', error);
      await this.logOperation('CREATE_ERROR', { error: error.message, dados });
      throw error;
    } finally {
      if (client) client.release();
    }
  }


  static async update(id, dados) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const {
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        parametros_ids
      } = dados;

      const original = await this.findById(id);
      if (!original) throw new Error('Amostra não encontrada.');

      if (data_coleta && new Date(data_coleta) > new Date()) {
        throw new Error('A data da coleta não pode ser futura.');
      }

      const query = `
        UPDATE amostra
        SET 
          codigo_amostra = $1,
          numero_da_amostra = $2,
          data_coleta = $3,
          localizacao = $4,
          matriz_id = $5,
          usuario_id = $6
        WHERE id = $7
        RETURNING *
      `;

      const values = [
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        id
      ];

      const result = await client.query(query, values);

      await client.query('DELETE FROM amostra_parametro WHERE amostra_id = $1', [id]);

      const parametroIds = this.normalizarParametroIds(parametros_ids);
      if (parametroIds.length) {
        await client.query(
          `INSERT INTO amostra_parametro (amostra_id, parametro_id)
           SELECT $1, unnest($2::int[])`,
          [id, parametroIds]
        );
      }

      await client.query('COMMIT');
      await this.logOperation('UPDATE', { id: id, dados_novos: result.rows[0] });

      return result.rows[0];

    } catch (error) {
      if (client) await client.query('ROLLBACK');

      if (error.code === '23505') {
        if (error.detail?.includes('codigo_amostra')) {
          throw new Error(`Não foi possível atualizar: O código '${dados.codigo_amostra}' já pertence a outra amostra.`);
        }
        if (error.detail?.includes('numero_da_amostra')) {
          throw new Error(`Não foi possível atualizar: O número '${dados.numero_da_amostra}' já pertence a outra amostra.`);
        }
      }
      
      console.error('Erro ao atualizar amostra:', error);
      await this.logOperation('UPDATE_ERROR', { id, error: error.message });
      throw error;
    } finally {
      if (client) client.release();
    }
  }

  static async findById(id) {
    try {
      const queryAmostra = `
        SELECT 
          a.*, 
          m.nome as matriz_nome,
          u.nome as usuario_nome,
          u.email as usuario_email
        FROM amostra a
        INNER JOIN matriz m ON a.matriz_id = m.id
        INNER JOIN usuario u ON a.usuario_id = u.id
        WHERE a.id = $1
      `;
      const resAmostra = await pool.query(queryAmostra, [id]);
      const amostra = resAmostra.rows[0];

      if (!amostra) return null;

      const queryParamsDetalhes = `
        SELECT p.id, p.nome 
        FROM parametro p
        INNER JOIN amostra_parametro ap ON ap.parametro_id = p.id
        WHERE ap.amostra_id = $1
      `;
      const resParamsDet = await pool.query(queryParamsDetalhes, [id]);
      amostra.parametros_detalhes = resParamsDet.rows;
      amostra.parametros_ids = resParamsDet.rows.map((row) => row.id);

      await this.logOperation('READ_ONE', { id });
      return amostra;

    } catch (error) {
      console.error('Erro findById:', error);
      throw error;
    }
  }

  static async delete(id) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const query = 'DELETE FROM amostra WHERE id = $1 RETURNING id';
      const result = await client.query(query, [id]);
      await client.query('COMMIT');
      return result.rowCount > 0;
    } catch (e) {
      if (client) await client.query('ROLLBACK');
      throw e;
    } finally { if (client) client.release(); }
  }

  static async findAll() {
    const query = `
        SELECT 
          a.id, a.codigo_amostra, a.numero_da_amostra, a.data_coleta, a.localizacao, a.created_at,
          m.nome as matriz_nome,
          u.nome as usuario_nome,
          COUNT(ap.parametro_id)::int as qtd_parametros
        FROM amostra a
        INNER JOIN matriz m ON a.matriz_id = m.id
        INNER JOIN usuario u ON a.usuario_id = u.id
        LEFT JOIN amostra_parametro ap ON ap.amostra_id = a.id
        GROUP BY a.id, m.nome, u.nome
        ORDER BY a.created_at DESC
      `;
    const res = await pool.query(query);
    return res.rows;
  }

  static async findMatrizesDropdown() {
    const res = await pool.query('SELECT id, nome FROM matriz ORDER BY nome ASC');
    return res.rows;
  }

  static async findUsuariosDropdown() {
    const res = await pool.query('SELECT id, nome FROM usuario ORDER BY nome ASC');
    return res.rows;
  }

  static normalizarParametroIds(ids) {
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  }

  static async logOperation(operation, data) {
    try {
      const logEntry = { timestamp: new Date().toISOString(), operation, data };
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        console.log('[Amostra]', JSON.stringify(logEntry));
      } else {
        const logDir = path.join(__dirname, '../logs');
        const logFile = path.join(logDir, 'amostras.log');
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
      }
    } catch (error) { console.error('Log error', error); }
  }
}

module.exports = AmostraModel;
