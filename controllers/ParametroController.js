// controllers/ParametroController.js
const ParametroModel = require('../models/ParametroModel');

class ParametroController {

    static async findAll(req, res) {
        try {
            const parametros = await ParametroModel.findAll();

            const parametrosComStatus = parametros.map(parametro => {
                const status = ParametroController.calcularStatusConformidade(parametro);
                return {
                    ...parametro,
                    status_conformidade: status
                };
            });

            return res.status(200).json({
                success: true,
                data: parametrosComStatus,
                count: parametrosComStatus.length
            });

        } catch (error) {
            console.error('Erro no controller ao buscar parâmetros:', error);
            return res.status(500).json({
                success: false,
                message: 'Erro interno do servidor'
            });
        }
    }

    static async update(req, res) {
        try {
            const { id } = req.params;
            const dados = req.body;

            const atualizado = await ParametroModel.update(id, dados);

            return res.status(200).json({
                success: true,
                message: "Parâmetro atualizado com sucesso",
                data: atualizado
            });

        } catch (error) {
            console.error("Erro ao atualizar parâmetro:", error);
            return res.status(500).json({
                success: false,
                message: "Erro ao atualizar parâmetro"
            });
        }
    }

    static calcularStatusConformidade(parametro) {
        const { valor_parametro, limite_minimo, limite_maximo } = parametro;

        const valor = parseFloat(valor_parametro);
        const min = parseFloat(limite_minimo);
        const max = parseFloat(limite_maximo);

        if (isNaN(valor)) return 'dados inválidos - valor';
        if (isNaN(min)) return 'dados inválidos - mínimo';
        if (isNaN(max)) return 'dados inválidos - máximo';

        if (valor < min || valor > max) return 'não conforme';

        const faixaTotal = max - min;
        const valorNormalizado = (valor - min) / faixaTotal;

        if (valorNormalizado > 0.9) return 'crítico';
        if (valorNormalizado > 0.8) return 'alerta';

        return 'conforme';
    }
}

module.exports = ParametroController;
