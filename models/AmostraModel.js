const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const {
  AMOSTRA_STATUS,
  assertAmostraTransition,
  optionalComment,
  parsePagination,
  requireComment,
  workflowError,
} = require('../utils/workflowPiloto');

const CUSTODY_TYPES = new Set([
  'recebimento',
  'aceite',
  'rejeicao',
  'movimentacao',
  'armazenamento',
  'retirada',
  'descarte',
  'status',
]);

class AmostraModel {
  static async create(dados, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const {
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        pedido_analise_id,
        parametros_ids,
      } = dados;

      if (!codigo_amostra || !numero_da_amostra || !data_coleta || !matriz_id || !usuario_id) {
        throw workflowError(
          'Todos os campos obrigatórios (incluindo usuário) devem ser preenchidos.',
          400,
          'VALIDACAO'
        );
      }
      const collectedAt = new Date(data_coleta);
      if (Number.isNaN(collectedAt.getTime()) || collectedAt > new Date()) {
        throw workflowError('A data da coleta é inválida ou futura.', 400, 'VALIDACAO');
      }
      if (String(codigo_amostra).trim().length > 100
          || String(numero_da_amostra).trim().length > 100) {
        throw workflowError('Código e número da amostra devem ter no máximo 100 caracteres.', 400, 'VALIDACAO');
      }
      if (!Number.isInteger(Number(matriz_id)) || Number(matriz_id) < 1) {
        throw workflowError('Matriz inválida.', 400, 'VALIDACAO');
      }
      if (!Array.isArray(parametros_ids)) {
        throw workflowError('Informe a lista de parâmetros da amostra.', 400, 'VALIDACAO');
      }

      const pedido = await this.assertPedidoReady(client, pedido_analise_id);
      const parametroIds = this.normalizarParametroIds(parametros_ids);
      if (!parametroIds.length) {
        throw workflowError('Selecione ao menos um parâmetro para a amostra.', 400, 'VALIDACAO');
      }
      await this.assertParametrosMatriz(client, parametroIds, matriz_id);

      const { rows } = await client.query(`
        insert into amostra (
          codigo_amostra, numero_da_amostra, data_coleta, localizacao,
          matriz_id, usuario_id, pedido_analise_id, status_amostra,
          status_atualizado_em, status_atualizado_por, local_atual
        ) values ($1, $2, $3, $4, $5, $6, $7, 'recebida',
                  timezone('utc', now()), $8, $4)
        returning *
      `, [
        String(codigo_amostra).trim(),
        String(numero_da_amostra).trim(),
        data_coleta,
        String(localizacao ?? '').trim() || null,
        matriz_id,
        usuario_id,
        pedido_analise_id || null,
        auditContext.actorUserId || null,
      ]);

      const novaAmostra = rows[0];
      if (parametroIds.length) {
        await client.query(`
          insert into amostra_parametro (amostra_id, parametro_id)
          select $1, unnest($2::int[])
        `, [novaAmostra.id, parametroIds]);
      }

      await client.query(`
        insert into amostra_custodia_evento (
          amostra_id, tipo_evento, status_novo, local_destino, observacao,
          actor_user_id, request_id
        ) values ($1, 'recebimento', 'recebida', $2, $3, $4, $5)
      `, [
        novaAmostra.id,
        novaAmostra.local_atual,
        optionalComment(auditContext.observation) || 'Amostra cadastrada e recebida.',
        auditContext.actorUserId || null,
        auditContext.requestId || null,
      ]);

      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'CREATE',
        entityType: 'amostra',
        entityId: novaAmostra.id,
        afterData: novaAmostra,
        metadata: { parametro_ids: parametroIds, evento_custodia: 'recebimento' },
      });
      await this.startPedidoIfNeeded(client, pedido, auditContext);
      await client.query('COMMIT');
      return { ...novaAmostra, parametros_ids: parametroIds };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        if (error.detail?.includes('codigo_amostra')) {
          throw workflowError(`O código "${dados.codigo_amostra}" já existe.`, 409, 'DUPLICADO');
        }
        if (error.detail?.includes('numero_da_amostra')) {
          throw workflowError(`O número "${dados.numero_da_amostra}" já existe.`, 409, 'DUPLICADO');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async update(id, dados, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const originalResult = await client.query(
        'select * from amostra where id = $1 and deleted_at is null for update',
        [id]
      );
      const original = originalResult.rows[0];
      if (!original) throw workflowError('Amostra não encontrada.', 404, 'NAO_ENCONTRADA');
      if (['concluida', 'rejeitada', 'cancelada'].includes(original.status_amostra)) {
        throw workflowError(
          `Amostras no estado "${original.status_amostra}" não podem ser editadas.`,
          409,
          'AMOSTRA_BLOQUEADA'
        );
      }
      if (!dados.codigo_amostra || !dados.numero_da_amostra || !dados.data_coleta
          || !dados.matriz_id || !dados.usuario_id || !Array.isArray(dados.parametros_ids)) {
        throw workflowError('Preencha todos os campos obrigatórios e informe os parâmetros.', 400, 'VALIDACAO');
      }
      const collectedAt = new Date(dados.data_coleta);
      if (Number.isNaN(collectedAt.getTime()) || collectedAt > new Date()) {
        throw workflowError('A data da coleta é inválida ou futura.', 400, 'VALIDACAO');
      }
      if (String(dados.codigo_amostra).trim().length > 100
          || String(dados.numero_da_amostra).trim().length > 100) {
        throw workflowError('Código e número da amostra devem ter no máximo 100 caracteres.', 400, 'VALIDACAO');
      }
      if (!Number.isInteger(Number(dados.matriz_id)) || Number(dados.matriz_id) < 1) {
        throw workflowError('Matriz inválida.', 400, 'VALIDACAO');
      }

      const resultCount = await client.query(`
        select count(*)::int as total
        from resultado_analise
        where amostra_id = $1 and deleted_at is null
      `, [id]);
      if (resultCount.rows[0].total > 0) {
        throw workflowError(
          'A identificação e o escopo da amostra ficam bloqueados após o primeiro resultado. Use a cadeia de custódia para registrar movimentações.',
          409,
          'RASTREABILIDADE_BLOQUEADA'
        );
      }

      const targetPedidoId = dados.pedido_analise_id === undefined
        ? original.pedido_analise_id
        : dados.pedido_analise_id;
      const pedido = await this.assertPedidoReady(client, targetPedidoId);
      const parametroIds = this.normalizarParametroIds(dados.parametros_ids);
      if (!parametroIds.length) {
        throw workflowError('Selecione ao menos um parâmetro para a amostra.', 400, 'VALIDACAO');
      }
      await this.assertParametrosMatriz(client, parametroIds, dados.matriz_id);

      const { rows } = await client.query(`
        update amostra set
          codigo_amostra = $1,
          numero_da_amostra = $2,
          data_coleta = $3,
          localizacao = $4,
          matriz_id = $5,
          usuario_id = $6,
          pedido_analise_id = $7
        where id = $8 and deleted_at is null
        returning *
      `, [
        String(dados.codigo_amostra ?? '').trim(),
        String(dados.numero_da_amostra ?? '').trim(),
        dados.data_coleta,
        String(dados.localizacao ?? '').trim() || null,
        dados.matriz_id,
        dados.usuario_id,
        targetPedidoId || null,
        id,
      ]);

      await client.query('delete from amostra_parametro where amostra_id = $1', [id]);
      if (parametroIds.length) {
        await client.query(`
          insert into amostra_parametro (amostra_id, parametro_id)
          select $1, unnest($2::int[])
        `, [id, parametroIds]);
      }

      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'UPDATE',
        entityType: 'amostra',
        entityId: id,
        beforeData: original,
        afterData: rows[0],
        metadata: { parametro_ids: parametroIds },
      });
      await this.startPedidoIfNeeded(client, pedido, auditContext);
      await client.query('COMMIT');
      return { ...rows[0], parametros_ids: parametroIds };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') {
        throw workflowError('Código ou número de amostra já utilizado.', 409, 'DUPLICADO');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async findById(id) {
    const { rows } = await pool.query(`
      select a.*, m.nome as matriz_nome, u.nome as usuario_nome, u.email as usuario_email,
             pa.codigo as pedido_codigo, pa.status as pedido_status,
             c.id as cliente_id, c.nome_razao_social as cliente_nome
      from amostra a
      join matriz m on a.matriz_id = m.id
      join usuario u on a.usuario_id = u.id
      left join pedido_analise pa on a.pedido_analise_id = pa.id
      left join cliente c on pa.cliente_id = c.id
      where a.id = $1 and a.deleted_at is null
    `, [id]);
    const amostra = rows[0];
    if (!amostra) return null;

    const parametros = await pool.query(`
      select p.id, p.nome, ap.metodo_analitico_id,
             ma.codigo as metodo_codigo, ma.nome as metodo_nome, ma.versao as metodo_versao
      from amostra_parametro ap
      join parametro p on ap.parametro_id = p.id
      left join metodo_analitico ma on ap.metodo_analitico_id = ma.id
      where ap.amostra_id = $1
      order by p.nome
    `, [id]);
    amostra.parametros_detalhes = parametros.rows;
    amostra.parametros_ids = parametros.rows.map((row) => row.id);
    return amostra;
  }

  static async findAll(options = {}) {
    const pagination = parsePagination(options);
    const values = [];
    const filters = ['a.deleted_at is null'];
    const add = (sql, value) => {
      values.push(value);
      filters.push(`${sql} $${values.length}`);
    };

    if (options.status) {
      if (!AMOSTRA_STATUS.includes(options.status)) {
        throw workflowError('Status de amostra inválido.', 400, 'FILTRO_INVALIDO');
      }
      add('a.status_amostra =', options.status);
    }
    if (options.matriz_id) add('a.matriz_id =', options.matriz_id);
    if (options.pedido_id) add('a.pedido_analise_id =', options.pedido_id);
    if (options.q) {
      values.push(`%${String(options.q).trim().slice(0, 100)}%`);
      filters.push(`(
        a.codigo_amostra ilike $${values.length}
        or a.numero_da_amostra ilike $${values.length}
        or coalesce(a.localizacao, '') ilike $${values.length}
        or coalesce(pa.codigo, '') ilike $${values.length}
        or coalesce(c.nome_razao_social, '') ilike $${values.length}
      )`);
    }

    let limit = '';
    if (pagination) {
      values.push(pagination.pageSize, pagination.offset);
      limit = `limit $${values.length - 1} offset $${values.length}`;
    }

    const { rows } = await pool.query(`
      select a.id, a.codigo_amostra, a.numero_da_amostra, a.data_coleta,
             a.localizacao, a.local_atual, a.status_amostra, a.status_atualizado_em,
             a.pedido_analise_id, a.created_at,
             m.nome as matriz_nome, u.nome as usuario_nome,
             pa.codigo as pedido_codigo, c.nome_razao_social as cliente_nome,
             count(ap.parametro_id)::int as qtd_parametros,
             count(*) over()::int as total_count
      from amostra a
      join matriz m on a.matriz_id = m.id
      join usuario u on a.usuario_id = u.id
      left join pedido_analise pa on a.pedido_analise_id = pa.id
      left join cliente c on pa.cliente_id = c.id
      left join amostra_parametro ap on ap.amostra_id = a.id
      where ${filters.join(' and ')}
      group by a.id, m.nome, u.nome, pa.codigo, c.nome_razao_social
      order by a.created_at desc
      ${limit}
    `, values);

    const total = rows[0]?.total_count ?? 0;
    const cleanRows = rows.map(({ total_count, ...row }) => row);
    return pagination
      ? { rows: cleanRows, total, page: pagination.page, pageSize: pagination.pageSize }
      : cleanRows;
  }

  static async delete(id, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const originalResult = await client.query(
        'select * from amostra where id = $1 and deleted_at is null for update',
        [id]
      );
      const original = originalResult.rows[0];
      if (!original) {
        await client.query('ROLLBACK');
        return false;
      }

      const protectedResults = await client.query(`
        select count(*)::int as total
        from resultado_analise
        where amostra_id = $1 and deleted_at is null
      `, [id]);
      if (protectedResults.rows[0].total > 0) {
        throw workflowError(
          'A amostra possui resultados e deve permanecer retida. Arquive os rascunhos individualmente ou cancele o fluxo.',
          409,
          'RETENCAO_OBRIGATORIA'
        );
      }

      const { rows } = await client.query(`
        update amostra set
          deleted_at = timezone('utc', now()),
          deleted_by = $2,
          deletion_reason = $3
        where id = $1 and deleted_at is null
        returning *
      `, [id, auditContext.actorUserId || null, auditContext.reason || 'Arquivada pela interface']);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'ARCHIVE',
        entityType: 'amostra',
        entityId: id,
        beforeData: original,
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

  static async transitionStatus(id, nextStatus, details = {}, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'select * from amostra where id = $1 and deleted_at is null for update',
        [id]
      );
      if (!rows[0]) throw workflowError('Amostra não encontrada.', 404, 'NAO_ENCONTRADA');

      if (nextStatus === 'concluida') {
        const resultStatus = await client.query(`
          select
            (select count(*)::int from amostra_parametro
             where amostra_id = $1) as esperados,
            (select count(*)::int from resultado_analise
             where amostra_id = $1 and deleted_at is null) as total,
            (select count(distinct parametro_id)::int from resultado_analise
             where amostra_id = $1 and deleted_at is null) as registrados,
            (select count(*)::int from resultado_analise
             where amostra_id = $1 and deleted_at is null
               and status_resultado = 'publicado') as publicados
        `, [id]);
        const counts = resultStatus.rows[0];
        const escopoCompleto = counts.esperados > 0
          && counts.total === counts.esperados
          && counts.registrados === counts.esperados
          && counts.publicados === counts.esperados;
        if (!escopoCompleto) {
          throw workflowError(
            'A amostra só pode ser concluída quando todos os resultados estiverem publicados.',
            409,
            'RESULTADOS_PENDENTES'
          );
        }
      }

      const updated = await this.applyStatusTransition(
        client,
        rows[0],
        nextStatus,
        details,
        auditContext
      );
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async applyStatusTransition(db, amostra, nextStatus, details = {}, auditContext = {}) {
    if (amostra.status_amostra === nextStatus) return amostra;
    assertAmostraTransition(amostra.status_amostra, nextStatus);
    const needsReason = ['rejeitada', 'cancelada'].includes(nextStatus);
    const comment = needsReason
      ? requireComment(details.motivo ?? details.observacao, `alterar a amostra para ${nextStatus}`)
      : optionalComment(details.motivo ?? details.observacao);
    const localDestino = String(details.local_destino ?? '').trim() || null;
    const eventType = nextStatus === 'rejeitada'
      ? 'rejeicao'
      : nextStatus === 'em_triagem' ? 'aceite' : 'status';

    const { rows } = await db.query(`
      update amostra set
        status_amostra = $2,
        status_atualizado_em = timezone('utc', now()),
        status_atualizado_por = $3,
        local_atual = coalesce($4, local_atual)
      where id = $1 and deleted_at is null
      returning *
    `, [amostra.id, nextStatus, auditContext.actorUserId || null, localDestino]);

    const event = await db.query(`
      insert into amostra_custodia_evento (
        amostra_id, tipo_evento, status_anterior, status_novo,
        local_origem, local_destino, observacao, actor_user_id, request_id
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *
    `, [
      amostra.id,
      eventType,
      amostra.status_amostra,
      nextStatus,
      amostra.local_atual,
      localDestino || amostra.local_atual,
      comment,
      auditContext.actorUserId || null,
      auditContext.requestId || null,
    ]);

    await AuditLogModel.record(db, {
      actorUserId: auditContext.actorUserId,
      requestId: auditContext.requestId,
      action: 'STATUS_CHANGE',
      entityType: 'amostra',
      entityId: amostra.id,
      beforeData: amostra,
      afterData: rows[0],
      metadata: { custodia_evento_id: event.rows[0].id, automatico: Boolean(details.automatico) },
    });
    return rows[0];
  }

  static async addCustodyEvent(id, details = {}, auditContext = {}) {
    const type = String(details.tipo_evento ?? '').trim();
    if (!CUSTODY_TYPES.has(type)) {
      throw workflowError('Tipo de evento de custódia inválido.', 400, 'EVENTO_INVALIDO');
    }
    if (type === 'status') {
      return this.transitionStatus(id, details.status_novo, details, auditContext);
    }

    if (type === 'aceite') {
      if (details.ocorrido_em) {
        throw workflowError(
          'Mudanças de estado são registradas no horário atual e não aceitam retrodatação.',
          400,
          'RETRODATA_STATUS_NAO_PERMITIDA'
        );
      }
      return this.transitionStatus(id, 'em_triagem', details, auditContext);
    }
    if (type === 'rejeicao') {
      if (details.ocorrido_em) {
        throw workflowError(
          'Mudanças de estado são registradas no horário atual e não aceitam retrodatação.',
          400,
          'RETRODATA_STATUS_NAO_PERMITIDA'
        );
      }
      return this.transitionStatus(id, 'rejeitada', {
        ...details,
        motivo: details.motivo ?? details.observacao,
      }, auditContext);
    }
    if (type === 'recebimento') {
      throw workflowError(
        'O recebimento é criado automaticamente no cadastro da amostra e não pode ser duplicado.',
        409,
        'RECEBIMENTO_DUPLICADO'
      );
    }

    const occurredAt = details.ocorrido_em ? new Date(details.ocorrido_em) : new Date();
    if (Number.isNaN(occurredAt.getTime()) || occurredAt > new Date(Date.now() + 5 * 60_000)) {
      throw workflowError('Data do evento de custódia inválida.', 400, 'DATA_INVALIDA');
    }
    const configuredBackdateHours = Number(process.env.CUSTODY_MAX_BACKDATE_HOURS ?? 24);
    const backdateHours = Number.isFinite(configuredBackdateHours)
      ? Math.min(168, Math.max(0, configuredBackdateHours))
      : 24;
    if (occurredAt < new Date(Date.now() - backdateHours * 60 * 60_000)) {
      throw workflowError(
        `O evento não pode ser retrodatado em mais de ${backdateHours} hora(s).`,
        409,
        'RETRODATA_EXCEDIDA'
      );
    }
    const destination = String(details.local_destino ?? '').trim() || null;
    if (['movimentacao', 'armazenamento', 'retirada', 'descarte'].includes(type) && !destination) {
      throw workflowError('Informe o local de destino.', 400, 'LOCAL_OBRIGATORIO');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'select * from amostra where id = $1 and deleted_at is null for update',
        [id]
      );
      const amostra = rows[0];
      if (!amostra) throw workflowError('Amostra não encontrada.', 404, 'NAO_ENCONTRADA');

      const latest = await client.query(`
        select max(ocorrido_em) as ultimo_evento,
               coalesce(bool_or(tipo_evento = 'descarte'), false) as descartada
        from amostra_custodia_evento
        where amostra_id = $1
      `, [id]);
      if (latest.rows[0]?.descartada) {
        throw workflowError(
          'A amostra já foi descartada e não aceita novos eventos de movimentação.',
          409,
          'AMOSTRA_DESCARTADA'
        );
      }

      if (type === 'descarte' && !['concluida', 'rejeitada', 'cancelada'].includes(amostra.status_amostra)) {
        throw workflowError(
          'Uma amostra em processamento não pode ser descartada.',
          409,
          'DESCARTE_PREMATURO'
        );
      }

      const currentLocation = String(amostra.local_atual ?? '').trim() || null;
      const providedOrigin = String(details.local_origem ?? '').trim() || null;
      if (providedOrigin && currentLocation
          && providedOrigin.localeCompare(currentLocation, 'pt-BR', { sensitivity: 'base' }) !== 0) {
        throw workflowError(
          `A origem informada não corresponde ao local atual da amostra (${currentLocation}).`,
          409,
          'ORIGEM_DIVERGENTE'
        );
      }
      const origin = providedOrigin || currentLocation;
      if (!origin) {
        throw workflowError(
          'Defina o local atual da amostra antes de registrar movimentações.',
          409,
          'ORIGEM_DESCONHECIDA'
        );
      }
      if (['movimentacao', 'retirada', 'descarte'].includes(type)
          && destination.localeCompare(origin, 'pt-BR', { sensitivity: 'base' }) === 0) {
        throw workflowError('Origem e destino devem ser diferentes.', 400, 'DESTINO_IGUAL_ORIGEM');
      }

      const lastEventAt = latest.rows[0]?.ultimo_evento
        ? new Date(latest.rows[0].ultimo_evento)
        : new Date(amostra.created_at);
      if (occurredAt < lastEventAt) {
        throw workflowError(
          'O evento não pode ser anterior ao último registro da cadeia de custódia.',
          409,
          'ORDEM_CRONOLOGICA_INVALIDA'
        );
      }
      if (occurredAt < new Date(amostra.created_at)) {
        throw workflowError(
          'O evento não pode ser anterior ao cadastro da amostra.',
          409,
          'EVENTO_ANTERIOR_AMOSTRA'
        );
      }

      const observation = type === 'descarte'
        ? requireComment(details.observacao, 'registrar o descarte')
        : optionalComment(details.observacao);

      const event = await client.query(`
        insert into amostra_custodia_evento (
          amostra_id, tipo_evento, status_anterior, status_novo,
          local_origem, local_destino, observacao, ocorrido_em,
          actor_user_id, request_id
        ) values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)
        returning *
      `, [
        id,
        type,
        amostra.status_amostra,
        origin,
        destination,
        observation,
        occurredAt.toISOString(),
        auditContext.actorUserId || null,
        auditContext.requestId || null,
      ]);

      let updatedSample = amostra;
      if (destination) {
        const updated = await client.query(
          'update amostra set local_atual = $2 where id = $1 returning *',
          [id, destination]
        );
        updatedSample = updated.rows[0];
      }
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'CUSTODY_EVENT',
        entityType: 'amostra',
        entityId: id,
        beforeData: amostra,
        afterData: updatedSample,
        metadata: { custodia_evento: event.rows[0] },
      });
      await client.query('COMMIT');
      return { amostra: updatedSample, evento: event.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async findCustodyEvents(id, query = {}) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.page_size ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw workflowError('Paginação inválida.', 400, 'PAGINACAO_INVALIDA');
    }
    const exists = await pool.query(
      'select 1 from amostra where id = $1 and deleted_at is null',
      [id]
    );
    if (!exists.rowCount) throw workflowError('Amostra não encontrada.', 404, 'NAO_ENCONTRADA');

    const { rows } = await pool.query(`
      select e.*, u.nome as actor_name, u.email as actor_email,
             count(*) over()::int as total_count
      from amostra_custodia_evento e
      left join usuario u on e.actor_user_id = u.id
      where e.amostra_id = $1
      order by e.ocorrido_em desc, e.id desc
      limit $2 offset $3
    `, [id, pageSize, (page - 1) * pageSize]);
    const total = rows[0]?.total_count ?? 0;
    return {
      rows: rows.map(({ total_count, ...row }) => row),
      total,
      page,
      pageSize,
    };
  }

  static async findMatrizesDropdown() {
    const { rows } = await pool.query('select id, nome from matriz order by nome asc');
    return rows;
  }

  static async findUsuariosDropdown() {
    const { rows } = await pool.query('select id, nome from usuario order by nome asc');
    return rows;
  }

  static normalizarParametroIds(ids) {
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  }

  static async assertParametrosMatriz(db, parametroIds, matrizId) {
    if (!parametroIds.length) return;
    const { rows } = await db.query(`
      select count(*)::int as total
      from parametro
      where id = any($1::int[]) and matriz_id = $2 and ativo = true
    `, [parametroIds, matrizId]);
    if (rows[0].total !== parametroIds.length) {
      throw workflowError(
        'Um ou mais parâmetros não pertencem à matriz da amostra ou estão inativos.',
        400,
        'PARAMETROS_INVALIDOS'
      );
    }
  }

  static async assertPedidoReady(db, pedidoId) {
    if (!pedidoId) return null;
    const { rows } = await db.query(
      'select * from pedido_analise where id=$1 and deleted_at is null for update',
      [pedidoId]
    );
    const pedido = rows[0];
    if (!pedido) throw workflowError('Pedido de análise não encontrado.', 400, 'PEDIDO_INVALIDO');
    if (pedido.status === 'rascunho') {
      throw workflowError('Receba o pedido antes de vincular amostras.', 409, 'PEDIDO_NAO_RECEBIDO');
    }
    if (['concluido', 'cancelado'].includes(pedido.status)) {
      throw workflowError(`Não é possível vincular amostras a pedido ${pedido.status}.`, 409, 'PEDIDO_BLOQUEADO');
    }
    return pedido;
  }

  static async startPedidoIfNeeded(db, pedido, auditContext = {}) {
    if (!pedido || pedido.status !== 'recebido') return pedido;
    const { rows } = await db.query(`
      update pedido_analise set status='em_execucao',
        status_updated_at=timezone('utc',now()), status_updated_by=$2
      where id=$1 and status='recebido' returning *
    `, [pedido.id, auditContext.actorUserId || null]);
    if (!rows[0]) return pedido;
    await AuditLogModel.record(db, {
      actorUserId: auditContext.actorUserId,
      requestId: auditContext.requestId,
      action: 'STATUS_CHANGE',
      entityType: 'pedido_analise',
      entityId: pedido.id,
      beforeData: pedido,
      afterData: rows[0],
      metadata: { automatico: true, motivo: 'Primeira amostra vinculada ao pedido.' },
    });
    return rows[0];
  }
}

module.exports = AmostraModel;
