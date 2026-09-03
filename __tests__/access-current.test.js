const express = require('express');
const request = require('supertest');

jest.mock('../config/database', () => ({ query: jest.fn() }));

const pool = require('../config/database');
const accessCurrentRoutes = require('../routes/AcessoAtualRoutes');

describe('autoinspeção do acesso autenticado', () => {
  const ownUserId = '11111111-1111-4111-8111-111111111111';
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: ownUserId };
    req.requestId = 'access-current-request';
    next();
  });
  app.use(accessCurrentRoutes);

  beforeEach(() => jest.clearAllMocks());

  test('retorna conta pendente consultando somente o ID do JWT', async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: ownUserId,
        perfil: 'Usuário',
        schema_aprovacao_disponivel: true,
        acesso_aprovado: false,
      }],
    });

    const response = await request(app)
      .get('/?user_id=22222222-2222-4222-8222-222222222222');

    expect(response.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [ownUserId]);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        cadastrado: true,
        perfil: 'Usuário',
        acesso_aprovado: false,
        schema_ready: true,
        status_acesso: 'pendente',
      },
      request_id: 'access-current-request',
    });
    expect(JSON.stringify(response.body)).not.toContain('22222222');
  });

  test('explicita quando a migration de aprovação ainda não existe', async () => {
    pool.query.mockResolvedValue({
      rows: [{
        id: ownUserId,
        perfil: 'Gestor',
        schema_aprovacao_disponivel: false,
        acesso_aprovado: null,
      }],
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      cadastrado: true,
      acesso_aprovado: null,
      schema_ready: false,
      status_acesso: 'migracao-pendente',
    });
  });

  test('responde 404 seguro quando o JWT não possui cadastro local', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: null, schema_aprovacao_disponivel: true, acesso_aprovado: null }],
    });

    const response = await request(app).get('/');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      code: 'USUARIO_NAO_CADASTRADO',
      data: { cadastrado: false, acesso_aprovado: false, schema_ready: true },
    });
  });
});
