jest.mock('../config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));
jest.mock('../models/AuditLogModel', () => ({ record: jest.fn() }));
jest.mock('../models/AssinaturaEletronicaModel', () => ({ create: jest.fn() }));

const pool = require('../config/database');
const AuditLogModel = require('../models/AuditLogModel');
const AssinaturaEletronicaModel = require('../models/AssinaturaEletronicaModel');
const LaudoModel = require('../models/LaudoModel');

function analyticalSnapshot() {
  return {
    schema_version: 1,
    versao_resultado: 1,
    valor_medido: 7.2,
    valor_qualitativo: null,
    datacoleta: '2026-07-29T10:00:00.000Z',
    parametro: {
      id: 8,
      nome: 'pH',
      unidade_medida: '',
      tipo_resultado: 'numerico',
      categoria: 'Físico-químico',
    },
    matriz: { id: 2, nome: 'Água potável' },
    referencia_legal: {
      legislacao_id: 3,
      legislacao_nome: 'Portaria GM/MS nº 888/2021',
      legislacao_sigla: 'P888',
      contexto_id: 4,
      contexto_codigo: 'POTABILIDADE',
      contexto_nome: 'Padrão de potabilidade',
      limite_minimo: 6,
      limite_maximo: 9.5,
      tipo_limite: 'faixa',
      criterio: null,
      fonte: 'Anexo XX',
    },
    metodo: {
      id: 5,
      codigo: 'SM-4500-H+',
      nome: 'Potenciometria',
      versao: '24',
      referencia_normativa: 'Standard Methods',
      limite_deteccao: null,
      limite_quantificacao: null,
      incerteza_padrao: 0.1,
    },
  };
}

function mockDatabase({ sampleStatus = 'concluida', reportVersion = 1 } = {}) {
  let insertedValues;
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.includes('from amostra a') && normalized.includes('for update of a')) {
        return { rows: [{
          id: 1,
          codigo_amostra: 'AM-001',
          numero_da_amostra: '001',
          data_coleta: '2026-07-29T09:00:00.000Z',
          localizacao: 'Recepção',
          local_atual: 'Arquivo',
          status_amostra: sampleStatus,
          matriz_nome: 'Água potável',
          pedido_analise_id: null,
          cliente_id: null,
        }], rowCount: 1 };
      }
      if (normalized.startsWith('with expected as')) {
        return { rows: [{ esperados: 1, registrados: 1, publicados: 1, correspondentes: 1 }] };
      }
      if (normalized.includes('from resultado_analise ra') && normalized.includes('for share of ra')) {
        return { rows: [{
          id: 9,
          parametro_id: 8,
          versao: 1,
          status_resultado: 'publicado',
          snapshot_analitico: analyticalSnapshot(),
          aprovado_em: '2026-07-29T11:00:00.000Z',
          publicado_em: '2026-07-29T12:00:00.000Z',
          aprovado_por_nome: 'Revisor',
          publicado_por_nome: 'Publicador',
        }], rowCount: 1 };
      }
      if (normalized.startsWith('select id, nome, email from usuario')) {
        return { rows: [{ id: 'user-1', nome: 'Gestor', email: 'gestor@example.com' }] };
      }
      if (normalized.includes('coalesce(max(versao)')) {
        return { rows: [{ proxima: reportVersion }] };
      }
      if (normalized.includes('nextval(pg_get_serial_sequence')) {
        return { rows: [{ id: '12' }] };
      }
      if (normalized.startsWith('insert into laudo_analitico')) {
        insertedValues = values;
        return { rows: [{
          id: values[0],
          numero: values[1],
          versao: values[4],
          snapshot: JSON.parse(values[5]),
          conteudo_hash: values[6],
          assinatura_eletronica_id: values[10],
        }] };
      }
      throw new Error(`SQL não simulada no teste: ${normalized}`);
    }),
  };
  pool.connect.mockResolvedValue(client);
  return { client, insertedValues: () => insertedValues };
}

