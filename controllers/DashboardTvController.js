const DashboardTvModel = require('../models/DashboardTvModel');
const {
  STATUS_OPERACIONAIS,
  avaliarStatusOperacional,
} = require('../utils/conformidade');
const { logSafeError } = require('../utils/safeError');

const VALID_OPERATIONAL_STATUSES = new Set(STATUS_OPERACIONAIS);

class DashboardTvController {

  static async getDashboard(req, res) {
    try {
      const { parametro_id } = req.query;

      const rawParameterIds = parametro_id
        ? (Array.isArray(parametro_id) ? parametro_id : String(parametro_id).split(','))
        : [];
      const parametroIds = rawParameterIds.map(Number);
      if (parametroIds.length > 100
          || parametroIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        return res.status(400).json({
          success: false,
          message: 'Filtro de parâmetros inválido.',
          request_id: req.requestId,
        });
      }

      const rows = await DashboardTvModel.getDashboardData({
        parametro_id: parametroIds
      });
      const dados = rows.map((item) => {
        const fallbackStatus = avaliarStatusOperacional({
          ...item,
          valor_medido: item.valor_parametro,
        });
        const status = VALID_OPERATIONAL_STATUSES.has(item.status_operacional)
          ? item.status_operacional
          : fallbackStatus;

        return {
          ...item,
          status_operacional: status,
          status_conformidade: status,
        };
      });

      return res.json({
        success: true,
        data: dados,
        count: dados.length
      });

    } catch (error) {
      logSafeError('tv_dashboard_failed', error, { request_id: req.requestId || null });
      res.status(500).json({
        success: false,
        message: 'Erro ao carregar dashboard TV'
      });
    }
  }
}

module.exports = DashboardTvController;
