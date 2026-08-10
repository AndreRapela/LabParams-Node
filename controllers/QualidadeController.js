const QualidadeModel = require('../models/QualidadeModel');
const { auditContext, sendData, sendPage, sendError } = require('./HttpControllerSupport');

class QualidadeController {
  static async getResumo(req, res) {
    try {
      return sendData(res, await QualidadeModel.getResumo());
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao calcular os indicadores da qualidade.');
    }
  }

  static async findResponsaveis(req, res) {
    try {
      return sendData(res, await QualidadeModel.findResponsaveis());
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar responsáveis.');
    }
  }

  static async findAll(req, res) {
    try {
      return sendPage(res, await QualidadeModel.findAll(req.query));
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar ocorrências da qualidade.');
    }
  }

  static async findById(req, res) {
    try {
      const ocorrencia = await QualidadeModel.findById(req.params.id);
      if (!ocorrencia) return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Ocorrência da qualidade não encontrada.' });
      return sendData(res, ocorrencia);
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar a ocorrência da qualidade.');
    }
  }

  static async create(req, res) {
    try {
      const ocorrencia = await QualidadeModel.create(req.body, auditContext(req));
      return sendData(res, ocorrencia, 201, 'Ocorrência registrada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao registrar a ocorrência.');
    }
  }

  static async update(req, res) {
    try {
      const ocorrencia = await QualidadeModel.update(req.params.id, req.body, auditContext(req));
      return sendData(res, ocorrencia, 200, 'Ocorrência atualizada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao atualizar a ocorrência.');
    }
  }

  static async decidir(req, res) {
    try {
      const ocorrencia = await QualidadeModel.decidir(req.params.id, req.body, auditContext(req));
      return sendData(res, ocorrencia, 200, 'Decisão registrada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao registrar a decisão.');
    }
  }

  static async createAcao(req, res) {
    try {
      const acao = await QualidadeModel.createAcao(req.params.id, req.body, auditContext(req));
      return sendData(res, acao, 201, 'Ação CAPA cadastrada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cadastrar a ação CAPA.');
    }
  }

  static async updateAcao(req, res) {
    try {
      const acao = await QualidadeModel.updateAcao(
        req.params.id, req.params.acaoId, req.body, auditContext(req)
      );
      return sendData(res, acao, 200, 'Ação CAPA atualizada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao atualizar a ação CAPA.');
    }
  }

  static async cancelarAcao(req, res) {
    try {
      const acao = await QualidadeModel.cancelarAcao(
        req.params.id, req.params.acaoId, req.body, auditContext(req)
      );
      return sendData(res, acao, 200, 'Ação CAPA cancelada.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cancelar a ação CAPA.');
    }
  }

  static async archive(req, res) {
    try {
      const ocorrencia = await QualidadeModel.archive(
        req.params.id, auditContext(req, req.body?.motivo)
      );
      return sendData(res, ocorrencia, 200, 'Ocorrência arquivada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao arquivar a ocorrência.');
    }
  }
}

module.exports = QualidadeController;
