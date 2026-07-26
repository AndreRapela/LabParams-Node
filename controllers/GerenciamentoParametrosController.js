const ParametroModel = require('../models/ParametroModel');
const MatrizModel = require('../models/MatrizModel');
const LegislacaoModel = require('../models/LegislacaoModel');

exports.listarTudo = async (req, res) => {
  const parametros = await ParametroModel.findAllGerenciamento();
  const matrizes = await MatrizModel.findAll();
  const legislacoes = await LegislacaoModel.findAll();

  res.json({
    parametros,
    matrizes,
    legislacoes
  });
};

exports.atualizarParametro = async (req, res) => {
  const { id } = req.params;

  if (
    'nome' in req.body ||
    'limite_minimo' in req.body ||
    'limite_maximo' in req.body ||
    'unidade_medida' in req.body
  ) {
    return res.status(400).json({
      error: 'Campos não permitidos para alteração'
    });
  }

  const atualizado = await ParametroModel.updateGerenciamento(id, req.body);
  res.json(atualizado);
};
