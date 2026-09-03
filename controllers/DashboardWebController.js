const DashboardWebModel = require('../models/DashboardWebModel');
const pool = require('../config/database');
const { avaliarStatusOperacional } = require('../utils/conformidade');
const { parsePagination, workflowError } = require('../utils/workflowPiloto');
const { logSafeError } = require('../utils/safeError');

const VALID_STATUSES = new Set([
  'conforme',
  'alerta',
  'critico',
  'nao-conforme',
  'informativo',
]);

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveId(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw workflowError(`${field} deve ser um identificador inteiro positivo.`, 400, 'FILTRO_INVALIDO');
  }
  return parsed;
}

function parseDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw workflowError(`${field} deve usar o formato AAAA-MM-DD.`, 400, 'FILTRO_INVALIDO');
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw workflowError(`${field} não é uma data válida.`, 400, 'FILTRO_INVALIDO');
  }
  return normalized;
}

function parseParameterIds(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
  if (!raw.length || raw.length > 100) {
    throw workflowError('Informe entre 1 e 100 parâmetros.', 400, 'FILTRO_INVALIDO');
  }
  return [...new Set(raw.map((item) => parsePositiveId(item, 'parametro_id')))];
}

function parseStatuses(value) {
  if (value === null || value === undefined || value === '') return [];
  const statuses = String(value)
    .split(',')
    .map((status) => status.trim().toLowerCase())
    .filter(Boolean);
  if (!statuses.length || statuses.some((status) => !VALID_STATUSES.has(status))) {
    throw workflowError('Status de conformidade inválido.', 400, 'FILTRO_INVALIDO');
  }
  return [...new Set(statuses)];
}

function parseSampleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 100) {
    throw workflowError('Número da amostra inválido.', 400, 'FILTRO_INVALIDO');
  }
  return normalized;
}

function sendDashboardError(req, res, error, fallback) {
  const status = Number(error.statusCode) || 500;
  if (status >= 500) {
    logSafeError('dashboard_web_failed', error, { request_id: req.requestId || null });
  }
  return res.status(status).json({
    success: false,
    message: status < 500 ? error.message : fallback,
    code: error.code,
    request_id: req.requestId,
    data: [],
    statistics: buildStatistics([]),
  });
}

function calculatePercentage(value, minimum, maximum) {
  if (value === null) return 0;
  if (minimum === null && maximum !== null && maximum > 0) {
    return Math.round(Math.min(100, Math.max(0, (value / maximum) * 100)) * 10) / 10;
  }
  if (minimum === null || maximum === null || minimum === maximum) return 0;
  const percentage = ((value - minimum) / (maximum - minimum)) * 100;
  return Math.round(Math.min(100, Math.max(0, percentage)) * 10) / 10;
}

function formatDashboardItem(item, index) {
  const numericValue = parseNumber(item.valor_parametro);
  const minimum = parseNumber(item.limite_minimo);
  const maximum = parseNumber(item.limite_maximo);
  const percentage = calculatePercentage(numericValue, minimum, maximum);
  const calculatedStatus = avaliarStatusOperacional({
    ...item,
    valor_medido: numericValue,
  });
  const status = VALID_STATUSES.has(item.status_operacional)
    ? item.status_operacional
    : calculatedStatus;

  return {
    id: item.id || index + 1,
    parametro_id: item.parametro_id,
    parameter_name: item.nome || `Parâmetro ${index + 1}`,
    current_value: item.valor_qualitativo || numericValue,
    valor_parametro: numericValue,
    valor_qualitativo: item.valor_qualitativo,
    min_limit: minimum,
    max_limit: maximum,
    limite_minimo: minimum,
    limite_maximo: maximum,
    unit: item.unidade_medida || '',
    unidade_medida: item.unidade_medida || '',
    porcentagem: percentage,
    tipo_limite: item.tipo_limite,
    criterio_legal: item.criterio_legal,
    status,
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
      if (Object.hasOwn(summary, item.status)) summary[item.status] += 1;
      return summary;
    },
    { conforme: 0, alerta: 0, critico: 0, 'nao-conforme': 0, informativo: 0 }
  );

  return {
    compliant_count: counts.conforme,
    alert_count: counts.alerta,
    critical_count: counts.critico,
    non_compliant_count: counts['nao-conforme'],
    informative_count: counts.informativo,
    total_parameters: data.length,
  };
}

function buildPagination({ page, pageSize, total }) {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_previous: page > 1 && totalPages > 0,
  };
}

const DashboardWebController = {
  async getDashboardData(req, res) {
    try {
      const parameterIds = parseParameterIds(req.query.parametro_id);

      const filters = {
        matriz_id: parsePositiveId(req.query.matriz_id, 'matriz_id'),
        legislacao_id: parsePositiveId(req.query.legislacao_id, 'legislacao_id'),
        amostra_numero: parseSampleNumber(req.query.amostra_numero),
        parametro_id: parameterIds,
        data_coleta: parseDate(req.query.data_coleta, 'data_coleta'),
        data_publicacao: parseDate(req.query.data_publicacao, 'data_publicacao'),
      };

      const requestedStatuses = parseStatuses(req.query.status);
      const pagination = parsePagination({
        page: req.query.page ?? 1,
        page_size: req.query.page_size ?? 100,
      });

      const result = await DashboardWebModel.getDashboardData(filters, {
        ...pagination,
        statuses: requestedStatuses,
      });
      const data = result.rows.map(formatDashboardItem);

      return res.json({
        success: true,
        data,
        statistics: result.statistics,
        statistics_scope: 'filtered_results',
        pagination: buildPagination(result),
        last_updated: new Date().toISOString(),
        filters_applied: {
          ...filters,
          status: requestedStatuses.length ? requestedStatuses : null,
        },
        ...(data.length ? {} : { message: 'Nenhum resultado encontrado' }),
      });
    } catch (error) {
      return sendDashboardError(req, res, error, 'Erro interno ao carregar dados');
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
      const status = Number(error.statusCode) || 500;
      if (status >= 500) {
        logSafeError('dashboard_filter_options_failed', error, {
          request_id: _req.requestId || null,
        });
      }
      return res.status(status).json({
        success: false,
        message: status < 500 ? error.message : 'Erro ao carregar opções de filtro',
        code: error.code,
        request_id: _req.requestId,
        matrizes: [],
        legislacoes: [],
      });
    }
  },
};

module.exports = DashboardWebController;
module.exports.parseDate = parseDate;
module.exports.parseParameterIds = parseParameterIds;
module.exports.parsePositiveId = parsePositiveId;
module.exports.parseStatuses = parseStatuses;
