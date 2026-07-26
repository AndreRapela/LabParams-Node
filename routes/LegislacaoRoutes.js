const express = require('express');
const router = express.Router();
const LegislacaoController = require('../controllers/LegislacaoController');

// GET /legislacoes
router.get('/', LegislacaoController.findAll);

module.exports = router;
