jest.mock('../config/database', () => ({ query: jest.fn() }));

const pool = require('../config/database');
const roleFromTable = require('../middleware/RoleFromTable');

function responseMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('aprovação de acesso e autorização sem cache', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('nega uma conta cadastrada que ainda aguarda aprovação', async () => {
    pool.query.mockResolvedValue({
      rows: [{ perfil: 'Analista', acesso_aprovado: false }],
    });
    const middleware = roleFromTable('Gestor', 'Analista');
    const res = responseMock();
    const next = jest.fn();

    await middleware(
      { user: { id: 'pending-user' }, requestId: 'pending-request' },
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ACESSO_PENDENTE',
      request_id: 'pending-request',
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('autoriza somente quando aprovação e perfil permitem', async () => {
    pool.query.mockResolvedValue({
      rows: [{ perfil: 'Analista', acesso_aprovado: true }],
    });
    const middleware = roleFromTable('Gestor', 'Analista');
    const next = jest.fn();

    await middleware(
      { user: { id: 'approved-user' }, requestId: 'approved-request' },
      responseMock(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('consulta o banco em toda requisição e observa rebaixamento imediatamente', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ perfil: 'Gestor', acesso_aprovado: true }] })
      .mockResolvedValueOnce({ rows: [{ perfil: 'Analista', acesso_aprovado: true }] });
    const middleware = roleFromTable('Gestor');
    const firstNext = jest.fn();
    const secondNext = jest.fn();
    const secondResponse = responseMock();
    await middleware(
      { user: { id: 'manager-user' }, requestId: 'manager-request-1' },
      responseMock(),
      firstNext
    );
    await middleware(
      { user: { id: 'manager-user' }, requestId: 'manager-request-2' },
      secondResponse,
      secondNext
    );

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondResponse.status).toHaveBeenCalledWith(403);
    expect(secondResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PERFIL_NAO_AUTORIZADO',
    }));
    expect(secondNext).not.toHaveBeenCalled();
  });

  test('middlewares encadeados reutilizam apenas o snapshot da mesma requisição', async () => {
    pool.query.mockResolvedValue({
      rows: [{ perfil: 'Analista', acesso_aprovado: true }],
    });
    const registered = roleFromTable('Gestor', 'Analista', 'Usuário');
    const managerOnly = roleFromTable('Gestor');
    const req = { user: { id: 'analyst-user' }, requestId: 'chained-request' };
    const firstNext = jest.fn();
    const secondNext = jest.fn();
    const secondResponse = responseMock();

    await registered(req, responseMock(), firstNext);
    await managerOnly(req, secondResponse, secondNext);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondResponse.status).toHaveBeenCalledWith(403);
    expect(secondResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PERFIL_NAO_AUTORIZADO',
    }));
    expect(secondNext).not.toHaveBeenCalled();
  });

  test('falha fechada em produção antes da migration de aprovação', async () => {
    process.env.NODE_ENV = 'production';
    pool.query.mockResolvedValue({ rows: [{ perfil: 'Gestor', acesso_aprovado: null }] });
    const middleware = roleFromTable('Gestor');
    const res = responseMock();
    const next = jest.fn();

    await middleware(
      { user: { id: 'legacy-manager' }, requestId: 'legacy-request' },
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'MIGRACAO_ACESSO_PENDENTE',
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
