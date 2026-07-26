// __tests__/importacao.controller.test.js
const ImportacaoController = require('../controllers/ImportacaoController');
const ImportacaoModel = require('../models/ImportacaoModel');
const fs = require('fs');
const path = require('path');

// Mocks
jest.mock('../models/ImportacaoModel');
jest.mock('fs');

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

      expect(res.status).toHaveBeenCalledWith(207);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          resumo: expect.objectContaining({
            total_erros: 1
          })
        })
      );
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

    test('deve processar arquivo XLS com sucesso', async () => {
      req.file = {
        path: '/tmp/arquivo.xls',
        originalname: 'dados.xls'
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
    });
  });
});
