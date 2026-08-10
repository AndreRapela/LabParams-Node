const express = require('express');
const request = require('supertest');
const createUserRouteRateLimiter = require('../middleware/UserRouteRateLimit');

describe('rate limiter por usuário e operação assinada', () => {
  test('compartilha o limite entre operações e isola usuários', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: req.get('x-test-user') || 'anonymous' };
      next();
    });
    const signedActionLimit = createUserRouteRateLimiter({
      scope: 'test-signed-actions', windowMs: 60_000, limit: 2,
    });
    const invalidSignature = (_req, res) => {
      res.locals.signatureVerificationFailed = true;
      return res.status(401).json({ ok: false });
    };
    app.post('/review', signedActionLimit, invalidSignature);
    app.post('/publish', signedActionLimit, invalidSignature);
    app.post('/report', signedActionLimit, invalidSignature);

    await request(app).post('/review').set('x-test-user', 'user-1').expect(401);
    await request(app).post('/publish').set('x-test-user', 'user-1').expect(401);
    const limited = await request(app).post('/report').set('x-test-user', 'user-1').expect(429);
    expect(limited.body.code).toBe('LIMITE_REAUTENTICACAO');

    await request(app).post('/review').set('x-test-user', 'user-2').expect(401);
  });

  test('usa configuração segura quando o limite informado é inválido', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'user-safe-default' };
      next();
    });
    app.post('/signed', createUserRouteRateLimiter({
      scope: 'test-safe-default', windowMs: -1, limit: -10,
    }), (_req, res) => {
      res.locals.signatureVerificationFailed = true;
      return res.status(401).json({ ok: false });
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/signed').expect(401);
    }
    await request(app).post('/signed').expect(429);
  });

  test('não pune assinaturas confirmadas com sucesso', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 'user-valid-signature' };
      next();
    });
    app.post('/signed', createUserRouteRateLimiter({
      scope: 'test-valid-signature', windowMs: 60_000, limit: 1,
    }), (_req, res) => res.json({ ok: true }));

    await request(app).post('/signed').expect(200);
    await request(app).post('/signed').expect(200);
  });

  test('as rotas críticas reutilizam exatamente o mesmo middleware', () => {
    const { sharedSignatureRateLimiter } = require('../middleware/UserRouteRateLimit');
    const resultadoRoutes = require('../routes/ResultadoAnaliseRoutes');
    const laudoRoutes = require('../routes/LaudoRoutes');

    const routeUsesSharedLimiter = (router, path) => {
      const layer = router.stack.find((candidate) => candidate.route?.path === path);
      return layer?.route?.stack.some(
        (routeLayer) => routeLayer.handle === sharedSignatureRateLimiter
      );
    };

    for (const path of [
      '/:id/revisar',
      '/:id/aprovar',
      '/:id/rejeitar',
      '/:id/publicar',
      '/:id/reabrir',
    ]) {
      expect(routeUsesSharedLimiter(resultadoRoutes, path)).toBe(true);
    }
    expect(routeUsesSharedLimiter(laudoRoutes, '/amostras/:amostraId/versoes')).toBe(true);
  });
});
