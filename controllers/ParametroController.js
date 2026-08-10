const ParametroModel = require('../models/ParametroModel');
const { avaliarConformidade } = require('../utils/conformidade');

class ParametroController {
  static async findAll(_req, res) {
    try {
      const parametros = await ParametroModel.findAll();
      const data = parametros.map((parametro) => ({
        ...parametro,
        status_conformidade: parametro.valor_parametro === null
          ? 'sem resultado'
          : avaliarConformidade({
              ...parametro,
              valor_medido: parametro.valor_parametro,
            }),
      }));

      return res.status(200).json({ success: true, data, count: data.length });
    } catch (error) {
      console.error('Erro ao buscar parâmetros:', error.message);
      return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
    }
  }

  static async update(req, res) {
    try {
      if (Object.keys(req.body).some((campo) => campo !== 'valor_parametro')) {
        return res.status(400).json({
          success: false,
          message: 'Os limites legais, a matriz, a legislação e o contexto são somente leitura',
        });
      }

      const atualizado = await ParametroModel.update(req.params.id, req.body, {
        actorUserId: req.user?.id,
        requestId: req.requestId,
      });
      if (!atualizado) {
        return res.status(404).json({ success: false, message: 'Parâmetro não encontrado' });
      }

      return res.status(200).json({
        success: true,
        message: 'Valor atual do parâmetro atualizado com sucesso',
        data: atualizado,
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }
}

module.exports = ParametroController;
