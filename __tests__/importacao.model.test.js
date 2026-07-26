// __tests__/importacao.model.test.js

// Mock do pool de conexão ANTES de importar o model
jest.mock('../config/database', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const ImportacaoModel = require('../models/ImportacaoModel');
const pool = require('../config/database');

describe('ImportacaoModel', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validarLinha', () => {
    
    test('deve validar linha com todos os campos corretos', async () => {
      // Mock das queries ao banco
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 1,
            codigo_amostra: 'AMO-001',
            numero_da_amostra: '001',
            matriz_id: 10,
            matriz_nome: 'Água'
          }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 20,
            nome: 'Turbidez',
            matriz_id: 10,
            legislacao_id: 5,
            matriz_nome: 'Água',
            legislacao_nome: 'Portaria 888/2021',
            legislacao_sigla: '888/2021'
          }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '0.5',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados).toBeDefined();
      expect(resultado.dados.valor_medido).toBe(0.5);
      expect(resultado.dados.amostra_id).toBe(1);
      expect(resultado.dados.parametro_id).toBe(20);
      expect(resultado.dados.matriz).toBe('Água');
      expect(resultado.dados.legislacao).toBe('Portaria 888/2021 (888/2021)');
      expect(resultado.erro).toBeNull();
    });

    test('deve rejeitar linha com campo obrigatório faltando', async () => {
      const linha = {
        datacoleta: '01/12/2024',
        // valor_medido faltando
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain('valor_medido');
      expect(resultado.erro).toContain('obrigatório');
    });

    test('deve aceitar formato de data DD/MM/YYYY', async () => {
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, codigo_amostra: 'AMO-001', numero_da_amostra: '001', matriz_id: 10, matriz_nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 20, nome: 'Turbidez', matriz_id: 10, legislacao_id: 5, matriz_nome: 'Água', legislacao_nome: 'Portaria 888/2021', legislacao_sigla: '888/2021' }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '0.5',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados.datacoleta).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('deve aceitar vírgula como separador decimal', async () => {
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, codigo_amostra: 'AMO-001', numero_da_amostra: '001', matriz_id: 10, matriz_nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 20, nome: 'Turbidez', matriz_id: 10, legislacao_id: 5, matriz_nome: 'Água', legislacao_nome: 'Portaria 888/2021', legislacao_sigla: '888/2021' }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '1,5',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados.valor_medido).toBe(1.5);
    });

    test('deve gerar datadapublicacao como timestamp ISO', async () => {
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, codigo_amostra: 'AMO-001', numero_da_amostra: '001', matriz_id: 10, matriz_nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 20, nome: 'Turbidez', matriz_id: 10, legislacao_id: 5, matriz_nome: 'Água', legislacao_nome: 'Portaria 888/2021', legislacao_sigla: '888/2021' }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '0.5',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados.datadapublicacao).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('deve validar valores medidos com muitas casas decimais', async () => {
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, codigo_amostra: 'AMO-001', numero_da_amostra: '001', matriz_id: 10, matriz_nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 20, nome: 'Turbidez', matriz_id: 10, legislacao_id: 5, matriz_nome: 'Água', legislacao_nome: 'Portaria 888/2021', legislacao_sigla: '888/2021' }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '123.456789',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados.valor_medido).toBe(123.456789);
    });

    test('deve validar valores medidos com notação científica', async () => {
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, codigo_amostra: 'AMO-001', numero_da_amostra: '001', matriz_id: 10, matriz_nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 20, nome: 'Turbidez', matriz_id: 10, legislacao_id: 5, matriz_nome: 'Água', legislacao_nome: 'Portaria 888/2021', legislacao_sigla: '888/2021' }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '1.5e-3',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados.valor_medido).toBe(0.0015);
    });

    test('deve validar valor medido zero', async () => {
      pool.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, codigo_amostra: 'AMO-001', numero_da_amostra: '001', matriz_id: 10, matriz_nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 10, nome: 'Água' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 5, nome: 'Portaria 888/2021', sigla: '888/2021' }]
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 20, nome: 'Turbidez', matriz_id: 10, legislacao_id: 5, matriz_nome: 'Água', legislacao_nome: 'Portaria 888/2021', legislacao_sigla: '888/2021' }]
        });

      const linha = {
        datacoleta: '01/12/2024',
        valor_medido: '0',
        legislacao: 'Portaria 888/2021',
        matriz: 'Água',
        numerodaamostra: '001',
        codigodaamostra: 'AMO-001',
        parametro: 'Turbidez'
      };

      const resultado = await ImportacaoModel.validarLinha(linha, 1);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.dados.valor_medido).toBe(0);
    });
  });

  describe('inserirLote', () => {
    
    test('deve inserir múltiplos resultados com sucesso', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT 1
          .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // INSERT 2
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn()
      };

      pool.connect.mockResolvedValue(mockClient);

      const resultados = [
        {
          valor_medido: 0.5,
          amostra_id: 1,
          parametro_id: 20,
          datacoleta: '2024-12-01T00:00:00.000Z',
          datadapublicacao: '2024-12-29T10:00:00.000Z',
          codigodaamostra: 'AMO-001',
          numerodaamostra: '001',
          matriz: 'Água',
          legislacao: 'Portaria 888/2021 (888/2021)'
        },
        {
          valor_medido: 1.2,
          amostra_id: 2,
          parametro_id: 21,
          datacoleta: '2024-12-02T00:00:00.000Z',
          datadapublicacao: '2024-12-29T10:00:00.000Z',
          codigodaamostra: 'AMO-002',
          numerodaamostra: '002',
          matriz: 'Água',
          legislacao: 'Portaria 888/2021 (888/2021)'
        }
      ];

      const resultado = await ImportacaoModel.inserirLote(resultados);

      expect(resultado.inseridos).toBe(2);
      expect(resultado.erros).toHaveLength(0);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('deve fazer rollback em caso de erro', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error('Erro de inserção')), // INSERT falha
        release: jest.fn()
      };

      pool.connect.mockResolvedValue(mockClient);

      const resultados = [{
        valor_medido: 0.5,
        amostra_id: 1,
        parametro_id: 20,
        datacoleta: '2024-12-01T00:00:00.000Z',
        datadapublicacao: '2024-12-29T10:00:00.000Z',
        codigodaamostra: 'AMO-001',
        numerodaamostra: '001',
        matriz: 'Água',
        legislacao: 'Portaria 888/2021 (888/2021)'
      }];

      const resultado = await ImportacaoModel.inserirLote(resultados);

      // O método trata o erro e registra no array de erros
      expect(resultado.inseridos).toBe(0);
      expect(resultado.erros).toHaveLength(1);
      expect(resultado.erros[0]).toHaveProperty('erro');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
