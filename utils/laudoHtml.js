function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(parsed);
}

function resultValue(result) {
  if (result.valor_qualitativo) return escapeHtml(result.valor_qualitativo);
  if (result.valor_medido === null || result.valor_medido === undefined) return '—';
  return `${escapeHtml(result.valor_medido)} ${escapeHtml(result.unidade || '')}`.trim();
}

function legalReference(result) {
  if (result.criterio_legal) return escapeHtml(result.criterio_legal);
  if (result.tipo_limite === 'faixa') {
    return `${escapeHtml(result.limite_minimo)} a ${escapeHtml(result.limite_maximo)}`;
  }
  if (result.tipo_limite === 'minimo') return `≥ ${escapeHtml(result.limite_minimo)}`;
  if (result.tipo_limite === 'maximo') return `≤ ${escapeHtml(result.limite_maximo)}`;
  if (result.tipo_limite === 'ausencia') return 'Ausência';
  return 'Informativo';
}

function methodDetails(method) {
  if (!method) return '<small>Método não informado</small>';
  const performance = [
    method.limite_deteccao === null || method.limite_deteccao === undefined
      ? null : `LD ${escapeHtml(method.limite_deteccao)}`,
    method.limite_quantificacao === null || method.limite_quantificacao === undefined
      ? null : `LQ ${escapeHtml(method.limite_quantificacao)}`,
    method.incerteza_padrao === null || method.incerteza_padrao === undefined
      ? null : `U ${escapeHtml(method.incerteza_padrao)}`,
  ].filter(Boolean).join(' · ');
  return `<small>${escapeHtml(method.codigo)} · versão ${escapeHtml(method.versao)}</small>${
    method.referencia_normativa
      ? `<small>${escapeHtml(method.referencia_normativa)}</small>`
      : ''
  }${performance ? `<small>${performance}</small>` : ''}`;
}

