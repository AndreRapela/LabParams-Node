// models/ImportacaoModel.js
const pool = require('../config/database');
const fs = require('fs').promises;
const path = require('path');

class ImportacaoModel {

  static async validarLinha(linha, numeroLinha) {
    try {
      const erros = [];

      const camposObrigatorios = [
        'datacoleta',
        'valor_medido',
        'legislacao',
        'matriz',
        'numerodaamostra',
        'codigodaamostra',
        'parametro'
      ];

      for (const campo of camposObrigatorios) {
        if (!linha[campo] || linha[campo].toString().trim() === '') {
          erros.push(`Campo '${campo}' é obrigatório`);
        }
      }

      if (erros.length > 0) {
        return { sucesso: false, dados: null, erro: erros.join('; ') };
      }

      const valorMedido = parseFloat(linha.valor_medido.toString().replace(',', '.'));
      if (isNaN(valorMedido) || valorMedido < 0) {
        erros.push('Valor medido inválido (deve ser número >= 0)');
      }

      let dataColeta;
      try {
        const dataStr = linha.datacoleta.toString().trim();
        
        if (dataStr.includes('/')) {
          const partes = dataStr.split('/').map(Number);
          if (partes.length === 3) {
            const [dia, mes, anoInformado] = partes;
            const ano = anoInformado < 100 ? 2000 + anoInformado : anoInformado;
            dataColeta = new Date(ano, mes - 1, dia);

            if (
              dataColeta.getFullYear() !== ano ||
              dataColeta.getMonth() !== mes - 1 ||
              dataColeta.getDate() !== dia
            ) {
              throw new Error('Data inexistente no calendário');
            }
          }
        } else if (dataStr.includes('-')) {
          dataColeta = new Date(dataStr);
        } else {
          throw new Error('Formato inválido');
        }

        if (isNaN(dataColeta.getTime())) {
          throw new Error('Data inválida');
        }

        if (dataColeta > new Date()) {
          erros.push('Data de coleta não pode ser futura');
        }
      } catch (e) {
        erros.push(`Data de coleta inválida: ${e.message}`);
      }

      if (erros.length > 0) {
        return { sucesso: false, dados: null, erro: erros.join('; ') };
      }

      const codigoAmostra = linha.codigodaamostra.toString().trim();
      const numeroAmostra = linha.numerodaamostra.toString().trim();

      const amostraQuery = `
        SELECT a.id, a.codigo_amostra, a.numero_da_amostra, a.matriz_id, m.nome as matriz_nome
        FROM amostra a
        JOIN matriz m ON a.matriz_id = m.id
        WHERE a.codigo_amostra = $1 AND a.numero_da_amostra = $2
      `;
      const amostraResult = await pool.query(amostraQuery, [codigoAmostra, numeroAmostra]);

      if (amostraResult.rowCount === 0) {
        return { 
          sucesso: false, 
          dados: null, 
          erro: `Amostra não encontrada (código: ${codigoAmostra}, número: ${numeroAmostra})` 
        };
      }

      const amostra = amostraResult.rows[0];

      const nomeMatriz = linha.matriz.toString().trim();
      const matrizQuery = 'SELECT id, nome FROM matriz WHERE LOWER(nome) = LOWER($1)';
      const matrizResult = await pool.query(matrizQuery, [nomeMatriz]);

      if (matrizResult.rowCount === 0) {
        return { 
          sucesso: false, 
          dados: null, 
          erro: `Matriz '${nomeMatriz}' não encontrada no banco` 
        };
      }

      const matriz = matrizResult.rows[0];

      const nomeLegislacao = linha.legislacao.toString().trim();
      const legislacaoQuery = `
        SELECT id, nome, sigla 
        FROM legislacao 
        WHERE LOWER(nome) = LOWER($1) OR LOWER(sigla) = LOWER($1)
      `;
      const legislacaoResult = await pool.query(legislacaoQuery, [nomeLegislacao]);

      if (legislacaoResult.rowCount === 0) {
        return { 
          sucesso: false, 
          dados: null, 
          erro: `Legislação '${nomeLegislacao}' não encontrada no banco` 
        };
      }

      const legislacao = legislacaoResult.rows[0];

      const nomeParametro = linha.parametro.toString().trim();
      const parametroQuery = `
        SELECT p.id, p.nome, p.unidade_medida, p.limite_minimo, p.limite_maximo, 
               p.matriz_id, p.legislacao_id,
               m.nome as matriz_nome,
               l.nome as legislacao_nome, l.sigla as legislacao_sigla
        FROM parametro p
        JOIN matriz m ON p.matriz_id = m.id
        JOIN legislacao l ON p.legislacao_id = l.id
        WHERE LOWER(p.nome) = LOWER($1)
      `;
      const parametroResult = await pool.query(parametroQuery, [nomeParametro]);

      if (parametroResult.rowCount === 0) {
        return { 
          sucesso: false, 
          dados: null, 
          erro: `Parâmetro '${nomeParametro}' não encontrado no banco` 
        };
      }

      const parametro = parametroResult.rows[0];

      // Dados validados e prontos para inserção
      return {
        sucesso: true,
        dados: {
          valor_medido: valorMedido,
          datacoleta: dataColeta.toISOString(),
          datadapublicacao: new Date().toISOString(),
          amostra_id: amostra.id,
          parametro_id: parametro.id,
          codigodaamostra: codigoAmostra,
          numerodaamostra: numeroAmostra,
          matriz: matriz.nome,
          legislacao: `${legislacao.nome} (${legislacao.sigla})`
        },
        erro: null
      };

    } catch (error) {
      return { 
        sucesso: false, 
        dados: null, 
        erro: `Erro interno ao processar a linha ${numeroLinha}`
      };
    }
  }

  static async inserirLote(resultados) {
    const client = await pool.connect();
    let inseridos = 0;
    const errosInsercao = [];

    try {
      await client.query('BEGIN');

      for (let i = 0; i < resultados.length; i++) {
        const resultado = resultados[i];
        
        try {
          const query = `
            INSERT INTO resultado_analise 
            (valor_medido, amostra_id, parametro_id, datacoleta, datadapublicacao, 
             codigodaamostra, numerodaamostra, matriz, legislacao)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
          `;
          
          const values = [
            resultado.valor_medido,
            resultado.amostra_id,
            resultado.parametro_id,
            resultado.datacoleta,
            resultado.datadapublicacao,
            resultado.codigodaamostra,
            resultado.numerodaamostra,
            resultado.matriz,
            resultado.legislacao
          ];

          await client.query(query, values);
          inseridos++;

        } catch (insertError) {
          errosInsercao.push({
            linha: i + 1,
            dados: resultado,
            erro: insertError.message
          });
        }
      }

      await client.query('COMMIT');
      
      // Log da operação
      await this.logImportacao({
        total: resultados.length,
        inseridos,
        erros: errosInsercao.length
      });

      return { inseridos, erros: errosInsercao };

    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Erro na transação de importação: ${error.message}`);
    } finally {
      client.release();
    }
  }

  static async logImportacao(dados) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        operacao: 'IMPORTACAO',
        ...dados
      };
      
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        console.log('[Importacao]', JSON.stringify(logEntry));
      } else {
        const logDir = path.join(__dirname, '../logs');
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(
          path.join(logDir, 'importacoes.log'),
          JSON.stringify(logEntry) + '\n'
        );
      }
    } catch (error) {
      console.error('Erro ao gravar log:', error);
    }
  }
}

module.exports = ImportacaoModel;
