const express = require('express');
const QualidadeController = require('../controllers/QualidadeController');
const roleFromTable = require('../middleware/RoleFromTable');

const router = express.Router();
const leitura = roleFromTable('Gestor', 'Analista', 'Usuário');
const operacao = roleFromTable('Gestor', 'Analista');
const gestao = roleFromTable('Gestor');

router.get('/resumo', leitura, QualidadeController.getResumo);
router.get('/responsaveis', operacao, QualidadeController.findResponsaveis);
router.get('/ocorrencias', leitura, QualidadeController.findAll);
router.post('/ocorrencias', operacao, QualidadeController.create);

router.post('/ocorrencias/:id/decisoes', gestao, QualidadeController.decidir);
router.post('/ocorrencias/:id/acoes', operacao, QualidadeController.createAcao);
router.patch('/ocorrencias/:id/acoes/:acaoId', operacao, QualidadeController.updateAcao);
router.post('/ocorrencias/:id/acoes/:acaoId/cancelar', gestao, QualidadeController.cancelarAcao);

router.get('/ocorrencias/:id', leitura, QualidadeController.findById);
router.put('/ocorrencias/:id', operacao, QualidadeController.update);
router.delete('/ocorrencias/:id', gestao, QualidadeController.archive);

module.exports = router;
