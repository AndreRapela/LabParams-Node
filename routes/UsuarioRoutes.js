const express = require("express");
const router = express.Router();
const supabaseAdmin = require("../config/supabaseAdmin");

// PUT /usuarios/:userId/perfil
router.put("/:userId/perfil", async (req, res) => {
  try {
    const { userId } = req.params;
    const { perfil } = req.body;
    const allowedRoles = ['Gestor', 'Analista', 'Usuário'];

    if (!allowedRoles.includes(perfil)) {
      return res.status(400).json({ error: "Perfil inválido" });
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      {
      user_metadata: { perfil }
      }
    );

    if (error) {
      return res.status(400).json({ error: 'Não foi possível atualizar o perfil' });
    }

    return res.json({ success: true, user: data.user });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao atualizar o perfil' });
  }
});

module.exports = router;
