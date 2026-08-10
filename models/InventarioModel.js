const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const DomainError = require('./DomainError');

const TIPOS_INSUMO = ['REAGENTE', 'PADRAO', 'CONSUMIVEL', 'OUTRO'];
const STATUS_LOTE = ['DISPONIVEL', 'QUARENTENA', 'BLOQUEADO', 'ESGOTADO'];
const MOVIMENTOS_OPERACIONAIS = ['ENTRADA', 'SAIDA'];
const MOVIMENTOS_AJUSTE = ['AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'];

function textoObrigatorio(valor, campo, minimo = 1, maximo = 500) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (texto.length < minimo || texto.length > maximo) {
    throw new DomainError(`${campo} deve ter entre ${minimo} e ${maximo} caracteres.`);
  }
  return texto;
}

function numeroNaoNegativo(valor, campo) {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    throw new DomainError(`${campo} deve ser informado.`);
  }
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || numero > 999999999999) {
    throw new DomainError(`${campo} deve estar entre zero e 999999999999.`);
  }
  return String(valor).trim();
}

function quantidadePositiva(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0.000001 || numero > 999999999999) {
    throw new DomainError('A quantidade deve estar entre 0,000001 e 999999999999.');
  }
  return String(valor).trim();
}

function booleano(valor, campo) {
  if (typeof valor === 'boolean') return valor;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  throw new DomainError(`${campo} deve ser verdadeiro ou falso.`);
}

function paginacao(page, pageSize) {
  const pagina = Math.max(1, Number.parseInt(page, 10) || 1);
  const tamanho = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
  return { page: pagina, pageSize: tamanho, offset: (pagina - 1) * tamanho };
}

class InventarioModel {
  static calcularSaldo(saldo, tipo, quantidade) {
    const anterior = Number(saldo);
    const valor = Number(quantidade);
    if (!Number.isFinite(anterior) || anterior < 0 || !Number.isFinite(valor) || valor <= 0) {
      throw new DomainError('Saldo ou quantidade inválidos.');
    }
    const positivo = ['ENTRADA', 'AJUSTE_POSITIVO'].includes(tipo);
    const negativo = ['SAIDA', 'AJUSTE_NEGATIVO'].includes(tipo);
    if (!positivo && !negativo) throw new DomainError('Tipo de movimentação inválido.');
    const posterior = positivo ? anterior + valor : anterior - valor;
    if (posterior < 0) throw DomainError.conflict('Saldo insuficiente para esta movimentação.');
    return Number(posterior.toFixed(6));
  }

  static async getResumo() {
    const { rows } = await pool.query(`
      with estoque as (
        select insumo_id,
          coalesce(sum(quantidade_atual) filter (
            where deleted_at is null and status = 'DISPONIVEL'
              and (validade is null or validade >= current_date)
          ), 0) as disponivel
        from insumo_lote group by insumo_id
      )
      select
        count(*) filter (where i.deleted_at is null)::int as total_insumos,
        count(*) filter (
          where i.deleted_at is null and coalesce(e.disponivel, 0) <= i.estoque_minimo
        )::int as abaixo_estoque_minimo,
        (select count(*)::int from insumo_lote
          where deleted_at is null and quantidade_atual > 0 and validade < current_date
        ) as lotes_vencidos,
        (select count(*)::int from insumo_lote
          where deleted_at is null and quantidade_atual > 0
            and validade between current_date and current_date + 30
        ) as lotes_vencendo_30_dias
      from insumo i left join estoque e on e.insumo_id = i.id`);
    return rows[0];
  }

