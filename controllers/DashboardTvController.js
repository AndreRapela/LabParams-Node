const DashboardTvModel = require('../models/DashboardTvModel');
const { avaliarStatusOperacional } = require('../utils/conformidade');

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
      const dados = rows.map((item) => ({
        ...item,
        status_conformidade: avaliarStatusOperacional({
          ...item,
          valor_medido: item.valor_parametro,
        }),
      }));

      return res.json({
        success: true,
        data: dados,
        count: dados.length
      });

    } catch (error) {
      console.error('Erro Dashboard TV:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao carregar dashboard TV'
      });
    }
  }
}

module.exports = DashboardTvController;
