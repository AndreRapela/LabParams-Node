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

  const valor = valor_medido === null || valor_medido === undefined || valor_medido === ''
    ? Number.NaN
    : Number(valor_medido);
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

const STATUS_OPERACIONAIS = Object.freeze([
  'conforme',
  'alerta',
  'nao-conforme',
  'critico',
  'informativo',
]);
const STATUS_CAPABILITY_TTL_MS = 60_000;
let persistedStatusCapability = null;

function normalizarMargem(valor, fallback, nome) {
  const margem = valor === undefined ? fallback : Number(valor);
  if (!Number.isFinite(margem) || margem < 0 || margem > 1) {
    throw new TypeError(`${nome} deve estar entre 0 e 1.`);
  }
  return margem;
}

/**
 * Taxonomia operacional canônica usada por todos os painéis:
 * - dentro do limite e próximo da borda: alerta;
 * - fora do limite: não conforme;
 * - fora do limite além da margem crítica: crítico.
 */
function avaliarStatusOperacional(dados, {
  margemAlerta = 0.10,
  margemCritica = 0.20,
} = {}) {
  const alerta = normalizarMargem(margemAlerta, 0.10, 'margemAlerta');
  const critica = normalizarMargem(margemCritica, 0.20, 'margemCritica');
  const conformidade = avaliarConformidade(dados);
  if (conformidade === 'informativo') return 'informativo';
  if (dados.tipo_limite === 'ausencia') {
    return conformidade;
  }

  const valor = dados.valor_medido === null
    || dados.valor_medido === undefined
    || dados.valor_medido === ''
    ? Number.NaN
    : Number(dados.valor_medido);
  const minimo = dados.limite_minimo === null || dados.limite_minimo === undefined
    ? null
    : Number(dados.limite_minimo);
  const maximo = dados.limite_maximo === null || dados.limite_maximo === undefined
    ? null
    : Number(dados.limite_maximo);
  if (!Number.isFinite(valor)) return 'informativo';

  if (conformidade === 'nao-conforme') {
    let critico = false;
    if (minimo !== null && maximo !== null && maximo > minimo) {
      const amplitude = maximo - minimo;
      critico = valor < minimo - amplitude * critica
        || valor > maximo + amplitude * critica;
    } else if (maximo !== null && maximo > 0 && valor > maximo) {
      critico = valor > maximo * (1 + critica);
    } else if (minimo !== null && minimo > 0 && valor < minimo) {
      critico = valor < minimo * (1 - critica);
    }
    return critico ? 'critico' : 'nao-conforme';
  }

  if (minimo !== null && maximo !== null && maximo > minimo) {
    const distanciaDaBorda = Math.min(valor - minimo, maximo - valor);
    return distanciaDaBorda <= (maximo - minimo) * alerta ? 'alerta' : 'conforme';
  }
  if (maximo !== null && maximo > 0 && valor >= maximo * (1 - alerta)) {
    return 'alerta';
  }
  if (minimo !== null && minimo > 0 && valor <= minimo * (1 + alerta)) {
    return 'alerta';
  }
  return 'conforme';
}

function avaliarAlertaOperacional(dados, options) {
  const status = avaliarStatusOperacional(dados, options);
  return ['alerta', 'nao-conforme', 'critico'].includes(status) ? status : null;
}

function validarAliasSql(alias) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Alias SQL inválido para classificação operacional.');
  }
  return alias;
}

/**
 * Espelho SQL da função canônica. Ele é usado somente quando a migration que
 * materializa `status_operacional_aplicado` ainda não foi aplicada.
 */
function statusOperacionalSql(alias = 'ra', {
  margemAlerta = 0.10,
  margemCritica = 0.20,
} = {}) {
  const table = validarAliasSql(alias);
  const alerta = normalizarMargem(margemAlerta, 0.10, 'margemAlerta');
  const critica = normalizarMargem(margemCritica, 0.20, 'margemCritica');
  const valor = `${table}.valor_medido`;
  const minimo = `${table}.limite_minimo_aplicado`;
  const maximo = `${table}.limite_maximo_aplicado`;
  const tipo = `${table}.tipo_limite_aplicado`;
  const qualitativo = `translate(lower(trim(coalesce(${table}.valor_qualitativo, ''))), `
    + `'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

  return `(case
    when ${tipo} = 'informativo' then 'informativo'
    when ${tipo} = 'ausencia' then
      case when ${qualitativo} in ('ausente', 'nao detectado', 'negativo')
        then 'conforme' else 'nao-conforme' end
    when ${valor} is null then 'informativo'
    when (${minimo} is not null and ${valor} < ${minimo})
      or (${maximo} is not null and ${valor} > ${maximo}) then
      case
        when ${minimo} is not null and ${maximo} is not null and ${maximo} > ${minimo}
          and (${valor} < ${minimo} - (${maximo} - ${minimo}) * ${critica}
            or ${valor} > ${maximo} + (${maximo} - ${minimo}) * ${critica})
          then 'critico'
        when ${maximo} is not null and ${maximo} > 0
          and ${valor} > ${maximo} * (1 + ${critica}) then 'critico'
        when ${minimo} is not null and ${minimo} > 0
          and ${valor} < ${minimo} * (1 - ${critica}) then 'critico'
        else 'nao-conforme'
      end
    when ${minimo} is not null and ${maximo} is not null and ${maximo} > ${minimo} then
      case when least(${valor} - ${minimo}, ${maximo} - ${valor})
        <= (${maximo} - ${minimo}) * ${alerta}
        then 'alerta' else 'conforme' end
    when ${maximo} is not null and ${maximo} > 0
      and ${valor} >= ${maximo} * (1 - ${alerta}) then 'alerta'
    when ${minimo} is not null and ${minimo} > 0
      and ${valor} <= ${minimo} * (1 + ${alerta}) then 'alerta'
    else 'conforme'
  end)`;
}

async function resolverStatusOperacionalSql(pool, alias = 'ra', options) {
  const table = validarAliasSql(alias);
  const now = Date.now();
  if (!persistedStatusCapability || persistedStatusCapability.expiresAt <= now) {
    const { rows } = await pool.query(`
      select exists (
        select 1
        from pg_catalog.pg_attribute attribute
        join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'resultado_analise'
          and attribute.attname = 'status_operacional_aplicado'
          and attribute.attnum > 0
          and not attribute.attisdropped
      ) as available
    `);
    persistedStatusCapability = {
      available: rows[0]?.available === true || rows[0]?.available === 't',
      expiresAt: now + STATUS_CAPABILITY_TTL_MS,
    };
  }

  return persistedStatusCapability.available
    ? `${table}.status_operacional_aplicado`
    : statusOperacionalSql(table, options);
}

function resetStatusOperacionalCapability() {
  persistedStatusCapability = null;
}

module.exports = {
  STATUS_OPERACIONAIS,
  avaliarAlertaOperacional,
  avaliarConformidade,
  avaliarStatusOperacional,
  normalizarTexto,
  resetStatusOperacionalCapability,
  resolverStatusOperacionalSql,
  statusOperacionalSql,
};
