const express = require('express');
const request = require('supertest');

const mockCreateUser = jest.fn();
const mockGetUserById = jest.fn();
const mockUpdateUserById = jest.fn();

jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../models/AuditLogModel', () => ({ record: jest.fn().mockResolvedValue(null) }));
jest.mock('../config/supabaseAdmin', () => ({
  getSupabaseAdminClient: () => ({
    auth: { admin: {
      createUser: (...args) => mockCreateUser(...args),
      getUserById: (...args) => mockGetUserById(...args),
      updateUserById: (...args) => mockUpdateUserById(...args),
    } },
  }),
}));

const {
  PASSWORD_MIN_LENGTH,
  validateNewUserPassword,
} = require('../utils/passwordPolicy');
const userRoutes = require('../routes/UsuarioRoutes');
const pool = require('../config/database');

describe('política de senha na criação administrativa de usuários', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'gestor-test' };
    req.requestId = 'password-policy-test';
    next();
  });
  app.use(userRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateUser.mockResolvedValue({
      data: { user: { id: 'new-user', email: 'novo@example.com' } },
      error: null,
    });
    mockGetUserById.mockResolvedValue({ data: { user: null }, error: null });
    mockUpdateUserById.mockResolvedValue({ data: { user: null }, error: null });
  });

  test('espelha o mínimo de 12 e todas as classes exigidas pelo Supabase', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(validateNewUserPassword('admin123')).toMatchObject({ valid: false });
    expect(validateNewUserPassword('minusculas123!')).toMatchObject({ valid: false });
    expect(validateNewUserPassword('MAIUSCULAS123!')).toMatchObject({ valid: false });
    expect(validateNewUserPassword('SemNumero!!!!')).toMatchObject({ valid: false });
    expect(validateNewUserPassword('SemSimbolo123')).toMatchObject({ valid: false });
    expect(validateNewUserPassword('SenhaSegura123!')).toMatchObject({ valid: true, missing: [] });
  });

  test('rejeita senha fraca antes de chamar a API administrativa', async () => {
    const response = await request(app).post('/').send({
      nome: 'Novo Usuário',
      email: 'novo@example.com',
      senha: 'admin123',
      perfil: 'Analista',
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: 'SENHA_FRACA' });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  test('encaminha senha forte sem alterá-la e cria o usuário', async () => {
    const password = 'SenhaSegura123!';
    const response = await request(app).post('/').send({
      nome: 'Novo Usuário',
      email: 'NOVO@example.com',
      senha: password,
      perfil: 'Analista',
    });

    expect(response.status).toBe(201);
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'novo@example.com',
      password,
      email_confirm: true,
      app_metadata: expect.objectContaining({
        perfil: 'Analista',
        sysmlab_access_approved: true,
        sysmlab_access_approved_by: 'gestor-test',
      }),
    }));
    expect(response.body.data.acesso_aprovado).toBe(true);
  });

  test('aprova explicitamente uma conta pendente e preserva o perfil', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'pending-user', perfil: 'Analista', acesso_aprovado: false }],
    });
    mockGetUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: 'pending-user',
          email: 'pending@example.com',
          app_metadata: { perfil: 'Analista' },
        },
      },
      error: null,
    });
    mockUpdateUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: 'pending-user',
          email: 'pending@example.com',
          app_metadata: { perfil: 'Analista', sysmlab_access_approved: true },
        },
      },
      error: null,
    });

    const response = await request(app)
      .put('/pending-user/aprovacao')
      .send({ acesso_aprovado: true });

    expect(response.status).toBe(200);
    expect(mockUpdateUserById).toHaveBeenCalledWith('pending-user', {
      app_metadata: expect.objectContaining({
        perfil: 'Analista',
        sysmlab_access_approved: true,
        sysmlab_access_approved_by: 'gestor-test',
      }),
    });
    expect(response.body.data).toMatchObject({
      id: 'pending-user',
      perfil: 'Analista',
      acesso_aprovado: true,
    });
  });

  test('mapeia a corrida de rebaixamento do último Gestor para conflito', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'other-manager', perfil: 'Gestor', acesso_aprovado: true }],
      })
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    mockGetUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: 'other-manager',
          email: 'gestor@example.com',
          app_metadata: { perfil: 'Gestor', sysmlab_access_approved: true },
        },
      },
      error: null,
    });
    mockUpdateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'SYSMLAB_LAST_APPROVED_GESTOR' },
    });

    const response = await request(app)
      .put('/other-manager/perfil')
      .send({ perfil: 'Analista' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'ULTIMO_GESTOR' });
  });
});
