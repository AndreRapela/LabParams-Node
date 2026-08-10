const { avaliarConformidade } = require('../utils/conformidade');

describe('avaliação de conformidade legal', () => {
  test.each([
    [{ valor_medido: 40, limite_maximo: 40, tipo_limite: 'maximo' }, 'conforme'],
    [{ valor_medido: 40.01, limite_maximo: 40, tipo_limite: 'maximo' }, 'nao-conforme'],
    [{ valor_medido: 5, limite_minimo: 5, tipo_limite: 'minimo' }, 'conforme'],
    [{ valor_medido: 4.99, limite_minimo: 5, tipo_limite: 'minimo' }, 'nao-conforme'],
    [{ valor_medido: 7, limite_minimo: 5, limite_maximo: 9, tipo_limite: 'faixa' }, 'conforme'],
    [{ valor_qualitativo: 'Ausente', tipo_limite: 'ausencia' }, 'conforme'],
    [{ valor_qualitativo: 'Presente', tipo_limite: 'ausencia' }, 'nao-conforme'],
    [{ valor_medido: 123, tipo_limite: 'informativo' }, 'informativo'],
  ])('%# retorna %s', (entrada, esperado) => {
    expect(avaliarConformidade(entrada)).toBe(esperado);
  });
});
