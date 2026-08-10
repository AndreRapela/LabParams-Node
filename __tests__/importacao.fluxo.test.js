const ImportacaoModel = require('../models/ImportacaoModel');
const pool = require('../config/database');

jest.mock('../config/database', () => ({
  query: jest.fn(),
  connect: jest.fn()
}));
jest.mock('../models/AuditLogModel', () => ({ record: jest.fn().mockResolvedValue(null) }));
jest.mock('../models/AmostraModel', () => ({ applyStatusTransition: jest.fn().mockResolvedValue({}) }));

describe('Teste de fluxo completo de importacao', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validarLinha - deve validar linha completa com sucesso', async () => {
    const mockAmostraResult = {
      rowCount: 1,
      rows: [{
        id: 1,
        codigo_amostra: 'AMO-001',
        numero_da_amostra: 'NUM-001',
        matriz_id: 1,
        matriz_nome: 'Agua Bruta'
      }]
    };

    const mockMatrizResult = {
      rowCount: 1,
      rows: [{ id: 1, nome: 'Agua Bruta' }]
    };

    const mockLegislacaoResult = {
      rowCount: 1,
      rows: [{ id: 1, nome: 'Portaria 888/2021', sigla: 'PT888' }]
    };

    const mockParametroResult = {
      rowCount: 1,
      rows: [{
        id: 1,
        nome: 'Turbidez',
        unidade_medida: 'NTU',
        limite_minimo: 0,
        limite_maximo: 5,
        matriz_id: 1,
        legislacao_id: 1,
        matriz_nome: 'Agua Bruta',
        legislacao_nome: 'Portaria 888/2021',
        legislacao_sigla: 'PT888'
      }]
    };

    pool.query
      .mockResolvedValueOnce(mockAmostraResult)
      .mockResolvedValueOnce(mockMatrizResult)
      .mockResolvedValueOnce(mockLegislacaoResult)
      .mockResolvedValueOnce(mockParametroResult);

    const linha = {
      datacoleta: '01/12/2024',
      valor_medido: '0.5',
      legislacao: 'Portaria 888/2021',
      matriz: 'Agua Bruta',
      numerodaamostra: 'NUM-001',
      codigodaamostra: 'AMO-001',
      parametro: 'Turbidez'
    };

    const resultado = await ImportacaoModel.validarLinha(linha, 2);

    expect(resultado.sucesso).toBe(true);
    expect(resultado.dados).toBeDefined();
    expect(resultado.dados.valor_medido).toBe(0.5);
    expect(resultado.dados.amostra_id).toBe(1);
    expect(resultado.dados.parametro_id).toBe(1);
  });

  test('validarLinha - deve rejeitar campos obrigatorios faltando', async () => {
    const linha = {
      datacoleta: '01/12/2024',
      valor_medido: '',
      legislacao: 'Portaria 888/2021',
      matriz: 'Agua Bruta',
      numerodaamostra: 'NUM-001',
      codigodaamostra: 'AMO-001',
      parametro: 'Turbidez'
    };

    const resultado = await ImportacaoModel.validarLinha(linha, 2);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erro).toContain('valor_medido');
  });

  test('validarLinha - deve rejeitar valor_medido negativo', async () => {
    const mockAmostraResult = {
      rowCount: 1,
      rows: [{
        id: 1,
        codigo_amostra: 'AMO-001',
        numero_da_amostra: 'NUM-001',
        matriz_id: 1,
        matriz_nome: 'Agua Bruta'
      }]
    };

    pool.query.mockResolvedValueOnce(mockAmostraResult);

    const linha = {
      datacoleta: '01/12/2024',
      valor_medido: '-5',
      legislacao: 'Portaria 888/2021',
      matriz: 'Agua Bruta',
      numerodaamostra: 'NUM-001',
      codigodaamostra: 'AMO-001',
      parametro: 'Turbidez'
    };

    const resultado = await ImportacaoModel.validarLinha(linha, 2);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erro).toContain('inválido');
  });

  test('validarLinha - deve rejeitar data futura', async () => {
    const mockAmostraResult = {
      rowCount: 1,
      rows: [{
        id: 1,
        codigo_amostra: 'AMO-001',
        numero_da_amostra: 'NUM-001',
        matriz_id: 1,
        matriz_nome: 'Agua Bruta'
      }]
    };

    pool.query.mockResolvedValueOnce(mockAmostraResult);

    const linha = {
      datacoleta: '01/12/2099',
      valor_medido: '0.5',
      legislacao: 'Portaria 888/2021',
      matriz: 'Agua Bruta',
      numerodaamostra: 'NUM-001',
      codigodaamostra: 'AMO-001',
      parametro: 'Turbidez'
    };

    const resultado = await ImportacaoModel.validarLinha(linha, 2);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erro).toContain('futura');
  });

  test('validarLinha - deve rejeitar amostra nao encontrada', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const linha = {
      datacoleta: '01/12/2024',
      valor_medido: '0.5',
      legislacao: 'Portaria 888/2021',
      matriz: 'Agua Bruta',
      numerodaamostra: 'NUM-999',
      codigodaamostra: 'AMO-999',
      parametro: 'Turbidez'
    };

    const resultado = await ImportacaoModel.validarLinha(linha, 2);

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erro).toContain('não encontrada');
  });

  test('inserirLote - deve inserir multiplos registros com sucesso', async () => {
    let nextId = 1;
    const mockClient = {
      query: jest.fn(async (sql, params) => {
        const normalized = String(sql).toLowerCase();
        if (normalized.includes('select * from amostra')) {
          return {
            rowCount: 1,
            rows: [{ id: params[0], status_amostra: 'em_analise', local_atual: 'Bancada' }],
          };
        }
        if (normalized.includes('with contexto as')) return { rows: [{ id: nextId++ }] };
        return { rows: [] };
      }),
      release: jest.fn()
    };

    pool.connect = jest.fn().mockResolvedValue(mockClient);

    const dadosValidos = [
      {
        valor_medido: 0.5,
        datacoleta: '2024-12-01T00:00:00.000Z',
        datadapublicacao: '2024-12-15T00:00:00.000Z',
        amostra_id: 1,
        parametro_id: 1,
        codigodaamostra: 'AMO-001',
        numerodaamostra: 'NUM-001',
        matriz: 'Agua Bruta',
        legislacao: 'Portaria 888/2021 (PT888)'
      },
      {
        valor_medido: 1.2,
        datacoleta: '2024-12-01T00:00:00.000Z',
        datadapublicacao: '2024-12-15T00:00:00.000Z',
        amostra_id: 1,
        parametro_id: 2,
        codigodaamostra: 'AMO-001',
        numerodaamostra: 'NUM-001',
        matriz: 'Agua Bruta',
        legislacao: 'Portaria 888/2021 (PT888)'
      }
    ];

    const resultado = await ImportacaoModel.inserirLote(dadosValidos);

    expect(resultado.inseridos).toBe(2);
    expect(resultado.erros.length).toBe(0);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});
