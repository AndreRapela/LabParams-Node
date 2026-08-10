jest.mock('../config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const pool = require('../config/database');
const ResultadoAnaliseModel = require('../models/ResultadoAnaliseModel');

function persistedResult() {
  return {
    id: 4,
    amostra_id: 2,
    parametro_id: 8,
    valor_medido: 7.1,
    valor_qualitativo: null,
    status_resultado: 'em_revisao',
    versao: 2,
    parametro_nome_aplicado: 'Nome aplicado antigo',
    unidade_medida_aplicada: 'unidade antiga',
    snapshot_analitico: {
      versao_resultado: 2,
      parametro: {
        id: 8,
        nome: 'pH congelado',
        unidade_medida: 'pH',
        tipo_resultado: 'numerico',
      },
      matriz: { id: 3, nome: 'Água potável congelada' },
      referencia_legal: {
        legislacao_sigla: 'GM/MS 888',
        legislacao_nome: 'Portaria congelada',
        contexto_codigo: 'PADRAO',
        contexto_nome: 'Potabilidade congelada',
        limite_minimo: 6,
        limite_maximo: 9.5,
        tipo_limite: 'faixa',
        criterio: 'Critério congelado',
        fonte: 'Fonte congelada',
      },
      metodo: {
        id: 5,
        codigo: 'MET-01',
        nome: 'Método congelado',
        versao: '2',
        referencia_normativa: 'Norma congelada',
      },
    },
    total_count: 1,
  };
}

describe('apresentação rastreável de resultados', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lista usando o snapshot analítico, sem depender de cadastros vivos', async () => {
    pool.query.mockResolvedValue({ rows: [persistedResult()] });

    const rows = await ResultadoAnaliseModel.findAll({ status: 'em_revisao' });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).not.toContain('join parametro');
    expect(sql).not.toContain('join legislacao');
    expect(values).toEqual(['em_revisao']);
    expect(rows[0]).toMatchObject({
      parametro_nome: 'pH congelado',
      matriz_nome: 'Água potável congelada',
      metodo_nome: 'Método congelado',
      legislacao_sigla: 'GM/MS 888',
      status_conformidade: 'conforme',
    });
  });

  test('aceita o alias legado status_resultado sem ignorar o filtro', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await ResultadoAnaliseModel.findAll({ status_resultado: 'rejeitado' });

    expect(pool.query.mock.calls[0][1]).toEqual(['rejeitado']);
  });

  test('retorna histórico no contrato consumido pelo frontend', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{
        id: 3,
        resultado_analise_id: 4,
        acao: 'aprovacao',
        created_at: '2026-08-02T12:00:00.000Z',
        ator_nome: 'Revisor',
        ator_email: 'revisor@example.com',
        total_count: 1,
      }] });

    const history = await ResultadoAnaliseModel.findWorkflowHistory(4);

    expect(pool.query.mock.calls[1][0]).toContain('e.decisao as acao');
    expect(history.rows[0]).toMatchObject({
      resultado_analise_id: 4,
      acao: 'aprovacao',
      ator_nome: 'Revisor',
    });
  });
});
