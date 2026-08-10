function unsignedToken(kid) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode({ sub: 'user-1' })}.signature`;
}

function requestFor(kid) {
  return {
    method: 'GET',
    requestId: `request-${kid}`,
    get: jest.fn((header) => header === 'authorization' ? `Bearer ${unsignedToken(kid)}` : undefined),
  };
}

function responseMock() {
  return {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('cache e proteção da consulta JWKS', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalJwksUrl = process.env.SUPABASE_JWKS_URL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.SUPABASE_JWKS_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalJwksUrl === undefined) delete process.env.SUPABASE_JWKS_URL;
    else process.env.SUPABASE_JWKS_URL = originalJwksUrl;
  });

  test('deduplica atualização concorrente e não consulta novamente para cada kid desconhecido', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ keys: [] }),
    });
    const authMiddleware = require('../middleware/Auth');

    const first = responseMock();
    const second = responseMock();
    await Promise.all([
      authMiddleware(requestFor('unknown-1'), first, jest.fn()),
      authMiddleware(requestFor('unknown-2'), second, jest.fn()),
    ]);
    const third = responseMock();
    await authMiddleware(requestFor('unknown-3'), third, jest.fn());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(first.status).toHaveBeenCalledWith(401);
    expect(second.status).toHaveBeenCalledWith(401);
    expect(third.status).toHaveBeenCalledWith(401);
  });
});
