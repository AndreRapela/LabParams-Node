const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const PostgresRateLimitStore = require('./PostgresRateLimitStore');

function createUserRouteRateLimiter({
  scope,
  windowMs = 10 * 60 * 1_000,
  limit = process.env.SIGNATURE_RATE_LIMIT_MAX ?? 5,
  store,
} = {}) {
  if (!scope) throw new Error('O escopo do rate limiter é obrigatório.');
  const parsedLimit = Number(limit);
  const parsedWindow = Number(windowMs);
  const safeLimit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 100)
    : 5;
  const safeWindow = Number.isInteger(parsedWindow) && parsedWindow >= 1_000
    ? Math.min(parsedWindow, 24 * 60 * 60 * 1_000)
    : 10 * 60 * 1_000;

  const options = {
    windowMs: safeWindow,
    limit: safeLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful(_req, res) {
      return res.locals.signatureVerificationFailed !== true;
    },
    keyGenerator(req) {
      const identity = req.user?.id
        ? `user:${req.user.id}`
        : `ip:${ipKeyGenerator(req.ip || '')}`;
      return `${scope}:${identity}`;
    },
    handler(req, res) {
      return res.status(429).json({
        success: false,
        message: 'Muitas tentativas de confirmação. Aguarde alguns minutos.',
        code: 'LIMITE_REAUTENTICACAO',
        request_id: req.requestId,
      });
    },
    passOnStoreError: false,
  };

  if (store) options.store = store;
  return rateLimit(options);
}

module.exports = createUserRouteRateLimiter;

// Uma única instância é reutilizada por todas as operações que confirmam senha.
// Assim, tentativas feitas em endpoints diferentes consomem o mesmo orçamento,
// inclusive quando a API está distribuída em mais de um processo/servidor.
module.exports.sharedSignatureRateLimiter = createUserRouteRateLimiter({
  scope: 'assinatura-global',
  windowMs: process.env.SIGNATURE_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1_000,
  store: new PostgresRateLimitStore(),
});
