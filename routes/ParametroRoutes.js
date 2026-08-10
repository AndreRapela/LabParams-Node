// routes/parametroRoutes.js
const express = require('express');
const router = express.Router();
const ParametroController = require('../controllers/ParametroController');
const roleFromTable = require('../middleware/RoleFromTable');

/**
 * @route GET /dashboardtv
 * @description Busca todos os parâmetros com status de conformidade para dashboard TV
 * @access Public
 */
router.get('/', roleFromTable('Gestor', 'Analista', 'Usuário'), ParametroController.findAll);
router.put('/:id', roleFromTable('Gestor'), ParametroController.update);

/**
 * @route GET /dashboardtv/resumo
 * @description Busca resumo dos status (contagem por categoria)
 * @access Public
 */

/**
 * @route GET /dashboardtv/status/:status
 * @description Busca parâmetros por status específico
 * @access Public
 */

module.exports = router;
