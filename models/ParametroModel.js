const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');

const SELECT_CATALOGO = `
  select
    p.id, p.nome, p.unidade_medida, p.valor_parametro,
    p.limite_minimo, p.limite_maximo, p.categoria,
    p.tipo_resultado, p.tipo_limite, p.criterio_texto,
    p.fonte_referencia, p.contexto_legislacao_id,
    p.legislacao_id, p.matriz_id, p.created_at,
    m.nome as matriz_nome,
    l.sigla as legislacao_sigla,
    l.nome as legislacao_nome,
    lc.nome as contexto_nome,
    lc.codigo as contexto_codigo
  from parametro p
  join matriz m on p.matriz_id = m.id
  join legislacao l on p.legislacao_id = l.id
  join legislacao_contexto lc on p.contexto_legislacao_id = lc.id
  where p.ativo = true and lc.ativo = true
`;

class ParametroModel {
  static async findAll() {
    const result = await pool.query(`${SELECT_CATALOGO}
      order by l.sigla, lc.ordem, p.categoria, p.nome
    `);
    return result.rows;
  }

  static async update(id, dados, auditContext = {}) {
    const valor = dados.valor_parametro === null || dados.valor_parametro === ''
      ? null
      : Number(dados.valor_parametro);
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) {
      throw new Error('Valor atual inválido');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const originalResult = await client.query(
        'select * from parametro where id = $1 and ativo = true for update',
        [id]
      );
      const original = originalResult.rows[0];
      if (!original) {
        await client.query('ROLLBACK');
        return undefined;
      }
      const result = await client.query(`
        update parametro
        set valor_parametro = $1
        where id = $2 and ativo = true
        returning *
      `, [valor, id]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'UPDATE',
        entityType: 'parametro',
        entityId: id,
        beforeData: original,
        afterData: result.rows[0],
      });
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async findAllGerenciamento() {
    const result = await pool.query(`${SELECT_CATALOGO}
      order by l.sigla, lc.ordem, p.categoria, p.nome
    `);
    return result.rows;
  }

  static async updateGerenciamento(id, dados, auditContext = {}) {
    return this.update(id, dados, auditContext);
  }
}

module.exports = ParametroModel;
