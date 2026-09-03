jest.mock('../config/database', () => ({ query: jest.fn() }));

const pool = require('../config/database');
const ParametroModel = require('../models/ParametroModel');
const MatrizModel = require('../models/MatrizModel');
const LegislacaoModel = require('../models/LegislacaoModel');
const controller = require('../controllers/GerenciamentoParametrosController');

describe('catálogo paginado de gerenciamento de parâmetros', () => {
  beforeEach(() => jest.clearAllMocks());

  test('faz COUNT e página com busca sem acento, filtros e ordem estável', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 31 }] })
      .mockResolvedValueOnce({ rows: [{ id: 99, nome: 'Cloro' }] });

    const result = await ParametroModel.findAllGerenciamento({
      page: 2,
      pageSize: 30,
      offset: 30,
      q: 'Água',
      matriz_id: 4,
      legislacao_id: 7,
    });

    expect(result).toEqual({
      rows: [{ id: 99, nome: 'Cloro' }],
      total: 31,
      page: 2,
      pageSize: 30,
    });
    const [countSql, countValues] = pool.query.mock.calls[0];
    const [pageSql, pageValues] = pool.query.mock.calls[1];
    expect(countSql.toLowerCase()).toContain('select count(*)::int as total');
    expect(pageSql.toLowerCase()).toContain('translate(lower(concat_ws');
    expect(pageSql.toLowerCase()).toContain('order by l.sigla, lc.ordem, p.categoria, p.nome, p.id');
    expect(pageSql.toLowerCase()).toContain('limit $4 offset $5');
    expect(countValues).toEqual([4, 7, '%agua%']);
    expect(pageValues).toEqual([4, 7, '%agua%', 30, 30]);
  });

  test('preserva os três catálogos e acrescenta metadados de paginação', async () => {
    const parameterSpy = jest.spyOn(ParametroModel, 'findAllGerenciamento').mockResolvedValue({
      rows: [{ id: 1 }], total: 61, page: 2, pageSize: 30,
    });
    const matrixSpy = jest.spyOn(MatrizModel, 'findAll').mockResolvedValue([{ id: 4 }]);
    const legislationSpy = jest.spyOn(LegislacaoModel, 'findAll').mockResolvedValue([{ id: 7 }]);
    const req = {
      query: { page: '2', q: ' água ', matriz_id: '4', legislacao_id: '7' },
    };
    const res = { json: jest.fn().mockReturnThis() };
    const next = jest.fn();

    await controller.listarTudo(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(parameterSpy).toHaveBeenCalledWith(expect.objectContaining({
      page: 2,
      pageSize: 30,
      offset: 30,
      q: 'água',
      matriz_id: 4,
      legislacao_id: 7,
    }));
    expect(res.json).toHaveBeenCalledWith({
      parametros: [{ id: 1 }],
      matrizes: [{ id: 4 }],
      legislacoes: [{ id: 7 }],
      pagination: {
        page: 2,
        page_size: 30,
        total: 61,
        total_pages: 3,
        has_next: true,
        has_previous: true,
      },
    });

    parameterSpy.mockRestore();
    matrixSpy.mockRestore();
    legislationSpy.mockRestore();
  });

  test('rejeita IDs, busca e page_size fora dos limites', async () => {
    expect(() => controller.parsePositiveId('0', 'matriz_id'))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO' }));
    expect(() => controller.parseSearch('x'.repeat(101)))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO' }));

    const req = { query: { page_size: '101' } };
    const res = { json: jest.fn() };
    const next = jest.fn();
    await controller.listarTudo(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PAGINACAO_INVALIDA',
      statusCode: 400,
    }));
    expect(res.json).not.toHaveBeenCalled();
  });
});
