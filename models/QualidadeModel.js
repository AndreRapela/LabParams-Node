const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const DomainError = require('./DomainError');

const TIPOS = ['NAO_CONFORMIDADE', 'DESVIO'];
const GRAVIDADES = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];
const TIPOS_CAPA = ['CORRETIVA', 'PREVENTIVA'];
const TRANSICOES = Object.freeze({
  ABERTA: ['EM_INVESTIGACAO', 'CANCELADA'],
  EM_INVESTIGACAO: ['PLANO_ACAO', 'CANCELADA'],
  PLANO_ACAO: ['VERIFICACAO', 'CANCELADA'],
  VERIFICACAO: ['ENCERRADA', 'PLANO_ACAO'],
  ENCERRADA: ['EM_INVESTIGACAO'],
  CANCELADA: ['ABERTA'],
});
const TRANSICOES_CAPA = Object.freeze({
  PENDENTE: ['EM_ANDAMENTO', 'CONCLUIDA'],
  EM_ANDAMENTO: ['PENDENTE', 'CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
});

function texto(valor, campo, min = 1, max = 5000) {
  const normalizado = typeof valor === 'string' ? valor.trim() : '';
  if (normalizado.length < min || normalizado.length > max) {
    throw new DomainError(`${campo} deve ter entre ${min} e ${max} caracteres.`);
  }
  return normalizado;
}

function dataValida(valor, campo) {
  if (!valor) return null;
  const value = String(valor).slice(0, 10);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError(`${campo} inválido.`);
  }
  return value;
}

function paginacao(page, pageSize) {
  const pagina = Math.max(1, Number.parseInt(page, 10) || 1);
  const tamanho = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  return { page: pagina, pageSize: tamanho, offset: (pagina - 1) * tamanho };
}

class QualidadeModel {
  static validarTransicao(atual, destino) {
    const permitidas = TRANSICOES[atual] || [];
    if (!permitidas.includes(destino)) {
      throw DomainError.conflict(`Transição de ${atual} para ${destino} não permitida.`);
    }
    return true;
  }

  static validarTransicaoCapa(atual, destino) {
    if (atual === destino) return true;
    const permitidas = TRANSICOES_CAPA[atual] || [];
    if (!permitidas.includes(destino)) {
      throw DomainError.conflict(`Transição da ação de ${atual} para ${destino} não permitida.`);
    }
    return true;
  }

  static async getResumo() {
    const { rows } = await pool.query(`
      select
        count(*) filter (where o.status not in ('ENCERRADA', 'CANCELADA'))::int as ocorrencias_abertas,
        count(*) filter (where o.gravidade = 'CRITICA'
          and o.status not in ('ENCERRADA', 'CANCELADA'))::int as criticas_abertas,
        count(*) filter (where o.prazo < current_date
          and o.status not in ('ENCERRADA', 'CANCELADA'))::int as ocorrencias_vencidas,
        (select count(*)::int from qms_acao_capa a
          join qms_ocorrencia oq on oq.id = a.ocorrencia_id
          where oq.deleted_at is null and a.prazo < current_date
            and a.status not in ('CONCLUIDA', 'CANCELADA')
        ) as acoes_capa_vencidas,
        count(*) filter (where o.status = 'ENCERRADA'
          and o.encerrada_em >= date_trunc('month', timezone('utc', now())))::int
          as encerradas_no_mes
      from qms_ocorrencia o where o.deleted_at is null`);
    return rows[0];
  }

  static async findResponsaveis() {
    const { rows } = await pool.query(
      "select id, nome, email, perfil from usuario where perfil in ('Gestor', 'Analista') order by nome"
    );
    return rows;
  }

  static async findAll({ page, pageSize, search, status, tipo, vencidas = false } = {}) {
    const pg = paginacao(page, pageSize);
    const values = [];
    const filters = ['o.deleted_at is null'];
    if (search) {
      values.push(`%${String(search).trim()}%`);
      filters.push(`(o.codigo ilike $${values.length} or o.titulo ilike $${values.length} or o.descricao ilike $${values.length})`);
    }
    if (status) {
      values.push(String(status).toUpperCase());
      filters.push(`o.status = $${values.length}`);
    }
    if (tipo) {
      values.push(String(tipo).toUpperCase());
      filters.push(`o.tipo = $${values.length}`);
    }
    if (String(vencidas) === 'true') {
      filters.push("o.prazo < current_date and o.status not in ('ENCERRADA', 'CANCELADA')");
    }
    const where = filters.join(' and ');
    const count = await pool.query(`select count(*)::int as total from qms_ocorrencia o where ${where}`, values);
    values.push(pg.pageSize, pg.offset);
    const { rows } = await pool.query(`
      select o.*, responsavel.nome as responsavel_nome, autor.nome as aberta_por_nome,
        count(a.id)::int as total_acoes,
        count(a.id) filter (where a.status not in ('CONCLUIDA', 'CANCELADA'))::int as acoes_pendentes,
        (o.prazo < current_date and o.status not in ('ENCERRADA', 'CANCELADA')) as vencida
      from qms_ocorrencia o
      join usuario autor on autor.id = o.aberta_por
      left join usuario responsavel on responsavel.id = o.responsavel_id
      left join qms_acao_capa a on a.ocorrencia_id = o.id
      where ${where}
      group by o.id, responsavel.nome, autor.nome
      order by
        case o.gravidade when 'CRITICA' then 0 when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end,
        o.prazo nulls last, o.created_at desc
      limit $${values.length - 1} offset $${values.length}`, values);
    return { rows, total: count.rows[0].total, page: pg.page, pageSize: pg.pageSize };
  }