describe('emissão íntegra de laudos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LAB_NOME = 'Laboratório Configurado';
    process.env.LAB_DOCUMENTO = '00.000.000/0001-00';
    process.env.LAB_ENDERECO = 'Rua da Qualidade, 100';
    process.env.LAB_CONTATO = 'qualidade@laboratorio.invalid';
    process.env.PUBLIC_APP_URL = 'https://laudos.laboratorio.invalid';
    AssinaturaEletronicaModel.create.mockResolvedValue({
      id: '30',
      payload_hash: 'a'.repeat(64),
      auth_method: 'supabase_password',
      signed_at: '2026-07-29T13:00:00.000Z',
    });
    AuditLogModel.record.mockResolvedValue(undefined);
  });

  afterAll(() => {
    delete process.env.LAB_NOME;
    delete process.env.LAB_DOCUMENTO;
    delete process.env.LAB_ENDERECO;
    delete process.env.LAB_CONTATO;
    delete process.env.PUBLIC_APP_URL;
  });

  test('usa somente a identidade configurada e vincula assinatura REPORT_ISSUE', async () => {
    const database = mockDatabase();
    const result = await LaudoModel.generate(1, {
      observacoes: 'Documento oficial',
      laboratorio: { nome: 'Nome injetado pelo cliente' },
    }, {
      actorUserId: 'user-1',
      requestId: 'request-1',
      signatureContext: {
        userId: 'user-1',
        authenticatedAt: '2026-07-29T12:59:59.000Z',
        authMethod: 'supabase_password',
      },
    });

    const snapshot = JSON.parse(database.insertedValues()[5]);
    expect(snapshot.laboratorio.nome).toBe('Laboratório Configurado');
    expect(snapshot.laboratorio.nome).not.toContain('injetado');
    expect(snapshot.resultados[0].metodo.codigo).toBe('SM-4500-H+');
    expect(result.numero).toBe('LAU-AM-001-1-V1');
    expect(AssinaturaEletronicaModel.create).toHaveBeenCalledWith(
      database.client,
      expect.objectContaining({
        entityType: 'laudo_analitico',
        entityId: '12',
        action: 'REPORT_ISSUE',
      })
    );
    expect(result.integridade_valida).toBe(true);
  });

  test('não emite para amostra que ainda não foi concluída', async () => {
    mockDatabase({ sampleStatus: 'aguardando_revisao' });

    await expect(LaudoModel.generate(1, {}, {
      actorUserId: 'user-1',
      signatureContext: {
        userId: 'user-1',
        authenticatedAt: '2026-07-29T12:59:59.000Z',
        authMethod: 'supabase_password',
      },
    })).rejects.toMatchObject({ code: 'AMOSTRA_NAO_CONCLUIDA' });
    expect(AssinaturaEletronicaModel.create).not.toHaveBeenCalled();
  });

  test('exige motivo explícito a partir da segunda versão', async () => {
    mockDatabase({ reportVersion: 2 });

    await expect(LaudoModel.generate(1, {}, {
      actorUserId: 'user-1',
      signatureContext: {
        userId: 'user-1',
        authenticatedAt: '2026-07-29T12:59:59.000Z',
        authMethod: 'supabase_password',
      },
    })).rejects.toMatchObject({ code: 'MOTIVO_REVISAO_OBRIGATORIO' });
    expect(AssinaturaEletronicaModel.create).not.toHaveBeenCalled();
  });

  test('produção recusa identidade laboratorial incompleta antes de acessar o banco', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.LAB_CONTATO;

    try {
      await expect(LaudoModel.generate(1, {}, {
        actorUserId: 'user-1',
        signatureContext: {
          userId: 'user-1',
          authenticatedAt: '2026-07-29T12:59:59.000Z',
          authMethod: 'supabase_password',
        },
      })).rejects.toMatchObject({
        statusCode: 503,
        code: 'REPORT_CONFIGURATION_INVALID',
      });
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousEnvironment;
      process.env.LAB_CONTATO = 'qualidade@laboratorio.invalid';
    }
  });

  test('produção recusa URL pública sem HTTPS antes de acessar o banco', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_URL = 'http://localhost:4200';

    try {
      await expect(LaudoModel.generate(1, {}, {
        actorUserId: 'user-1',
        signatureContext: {
          userId: 'user-1',
          authenticatedAt: '2026-07-29T12:59:59.000Z',
          authMethod: 'supabase_password',
        },
      })).rejects.toMatchObject({
        statusCode: 503,
        code: 'REPORT_CONFIGURATION_INVALID',
      });
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousEnvironment;
      process.env.PUBLIC_APP_URL = 'https://laudos.laboratorio.invalid';
    }
  });
});
