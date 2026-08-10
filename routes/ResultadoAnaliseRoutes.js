// routes/resultadoAnaliseRoutes.js
const express = require('express');
const router = express.Router();
const ResultadoAnaliseController = require('../controllers/ResultadoAnaliseController');
const roleFromTable = require('../middleware/RoleFromTable');
const { sharedSignatureRateLimiter } = require('../middleware/UserRouteRateLimit');

const leitura = roleFromTable('Gestor', 'Analista', 'Usuário');
const operacao = roleFromTable('Gestor', 'Analista');
const gestao = roleFromTable('Gestor');

/**
 * @route GET /resultados-analise
 * @description Busca todos os resultados de análise
 */
router.get('/', leitura, ResultadoAnaliseController.findAll);

/**
 * @route GET /resultados-analise/amostras
 * @description Busca amostras para dropdown
 */
router.get('/amostras', leitura, ResultadoAnaliseController.findAmostras);

/**
 * @route GET /resultados-analise/parametros
 * @description Busca parâmetros para dropdown
 */
router.get('/parametros', leitura, ResultadoAnaliseController.findParametros);

/**
 * @route GET /resultados-analise/matrizes
 * @description Busca matrizes para dropdown
 */
router.get('/matrizes', leitura, ResultadoAnaliseController.findMatrizes);

/**
 * @route GET /resultados-analise/legislacoes
 * @description Busca legislações para dropdown
 */
router.get('/legislacoes', leitura, ResultadoAnaliseController.findLegislacoes);

/**
 * @route GET /resultados-analise/contextos
 * @description Busca classes e contextos aplicáveis à legislação/matriz
 */
router.get('/contextos', leitura, ResultadoAnaliseController.findContextos);

/**
 * @route POST /resultados-analise
 * @description Cria um novo resultado de análise
 */
router.post('/', operacao, ResultadoAnaliseController.create);

router.post('/:id/submeter', operacao, ResultadoAnaliseController.submit);
router.post('/:id/revisar', gestao, sharedSignatureRateLimiter, ResultadoAnaliseController.review);
router.post('/:id/aprovar', gestao, sharedSignatureRateLimiter, ResultadoAnaliseController.approve);
router.post('/:id/rejeitar', gestao, sharedSignatureRateLimiter, ResultadoAnaliseController.reject);
router.post('/:id/publicar', gestao, sharedSignatureRateLimiter, ResultadoAnaliseController.publish);
router.post('/:id/reabrir', gestao, sharedSignatureRateLimiter, ResultadoAnaliseController.reopen);
router.get('/:id/historico-workflow', leitura, ResultadoAnaliseController.workflowHistory);

/**
 * @route GET /resultados-analise/:id
 * @description Busca um resultado por ID
 */
router.get('/:id', leitura, ResultadoAnaliseController.findById);

/**
 * @route PUT /resultados-analise/:id
 * @description Atualiza um resultado de análise
 */
router.put('/:id', operacao, ResultadoAnaliseController.update);

/**
 * @route DELETE /resultados-analise/:id
 * @description Exclui um resultado de análise
 */
router.delete('/:id', gestao, ResultadoAnaliseController.delete);

module.exports = router;
