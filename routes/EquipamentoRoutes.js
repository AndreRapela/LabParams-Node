const express = require('express');
const EquipamentoController = require('../controllers/EquipamentoController');
const roleFromTable = require('../middleware/RoleFromTable');

const router = express.Router();
const leitura = roleFromTable('Gestor', 'Analista', 'Usuário');
const operacao = roleFromTable('Gestor', 'Analista');
const gestao = roleFromTable('Gestor');

router.get('/resumo', leitura, EquipamentoController.getResumo);
router.get('/', leitura, EquipamentoController.findAll);
router.post('/', operacao, EquipamentoController.create);

router.get('/:id/eventos', leitura, EquipamentoController.findEventos);
router.post('/:id/eventos', operacao, EquipamentoController.createEvento);
router.post('/:id/eventos/:eventoId/iniciar', operacao, EquipamentoController.iniciarEvento);
router.post('/:id/eventos/:eventoId/concluir', gestao, EquipamentoController.concluirEvento);
router.post('/:id/eventos/:eventoId/cancelar', gestao, EquipamentoController.cancelarEvento);

router.get('/:id/utilizacoes', leitura, EquipamentoController.findUtilizacoes);
router.post('/:id/utilizacoes', operacao, EquipamentoController.registrarUtilizacao);

router.post('/:id/status', gestao, EquipamentoController.definirStatus);
router.post('/:id/configuracao-calibracao', gestao, EquipamentoController.configurarCalibracao);
router.get('/:id', leitura, EquipamentoController.findById);
router.put('/:id', operacao, EquipamentoController.update);
router.delete('/:id', gestao, EquipamentoController.archive);

module.exports = router;
