// models/AlertasModel.js
const pool = require('../config/database');

class AlertasModel {

  static async getAlertas() {
    try {
      const query = `
        SELECT 
          ra.id,
          ra.valor_medido,
          ra.created_at as data_alerta,
          p.nome as parametro_nome,
          p.unidade_medida,
          p.limite_minimo,
          p.limite_maximo,
          m.nome as matriz_nome
        FROM resultado_analise ra
        INNER JOIN parametro p ON ra.parametro_id = p.id
        INNER JOIN amostra a ON ra.amostra_id = a.id
        INNER JOIN matriz m ON a.matriz_id = m.id
        WHERE p.limite_minimo IS NOT NULL OR p.limite_maximo IS NOT NULL
        ORDER BY ra.created_at DESC
      `;
      
      const result = await pool.query(query);
      
      const relatorio = result.rows.map(item => {
        const valor = parseFloat(item.valor_medido);
        const min = item.limite_minimo ? parseFloat(item.limite_minimo) : -Infinity;
        const max = item.limite_maximo ? parseFloat(item.limite_maximo) : Infinity;
        
        let status = 'CONFORME';
        let mensagemLimite = '';

        if (valor >= min && valor <= max) {
            const margemAlerta = 0.10;

            if ((item.limite_maximo && valor >= max * (1 - margemAlerta)) || 
                (item.limite_minimo && valor <= min * (1 + margemAlerta))) {
                status = 'ALERTA';
                mensagemLimite = item.limite_maximo && valor >= max * 0.9 ? `(Próx. Max: ${max})` : `(Próx. Min: ${min})`;
            } else {
                status = 'CONFORME';
            }
        }
        else {
            const margemCritica = 0.20;

            let isCritico = false;
            
            if (item.limite_maximo && valor > max) {
                if (valor > max * (1 + margemCritica)) isCritico = true;
                mensagemLimite = `(Max: ${max})`;
            }
            
            if (item.limite_minimo && valor < min) {
                if (valor < min * (1 - margemCritica)) isCritico = true;
                mensagemLimite = `(Min: ${min})`;
            }

            status = isCritico ? 'CRÍTICO' : 'NÃO CONFORME';
        }

        return { ...item, status, mensagem_limite: mensagemLimite };
      })
      .filter(item => item.status !== 'CONFORME');

      return relatorio;

    } catch (error) {
      console.error('Erro no AlertasModel:', error);
      throw error;
    }
  }
}

module.exports = AlertasModel;