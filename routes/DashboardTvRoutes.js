const express = require('express');
const router = express.Router();
const DashboardTvController = require('../controllers/DashboardTvController');

router.get('/', DashboardTvController.getDashboard);

module.exports = router;
