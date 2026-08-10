const InventarioModel = require('../models/InventarioModel');
const EquipamentoModel = require('../models/EquipamentoModel');
const QualidadeModel = require('../models/QualidadeModel');

describe('regras operacionais de inventário', () => {
  test('calcula entradas e saídas sem permitir saldo negativo', () => {
    expect(InventarioModel.calcularSaldo(10, 'ENTRADA', 2.5)).toBe(12.5);
    expect(InventarioModel.calcularSaldo(10, 'SAIDA', 2.5)).toBe(7.5);
    expect(InventarioModel.calcularSaldo(10, 'AJUSTE_POSITIVO', 1)).toBe(11);
    expect(InventarioModel.calcularSaldo(10, 'AJUSTE_NEGATIVO', 1)).toBe(9);
    expect(() => InventarioModel.calcularSaldo(1, 'SAIDA', 2)).toThrow('Saldo insuficiente');
  });

  test('rejeita quantidade e tipo inválidos', () => {
    expect(() => InventarioModel.calcularSaldo(1, 'TRANSFERENCIA', 1)).toThrow('Tipo de movimentação inválido');
    expect(() => InventarioModel.calcularSaldo(1, 'SAIDA', 0)).toThrow('Saldo ou quantidade inválidos');
  });
});

describe('bloqueio operacional de equipamentos', () => {
  const hoje = new Date('2026-07-29T12:00:00.000Z');

  test('bloqueia equipamento sem calibração ou com calibração vencida', () => {
    expect(EquipamentoModel.avaliarDisponibilidade({
      status: 'ATIVO', requer_calibracao: true, proxima_calibracao: null,
    }, hoje).status).toBe('BLOQUEADO_SEM_CALIBRACAO');

    expect(EquipamentoModel.avaliarDisponibilidade({
      status: 'ATIVO', requer_calibracao: true, proxima_calibracao: '2026-07-28',
    }, hoje).status).toBe('BLOQUEADO_CALIBRACAO_VENCIDA');
  });

  test('mantém o equipamento disponível no próprio dia da validade', () => {
    expect(EquipamentoModel.avaliarDisponibilidade({
      status: 'ATIVO', requer_calibracao: true, proxima_calibracao: '2026-07-29',
    }, hoje)).toEqual({ disponivel: true, status: 'DISPONIVEL', motivo: null });
  });

  test('intervenção em andamento prevalece sobre calibração válida', () => {
    expect(EquipamentoModel.avaliarDisponibilidade({
      status: 'ATIVO', requer_calibracao: false, evento_em_andamento: true,
    }, hoje).status).toBe('BLOQUEADO_INTERVENCAO');
  });

  test('preserva o status cadastral ao apresentar o status operacional', () => {
    const apresentado = EquipamentoModel.apresentarDisponibilidade({
      id: 1,
      status: 'ATIVO',
      requer_calibracao: true,
      proxima_calibracao: '2026-07-28',
    }, hoje);
    expect(apresentado.status).toBe('ATIVO');
    expect(apresentado.status_operacional).toBe('BLOQUEADO_CALIBRACAO_VENCIDA');
    expect(apresentado.disponivel).toBe(false);
  });
});

describe('workflow QMS', () => {
  test('aceita o fluxo controlado até o encerramento', () => {
    expect(QualidadeModel.validarTransicao('ABERTA', 'EM_INVESTIGACAO')).toBe(true);
    expect(QualidadeModel.validarTransicao('EM_INVESTIGACAO', 'PLANO_ACAO')).toBe(true);
    expect(QualidadeModel.validarTransicao('PLANO_ACAO', 'VERIFICACAO')).toBe(true);
    expect(QualidadeModel.validarTransicao('VERIFICACAO', 'ENCERRADA')).toBe(true);
  });

  test('rejeita atalhos de status e alterações em CAPA finalizada', () => {
    expect(() => QualidadeModel.validarTransicao('ABERTA', 'ENCERRADA')).toThrow('não permitida');
    expect(() => QualidadeModel.validarTransicaoCapa('CONCLUIDA', 'EM_ANDAMENTO')).toThrow('não permitida');
  });
});
