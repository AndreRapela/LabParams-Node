const AmostraModel = require('../models/AmostraModel');

class AmostraController {

  static async findAll(req, res) {
    try {
      const amostras = await AmostraModel.findAll();
      
      return res.status(200).json({
        success: true,
        data: amostras,
        count: amostras.length
      });

    } catch (error) {
      console.error('Erro ao buscar amostras:', error);
      return res.status(500).json({
        success: false,
        message: 'Erro interno ao buscar lista de amostras'
      });
    }
  }

  static async findById(req, res) {
    try {
      const { id } = req.params;
      const amostra = await AmostraModel.findById(id);

      if (!amostra) {
        return res.status(404).json({
          success: false,
          message: 'Amostra não encontrada'
        });
      }

      return res.status(200).json({
        success: true,
        data: amostra
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao buscar detalhes da amostra'
      });
    }
  }

  static async create(req, res) {
    try {
      const {
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        parametros_ids
      } = req.body;

      const novaAmostra = await AmostraModel.create({
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        parametros_ids
      });

      return res.status(201).json({
        success: true,
        message: 'Amostra cadastrada com sucesso!',
        data: novaAmostra
      });

    } catch (error) {
      console.error('Erro ao criar amostra:', error);
      
      if (error.message.includes('já existe') || error.message.includes('obrigatórios')) {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'Erro de validação'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Erro interno ao salvar amostra'
      });
    }
  }

  /**
   * Atualiza uma amostra e seus vínculos de parâmetros
   * [PUT] /amostras/:id
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      
      const {
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,    // <--- CAMPO OBRIGATÓRIO ADICIONADO
        parametros_ids // <--- NOVO: Array atualizado
      } = req.body;

      const amostraAtualizada = await AmostraModel.update(id, {
        codigo_amostra,
        numero_da_amostra,
        data_coleta,
        localizacao,
        matriz_id,
        usuario_id,
        parametros_ids
      });

      if (!amostraAtualizada) {
        return res.status(404).json({
          success: false,
          message: 'Amostra não encontrada para atualização'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Amostra atualizada com sucesso!',
        data: amostraAtualizada
      });

    } catch (error) {
      console.error('Erro ao atualizar amostra:', error);
      return res.status(400).json({
        success: false,
        message: error.message || 'Erro ao processar atualização',
        error: 'Erro de processamento'
      });
    }
  }

  /**
   * Exclui uma amostra
   * [DELETE] /amostras/:id
   */
  static async delete(req, res) {
    try {
      const { id } = req.params;
      const deletado = await AmostraModel.delete(id);

      if (!deletado) {
        return res.status(404).json({
          success: false,
          message: 'Amostra não encontrada'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Amostra excluída com sucesso'
      });

    } catch (error) {
      console.error('Erro ao excluir amostra:', error);
      
      if (error.message.includes('vinculados') || error.message.includes('resultados')) {
        return res.status(409).json({ // 409 Conflict
          success: false,
          message: error.message,
          error: 'Conflito de dependência'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Erro interno ao excluir'
      });
    }
  }

  // --- MÉTODOS AUXILIARES (DROPDOWNS) ---

  /**
   * Busca lista de matrizes
   * [GET] /amostras/matrizes
   */
  static async getMatrizes(req, res) {
    try {
      const matrizes = await AmostraModel.findMatrizesDropdown();
      return res.status(200).json({ success: true, data: matrizes });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar matrizes' });
    }
  }

  /**
   * Busca lista de usuários (NOVO)
   * [GET] /amostras/usuarios
   */
  static async getUsuarios(req, res) {
    try {
      const usuarios = await AmostraModel.findUsuariosDropdown();
      return res.status(200).json({ success: true, data: usuarios });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar usuários' });
    }
  }
}

module.exports = AmostraController;
