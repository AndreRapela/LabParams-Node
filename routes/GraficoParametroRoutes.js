// routes/graficoParametroRoutes.js
const express = require('express');
const router = express.Router();
const GraficoParametrosController = require('../controllers/GraficoParametroController');

// GET http://localhost:3000/grafico-parametros
router.get('/', GraficoParametrosController.index);

module.exports = router;