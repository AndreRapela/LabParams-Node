const pool = require('../config/database');

const roleCache = new Map();
const CACHE_TTL_MS = 60_000;

module.exports = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
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
          return res.status(403).json({ error: 'Usuário não cadastrado' });
        }

        role = rows[0].perfil;
        roleCache.set(userId, { role, expiresAt: Date.now() + CACHE_TTL_MS });
      }

      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};
