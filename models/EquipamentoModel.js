const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const DomainError = require('./DomainError');

const TIPOS_EVENTO = ['CALIBRACAO', 'MANUTENCAO_PREVENTIVA', 'MANUTENCAO_CORRETIVA'];
const STATUS_EQUIPAMENTO = ['ATIVO', 'MANUTENCAO', 'FORA_DE_USO'];
const CRITICIDADES = ['BAIXA', 'MEDIA', 'ALTA'];

function texto(valor, campo, min = 1, max = 1000) {
  const normalizado = typeof valor === 'string' ? valor.trim() : '';
  if (normalizado.length < min || normalizado.length > max) {
    throw new DomainError(`${campo} deve ter entre ${min} e ${max} caracteres.`);
  }
  return normalizado;
}

function dataValida(valor, campo, obrigatoria = false) {
  if (!valor) {
    if (obrigatoria) throw new DomainError(`${campo} é obrigatória.`);
    return null;
  }
  const value = String(valor).slice(0, 10);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError(`${campo} inválida.`);
  }
  return value;
}

function instanteValido(valor, campo) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw new DomainError(`${campo} inválido.`);
  if (data.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new DomainError(`${campo} não pode estar no futuro.`);
  }
  return data.toISOString();
}

function paginacao(page, pageSize) {
  const pagina = Math.max(1, Number.parseInt(page, 10) || 1);
  const tamanho = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  return { page: pagina, pageSize: tamanho, offset: (pagina - 1) * tamanho };
}

function booleano(valor, campo) {
  if (typeof valor === 'boolean') return valor;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  throw new DomainError(`${campo} deve ser verdadeiro ou falso.`);
}

class EquipamentoModel {
  static avaliarDisponibilidade(equipamento, hoje = new Date()) {
    if (!equipamento || equipamento.deleted_at) {
      return { disponivel: false, status: 'ARQUIVADO', motivo: 'Equipamento arquivado.' };
    }
    if (equipamento.status === 'FORA_DE_USO') {
      return { disponivel: false, status: 'BLOQUEADO_FORA_DE_USO', motivo: 'Equipamento marcado como fora de uso.' };
    }
    if (equipamento.status === 'MANUTENCAO' || equipamento.manutencao_em_andamento) {
      return { disponivel: false, status: 'BLOQUEADO_MANUTENCAO', motivo: 'Existe manutenção em andamento.' };
    }
    if (equipamento.evento_em_andamento) {
      return { disponivel: false, status: 'BLOQUEADO_INTERVENCAO', motivo: 'Existe uma intervenção em andamento.' };
    }
    if (equipamento.requer_calibracao) {
      if (!equipamento.proxima_calibracao) {
        return { disponivel: false, status: 'BLOQUEADO_SEM_CALIBRACAO', motivo: 'Calibração válida não registrada.' };
      }
      const limite = new Date(`${String(equipamento.proxima_calibracao).slice(0, 10)}T23:59:59.999Z`);
      if (limite < hoje) {
        return { disponivel: false, status: 'BLOQUEADO_CALIBRACAO_VENCIDA', motivo: 'Calibração vencida.' };
      }
    }
    return { disponivel: true, status: 'DISPONIVEL', motivo: null };
  }

  static apresentarDisponibilidade(equipamento, hoje = new Date()) {
    const avaliacao = this.avaliarDisponibilidade(equipamento, hoje);
    return {
      ...equipamento,
      disponivel: avaliacao.disponivel,
      status_operacional: avaliacao.status,
      motivo_indisponibilidade: avaliacao.motivo,
    };
  }

