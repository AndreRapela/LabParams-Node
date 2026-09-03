'use strict';

const { safeRequestPath } = require('../utils/safeRequestPath');

describe('sanitização de caminhos para logs', () => {
  test('substitui hash público mesmo com query string', () => {
    const hash = 'ABCDEF12'.repeat(8);
    expect(safeRequestPath(`/verificar-laudo/${hash}?token=segredo`))
      .toBe('/verificar-laudo/:hash');
  });

  test('remove IDs numéricos, UUIDs e tokens opacos sem alterar rotas estáticas', () => {
    expect(safeRequestPath('/amostras/123/resultados')).toBe('/amostras/:id/resultados');
    expect(safeRequestPath('/usuarios/550e8400-e29b-41d4-a716-446655440000'))
      .toBe('/usuarios/:id');
    expect(safeRequestPath('/health/ready')).toBe('/health/ready');
  });
});
