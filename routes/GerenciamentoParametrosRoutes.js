const express = require('express');
const router = express.Router();

const controller = require('../controllers/GerenciamentoParametrosController');

// leitura completa da tela
router.get('/', controller.listarTudo);

// update controlado
router.put('/:id', controller.atualizarParametro);

module.exports = router;