  static async getResumo() {
    const { rows } = await pool.query(`
      select
        count(*)::int as total_equipamentos,
        count(*) filter (where
          e.status <> 'ATIVO'
          or exists (select 1 from equipamento_evento ev
            where ev.equipamento_id = e.id and ev.status = 'EM_ANDAMENTO')
          or (e.requer_calibracao and (e.proxima_calibracao is null or e.proxima_calibracao < current_date))
        )::int as bloqueados,
        count(*) filter (where e.requer_calibracao and e.proxima_calibracao < current_date)::int
          as calibracoes_vencidas,
        count(*) filter (where e.requer_calibracao
          and e.proxima_calibracao between current_date and current_date + 30)::int
          as calibracoes_vencendo_30_dias,
        (select count(*)::int from equipamento_evento ev
          join equipamento eq on eq.id = ev.equipamento_id
          where eq.deleted_at is null and ev.status = 'EM_ANDAMENTO'
            and ev.tipo in ('MANUTENCAO_PREVENTIVA', 'MANUTENCAO_CORRETIVA')
        ) as manutencoes_em_andamento
      from equipamento e where e.deleted_at is null`);
    return rows[0];
  }

  static async findAll({ page, pageSize, search, somenteBloqueados = false } = {}) {
    const pg = paginacao(page, pageSize);
    const values = [];
    const filters = ['e.deleted_at is null'];
    if (search) {
      values.push(`%${String(search).trim()}%`);
      filters.push(`(e.codigo ilike $${values.length} or e.nome ilike $${values.length} or e.numero_serie ilike $${values.length})`);
    }
    const availability = `
      case
        when e.status = 'FORA_DE_USO' then 'BLOQUEADO_FORA_DE_USO'
        when e.status = 'MANUTENCAO' then 'BLOQUEADO_MANUTENCAO'
        when exists (
          select 1 from equipamento_evento ev
          where ev.equipamento_id = e.id and ev.status = 'EM_ANDAMENTO'
        ) then 'BLOQUEADO_INTERVENCAO'
        when e.requer_calibracao and e.proxima_calibracao is null then 'BLOQUEADO_SEM_CALIBRACAO'
        when e.requer_calibracao and e.proxima_calibracao < current_date then 'BLOQUEADO_CALIBRACAO_VENCIDA'
        else 'DISPONIVEL'
      end`;
    if (String(somenteBloqueados) === 'true') filters.push(`(${availability}) <> 'DISPONIVEL'`);
    const where = filters.join(' and ');
    const count = await pool.query(`select count(*)::int as total from equipamento e where ${where}`, values);
    values.push(pg.pageSize, pg.offset);
    const { rows } = await pool.query(`
      select e.*, (${availability}) as status_operacional,
        case when e.proxima_calibracao is null then null
          else e.proxima_calibracao - current_date end as dias_para_calibracao
      from equipamento e
      where ${where}
      order by
        case when (${availability}) = 'DISPONIVEL' then 1 else 0 end,
        e.proxima_calibracao nulls first, e.nome
      limit $${values.length - 1} offset $${values.length}`, values);
    return { rows, total: count.rows[0].total, page: pg.page, pageSize: pg.pageSize };
  }

  static async findById(id) {
    const result = await pool.query(`
      select e.*,
        exists (
          select 1 from equipamento_evento ev
          where ev.equipamento_id = e.id and ev.status = 'EM_ANDAMENTO'
        ) as evento_em_andamento,
        exists (
          select 1 from equipamento_evento ev
          where ev.equipamento_id = e.id and ev.status = 'EM_ANDAMENTO'
            and ev.tipo in ('MANUTENCAO_PREVENTIVA', 'MANUTENCAO_CORRETIVA')
        ) as manutencao_em_andamento
      from equipamento e where e.id = $1 and e.deleted_at is null`, [id]);
    const equipamento = result.rows[0];
    if (!equipamento) return null;
    return this.apresentarDisponibilidade(equipamento);
  }

