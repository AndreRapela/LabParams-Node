const {
  assertAmostraTransition,
  assertPedidoTransition,
  assertResultadoTransition,
  optionalComment,
  parsePagination,
  requireComment,
} = require('../utils/workflowPiloto');
const ResultadoAnaliseModel = require('../models/ResultadoAnaliseModel');

describe('regras do workflow de resultado', () => {
  test.each([
    ['rascunho', 'em_revisao'],
    ['em_revisao', 'aprovado'],
    ['em_revisao', 'rejeitado'],
    ['aprovado', 'publicado'],
    ['aprovado', 'rascunho'],
    ['rejeitado', 'rascunho'],
  ])('permite %s -> %s', (from, to) => {
    expect(assertResultadoTransition(from, to)).toBe(true);
  });

  test.each([
    ['rascunho', 'aprovado'],
    ['rejeitado', 'publicado'],
    ['publicado', 'rascunho'],
    ['publicado', 'aprovado'],
    ['em_revisao', 'publicado'],
  ])('bloqueia %s -> %s', (from, to) => {
    expect(() => assertResultadoTransition(from, to)).toThrow(/não é permitido/i);
  });

  test('rejeição e aprovação exigem comentário significativo', () => {
    expect(() => requireComment('', 'revisar')).toThrow(/comentário/i);
    expect(() => requireComment('ok', 'revisar')).toThrow(/comentário/i);
    expect(requireComment('Resultado conferido.', 'revisar')).toBe('Resultado conferido.');
  });

  test('comentário opcional é normalizado sem inventar conteúdo', () => {
    expect(optionalComment('  observação  ')).toBe('observação');
    expect(optionalComment('')).toBeNull();
  });
});

describe('regras do ciclo de vida de amostra e pedido', () => {
  test('aceita o caminho operacional completo da amostra', () => {
    expect(assertAmostraTransition('recebida', 'em_triagem')).toBe(true);
    expect(assertAmostraTransition('em_triagem', 'em_analise')).toBe(true);
    expect(assertAmostraTransition('em_analise', 'aguardando_revisao')).toBe(true);
    expect(assertAmostraTransition('aguardando_revisao', 'concluida')).toBe(true);
  });

  test('amostra concluída não pode retornar silenciosamente à análise', () => {
    expect(() => assertAmostraTransition('concluida', 'em_analise')).toThrow(/não é permitido/i);
  });

  test('pedido só é concluído depois de entrar em execução', () => {
    expect(assertPedidoTransition('rascunho', 'recebido')).toBe(true);
    expect(assertPedidoTransition('recebido', 'em_execucao')).toBe(true);
    expect(assertPedidoTransition('em_execucao', 'concluido')).toBe(true);
    expect(() => assertPedidoTransition('rascunho', 'concluido')).toThrow(/não é permitido/i);
  });
});

describe('validação de valores e paginação', () => {
  test('normaliza vírgula decimal sem aceitar número negativo', () => {
    expect(ResultadoAnaliseModel.validarValor({ valor_medido: '1,25' }, { tipo_resultado: 'numerico' }))
      .toEqual({ valor_medido: 1.25, valor_qualitativo: null });
    expect(() => ResultadoAnaliseModel.validarValor({ valor_medido: '-1' }, { tipo_resultado: 'numerico' }))
      .toThrow(/inválido/i);
  });

  test('resultado qualitativo aceita apenas valores previstos', () => {
    expect(ResultadoAnaliseModel.validarValor({ valor_qualitativo: 'Ausente' }, { tipo_resultado: 'qualitativo' }))
      .toEqual({ valor_medido: null, valor_qualitativo: 'Ausente' });
    expect(() => ResultadoAnaliseModel.validarValor({ valor_qualitativo: 'Talvez' }, { tipo_resultado: 'qualitativo' }))
      .toThrow(/Ausente ou Presente/i);
  });

  test('mantém compatibilidade quando paginação não é solicitada', () => {
    expect(parsePagination({ q: 'amostra' })).toBeNull();
  });

  test('limita page_size para proteger a API', () => {
    expect(parsePagination({ page: '2', page_size: '25' }))
      .toEqual({ page: 2, pageSize: 25, offset: 25 });
    expect(() => parsePagination({ page: 1, page_size: 101 })).toThrow(/entre 1 e 100/i);
  });
});
