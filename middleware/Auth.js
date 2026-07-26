const jwt = require('jsonwebtoken');

function respondAfterRequestBody(req, res, status, payload) {
  const send = () => {
    if (!res.headersSent) res.status(status).json(payload);
  };

  if (!req.readable || req.readableEnded || ['GET', 'HEAD'].includes(req.method)) {
    return send();
  }

  req.once('end', send);
  req.once('error', send);
  req.resume();
}

module.exports = function authMiddleware(req, res, next) {
  const authorization = req.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return respondAfterRequestBody(req, res, 401, {
      error: 'Token ausente ou mal formatado',
    });
  }

  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    return respondAfterRequestBody(req, res, 500, {
      error: 'Autenticação não configurada',
    });
  }

  try {
    const decoded = jwt.verify(authorization.slice(7).trim(), jwtSecret, {
      algorithms: ['HS256'],
    });

    if (!decoded.sub) {
      return respondAfterRequestBody(req, res, 401, { error: 'Token inválido' });
    }

    req.user = {
      ...decoded,
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };
    return next();
  } catch (error) {
    const message =
      error.name === 'TokenExpiredError'
        ? 'Sessão expirada. Faça login novamente.'
        : 'Token inválido';
    return respondAfterRequestBody(req, res, 401, { error: message });
  }
};
