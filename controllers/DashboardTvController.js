const DashboardTvModel = require('../models/DashboardTvModel');

class DashboardTvController {

  static async getDashboard(req, res) {
    try {
      const { parametro_id } = req.query;

      const parametroIds = parametro_id
        ? Array.isArray(parametro_id)
          ? parametro_id.map(Number)
          : parametro_id.split(',').map(Number)
        : [];

      const dados = await DashboardTvModel.getDashboardData({
        parametro_id: parametroIds
      });

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
