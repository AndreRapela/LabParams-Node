const AlertasModel = require('../models/AlertaModel');
const { parsePagination, workflowError } = require('../utils/workflowPiloto');
const { logSafeError } = require('../utils/safeError');

const ALERT_STATUSES = new Set(['alerta', 'nao-conforme', 'critico']);

function parseAlertStatuses(value) {
  if (value === null || value === undefined || value === '') return [];
  const statuses = (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!statuses.length || statuses.some((status) => !ALERT_STATUSES.has(status))) {
    throw workflowError(
      'status deve conter alerta, nao-conforme ou critico.',
      400,
      'FILTRO_INVALIDO'
    );
  }
  return [...new Set(statuses)];
}

function parseSearch(query = {}) {
  const search = String(query.q ?? query.search ?? '').trim();
  if (search.length > 100) {
    throw workflowError('A busca deve ter no máximo 100 caracteres.', 400, 'FILTRO_INVALIDO');
  }
  return search;
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

class AlertasController {
  static async index(req, res) {
    try {
      const pagination = parsePagination({
        page: req.query.page ?? 1,
        page_size: req.query.page_size ?? 100,
      });
      const statuses = parseAlertStatuses(req.query.status);
      const search = parseSearch(req.query);
      const result = await AlertasModel.getAlertas({
        ...pagination,
        statuses,
        search,
      });

      return res.status(200).json({
        success: true,
        data: result.rows,
        stats: result.stats,
        stats_scope: 'filtered_results',
        pagination: buildPagination(result),
        filters_applied: {
          q: search || null,
          status: statuses.length ? statuses : null,
        },
      });
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      if (status >= 500) {
        logSafeError('alert_list_failed', error, { request_id: req.requestId || null });
      }
      return res.status(status).json({
        success: false,
        error: status < 500 ? error.message : 'Erro interno ao buscar alertas',
        code: error.code,
        request_id: req.requestId,
        data: [],
        stats: { total: 0, alerta: 0, naoConforme: 0, critico: 0 },
      });
    }
  }
}

module.exports = AlertasController;
module.exports.parseAlertStatuses = parseAlertStatuses;
module.exports.parseSearch = parseSearch;
