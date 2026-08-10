const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const { parsePagination, workflowError } = require('../utils/workflowPiloto');

function text(value, field, { required = false, max = 500 } = {}) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) throw workflowError(`${field} é obrigatório.`, 400, 'VALIDACAO');
  if (normalized.length > max) throw workflowError(`${field} excede ${max} caracteres.`, 400, 'VALIDACAO');
  return normalized || null;
}

class ClienteModel {
  static parseBoolean(value, { defaultValue, field = 'ativo', allowString = false } = {}) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    if (allowString && (value === 'true' || value === 'false')) return value === 'true';
    throw workflowError(`${field} deve ser booleano (true ou false).`, 400, 'BOOLEANO_INVALIDO');
  }

  static normalize(data, { defaultAtivo = true } = {}) {
    const email = text(data.email, 'E-mail', { max: 254 });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      throw workflowError('E-mail inválido.', 400, 'VALIDACAO');
    }
    return {
      codigo: text(data.codigo, 'Código', { required: true, max: 50 }),
      nome_razao_social: text(data.nome_razao_social, 'Nome/Razão social', { required: true, max: 200 }),
      nome_fantasia: text(data.nome_fantasia, 'Nome fantasia', { max: 200 }),
      documento: text(data.documento, 'Documento', { max: 30 }),
      email: email?.toLowerCase() || null,
      telefone: text(data.telefone, 'Telefone', { max: 40 }),
      endereco: text(data.endereco, 'Endereço', { max: 1_000 }),
      observacoes: text(data.observacoes, 'Observações', { max: 2_000 }),
      ativo: this.parseBoolean(data.ativo, { defaultValue: defaultAtivo }),
    };
  }

  static async create(data, audit = {}) {
    const value = this.normalize(data);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`
        insert into cliente (
          codigo, nome_razao_social, nome_fantasia, documento, email,
          telefone, endereco, observacoes, ativo
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        returning *
      `, Object.values(value));
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId,
        requestId: audit.requestId,
        action: 'CREATE',
        entityType: 'cliente',
        entityId: rows[0].id,
        afterData: rows[0],
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        throw workflowError('Código ou documento já cadastrado para outro cliente.', 409, 'DUPLICADO');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async update(id, data, audit = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(
        'select * from cliente where id = $1 and deleted_at is null for update',
        [id]
      );
      if (!before.rows[0]) throw workflowError('Cliente não encontrado.', 404, 'NAO_ENCONTRADO');
      const value = this.normalize(data, { defaultAtivo: before.rows[0].ativo });
      if (before.rows[0].ativo && !value.ativo) {
        await this.assertNoActiveOrders(client, id);
      }
      const { rows } = await client.query(`
        update cliente set
          codigo=$2, nome_razao_social=$3, nome_fantasia=$4, documento=$5,
          email=$6, telefone=$7, endereco=$8, observacoes=$9, ativo=$10
        where id=$1 and deleted_at is null
        returning *
      `, [id, ...Object.values(value)]);
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId,
        requestId: audit.requestId,
        action: 'UPDATE',
        entityType: 'cliente',
        entityId: id,
        beforeData: before.rows[0],
        afterData: rows[0],
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        throw workflowError('Código ou documento já cadastrado para outro cliente.', 409, 'DUPLICADO');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async findById(id) {
    const { rows } = await pool.query(`
      select c.*,
             count(pa.id) filter (where pa.deleted_at is null)::int as total_pedidos
      from cliente c
      left join pedido_analise pa on pa.cliente_id = c.id
      where c.id = $1 and c.deleted_at is null
      group by c.id
    `, [id]);
    return rows[0] || null;
  }

  static async findAll(options = {}) {
    const pagination = parsePagination(options);
    const values = [];
    const filters = ['c.deleted_at is null'];
    if (options.ativo !== undefined && options.ativo !== '') {
      values.push(this.parseBoolean(options.ativo, {
        field: 'Filtro ativo',
        allowString: true,
      }));
      filters.push(`c.ativo = $${values.length}`);
    }
    if (options.q) {
      values.push(`%${String(options.q).trim().slice(0, 100)}%`);
      filters.push(`(c.codigo ilike $${values.length} or c.nome_razao_social ilike $${values.length}
        or coalesce(c.nome_fantasia,'') ilike $${values.length}
        or coalesce(c.documento,'') ilike $${values.length})`);
    }
    let limit = '';
    if (pagination) {
      values.push(pagination.pageSize, pagination.offset);
      limit = `limit $${values.length - 1} offset $${values.length}`;
    }
    const { rows } = await pool.query(`
      select c.*, count(pa.id) filter (where pa.deleted_at is null)::int as total_pedidos,
             count(*) over()::int as total_count
      from cliente c
      left join pedido_analise pa on pa.cliente_id = c.id
      where ${filters.join(' and ')}
      group by c.id
      order by c.nome_razao_social, c.codigo
      ${limit}
    `, values);
    const total = rows[0]?.total_count ?? 0;
    const clean = rows.map(({ total_count, ...row }) => row);
    return pagination ? { rows: clean, total, ...pagination } : clean;
  }

  static async archive(id, reason, audit = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(
        'select * from cliente where id=$1 and deleted_at is null for update',
        [id]
      );
      if (!before.rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      await this.assertNoActiveOrders(client, id);
      const { rows } = await client.query(`
        update cliente set ativo=false, deleted_at=timezone('utc',now()),
          deleted_by=$2, deletion_reason=$3
        where id=$1 and deleted_at is null returning *
      `, [id, audit.actorUserId || null, text(reason, 'Motivo', { max: 500 }) || 'Cliente arquivado']);
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId,
        requestId: audit.requestId,
        action: 'ARCHIVE',
        entityType: 'cliente',
        entityId: id,
        beforeData: before.rows[0],
        afterData: rows[0],
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async assertNoActiveOrders(db, id) {
    const { rows } = await db.query(`
      select count(*)::int as total
      from pedido_analise
      where cliente_id = $1 and deleted_at is null
        and status not in ('concluido', 'cancelado')
    `, [id]);
    if (rows[0].total > 0) {
      throw workflowError(
        'O cliente possui pedidos ativos e não pode ser desativado ou arquivado.',
        409,
        'CLIENTE_COM_PEDIDOS_ATIVOS'
      );
    }
  }
}

module.exports = ClienteModel;
