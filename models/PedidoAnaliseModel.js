const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const {
  PEDIDO_STATUS,
  assertPedidoTransition,
  parsePagination,
  requireComment,
  workflowError,
} = require('../utils/workflowPiloto');

function optionalText(value, max = 2_000) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max) throw workflowError(`Texto excede ${max} caracteres.`, 400, 'VALIDACAO');
  return normalized || null;
}

class PedidoAnaliseModel {
  static normalize(data, { creation = false } = {}) {
    const codigo = String(data.codigo ?? '').trim();
    if (!codigo || codigo.length > 50) throw workflowError('Informe um código de pedido válido.', 400, 'VALIDACAO');
    const clienteId = Number(data.cliente_id);
    if (!Number.isInteger(clienteId) || clienteId < 1) throw workflowError('Cliente inválido.', 400, 'VALIDACAO');
    const prioridade = String(data.prioridade ?? 'normal');
    if (!['normal', 'alta', 'urgente'].includes(prioridade)) throw workflowError('Prioridade inválida.', 400, 'VALIDACAO');
    const dataEntrada = data.data_entrada ? new Date(data.data_entrada) : new Date();
    const deadline = data.prazo ? new Date(data.prazo) : null;
    if (Number.isNaN(dataEntrada.getTime()) || (deadline && Number.isNaN(deadline.getTime()))) {
      throw workflowError('Data de entrada ou prazo inválido.', 400, 'VALIDACAO');
    }
    if (deadline && deadline < dataEntrada) throw workflowError('O prazo não pode ser anterior à entrada.', 400, 'VALIDACAO');
    let status = creation ? String(data.status ?? 'rascunho') : undefined;
    if (creation && !['rascunho', 'recebido'].includes(status)) {
      throw workflowError('Um pedido deve ser criado como rascunho ou recebido.', 400, 'VALIDACAO');
    }
    return {
      codigo,
      cliente_id: clienteId,
      solicitante: optionalText(data.solicitante, 200),
      descricao: optionalText(data.descricao),
      prioridade,
      data_entrada: dataEntrada.toISOString(),
      prazo: deadline?.toISOString() || null,
      status,
      observacoes: optionalText(data.observacoes),
    };
  }

  static async assertActiveClient(db, id) {
    const result = await db.query(
      `select 1 from cliente
       where id=$1 and ativo=true and deleted_at is null
       for share`,
      [id]
    );
    if (!result.rowCount) throw workflowError('Cliente não encontrado ou inativo.', 400, 'CLIENTE_INVALIDO');
  }

