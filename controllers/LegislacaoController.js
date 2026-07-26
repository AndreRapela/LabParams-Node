const LegislacaoModel = require('../models/LegislacaoModel');

class LegislacaoController {
  static async findAll(req, res) {
    try {
      const dados = await LegislacaoModel.findAll();
      return res.status(200).json(dados);
    } catch (error) {
      console.error("Erro ao buscar legislações:", error);
      return res.status(500).json({ error: 'Erro interno ao buscar legislações' });
    }
  }
}

module.exports = LegislacaoController;
