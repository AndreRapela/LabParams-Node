const pool = require('../config/database');

const roleCache = new Map();
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;

function accessError(req, res, status, error) {
  return res.status(status).json({
    success: false,
    error,
    request_id: req.requestId,
  });
}

function cacheRole(userId, role) {
  if (roleCache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of roleCache) {
      if (entry.expiresAt <= now) roleCache.delete(key);
    }
    if (roleCache.size >= MAX_CACHE_ENTRIES) {
      roleCache.delete(roleCache.keys().next().value);
    }
  }
  roleCache.set(userId, { role, expiresAt: Date.now() + CACHE_TTL_MS });
}

const roleFromTable = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return accessError(req, res, 401, 'Usuário não autenticado');
      }

      const cached = roleCache.get(userId);
      let role;

      if (cached?.expiresAt > Date.now()) {
        role = cached.role;
      } else {
        const { rows } = await pool.query(
          'SELECT perfil FROM usuario WHERE id = $1',
          [userId]
        );

        if (!rows.length) {
          return accessError(req, res, 403, 'Usuário não cadastrado');
        }

        role = rows[0].perfil;
        cacheRole(userId, role);
      }

      if (!allowedRoles.includes(role)) {
        return accessError(req, res, 403, 'Acesso negado');
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

roleFromTable.invalidate = (userId) => {
  if (userId) roleCache.delete(userId);
};

module.exports = roleFromTable;
