const express = require('express');
const router = express.Router();
const AlertasController = require('../controllers/AlertaController');

// Rota: GET /alertas
router.get('/', AlertasController.index);

module.exports = router;