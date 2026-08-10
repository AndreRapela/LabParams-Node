const AssinaturaEletronicaModel = require('../models/AssinaturaEletronicaModel');

describe('AssinaturaEletronicaModel', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('vincula versão e estados do snapshot aos metadados da assinatura', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [{ id: '15', payload_hash: 'a'.repeat(64) }],
      }),
    };

    await AssinaturaEletronicaModel.create(db, {
      actorUserId: 'user-1',
      entityType: 'resultado_analise',
      entityId: 9,
      action: 'APPROVE',
      authenticatedAt: '2026-08-02T11:59:00.000Z',
      entitySnapshot: {
        versao_resultado: 3,
        status_origem: 'em_revisao',
        status_destino: 'aprovado',
      },
    });

    const values = db.query.mock.calls[0][1];
    expect(JSON.parse(values[11])).toMatchObject({
      entity_version: 3,
      status_origin: 'em_revisao',
      status_destination: 'aprovado',
    });
  });

  test('rejeita confirmação de identidade expirada antes de gravar', async () => {
    const db = { query: jest.fn() };

    await expect(AssinaturaEletronicaModel.create(db, {
      actorUserId: 'user-1',
      entityType: 'resultado_analise',
      entityId: 9,
      action: 'APPROVE',
      authenticatedAt: '2026-08-02T11:54:59.000Z',
      entitySnapshot: { versao_resultado: 1 },
    })).rejects.toMatchObject({
      statusCode: 401,
      code: 'REAUTENTICACAO_EXPIRADA',
    });
    expect(db.query).not.toHaveBeenCalled();
  });
});
