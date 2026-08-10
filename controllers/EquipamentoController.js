const EquipamentoModel = require('../models/EquipamentoModel');
const { auditContext, sendData, sendPage, sendError } = require('./HttpControllerSupport');

class EquipamentoController {
  static async getResumo(req, res) {
    try {
      return sendData(res, await EquipamentoModel.getResumo());
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao calcular os indicadores de equipamentos.');
    }
  }

  static async findAll(req, res) {
    try {
      return sendPage(res, await EquipamentoModel.findAll(req.query));
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar equipamentos.');
    }
  }

  static async findById(req, res) {
    try {
      const equipamento = await EquipamentoModel.findById(req.params.id);
      if (!equipamento) return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Equipamento não encontrado.' });
      return sendData(res, equipamento);
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar o equipamento.');
    }
  }

  static async create(req, res) {
    try {
      const equipamento = await EquipamentoModel.create(req.body, auditContext(req));
      return sendData(res, equipamento, 201, 'Equipamento cadastrado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cadastrar o equipamento.');
    }
  }

  static async update(req, res) {
    try {
      const equipamento = await EquipamentoModel.update(req.params.id, req.body, auditContext(req));
      return sendData(res, equipamento, 200, 'Equipamento atualizado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao atualizar o equipamento.');
    }
  }

  static async definirStatus(req, res) {
    try {
      const equipamento = await EquipamentoModel.definirStatus(
        req.params.id, req.body, auditContext(req)
      );
      return sendData(res, equipamento, 200, 'Status do equipamento atualizado.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao alterar o status do equipamento.');
    }
  }

  static async configurarCalibracao(req, res) {
    try {
      const equipamento = await EquipamentoModel.configurarCalibracao(
        req.params.id, req.body, auditContext(req)
      );
      return sendData(res, equipamento, 200, 'Configuração de calibração atualizada.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao configurar a calibração.');
    }
  }

  static async findEventos(req, res) {
    try {
      return sendPage(res, await EquipamentoModel.findEventos(req.params.id, req.query));
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar o histórico do equipamento.');
    }
  }

  static async createEvento(req, res) {
    try {
      const evento = await EquipamentoModel.createEvento(req.params.id, req.body, auditContext(req));
      return sendData(res, evento, 201, 'Evento cadastrado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cadastrar o evento.');
    }
  }

  static async iniciarEvento(req, res) {
    try {
      const evento = await EquipamentoModel.iniciarEvento(
        req.params.id, req.params.eventoId, auditContext(req)
      );
      return sendData(res, evento, 200, 'Intervenção iniciada.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao iniciar a intervenção.');
    }
  }

  static async concluirEvento(req, res) {
    try {
      const result = await EquipamentoModel.concluirEvento(
        req.params.id, req.params.eventoId, req.body, auditContext(req)
      );
      return sendData(res, result, 200, 'Evento concluído com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao concluir o evento.');
    }
  }

  static async cancelarEvento(req, res) {
    try {
      const evento = await EquipamentoModel.cancelarEvento(
        req.params.id, req.params.eventoId, req.body, auditContext(req)
      );
      return sendData(res, evento, 200, 'Evento cancelado.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cancelar o evento.');
    }
  }

  static async registrarUtilizacao(req, res) {
    try {
      const utilizacao = await EquipamentoModel.registrarUtilizacao(
        req.params.id, req.body, auditContext(req)
      );
      return sendData(res, utilizacao, 201, 'Utilização do equipamento registrada.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao registrar a utilização do equipamento.');
    }
  }

  static async findUtilizacoes(req, res) {
    try {
      return sendPage(res, await EquipamentoModel.findUtilizacoes(req.params.id, req.query));
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar as utilizações do equipamento.');
    }
  }

  static async archive(req, res) {
    try {
      const equipamento = await EquipamentoModel.archive(
        req.params.id, auditContext(req, req.body?.motivo)
      );
      return sendData(res, equipamento, 200, 'Equipamento arquivado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao arquivar o equipamento.');
    }
  }
}

module.exports = EquipamentoController;
