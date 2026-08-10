const { createHash, randomUUID } = require('crypto');
const { canonicalStringify } = require('../utils/canonicalJson');
const { workflowError } = require('../utils/workflowPiloto');

const AUTHENTICATION_MAX_AGE_MS = 5 * 60 * 1_000;

class AssinaturaEletronicaModel {
  static async create(db, {
    actorUserId,
    entityType,
    entityId,
    action,
    authenticatedAt,
    authMethod = 'supabase_password',
    entitySnapshot,
    ipAddress,
    userAgent,
    requestId,
  }) {
    if (!db || !actorUserId || !entityType || entityId === undefined || !action) {
      throw new Error('Contexto incompleto para assinatura eletrônica.');
    }

    const signedAt = new Date().toISOString();
    const authenticatedAtMs = new Date(authenticatedAt).getTime();
    const signedAtMs = new Date(signedAt).getTime();
    const authenticationAgeMs = signedAtMs - authenticatedAtMs;
    if (!Number.isFinite(authenticatedAtMs)
        || authenticationAgeMs < 0
        || authenticationAgeMs > AUTHENTICATION_MAX_AGE_MS) {
      throw workflowError(
        'A confirmação de identidade expirou. Informe a senha novamente.',
        401,
        'REAUTENTICACAO_EXPIRADA'
      );
    }
    const nonce = randomUUID();
    const snapshotHash = createHash('sha256')
      .update(canonicalStringify(entitySnapshot ?? null))
      .digest('hex');
    const payloadHash = createHash('sha256')
      .update(canonicalStringify({
        actorUserId,
        entityType,
        entityId: String(entityId),
        action,
        authMethod,
        authenticatedAt,
        signedAt,
        snapshotHash,
        requestId: requestId || null,
        nonce,
      }))
      .digest('hex');

    const { rows } = await db.query(`
      insert into assinatura_eletronica (
        signer_user_id, entity_type, entity_id, action, auth_method,
        authenticated_at, signed_at, payload_hash, ip_address, user_agent,
        request_id, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      returning id, signer_user_id, entity_type, entity_id, action, auth_method,
                authenticated_at, signed_at, payload_hash
    `, [
      actorUserId,
      entityType,
      String(entityId),
      action,
      authMethod,
      authenticatedAt,
      signedAt,
      payloadHash,
      String(ipAddress ?? '').slice(0, 100) || null,
      String(userAgent ?? '').slice(0, 500) || null,
      requestId || null,
      JSON.stringify({
        snapshot_hash: snapshotHash,
        nonce,
        entity_version: entitySnapshot?.versao_resultado
          ?? entitySnapshot?.snapshot?.documento?.versao
          ?? null,
        status_origin: entitySnapshot?.status_origem ?? null,
        status_destination: entitySnapshot?.status_destino ?? null,
      }),
    ]);

    return rows[0];
  }
}

module.exports = AssinaturaEletronicaModel;
