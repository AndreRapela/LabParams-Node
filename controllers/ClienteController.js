const ClienteModel = require('../models/ClienteModel');

function audit(req) { return { actorUserId: req.user?.id, requestId: req.requestId }; }
function fail(res, error) {
  const status = Number(error.statusCode) || 500;
  if (status >= 500) console.error('Erro em clientes:', error);
  return res.status(status).json({ success: false, message: status < 500 ? error.message : 'Erro interno ao processar cliente', code: error.code });
}
function sendList(res, result) {
  if (Array.isArray(result)) return res.json({ success: true, data: result, count: result.length });
  return res.json({ success: true, data: result.rows, count: result.rows.length, pagination: {
    page: result.page, page_size: result.pageSize, total: result.total,
    total_pages: Math.ceil(result.total / result.pageSize),
  } });
}

class ClienteController {
  static async findAll(req, res) { try { return sendList(res, await ClienteModel.findAll(req.query)); } catch (e) { return fail(res, e); } }
  static async findById(req, res) {
    try {
      const data = await ClienteModel.findById(req.params.id);
      return data ? res.json({ success: true, data }) : res.status(404).json({ success: false, message: 'Cliente não encontrado' });
    } catch (e) { return fail(res, e); }
  }
  static async create(req, res) { try { return res.status(201).json({ success: true, data: await ClienteModel.create(req.body, audit(req)) }); } catch (e) { return fail(res, e); } }
  static async update(req, res) { try { return res.json({ success: true, data: await ClienteModel.update(req.params.id, req.body, audit(req)) }); } catch (e) { return fail(res, e); } }
  static async archive(req, res) {
    try {
      const ok = await ClienteModel.archive(req.params.id, req.body?.motivo, audit(req));
      return ok ? res.json({ success: true, message: 'Cliente arquivado.' }) : res.status(404).json({ success: false, message: 'Cliente não encontrado' });
    } catch (e) { return fail(res, e); }
  }
}
module.exports = ClienteController;
