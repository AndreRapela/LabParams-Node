const { logSafeError } = require('../utils/safeError');

function auditContext(req, reason) {
  return {
    actorUserId: req.user?.id,
    requestId: req.requestId,
    reason,
  };
}

function sendData(res, data, status = 200, message) {
  const payload = { success: true, data };
  if (message) payload.message = message;
  return res.status(status).json(payload);
}

function sendPage(res, result) {
  return res.status(200).json({
    success: true,
    data: result.rows,
    meta: { total: result.total, page: result.page, pageSize: result.pageSize },
  });
}

function sendError(req, res, error, fallbackMessage) {
  let status = Number(error.statusCode) || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.statusCode ? error.message : fallbackMessage;
  if (error.code === '22P02') {
    status = 400;
    code = 'INVALID_IDENTIFIER';
    message = 'Identificador ou valor numérico inválido.';
  } else if (error.code === '23514' || error.code === '22007') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Os dados informados não atendem às regras de validação.';
  }
  if (status >= 500) {
    logSafeError('http_controller_failed', error, {
      request_id: req.requestId || null,
      operation: fallbackMessage,
    });
  }
  return res.status(status).json({
    success: false,
    error: code,
    message,
    request_id: req.requestId,
  });
}

module.exports = { auditContext, sendData, sendPage, sendError };
