const ResultadoAnaliseModel = require('../models/ResultadoAnaliseModel');
const SignatureService = require('../services/SignatureService');
const { logSafeError } = require('../utils/safeError');

function sendError(res, error, fallback) {
  const status = Number(error.statusCode) || 500;
  if (['REAUTENTICACAO_FALHOU', 'REAUTENTICACAO_OBRIGATORIA'].includes(error.code)) {
    res.locals.signatureVerificationFailed = true;
  }
  if (status >= 500) {
    logSafeError('result_controller_failed', error, {
      request_id: res.getHeader('X-Request-Id') || null,
      operation: fallback,
    });
  }
  return res.status(status).json({
    success: false,
    message: status < 500 ? error.message : fallback,
    code: error.code,
    request_id: res.getHeader('X-Request-Id'),
  });
}

function auditContext(req) {
  return {
    actorUserId: req.user?.id,
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

function resultPayload(body) {
  return {
    valor_medido: body.valor_medido,
    valor_qualitativo: body.valor_qualitativo,
    amostra_id: body.amostra_id,
    parametro_id: body.parametro_id,
    metodo_analitico_id: body.metodo_analitico_id,
    datacoleta: body.datacoleta,
    matriz_id_selecionada: body.matriz_id_selecionada,
    legislacao_id_selecionada: body.legislacao_id_selecionada,
    contexto_legislacao_id: body.contexto_legislacao_id,
  };
}

class ResultadoAnaliseController {
  static async findAll(req, res) {
    try {
      const result = await ResultadoAnaliseModel.findAll(req.query);
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
      return sendError(res, error, 'Erro interno ao buscar resultados');
    }
  }

  static async create(req, res) {
    try {
      const data = await ResultadoAnaliseModel.create(resultPayload(req.body), auditContext(req));
      return res.status(201).json({
        success: true,
        message: 'Resultado criado como rascunho.',
        data,
      });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao criar resultado');
    }
  }

  static async update(req, res) {
    try {
      const data = await ResultadoAnaliseModel.update(
        req.params.id,
        resultPayload(req.body),
        auditContext(req)
      );
      return res.json({ success: true, message: 'Resultado atualizado.', data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao atualizar resultado');
    }
  }

  static async delete(req, res) {
    try {
      const archived = await ResultadoAnaliseModel.delete(req.params.id, {
        ...auditContext(req),
        reason: req.body?.motivo,
      });
      if (!archived) {
        return res.status(404).json({ success: false, message: 'Resultado não encontrado' });
      }
      return res.json({ success: true, message: 'Resultado arquivado com sucesso.' });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao arquivar resultado');
    }
  }

  static async submit(req, res) {
    try {
      const data = await ResultadoAnaliseModel.submit(
        req.params.id,
        req.body?.comentario,
        auditContext(req)
      );
      return res.json({ success: true, message: 'Resultado enviado para revisão.', data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao submeter resultado');
    }
  }

  static async review(req, res) {
    try {
      const decision = String(req.body?.decisao ?? '').trim().toLowerCase();
      const signature = await SignatureService.verifyPassword({
        email: req.user?.email,
        userId: req.user?.id,
        password: req.body?.senha,
      });
      const data = await ResultadoAnaliseModel.review(
        req.params.id,
        decision,
        req.body?.comentario,
        signature,
        auditContext(req)
      );
      return res.json({
        success: true,
        message: decision === 'aprovar' ? 'Resultado aprovado.' : 'Resultado rejeitado.',
        data,
      });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao revisar resultado');
    }
  }

  static async approve(req, res) {
    req.body = { ...(req.body || {}), decisao: 'aprovar' };
    return ResultadoAnaliseController.review(req, res);
  }

  static async reject(req, res) {
    req.body = { ...(req.body || {}), decisao: 'rejeitar' };
    return ResultadoAnaliseController.review(req, res);
  }

  static async publish(req, res) {
    try {
      const signature = await SignatureService.verifyPassword({
        email: req.user?.email,
        userId: req.user?.id,
        password: req.body?.senha,
      });
      const data = await ResultadoAnaliseModel.publish(
        req.params.id,
        req.body?.comentario,
        signature,
        auditContext(req)
      );
      return res.json({ success: true, message: 'Resultado publicado e bloqueado.', data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao publicar resultado');
    }
  }

  static async reopen(req, res) {
    try {
      const signature = await SignatureService.verifyPassword({
        email: req.user?.email,
        userId: req.user?.id,
        password: req.body?.senha,
      });
      const data = await ResultadoAnaliseModel.reopen(
        req.params.id,
        req.body?.comentario,
        signature,
        auditContext(req)
      );
      return res.json({ success: true, message: 'Resultado aprovado reaberto como rascunho.', data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao reabrir resultado');
    }
  }

  static async workflowHistory(req, res) {
    try {
      const result = await ResultadoAnaliseModel.findWorkflowHistory(req.params.id, req.query);
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
      return sendError(res, error, 'Erro interno ao consultar histórico do resultado');
    }
  }

  static async findAmostras(_req, res) {
    try {
      const data = await ResultadoAnaliseModel.findAmostras();
      return res.json({ success: true, data, count: data.length });
    } catch (error) {
      return sendError(res, error, 'Erro ao buscar amostras');
    }
  }

  static async findParametros(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findParametros({
        contextoId: req.query.contexto_id,
        legislacaoId: req.query.legislacao_id,
        matrizId: req.query.matriz_id,
      });
      return res.json({ success: true, data, count: data.length });
    } catch (error) {
      return sendError(res, error, 'Erro ao buscar parâmetros');
    }
  }

  static async findMatrizes(_req, res) {
    try {
      const data = await ResultadoAnaliseModel.findMatrizes();
      return res.json({ success: true, data, count: data.length });
    } catch (error) {
      return sendError(res, error, 'Erro ao buscar matrizes');
    }
  }

  static async findLegislacoes(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findLegislacoes(req.query.matriz_id);
      return res.json({ success: true, data, count: data.length });
    } catch (error) {
      return sendError(res, error, 'Erro ao buscar legislações');
    }
  }

  static async findContextos(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findContextos({
        legislacaoId: req.query.legislacao_id,
        matrizId: req.query.matriz_id,
      });
      return res.json({ success: true, data, count: data.length });
    } catch (error) {
      return sendError(res, error, 'Erro ao buscar classes e contextos da legislação');
    }
  }

  static async findById(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findById(req.params.id);
      if (!data) return res.status(404).json({ success: false, message: 'Resultado não encontrado' });
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, 'Erro interno ao buscar resultado');
    }
  }
}

module.exports = ResultadoAnaliseController;
