const MatrizModel = require('../models/MatrizModel');

class MatrizController {
  static async findAll(req, res) {
    try {
      const dados = await MatrizModel.findAll();
      return res.status(200).json(dados);
    } catch (error) {
      console.error("Erro ao buscar matrizes:", error);
      return res.status(500).json({ error: 'Erro interno ao buscar matrizes' });
    }
  }
}

module.exports = MatrizController;
