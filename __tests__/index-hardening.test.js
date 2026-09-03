const request = require('supertest');

const mockDbQuery = jest.fn();
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const mockMembershipMiddleware = jest.fn((req, res) => res.status(403).json({
  success: false,
  error: 'Usuário não cadastrado',
  request_id: req.requestId,
}));
const mockRoleFactory = jest.fn((...roles) => {
  const isRegisteredUserCheck = roles.length === 3
    && ['Gestor', 'Analista', 'Usuário'].every((role) => roles.includes(role));
  return isRegisteredUserCheck
    ? mockMembershipMiddleware
    : (_req, _res, next) => next();
});
mockRoleFactory.invalidate = jest.fn();

jest.mock('../config/database', () => ({
  query: (...args) => mockDbQuery(...args),
  connect: jest.fn(),
  end: jest.fn(),
}));
jest.mock('../utils/logger', () => mockLogger);
jest.mock('../routes/VerificacaoLaudoRoutes', () => {
  const express = require('express');
  const router = express.Router();
  router.get('/:hash', () => {
    throw Object.assign(
      new Error('getaddrinfo ENOTFOUND private-project.supabase.co password=super-secret'),
      { code: 'ENOTFOUND', hostname: 'private-project.supabase.co' }
    );
  });
  return router;
});
jest.mock('../middleware/Auth', () => (req, _res, next) => {
  req.user = { id: 'authenticated-but-not-registered', email: 'external@example.test' };
  next();
});
jest.mock('../middleware/RoleFromTable', () => mockRoleFactory);

const app = require('../index');

describe('hardening HTTP da aplicação', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
    mockMembershipMiddleware.mockClear();
  });

  test('readiness agrupa chamadas simultâneas e registra falha DNS sem dados sensíveis', async () => {
    mockDbQuery.mockRejectedValueOnce(Object.assign(
      new Error('getaddrinfo ENOTFOUND private-project.supabase.co'),
      { code: 'ENOTFOUND', hostname: 'private-project.supabase.co' }
    ));

    const [first, second] = await Promise.all([
      request(app).get('/health/ready'),
      request(app).get('/health'),
    ]);

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]).toEqual([
      'readiness_check_failed',
      expect.objectContaining({ category: 'dns', code: 'ENOTFOUND' }),
    ]);
    expect(JSON.stringify(mockLogger.warn.mock.calls[0])).not.toContain('private-project');
    expect(first.headers['cache-control']).toBe('no-store');
  });

  test.each([
    '/dashboardtv',
    '/dashboard-web',
    '/grafico-parametros',
    '/matrizes',
    '/legislacoes',
  ])('bloqueia usuário autenticado sem cadastro local em %s', async (path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Usuário não cadastrado');
  });

  test('responde JSON inválido como erro 400 sem registrar o conteúdo', async () => {
    const response = await request(app)
      .post('/rota-inexistente')
      .set('Content-Type', 'application/json')
      .send('{"senha":"segredo",');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_JSON');
    expect(response.body.request_id).toBeTruthy();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  test('recusa array JSON como corpo de comando', async () => {
    const response = await request(app)
      .post('/rota-inexistente')
      .send([{ campo: 'valor' }]);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_BODY');
  });

  test('handler genérico não registra mensagem, host ou segredo em produção', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const sensitiveHash = 'a'.repeat(64);
      const response = await request(app).get(`/verificar-laudo/${sensitiveHash}`);

      expect(response.status).toBe(500);
      expect(mockLogger.error).toHaveBeenCalledWith('unhandled_error', expect.objectContaining({
        category: 'dns',
        code: 'ENOTFOUND',
      }));
      const serializedLog = JSON.stringify(mockLogger.error.mock.calls[0]);
      expect(serializedLog).not.toContain('private-project');
      expect(serializedLog).not.toContain('super-secret');
      expect(serializedLog).not.toContain('message');
      expect(serializedLog).not.toContain('stack');
      expect(serializedLog).not.toContain(sensitiveHash);
      expect(mockLogger.error).toHaveBeenCalledWith('unhandled_error', expect.objectContaining({
        path: '/verificar-laudo/:hash',
      }));
      expect(mockLogger.info).toHaveBeenCalledWith('http_request', expect.objectContaining({
        path: '/verificar-laudo/:hash',
      }));
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