  static async findAll({ page, pageSize, search, baixoEstoque = false } = {}) {
    const pg = paginacao(page, pageSize);
    const values = [];
    const filters = ['i.deleted_at is null'];
    if (search) {
      values.push(`%${String(search).trim()}%`);
      filters.push(`(i.codigo ilike $${values.length} or i.nome ilike $${values.length})`);
    }
    if (String(baixoEstoque) === 'true') {
      filters.push('coalesce(e.estoque_disponivel, 0) <= i.estoque_minimo');
    }
    const where = filters.join(' and ');
    const estoqueCte = `
      with estoque as (
        select
          l.insumo_id,
          coalesce(sum(l.quantidade_atual) filter (where l.deleted_at is null), 0) as estoque_total,
          coalesce(sum(l.quantidade_atual) filter (
            where l.deleted_at is null
              and l.status = 'DISPONIVEL'
              and (l.validade is null or l.validade >= current_date)
          ), 0) as estoque_disponivel,
          count(*) filter (
            where l.deleted_at is null and l.quantidade_atual > 0
              and l.validade between current_date and current_date + 30
          )::int as lotes_vencendo,
          count(*) filter (
            where l.deleted_at is null and l.quantidade_atual > 0
              and l.validade < current_date
          )::int as lotes_vencidos
        from insumo_lote l
        group by l.insumo_id
      )`;

    const count = await pool.query(`${estoqueCte}
      select count(*)::int as total
      from insumo i left join estoque e on e.insumo_id = i.id
      where ${where}`, values);

    values.push(pg.pageSize, pg.offset);
    const { rows } = await pool.query(`${estoqueCte}
      select i.*,
        coalesce(e.estoque_total, 0) as estoque_total,
        coalesce(e.estoque_disponivel, 0) as estoque_disponivel,
        coalesce(e.lotes_vencendo, 0) as lotes_vencendo,
        coalesce(e.lotes_vencidos, 0) as lotes_vencidos,
        (coalesce(e.estoque_disponivel, 0) <= i.estoque_minimo) as abaixo_estoque_minimo
      from insumo i left join estoque e on e.insumo_id = i.id
      where ${where}
      order by i.nome, i.codigo
      limit $${values.length - 1} offset $${values.length}`, values);

    return { rows, total: count.rows[0].total, page: pg.page, pageSize: pg.pageSize };
  }

  static async findById(id) {
    const item = await pool.query(`
      select i.*,
        coalesce(sum(l.quantidade_atual) filter (where l.deleted_at is null), 0) as estoque_total,
        coalesce(sum(l.quantidade_atual) filter (
          where l.deleted_at is null and l.status = 'DISPONIVEL'
            and (l.validade is null or l.validade >= current_date)
        ), 0) as estoque_disponivel
      from insumo i
      left join insumo_lote l on l.insumo_id = i.id
      where i.id = $1 and i.deleted_at is null
      group by i.id`, [id]);
    if (!item.rows[0]) return null;
    const lotes = await pool.query(`
      select l.*,
        case
          when l.validade < current_date then 'VENCIDO'
          when l.status <> 'DISPONIVEL' then l.status
          when l.quantidade_atual = 0 then 'ESGOTADO'
          else 'DISPONIVEL'
        end as situacao_operacional,
        case when l.validade is null then null else l.validade - current_date end as dias_para_vencer
      from insumo_lote l
      where l.insumo_id = $1 and l.deleted_at is null
      order by l.validade nulls last, l.created_at desc`, [id]);
    return { ...item.rows[0], lotes: lotes.rows };
  }

