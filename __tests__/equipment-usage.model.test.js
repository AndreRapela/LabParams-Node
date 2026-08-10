jest.mock('../config/database', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../models/AuditLogModel', () => ({
  record: jest.fn(),
}));

const pool = require('../config/database');
const AuditLogModel = require('../models/AuditLogModel');
const EquipamentoModel = require('../models/EquipamentoModel');

describe('registro transacional de utilização de equipamento', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    AuditLogModel.record.mockResolvedValue({ id: 1 });
  });

  test('recusa uso quando a calibração está vencida e desfaz a transação', async () => {
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{
        id: 4,
        status: 'ATIVO',
        requer_calibracao: true,
        proxima_calibracao: '2020-01-01',
        evento_em_andamento: false,
        manutencao_em_andamento: false,
      }] })
      .mockResolvedValueOnce({});

    await expect(EquipamentoModel.registrarUtilizacao(4, {
      finalidade: 'Leitura de absorbância',
    }, { actorUserId: '00000000-0000-0000-0000-000000000001' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

    expect(client.query).toHaveBeenLastCalledWith('rollback');
    expect(AuditLogModel.record).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('grava uso disponível e auditoria na mesma transação', async () => {
    const utilizacao = {
      id: 9,
      equipamento_id: 4,
      finalidade: 'Leitura de absorbância',
    };
    client.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [{
        id: 4,
        status: 'ATIVO',
        requer_calibracao: false,
        evento_em_andamento: false,
        manutencao_em_andamento: false,
      }] })
      .mockResolvedValueOnce({ rows: [utilizacao] })
      .mockResolvedValueOnce({});

    await expect(EquipamentoModel.registrarUtilizacao(4, {
      finalidade: 'Leitura de absorbância',
      metadata: { metodo: 'POP-012' },
    }, {
      actorUserId: '00000000-0000-0000-0000-000000000001',
      requestId: '00000000-0000-0000-0000-000000000002',
    })).resolves.toEqual(utilizacao);

    expect(AuditLogModel.record).toHaveBeenCalledWith(client, expect.objectContaining({
      action: 'CREATE',
      entityType: 'equipamento_utilizacao',
      entityId: 9,
      afterData: utilizacao,
    }));
    expect(client.query).toHaveBeenLastCalledWith('commit');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
