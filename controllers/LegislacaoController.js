const LegislacaoModel = require('../models/LegislacaoModel');
const { logSafeError } = require('../utils/safeError');

class LegislacaoController {
  static async findAll(req, res) {
    try {
      const dados = await LegislacaoModel.findAll();
      return res.status(200).json(dados);
    } catch (error) {
      logSafeError('legislation_list_failed', error, { request_id: req.requestId || null });
      return res.status(500).json({ error: 'Erro interno ao buscar legislações' });
    }
  }
}

module.exports = LegislacaoController;
