'use strict';

const SAFE_SSL_MODES = new Set(['verify-full', 'verify-ca']);
const ALLOWED_DATABASE_QUERY_PARAMETERS = new Set([
  'sslmode',
  'application_name',
  'connect_timeout',
  'keepalives',
  'keepalives_idle',
  'target_session_attrs',
]);

function databaseUrlQueryIssues(parsed, { rejectUnknown = false } = {}) {
  const issues = [];
  const entries = [...(parsed?.searchParams?.entries?.() || [])];
  const sslModes = entries
    .filter(([name]) => String(name).trim().toLowerCase() === 'sslmode')
    .map(([, value]) => String(value).trim().toLowerCase());

  if (sslModes.length > 1) issues.push('DATABASE_URL contém sslmode duplicado');
  if (sslModes.some((mode) => !SAFE_SSL_MODES.has(mode))) {
    issues.push('DATABASE_URL deve usar apenas sslmode=verify-full ou sslmode=verify-ca');
  }

  for (const [rawName] of entries) {
    const name = String(rawName).trim().toLowerCase();
    if (name === 'sslmode') continue;
    if (name.startsWith('ssl') || name === 'uselibpqcompat') {
      issues.push('DATABASE_URL contém parâmetro TLS não permitido');
    } else if (rejectUnknown && !ALLOWED_DATABASE_QUERY_PARAMETERS.has(name)) {
      issues.push('DATABASE_URL contém parâmetro de conexão não permitido');
    }
  }

  return [...new Set(issues)];
}

function normalizeProductionDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    const error = new Error('DATABASE_URL inválida');
    error.code = 'INVALID_DATABASE_URL';
    throw error;
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    const error = new Error('DATABASE_URL deve usar o protocolo PostgreSQL');
    error.code = 'INVALID_DATABASE_URL';
    throw error;
  }

  const issues = databaseUrlQueryIssues(parsed);
  if (issues.length) {
    const error = new Error('DATABASE_URL contém configuração TLS não permitida');
    error.code = 'INSECURE_DATABASE_URL';
    throw error;
  }

  // node-postgres aplica os parâmetros da connectionString depois da opção
  // `ssl`. Remover sslmode impede que até um modo aceito substitua CA/opções
  // explícitas do runtime; buildSslConfig permanece a única fonte de TLS.
  for (const [name] of [...parsed.searchParams.entries()]) {
    if (String(name).trim().toLowerCase() === 'sslmode') parsed.searchParams.delete(name);
  }
  return parsed.toString();
}

module.exports = {
  ALLOWED_DATABASE_QUERY_PARAMETERS,
  SAFE_SSL_MODES,
  databaseUrlQueryIssues,
  normalizeProductionDatabaseUrl,
};