  static async create(dados, auditContext = {}) {
    const codigo = texto(dados.codigo, 'Código', 1, 80);
    const nome = texto(dados.nome, 'Nome', 1, 200);
    const criticidade = String(dados.criticidade || 'MEDIA').toUpperCase();
    if (!CRITICIDADES.includes(criticidade)) throw new DomainError('Criticidade inválida.');
    const requerCalibracao = dados.requer_calibracao === undefined
      ? true : booleano(dados.requer_calibracao, 'requer_calibracao');
    const frequencia = dados.frequencia_calibracao_dias == null
      ? null : Number.parseInt(dados.frequencia_calibracao_dias, 10);
    if (frequencia !== null && (!Number.isInteger(frequencia) || frequencia <= 0 || frequencia > 36500)) {
      throw new DomainError('A frequência de calibração deve estar entre 1 e 36500 dias.');
    }
    const ultima = dataValida(dados.ultima_calibracao, 'Última calibração');
    const proxima = dataValida(dados.proxima_calibracao, 'Próxima calibração');
    if (ultima && proxima && ultima > proxima) {
      throw new DomainError('A próxima calibração não pode ser anterior à última calibração.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(`
        insert into equipamento (
          codigo, nome, fabricante, modelo, numero_serie, localizacao,
          criticidade, requer_calibracao, frequencia_calibracao_dias,
          ultima_calibracao, proxima_calibracao
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning *`, [
        codigo, nome, dados.fabricante?.trim() || null, dados.modelo?.trim() || null,
        dados.numero_serie?.trim() || null, dados.localizacao?.trim() || null,
        criticidade, requerCalibracao, frequencia, ultima, proxima,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'equipamento', entityId: result.rows[0].id,
        afterData: result.rows[0],
      });
      await client.query('commit');
      return this.apresentarDisponibilidade(result.rows[0]);
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23505') throw DomainError.conflict('Já existe um equipamento ativo com este código.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async update(id, dados, auditContext = {}) {
    if (dados.status !== undefined) {
      throw new DomainError('Use o endpoint de decisão de status para alterar o estado do equipamento.');
    }
    if (dados.requer_calibracao !== undefined || dados.frequencia_calibracao_dias !== undefined) {
      throw new DomainError('Use o endpoint de configuração de calibração para alterar esses campos.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Equipamento não encontrado.');
      const criticidade = String(dados.criticidade ?? before.criticidade).toUpperCase();
      if (!CRITICIDADES.includes(criticidade)) throw new DomainError('Criticidade inválida.');
      const result = await client.query(`
        update equipamento set
          codigo = $2, nome = $3, fabricante = $4, modelo = $5,
          numero_serie = $6, localizacao = $7, criticidade = $8,
          requer_calibracao = $9, frequencia_calibracao_dias = $10
        where id = $1 and deleted_at is null returning *`, [
        id,
        dados.codigo === undefined ? before.codigo : texto(dados.codigo, 'Código', 1, 80),
        dados.nome === undefined ? before.nome : texto(dados.nome, 'Nome', 1, 200),
        dados.fabricante === undefined ? before.fabricante : dados.fabricante?.trim() || null,
        dados.modelo === undefined ? before.modelo : dados.modelo?.trim() || null,
        dados.numero_serie === undefined ? before.numero_serie : dados.numero_serie?.trim() || null,
        dados.localizacao === undefined ? before.localizacao : dados.localizacao?.trim() || null,
        criticidade,
        before.requer_calibracao,
        before.frequencia_calibracao_dias,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento', entityId: id,
        beforeData: before, afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23505') throw DomainError.conflict('Já existe um equipamento ativo com este código.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async configurarCalibracao(id, dados, auditContext = {}) {
    if (typeof dados.requer_calibracao !== 'boolean') {
      throw new DomainError('requer_calibracao deve ser verdadeiro ou falso.');
    }
    const frequencia = dados.frequencia_calibracao_dias == null
      ? null : Number.parseInt(dados.frequencia_calibracao_dias, 10);
    if (frequencia !== null &&
        (!Number.isInteger(frequencia) || frequencia <= 0 || frequencia > 36500)) {
      throw new DomainError('A frequência de calibração deve estar entre 1 e 36500 dias.');
    }
    const motivo = texto(dados.motivo, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Equipamento não encontrado.');
      const result = await client.query(`
        update equipamento set requer_calibracao = $2, frequencia_calibracao_dias = $3
        where id = $1 returning *`, [id, dados.requer_calibracao, frequencia]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento', entityId: id,
        beforeData: before, afterData: result.rows[0],
        metadata: { motivo },
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async definirStatus(id, dados, auditContext = {}) {
    const status = String(dados.status || '').toUpperCase();
    if (!STATUS_EQUIPAMENTO.includes(status)) throw new DomainError('Status do equipamento inválido.');
    const motivo = texto(dados.motivo, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Equipamento não encontrado.');
      if (status === 'ATIVO' && before.requer_calibracao &&
          (!before.proxima_calibracao || String(before.proxima_calibracao).slice(0, 10) < new Date().toISOString().slice(0, 10))) {
        throw DomainError.conflict('Não é possível liberar equipamento sem calibração válida.');
      }
      const open = await client.query(`
        select 1 from equipamento_evento
        where equipamento_id = $1 and status = 'EM_ANDAMENTO' limit 1`, [id]);
      if (status === 'ATIVO' && open.rows[0]) {
        throw DomainError.conflict('Não é possível liberar equipamento com intervenção em andamento.');
      }
      const result = await client.query(
        'update equipamento set status = $2 where id = $1 returning *', [id, status]
      );
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento', entityId: id,
        beforeData: before, afterData: result.rows[0], metadata: { motivo },
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async createEvento(equipamentoId, dados, auditContext = {}) {
    const tipo = String(dados.tipo || '').toUpperCase();
    if (!TIPOS_EVENTO.includes(tipo)) throw new DomainError('Tipo de evento inválido.');
    const status = String(dados.status || 'AGENDADO').toUpperCase();
    if (!['AGENDADO', 'EM_ANDAMENTO'].includes(status)) {
      throw new DomainError('Um novo evento deve estar agendado ou em andamento.');
    }
    const descricao = texto(dados.descricao, 'Descrição', 3, 1000);
    if (!auditContext.actorUserId) throw new DomainError('Usuário responsável não identificado.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [equipamentoId]
      );
      const equipamento = found.rows[0];
      if (!equipamento) throw DomainError.notFound('Equipamento não encontrado.');
      if (status === 'EM_ANDAMENTO') {
        const open = await client.query(`
          select 1 from equipamento_evento
          where equipamento_id = $1 and status = 'EM_ANDAMENTO' limit 1`, [equipamentoId]);
        if (open.rows[0]) throw DomainError.conflict('Já existe uma intervenção em andamento neste equipamento.');
      }
      const result = await client.query(`
        insert into equipamento_evento (
          equipamento_id, tipo, status, descricao, fornecedor,
          agendado_para, iniciado_em, criado_por
        ) values ($1, $2, $3, $4, $5, $6,
          case when $3 = 'EM_ANDAMENTO' then timezone('utc', now()) else null end, $7)
        returning *`, [
        equipamentoId, tipo, status, descricao, dados.fornecedor?.trim() || null,
        dados.agendado_para || null, auditContext.actorUserId,
      ]);
      let equipamentoAtualizado = null;
      if (status === 'EM_ANDAMENTO' && tipo.startsWith('MANUTENCAO')) {
        equipamentoAtualizado = await client.query(
          "update equipamento set status = 'MANUTENCAO' where id = $1 returning *", [equipamentoId]
        );
      }
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'equipamento_evento', entityId: result.rows[0].id,
        afterData: result.rows[0], metadata: { equipamento_id: equipamentoId },
      });
      if (equipamentoAtualizado) {
        await AuditLogModel.record(client, {
          actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
          action: 'UPDATE', entityType: 'equipamento', entityId: equipamentoId,
          beforeData: equipamento, afterData: equipamentoAtualizado.rows[0],
          metadata: { evento_id: result.rows[0].id },
        });
      }
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async iniciarEvento(equipamentoId, eventoId, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const equipamento = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [equipamentoId]
      );
      if (!equipamento.rows[0]) throw DomainError.notFound('Equipamento não encontrado.');
      const event = await client.query(`
        select * from equipamento_evento
        where id = $1 and equipamento_id = $2 for update`, [eventoId, equipamentoId]);
      const before = event.rows[0];
      if (!before) throw DomainError.notFound('Evento não encontrado.');
      if (before.status !== 'AGENDADO') throw DomainError.conflict('Somente eventos agendados podem ser iniciados.');
      const other = await client.query(`
        select 1 from equipamento_evento
        where equipamento_id = $1 and status = 'EM_ANDAMENTO' and id <> $2 limit 1`, [equipamentoId, eventoId]);
      if (other.rows[0]) throw DomainError.conflict('Já existe uma intervenção em andamento neste equipamento.');
      const result = await client.query(`
        update equipamento_evento set status = 'EM_ANDAMENTO', iniciado_em = timezone('utc', now())
        where id = $1 returning *`, [eventoId]);
      let equipamentoAtualizado = null;
      if (before.tipo.startsWith('MANUTENCAO')) {
        equipamentoAtualizado = await client.query(
          "update equipamento set status = 'MANUTENCAO' where id = $1 returning *", [equipamentoId]
        );
      }
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento_evento', entityId: eventoId,
        beforeData: before, afterData: result.rows[0],
      });
      if (equipamentoAtualizado) {
        await AuditLogModel.record(client, {
          actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
          action: 'UPDATE', entityType: 'equipamento', entityId: equipamentoId,
          beforeData: equipamento.rows[0], afterData: equipamentoAtualizado.rows[0],
          metadata: { evento_id: eventoId },
        });
      }
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async concluirEvento(equipamentoId, eventoId, dados, auditContext = {}) {
    const resultado = String(dados.resultado || '').toUpperCase();
    if (!['APROVADO', 'REPROVADO', 'NAO_APLICAVEL'].includes(resultado)) {
      throw new DomainError('Resultado do evento inválido.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const equipResult = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [equipamentoId]
      );
      const beforeEquip = equipResult.rows[0];
      if (!beforeEquip) throw DomainError.notFound('Equipamento não encontrado.');
      const eventResult = await client.query(`
        select * from equipamento_evento where id = $1 and equipamento_id = $2 for update`,
      [eventoId, equipamentoId]);
      const beforeEvent = eventResult.rows[0];
      if (!beforeEvent) throw DomainError.notFound('Evento não encontrado.');
      if (!['AGENDADO', 'EM_ANDAMENTO'].includes(beforeEvent.status)) {
        throw DomainError.conflict('Este evento já foi finalizado.');
      }
      if (beforeEvent.tipo === 'CALIBRACAO' && resultado === 'NAO_APLICAVEL') {
        throw new DomainError('Calibração deve ser aprovada ou reprovada.');
      }
      const proxima = dataValida(dados.proxima_calibracao, 'Próxima calibração',
        beforeEvent.tipo === 'CALIBRACAO' && resultado === 'APROVADO' && beforeEquip.requer_calibracao);
      const hoje = new Date().toISOString().slice(0, 10);
      if (proxima && proxima < hoje) throw new DomainError('A próxima calibração não pode estar vencida.');
      const eventUpdated = await client.query(`
        update equipamento_evento set status = 'CONCLUIDO',
          iniciado_em = coalesce(iniciado_em, timezone('utc', now())),
          concluido_em = timezone('utc', now()), resultado = $2,
          certificado_url = $3, observacao = $4, proxima_calibracao = $5,
          concluido_por = $6
        where id = $1 returning *`, [
        eventoId, resultado, dados.certificado_url?.trim() || null,
        dados.observacao?.trim() || null, proxima, auditContext.actorUserId || null,
      ]);
      let novoStatus = resultado === 'REPROVADO' ? 'FORA_DE_USO' : beforeEquip.status;
      let ultimaCalibracao = beforeEquip.ultima_calibracao;
      let proximaCalibracao = beforeEquip.proxima_calibracao;
      if (beforeEvent.tipo === 'CALIBRACAO') {
        ultimaCalibracao = hoje;
        proximaCalibracao = resultado === 'APROVADO' ? proxima : null;
      } else if (resultado !== 'REPROVADO') {
        const other = await client.query(`
          select 1 from equipamento_evento
          where equipamento_id = $1 and status = 'EM_ANDAMENTO' and id <> $2 limit 1`,
        [equipamentoId, eventoId]);
        if (!other.rows[0] && beforeEquip.status === 'MANUTENCAO') novoStatus = 'ATIVO';
      }
      const equipUpdated = await client.query(`
        update equipamento set status = $2, ultima_calibracao = $3, proxima_calibracao = $4
        where id = $1 returning *`, [equipamentoId, novoStatus, ultimaCalibracao, proximaCalibracao]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento_evento', entityId: eventoId,
        beforeData: beforeEvent, afterData: eventUpdated.rows[0],
      });
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento', entityId: equipamentoId,
        beforeData: beforeEquip, afterData: equipUpdated.rows[0],
        metadata: { evento_id: eventoId },
      });
      await client.query('commit');
      return { evento: eventUpdated.rows[0], equipamento: equipUpdated.rows[0] };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async cancelarEvento(equipamentoId, eventoId, dados, auditContext = {}) {
    const motivo = texto(dados.motivo, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const equipamento = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [equipamentoId]
      );
      if (!equipamento.rows[0]) throw DomainError.notFound('Equipamento não encontrado.');
      const found = await client.query(`
        select * from equipamento_evento where id = $1 and equipamento_id = $2 for update`,
      [eventoId, equipamentoId]);
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Evento não encontrado.');
      if (!['AGENDADO', 'EM_ANDAMENTO'].includes(before.status)) {
        throw DomainError.conflict('Este evento já foi finalizado.');
      }
      const result = await client.query(`
        update equipamento_evento set status = 'CANCELADO',
          concluido_em = timezone('utc', now()), concluido_por = $2,
          observacao = concat_ws(E'\n', nullif(observacao, ''), $3)
        where id = $1 returning *`, [eventoId, auditContext.actorUserId || null, `Cancelamento: ${motivo}`]);
      let equipamentoAtualizado = null;
      if (before.status === 'EM_ANDAMENTO' && before.tipo.startsWith('MANUTENCAO')) {
        const other = await client.query(`
          select 1 from equipamento_evento
          where equipamento_id = $1 and status = 'EM_ANDAMENTO' and id <> $2 limit 1`,
        [equipamentoId, eventoId]);
        if (!other.rows[0] && equipamento.rows[0].status === 'MANUTENCAO') {
          equipamentoAtualizado = await client.query(
            "update equipamento set status = 'FORA_DE_USO' where id = $1 returning *", [equipamentoId]
          );
        }
      }
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'equipamento_evento', entityId: eventoId,
        beforeData: before, afterData: result.rows[0], metadata: { motivo },
      });
      if (equipamentoAtualizado) {
        await AuditLogModel.record(client, {
          actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
          action: 'UPDATE', entityType: 'equipamento', entityId: equipamentoId,
          beforeData: equipamento.rows[0], afterData: equipamentoAtualizado.rows[0],
          metadata: { evento_id: eventoId, motivo },
        });
      }
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async findEventos(equipamentoId, { page, pageSize } = {}) {
    const pg = paginacao(page, pageSize);
    const exists = await pool.query(
      'select 1 from equipamento where id = $1 and deleted_at is null', [equipamentoId]
    );
    if (!exists.rows[0]) throw DomainError.notFound('Equipamento não encontrado.');
    const count = await pool.query(
      'select count(*)::int as total from equipamento_evento where equipamento_id = $1', [equipamentoId]
    );
    const { rows } = await pool.query(`
      select ev.*, criador.nome as criado_por_nome, conclusor.nome as concluido_por_nome
      from equipamento_evento ev
      join usuario criador on criador.id = ev.criado_por
      left join usuario conclusor on conclusor.id = ev.concluido_por
      where ev.equipamento_id = $1
      order by ev.created_at desc, ev.id desc limit $2 offset $3`,
    [equipamentoId, pg.pageSize, pg.offset]);
    return { rows, total: count.rows[0].total, page: pg.page, pageSize: pg.pageSize };
  }

  static async registrarUtilizacao(equipamentoId, dados, auditContext = {}) {
    const finalidade = texto(dados.finalidade, 'Finalidade', 3, 500);
    const utilizadoEm = instanteValido(dados.utilizado_em, 'Data de utilização');
    if (!auditContext.actorUserId) throw new DomainError('Usuário responsável não identificado.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(`
        select e.*,
          exists (
            select 1 from equipamento_evento ev
            where ev.equipamento_id = e.id and ev.status = 'EM_ANDAMENTO'
          ) as evento_em_andamento,
          exists (
            select 1 from equipamento_evento ev
            where ev.equipamento_id = e.id and ev.status = 'EM_ANDAMENTO'
              and ev.tipo in ('MANUTENCAO_PREVENTIVA', 'MANUTENCAO_CORRETIVA')
          ) as manutencao_em_andamento
        from equipamento e
        where e.id = $1 and e.deleted_at is null
        for update of e`, [equipamentoId]);
      const equipamento = found.rows[0];
      if (!equipamento) throw DomainError.notFound('Equipamento não encontrado.');
      const disponibilidade = this.avaliarDisponibilidade(equipamento);
      if (!disponibilidade.disponivel) {
        throw DomainError.conflict(`Uso bloqueado: ${disponibilidade.motivo}`);
      }
      if (dados.amostra_id != null) {
        const amostra = await client.query(
          'select 1 from amostra where id = $1 and deleted_at is null', [dados.amostra_id]
        );
        if (!amostra.rows[0]) throw DomainError.notFound('Amostra informada não encontrada.');
      }
      if (dados.resultado_analise_id != null) {
        const resultado = await client.query(
          'select 1 from resultado_analise where id = $1 and deleted_at is null', [dados.resultado_analise_id]
        );
        if (!resultado.rows[0]) throw DomainError.notFound('Resultado informado não encontrado.');
      }
      const metadata = dados.metadata && typeof dados.metadata === 'object' && !Array.isArray(dados.metadata)
        ? dados.metadata : {};
      const result = await client.query(`
        insert into equipamento_utilizacao (
          equipamento_id, amostra_id, resultado_analise_id,
          finalidade, utilizado_por, utilizado_em, metadata
        ) values ($1, $2, $3, $4, $5, coalesce($6, timezone('utc', now())), $7::jsonb)
        returning *`, [
        equipamentoId, dados.amostra_id || null, dados.resultado_analise_id || null,
        finalidade, auditContext.actorUserId, utilizadoEm,
        JSON.stringify(metadata),
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'equipamento_utilizacao', entityId: result.rows[0].id,
        afterData: result.rows[0], metadata: { equipamento_id: equipamentoId },
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23503') throw new DomainError('Amostra, resultado ou usuário relacionado não existe.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async findUtilizacoes(equipamentoId, { page, pageSize } = {}) {
    const pg = paginacao(page, pageSize);
    const exists = await pool.query(
      'select 1 from equipamento where id = $1 and deleted_at is null', [equipamentoId]
    );
    if (!exists.rows[0]) throw DomainError.notFound('Equipamento não encontrado.');
    const count = await pool.query(
      'select count(*)::int as total from equipamento_utilizacao where equipamento_id = $1',
      [equipamentoId]
    );
    const { rows } = await pool.query(`
      select eu.*, u.nome as utilizado_por_nome,
        a.codigo_amostra, r.codigodaamostra as resultado_codigo_amostra
      from equipamento_utilizacao eu
      join usuario u on u.id = eu.utilizado_por
      left join amostra a on a.id = eu.amostra_id
      left join resultado_analise r on r.id = eu.resultado_analise_id
      where eu.equipamento_id = $1
      order by eu.utilizado_em desc, eu.id desc
      limit $2 offset $3`, [equipamentoId, pg.pageSize, pg.offset]);
    return { rows, total: count.rows[0].total, page: pg.page, pageSize: pg.pageSize };
  }

  static async archive(id, auditContext = {}) {
    const motivo = texto(auditContext.reason, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from equipamento where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Equipamento não encontrado.');
      const open = await client.query(`
        select 1 from equipamento_evento where equipamento_id = $1
          and status = 'EM_ANDAMENTO' limit 1`, [id]);
      if (open.rows[0]) throw DomainError.conflict('Conclua ou cancele a intervenção em andamento antes de arquivar.');
      const result = await client.query(`
        update equipamento set deleted_at = timezone('utc', now()), deleted_by = $2,
          deletion_reason = $3, status = 'FORA_DE_USO'
        where id = $1 returning *`, [id, auditContext.actorUserId || null, motivo]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'ARCHIVE', entityType: 'equipamento', entityId: id,
        beforeData: before, afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = EquipamentoModel;
