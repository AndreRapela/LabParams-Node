const express = require('express');
const VerificacaoLaudoController = require('../controllers/VerificacaoLaudoController');

const router = express.Router();

router.get('/:hash', VerificacaoLaudoController.verify);

module.exports = router;
