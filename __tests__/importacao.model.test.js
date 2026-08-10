// __tests__/importacao.model.test.js

// Mock do pool de conexão ANTES de importar o model
jest.mock('../config/database', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));
jest.mock('../models/AuditLogModel', () => ({ record: jest.fn().mockResolvedValue(null) }));
jest.mock('../models/AmostraModel', () => ({ applyStatusTransition: jest.fn().mockResolvedValue({}) }));
jest.mock('../utils/logger', () => ({ warn: jest.fn() }));

const ImportacaoModel = require('../models/ImportacaoModel');
const pool = require('../config/database');
const AmostraModel = require('../models/AmostraModel');

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

    test('deve manter datadapublicacao vazia enquanto o resultado está em rascunho', async () => {
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
      expect(resultado.dados.datadapublicacao).toBeNull();
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

  describe('parseData', () => {
    test('rejeita formatos ambíguos e datas ISO inexistentes', () => {
      expect(() => ImportacaoModel.parseData('12-31-2024')).toThrow(/DD\/MM\/AAAA|ISO/);
      expect(() => ImportacaoModel.parseData('2024-02-30')).toThrow(/inexistente/i);
    });

    test('aceita data ISO completa com fuso horário', () => {
      expect(ImportacaoModel.parseData('2024-12-01T10:30:00.000-03:00').toISOString())
        .toBe('2024-12-01T13:30:00.000Z');
    });
  });

  describe('inserirLote', () => {
    
    test('deve inserir múltiplos resultados com sucesso', async () => {
      let nextId = 1;
      const mockClient = {
        query: jest.fn(async (sql, params) => {
          const normalized = String(sql).toLowerCase();
          if (normalized.includes('select * from amostra')) {
            return {
              rowCount: 1,
              rows: [{ id: params[0], status_amostra: 'recebida', local_atual: 'Recepção' }],
            };
          }
          if (normalized.includes('with contexto as')) return { rows: [{ id: nextId++ }] };
          return { rows: [] };
        }),
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
      expect(mockClient.query).toHaveBeenCalledWith('SAVEPOINT import_row_1');
      expect(mockClient.query).toHaveBeenCalledWith('RELEASE SAVEPOINT import_row_2');
      expect(AmostraModel.applyStatusTransition).toHaveBeenCalledTimes(2);
      const insertionSql = mockClient.query.mock.calls
        .map(([sql]) => String(sql).toLowerCase())
        .find((sql) => sql.includes('with contexto as'));
      expect(insertionSql).toContain('snapshot_analitico');
      expect(insertionSql).toContain('insert into resultado_versao_snapshot');
      expect(insertionSql).toContain("'rascunho'");
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('isola falha de uma linha com SAVEPOINT e confirma as demais', async () => {
      let insertAttempt = 0;
      const mockClient = {
        query: jest.fn(async (sql, params) => {
          const normalized = String(sql).toLowerCase();
          if (normalized.includes('select * from amostra')) {
            return {
              rowCount: 1,
              rows: [{ id: params[0], status_amostra: 'em_analise', local_atual: 'Bancada' }],
            };
          }
          if (normalized.includes('with contexto as')) {
            insertAttempt += 1;
            if (insertAttempt === 1) {
              const duplicate = new Error('detalhe interno da restrição');
              duplicate.code = '23505';
              throw duplicate;
            }
            return { rows: [{ id: 2 }] };
          }
          return { rows: [] };
        }),
        release: jest.fn()
      };

      pool.connect.mockResolvedValue(mockClient);

      const item = {
        valor_medido: 0.5,
        amostra_id: 1,
        parametro_id: 20,
        datacoleta: '2024-12-01T00:00:00.000Z',
        datadapublicacao: '2024-12-29T10:00:00.000Z',
        codigodaamostra: 'AMO-001',
        numerodaamostra: '001',
        matriz: 'Água',
        legislacao: 'Portaria 888/2021 (888/2021)'
      };

      const resultado = await ImportacaoModel.inserirLote([
        { ...item, _linha_importacao: 42 },
        { ...item, amostra_id: 2, _linha_importacao: 43 },
      ]);

      expect(resultado.inseridos).toBe(1);
      expect(resultado.erros).toHaveLength(1);
      expect(resultado.erros[0].linha).toBe(42);
      expect(resultado.erros[0].dados._linha_importacao).toBeUndefined();
      expect(resultado.erros[0].erro).toContain('Já existe um resultado ativo');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT import_row_1');
      expect(mockClient.query).toHaveBeenCalledWith('RELEASE SAVEPOINT import_row_1');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('não contabiliza inserção quando o parâmetro saiu do escopo antes da transação', async () => {
      const mockClient = {
        query: jest.fn(async (sql, params) => {
          const normalized = String(sql).toLowerCase();
          if (normalized.includes('select * from amostra')) {
            return { rows: [{ id: params[0], status_amostra: 'em_analise' }] };
          }
          if (normalized.includes('with contexto as')) return { rows: [] };
          return { rows: [] };
        }),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValue(mockClient);

      const resultado = await ImportacaoModel.inserirLote([{
        valor_medido: 0.5,
        amostra_id: 1,
        parametro_id: 20,
        datacoleta: '2024-12-01T00:00:00.000Z',
      }]);

      expect(resultado.inseridos).toBe(0);
      expect(resultado.erros[0].erro).toMatch(/fora do escopo|método inativo/i);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT import_row_1');
      expect(AmostraModel.applyStatusTransition).not.toHaveBeenCalled();
    });
  });
});