  static async create(dados, auditContext = {}) {
    const codigo = textoObrigatorio(dados.codigo, 'Código', 1, 80);
    const nome = textoObrigatorio(dados.nome, 'Nome', 1, 200);
    const unidade = textoObrigatorio(dados.unidade_medida, 'Unidade de medida', 1, 30);
    const tipo = String(dados.tipo || 'REAGENTE').toUpperCase();
    if (!TIPOS_INSUMO.includes(tipo)) throw new DomainError('Tipo de insumo inválido.');
    const minimo = numeroNaoNegativo(dados.estoque_minimo ?? 0, 'Estoque mínimo');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(`
        insert into insumo (
          codigo, nome, tipo, unidade_medida, estoque_minimo,
          fabricante, condicao_armazenamento
        ) values ($1, $2, $3, $4, $5, $6, $7)
        returning *`, [
        codigo, nome, tipo, unidade, minimo,
        dados.fabricante?.trim() || null,
        dados.condicao_armazenamento?.trim() || null,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'insumo', entityId: result.rows[0].id,
        afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23505') throw DomainError.conflict('Já existe um insumo ativo com este código.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async update(id, dados, auditContext = {}) {
    if (dados.ativo !== undefined) {
      throw new DomainError('Use o endpoint de decisão de status para ativar ou inativar o insumo.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from insumo where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Insumo não encontrado.');
      const tipo = String(dados.tipo ?? before.tipo).toUpperCase();
      if (!TIPOS_INSUMO.includes(tipo)) throw new DomainError('Tipo de insumo inválido.');
      const afterValues = {
        codigo: dados.codigo === undefined ? before.codigo : textoObrigatorio(dados.codigo, 'Código', 1, 80),
        nome: dados.nome === undefined ? before.nome : textoObrigatorio(dados.nome, 'Nome', 1, 200),
        tipo,
        unidade: dados.unidade_medida === undefined ? before.unidade_medida : textoObrigatorio(dados.unidade_medida, 'Unidade de medida', 1, 30),
        minimo: dados.estoque_minimo === undefined ? before.estoque_minimo : numeroNaoNegativo(dados.estoque_minimo, 'Estoque mínimo'),
        fabricante: dados.fabricante === undefined ? before.fabricante : dados.fabricante?.trim() || null,
        condicao: dados.condicao_armazenamento === undefined ? before.condicao_armazenamento : dados.condicao_armazenamento?.trim() || null,
        ativo: before.ativo,
      };
      const result = await client.query(`
        update insumo set codigo = $2, nome = $3, tipo = $4, unidade_medida = $5,
          estoque_minimo = $6, fabricante = $7, condicao_armazenamento = $8, ativo = $9
        where id = $1 and deleted_at is null returning *`, [
        id, afterValues.codigo, afterValues.nome, afterValues.tipo, afterValues.unidade,
        afterValues.minimo, afterValues.fabricante, afterValues.condicao, afterValues.ativo,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'insumo', entityId: id,
        beforeData: before, afterData: result.rows[0],
      });
      await client.query('commit');
      return result.rows[0];
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23505') throw DomainError.conflict('Já existe um insumo ativo com este código.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async createLote(insumoId, dados, auditContext = {}) {
    const numeroLote = textoObrigatorio(dados.numero_lote, 'Número do lote', 1, 120);
    const quantidade = numeroNaoNegativo(dados.quantidade_inicial ?? 0, 'Quantidade inicial');
    const validade = dados.validade || null;
    if (validade) {
      const valorData = String(validade).slice(0, 10);
      const parsed = new Date(`${valorData}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valorData) || Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== valorData) {
        throw new DomainError('Data de validade inválida.');
      }
    }
    const status = String(dados.status || 'DISPONIVEL').toUpperCase();
    if (!STATUS_LOTE.includes(status)) throw new DomainError('Status do lote inválido.');
    if (Number(quantidade) > 0 && !auditContext.actorUserId) {
      throw new DomainError('Usuário responsável pela entrada inicial não identificado.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const item = await client.query(
        'select id from insumo where id = $1 and deleted_at is null and ativo for update', [insumoId]
      );
      if (!item.rows[0]) throw DomainError.notFound('Insumo ativo não encontrado.');
      const finalStatus = Number(quantidade) === 0 ? 'ESGOTADO' : status;
      const result = await client.query(`
        insert into insumo_lote (
          insumo_id, numero_lote, validade, data_recebimento,
          quantidade_inicial, quantidade_atual, fornecedor,
          local_armazenamento, certificado_url, status
        ) values ($1, $2, $3, coalesce($4, current_date), $5, $5, $6, $7, $8, $9)
        returning *`, [
        insumoId, numeroLote, validade, dados.data_recebimento || null, quantidade,
        dados.fornecedor?.trim() || null, dados.local_armazenamento?.trim() || null,
        dados.certificado_url?.trim() || null, finalStatus,
      ]);
      const lote = result.rows[0];
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'insumo_lote', entityId: lote.id, afterData: lote,
      });
      if (Number(quantidade) > 0) {
        const movimento = await client.query(`
          insert into estoque_movimentacao (
            insumo_lote_id, tipo, quantidade, saldo_anterior, saldo_posterior,
            motivo, referencia, realizado_por
          ) values ($1, 'ENTRADA', $2, 0, $2, $3, $4, $5)
          returning *`, [
          lote.id, quantidade, dados.motivo || 'Entrada inicial do lote',
          dados.referencia?.trim() || null, auditContext.actorUserId,
        ]);
        await AuditLogModel.record(client, {
          actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
          action: 'CREATE', entityType: 'estoque_movimentacao',
          entityId: movimento.rows[0].id, afterData: movimento.rows[0],
        });
      }
      await client.query('commit');
      return lote;
    } catch (error) {
      await client.query('rollback');
      if (error.code === '23505') throw DomainError.conflict('Este lote já está cadastrado para o insumo.');
      throw error;
    } finally {
      client.release();
    }
  }

  static async updateLote(id, dados, auditContext = {}) {
    if (dados.status !== undefined) {
      throw new DomainError('Use o endpoint de decisão de status para liberar ou bloquear o lote.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(`
        select l.* from insumo_lote l join insumo i on i.id = l.insumo_id
        where l.id = $1 and l.deleted_at is null and i.deleted_at is null for update`, [id]);
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Lote não encontrado.');
      const validade = dados.validade === undefined ? before.validade : dados.validade || null;
      if (validade) {
        const valorData = String(validade).slice(0, 10);
        const parsed = new Date(`${valorData}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(valorData) || Number.isNaN(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== valorData) {
          throw new DomainError('Data de validade inválida.');
        }
      }
      const result = await client.query(`
        update insumo_lote set validade = $2, fornecedor = $3,
          local_armazenamento = $4, certificado_url = $5,
          status = case when quantidade_atual = 0 then 'ESGOTADO' else $6 end
        where id = $1 and deleted_at is null returning *`, [
        id, validade,
        dados.fornecedor === undefined ? before.fornecedor : dados.fornecedor?.trim() || null,
        dados.local_armazenamento === undefined ? before.local_armazenamento : dados.local_armazenamento?.trim() || null,
        dados.certificado_url === undefined ? before.certificado_url : dados.certificado_url?.trim() || null,
        before.status,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'insumo_lote', entityId: id,
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

  static async definirAtivo(id, dados, auditContext = {}) {
    const ativo = booleano(dados.ativo, 'Ativo');
    const motivo = textoObrigatorio(dados.motivo, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from insumo where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Insumo não encontrado.');
      const result = await client.query(
        'update insumo set ativo = $2 where id = $1 returning *', [id, ativo]
      );
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'insumo', entityId: id,
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

  static async definirStatusLote(id, dados, auditContext = {}) {
    const status = String(dados.status || '').toUpperCase();
    if (!STATUS_LOTE.includes(status)) throw new DomainError('Status do lote inválido.');
    const motivo = textoObrigatorio(dados.motivo, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from insumo_lote where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Lote não encontrado.');
      if (Number(before.quantidade_atual) === 0 && status !== 'ESGOTADO') {
        throw DomainError.conflict('Lote sem saldo deve permanecer esgotado.');
      }
      if (Number(before.quantidade_atual) > 0 && status === 'ESGOTADO') {
        throw DomainError.conflict('Lote com saldo não pode ser marcado como esgotado.');
      }
      const hoje = new Date().toISOString().slice(0, 10);
      if (status === 'DISPONIVEL' && before.validade && String(before.validade).slice(0, 10) < hoje) {
        throw DomainError.conflict('Lote vencido não pode ser liberado.');
      }
      const result = await client.query(
        'update insumo_lote set status = $2 where id = $1 returning *', [id, status]
      );
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'UPDATE', entityType: 'insumo_lote', entityId: id,
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

  static async registrarMovimento(loteId, dados, auditContext = {}, tiposPermitidos = MOVIMENTOS_OPERACIONAIS) {
    const tipo = String(dados.tipo || '').toUpperCase();
    if (!tiposPermitidos.includes(tipo)) throw new DomainError('Tipo de movimentação não permitido neste endpoint.');
    const quantidade = quantidadePositiva(dados.quantidade);
    const motivo = textoObrigatorio(dados.motivo, 'Motivo', 3, 500);
    if (!auditContext.actorUserId) throw new DomainError('Usuário responsável não identificado.');
    const entrada = ['ENTRADA', 'AJUSTE_POSITIVO'].includes(tipo);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(`
        select l.*, i.ativo as insumo_ativo
        from insumo_lote l join insumo i on i.id = l.insumo_id
        where l.id = $1 and l.deleted_at is null and i.deleted_at is null
        for update of l`, [loteId]);
      const lote = found.rows[0];
      if (!lote) throw DomainError.notFound('Lote não encontrado.');
      if (!lote.insumo_ativo) throw DomainError.conflict('O insumo está inativo.');
      if (tipo === 'SAIDA') {
        if (lote.validade && new Date(lote.validade) < new Date(new Date().toISOString().slice(0, 10))) {
          throw DomainError.conflict('Lote vencido não pode ser consumido.');
        }
        if (lote.status !== 'DISPONIVEL') {
          throw DomainError.conflict(`Lote ${lote.status.toLowerCase()} não pode ser consumido.`);
        }
      }
      const operator = entrada ? '+' : '-';
      const update = await client.query(`
        update insumo_lote
        set quantidade_atual = quantidade_atual ${operator} $2::numeric,
            status = case
              when quantidade_atual ${operator} $2::numeric = 0 then 'ESGOTADO'
              when $3::boolean and status = 'ESGOTADO' and validade < current_date then 'BLOQUEADO'
              when $3::boolean and status = 'ESGOTADO' and (validade is null or validade >= current_date) then 'DISPONIVEL'
              else status
            end
        where id = $1
          and ($3::boolean or quantidade_atual >= $2::numeric)
        returning *`, [loteId, quantidade, entrada]);
      if (!update.rows[0]) throw DomainError.conflict('Saldo insuficiente para esta movimentação.');
      const afterLote = update.rows[0];
      const movimento = await client.query(`
        insert into estoque_movimentacao (
          insumo_lote_id, tipo, quantidade, saldo_anterior, saldo_posterior,
          motivo, referencia, realizado_por
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *`, [
        loteId, tipo, quantidade, lote.quantidade_atual, afterLote.quantidade_atual,
        motivo, dados.referencia?.trim() || null, auditContext.actorUserId,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'CREATE', entityType: 'estoque_movimentacao',
        entityId: movimento.rows[0].id, afterData: movimento.rows[0],
        metadata: { insumo_id: lote.insumo_id },
      });
      await client.query('commit');
      return { movimento: movimento.rows[0], lote: afterLote };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  static async registrarAjuste(loteId, dados, auditContext = {}) {
    return this.registrarMovimento(loteId, dados, auditContext, MOVIMENTOS_AJUSTE);
  }

  static async findMovimentacoes(loteId, { page, pageSize } = {}) {
    const pg = paginacao(page, pageSize);
    const exists = await pool.query(
      'select 1 from insumo_lote where id = $1 and deleted_at is null', [loteId]
    );
    if (!exists.rows[0]) throw DomainError.notFound('Lote não encontrado.');
    const count = await pool.query(
      'select count(*)::int as total from estoque_movimentacao where insumo_lote_id = $1', [loteId]
    );
    const { rows } = await pool.query(`
      select m.*, u.nome as realizado_por_nome
      from estoque_movimentacao m
      join usuario u on u.id = m.realizado_por
      where m.insumo_lote_id = $1
      order by m.created_at desc, m.id desc
      limit $2 offset $3`, [loteId, pg.pageSize, pg.offset]);
    return { rows, total: count.rows[0].total, page: pg.page, pageSize: pg.pageSize };
  }

  static async archive(id, auditContext = {}) {
    const motivo = textoObrigatorio(auditContext.reason, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from insumo where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Insumo não encontrado.');
      const stock = await client.query(`
        select coalesce(sum(quantidade_atual), 0) as total
        from insumo_lote where insumo_id = $1 and deleted_at is null`, [id]);
      if (Number(stock.rows[0].total) > 0) {
        throw DomainError.conflict('Zere ou transfira o estoque dos lotes antes de arquivar o insumo.');
      }
      const result = await client.query(`
        update insumo set deleted_at = timezone('utc', now()), deleted_by = $2,
          deletion_reason = $3, ativo = false
        where id = $1 and deleted_at is null returning *`, [
        id, auditContext.actorUserId || null,
        motivo,
      ]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'ARCHIVE', entityType: 'insumo', entityId: id,
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

  static async archiveLote(id, auditContext = {}) {
    const motivo = textoObrigatorio(auditContext.reason, 'Motivo', 3, 500);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const found = await client.query(
        'select * from insumo_lote where id = $1 and deleted_at is null for update', [id]
      );
      const before = found.rows[0];
      if (!before) throw DomainError.notFound('Lote não encontrado.');
      if (Number(before.quantidade_atual) > 0) {
        throw DomainError.conflict('Zere ou transfira o saldo antes de arquivar o lote.');
      }
      const result = await client.query(`
        update insumo_lote set deleted_at = timezone('utc', now()),
          deleted_by = $2, deletion_reason = $3
        where id = $1 returning *`, [id, auditContext.actorUserId || null, motivo]);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId, requestId: auditContext.requestId,
        action: 'ARCHIVE', entityType: 'insumo_lote', entityId: id,
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

InventarioModel.MOVIMENTOS_OPERACIONAIS = MOVIMENTOS_OPERACIONAIS;
InventarioModel.MOVIMENTOS_AJUSTE = MOVIMENTOS_AJUSTE;

module.exports = InventarioModel;
