const { createHash } = require('crypto');
const database = require('../config/database');

const DEFAULT_WINDOW_MS = 10 * 60 * 1_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 10 * 60 * 1_000;
const DEFAULT_CLEANUP_BATCH_SIZE = 1_000;

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

function hashKey(key) {
  return createHash('sha256').update(String(key), 'utf8').digest('hex');
}

function toResetTime(value) {
  const resetTime = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(resetTime.getTime())) {
    throw new Error('O banco retornou uma janela de rate limit inválida.');
  }
  return resetTime;
}

function toTotalHits(value, { allowZero = false } = {}) {
  const totalHits = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(totalHits) || totalHits < minimum) {
    throw new Error('O banco retornou um contador de rate limit inválido.');
  }
  return totalHits;
}

/**
 * Store PostgreSQL para express-rate-limit.
 *
 * As chaves recebidas nunca são persistidas em claro: apenas o SHA-256 é
 * armazenado. O incremento usa um único UPSERT para que instâncias paralelas da
 * API compartilhem a mesma janela sem condições de corrida.
 */
class PostgresRateLimitStore {
  constructor({
    pool = database,
    windowMs = DEFAULT_WINDOW_MS,
    cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
    cleanupBatchSize = DEFAULT_CLEANUP_BATCH_SIZE,
    clock = Date.now,
    logger = console,
  } = {}) {
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('Um pool PostgreSQL com query() é obrigatório.');
    }

    this.pool = pool;
    this.windowMs = positiveInteger(windowMs, DEFAULT_WINDOW_MS, 24 * 60 * 60 * 1_000);
    this.cleanupIntervalMs = cleanupIntervalMs === 0
      ? 0
      : positiveInteger(
        cleanupIntervalMs,
        DEFAULT_CLEANUP_INTERVAL_MS,
        24 * 60 * 60 * 1_000
      );
    this.cleanupBatchSize = positiveInteger(cleanupBatchSize, DEFAULT_CLEANUP_BATCH_SIZE, 10_000);
    this.clock = clock;
    this.logger = logger;
    this.nextCleanupAt = 0;
    this.cleanupPromise = null;

    // Informa ao express-rate-limit que os contadores não são locais ao processo.
    this.localKeys = false;
    this.prefix = 'sysmlab:assinatura:';
  }

  init(options) {
    this.windowMs = positiveInteger(
      options?.windowMs,
      this.windowMs,
      24 * 60 * 60 * 1_000
    );
  }

  async increment(key) {
    await this._cleanupIfDue();
    const keyHash = hashKey(key);
    const { rows } = await this.pool.query(
      `INSERT INTO public.api_rate_limit_counter (key_hash, total_hits, reset_at)
       VALUES ($1, 1, CURRENT_TIMESTAMP + ($2::bigint * INTERVAL '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE
       SET total_hits = CASE
             WHEN public.api_rate_limit_counter.reset_at <= CURRENT_TIMESTAMP THEN 1
             ELSE public.api_rate_limit_counter.total_hits + 1
           END,
           reset_at = CASE
             WHEN public.api_rate_limit_counter.reset_at <= CURRENT_TIMESTAMP
               THEN EXCLUDED.reset_at
             ELSE public.api_rate_limit_counter.reset_at
           END
       RETURNING total_hits, reset_at`,
      [keyHash, this.windowMs]
    );

    const counter = rows?.[0];
    if (!counter) throw new Error('Não foi possível atualizar o rate limit.');

    return {
      totalHits: toTotalHits(counter.total_hits),
      resetTime: toResetTime(counter.reset_at),
    };
  }

  async decrement(key) {
    await this.pool.query(
      `UPDATE public.api_rate_limit_counter
       SET total_hits = GREATEST(total_hits - 1, 0),
           reset_at = CASE
             WHEN total_hits <= 1 THEN CURRENT_TIMESTAMP
             ELSE reset_at
           END
       WHERE key_hash = $1
         AND reset_at > CURRENT_TIMESTAMP`,
      [hashKey(key)]
    );
  }

  async resetKey(key) {
    await this.pool.query(
      'DELETE FROM public.api_rate_limit_counter WHERE key_hash = $1',
      [hashKey(key)]
    );
  }

  async get(key) {
    const { rows } = await this.pool.query(
      `SELECT total_hits, reset_at
       FROM public.api_rate_limit_counter
       WHERE key_hash = $1
         AND reset_at > CURRENT_TIMESTAMP`,
      [hashKey(key)]
    );
    const counter = rows?.[0];
    if (!counter) return undefined;

    return {
      totalHits: toTotalHits(counter.total_hits, { allowZero: true }),
      resetTime: toResetTime(counter.reset_at),
    };
  }

  async cleanupExpired() {
    const result = await this.pool.query(
      `DELETE FROM public.api_rate_limit_counter
       WHERE key_hash IN (
         SELECT key_hash
         FROM public.api_rate_limit_counter
         WHERE reset_at <= CURRENT_TIMESTAMP
         ORDER BY reset_at
         LIMIT $1
       )`,
      [this.cleanupBatchSize]
    );
    return result.rowCount ?? 0;
  }

  async _cleanupIfDue() {
    if (this.cleanupIntervalMs === 0) return;

    const now = this.clock();
    if (now < this.nextCleanupAt) return;
    if (this.cleanupPromise) return this.cleanupPromise;

    this.nextCleanupAt = now + this.cleanupIntervalMs;
    this.cleanupPromise = this.cleanupExpired()
      .catch((error) => {
        this.logger?.warn?.('Falha ao limpar contadores de rate limit expirados.', error);
      })
      .finally(() => {
        this.cleanupPromise = null;
      });
    return this.cleanupPromise;
  }
}

module.exports = PostgresRateLimitStore;
module.exports.hashKey = hashKey;
