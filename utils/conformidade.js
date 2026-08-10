function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function avaliarConformidade({
  valor_medido,
  valor_qualitativo,
  limite_minimo,
  limite_maximo,
  tipo_limite,
}) {
  if (tipo_limite === 'informativo') return 'informativo';

  if (tipo_limite === 'ausencia') {
    const valor = normalizarTexto(valor_qualitativo);
    return ['ausente', 'nao detectado', 'negativo'].includes(valor)
      ? 'conforme'
      : 'nao-conforme';
  }

  const valor = Number(valor_medido);
  if (!Number.isFinite(valor)) return 'informativo';

  const minimo = limite_minimo === null || limite_minimo === undefined
    ? null
    : Number(limite_minimo);
  const maximo = limite_maximo === null || limite_maximo === undefined
    ? null
    : Number(limite_maximo);

  if ((minimo !== null && valor < minimo) || (maximo !== null && valor > maximo)) {
    return 'nao-conforme';
  }

  return 'conforme';
}

function avaliarStatusOperacional(dados) {
  const conformidade = avaliarConformidade(dados);
  if (conformidade !== 'conforme') return conformidade;
  if (dados.tipo_limite === 'ausencia') return 'conforme';

  const valor = Number(dados.valor_medido);
  const minimo = dados.limite_minimo === null || dados.limite_minimo === undefined
    ? null
    : Number(dados.limite_minimo);
  const maximo = dados.limite_maximo === null || dados.limite_maximo === undefined
    ? null
    : Number(dados.limite_maximo);

  if (!Number.isFinite(valor)) return 'informativo';

  if (minimo !== null && maximo !== null && maximo > minimo) {
    const distancia = Math.min(valor - minimo, maximo - valor) / (maximo - minimo);
    if (distancia <= 0.05) return 'critico';
    if (distancia <= 0.15) return 'alerta';
    return 'conforme';
  }

  if (maximo !== null && maximo > 0) {
    const proporcao = valor / maximo;
    if (proporcao >= 0.95) return 'critico';
    if (proporcao >= 0.8) return 'alerta';
  }

  if (minimo !== null && minimo > 0) {
    const proporcao = valor / minimo;
    if (proporcao <= 1.05) return 'critico';
    if (proporcao <= 1.2) return 'alerta';
  }

  return 'conforme';
}

module.exports = { avaliarConformidade, avaliarStatusOperacional, normalizarTexto };
