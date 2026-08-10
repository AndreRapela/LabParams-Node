const LaudoModel = require('../models/LaudoModel');

class VerificacaoLaudoController {
  static async verify(req, res) {
    try {
      const report = await LaudoModel.verify(req.params.hash);
      if (!report) {
        return res.status(404).json({
          success: false,
          valid: false,
          message: 'Nenhum laudo corresponde a este hash.',
          request_id: req.requestId,
        });
      }
      return res.status(report.integridade_valida ? 200 : 409).json({
        success: report.integridade_valida,
        valid: report.integridade_valida,
        message: report.integridade_valida
          ? 'Laudo autêntico e íntegro.'
          : 'A integridade ou a assinatura do laudo não pôde ser confirmada.',
        data: report,
        request_id: req.requestId,
      });
    } catch (error) {
      const status = Number(error.statusCode) || 500;
      return res.status(status).json({
        success: false,
        valid: false,
        message: status < 500 ? error.message : 'Erro interno ao verificar o laudo.',
        request_id: req.requestId,
      });
    }
  }
}

module.exports = VerificacaoLaudoController;
