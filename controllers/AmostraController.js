const AmostraModel = require('../models/AmostraModel');

function sendError(res, error, fallback) {
  const status = Number(error.statusCode) || 500;
  if (status >= 500) console.error(fallback, error);
  return res.status(status).json({
    success: false,
    message: status < 500 ? error.message : fallback,
    code: error.code,
  });
}

function auditContext(req) {
  return {
    actorUserId: req.user?.id,
    requestId: req.requestId,
  };
}

class AmostraController {
  static async findAll(req, res) {
    try {
      const result = await AmostraModel.findAll(req.query);
      if (Array.isArray(result)) {
        return res.json({ success: true, data: result, count: result.length });
      }
      return res.json({
        success: true,
        data: result.rows,
        count: result.rows.length,
        pagination: {
          page: result.page,
          page_size: result.pageSize,
          total: result.total,
          total_pages: Math.ceil(result.total / result.pageSize),
        },
      });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao buscar lista de amostras');
    }
  }

  static async findById(req, res) {
    try {
      const amostra = await AmostraModel.findById(req.params.id);
      if (!amostra) return res.status(404).json({ success: false, message: 'Amostra não encontrada' });
      return res.json({ success: true, data: amostra });
    } catch (error) {
      return sendError(res, error, 'Erro ao buscar detalhes da amostra');
    }
  }

  static async create(req, res) {
    try {
      const novaAmostra = await AmostraModel.create({
        codigo_amostra: req.body.codigo_amostra,
        numero_da_amostra: req.body.numero_da_amostra,
        data_coleta: req.body.data_coleta,
        localizacao: req.body.localizacao,
        matriz_id: req.body.matriz_id,
        usuario_id: req.body.usuario_id,
        pedido_analise_id: req.body.pedido_analise_id,
        parametros_ids: req.body.parametros_ids,
      }, {
        ...auditContext(req),
        observation: req.body.observacao_recebimento,
      });
      return res.status(201).json({
        success: true,
        message: 'Amostra cadastrada e recebida com sucesso.',
        data: novaAmostra,
      });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao salvar amostra');
    }
  }

  static async update(req, res) {
    try {
      const atualizada = await AmostraModel.update(req.params.id, {
        codigo_amostra: req.body.codigo_amostra,
        numero_da_amostra: req.body.numero_da_amostra,
        data_coleta: req.body.data_coleta,
        localizacao: req.body.localizacao,
        matriz_id: req.body.matriz_id,
        usuario_id: req.body.usuario_id,
        pedido_analise_id: req.body.pedido_analise_id,
        parametros_ids: req.body.parametros_ids,
      }, auditContext(req));
      return res.json({ success: true, message: 'Amostra atualizada com sucesso.', data: atualizada });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao atualizar amostra');
    }
  }

  static async delete(req, res) {
    try {
      const archived = await AmostraModel.delete(req.params.id, {
        ...auditContext(req),
        reason: req.body?.motivo,
      });
      if (!archived) return res.status(404).json({ success: false, message: 'Amostra não encontrada' });
      return res.json({ success: true, message: 'Amostra arquivada com sucesso.' });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao arquivar amostra');
    }
  }

  static async transitionStatus(req, res) {
    try {
      const result = await AmostraModel.transitionStatus(
        req.params.id,
        req.body.status,
        {
          motivo: req.body.motivo,
          observacao: req.body.observacao,
          local_destino: req.body.local_destino,
        },
        auditContext(req)
      );
      return res.json({ success: true, message: 'Status da amostra atualizado.', data: result });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao alterar status da amostra');
    }
  }

  static async addCustodyEvent(req, res) {
    try {
      const result = await AmostraModel.addCustodyEvent(req.params.id, req.body, auditContext(req));
      return res.status(201).json({
        success: true,
        message: 'Evento registrado na cadeia de custódia.',
        data: result,
      });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao registrar cadeia de custódia');
    }
  }

  static async findCustodyEvents(req, res) {
    try {
      const result = await AmostraModel.findCustodyEvents(req.params.id, req.query);
      return res.json({
        success: true,
        data: result.rows,
        count: result.rows.length,
        pagination: {
          page: result.page,
          page_size: result.pageSize,
          total: result.total,
          total_pages: Math.ceil(result.total / result.pageSize),
        },
      });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao consultar cadeia de custódia');
    }
  }

  static async getMatrizes(_req, res) {
    try {
      const data = await AmostraModel.findMatrizesDropdown();
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao buscar matrizes');
    }
  }

  static async getUsuarios(_req, res) {
    try {
      const data = await AmostraModel.findUsuariosDropdown();
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao buscar usuários');
    }
  }
}

module.exports = AmostraController;
