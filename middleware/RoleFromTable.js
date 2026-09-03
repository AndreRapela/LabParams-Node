const pool = require('../config/database');
const REQUEST_ACCESS = Symbol('sysmlabVerifiedUserAccess');

function accessError(req, res, status, error, code) {
  return res.status(status).json({
    success: false,
    error,
    ...(code ? { code } : {}),
    request_id: req.requestId,
  });
}

const roleFromTable = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return accessError(req, res, 401, 'Usuário não autenticado', 'NAO_AUTENTICADO');
      }

      let access = req[REQUEST_ACCESS];
      if (!access) {
        // `to_jsonb` mantém o deploy seguro durante a janela migration-first: o
        // processo inicia com o schema anterior, mas produção falha fechada até
        // a coluna existir. O snapshot vive apenas nesta requisição; não mantém
        // privilégios obsoletos entre chamadas ou instâncias serverless.
        const { rows } = await pool.query(`
          select u.perfil,
            case
              when to_jsonb(u) ? 'acesso_aprovado'
                then coalesce((to_jsonb(u)->>'acesso_aprovado')::boolean, false)
              else null
            end as acesso_aprovado
          from usuario u
          where u.id = $1
        `, [userId]);

        if (!rows.length) {
          return accessError(req, res, 403, 'Usuário não cadastrado', 'USUARIO_NAO_CADASTRADO');
        }

        const approval = rows[0].acesso_aprovado;
        if (approval === null || approval === undefined) {
          if (process.env.NODE_ENV === 'production') {
            return accessError(
              req,
              res,
              503,
              'Atualização de segurança do banco pendente',
              'MIGRACAO_ACESSO_PENDENTE'
            );
          }
        } else if (approval !== true) {
          return accessError(
            req,
            res,
            403,
            'Acesso pendente de aprovação por um Gestor',
            'ACESSO_PENDENTE'
          );
        }

        access = Object.freeze({ perfil: rows[0].perfil, acessoAprovado: true });
        req[REQUEST_ACCESS] = access;
      }

      if (!allowedRoles.includes(access.perfil)) {
        return accessError(req, res, 403, 'Acesso negado', 'PERFIL_NAO_AUTORIZADO');
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

// Mantido para compatibilidade com rotas existentes. Como a autorização não é
// mais cacheada, a próxima requisição sempre observa o estado confirmado no DB.
roleFromTable.invalidate = () => {};

module.exports = roleFromTable;