  static async findById(id) {
    const result = await pool.query(`
      select o.*, responsavel.nome as responsavel_nome, autor.nome as aberta_por_nome,
        gestor.nome as encerrada_por_nome,
        (o.prazo < current_date and o.status not in ('ENCERRADA', 'CANCELADA')) as vencida
      from qms_ocorrencia o
      join usuario autor on autor.id = o.aberta_por
      left join usuario responsavel on responsavel.id = o.responsavel_id
      left join usuario gestor on gestor.id = o.encerrada_por
      where o.id = $1 and o.deleted_at is null`, [id]);
    if (!result.rows[0]) return null;
    const acoes = await pool.query(`
      select a.*, responsavel.nome as responsavel_nome, autor.nome as criado_por_nome,
        (a.prazo < current_date and a.status not in ('CONCLUIDA', 'CANCELADA')) as vencida
      from qms_acao_capa a
      join usuario autor on autor.id = a.criado_por
      left join usuario responsavel on responsavel.id = a.responsavel_id
      where a.ocorrencia_id = $1 order by a.created_at, a.id`, [id]);
    return { ...result.rows[0], acoes: acoes.rows };
  }

  static async create(dados, auditContext = {}) {
    const tipo = String(dados.tipo || '').toUpperCase();
    if (!TIPOS.includes(tipo)) throw new DomainError('Tipo deve ser NAO_CONFORMIDADE ou DESVIO.');
    const gravidade = String(dados.gravidade || 'MEDIA').toUpperCase();
    if (!GRAVIDADES.includes(gravidade)) throw new DomainError('Gravidade inválida.');
    const titulo = texto(dados.titulo, 'Título', 3, 200);
    const descricao = texto(dados.descricao, 'Descrição', 10, 5000);
    const prazo = dataValida(dados.prazo, 'Prazo');
    if (!auditContext.actorUserId) throw new DomainError('Usuário responsável não identificado.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(`
        insert into qms_ocorrencia (
          codigo, tipo, titulo, descricao, origem, gravidade,
          responsavel_id, aberta_por, prazo, contencao
        ) values (
          'QMS-' || to_char(current_date, 'YYYY') || '-' ||
            lpad(nextval('public.qms_ocorrencia_codigo_seq')::text, 6, '0'),
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        ) returning *`, [
        tipo, titulo, descricao, dados.origem?.trim() || null, gravidade,
        dados.responsavel_id || null, auditContext.actorUserId, prazo,
        dados.contencao?.trim() || null,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'qms_ocorrencia', entityId: result.rows[0].id,
        afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23503') throw new DomainError('Responsável informado não existe.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async update(id, dados, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from qms_ocorrencia where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Ocorrência da qualidade não encontrada.');
      if (['ENCERRADA', 'CANCELADA'].includes(before.status)) {
        throw DomainError.conflict('Ocorrência finalizada só pode ser reaberta por decisão da gestão.');
      }
      const gravidade = String(dados.gravidade ?? before.gravidade).toUpperCase();
      if (!GRAVIDADES.includes(gravidade)) throw new DomainError('Gravidade inválida.');
      const result = await client.query(`
        update qms_ocorrencia set titulo = $2, descricao = $3, origem = $4,
          gravidade = $5, responsavel_id = $6, prazo = $7,
          contencao = $8, causa_raiz = $9
        where id = $1 and deleted_at is null returning *`, [
        id,
        dados.titulo === undefined ? before.titulo : texto(dados.titulo, 'Título', 3, 200),
        dados.descricao === undefined ? before.descricao : texto(dados.descricao, 'Descrição', 10, 5000),
        dados.origem === undefined ? before.origem : dados.origem?.trim() || null,
        gravidade,
        dados.responsavel_id === undefined ? before.responsavel_id : dados.responsavel_id || null,
        dados.prazo === undefined ? before.prazo : dataValida(dados.prazo, 'Prazo'),
        dados.contencao === undefined ? before.contencao : dados.contencao?.trim() || null,
        dados.causa_raiz === undefined ? before.causa_raiz : dados.causa_raiz?.trim() || null,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'qms_ocorrencia', entityId: id,
        beforeData: before, afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23503') throw new DomainError('Responsável informado não existe.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async decidir(id, dados, auditContext = {}) {
    const destino = String(dados.status || '').toUpperCase();
    const decisao = texto(dados.decisao, 'Decisão', 3, 2000);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from qms_ocorrencia where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Ocorrência da qualidade não encontrada.');
      this.validarTransicao(before.status, destino);
      const causaRaiz = dados.causa_raiz === undefined ? before.causa_raiz : dados.causa_raiz?.trim() || null;
      const eficacia = dados.verificacao_eficacia === undefined
        ? before.verificacao_eficacia : dados.verificacao_eficacia?.trim() || null;
      if (destino === 'PLANO_ACAO' && !causaRaiz) {
        throw DomainError.conflict('Registre a causa raiz antes de aprovar o plano de ação.');
      }
      if (['VERIFICACAO', 'ENCERRADA'].includes(destino)) {
        const actions = await client.query(`
          select count(*)::int as total,
            count(*) filter (where status not in ('CONCLUIDA', 'CANCELADA'))::int as pendentes
          from qms_acao_capa where ocorrencia_id = $1`, [id]);
        if (actions.rows[0].total === 0) {
          throw DomainError.conflict('Cadastre ao menos uma ação CAPA antes da verificação.');
        }
        if (actions.rows[0].pendentes > 0) {
          throw DomainError.conflict('Todas as ações CAPA devem ser concluídas antes da verificação.');
        }
      }
      if (destino === 'ENCERRADA' && !eficacia) {
        throw DomainError.conflict('Registre a verificação de eficácia antes de encerrar.');
      }
      if (destino === 'CANCELADA') {
        const pendentes = await client.query(`
          select * from qms_acao_capa
          where ocorrencia_id = $1 and status not in ('CONCLUIDA', 'CANCELADA')
          for update`, [id]);
        for (const acao of pendentes.rows) {
          const atualizada = await client.query(`
            update qms_acao_capa set status = 'CANCELADA',
              evidencia = concat_ws(E'\n', nullif(evidencia, ''), $2),
              concluida_em = timezone('utc', now())
            where id = $1 returning *`, [acao.id, `Cancelamento da ocorrência: ${decisao}`]);
          await AuditLogModel.record(client, {
            actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
            action: 'UPDATE', entityType: 'qms_acao_capa', entityId: acao.id,
            beforeData: acao, afterData: atualizada.rows[0],
            metadata: { ocorrencia_id: id, motivo: decisao },
          });
        }
      }
      const final = ['ENCERRADA', 'CANCELADA'].includes(destino);
      const result = await client.query(`
        update qms_ocorrencia set status = $2, causa_raiz = $3,
          verificacao_eficacia = $4, decisao_final = $5,
          encerrada_em = case when $6 then timezone('utc', now()) else null end,
          encerrada_por = case when $6 then $7 else null end
        where id = $1 returning *`, [
        id, destino, causaRaiz, eficacia, decisao, final, auditContext.actorUserId || null,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'qms_ocorrencia', entityId: id,
        beforeData: before, afterData: result.rows[0],
        metadata: { decisao, transicao: `${before.status}->${destino}` },
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

  static async createAcao(ocorrenciaId, dados, auditContext = {}) {
    const tipo = String(dados.tipo || '').toUpperCase();
    if (!TIPOS_CAPA.includes(tipo)) throw new DomainError('Tipo de ação CAPA inválido.');
    const descricao = texto(dados.descricao, 'Descrição', 5, 2000);
    const prazo = dataValida(dados.prazo, 'Prazo');
    if (!auditContext.actorUserId) throw new DomainError('Usuário responsável não identificado.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const ocorrencia = await client.query(
        'select * from qms_ocorrencia where id = $1 and deleted_at is null for update', [ocorrenciaId]
      );
      if (!ocorrencia.rows[0]) throw DomainError.notFound('Ocorrência da qualidade não encontrada.');
      if (['ENCERRADA', 'CANCELADA'].includes(ocorrencia.rows[0].status)) {
        throw DomainError.conflict('Não é possível incluir ação em ocorrência finalizada.');
      }
      const result = await client.query(`
        insert into qms_acao_capa (
          ocorrencia_id, tipo, descricao, responsavel_id, prazo, criado_por
        ) values ($1, $2, $3, $4, $5, $6) returning *`, [
        ocorrenciaId, tipo, descricao, dados.responsavel_id || null,
        prazo, auditContext.actorUserId,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'qms_acao_capa', entityId: result.rows[0].id,
        afterData: result.rows[0], metadata: { ocorrencia_id: ocorrenciaId },
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23503') throw new DomainError('Responsável informado não existe.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async updateAcao(ocorrenciaId, acaoId, dados, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const occurrence = await client.query(
        'select status from qms_ocorrencia where id = $1 and deleted_at is null for update', [ocorrenciaId]
      );
      if (!occurrence.rows[0]) throw DomainError.notFound('Ocorrência da qualidade não encontrada.');
      if (['ENCERRADA', 'CANCELADA'].includes(occurrence.rows[0].status)) {
        throw DomainError.conflict('A ocorrência está finalizada.');
      }
      const found = await client.query(`
        select * from qms_acao_capa where id = $1 and ocorrencia_id = $2 for update`,
      [acaoId, ocorrenciaId]);
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Ação CAPA não encontrada.');
      if (['CONCLUIDA', 'CANCELADA'].includes(before.status)) {
        throw DomainError.conflict('Ação CAPA finalizada é imutável.');
      }
      const status = String(dados.status ?? before.status).toUpperCase();
      if (status === 'CANCELADA') throw new DomainError('Use a decisão de cancelamento da gestão.');
      this.validarTransicaoCapa(before.status, status);
      const evidencia = dados.evidencia === undefined ? before.evidencia : dados.evidencia?.trim() || null;
      if (status === 'CONCLUIDA' && (!evidencia || evidencia.length < 3)) {
        throw DomainError.conflict('Informe a evidência antes de concluir a ação CAPA.');
      }
      const result = await client.query(`
        update qms_acao_capa set descricao = $3, responsavel_id = $4,
          prazo = $5, status = $6, evidencia = $7,
          concluida_em = case when $6 = 'CONCLUIDA' then timezone('utc', now()) else null end
        where id = $1 and ocorrencia_id = $2 returning *`, [
        acaoId, ocorrenciaId,
        dados.descricao === undefined ? before.descricao : texto(dados.descricao, 'Descrição', 5, 2000),
        dados.responsavel_id === undefined ? before.responsavel_id : dados.responsavel_id || null,
        dados.prazo === undefined ? before.prazo : dataValida(dados.prazo, 'Prazo'),
        status, evidencia,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'qms_acao_capa', entityId: acaoId,
        beforeData: before, afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23503') throw new DomainError('Responsável informado não existe.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async cancelarAcao(ocorrenciaId, acaoId, dados, auditContext = {}) {
    const motivo = texto(dados.motivo, 'Motivo', 3, 1000);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const occurrence = await client.query(
        'select status from qms_ocorrencia where id = $1 and deleted_at is null for update', [ocorrenciaId]
      );
      if (!occurrence.rows[0]) throw DomainError.notFound('Ocorrência da qualidade não encontrada.');
      if (['ENCERRADA', 'CANCELADA'].includes(occurrence.rows[0].status)) {
        throw DomainError.conflict('Não é possível cancelar ação de ocorrência finalizada.');
      }
      const found = await client.query(`
        select * from qms_acao_capa where id = $1 and ocorrencia_id = $2 for update`,
      [acaoId, ocorrenciaId]);
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Ação CAPA não encontrada.');
      if (['CONCLUIDA', 'CANCELADA'].includes(before.status)) {
        throw DomainError.conflict('Ação CAPA já finalizada.');
      }
      const result = await client.query(`
        update qms_acao_capa set status = 'CANCELADA',
          evidencia = concat_ws(E'\n', nullif(evidencia, ''), $3),
          concluida_em = timezone('utc', now())
        where id = $1 and ocorrencia_id = $2 returning *`,
      [acaoId, ocorrenciaId, `Cancelamento: ${motivo}`]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'qms_acao_capa', entityId: acaoId,
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

  static async archive(id, auditContext = {}) {
    const motivo = texto(auditContext.reason, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from qms_ocorrencia where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Ocorrência da qualidade não encontrada.');
      if (!['ENCERRADA', 'CANCELADA'].includes(before.status)) {
        throw DomainError.conflict('Somente ocorrências encerradas ou canceladas podem ser arquivadas.');
      }
      const result = await client.query(`
        update qms_ocorrencia set deleted_at = timezone('utc', now()),
          deleted_by = $2, deletion_reason = $3
        where id = $1 returning *`, [id, auditContext.actorUserId || null, motivo]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'ARCHIVE', entityType: 'qms_ocorrencia', entityId: id,
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

module.exports = QualidadeModel;
