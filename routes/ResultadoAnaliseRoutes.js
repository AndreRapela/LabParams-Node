// routes/resultadoAnaliseRoutes.js
const express = require('express');
const router = express.Router();
const ResultadoAnaliseController = require('../controllers/ResultadoAnaliseController');

/**
 * @route GET /resultados-analise
 * @description Busca todos os resultados de análise
 */
router.get('/', ResultadoAnaliseController.findAll);

/**
 * @route GET /resultados-analise/amostras
 * @description Busca amostras para dropdown
 */
router.get('/amostras', ResultadoAnaliseController.findAmostras);

/**
 * @route GET /resultados-analise/parametros
 * @description Busca parâmetros para dropdown
 */
router.get('/parametros', ResultadoAnaliseController.findParametros);

/**
 * @route GET /resultados-analise/matrizes
 * @description Busca matrizes para dropdown
 */
router.get('/matrizes', ResultadoAnaliseController.findMatrizes);

/**
 * @route GET /resultados-analise/legislacoes
 * @description Busca legislações para dropdown
 */
router.get('/legislacoes', ResultadoAnaliseController.findLegislacoes);

/**
 * @route POST /resultados-analise
 * @description Cria um novo resultado de análise
 */
router.post('/', ResultadoAnaliseController.create);

/**
 * @route GET /resultados-analise/:id
 * @description Busca um resultado por ID
 */
router.get('/:id', ResultadoAnaliseController.findById);

/**
 * @route PUT /resultados-analise/:id
 * @description Atualiza um resultado de análise
 */
router.put('/:id', ResultadoAnaliseController.update);

/**
 * @route DELETE /resultados-analise/:id
 * @description Exclui um resultado de análise
 */
router.delete('/:id', ResultadoAnaliseController.delete);

module.exports = router;