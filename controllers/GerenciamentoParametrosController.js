const ParametroModel = require('../models/ParametroModel');
const MatrizModel = require('../models/MatrizModel');
const LegislacaoModel = require('../models/LegislacaoModel');

exports.listarTudo = async (req, res, next) => {
  try {
    const [parametros, matrizes, legislacoes] = await Promise.all([
      ParametroModel.findAllGerenciamento(),
      MatrizModel.findAll(),
      LegislacaoModel.findAll(),
    ]);

    return res.json({ parametros, matrizes, legislacoes });
  } catch (error) {
    return next(error);
  }
};

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
