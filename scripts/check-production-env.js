'use strict';

const fs = require('fs');
const path = require('path');
const { databaseUrlQueryIssues } = require('../utils/databaseTls');

require('dotenv').config({ quiet: true });

function nodeMajor(version = process.versions.node) {
  return Number(String(version).split('.')[0]);
}

function projectRefFromSupabaseUrl(parsed) {
  return parsed?.hostname.match(/^([a-z0-9]{8,})\.supabase\.co$/i)?.[1]?.toLowerCase() || null;
}

function projectRefFromDatabase(parsed, fallbackUser = '') {
  if (!parsed) return null;
  const direct = parsed.hostname.match(/^db\.([a-z0-9]{8,})\.supabase\.co$/i);
  if (direct) return direct[1].toLowerCase();
  if (/\.pooler\.supabase\.com$/i.test(parsed.hostname)) {
    const username = decodeURIComponent(parsed.username || fallbackUser || '');
    return username.match(/^postgres\.([a-z0-9]{8,})$/i)?.[1]?.toLowerCase() || null;
  }
  return null;
}

function legacyJwtRole(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function hasExpectedSupabaseKeyClass(value, { modernPrefix, legacyRole }) {
  const key = String(value || '').trim();
  if (new RegExp(`^${modernPrefix}[A-Za-z0-9_-]+$`).test(key)) return true;
  return legacyJwtRole(key) === legacyRole;
}

function validateProductionEnv(env = process.env, {
  existsSync = fs.existsSync,
  runtimeVersion = process.versions.node,
} = {}) {
  const failures = [];
  const warnings = [];

  function required(name) {
    const value = env[name]?.trim();
    if (!value) failures.push(`${name} não definida`);
    return value || '';
  }

  function rejectPlaceholder(name, value) {
    if (/seu[-_. ]|sua[-_. ]|exemplo|example|changeme|usuario:senha|admin123|laborat[oó]rio emissor/i.test(value)) {
      failures.push(`${name} ainda contém placeholder ou credencial insegura`);
    }
  }

  function secureUrl(name, { allowPath = true } = {}) {
    const value = required(name);
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') failures.push(`${name} deve usar HTTPS`);
      if (!allowPath && parsed.pathname !== '/') failures.push(`${name} não deve conter caminho`);
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(parsed.hostname)) {
        failures.push(`${name} aponta para host local`);
      }
      return parsed;
    } catch {
      failures.push(`${name} não é uma URL válida`);
      return null;
    }
  }

  if (env.NODE_ENV !== 'production') failures.push('NODE_ENV deve ser production');
  const major = nodeMajor(runtimeVersion);
  if (!Number.isInteger(major) || major < 22 || major >= 25) {
    failures.push('Node.js deve estar na versão >=22 e <25');
  }

  let databaseUrl = null;
  const rawDatabaseUrl = env.DATABASE_URL?.trim();
  if (rawDatabaseUrl) {
    rejectPlaceholder('DATABASE_URL', rawDatabaseUrl);
    try {
      databaseUrl = new URL(rawDatabaseUrl);
      if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
        failures.push('DATABASE_URL deve usar postgres:// ou postgresql://');
      }
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(databaseUrl.hostname)) {
        failures.push('DATABASE_URL aponta para host local');
      }
      failures.push(...databaseUrlQueryIssues(databaseUrl, { rejectUnknown: true }));
    } catch {
      failures.push('DATABASE_URL inválida');
    }
  } else {
    for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
      rejectPlaceholder(name, required(name));
    }
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(env.DB_HOST?.trim() || '')) {
      failures.push('DB_HOST aponta para host local');
    }
    try {
      if (env.DB_HOST?.trim()) {
        databaseUrl = new URL(
          `postgresql://${encodeURIComponent(env.DB_USER || '')}@${env.DB_HOST.trim()}:${env.DB_PORT || '5432'}/x`
        );
      }
    } catch {
      failures.push('DB_HOST/DB_PORT inválidos');
    }
  }

  if (env.DATABASE_SSL === 'false') failures.push('DATABASE_SSL não pode ser false');
  if (env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false') {
    failures.push('DATABASE_SSL_REJECT_UNAUTHORIZED não pode ser false');
  }
  const caPath = env.DATABASE_SSL_CA_PATH?.trim();
  if (caPath) {
    const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(__dirname, '..', caPath);
    if (!existsSync(resolved)) failures.push('DATABASE_SSL_CA_PATH não existe');
  }

  const supabaseUrl = secureUrl('SUPABASE_URL', { allowPath: false });
  const jwksUrl = secureUrl('SUPABASE_JWKS_URL');
  if (supabaseUrl && jwksUrl && supabaseUrl.origin !== jwksUrl.origin) {
    failures.push('SUPABASE_JWKS_URL deve pertencer ao mesmo projeto de SUPABASE_URL');
  }
  if (jwksUrl && !jwksUrl.pathname.endsWith('/auth/v1/.well-known/jwks.json')) {
    failures.push('SUPABASE_JWKS_URL não aponta para o endpoint JWKS esperado');
  }

  const adminKey = (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!adminKey) failures.push('SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY não definida');
  else {
    rejectPlaceholder('chave administrativa Supabase', adminKey);
    if (!hasExpectedSupabaseKeyClass(adminKey, {
      modernPrefix: 'sb_secret_', legacyRole: 'service_role',
    })) {
      failures.push('chave administrativa Supabase não é Secret nem JWT service_role legado');
    }
  }
  const publicKey = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  if (!publicKey) failures.push('SUPABASE_PUBLISHABLE_KEY ou SUPABASE_ANON_KEY não definida');
  else {
    rejectPlaceholder('chave pública Supabase', publicKey);
    if (!hasExpectedSupabaseKeyClass(publicKey, {
      modernPrefix: 'sb_publishable_', legacyRole: 'anon',
    })) {
      failures.push('chave pública Supabase não é Publishable nem JWT anon legado');
    }
  }
  if (adminKey && publicKey && adminKey === publicKey) {
    failures.push('chave administrativa e chave pública Supabase não podem ser iguais');
  }
  if (!env.SUPABASE_PUBLISHABLE_KEY?.trim() && env.SUPABASE_ANON_KEY?.trim()
    && !env.SUPABASE_JWT_SECRET?.trim()) {
    failures.push('SUPABASE_JWT_SECRET é obrigatório ao usar somente SUPABASE_ANON_KEY legada');
  }

  secureUrl('PUBLIC_APP_URL', { allowPath: false });
  const origins = required('CORS_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) failures.push('CORS_ORIGINS não contém nenhuma origem');
  origins.forEach((origin, index) => {
    if (origin === '*') {
      failures.push(`CORS_ORIGINS entrada ${index + 1} não pode ser wildcard`);
      return;
    }
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
        failures.push(`CORS_ORIGINS entrada ${index + 1} deve ser origem HTTPS sem caminho`);
      }
    } catch {
      failures.push(`CORS_ORIGINS entrada ${index + 1} é inválida`);
    }
  });

  for (const name of ['LAB_NOME', 'LAB_DOCUMENTO', 'LAB_ENDERECO', 'LAB_CONTATO']) {
    rejectPlaceholder(name, required(name));
  }

  for (const [name, min, max] of [
    ['RATE_LIMIT_MAX', 1, 10_000],
    ['SIGNATURE_RATE_LIMIT_MAX', 1, 20],
    ['SIGNATURE_RATE_LIMIT_WINDOW_MS', 60_000, 3_600_000],
    ['SIGNATURE_TIMEOUT_MS', 1_000, 15_000],
    ['DB_POOL_MAX', 1, 50],
  ]) {
    const raw = required(name);
    const value = Number(raw);
    if (raw && (!Number.isInteger(value) || value < min || value > max)) {
      failures.push(`${name} deve ser inteiro entre ${min} e ${max}`);
    }
  }

  const authRef = projectRefFromSupabaseUrl(supabaseUrl);
  const databaseRef = projectRefFromDatabase(databaseUrl, env.DB_USER);
  if (authRef && databaseRef && authRef !== databaseRef) {
    failures.push('banco PostgreSQL e SUPABASE_URL apontam para projetos diferentes');
  } else if (authRef && !databaseRef) {
    warnings.push('não foi possível comprovar automaticamente que o banco pertence ao projeto Supabase');
  }

  return { failures: [...new Set(failures)], warnings: [...new Set(warnings)] };
}

function runCli() {
  const result = validateProductionEnv();
  if (result.failures.length > 0) {
    console.error(`Pré-flight de produção reprovado (${result.failures.length}):`);
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  for (const warning of result.warnings) console.warn(`Aviso: ${warning}.`);
  console.log('Pré-flight de produção aprovado; nenhum valor sensível foi exibido.');
}

if (require.main === module) runCli();

module.exports = {
  hasExpectedSupabaseKeyClass,
  legacyJwtRole,
  nodeMajor,
  projectRefFromDatabase,
  projectRefFromSupabaseUrl,
  runCli,
  validateProductionEnv,
};
