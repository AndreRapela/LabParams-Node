const {
  avaliarAlertaOperacional,
  avaliarConformidade,
  avaliarStatusOperacional,
  statusOperacionalSql,
} = require('../utils/conformidade');

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

  test.each([
    [{ valor_medido: 70, limite_maximo: 100, tipo_limite: 'maximo' }, null],
    [{ valor_medido: 90, limite_maximo: 100, tipo_limite: 'maximo' }, 'alerta'],
    [{ valor_medido: 110, limite_maximo: 100, tipo_limite: 'maximo' }, 'nao-conforme'],
    [{ valor_medido: 121, limite_maximo: 100, tipo_limite: 'maximo' }, 'critico'],
    [{ valor_medido: 6.2, limite_minimo: 6, limite_maximo: 9, tipo_limite: 'faixa' }, 'alerta'],
    [{ valor_medido: 5.8, limite_minimo: 6, limite_maximo: 9, tipo_limite: 'faixa' }, 'nao-conforme'],
    [{ valor_medido: 5.3, limite_minimo: 6, limite_maximo: 9, tipo_limite: 'faixa' }, 'critico'],
    [{ valor_qualitativo: 'Presente', tipo_limite: 'ausencia' }, 'nao-conforme'],
    [{ valor_medido: 10, tipo_limite: 'informativo' }, null],
  ])('classifica alerta operacional %# como %s', (entrada, esperado) => {
    expect(avaliarAlertaOperacional(entrada)).toBe(esperado);
  });

  test.each([
    [{ valor_medido: 70, limite_maximo: 100, tipo_limite: 'maximo' }, 'conforme', null],
    [{ valor_medido: 95, limite_maximo: 100, tipo_limite: 'maximo' }, 'alerta', 'alerta'],
    [{ valor_medido: 110, limite_maximo: 100, tipo_limite: 'maximo' }, 'nao-conforme', 'nao-conforme'],
    [{ valor_medido: 121, limite_maximo: 100, tipo_limite: 'maximo' }, 'critico', 'critico'],
  ])('dashboard e alertas compartilham a taxonomia %#', (entrada, status, alerta) => {
    expect(avaliarStatusOperacional(entrada)).toBe(status);
    expect(avaliarAlertaOperacional(entrada)).toBe(alerta);
  });

  test('gera a classificação SQL somente com alias validado', () => {
    const sql = statusOperacionalSql('ra');
    expect(sql).toContain("'nao-conforme'");
    expect(sql).toContain("then 'critico'");
    expect(sql).toContain("then 'alerta'");
    expect(() => statusOperacionalSql('ra; drop table usuario'))
      .toThrow(/alias sql inválido/i);
  });
});
