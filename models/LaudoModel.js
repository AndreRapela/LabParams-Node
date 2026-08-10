const { createHash } = require('crypto');
const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const AssinaturaEletronicaModel = require('./AssinaturaEletronicaModel');
const { avaliarConformidade } = require('../utils/conformidade');
const { canonicalStringify } = require('../utils/canonicalJson');
const { parsePagination, workflowError } = require('../utils/workflowPiloto');

function safeText(value, max = 5_000) {
  const normalized = String(value ?? '').trim();
  if (normalized.length > max) {
    throw workflowError(`Texto excede ${max} caracteres.`, 400, 'VALIDACAO');
  }
  return normalized || null;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function canonicalHash(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function isoTimestamp(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function labSnapshot() {
  return {
    nome: safeText(process.env.LAB_NOME ?? 'Laboratório emissor', 200),
    documento: safeText(process.env.LAB_DOCUMENTO, 50),
    endereco: safeText(process.env.LAB_ENDERECO, 500),
    contato: safeText(process.env.LAB_CONTATO, 200),
  };
}

function signatureIsValid(row) {
  const metadata = parseJson(row.assinatura_metadata);
  if (!row.assinatura_id || !metadata?.snapshot_hash || !metadata?.nonce) return false;
  if (row.assinatura_action !== 'REPORT_ISSUE'
      || row.assinatura_entity_type !== 'laudo_analitico'
      || String(row.assinatura_entity_id) !== String(row.id)
      || row.assinatura_auth_method !== 'supabase_password') {
    return false;
  }

  const signedEntity = { snapshot: row.snapshot, conteudo_hash: row.conteudo_hash };
  const snapshotHash = canonicalHash(signedEntity);
  if (snapshotHash !== metadata.snapshot_hash) return false;

  const authenticatedAt = isoTimestamp(row.assinatura_authenticated_at);
  const signedAt = isoTimestamp(row.assinatura_signed_at);
  if (!authenticatedAt || !signedAt) return false;
  const authenticationAgeMs = new Date(signedAt).getTime() - new Date(authenticatedAt).getTime();
  if (authenticationAgeMs < 0 || authenticationAgeMs > 5 * 60 * 1_000) return false;
  const emittedAt = isoTimestamp(row.emitido_em);
  if (emittedAt && new Date(signedAt).getTime() > new Date(emittedAt).getTime() + 30_000) {
    return false;
  }

  const payloadHash = canonicalHash({
    actorUserId: row.assinatura_signer_user_id,
    entityType: row.assinatura_entity_type,
    entityId: String(row.assinatura_entity_id),
    action: row.assinatura_action,
    authMethod: row.assinatura_auth_method,
    authenticatedAt,
    signedAt,
    snapshotHash,
    requestId: row.assinatura_request_id || null,
    nonce: metadata.nonce,
  });
  return payloadHash === row.assinatura_payload_hash;
}

function withIntegrity(row) {
  const contentIsValid = canonicalHash(row.snapshot) === row.conteudo_hash;
  const electronicSignatureIsValid = signatureIsValid(row);
  const {
    assinatura_signer_user_id: _signerUserId,
    assinatura_entity_type: _entityType,
    assinatura_entity_id: _entityId,
    assinatura_action: signatureAction,
    assinatura_auth_method: signatureMethod,
    assinatura_authenticated_at: _authenticatedAt,
    assinatura_signed_at: signatureAt,
    assinatura_payload_hash: signatureHash,
    assinatura_request_id: _signatureRequestId,
    assinatura_metadata: _signatureMetadata,
    ...report
  } = row;

  return {
    ...report,
    integridade_conteudo_valida: contentIsValid,
    assinatura_valida: electronicSignatureIsValid,
    integridade_valida: contentIsValid && electronicSignatureIsValid,
    assinatura: row.assinatura_id ? {
      id: row.assinatura_id,
      acao: signatureAction,
      metodo: signatureMethod,
      assinada_em: signatureAt,
      hash: signatureHash,
      valida: electronicSignatureIsValid,
    } : null,
  };
}

function signatureSelect() {
  return `
    s.id as assinatura_id,
    s.signer_user_id as assinatura_signer_user_id,
    s.entity_type as assinatura_entity_type,
    s.entity_id as assinatura_entity_id,
    s.action as assinatura_action,
    s.auth_method as assinatura_auth_method,
    s.authenticated_at as assinatura_authenticated_at,
    s.signed_at as assinatura_signed_at,
    s.payload_hash as assinatura_payload_hash,
    s.request_id as assinatura_request_id,
    s.metadata as assinatura_metadata
  `;
}

function resultFromSnapshot(row) {
  const analytical = parseJson(row.snapshot_analitico);
  const parameter = analytical?.parametro;
  const legal = analytical?.referencia_legal;
  const method = analytical?.metodo;
  if (!analytical || !parameter?.nome || !legal || !method
      || Number(analytical.versao_resultado) !== Number(row.versao)
      || Number(parameter.id) !== Number(row.parametro_id)) {
    throw workflowError(
      `O resultado ${row.id} não possui snapshot analítico completo e coerente.`,
      409,
      'SNAPSHOT_ANALITICO_INCOMPLETO'
    );
  }

  const conformityInput = {
    valor_medido: analytical.valor_medido,
    valor_qualitativo: analytical.valor_qualitativo,
    limite_minimo: legal.limite_minimo,
    limite_maximo: legal.limite_maximo,
    tipo_limite: legal.tipo_limite,
  };

  return {
    id: row.id,
    versao: row.versao,
    parametro: parameter.nome,
    unidade: parameter.unidade_medida,
    tipo_resultado: parameter.tipo_resultado,
    valor_medido: analytical.valor_medido,
    valor_qualitativo: analytical.valor_qualitativo,
    status_conformidade: avaliarConformidade(conformityInput),
    limite_minimo: legal.limite_minimo,
    limite_maximo: legal.limite_maximo,
    tipo_limite: legal.tipo_limite,
    criterio_legal: legal.criterio,
    fonte_legal: legal.fonte,
    legislacao: {
      id: legal.legislacao_id,
      nome: legal.legislacao_nome,
      sigla: legal.legislacao_sigla,
    },
    contexto: {
      id: legal.contexto_id,
      nome: legal.contexto_nome,
      codigo: legal.contexto_codigo,
    },
    metodo: method,
    status_resultado: row.status_resultado,
    aprovado_em: row.aprovado_em,
    aprovado_por: row.aprovado_por_nome,
    publicado_em: row.publicado_em,
    publicado_por: row.publicado_por_nome,
  };
}

class LaudoModel {
  static async generate(sampleId, input = {}, audit = {}) {
    if (!audit.actorUserId) {
      throw workflowError('Usuário emissor não identificado.', 401, 'USUARIO_NAO_IDENTIFICADO');
    }
    if (!audit.signatureContext
        || String(audit.signatureContext.userId) !== String(audit.actorUserId)) {
      throw workflowError(
        'Confirme sua senha para assinar a emissão do laudo.',
        401,
        'ASSINATURA_OBRIGATORIA'
      );
    }

    const observations = safeText(input.observacoes);
    const revisionReason = safeText(input.motivo ?? input.motivo_revisao, 2_000);
    const laboratory = labSnapshot();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const sampleResult = await client.query(`
        select a.*, m.nome as matriz_nome,
               pa.codigo as pedido_codigo, pa.solicitante, pa.descricao as pedido_descricao,
               pa.data_entrada, pa.prazo, pa.prioridade, pa.status as pedido_status,
               c.id as cliente_id, c.codigo as cliente_codigo,
               c.nome_razao_social, c.nome_fantasia, c.documento as cliente_documento,
               c.email as cliente_email, c.telefone as cliente_telefone,
               c.endereco as cliente_endereco
        from amostra a
        join matriz m on a.matriz_id = m.id
        left join pedido_analise pa on a.pedido_analise_id = pa.id
        left join cliente c on pa.cliente_id = c.id
        where a.id = $1 and a.deleted_at is null
        for update of a
      `, [sampleId]);
      const sample = sampleResult.rows[0];
      if (!sample) throw workflowError('Amostra não encontrada.', 404, 'NAO_ENCONTRADA');
      if (sample.status_amostra !== 'concluida') {
        throw workflowError(
          'O laudo só pode ser emitido depois que a amostra estiver concluída.',
          409,
          'AMOSTRA_NAO_CONCLUIDA'
        );
      }

      const scopeResult = await client.query(`
        with expected as (
          select parametro_id from amostra_parametro where amostra_id = $1
        ), active_results as (
          select id, parametro_id, status_resultado
          from resultado_analise
          where amostra_id = $1 and deleted_at is null
        )
        select
          (select count(*)::int from expected) as esperados,
          (select count(*)::int from active_results) as registrados,
          (select count(*)::int from active_results where status_resultado = 'publicado') as publicados,
          (select count(*)::int from expected e join active_results r using (parametro_id)) as correspondentes
      `, [sampleId]);
      const scope = scopeResult.rows[0];
      if (scope.esperados < 1
          || scope.registrados !== scope.esperados
          || scope.publicados !== scope.esperados
          || scope.correspondentes !== scope.esperados) {
        throw workflowError(
          'O escopo da amostra deve ter exatamente um resultado publicado para cada parâmetro.',
          409,
          'ESCOPO_RESULTADOS_INCOMPLETO'
        );
      }

      const resultSet = await client.query(`
        select ra.id, ra.parametro_id, ra.versao, ra.status_resultado,
               ra.snapshot_analitico, ra.aprovado_em, ra.publicado_em,
               ua.nome as aprovado_por_nome, up.nome as publicado_por_nome
        from resultado_analise ra
        left join usuario ua on ra.aprovado_por = ua.id
        left join usuario up on ra.publicado_por = up.id
        where ra.amostra_id = $1 and ra.deleted_at is null
        order by ra.parametro_id, ra.id
        for share of ra
      `, [sampleId]);
      const results = resultSet.rows.map(resultFromSnapshot);

      const issuerResult = await client.query(
        'select id, nome, email from usuario where id = $1',
        [audit.actorUserId]
      );
      const issuer = issuerResult.rows[0];
      if (!issuer) throw workflowError('Usuário emissor não cadastrado.', 403, 'EMISSOR_INVALIDO');

      const versionResult = await client.query(
        'select coalesce(max(versao), 0)::int + 1 as proxima from laudo_analitico where amostra_id = $1',
        [sampleId]
      );
      const version = versionResult.rows[0].proxima;
      if (version > 1 && !revisionReason) {
        throw workflowError(
          'Informe o motivo da nova versão do laudo.',
          400,
          'MOTIVO_REVISAO_OBRIGATORIO'
        );
      }

      const idResult = await client.query(
        "select nextval(pg_get_serial_sequence('public.laudo_analitico', 'id'))::bigint as id"
      );
      const reportId = idResult.rows[0].id;
      const codePart = String(sample.codigo_amostra)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || String(sample.id);
      const number = `LAU-${codePart}-${sample.id}-V${version}`.toUpperCase();
      const emittedAt = new Date().toISOString();
      const snapshot = {
        documento: {
          id: String(reportId),
          numero: number,
          versao: version,
          emitido_em: emittedAt,
          motivo_revisao: version > 1 ? revisionReason : null,
        },
        laboratorio: laboratory,
        cliente: sample.cliente_id ? {
          id: sample.cliente_id,
          codigo: sample.cliente_codigo,
          nome_razao_social: sample.nome_razao_social,
          nome_fantasia: sample.nome_fantasia,
          documento: sample.cliente_documento,
          email: sample.cliente_email,
          telefone: sample.cliente_telefone,
          endereco: sample.cliente_endereco,
        } : null,
        pedido: sample.pedido_analise_id ? {
          id: sample.pedido_analise_id,
          codigo: sample.pedido_codigo,
          solicitante: sample.solicitante,
          descricao: sample.pedido_descricao,
          data_entrada: sample.data_entrada,
          prazo: sample.prazo,
          prioridade: sample.prioridade,
          status: sample.pedido_status,
        } : null,
        amostra: {
          id: sample.id,
          codigo_amostra: sample.codigo_amostra,
          numero_da_amostra: sample.numero_da_amostra,
          data_coleta: sample.data_coleta,
          localizacao: sample.localizacao,
          local_atual: sample.local_atual,
          matriz: sample.matriz_nome,
          status: sample.status_amostra,
        },
        resultados: results,
        responsavel: {
          id: issuer.id,
          nome: issuer.nome,
          email: issuer.email,
        },
        observacoes: observations,
      };
      const contentHash = canonicalHash(snapshot);
      const signature = await AssinaturaEletronicaModel.create(client, {
        actorUserId: audit.actorUserId,
        entityType: 'laudo_analitico',
        entityId: reportId,
        action: 'REPORT_ISSUE',
        authenticatedAt: audit.signatureContext.authenticatedAt,
        authMethod: audit.signatureContext.authMethod,
        entitySnapshot: { snapshot, conteudo_hash: contentHash },
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        requestId: audit.requestId,
      });

      const inserted = await client.query(`
        insert into laudo_analitico (
          id, numero, amostra_id, pedido_analise_id, versao, snapshot,
          conteudo_hash, observacoes, motivo_revisao, emitido_por,
          assinatura_eletronica_id, emitido_em, request_id
        ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
        returning *
      `, [
        reportId,
        number,
        sample.id,
        sample.pedido_analise_id,
        version,
        JSON.stringify(snapshot),
        contentHash,
        observations,
        version > 1 ? revisionReason : null,
        audit.actorUserId,
        signature.id,
        emittedAt,
        audit.requestId || null,
      ]);

      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId,
        requestId: audit.requestId,
        action: 'REPORT_GENERATE',
        entityType: 'laudo_analitico',
        entityId: reportId,
        afterData: {
          id: reportId,
          numero: number,
          amostra_id: sample.id,
          versao: version,
          conteudo_hash: contentHash,
          assinatura_eletronica_id: signature.id,
        },
        metadata: {
          motivo_revisao: version > 1 ? revisionReason : null,
          assinatura_hash: signature.payload_hash,
        },
      });
      await client.query('COMMIT');
      return { ...inserted.rows[0], assinatura: signature, integridade_valida: true };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505'
          && error.constraint === 'laudo_analitico_amostra_id_versao_key') {
        throw workflowError(
          'Outra versão do laudo foi emitida simultaneamente. Atualize a lista e tente novamente.',
          409,
          'CONFLITO_VERSAO_LAUDO'
        );
      }
      if (error.code === '23505'
          && error.constraint === 'laudo_analitico_numero_key') {
        throw workflowError(
          'Não foi possível reservar um identificador único para o laudo.',
          409,
          'IDENTIFICADOR_LAUDO_DUPLICADO'
        );
      }
      if (error.code === '23505'
          && ['laudo_conteudo_hash_uidx', 'laudo_assinatura_eletronica_uidx']
            .includes(error.constraint)) {
        throw workflowError(
          'Este conteúdo ou assinatura já foi utilizado em outro laudo.',
          409,
          'EVIDENCIA_LAUDO_DUPLICADA'
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static async findById(id) {
    const { rows } = await pool.query(`
      select la.*, u.nome as emitido_por_nome, u.email as emitido_por_email,
             ${signatureSelect()}
      from laudo_analitico la
      join usuario u on la.emitido_por = u.id
      left join assinatura_eletronica s on s.id = la.assinatura_eletronica_id
      where la.id = $1
    `, [id]);
    return rows[0] ? withIntegrity(rows[0]) : null;
  }

  static async findBySample(sampleId) {
    const { rows } = await pool.query(`
      select la.id, la.numero, la.amostra_id, la.pedido_analise_id, la.versao,
             la.conteudo_hash, la.observacoes, la.motivo_revisao,
             la.emitido_por, la.assinatura_eletronica_id, la.emitido_em,
             u.nome as emitido_por_nome
      from laudo_analitico la
      join usuario u on la.emitido_por = u.id
      where la.amostra_id = $1
      order by la.versao desc
    `, [sampleId]);
    return rows;
  }

  static async verify(contentHash) {
    const hash = String(contentHash ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw workflowError('Hash de verificação inválido.', 400, 'HASH_INVALIDO');
    }

    const { rows } = await pool.query(`
       select la.id, la.numero, la.versao, la.emitido_em, la.conteudo_hash,
              la.snapshot,
             la.snapshot->'laboratorio'->>'nome' as laboratorio_nome,
             jsonb_array_length(la.snapshot->'resultados')::int as total_resultados,
             ${signatureSelect()}
      from laudo_analitico la
      left join assinatura_eletronica s on s.id = la.assinatura_eletronica_id
      where la.conteudo_hash = $1
      limit 1
    `, [hash]);
    if (!rows[0]) return null;

    const verified = withIntegrity(rows[0]);
    return {
      numero: verified.numero,
      versao: verified.versao,
      emitido_em: verified.emitido_em,
      conteudo_hash: verified.conteudo_hash,
      laboratorio_nome: verified.laboratorio_nome,
      total_resultados: verified.total_resultados,
      integridade_conteudo_valida: verified.integridade_conteudo_valida,
      assinatura_valida: verified.assinatura_valida,
      integridade_valida: verified.integridade_valida,
      assinatura: verified.assinatura,
    };
  }

  static async findAll(options = {}) {
    const pagination = parsePagination(options);
    const values = [];
    const filters = [];
    if (options.amostra_id) {
      values.push(options.amostra_id);
      filters.push(`la.amostra_id = $${values.length}`);
    }
    if (options.cliente_id) {
      values.push(options.cliente_id);
      filters.push(`c.id = $${values.length}`);
    }
    if (options.q) {
      values.push(`%${String(options.q).trim().slice(0, 100)}%`);
      filters.push(`(
        la.numero ilike $${values.length}
        or a.codigo_amostra ilike $${values.length}
        or a.numero_da_amostra ilike $${values.length}
        or coalesce(c.nome_razao_social, '') ilike $${values.length}
      )`);
    }
    const where = filters.length ? `where ${filters.join(' and ')}` : '';
    let limit = '';
    if (pagination) {
      values.push(pagination.pageSize, pagination.offset);
      limit = `limit $${values.length - 1} offset $${values.length}`;
    }

    const { rows } = await pool.query(`
      select la.id, la.numero, la.amostra_id, la.pedido_analise_id, la.versao,
             la.conteudo_hash, la.observacoes, la.motivo_revisao,
             la.emitido_por, la.assinatura_eletronica_id, la.emitido_em,
             a.codigo_amostra, a.numero_da_amostra,
             c.nome_razao_social as cliente_nome, u.nome as emitido_por_nome,
             jsonb_array_length(la.snapshot->'resultados')::int as total_resultados,
             count(*) over()::int as total_count
      from laudo_analitico la
      join amostra a on la.amostra_id = a.id
      left join pedido_analise pa on la.pedido_analise_id = pa.id
      left join cliente c on pa.cliente_id = c.id
      join usuario u on la.emitido_por = u.id
      ${where}
      order by la.emitido_em desc, la.id desc
      ${limit}
    `, values);
    const total = rows[0]?.total_count ?? 0;
    const clean = rows.map(({ total_count, ...row }) => row);
    return pagination ? { rows: clean, total, ...pagination } : clean;
  }
}

module.exports = LaudoModel;
