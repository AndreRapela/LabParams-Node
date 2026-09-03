'use strict';

const mockLogger = {
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
};
jest.mock('../utils/logger', () => mockLogger);
const mockLaudoModel = { findById: jest.fn() };
jest.mock('../models/LaudoModel', () => mockLaudoModel);
const mockQrCode = { toDataURL: jest.fn() };
jest.mock('qrcode', () => mockQrCode);

const LaudoController = require('../controllers/LaudoController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

describe('configuração de produção na renderização do laudo', () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousPublicUrl = process.env.PUBLIC_APP_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'production';
    mockLaudoModel.findById.mockResolvedValue({
      numero: 'LAU-1',
      conteudo_hash: 'a'.repeat(64),
      integridade_valida: true,
      snapshot: {
        laboratorio: {
          nome: 'Laboratório Central',
          documento: '00.000.000/0001-00',
          endereco: 'Rua da Qualidade, 100',
          contato: 'qualidade@laboratorio.invalid',
        },
      },
    });
  });

  afterAll(() => {
    process.env.NODE_ENV = previousEnvironment;
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = previousPublicUrl;
  });

  test('recusa QR com URL pública insegura usando resposta e log sanitizados', async () => {
    process.env.PUBLIC_APP_URL = 'http://localhost:4200/segredo-admin123';
    const req = { params: { id: '1' }, requestId: 'request-report' };
    const res = response();

    await LaudoController.html(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Erro interno ao processar laudo',
      code: 'REPORT_CONFIGURATION_INVALID',
      request_id: 'request-report',
    });
    expect(mockQrCode.toDataURL).not.toHaveBeenCalled();
    const serialized = JSON.stringify({ response: res.json.mock.calls, logs: mockLogger.error.mock.calls });
    expect(serialized).not.toContain('segredo-admin123');
    expect(serialized).not.toContain('localhost');
  });

  test('recusa snapshot legado com identidade placeholder', async () => {
    process.env.PUBLIC_APP_URL = 'https://laudos.laboratorio.invalid';
    mockLaudoModel.findById.mockResolvedValueOnce({
      numero: 'LAU-LEGADO',
      conteudo_hash: 'b'.repeat(64),
      integridade_valida: true,
      snapshot: {
        laboratorio: {
          nome: 'Laboratório emissor',
          documento: '',
          endereco: '',
          contato: '',
        },
      },
    });
    const req = { params: { id: '2' }, requestId: 'request-legacy' };
    const res = response();

    await LaudoController.html(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'REPORT_CONFIGURATION_INVALID',
      request_id: 'request-legacy',
    }));
    expect(mockQrCode.toDataURL).not.toHaveBeenCalled();
  });
});
