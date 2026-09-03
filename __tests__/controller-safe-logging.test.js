'use strict';

const mockLogger = {
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
};
jest.mock('../utils/logger', () => mockLogger);
const mockParametroModel = { findAll: jest.fn(), update: jest.fn() };
jest.mock('../models/ParametroModel', () => mockParametroModel);

const { sendError } = require('../controllers/HttpControllerSupport');
const ParametroController = require('../controllers/ParametroController');

describe('logging seguro dos controllers', () => {
  test('erro 500 registra categoria/código sem mensagem sensível em produção', () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const req = { requestId: 'request-123' };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const error = Object.assign(
      new Error('connect ENOTFOUND db.private.supabase.co password=admin123'),
      { code: 'ENOTFOUND' }
    );

    try {
      sendError(req, res, error, 'Falha interna');
      expect(mockLogger.error).toHaveBeenCalledWith('http_controller_failed', {
        request_id: 'request-123',
        operation: 'Falha interna',
        category: 'dns',
        code: 'ENOTFOUND',
      });
      const serialized = JSON.stringify(mockLogger.error.mock.calls[0]);
      expect(serialized).not.toContain('private.supabase.co');
      expect(serialized).not.toContain('admin123');
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });

  test('falha inesperada ao atualizar parâmetro não vaza mensagem na resposta ou no log', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    mockLogger.error.mockClear();
    mockParametroModel.update.mockRejectedValueOnce(Object.assign(
      new Error('password=admin123 host=db.private.supabase.co'),
      { code: 'ENOTFOUND' }
    ));
    const req = {
      body: { valor_parametro: 10 },
      params: { id: 'parameter-1' },
      user: { id: 'user-1' },
      requestId: 'request-parameter',
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    try {
      await ParametroController.update(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Erro interno do servidor',
        request_id: 'request-parameter',
      });
      const serialized = JSON.stringify({
        response: res.json.mock.calls,
        logs: mockLogger.error.mock.calls,
      });
      expect(serialized).not.toContain('admin123');
      expect(serialized).not.toContain('db.private.supabase.co');
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
