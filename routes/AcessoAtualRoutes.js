const express = require('express');
const pool = require('../config/database');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      select u.id, u.perfil,
        exists (
          select 1
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = 'public.usuario'::regclass
            and attribute.attname = 'acesso_aprovado'
            and attribute.attnum > 0
            and not attribute.attisdropped
        ) as schema_aprovacao_disponivel,
        case
          when to_jsonb(u) ? 'acesso_aprovado'
            then coalesce((to_jsonb(u)->>'acesso_aprovado')::boolean, false)
          else null
        end as acesso_aprovado
      from (values (1)) as request_scope(singleton)
      left join usuario u on u.id = $1
    `, [req.user.id]);

    if (!rows[0]?.id) {
      const schemaReady = rows[0]?.schema_aprovacao_disponivel === true;
      return res.status(404).json({
        success: false,
        code: 'USUARIO_NAO_CADASTRADO',
        message: 'A conta autenticada não possui cadastro no sistema.',
        data: {
          cadastrado: false,
          perfil: null,
          acesso_aprovado: false,
          schema_ready: schemaReady,
          status_acesso: 'nao-cadastrado',
        },
        request_id: req.requestId,
      });
    }

    const user = rows[0];
    const schemaReady = user.schema_aprovacao_disponivel === true;
    const approved = schemaReady ? user.acesso_aprovado === true : null;
    return res.json({
      success: true,
      data: {
        cadastrado: true,
        perfil: user.perfil,
        acesso_aprovado: approved,
        schema_ready: schemaReady,
        status_acesso: !schemaReady
          ? 'migracao-pendente'
          : (approved ? 'aprovado' : 'pendente'),
      },
      request_id: req.requestId,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
