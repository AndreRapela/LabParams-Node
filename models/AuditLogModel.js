const pool = require('../config/database');

class AuditLogModel {
  static async record(db, entry) {
    const queryable = db || pool;
    const { rows } = await queryable.query(`
      insert into audit_log (
        actor_user_id, action, entity_type, entity_id,
        before_data, after_data, metadata, request_id
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
      returning id, occurred_at
    `, [
      entry.actorUserId || null,
      entry.action,
      entry.entityType,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      JSON.stringify(entry.beforeData ?? null),
      JSON.stringify(entry.afterData ?? null),
      JSON.stringify(entry.metadata ?? {}),
      entry.requestId || null,
    ]);
    return rows?.[0] ?? null;
  }

  static async findAll({ page = 1, pageSize = 50, entityType, actorUserId } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
    const values = [];
    const filters = [];
    const add = (clause, value) => {
      values.push(value);
      filters.push(`${clause} $${values.length}`);
    };
    if (entityType) add('al.entity_type =', entityType);
    if (actorUserId) add('al.actor_user_id =', actorUserId);
    const where = filters.length ? `where ${filters.join(' and ')}` : '';

    values.push(safePageSize, (safePage - 1) * safePageSize);
    const limitIndex = values.length - 1;
    const offsetIndex = values.length;
    const { rows } = await pool.query(`
      select
        al.id, al.occurred_at, al.action, al.entity_type, al.entity_id,
        al.before_data, al.after_data, al.metadata, al.request_id,
        u.nome as actor_name, u.email as actor_email
      from audit_log al
      left join usuario u on u.id = al.actor_user_id
      ${where}
      order by al.occurred_at desc
      limit $${limitIndex} offset $${offsetIndex}
    `, values);

    const countValues = values.slice(0, -2);
    const count = await pool.query(
      `select count(*)::int as total from audit_log al ${where}`,
      countValues
    );
    return { rows, total: count.rows[0].total, page: safePage, pageSize: safePageSize };
  }
}

module.exports = AuditLogModel;
