jest.mock('../config/database', () => ({ query: jest.fn() }));

const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const DashboardWebModel = require('../models/DashboardWebModel');
const DashboardTvModel = require('../models/DashboardTvModel');
const GraficoParametroModel = require('../models/GraficoParametroModel');
const AlertaModel = require('../models/AlertaModel');
const DashboardWebController = require('../controllers/DashboardWebController');
const DashboardTvController = require('../controllers/DashboardTvController');
const AlertaController = require('../controllers/AlertaController');
const { resetStatusOperacionalCapability } = require('../utils/conformidade');

describe('dashboards baseados em resultados publicados e congelados', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStatusOperacionalCapability();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('dashboard web usa snapshot e IDs persistidos, sem cadastro vivo', async () => {
    await DashboardWebModel.getDashboardData({
      parametro_id: [2, 3],
      legislacao_id: 4,
    });

    const [sql, values] = pool.query.mock.calls[1];
    expect(sql).toContain('ra.snapshot_analitico');
    expect(sql).toContain("ra.status_resultado = 'publicado'");
    expect(sql).toContain('status_operacional');
    expect(sql).toContain('limit $3 offset $4');
    expect(sql).not.toContain('join parametro');
    expect(sql).not.toContain('join legislacao');
    expect(values).toEqual([4, [2, 3], 100, 0]);
  });

  test('dashboard TV retorna somente a publicação mais recente por parâmetro', async () => {
    await DashboardTvModel.getDashboardData({ parametro_id: [2] });
    const [tvSql, tvValues] = pool.query.mock.calls[1];

    expect(tvSql).toContain('select distinct on (ra.parametro_id)');
    expect(tvSql).toContain('ra.publicado_em desc nulls last');
    expect(tvSql).toContain('ra.created_at desc');
    expect(tvSql).toContain('ra.id desc');
    expect(tvSql).toContain('status_operacional');
    expect(tvSql).toContain('ra.snapshot_analitico');
    expect(tvSql).not.toContain('join parametro');
    expect(tvValues).toEqual([[2]]);

    await GraficoParametroModel.getDadosGrafico();
    const [chartSql] = pool.query.mock.calls[2];
    expect(chartSql).toContain('ra.snapshot_analitico');
    expect(chartSql).not.toContain('join parametro');
  });

  test('migration cria índice alinhado ao snapshot atual da TV', () => {
    const migration = fs.readFileSync(path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260811010000_secure_defaults_and_dashboard_indexes.sql',
    ), 'utf8').toLowerCase();

    expect(migration).toContain(
      'create index concurrently if not exists resultado_publicado_parametro_publicacao_idx',
    );
    expect(migration).toContain(
      '(parametro_id, publicado_em desc nulls last, created_at desc, id desc)',
    );
  });

  test('dashboard TV preserva o status SQL como fonte autoritativa', async () => {
    const model = jest.spyOn(DashboardTvModel, 'getDashboardData').mockResolvedValue([{
      id: 1,
      parametro_id: 2,
      valor_parametro: 50,
      limite_maximo: 100,
      tipo_limite: 'maximo',
      status_operacional: 'critico',
    }]);
    const req = { query: {}, requestId: 'tv-status' };
    const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };

    await DashboardTvController.getDashboard(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        status_operacional: 'critico',
        status_conformidade: 'critico',
      })],
    }));
    model.mockRestore();
  });

  test('alertas preservam o snapshot publicado e distinguem prevenção de desvio grave', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({
      rows: [
        { id: 1, valor_medido: 90, limite_minimo: null, limite_maximo: 100, tipo_limite: 'maximo' },
        { id: 2, valor_medido: 110, limite_minimo: null, limite_maximo: 100, tipo_limite: 'maximo' },
        { id: 3, valor_medido: 130, limite_minimo: null, limite_maximo: 100, tipo_limite: 'maximo' },
      ],
    });

    const alerts = await AlertaModel.getAlertas();
    const [sql, values] = pool.query.mock.calls[1];

    expect(sql).toContain('ra.snapshot_analitico');
    expect(sql).toContain("ra.status_resultado = 'publicado'");
    expect(sql.indexOf("status_operacional in ('alerta', 'nao-conforme', 'critico')"))
      .toBeLessThan(sql.indexOf('limit $1 offset $2'));
    expect(sql).toContain('order by publicado_em_ordem desc, id desc');
    expect(sql).not.toContain('order by data_alerta desc');
    expect(sql).not.toContain('join parametro');
    expect(values).toEqual([100, 0]);
    expect(alerts.rows.map((item) => item.status)).toEqual([
      'ALERTA',
      'NÃO CONFORME',
      'CRÍTICO',
    ]);
    expect(alerts.stats).toEqual({ total: 3, alerta: 1, naoConforme: 1, critico: 1 });
  });

  test('dashboard rejeita filtros inválidos em vez de ignorá-los e consultar tudo', async () => {
    expect(() => DashboardWebController.parseParameterIds('1,invalido'))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO', statusCode: 400 }));
    expect(() => DashboardWebController.parseDate('2026-02-30', 'data_coleta'))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO', statusCode: 400 }));
    expect(() => DashboardWebController.parseStatuses('conforme,desconhecido'))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO', statusCode: 400 }));
    expect(DashboardWebController.parseParameterIds(['2', '2,3'])).toEqual([2, 3]);

    const req = { query: { matriz_id: 'abc' }, requestId: 'req-dashboard-invalid' };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    await DashboardWebController.getDashboardData(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'FILTRO_INVALIDO',
      request_id: 'req-dashboard-invalid',
    }));
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('dashboard pagina depois dos filtros e retorna totais globais', async () => {
    const model = jest.spyOn(DashboardWebModel, 'getDashboardData').mockResolvedValue({
      rows: [{
        id: 10,
        valor_parametro: 95,
        limite_maximo: 100,
        tipo_limite: 'maximo',
      }],
      total: 26,
      page: 2,
      pageSize: 25,
      statistics: {
        compliant_count: 0,
        alert_count: 26,
        critical_count: 0,
        non_compliant_count: 0,
        informative_count: 0,
        total_parameters: 26,
      },
    });
    const req = {
      query: { page: '2', page_size: '25', status: 'alerta' },
      requestId: 'dashboard-page',
    };
    const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };

    await DashboardWebController.getDashboardData(req, res);

    expect(model).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      page: 2,
      pageSize: 25,
      offset: 25,
      statuses: ['alerta'],
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ status: 'alerta' })],
      statistics: expect.objectContaining({ alert_count: 26 }),
      pagination: {
        page: 2,
        page_size: 25,
        total: 26,
        total_pages: 2,
        has_next: false,
        has_previous: true,
      },
    }));
    model.mockRestore();
  });

  test('alertas validam paginação, busca e status canônico', async () => {
    expect(AlertaController.parseAlertStatuses('alerta,critico'))
      .toEqual(['alerta', 'critico']);
    expect(() => AlertaController.parseAlertStatuses('NÃO CONFORME'))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO' }));
    expect(() => AlertaController.parseSearch({ q: 'x'.repeat(101) }))
      .toThrow(expect.objectContaining({ code: 'FILTRO_INVALIDO' }));

    const req = { query: { page_size: '101' }, requestId: 'alerts-invalid-page' };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await AlertaController.index(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PAGINACAO_INVALIDA',
    }));
    expect(pool.query).not.toHaveBeenCalled();
  });
});
