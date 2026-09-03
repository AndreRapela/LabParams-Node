// __tests__/importacao.controller.test.js
const ImportacaoController = require('../controllers/ImportacaoController');
const ImportacaoModel = require('../models/ImportacaoModel');
const fs = require('fs');
const path = require('path');
const readXlsxFile = require('read-excel-file/node');
const readXlsxSheet = readXlsxFile.readSheet || readXlsxFile;

// Mocks
jest.mock('../models/ImportacaoModel');
jest.mock('fs');
jest.mock('read-excel-file/node');

describe('ImportacaoController', () => {
  
  let req, res;

  beforeEach(() => {
    req = {
      file: null,
      query: {}
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis()
    };
    jest.clearAllMocks();
  });

  describe('importarResultadosAnalise', () => {
    
    test('deve retornar erro 400 se nenhum arquivo for enviado', async () => {
      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Nenhum arquivo foi enviado'
        })
      );
    });

    test('deve retornar erro 400 para extensão inválida', async () => {
      req.file = {
        path: '/tmp/arquivo.txt',
        originalname: 'dados.txt'
      };

      fs.promises = {
        unlink: jest.fn().mockResolvedValue()
      };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Formato de arquivo não suportado'
        })
      );
    });

    test('deve processar arquivo CSV com sucesso', async () => {
      req.file = {
        path: '/tmp/arquivo.csv',
        originalname: 'dados.csv'
      };

      // Mock do lerCSV
      jest.spyOn(ImportacaoController, 'lerCSV').mockResolvedValue([
        {
          datacoleta: '01/12/2024',
          valor_medido: '0.5',
          legislacao: 'Portaria 888/2021',
          matriz: 'Água',
          numerodaamostra: '001',
          codigodaamostra: 'AMO-001',
          parametro: 'Turbidez'
        }
      ]);

      // Mock do validarLinha
      ImportacaoModel.validarLinha.mockResolvedValue({
        sucesso: true,
        dados: {
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
        erro: null
      });

      // Mock do inserirLote
      ImportacaoModel.inserirLote.mockResolvedValue({
        inseridos: 1,
        erros: []
      });

      fs.promises = {
        unlink: jest.fn().mockResolvedValue()
      };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          resumo: expect.objectContaining({
            total_linhas: 1,
            inseridas_no_banco: 1
          })
        })
      );
    });

    test('deve retornar erros de validação', async () => {
      req.file = {
        path: '/tmp/arquivo.csv',
        originalname: 'dados.csv'
      };

      jest.spyOn(ImportacaoController, 'lerCSV').mockResolvedValue([
        {
          datacoleta: '01/12/2024',
          valor_medido: 'abc', // inválido
          legislacao: 'Portaria 888/2021',
          matriz: 'Água',
          numerodaamostra: '001',
          codigodaamostra: 'AMO-001',
          parametro: 'Turbidez'
        }
      ]);

      ImportacaoModel.validarLinha.mockResolvedValue({
        sucesso: false,
        dados: null,
        erro: 'Valor medido inválido'
      });

      fs.promises = {
        unlink: jest.fn().mockResolvedValue()
      };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          resumo: expect.objectContaining({
            total_erros: 1
          })
        })
      );
    });

    test('usa 207 somente quando parte do arquivo foi inserida', async () => {
      req.file = { path: '/tmp/parcial.csv', originalname: 'parcial.csv' };
      const row = {
        datacoleta: '01/12/2024', valor_medido: '0.5', legislacao: 'Portaria 888/2021',
        matriz: 'Água', numerodaamostra: '001', codigodaamostra: 'AMO-001',
        parametro: 'Turbidez',
      };
      jest.spyOn(ImportacaoController, 'lerCSV').mockResolvedValue([row, { ...row }]);
      ImportacaoModel.validarLinha
        .mockResolvedValueOnce({ sucesso: true, dados: { amostra_id: 1, parametro_id: 20 } })
        .mockResolvedValueOnce({ sucesso: false, dados: null, erro: 'Linha inválida' });
      ImportacaoModel.inserirLote.mockResolvedValue({ inseridos: 1, erros: [] });
      fs.promises = { unlink: jest.fn().mockResolvedValue() };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'Importação concluída parcialmente',
        resumo: expect.objectContaining({ inseridas_no_banco: 1, total_erros: 1 }),
        erros: expect.arrayContaining([expect.objectContaining({ linha: 3 })]),
      }));
    });

    test('deve limpar arquivo temporário após processamento', async () => {
      req.file = {
        path: '/tmp/arquivo.csv',
        originalname: 'dados.csv'
      };

      jest.spyOn(ImportacaoController, 'lerCSV').mockResolvedValue([]);

      fs.promises = {
        unlink: jest.fn().mockResolvedValue()
      };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/arquivo.csv');
    });

    test('deve rejeitar arquivos com mais de 5.000 linhas', async () => {
      req.file = { path: '/tmp/grande.csv', originalname: 'grande.csv' };
      jest.spyOn(ImportacaoController, 'lerCSV').mockResolvedValue(
        Array.from({ length: 5001 }, () => ({ datacoleta: '01/01/2024' }))
      );
      fs.promises = { unlink: jest.fn().mockResolvedValue() };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Arquivo excede o limite de linhas',
      }));
    });

    test('deve ocultar detalhes internos quando a leitura falhar', async () => {
      req.file = { path: '/tmp/falha.csv', originalname: 'falha.csv' };
      jest.spyOn(ImportacaoController, 'lerCSV').mockRejectedValue(new Error('detalhe interno'));
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      fs.promises = { unlink: jest.fn().mockResolvedValue() };

      await ImportacaoController.importarResultadosAnalise(req, res);
      errorLog.mockRestore();

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Erro interno ao processar importação',
      });
    });
  });

  describe('baixarTemplate', () => {
    
    test('deve gerar template CSV', async () => {
      req.query.formato = 'csv';

      await ImportacaoController.baixarTemplate(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=template_importacao.csv');
      expect(res.send).toHaveBeenCalled();
    });

    test('deve gerar template XLSX', async () => {
      req.query.formato = 'xlsx';

      await ImportacaoController.baixarTemplate(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename=template_importacao.xlsx');
      expect(res.send).toHaveBeenCalled();
    });

    test('deve retornar erro para formato inválido', async () => {
      req.query.formato = 'pdf';

      await ImportacaoController.baixarTemplate(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'Formato inválido'
        })
      );
    });

    test('deve usar formato CSV como padrão quando não especificado', async () => {
      req.query = {}; // Sem formato especificado

      await ImportacaoController.baixarTemplate(req, res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('processamento de arquivos Excel', () => {

    beforeEach(() => {
      if (!jest.isMockFunction(ImportacaoController.validarArquivoXlsx)) {
        jest.spyOn(ImportacaoController, 'validarArquivoXlsx');
      }
      ImportacaoController.validarArquivoXlsx.mockResolvedValue();
    });

    test('deve ler XLSX, normalizar cabeçalhos e converter datas', async () => {
      readXlsxSheet.mockResolvedValue([
        [' DataColeta ', 'VALOR_MEDIDO', 'observacao'],
        [new Date('2024-12-01T00:00:00.000Z'), 0.5, ' ok '],
        [null, null, null],
      ]);

      const linhas = await ImportacaoController.lerExcel('/tmp/arquivo.xlsx');

      expect(linhas).toEqual([{
        datacoleta: '01/12/2024',
        valor_medido: '0.5',
        observacao: 'ok',
      }]);
    });

    test('deve rejeitar XLSX sem cabeçalhos', async () => {
      readXlsxSheet.mockResolvedValue([[null, null], ['valor', 1]]);
      await expect(ImportacaoController.lerExcel('/tmp/arquivo.xlsx'))
        .rejects.toThrow('A primeira linha deve conter os cabeçalhos');
    });

    test('deve retornar vazio para XLSX sem linhas', async () => {
      readXlsxSheet.mockResolvedValue([]);
      await expect(ImportacaoController.lerExcel('/tmp/vazio.xlsx')).resolves.toEqual([]);
    });
    
    test('deve processar arquivo XLSX com sucesso', async () => {
      req.file = {
        path: '/tmp/arquivo.xlsx',
        originalname: 'dados.xlsx'
      };

      jest.spyOn(ImportacaoController, 'lerExcel').mockResolvedValue([
        {
          datacoleta: '01/12/2024',
          valor_medido: '0.5',
          legislacao: 'Portaria 888/2021',
          matriz: 'Água',
          numerodaamostra: '001',
          codigodaamostra: 'AMO-001',
          parametro: 'Turbidez'
        }
      ]);

      ImportacaoModel.validarLinha.mockResolvedValue({
        sucesso: true,
        dados: {
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
        erro: null
      });

      ImportacaoModel.inserirLote.mockResolvedValue({
        inseridos: 1,
        erros: []
      });

      fs.promises = {
        unlink: jest.fn().mockResolvedValue()
      };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true
        })
      );
    });

    test('deve rejeitar XLSX suspeito com resposta 400 sem expor detalhes internos', async () => {
      req.file = { path: '/tmp/suspeito.xlsx', originalname: 'suspeito.xlsx' };
      const error = new Error('detalhe estrutural sensível');
      error.code = 'XLSX_SECURITY_LIMIT';
      jest.spyOn(ImportacaoController, 'lerExcel').mockRejectedValue(error);
      fs.promises = { unlink: jest.fn().mockResolvedValue() };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: expect.stringMatching(/XLSX.*limites de segurança/i),
      }));
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('detalhe estrutural');
    });

    test('deve rejeitar o formato XLS legado', async () => {
      req.file = {
        path: '/tmp/arquivo.xls',
        originalname: 'dados.xls'
      };

      await ImportacaoController.importarResultadosAnalise(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Formato de arquivo não suportado',
      }));
    });
  });
});
