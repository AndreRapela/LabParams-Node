const DashboardWebModel = require('../models/DashboardWebModel');
const pool = require('../config/database');

const VALID_STATUSES = new Set([
  'conforme',
  'alerta',
  'critico',
  'nao-conforme',
]);

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePositiveId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function calculatePercentage(value, minimum, maximum) {
  if (minimum === maximum) return 0;
  const percentage = ((value - minimum) / (maximum - minimum)) * 100;
  return Math.round(Math.min(100, Math.max(0, percentage)) * 10) / 10;
}

function determineStatus(value, minimum, maximum, percentage) {
  if (value < minimum || value > maximum) return 'nao-conforme';
  if (percentage >= 30 && percentage <= 70) return 'conforme';
  if (
    (percentage >= 20 && percentage < 30) ||
    (percentage > 70 && percentage <= 80)
  ) {
    return 'alerta';
  }
  return 'critico';
}

function formatDashboardItem(item, index) {
  const value = parseNumber(item.valor_parametro);
  const minimum = parseNumber(item.limite_minimo);
  const maximum = parseNumber(item.limite_maximo);
  const percentage = calculatePercentage(value, minimum, maximum);

  return {
    id: item.id || index + 1,
    parametro_id: item.parametro_id,
    parameter_name: item.nome || `Parâmetro ${index + 1}`,
    current_value: value,
    valor_parametro: value,
    min_limit: minimum,
    max_limit: maximum,
    limite_minimo: minimum,
    limite_maximo: maximum,
    unit: item.unidade_medida || '',
    unidade_medida: item.unidade_medida || '',
    porcentagem: percentage,
    status: determineStatus(value, minimum, maximum, percentage),
    last_update: item.created_at || new Date().toISOString(),
    matriz_nome: item.matriz_nome || '',
    legislacao_sigla: item.legislacao_sigla || '',
    legislacao_nome: item.legislacao_nome || '',
    matriz_id: item.matriz_id || null,
    legislacao_id: item.legislacao_id || null,
  };
}

function buildStatistics(data) {
  const counts = data.reduce(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { conforme: 0, alerta: 0, critico: 0, 'nao-conforme': 0 }
  );

  return {
    compliant_count: counts.conforme,
    alert_count: counts.alerta,
    critical_count: counts.critico,
    non_compliant_count: counts['nao-conforme'],
    total_parameters: data.length,
  };
}

const DashboardWebController = {
  async getDashboardData(req, res) {
    try {
      const parameterIds = req.query.parametro_id
        ? String(req.query.parametro_id)
            .split(',')
            .map(parsePositiveId)
            .filter(Boolean)
        : null;

      const filters = {
        matriz_id: parsePositiveId(req.query.matriz_id),
        legislacao_id: parsePositiveId(req.query.legislacao_id),
        amostra_numero: req.query.amostra_numero || null,
        parametro_id: parameterIds?.length ? parameterIds : null,
        data_coleta: req.query.data_coleta || null,
        data_publicacao: req.query.data_publicacao || null,
      };

      const requestedStatuses = req.query.status
        ? String(req.query.status)
            .split(',')
            .map((status) => status.trim().toLowerCase())
            .filter((status) => VALID_STATUSES.has(status))
        : [];

      const rows = await DashboardWebModel.getDashboardData(filters);
      let data = rows.map(formatDashboardItem);

      if (requestedStatuses.length) {
        data = data.filter((item) => requestedStatuses.includes(item.status));
      }

      return res.json({
        success: true,
        data,
        statistics: buildStatistics(data),
        last_updated: new Date().toISOString(),
        filters_applied: filters,
        ...(data.length ? {} : { message: 'Nenhum resultado encontrado' }),
      });
    } catch (error) {
      console.error('Erro ao carregar dashboard:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Erro interno ao carregar dados',
        data: [],
        statistics: buildStatistics([]),
        timestamp: new Date().toISOString(),
      });
    }
  },

  async getFilterOptions(_req, res) {
    try {
      const [matrizesResult, legislacoesResult] = await Promise.all([
        pool.query('SELECT id, nome FROM matriz ORDER BY nome'),
        pool.query('SELECT id, nome, sigla FROM legislacao ORDER BY nome'),
      ]);

      const legislacoes = legislacoesResult.rows.map((legislacao) => ({
        ...legislacao,
        nome:
          legislacao.sigla &&
          legislacao.nome?.includes(`(${legislacao.sigla})`)
            ? legislacao.nome.replace(` (${legislacao.sigla})`, '').trim()
            : legislacao.nome || legislacao.sigla,
      }));

      return res.json({
        success: true,
        matrizes: matrizesResult.rows,
        legislacoes,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Erro ao carregar opções de filtro:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Erro ao carregar opções de filtro',
        matrizes: [],
        legislacoes: [],
      });
    }
  },
};

module.exports = DashboardWebController;
