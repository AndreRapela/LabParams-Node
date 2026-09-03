const express = require('express');
const pool = require('../config/database');
const { getSupabaseAdminClient } = require('../config/supabaseAdmin');
const AuditLogModel = require('../models/AuditLogModel');
const roleFromTable = require('../middleware/RoleFromTable');
const { validateNewUserPassword } = require('../utils/passwordPolicy');

const router = express.Router();
const ALLOWED_ROLES = ['Gestor', 'Analista', 'Usuário'];
const ACCESS_APPROVAL_CLAIM = 'sysmlab_access_approved';
const ACCESS_APPROVED_BY_CLAIM = 'sysmlab_access_approved_by';

const APPROVAL_SQL = `case
  when to_jsonb(u) ? 'acesso_aprovado'
    then coalesce((to_jsonb(u)->>'acesso_aprovado')::boolean, false)
  else true
end`;

async function countApprovedManagers() {
  const { rows } = await pool.query(`
    select count(*)::int as total
    from usuario u
    where u.perfil = 'Gestor' and ${APPROVAL_SQL}
  `);
  return Number(rows[0]?.total ?? 0);
}

function approvalMetadata(current, approved, actorUserId) {
  const metadata = {
    ...(current || {}),
    [ACCESS_APPROVAL_CLAIM]: approved,
  };
  if (approved && actorUserId) metadata[ACCESS_APPROVED_BY_CLAIM] = actorUserId;
  else delete metadata[ACCESS_APPROVED_BY_CLAIM];
  return metadata;
}

