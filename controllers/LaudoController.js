const QRCode = require('qrcode');
const LaudoModel = require('../models/LaudoModel');
const SignatureService = require('../services/SignatureService');
const { renderLaudoHtml } = require('../utils/laudoHtml');

function auditContext(req) {
  return {
    actorUserId: req.user?.id,
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

function sendError(req, res, error) {
  const status = Number(error.statusCode) || 500;
  if (['REAUTENTICACAO_FALHOU', 'REAUTENTICACAO_OBRIGATORIA'].includes(error.code)) {
    res.locals.signatureVerificationFailed = true;
  }
  if (status >= 500) console.error('Erro em laudos:', error);
  return res.status(status).json({
    success: false,
    message: status < 500 ? error.message : 'Erro interno ao processar laudo',
    code: error.code,
    request_id: req.requestId,
  });
}

function sendList(res, result) {
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
}

class LaudoController {
  static async findAll(req, res) {
    try {
      return sendList(res, await LaudoModel.findAll(req.query));
    } catch (error) {
      return sendError(req, res, error);
    }
  }

  static async generate(req, res) {
    try {
      const signatureContext = await SignatureService.verifyPassword({
        email: req.user?.email,
        userId: req.user?.id,
        password: req.body?.senha,
      });
      const data = await LaudoModel.generate(
        req.params.amostraId,
        req.body,
        { ...auditContext(req), signatureContext }
      );
      return res.status(201).json({
        success: true,
        message: 'Nova versão do laudo emitida e assinada.',
        data,
      });
    } catch (error) {
      return sendError(req, res, error);
    }
  }

  static async findBySample(req, res) {
    try {
      const data = await LaudoModel.findBySample(req.params.amostraId);
      return res.json({ success: true, data, count: data.length });
    } catch (error) {
      return sendError(req, res, error);
    }
  }

  static async findById(req, res) {
    try {
      const data = await LaudoModel.findById(req.params.id);
      return data
        ? res.json({ success: true, data })
        : res.status(404).json({
            success: false,
            message: 'Laudo não encontrado',
            request_id: req.requestId,
          });
    } catch (error) {
      return sendError(req, res, error);
    }
  }

  static async html(req, res) {
    try {
      const data = await LaudoModel.findById(req.params.id);
      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Laudo não encontrado',
          request_id: req.requestId,
        });
      }
      if (!data.integridade_valida) {
        return res.status(409).json({
          success: false,
          message: 'A integridade ou a assinatura do laudo não pôde ser confirmada.',
          code: 'INTEGRIDADE_LAUDO_INVALIDA',
          request_id: req.requestId,
        });
      }

      const publicAppUrl = String(process.env.PUBLIC_APP_URL || 'http://localhost:4200')
        .replace(/\/$/, '');
      const verificationUrl = `${publicAppUrl}/verificar-laudo/${data.conteudo_hash}`;
      const verificationQr = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 144,
      });

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set(
        'Content-Disposition',
        `inline; filename="${String(data.numero).replace(/[^a-zA-Z0-9_-]/g, '_')}.html"`
      );
      res.set('Cache-Control', 'private, no-store');
      res.set(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
      );
      return res.send(renderLaudoHtml(data, verificationQr));
    } catch (error) {
      return sendError(req, res, error);
    }
  }
}

module.exports = LaudoController;
