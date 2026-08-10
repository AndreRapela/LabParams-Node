const express = require('express');
const ClienteController = require('../controllers/ClienteController');
const roleFromTable = require('../middleware/RoleFromTable');

const router = express.Router();
const read = roleFromTable('Gestor', 'Analista', 'Usuário');
const manage = roleFromTable('Gestor');

router.get('/', read, ClienteController.findAll);
router.post('/', manage, ClienteController.create);
router.get('/:id', read, ClienteController.findById);
router.put('/:id', manage, ClienteController.update);
router.delete('/:id', manage, ClienteController.archive);

module.exports = router;
