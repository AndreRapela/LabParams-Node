const express = require('express');
const InventarioController = require('../controllers/InventarioController');
const roleFromTable = require('../middleware/RoleFromTable');

const router = express.Router();
const leitura = roleFromTable('Gestor', 'Analista', 'Usuário');
const operacao = roleFromTable('Gestor', 'Analista');
const gestao = roleFromTable('Gestor');

router.get('/resumo', leitura, InventarioController.getResumo);
router.get('/', leitura, InventarioController.findAll);
router.post('/', operacao, InventarioController.create);

router.get('/lotes/:loteId/movimentacoes', leitura, InventarioController.findMovimentacoes);
router.post('/lotes/:loteId/movimentacoes', operacao, InventarioController.registrarMovimento);
router.post('/lotes/:loteId/ajustes', gestao, InventarioController.registrarAjuste);
router.post('/lotes/:loteId/status', gestao, InventarioController.definirStatusLote);
router.put('/lotes/:loteId', operacao, InventarioController.updateLote);
router.delete('/lotes/:loteId', gestao, InventarioController.archiveLote);

router.post('/:id/lotes', operacao, InventarioController.createLote);
router.post('/:id/status', gestao, InventarioController.definirAtivo);
router.get('/:id', leitura, InventarioController.findById);
router.put('/:id', operacao, InventarioController.update);
router.delete('/:id', gestao, InventarioController.archive);

module.exports = router;
