// controllers/AlertasController.js
const AlertasModel = require('../models/AlertaModel');

class AlertasController {
  static async index(req, res) {
    try {
      const alertas = await AlertasModel.getAlertas();
      
      // Contagem dos cards
      const totalAlertas = alertas.length; // Total de itens na lista filtrada
      const qtdAlerta = alertas.filter(a => a.status === 'ALERTA').length;
      const qtdNaoConforme = alertas.filter(a => a.status === 'NÃO CONFORME').length;
      const qtdCritico = alertas.filter(a => a.status === 'CRÍTICO').length;

      return res.status(200).json({
        success: true,
        data: alertas,
        stats: { total: totalAlertas, alerta: qtdAlerta, naoConforme: qtdNaoConforme, critico: qtdCritico }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar alertas' });
    }
  }
}

module.exports = AlertasController;
