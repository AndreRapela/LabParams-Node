// routes/dashboardWebRoutes.js
const express = require('express');
const router = express.Router();
const DashboardWebController = require('../controllers/DashboardWebController');


router.get('/', DashboardWebController.getDashboardData);
router.get('/filter-options', DashboardWebController.getFilterOptions);

module.exports = router;