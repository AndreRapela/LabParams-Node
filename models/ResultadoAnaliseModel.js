const pool = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

class ResultadoAnaliseModel {

  static async create(dados) {
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { valor_medido, amostra_id, parametro_id, datacoleta, matriz_id_selecionada, legislacao_id_selecionada } = dados;

      // 1. Valida Existência
      const [amostra, parametro] = await Promise.all([
        this.verificarAmostraExiste(amostra_id, client),
        this.verificarParametroExiste(parametro_id, client)
      ]);
      if (!amostra) throw new Error('Amostra não existe');
      if (!parametro) throw new Error('Parâmetro não existe');

      // 2. Valida Valor/Data
      const valor = parseFloat(valor_medido);
      if (isNaN(valor) || valor < 0) throw new Error('Valor inválido');
      if (datacoleta && new Date(datacoleta) > new Date()) throw new Error('Data futura');

      let nomeMatrizFinal = amostra.matriz_nome;
      if (matriz_id_selecionada && Number(matriz_id_selecionada) > 0) {
        const res = await client.query('SELECT nome FROM matriz WHERE id = $1', [matriz_id_selecionada]);
        if (res.rowCount > 0) nomeMatrizFinal = res.rows[0].nome;
      }

      let infoLegislacaoFinal = `${parametro.legislacao_nome} (${parametro.legislacao_sigla})`;
      if (legislacao_id_selecionada && Number(legislacao_id_selecionada) > 0) {
        const res = await client.query('SELECT nome, sigla FROM legislacao WHERE id = $1', [legislacao_id_selecionada]);
        if (res.rowCount > 0) infoLegislacaoFinal = `${res.rows[0].nome} (${res.rows[0].sigla})`;
      }

      const datadapublicacao = new Date().toISOString();
      const query = `
        INSERT INTO resultado_analise 
        (valor_medido, amostra_id, parametro_id, datacoleta, datadapublicacao, codigodaamostra, numerodaamostra, matriz, legislacao)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      const values = [
        valor, amostra_id, parametro_id, datacoleta || new Date(), datadapublicacao,
        amostra.codigo_amostra, amostra.numero_da_amostra, nomeMatrizFinal, infoLegislacaoFinal
      ];

      const result = await client.query(query, values);
      await client.query('COMMIT');
      await this.logOperation('CREATE', result.rows[0]);
      return result.rows[0];

    } catch (error) {
      if (client) await client.query('ROLLBACK');
      console.error('Create Error:', error);
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

      const { valor_medido, amostra_id, parametro_id, datacoleta, matriz_id_selecionada, legislacao_id_selecionada } = dados;

      const [amostra, parametro] = await Promise.all([
        this.verificarAmostraExiste(amostra_id, client),
        this.verificarParametroExiste(parametro_id, client)
      ]);
      if (!amostra) throw new Error('Amostra não existe');
      if (!parametro) throw new Error('Parâmetro não existe');

      const valor = parseFloat(valor_medido);
      if (isNaN(valor) || valor < 0) throw new Error('Valor inválido');
      if (new Date(datacoleta) > new Date()) throw new Error('Data futura');

      let nomeMatrizFinal = amostra.matriz_nome;
      if (matriz_id_selecionada && Number(matriz_id_selecionada) > 0) {
        const res = await client.query('SELECT nome FROM matriz WHERE id = $1', [matriz_id_selecionada]);
        if (res.rowCount > 0) nomeMatrizFinal = res.rows[0].nome;
      }

      let infoLegislacaoFinal = `${parametro.legislacao_nome} (${parametro.legislacao_sigla})`;
      if (legislacao_id_selecionada && Number(legislacao_id_selecionada) > 0) {
        const res = await client.query('SELECT nome, sigla FROM legislacao WHERE id = $1', [legislacao_id_selecionada]);
        if (res.rowCount > 0) infoLegislacaoFinal = `${res.rows[0].nome} (${res.rows[0].sigla})`;
      }

      const datadapublicacao = new Date().toISOString();
      const query = `
        UPDATE resultado_analise
        SET valor_medido=$1, amostra_id=$2, parametro_id=$3, datacoleta=$4, datadapublicacao=$5,
            codigodaamostra=$6, numerodaamostra=$7, matriz=$8, legislacao=$9
        WHERE id=$10 RETURNING *
      `;
      const values = [
        valor, amostra_id, parametro_id, datacoleta, datadapublicacao,
        amostra.codigo_amostra, amostra.numero_da_amostra, nomeMatrizFinal, infoLegislacaoFinal, id
      ];

      const result = await client.query(query, values);
      await client.query('COMMIT');
      await this.logOperation('UPDATE', result.rows[0]);
      return result.rows[0];

    } catch (error) {
      if (client) await client.query('ROLLBACK');
      console.error('Update Error:', error);
      throw error;
    } finally {
      if (client) client.release();
    }
  }

  static async findAll() {
    try {
      const query = `
        SELECT 
          ra.*,
          ra.matriz, ra.legislacao, ra.codigodaamostra, ra.numerodaamostra,
          a.codigo_amostra as amostra_codigo_join,
          a.numero_da_amostra as amostra_numero_join,
          m_amostra.nome as matriz_nome,
          p.nome as parametro_nome, p.unidade_medida,
          l.sigla as legislacao_sigla, l.nome as legislacao_nome
        FROM resultado_analise ra
        INNER JOIN amostra a ON ra.amostra_id = a.id
        INNER JOIN matriz m_amostra ON a.matriz_id = m_amostra.id
        INNER JOIN parametro p ON ra.parametro_id = p.id
        INNER JOIN legislacao l ON p.legislacao_id = l.id
        ORDER BY ra.created_at DESC
      `;
      const result = await pool.query(query);
      return result.rows;
    } catch (e) { throw e; }
  }

  static async findById(id) { const res = await pool.query('SELECT * FROM resultado_analise WHERE id=$1', [id]); return res.rows[0]; }
  static async delete(id) {
      const res = await pool.query('DELETE FROM resultado_analise WHERE id=$1 RETURNING id', [id]);
      const deleted = res.rowCount > 0;
      await this.logOperation(deleted ? 'DELETE' : 'DELETE_NOT_FOUND', { id });
      return deleted;
  }
  
  static async findAmostras() { const r = await pool.query(`SELECT a.id, a.codigo_amostra, a.numero_da_amostra, m.nome as matriz_nome, m.id as matriz_id FROM amostra a JOIN matriz m ON a.matriz_id = m.id ORDER BY a.codigo_amostra ASC`); return r.rows; }
  static async findParametros() {
      const r = await pool.query(`SELECT p.id, p.nome, p.unidade_medida, p.limite_minimo, p.limite_maximo, m.id as matriz_id, m.nome as matriz_nome, l.id as legislacao_id FROM parametro p JOIN matriz m ON p.matriz_id = m.id JOIN legislacao l ON p.legislacao_id = l.id ORDER BY p.nome ASC`); return r.rows; 
  }
  static async findMatrizes() { const r = await pool.query(`SELECT id, nome FROM matriz ORDER BY nome ASC`); return r.rows; }
  static async findLegislacoes() { const r = await pool.query(`SELECT id, nome, sigla FROM legislacao ORDER BY nome ASC`); return r.rows; }

  static async verificarAmostraExiste(id, database = pool) {
    const r = await database.query(
      `SELECT a.id, a.codigo_amostra, a.numero_da_amostra, a.matriz_id,
              m.nome AS matriz_nome
       FROM amostra a
       JOIN matriz m ON a.matriz_id = m.id
       WHERE a.id = $1`,
      [id]
    );
    return r.rows[0];
  }

  static async verificarParametroExiste(id, database = pool) {
    const r = await database.query(
      `SELECT p.id, p.legislacao_id, l.nome AS legislacao_nome,
              l.sigla AS legislacao_sigla
       FROM parametro p
       JOIN legislacao l ON p.legislacao_id = l.id
       WHERE p.id = $1`,
      [id]
    );
    return r.rows[0];
  }

  static async logOperation(op, data) {
    try {
      const logEntry = { timestamp: new Date().toISOString(), op, data };
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        console.log('[ResultadoAnalise]', JSON.stringify(logEntry));
      } else {
        const logDir = path.join(__dirname, '../logs');
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(path.join(logDir, 'resultado_analise.log'), JSON.stringify(logEntry) + '\n');
      }
    } catch (e) { console.error('Log error', e); }
  }
}

module.exports = ResultadoAnaliseModel;
