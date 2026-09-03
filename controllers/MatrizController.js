const MatrizModel = require('../models/MatrizModel');
const { logSafeError } = require('../utils/safeError');

class MatrizController {
  static async findAll(req, res) {
    try {
      const dados = await MatrizModel.findAll();
      return res.status(200).json(dados);
    } catch (error) {
      logSafeError('matrix_list_failed', error, { request_id: req.requestId || null });
      return res.status(500).json({ error: 'Erro interno ao buscar matrizes' });
    }
  }
}

module.exports = MatrizController;
