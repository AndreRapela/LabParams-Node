jest.mock('../config/database', () => ({ connect: jest.fn(), query: jest.fn() }));
jest.mock('../models/AuditLogModel', () => ({ record: jest.fn().mockResolvedValue(null) }));

const pool = require('../config/database');
const AmostraModel = require('../models/AmostraModel');
const ClienteModel = require('../models/ClienteModel');
const MetodoAnaliticoModel = require('../models/MetodoAnaliticoModel');
const PedidoAnaliseModel = require('../models/PedidoAnaliseModel');
const terminalStatusRole = require('../middleware/TerminalStatusRole');

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('parsing estrito de booleanos de cliente', () => {
  test.each([
    [true, true],
    [false, false],
  ])('aceita booleano %s', (input, expected) => {
    expect(ClienteModel.parseBoolean(input)).toBe(expected);
  });

  test.each(['false', 'true', 0, 1, 'sim'])('rejeita valor corporal ambíguo %p', (input) => {
    expect(() => ClienteModel.parseBoolean(input)).toThrow(/booleano/i);
  });

  test('filtro aceita apenas strings booleanas exatas', () => {
    expect(ClienteModel.parseBoolean('false', { allowString: true })).toBe(false);
    expect(() => ClienteModel.parseBoolean('FALSE', { allowString: true })).toThrow(/booleano/i);
  });

  test('não permite desativar cliente com pedido ativo', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from cliente')) {
          return { rows: [{ id: 1, ativo: true }] };
        }
        if (normalized.includes('from pedido_analise')) return { rows: [{ total: 1 }] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);

    await expect(ClienteModel.update(1, {
      codigo: 'CLI-1', nome_razao_social: 'Cliente 1', ativo: false,
    })).rejects.toMatchObject({ code: 'CLIENTE_COM_PEDIDOS_ATIVOS', statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('parsing estrito de booleanos de método analítico', () => {
  test('não converte a string "false" em verdadeiro no corpo da requisição', () => {
    expect(() => MetodoAnaliticoModel.parseBoolean('false'))
      .toThrow(/booleano/i);
  });

  test('aceita booleanos reais no corpo e strings exatas somente no filtro', () => {
    expect(MetodoAnaliticoModel.parseBoolean(false)).toBe(false);
    expect(MetodoAnaliticoModel.parseBoolean('false', { allowString: true })).toBe(false);
    expect(() => MetodoAnaliticoModel.parseBoolean('FALSE', { allowString: true }))
      .toThrow(/booleano/i);
  });

  test('preserva o estado inativo quando uma atualização omite o campo', () => {
    const normalized = MetodoAnaliticoModel.normalize({
      codigo: 'MET-1', nome: 'Método 1', versao: '1.0',
    }, { defaultAtivo: false });
    expect(normalized.ativo).toBe(false);
  });

  test('rejeita identificadores inválidos nos filtros antes de consultar o banco', async () => {
    await expect(MetodoAnaliticoModel.findAll({ parametro_id: 'abc' }))
      .rejects.toMatchObject({ code: 'VALIDACAO', statusCode: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('imutabilidade comercial do pedido', () => {
  beforeEach(() => jest.clearAllMocks());

  test('bloqueia o cliente durante a validação para evitar pedido concorrente após desativação', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] }) };

    await PedidoAnaliseModel.assertActiveClient(db, 7);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/from cliente[\s\S]*for share/i),
      [7]
    );
  });

  test('congela o cliente depois da primeira amostra, inclusive arquivada', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from pedido_analise')) {
          return { rows: [{ id: 10, cliente_id: 1, status: 'em_execucao' }] };
        }
        if (normalized.includes('select exists')) return { rows: [{ possui_amostra: true }] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);

    await expect(PedidoAnaliseModel.update(10, {
      codigo: 'PED-10', cliente_id: 2, prioridade: 'normal', data_entrada: '2026-07-29',
    })).rejects.toMatchObject({ code: 'CLIENTE_DO_PEDIDO_CONGELADO', statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('impede cancelamento enquanto houver amostra operacional ativa', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from pedido_analise')) {
          return { rows: [{ id: 10, cliente_id: 1, status: 'em_execucao' }] };
        }
        if (normalized.includes('status_amostra not in')) return { rows: [{ total: 1 }] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);

    await expect(PedidoAnaliseModel.transitionStatus(
      10, 'cancelado', 'Cancelamento solicitado pelo cliente.'
    )).rejects.toMatchObject({ code: 'AMOSTRAS_ATIVAS', statusCode: 409 });
  });

  test('não arquiva pedido que já recebeu amostra, mesmo se ela foi arquivada', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from pedido_analise')) {
          return { rows: [{ id: 10, status: 'cancelado' }] };
        }
        if (normalized.includes('select exists')) return { rows: [{ possui_amostra: true }] };
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);

    await expect(PedidoAnaliseModel.archive(10, 'Limpeza cadastral.'))
      .rejects.toMatchObject({ code: 'RETENCAO_OBRIGATORIA', statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('validação forte da cadeia de custódia', () => {
  beforeEach(() => jest.clearAllMocks());

  test('não permite duplicar o recebimento automático', async () => {
    await expect(AmostraModel.addCustodyEvent(1, { tipo_evento: 'recebimento' }))
      .rejects.toMatchObject({ code: 'RECEBIMENTO_DUPLICADO' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('não permite retrodatação superior ao limite', async () => {
    await expect(AmostraModel.addCustodyEvent(1, {
      tipo_evento: 'movimentacao',
      local_destino: 'Sala B',
      ocorrido_em: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    })).rejects.toMatchObject({ code: 'RETRODATA_EXCEDIDA' });
  });

  test('não permite descarte enquanto a amostra está em análise', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (String(sql).toLowerCase().includes('select * from amostra')) {
          return { rows: [{
            id: 1, status_amostra: 'em_analise', local_atual: 'Bancada A',
            created_at: new Date(Date.now() - 60_000).toISOString(),
          }] };
        }
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);
    await expect(AmostraModel.addCustodyEvent(1, {
      tipo_evento: 'descarte', local_destino: 'Resíduo classe I', observacao: 'Descarte controlado.',
    })).rejects.toMatchObject({ code: 'DESCARTE_PREMATURO' });
  });

  test('confere a origem informada contra o local atual', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        if (String(sql).toLowerCase().includes('select * from amostra')) {
          return { rows: [{
            id: 1, status_amostra: 'em_analise', local_atual: 'Bancada A',
            created_at: new Date(Date.now() - 60_000).toISOString(),
          }] };
        }
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);
    await expect(AmostraModel.addCustodyEvent(1, {
      tipo_evento: 'movimentacao', local_origem: 'Bancada X', local_destino: 'Bancada B',
    })).rejects.toMatchObject({ code: 'ORIGEM_DIVERGENTE' });
  });

  test('bloqueia qualquer nova movimentação depois do descarte', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from amostra')) {
          return { rows: [{
            id: 1, status_amostra: 'concluida', local_atual: 'Resíduo classe I',
            created_at: new Date(Date.now() - 60_000).toISOString(),
          }] };
        }
        if (normalized.includes('bool_or')) {
          return { rows: [{ ultimo_evento: new Date().toISOString(), descartada: true }] };
        }
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);

    await expect(AmostraModel.addCustodyEvent(1, {
      tipo_evento: 'movimentacao',
      local_destino: 'Arquivo de contraprovas',
    })).rejects.toMatchObject({ code: 'AMOSTRA_DESCARTADA', statusCode: 409 });
  });
});

describe('conclusão da amostra exige o escopo analítico exato', () => {
  beforeEach(() => jest.clearAllMocks());

  test('não conclui quando há resultado publicado, mas falta parâmetro esperado', async () => {
    const client = {
      release: jest.fn(),
      query: jest.fn(async (sql) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from amostra')) {
          return { rows: [{ id: 1, status_amostra: 'aguardando_revisao' }] };
        }
        if (normalized.includes('from amostra_parametro')) {
          return { rows: [{ esperados: 2, total: 1, registrados: 1, publicados: 1 }] };
        }
        return { rows: [] };
      }),
    };
    pool.connect.mockResolvedValue(client);

    await expect(AmostraModel.transitionStatus(1, 'concluida'))
      .rejects.toMatchObject({ code: 'RESULTADOS_PENDENTES', statusCode: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('não cria amostra sem escopo de parâmetros', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
    pool.connect.mockResolvedValue(client);

    await expect(AmostraModel.create({
      codigo_amostra: 'AMO-1',
      numero_da_amostra: '001',
      data_coleta: '2026-07-29',
      matriz_id: 1,
      usuario_id: 'user-1',
      parametros_ids: [],
    })).rejects.toMatchObject({ code: 'VALIDACAO', statusCode: 400 });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('insert into amostra'),
      expect.anything()
    );
  });
});

describe('RBAC das transições terminais', () => {
  beforeEach(() => jest.clearAllMocks());

  test('Analista não conclui estado terminal, mas pode avançar estado operacional', async () => {
    pool.query.mockResolvedValue({ rows: [{ perfil: 'Analista' }] });
    const middleware = terminalStatusRole({
      field: 'status', terminalStatuses: ['concluida', 'rejeitada', 'cancelada'],
    });
    const deniedResponse = mockResponse();
    const deniedNext = jest.fn();
    await middleware(
      { body: { status: 'concluida' }, user: { id: 'analyst-hardening-1' } },
      deniedResponse,
      deniedNext
    );
    expect(deniedResponse.status).toHaveBeenCalledWith(403);
    expect(deniedNext).not.toHaveBeenCalled();

    const allowedNext = jest.fn();
    middleware(
      { body: { status: 'em_analise' }, user: { id: 'analyst-hardening-1' } },
      mockResponse(),
      allowedNext
    );
    expect(allowedNext).toHaveBeenCalled();
  });

  test('descarte físico também exige perfil Gestor', async () => {
    pool.query.mockResolvedValue({ rows: [{ perfil: 'Analista' }] });
    const middleware = terminalStatusRole({
      field: 'status_novo',
      terminalStatuses: ['rejeitada', 'descarte'],
      eventAliases: { rejeicao: 'rejeitada', descarte: 'descarte' },
    });
    const response = mockResponse();
    const next = jest.fn();

    await middleware(
      { body: { tipo_evento: 'descarte' }, user: { id: 'analyst-hardening-1' } },
      response,
      next
    );
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
