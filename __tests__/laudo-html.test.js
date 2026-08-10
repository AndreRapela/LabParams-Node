const { createHash } = require('crypto');
const { escapeHtml, renderLaudoHtml } = require('../utils/laudoHtml');
const { canonicalStringify } = require('../utils/canonicalJson');

function reportFixture() {
  const snapshot = {
    laboratorio: { nome: 'Laboratório Água Limpa', documento: '00.000.000/0001-00' },
    cliente: { nome_razao_social: '<script>alert(1)</script>', documento: '123' },
    pedido: { codigo: 'PED-1', solicitante: 'Maria' },
    amostra: {
      codigo_amostra: 'A-1', numero_da_amostra: '1', matriz: 'Água',
      data_coleta: '2026-07-29T12:00:00.000Z', localizacao: 'Poço', status: 'concluida',
    },
    resultados: [{
      parametro: 'pH', metodo: { codigo: 'SM-4500', versao: '1' },
      valor_medido: 7.1, unidade: '', criterio_legal: '6,0 a 9,5',
      legislacao: { sigla: 'P888' }, contexto: { nome: 'Potabilidade' },
      status_conformidade: 'conforme',
    }],
    responsavel: { nome: 'Gestor', email: 'gestor@example.com' },
    observacoes: 'Documento de teste',
  };
  return {
    numero: 'LAU-A-1-V1', versao: 1, emitido_em: '2026-07-29T13:00:00.000Z',
    conteudo_hash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    snapshot,
  };
}

describe('HTML seguro e imprimível do laudo', () => {
  test('escapa conteúdo controlado pelo cliente', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    const html = renderLaudoHtml(reportFixture());
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('inclui número, integridade SHA-256 e CSS de impressão', () => {
    const report = reportFixture();
    const html = renderLaudoHtml(report);
    expect(html).toContain(report.numero);
    expect(html).toContain(report.conteudo_hash);
    expect(html).toContain('@media print');
    expect(html).toContain('Versão 1');
  });

  test('hash canônico não depende da ordem das chaves do JSONB', () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, b: 3 } }))
      .toBe(canonicalStringify({ a: { b: 3, y: 2 }, z: 1 }));
  });
});
