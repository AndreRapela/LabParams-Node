const express = require('express');
const router = express.Router();
const AmostraController = require('../controllers/AmostraController');
const roleFromTable = require('../middleware/RoleFromTable');
const terminalStatusRole = require('../middleware/TerminalStatusRole');

const leitura = roleFromTable('Gestor', 'Analista', 'Usuário');
const operacao = roleFromTable('Gestor', 'Analista');
const gestao = roleFromTable('Gestor');
const terminalAmostra = terminalStatusRole({
  field: 'status',
  terminalStatuses: ['concluida', 'rejeitada', 'cancelada'],
});
const terminalCustodia = terminalStatusRole({
  field: 'status_novo',
  terminalStatuses: ['concluida', 'rejeitada', 'cancelada', 'descarte'],
  eventAliases: { rejeicao: 'rejeitada', descarte: 'descarte' },
});

router.get('/matrizes', leitura, AmostraController.getMatrizes);

/**
 * @route GET /amostras/usuarios
 * @description Busca lista de usuários para o select
 */
router.get('/usuarios', operacao, AmostraController.getUsuarios);

router.get('/', leitura, AmostraController.findAll);

/**
 * @route POST /amostras
 * @description Cria uma nova amostra (com array de parâmetros)
 */
router.post('/', operacao, AmostraController.create);

router.patch('/:id/status', operacao, terminalAmostra, AmostraController.transitionStatus);
router.get('/:id/custodia', leitura, AmostraController.findCustodyEvents);
router.post('/:id/custodia', operacao, terminalCustodia, AmostraController.addCustodyEvent);

/**
 * @route GET /amostras/:id
 * @description Busca detalhes de uma amostra específica
 */
router.get('/:id', leitura, AmostraController.findById);

/**
 * @route PUT /amostras/:id
 * @description Atualiza uma amostra
 */
router.put('/:id', operacao, AmostraController.update);

/**
 * @route DELETE /amostras/:id
 * @description Exclui uma amostra
 */
router.delete('/:id', gestao, AmostraController.delete);



module.exports = router;
