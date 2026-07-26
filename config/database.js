const { Pool } = require('pg');

function buildConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.trim().replace(/[\r\n]/g, '');
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
  const disconnected = () => Promise.reject(new Error('Banco de dados não configurado'));
  module.exports = { query: disconnected, connect: disconnected };
} else {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const useSsl = process.env.DATABASE_SSL !== 'false' && !isLocal;
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5_000,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30_000,
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 30_000,
    max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 2 : 10),
    application_name: 'sysmlab-api',
  });

  pool.on('error', (error) => {
    console.error('Erro inesperado no pool PostgreSQL:', error.message);
  });

  module.exports = pool;
}
