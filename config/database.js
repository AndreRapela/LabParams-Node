const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { normalizeProductionDatabaseUrl } = require('../utils/databaseTls');
const { safeErrorLogFields } = require('../utils/safeError');

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function loadConfiguredCa() {
  const inlineCa = process.env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
  if (inlineCa) return inlineCa;

  const configuredPath = process.env.DATABASE_SSL_CA_PATH?.trim();
  if (!configuredPath) return null;

  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__dirname, '..', configuredPath);
  return fs.readFileSync(resolvedPath, 'utf8').trim();
}

function buildSslConfig(connectionString) {
  const isProduction = process.env.NODE_ENV === 'production';
  let hostname = null;
  try {
    const parsed = new URL(connectionString);
    if (['postgres:', 'postgresql:'].includes(parsed.protocol)) {
      hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    }
  } catch {
    // Falha fechada: uma URL inválida jamais é tratada como conexão local sem TLS.
  }
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (!isProduction && (isLocal || (hostname && process.env.DATABASE_SSL === 'false'))) {
    return false;
  }

  const configuredCa = loadConfiguredCa();
  if (configuredCa) {
    return { ca: configuredCa, rejectUnauthorized: true };
  }

  return {
    rejectUnauthorized: isProduction
      ? true
      : process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

function buildConnectionString() {
  if (process.env.DATABASE_URL) {
    const configured = process.env.DATABASE_URL.trim().replace(/[\r\n]/g, '');
    return process.env.NODE_ENV === 'production'
      ? normalizeProductionDatabaseUrl(configured)
      : configured;
  }

  if (!process.env.DB_HOST) return null;

  const user = encodeURIComponent(process.env.DB_USER || 'postgres');
  const password = encodeURIComponent(process.env.DB_PASSWORD || '');
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'postgres';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

const connectionString = buildConnectionString();

if (!connectionString) {
  const disconnected = () => {
    const error = new Error('Banco de dados não configurado');
    error.code = 'DATABASE_NOT_CONFIGURED';
    return Promise.reject(error);
  };
  module.exports = { query: disconnected, connect: disconnected };
} else {
  const pool = new Pool({
    connectionString,
    ssl: buildSslConfig(connectionString),
    connectionTimeoutMillis: boundedInteger(
      process.env.DB_CONNECT_TIMEOUT_MS, 5_000, { min: 1_000, max: 60_000 }
    ),
    idleTimeoutMillis: boundedInteger(
      process.env.DB_IDLE_TIMEOUT_MS, 30_000, { min: 1_000, max: 600_000 }
    ),
    statement_timeout: boundedInteger(
      process.env.DB_STATEMENT_TIMEOUT_MS, 30_000, { min: 1_000, max: 600_000 }
    ),
    max: boundedInteger(
      process.env.DB_POOL_MAX, process.env.VERCEL ? 2 : 10, { min: 1, max: 50 }
    ),
    application_name: 'sysmlab-api',
  });

  pool.on('error', (error) => {
    logger.error('database_pool_error', safeErrorLogFields(error));
  });

  module.exports = pool;
}

module.exports.buildSslConfig = buildSslConfig;
module.exports.buildConnectionString = buildConnectionString;
module.exports.normalizeProductionDatabaseUrl = normalizeProductionDatabaseUrl;