  static async create(data, audit = {}) {
    const value = this.normalize(data, { creation: true });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertActiveClient(client, value.cliente_id);
      const { rows } = await client.query(`
        insert into pedido_analise (
          codigo, cliente_id, solicitante, descricao, prioridade,
          data_entrada, prazo, status, observacoes, created_by,
          status_updated_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
        returning *
      `, [...Object.values(value), audit.actorUserId || null]);
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId, requestId: audit.requestId,
        action: 'CREATE', entityType: 'pedido_analise', entityId: rows[0].id,
        afterData: rows[0],
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw workflowError('Código de pedido já cadastrado.', 409, 'DUPLICADO');
      throw error;
    } finally { client.release(); }
  }

  static async update(id, data, audit = {}) {
    const value = this.normalize(data);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(
        'select * from pedido_analise where id=$1 and deleted_at is null for update',
        [id]
      );
      if (!before.rows[0]) throw workflowError('Pedido não encontrado.', 404, 'NAO_ENCONTRADO');
      if (['concluido', 'cancelado'].includes(before.rows[0].status)) {
        throw workflowError(`Pedido ${before.rows[0].status} não pode ser editado.`, 409, 'PEDIDO_BLOQUEADO');
      }
      if (Number(value.cliente_id) !== Number(before.rows[0].cliente_id)) {
        const samples = await client.query(
          'select exists(select 1 from amostra where pedido_analise_id=$1) as possui_amostra',
          [id]
        );
        if (samples.rows[0].possui_amostra) {
          throw workflowError(
            'O cliente do pedido não pode ser alterado após o vínculo da primeira amostra.',
            409,
            'CLIENTE_DO_PEDIDO_CONGELADO'
          );
        }
      }
      await this.assertActiveClient(client, value.cliente_id);
      const { rows } = await client.query(`
        update pedido_analise set codigo=$2, cliente_id=$3, solicitante=$4,
          descricao=$5, prioridade=$6, data_entrada=$7, prazo=$8, observacoes=$9
        where id=$1 and deleted_at is null returning *
      `, [
        id, value.codigo, value.cliente_id, value.solicitante, value.descricao,
        value.prioridade, value.data_entrada, value.prazo, value.observacoes,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId, requestId: audit.requestId,
        action: 'UPDATE', entityType: 'pedido_analise', entityId: id,
        beforeData: before.rows[0], afterData: rows[0],
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw workflowError('Código de pedido já cadastrado.', 409, 'DUPLICADO');
      throw error;
    } finally { client.release(); }
  }

  static async transitionStatus(id, nextStatus, comment, audit = {}) {
    if (!PEDIDO_STATUS.includes(nextStatus)) throw workflowError('Status de pedido inválido.', 400, 'STATUS_INVALIDO');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query(
        'select * from pedido_analise where id=$1 and deleted_at is null for update',
        [id]
      );
      const order = before.rows[0];
      if (!order) throw workflowError('Pedido não encontrado.', 404, 'NAO_ENCONTRADO');
      assertPedidoTransition(order.status, nextStatus);
      let normalizedComment = optionalText(comment);
      if (nextStatus === 'cancelado') normalizedComment = requireComment(comment, 'cancelar o pedido');
      if (nextStatus === 'cancelado') {
        const activeSamples = await client.query(`
          select count(*)::int as total
          from amostra
          where pedido_analise_id=$1 and deleted_at is null
            and status_amostra not in ('concluida','rejeitada','cancelada')
        `, [id]);
        if (activeSamples.rows[0].total > 0) {
          throw workflowError(
            'Cancele ou rejeite as amostras ativas antes de cancelar o pedido.',
            409,
            'AMOSTRAS_ATIVAS'
          );
        }
      }
      if (nextStatus === 'concluido') {
        const counts = await client.query(`
          select count(*)::int as total,
                 count(*) filter (where status_amostra='concluida')::int as concluidas
          from amostra where pedido_analise_id=$1 and deleted_at is null
        `, [id]);
        if (counts.rows[0].total === 0 || counts.rows[0].total !== counts.rows[0].concluidas) {
          throw workflowError('Conclua todas as amostras antes de concluir o pedido.', 409, 'AMOSTRAS_PENDENTES');
        }
      }
      const { rows } = await client.query(`
        update pedido_analise set status=$2, status_updated_at=timezone('utc',now()),
          status_updated_by=$3
        where id=$1 and deleted_at is null returning *
      `, [id, nextStatus, audit.actorUserId || null]);
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId, requestId: audit.requestId,
        action: 'STATUS_CHANGE', entityType: 'pedido_analise', entityId: id,
        beforeData: order, afterData: rows[0], metadata: { comentario: normalizedComment },
      });
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  static async findById(id) {
    const { rows } = await pool.query(`
      select pa.*, c.codigo as cliente_codigo, c.nome_razao_social as cliente_nome,
             c.nome_fantasia as cliente_nome_fantasia, c.documento as cliente_documento,
             count(a.id) filter (where a.deleted_at is null)::int as total_amostras,
             count(a.id) filter (where a.deleted_at is null and a.status_amostra='concluida')::int as amostras_concluidas
      from pedido_analise pa
      join cliente c on pa.cliente_id=c.id
      left join amostra a on a.pedido_analise_id=pa.id
      where pa.id=$1 and pa.deleted_at is null
      group by pa.id,c.id
    `, [id]);
    return rows[0] || null;
  }

  static async findAll(options = {}) {
    const pagination = parsePagination(options);
    const values = [];
    const filters = ['pa.deleted_at is null'];
    const add = (sql, value) => { values.push(value); filters.push(`${sql} $${values.length}`); };
    if (options.status) {
      if (!PEDIDO_STATUS.includes(options.status)) throw workflowError('Status de pedido inválido.', 400);
      add('pa.status =', options.status);
    }
    if (options.cliente_id) add('pa.cliente_id =', options.cliente_id);
    if (options.prioridade) add('pa.prioridade =', options.prioridade);
    if (options.q) {
      values.push(`%${String(options.q).trim().slice(0,100)}%`);
      filters.push(`(pa.codigo ilike $${values.length} or coalesce(pa.solicitante,'') ilike $${values.length}
        or c.nome_razao_social ilike $${values.length})`);
    }
    let limit='';
    if (pagination) { values.push(pagination.pageSize,pagination.offset); limit=`limit $${values.length-1} offset $${values.length}`; }
    const { rows } = await pool.query(`
      select pa.*, c.codigo as cliente_codigo, c.nome_razao_social as cliente_nome,
        count(a.id) filter (where a.deleted_at is null)::int as total_amostras,
        count(a.id) filter (where a.deleted_at is null and a.status_amostra='concluida')::int as amostras_concluidas,
        count(*) over()::int as total_count
      from pedido_analise pa join cliente c on pa.cliente_id=c.id
      left join amostra a on a.pedido_analise_id=pa.id
      where ${filters.join(' and ')}
      group by pa.id,c.id
      order by case pa.prioridade when 'urgente' then 1 when 'alta' then 2 else 3 end,
               pa.prazo nulls last, pa.created_at desc
      ${limit}
    `, values);
    const total=rows[0]?.total_count??0;
    const clean=rows.map(({total_count,...row})=>row);
    return pagination ? {rows:clean,total,...pagination}:clean;
  }

  static async archive(id, reason, audit = {}) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const before=await client.query('select * from pedido_analise where id=$1 and deleted_at is null for update',[id]);
      if(!before.rows[0]){await client.query('ROLLBACK');return false;}
      if(before.rows[0].status==='concluido') throw workflowError('Pedidos concluídos devem permanecer retidos.',409,'RETENCAO_OBRIGATORIA');
      const linkedSamples = await client.query(
        'select exists(select 1 from amostra where pedido_analise_id=$1) as possui_amostra',
        [id]
      );
      if (linkedSamples.rows[0].possui_amostra) {
        throw workflowError(
          'Pedidos que já receberam amostras devem permanecer disponíveis para rastreabilidade.',
          409,
          'RETENCAO_OBRIGATORIA'
        );
      }
      const {rows}=await client.query(`update pedido_analise set deleted_at=timezone('utc',now()),deleted_by=$2,deletion_reason=$3
        where id=$1 and deleted_at is null returning *`,[id,audit.actorUserId||null,optionalText(reason,500)||'Pedido arquivado']);
      await AuditLogModel.record(client,{actorUserId:audit.actorUserId,requestId:audit.requestId,action:'ARCHIVE',entityType:'pedido_analise',entityId:id,beforeData:before.rows[0],afterData:rows[0]});
      await client.query('COMMIT');return true;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}

module.exports = PedidoAnaliseModel;
