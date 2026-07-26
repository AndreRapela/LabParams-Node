// routes/parametroRoutes.js
const express = require('express');
const router = express.Router();
const ParametroController = require('../controllers/ParametroController');

/**
 * @route GET /dashboardtv
 * @description Busca todos os parâmetros com status de conformidade para dashboard TV
 * @access Public
 */
router.get('/', ParametroController.findAll);
router.put('/:id', ParametroController.update);

/**
 * @route GET /dashboardtv/resumo
 * @description Busca resumo dos status (contagem por categoria)
 * @access Public
 */
// router.get('/resumo', ParametroController.findResumo);

/**
 * @route GET /dashboardtv/status/:status
 * @description Busca parâmetros por status específico
 * @access Public
 */
// router.get('/status/:status', ParametroController.findByStatus);

module.exports = router;