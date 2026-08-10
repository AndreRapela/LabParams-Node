jest.mock('../config/database', () => ({ query: jest.fn() }));

const pool = require('../config/database');
const DashboardWebModel = require('../models/DashboardWebModel');
const DashboardTvModel = require('../models/DashboardTvModel');
const GraficoParametroModel = require('../models/GraficoParametroModel');

describe('dashboards baseados em resultados publicados e congelados', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('dashboard web usa snapshot e IDs persistidos, sem cadastro vivo', async () => {
    await DashboardWebModel.getDashboardData({
      parametro_id: [2, 3],
      legislacao_id: 4,
    });

    const [sql, values] = pool.query.mock.calls[0];
    expect(sql).toContain('ra.snapshot_analitico');
    expect(sql).toContain("ra.status_resultado = 'publicado'");
    expect(sql).not.toContain('join parametro');
    expect(sql).not.toContain('join legislacao');
    expect(values).toEqual([4, [2, 3]]);
  });

  test('dashboard TV e gráfico não recalculam nomes por cadastros mutáveis', async () => {
    await DashboardTvModel.getDashboardData({ parametro_id: [2] });
    await GraficoParametroModel.getDadosGrafico();

    for (const [sql] of pool.query.mock.calls) {
      expect(sql).toContain('ra.snapshot_analitico');
      expect(sql).not.toContain('join parametro');
    }
  });
});