function adminClientOr503(res) {
  const client = getSupabaseAdminClient();
  if (!client) {
    res.status(503).json({
      success: false,
      error: 'Administração de usuários ainda não configurada',
    });
    return null;
  }
  return client;
}

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      select u.id, u.nome, u.email, u.telefone, u.perfil,
        ${APPROVAL_SQL} as acesso_aprovado,
        to_jsonb(u)->>'acesso_aprovado_em' as acesso_aprovado_em,
        to_jsonb(u)->>'acesso_aprovado_por' as acesso_aprovado_por,
        u.created_at, u.updated_at
      from usuario u
      order by nome, email
    `);
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const nome = String(req.body.nome ?? '').trim();
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const telefone = String(req.body.telefone ?? '').trim();
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const perfil = String(req.body.perfil ?? 'Usuário');

    if (nome.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Informe nome e e-mail válido.',
        code: 'DADOS_USUARIO_INVALIDOS',
      });
    }
    const passwordValidation = validateNewUserPassword(senha);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        error: passwordValidation.message,
        code: 'SENHA_FRACA',
      });
    }
    if (!ALLOWED_ROLES.includes(perfil)) {
      return res.status(400).json({ success: false, error: 'Perfil inválido' });
    }

    const supabaseAdmin = adminClientOr503(res);
    if (!supabaseAdmin) return undefined;

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome, telefone },
      app_metadata: approvalMetadata({ perfil }, true, req.user?.id),
    });

    if (error) {
      const duplicate = /already|registered|exists/i.test(error.message);
      return res.status(duplicate ? 409 : 400).json({
        success: false,
        error: duplicate ? 'Já existe um usuário com este e-mail' : 'Não foi possível criar o usuário',
      });
    }

    await AuditLogModel.record(pool, {
      actorUserId: req.user?.id,
      requestId: req.requestId,
      action: 'CREATE',
      entityType: 'usuario',
      entityId: data.user.id,
      afterData: {
        id: data.user.id,
        email: data.user.email,
        nome,
        telefone,
        perfil,
        acesso_aprovado: true,
      },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: data.user.id,
        email: data.user.email,
        nome,
        telefone,
        perfil,
        acesso_aprovado: true,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/:userId/perfil', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { perfil } = req.body;

    if (!ALLOWED_ROLES.includes(perfil)) {
      return res.status(400).json({ success: false, error: 'Perfil inválido' });
    }

    if (userId === req.user?.id && perfil !== 'Gestor') {
      return res.status(409).json({
        success: false,
        error: 'Por segurança, você não pode remover o próprio perfil de Gestor',
      });
    }

    const { rows: localUsers } = await pool.query(
      `select u.id, u.perfil, ${APPROVAL_SQL} as acesso_aprovado
       from usuario u where u.id = $1`,
      [userId]
    );
    if (!localUsers.length) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    if (localUsers[0].perfil === 'Gestor' && perfil !== 'Gestor') {
      const approvedManagers = await countApprovedManagers();
      if (localUsers[0].acesso_aprovado && approvedManagers <= 1) {
        return res.status(409).json({
          success: false,
          error: 'O sistema precisa manter pelo menos um Gestor',
        });
      }
    }

    const supabaseAdmin = adminClientOr503(res);
    if (!supabaseAdmin) return undefined;

    const { data: currentData, error: findError } =
      await supabaseAdmin.auth.admin.getUserById(userId);

    if (findError || !currentData.user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { ...currentData.user.app_metadata, perfil },
    });

    if (error) {
      if (localUsers[0].perfil === 'Gestor' && perfil !== 'Gestor'
          && await countApprovedManagers() <= 1) {
        return res.status(409).json({
          success: false,
          error: 'O sistema precisa manter pelo menos um Gestor aprovado',
          code: 'ULTIMO_GESTOR',
        });
      }
      return res.status(400).json({ success: false, error: 'Não foi possível atualizar o perfil' });
    }

    roleFromTable.invalidate(userId);

    await AuditLogModel.record(pool, {
      actorUserId: req.user?.id,
      requestId: req.requestId,
      action: 'ROLE_CHANGE',
      entityType: 'usuario',
      entityId: data.user.id,
      beforeData: { perfil: currentData.user.app_metadata?.perfil },
      afterData: { perfil },
    });

    return res.json({
      success: true,
      data: { id: data.user.id, email: data.user.email, perfil },
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/:userId/aprovacao', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const approved = req.body?.acesso_aprovado;
    if (typeof approved !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'acesso_aprovado deve ser booleano',
        code: 'APROVACAO_INVALIDA',
      });
    }
    if (userId === req.user?.id && !approved) {
      return res.status(409).json({
        success: false,
        error: 'Por segurança, você não pode bloquear o próprio acesso',
        code: 'AUTO_BLOQUEIO_NEGADO',
      });
    }

    const { rows: localUsers } = await pool.query(`
      select u.id, u.perfil, ${APPROVAL_SQL} as acesso_aprovado
      from usuario u
      where u.id = $1
    `, [userId]);
    if (!localUsers.length) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    const previous = localUsers[0];
    if (previous.perfil === 'Gestor' && previous.acesso_aprovado && !approved
        && await countApprovedManagers() <= 1) {
      return res.status(409).json({
        success: false,
        error: 'O sistema precisa manter pelo menos um Gestor aprovado',
        code: 'ULTIMO_GESTOR',
      });
    }

    const supabaseAdmin = adminClientOr503(res);
    if (!supabaseAdmin) return undefined;
    const { data: currentData, error: findError } =
      await supabaseAdmin.auth.admin.getUserById(userId);
    if (findError || !currentData.user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const appMetadata = approvalMetadata(
      currentData.user.app_metadata,
      approved,
      req.user?.id
    );
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: appMetadata,
    });
    if (error) {
      if (previous.perfil === 'Gestor' && previous.acesso_aprovado && !approved
          && await countApprovedManagers() <= 1) {
        return res.status(409).json({
          success: false,
          error: 'O sistema precisa manter pelo menos um Gestor aprovado',
          code: 'ULTIMO_GESTOR',
        });
      }
      return res.status(400).json({
        success: false,
        error: 'Não foi possível atualizar a aprovação de acesso',
      });
    }

    roleFromTable.invalidate(userId);
    await AuditLogModel.record(pool, {
      actorUserId: req.user?.id,
      requestId: req.requestId,
      action: 'ROLE_CHANGE',
      entityType: 'usuario',
      entityId: data.user.id,
      beforeData: { acesso_aprovado: previous.acesso_aprovado },
      afterData: { acesso_aprovado: approved },
    });

    return res.json({
      success: true,
      data: {
        id: data.user.id,
        email: data.user.email,
        perfil: data.user.app_metadata?.perfil || previous.perfil,
        acesso_aprovado: approved,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
