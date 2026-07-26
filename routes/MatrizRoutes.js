const express = require('express');
const router = express.Router();
const MatrizController = require('../controllers/MatrizController');

// GET /matrizes
router.get('/', MatrizController.findAll);

module.exports = router;
