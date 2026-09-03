const ParametroModel = require('../models/ParametroModel');
const MatrizModel = require('../models/MatrizModel');
const LegislacaoModel = require('../models/LegislacaoModel');
const { parsePagination, workflowError } = require('../utils/workflowPiloto');

function parsePositiveId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw workflowError(`${field} deve ser um inteiro positivo.`, 400, 'FILTRO_INVALIDO');
  }
  return parsed;
}

function parseSearch(value) {
  const search = String(value ?? '').trim();
  if (search.length > 100) {
    throw workflowError('q deve ter no máximo 100 caracteres.', 400, 'FILTRO_INVALIDO');
  }
  return search;
}

function paginationPayload(result) {
  const totalPages = result.total > 0 ? Math.ceil(result.total / result.pageSize) : 0;
  return {
    page: result.page,
    page_size: result.pageSize,
    total: result.total,
    total_pages: totalPages,
    has_next: result.page < totalPages,
    has_previous: result.page > 1 && totalPages > 0,
  };
}

exports.listarTudo = async (req, res, next) => {
  try {
    const pagination = parsePagination({
      page: req.query.page ?? 1,
      page_size: req.query.page_size ?? 30,
    });
    const filters = {
      ...pagination,
      q: parseSearch(req.query.q),
      matriz_id: parsePositiveId(req.query.matriz_id, 'matriz_id'),
      legislacao_id: parsePositiveId(req.query.legislacao_id, 'legislacao_id'),
    };
    const [parameterResult, matrizes, legislacoes] = await Promise.all([
      ParametroModel.findAllGerenciamento(filters),
      MatrizModel.findAll(),
      LegislacaoModel.findAll(),
    ]);

    return res.json({
      parametros: parameterResult.rows,
      matrizes,
      legislacoes,
      pagination: paginationPayload(parameterResult),
    });
  } catch (error) {
    return next(error);
  }
};

exports.parsePositiveId = parsePositiveId;
exports.parseSearch = parseSearch;

exports.atualizarParametro = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (Object.keys(req.body).some((campo) => campo !== 'valor_parametro')) {
      return res.status(400).json({
        error: 'Campos não permitidos para alteração'
      });
    }

    const atualizado = await ParametroModel.updateGerenciamento(id, req.body, {
      actorUserId: req.user?.id,
      requestId: req.requestId,
    });
    return res.json(atualizado);
  } catch (error) {
    return next(error);
  }
};
