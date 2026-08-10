const express = require('express');
const AuditLogModel = require('../models/AuditLogModel');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await AuditLogModel.findAll({
      page: req.query.page,
      pageSize: req.query.page_size,
      entityType: req.query.entity_type,
      actorUserId: req.query.actor_user_id,
    });
    return res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: result.page,
        page_size: result.pageSize,
        total: result.total,
        total_pages: Math.ceil(result.total / result.pageSize),
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