function renderLaudoHtml(report, verificationQr = null) {
  const snapshot = report.snapshot;
  const client = snapshot.cliente || {};
  const order = snapshot.pedido || {};
  const results = Array.isArray(snapshot.resultados) ? snapshot.resultados : [];
  const rows = results.map((result) => `
    <tr>
      <td><strong>${escapeHtml(result.parametro)}</strong>${methodDetails(result.metodo)}</td>
      <td>${resultValue(result)}</td>
      <td>${legalReference(result)}${result.fonte_legal
        ? `<small>${escapeHtml(result.fonte_legal)}</small>`
        : ''}</td>
      <td>${escapeHtml(result.legislacao?.sigla || '—')}
        <small>${escapeHtml(result.contexto?.nome || '')}</small></td>
      <td><span class="status ${escapeHtml(result.status_conformidade)}">${
        escapeHtml(result.status_conformidade)
      }</span></td>
    </tr>
  `).join('');
  const revisionReason = snapshot.documento?.motivo_revisao || report.motivo_revisao;
  const signature = report.assinatura || {};

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(report.numero)}</title>
  <style>
    :root{font-family:Arial,sans-serif;color:#172033}*{box-sizing:border-box}body{margin:0;background:#eef2f7}.page{width:210mm;min-height:297mm;margin:12mm auto;background:white;padding:16mm;box-shadow:0 2px 20px #0002}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #176c61;padding-bottom:14px}h1{font-size:23px;margin:0;color:#176c61}h2{font-size:15px;margin:22px 0 8px;color:#176c61}.muted,small{display:block;color:#637083;font-size:10px;margin-top:4px;line-height:1.35}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 22px}.field{font-size:12px;padding:7px 0;border-bottom:1px solid #e2e8f0}.field b{display:block;font-size:10px;text-transform:uppercase;color:#637083;margin-bottom:3px}.revision{border-left:4px solid #d59b19;background:#fff8e6;padding:10px 12px;font-size:11px}table{width:100%;border-collapse:collapse;font-size:10px}caption{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}th{background:#176c61;color:white;text-align:left;padding:8px}td{padding:8px;border-bottom:1px solid #dfe5ec;vertical-align:top}.status{display:inline-block;border-radius:20px;padding:4px 7px;font-size:9px;font-weight:bold;text-transform:uppercase;background:#e7edf2}.status.conforme{background:#dcfce7;color:#166534}.status.nao-conforme{background:#fee2e2;color:#991b1b}.status.informativo{background:#dbeafe;color:#1e40af}footer{margin-top:28px;border-top:1px solid #cbd5e1;padding-top:10px;font-size:9px;color:#637083;overflow-wrap:anywhere}.signature{margin-top:35px;width:65%;border-top:1px solid #172033;padding-top:5px;font-size:11px}.integrity{display:flex;align-items:center;justify-content:space-between;gap:14px}.integrity img{width:30mm;height:30mm;flex:0 0 auto}@media print{body{background:white}.page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:12mm}@page{size:A4;margin:0}}
  </style>
</head>
<body><main class="page">
  <header><div><h1>Laudo analítico</h1><span class="muted">${
    escapeHtml(snapshot.laboratorio?.nome || 'Laboratório emissor')
  }</span><span class="muted">${escapeHtml(snapshot.laboratorio?.documento || '')}</span></div>
  <div><strong>${escapeHtml(report.numero)}</strong><span class="muted">Versão ${
    escapeHtml(report.versao)
  }</span><span class="muted">Emitido em ${date(report.emitido_em)}</span></div></header>
  ${revisionReason ? `<h2>Revisão do documento</h2><p class="revision">${
    escapeHtml(revisionReason).replace(/\n/g, '<br>')
  }</p>` : ''}
  <h2>Cliente e solicitação</h2><section class="grid">
    <div class="field"><b>Cliente</b>${escapeHtml(client.nome_razao_social || 'Não vinculado')}</div>
    <div class="field"><b>Documento</b>${escapeHtml(client.documento || '—')}</div>
    <div class="field"><b>Pedido</b>${escapeHtml(order.codigo || 'Não vinculado')}</div>
    <div class="field"><b>Solicitante</b>${escapeHtml(order.solicitante || '—')}</div>
  </section>
  <h2>Amostra</h2><section class="grid">
    <div class="field"><b>Código</b>${escapeHtml(snapshot.amostra.codigo_amostra)}</div>
    <div class="field"><b>Número</b>${escapeHtml(snapshot.amostra.numero_da_amostra)}</div>
    <div class="field"><b>Matriz</b>${escapeHtml(snapshot.amostra.matriz)}</div>
    <div class="field"><b>Coleta</b>${date(snapshot.amostra.data_coleta)}</div>
    <div class="field"><b>Local</b>${escapeHtml(
      snapshot.amostra.localizacao || snapshot.amostra.local_atual || '—'
    )}</div>
    <div class="field"><b>Status</b>${escapeHtml(snapshot.amostra.status)}</div>
  </section>
  <h2>Resultados</h2><table><caption>Resultados analíticos e referências legais</caption>
    <thead><tr><th scope="col">Parâmetro / método</th><th scope="col">Resultado</th><th scope="col">Referência</th><th scope="col">Legislação</th><th scope="col">Conformidade</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${snapshot.observacoes ? `<h2>Observações</h2><p>${
    escapeHtml(snapshot.observacoes).replace(/\n/g, '<br>')
  }</p>` : ''}
  <div class="signature"><strong>${escapeHtml(snapshot.responsavel.nome)}</strong><br>${
    escapeHtml(snapshot.responsavel.email || '')
  }<br>Responsável pela emissão eletrônica${signature.assinada_em
    ? `<br><small>Assinado em ${date(signature.assinada_em)} · ${escapeHtml(signature.metodo)}</small>`
    : ''}</div>
  <footer><div class="integrity"><div>Integridade SHA-256: ${
    escapeHtml(report.conteudo_hash)
  }${signature.hash ? `<br>Assinatura: ${escapeHtml(signature.hash)}` : ''}<br>Documento gerado a partir de um snapshot imutável. Leia o QR Code ou confira o hash no SYSmLab.</div>${
    verificationQr
      ? `<img src="${escapeHtml(verificationQr)}" alt="QR Code para verificar a autenticidade do laudo">`
      : ''
  }</div></footer>
</main></body></html>`;
}

module.exports = { escapeHtml, renderLaudoHtml };
