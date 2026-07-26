const ResultadoAnaliseModel = require('../models/ResultadoAnaliseModel');

class ResultadoAnaliseController {

  static async findAll(req, res) {
    try {
      const resultados = await ResultadoAnaliseModel.findAll();

      return res.status(200).json({
        success: true,
        data: resultados,
        count: resultados.length
      });

    } catch (error) {
      console.error('Erro no controller ao buscar resultados:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }


  static async create(req, res) {
    try {
      const {
        valor_medido,
        amostra_id,
        parametro_id,
        datacoleta,
        matriz_id_selecionada,
        legislacao_id_selecionada
      } = req.body;

      const novoResultado = await ResultadoAnaliseModel.create({
        valor_medido,
        amostra_id,
        parametro_id,
        datacoleta,
        matriz_id_selecionada,
        legislacao_id_selecionada
      });

      return res.status(201).json({
        success: true,
        message: 'Resultado de análise criado com sucesso',
        data: novoResultado
      });

    } catch (error) {
      console.error('Erro Create Controller:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        error: 'Erro de validação'
      });
    }
  }


  static async update(req, res) {
    try {
      const { id } = req.params;
      const {
        valor_medido,
        amostra_id,
        parametro_id,
        datacoleta,
        matriz_id_selecionada,
        legislacao_id_selecionada
      } = req.body;

      const resultadoAtualizado = await ResultadoAnaliseModel.update(id, {
        valor_medido,
        amostra_id,
        parametro_id,
        datacoleta,
        matriz_id_selecionada,
        legislacao_id_selecionada
      });

      if (!resultadoAtualizado) {
        return res.status(404).json({ success: false, message: 'Não encontrado' });
      }

      return res.status(200).json({
        success: true,
        message: 'Resultado atualizado com sucesso',
        data: resultadoAtualizado
      });

    } catch (error) {
      console.error('Erro Update Controller:', error);
      return res.status(400).json({
        success: false,
        message: error.message,
        error: 'Erro de validação'
      });
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;
      const deletado = await ResultadoAnaliseModel.delete(id);

      if (!deletado) {
        return res.status(404).json({
          success: false,
          message: 'Resultado de análise não encontrado'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Resultado de análise excluído com sucesso'
      });

    } catch (error) {
      console.error('Erro no controller ao excluir resultado:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor'
      });
    }
  }

  static async findAmostras(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findAmostras();
      return res.status(200).json({ success: true, data, count: data.length });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Erro ao buscar amostras' });
    }
  }

  static async findParametros(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findParametros();
      return res.status(200).json({ success: true, data, count: data.length });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Erro ao buscar parâmetros' });
    }
  }

  static async findMatrizes(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findMatrizes();
      return res.status(200).json({ success: true, data, count: data.length });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Erro ao buscar matrizes' });
    }
  }

  static async findLegislacoes(req, res) {
    try {
      const data = await ResultadoAnaliseModel.findLegislacoes();
      return res.status(200).json({ success: true, data, count: data.length });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Erro ao buscar legislações' });
    }
  }

  static async findById(req, res) {
    try {
      const { id } = req.params;
      const resultado = await ResultadoAnaliseModel.findById(id);
      if (!resultado) return res.status(404).json({ success: false, message: 'Não encontrado' });
      return res.status(200).json({ success: true, data: resultado });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Erro interno' });
    }
  }
}

module.exports = ResultadoAnaliseController;
