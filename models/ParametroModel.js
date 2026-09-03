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
      const error = new Error('Valor atual inválido');
      error.statusCode = 400;
      error.code = 'INVALID_PARAMETER_VALUE';
      throw error;
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

  static async findAllGerenciamento(options = {}) {
    const page = Number(options.page ?? 1);
    const pageSize = Number(options.pageSize ?? 30);
    const offset = Number(options.offset ?? ((page - 1) * pageSize));
    const values = [];
    const filters = [];

    if (options.matriz_id) {
      values.push(options.matriz_id);
      filters.push(`p.matriz_id = $${values.length}`);
    }
    if (options.legislacao_id) {
      values.push(options.legislacao_id);
      filters.push(`p.legislacao_id = $${values.length}`);
    }
    if (options.q) {
      const normalizedSearch = String(options.q)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      values.push(`%${normalizedSearch}%`);
      const accentSource = 'áàãâäéèêëíìîïóòõôöúùûüç';
      const accentTarget = 'aaaaaeeeeiiiiooooouuuuc';
      filters.push(`translate(lower(concat_ws(' ',
        p.nome, p.categoria, m.nome, l.nome, l.sigla, lc.nome, lc.codigo
      )), '${accentSource}', '${accentTarget}') like $${values.length}`);
    }

    const extraWhere = filters.length ? ` and ${filters.join(' and ')}` : '';
    const countValues = [...values];
    values.push(pageSize, offset);
    const [countResult, pageResult] = await Promise.all([
      pool.query(`
        select count(*)::int as total
        from parametro p
        join matriz m on p.matriz_id = m.id
        join legislacao l on p.legislacao_id = l.id
        join legislacao_contexto lc on p.contexto_legislacao_id = lc.id
        where p.ativo = true and lc.ativo = true${extraWhere}
      `, countValues),
      pool.query(`${SELECT_CATALOGO}${extraWhere}
        order by l.sigla, lc.ordem, p.categoria, p.nome, p.id
        limit $${values.length - 1} offset $${values.length}
      `, values),
    ]);

    return {
      rows: pageResult.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      pageSize,
    };
  }

  static async updateGerenciamento(id, dados, auditContext = {}) {
    return this.update(id, dados, auditContext);
  }
}

module.exports = ParametroModel;
