const InventarioModel = require('../models/InventarioModel');
const { auditContext, sendData, sendPage, sendError } = require('./HttpControllerSupport');

class InventarioController {
  static async getResumo(req, res) {
    try {
      return sendData(res, await InventarioModel.getResumo());
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao calcular os indicadores do inventário.');
    }
  }

  static async findAll(req, res) {
    try {
      return sendPage(res, await InventarioModel.findAll(req.query));
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar o inventário.');
    }
  }

  static async findById(req, res) {
    try {
      const item = await InventarioModel.findById(req.params.id);
      if (!item) return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Insumo não encontrado.' });
      return sendData(res, item);
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar o insumo.');
    }
  }

  static async create(req, res) {
    try {
      const item = await InventarioModel.create(req.body, auditContext(req));
      return sendData(res, item, 201, 'Insumo cadastrado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cadastrar o insumo.');
    }
  }

  static async update(req, res) {
    try {
      const item = await InventarioModel.update(req.params.id, req.body, auditContext(req));
      return sendData(res, item, 200, 'Insumo atualizado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao atualizar o insumo.');
    }
  }

  static async definirAtivo(req, res) {
    try {
      const item = await InventarioModel.definirAtivo(req.params.id, req.body, auditContext(req));
      return sendData(res, item, 200, 'Status do insumo atualizado.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao alterar o status do insumo.');
    }
  }

  static async createLote(req, res) {
    try {
      const lote = await InventarioModel.createLote(req.params.id, req.body, auditContext(req));
      return sendData(res, lote, 201, 'Lote cadastrado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao cadastrar o lote.');
    }
  }

  static async updateLote(req, res) {
    try {
      const lote = await InventarioModel.updateLote(req.params.loteId, req.body, auditContext(req));
      return sendData(res, lote, 200, 'Lote atualizado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao atualizar o lote.');
    }
  }

  static async definirStatusLote(req, res) {
    try {
      const lote = await InventarioModel.definirStatusLote(
        req.params.loteId, req.body, auditContext(req)
      );
      return sendData(res, lote, 200, 'Status do lote atualizado.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao alterar o status do lote.');
    }
  }

  static async findMovimentacoes(req, res) {
    try {
      return sendPage(res, await InventarioModel.findMovimentacoes(req.params.loteId, req.query));
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao buscar as movimentações.');
    }
  }

  static async registrarMovimento(req, res) {
    try {
      const result = await InventarioModel.registrarMovimento(
        req.params.loteId, req.body, auditContext(req)
      );
      return sendData(res, result, 201, 'Movimentação registrada com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao registrar a movimentação.');
    }
  }

  static async registrarAjuste(req, res) {
    try {
      const result = await InventarioModel.registrarAjuste(
        req.params.loteId, req.body, auditContext(req)
      );
      return sendData(res, result, 201, 'Ajuste registrado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao registrar o ajuste.');
    }
  }

  static async archive(req, res) {
    try {
      const item = await InventarioModel.archive(
        req.params.id, auditContext(req, req.body?.motivo)
      );
      return sendData(res, item, 200, 'Insumo arquivado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao arquivar o insumo.');
    }
  }

  static async archiveLote(req, res) {
    try {
      const lote = await InventarioModel.archiveLote(
        req.params.loteId, auditContext(req, req.body?.motivo)
      );
      return sendData(res, lote, 200, 'Lote arquivado com sucesso.');
    } catch (error) {
      return sendError(req, res, error, 'Erro interno ao arquivar o lote.');
    }
  }
}

module.exports = InventarioController;
