const express = require('express');
const pool = require('../config/database');
const { getSupabaseAdminClient } = require('../config/supabaseAdmin');
const AuditLogModel = require('../models/AuditLogModel');
const roleFromTable = require('../middleware/RoleFromTable');

const router = express.Router();
const ALLOWED_ROLES = ['Gestor', 'Analista', 'Usuário'];

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
      select id, nome, email, telefone, perfil, created_at, updated_at
      from usuario
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
    const senha = String(req.body.senha ?? '');
    const perfil = String(req.body.perfil ?? 'Usuário');

    if (nome.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || senha.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres',
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
      app_metadata: { perfil },
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
      afterData: { id: data.user.id, email: data.user.email, nome, telefone, perfil },
    });

    return res.status(201).json({
      success: true,
      data: {
        id: data.user.id,
        email: data.user.email,
        nome,
        telefone,
        perfil,
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
      'select id, perfil from usuario where id = $1',
      [userId]
    );
    if (!localUsers.length) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }
    if (localUsers[0].perfil === 'Gestor' && perfil !== 'Gestor') {
      const { rows: counts } = await pool.query(
        "select count(*)::int as total from usuario where perfil = 'Gestor'"
      );
      if (counts[0].total <= 1) {
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

module.exports = router;
