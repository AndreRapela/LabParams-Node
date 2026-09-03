const express = require('express');
const request = require('supertest');

jest.mock('../middleware/RoleFromTable', () => {
  const factory = () => (_req, _res, next) => next();
  factory.invalidate = jest.fn();
  return factory;
});
jest.mock('../controllers/ImportacaoController', () => ({
  importarResultadosAnalise: jest.fn((_req, res) => res.json({ success: true })),
  baixarTemplate: jest.fn((_req, res) => res.json({ success: true })),
}));
jest.mock('../utils/safeError', () => ({ logSafeError: jest.fn() }));

const importRoutes = require('../routes/ImportacaoRoutes');
const { logSafeError } = require('../utils/safeError');

describe('erros seguros do upload de importação', () => {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'upload-request';
    next();
  });
  app.use(importRoutes);

  beforeEach(() => jest.clearAllMocks());

  test('não reflete MIME inválido nem nome interno do arquivo', async () => {
    const response = await request(app)
      .post('/resultado-analise')
      .attach('arquivo', Buffer.from('conteudo'), {
        filename: 'amostra.csv',
        contentType: 'application/x-secret-internal',
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'UPLOAD_MIME_INVALID',
      request_id: 'upload-request',
    });
    expect(JSON.stringify(response.body)).not.toContain('x-secret-internal');
  });

  test('sanitiza MulterError inesperado e registra somente campos seguros', async () => {
    const response = await request(app)
      .post('/resultado-analise')
      .attach('campo_inesperado', Buffer.from('x'), 'interno.csv');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'UPLOAD_INVALID',
      request_id: 'upload-request',
    });
    expect(JSON.stringify(response.body)).not.toContain('Unexpected field');
    expect(JSON.stringify(response.body)).not.toContain('interno.csv');
    expect(logSafeError).toHaveBeenCalledWith(
      'analysis_import_multer_failed',
      expect.any(Error),
      { request_id: 'upload-request' }
    );
  });

  test('trata falha de storage como 500 sem refletir caminho interno', () => {
    const error = new Error('EACCES C:\\segredo\\uploads\\arquivo.csv');
    error.code = 'EACCES';
    const req = { requestId: 'storage-request' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    importRoutes.uploadErrorHandler(error, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ code: 'UPLOAD_FAILED', request_id: 'storage-request' });
    expect(JSON.stringify(payload)).not.toContain('segredo');
    expect(logSafeError).toHaveBeenCalledWith(
      'analysis_import_upload_failed',
      error,
      { request_id: 'storage-request' }
    );
  });
});
