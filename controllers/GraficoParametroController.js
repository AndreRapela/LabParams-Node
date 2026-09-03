// controllers/GraficoParametrosController.js
const GraficoParametroModel = require('../models/GraficoParametroModel');
const { logSafeError } = require('../utils/safeError');

class GraficoParametrosController {
  static async index(req, res) {
    try {
      const dados = await GraficoParametroModel.getDadosGrafico();
      
      return res.status(200).json({
        success: true,
        data: dados,
        count: dados.length
      });

    } catch (error) {
      logSafeError('parameter_chart_failed', error, { request_id: req.requestId || null });
      return res.status(500).json({
        success: false,
        message: 'Erro ao gerar dados do gráfico'
      });
    }
  }
}

module.exports = GraficoParametrosController;
