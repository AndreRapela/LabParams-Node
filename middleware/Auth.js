const jwt = require('jsonwebtoken');
const { createPublicKey } = require('crypto');

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const JWKS_UNKNOWN_KID_REFRESH_MS = 30 * 1000;
const JWKS_RETRY_BACKOFF_MS = 5 * 1000;
let jwksCache = { expiresAt: 0, refreshedAt: 0, keys: new Map() };
let jwksRefreshPromise = null;
let jwksRetryAfter = 0;

function getSupabaseIssuer() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  return baseUrl ? `${baseUrl}/auth/v1` : null;
}

function getSupabaseJwksUrl() {
  return (
    process.env.SUPABASE_JWKS_URL ||
    `${getSupabaseIssuer()}/.well-known/jwks.json`
  );
}

async function refreshJwks() {
  if (jwksRefreshPromise) return jwksRefreshPromise;
  if (Date.now() < jwksRetryAfter) throw new Error('JWKS temporariamente indisponível');

  const issuer = getSupabaseIssuer();
  if (!issuer) throw new Error('SUPABASE_URL não configurada');

  jwksRefreshPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(getSupabaseJwksUrl(), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`JWKS indisponível (${response.status})`);

      const { keys = [] } = await response.json();
      const refreshedAt = Date.now();
      jwksCache = {
        expiresAt: refreshedAt + JWKS_CACHE_TTL_MS,
        refreshedAt,
        keys: new Map(keys.map((key) => [key.kid, key])),
      };
      jwksRetryAfter = 0;
    } catch (error) {
      jwksRetryAfter = Date.now() + JWKS_RETRY_BACKOFF_MS;
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  try {
    return await jwksRefreshPromise;
  } finally {
    jwksRefreshPromise = null;
  }
}

async function getPublicKey(kid) {
  if (!kid) throw new Error('Token sem identificador de chave');

  const now = Date.now();
  if (jwksCache.expiresAt <= now) {
    await refreshJwks();
  } else if (!jwksCache.keys.has(kid)
      && now - jwksCache.refreshedAt >= JWKS_UNKNOWN_KID_REFRESH_MS) {
    await refreshJwks();
  }

  const jwk = jwksCache.keys.get(kid);
  if (!jwk) throw new Error('Chave de assinatura não encontrada');
  return createPublicKey({ key: jwk, format: 'jwk' });
}

async function verifySupabaseToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  const algorithm = decoded?.header?.alg;

  if (algorithm === 'HS256') {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) throw new Error('SUPABASE_JWT_SECRET não configurado');
    return jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: getSupabaseIssuer(),
      audience: 'authenticated',
    });
  }

  if (!['ES256', 'RS256'].includes(algorithm)) {
    throw new Error('Algoritmo de assinatura não permitido');
  }

  const issuer = getSupabaseIssuer();
  const publicKey = await getPublicKey(decoded.header.kid);
  return jwt.verify(token, publicKey, {
    algorithms: [algorithm],
    issuer,
    audience: 'authenticated',
  });
}

function respondAfterRequestBody(req, res, status, payload) {
  const responsePayload = { ...payload, request_id: payload.request_id || req.requestId };
  const send = () => {
    if (!res.headersSent) res.status(status).json(responsePayload);
  };

  if (!req.readable || req.readableEnded || ['GET', 'HEAD'].includes(req.method)) {
    return send();
  }

  req.once('end', send);
  req.once('error', send);
  req.resume();
}

module.exports = async function authMiddleware(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return respondAfterRequestBody(req, res, 401, {
      error: 'Token ausente ou mal formatado',
    });
  }

  if (!process.env.SUPABASE_URL) {
    return respondAfterRequestBody(req, res, 500, {
      error: 'Autenticação não configurada',
    });
  }

  try {
    const decoded = await verifySupabaseToken(authorization.slice(7).trim());

    if (!decoded.sub) {
      return respondAfterRequestBody(req, res, 401, { error: 'Token inválido' });
    }

    req.user = {
      ...decoded,
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };
    return next();
  } catch (error) {
    const message =
      error.name === 'TokenExpiredError'
        ? 'Sessão expirada. Faça login novamente.'
        : 'Token inválido';
    return respondAfterRequestBody(req, res, 401, { error: message });
  }
};
