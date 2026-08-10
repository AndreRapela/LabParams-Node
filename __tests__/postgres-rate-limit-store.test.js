const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const PostgresRateLimitStore = require('../middleware/PostgresRateLimitStore');

describe('PostgresRateLimitStore', () => {
  test('incrementa atomicamente e persiste somente SHA-256 da chave', async () => {
    const resetAt = new Date('2026-08-02T12:10:00.000Z');
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{ total_hits: '2', reset_at: resetAt }],
      }),
    };
    const store = new PostgresRateLimitStore({
      pool,
      windowMs: 60_000,
      cleanupIntervalMs: 0,
    });

    const result = await store.increment('assinatura-global:user:usuario-real');

    expect(result).toEqual({ totalHits: 2, resetTime: resetAt });
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(key_hash\) DO UPDATE/i);
    expect(params).toEqual([
      createHash('sha256')
        .update('assinatura-global:user:usuario-real', 'utf8')
        .digest('hex'),
      60_000,
    ]);
    expect(sql).not.toContain('usuario-real');
  });

  test('decrementa, consulta e remove pela chave protegida', async () => {
    const resetAt = new Date('2026-08-02T12:10:00.000Z');
    const pool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_hits: '1', reset_at: resetAt }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }),
    };
    const store = new PostgresRateLimitStore({ pool, cleanupIntervalMs: 0 });
    const plainKey = 'assinatura-global:ip:203.0.113.0/56';
    const expectedHash = createHash('sha256').update(plainKey, 'utf8').digest('hex');

    await store.decrement(plainKey);
    await expect(store.get(plainKey)).resolves.toEqual({
      totalHits: 1,
      resetTime: resetAt,
    });
    await store.resetKey(plainKey);

    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(pool.query.mock.calls[0][0]).toMatch(
      /SET total_hits[\s\S]*WHEN total_hits <= 1 THEN CURRENT_TIMESTAMP/i
    );
    for (const [, params] of pool.query.mock.calls) {
      expect(params).toEqual([expectedHash]);
    }
  });

  test('limpa contadores expirados em lote sem bloquear incremento se a limpeza falhar', async () => {
    const warning = jest.fn();
    const pool = {
      query: jest.fn()
        .mockRejectedValueOnce(new Error('falha transitória'))
        .mockResolvedValueOnce({
          rows: [{ total_hits: 1, reset_at: '2026-08-02T12:10:00.000Z' }],
        }),
    };
    const store = new PostgresRateLimitStore({
      pool,
      cleanupIntervalMs: 1_000,
      clock: () => 10_000,
      logger: { warn: warning },
    });

    await expect(store.increment('chave')).resolves.toEqual({
      totalHits: 1,
      resetTime: new Date('2026-08-02T12:10:00.000Z'),
    });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/ORDER BY reset_at[\s\S]*LIMIT \$1/i);
    expect(pool.query.mock.calls[0][1]).toEqual([1_000]);
  });

  test('migration protege a tabela interna e indexa a expiração', () => {
    const migration = fs.readFileSync(path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260730030000_operational_hardening.sql'
    ), 'utf8');

    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/force row level security/i);
    expect(migration).toMatch(/revoke all[\s\S]*anon, authenticated/i);
    expect(migration).toMatch(/create index[\s\S]*reset_at/i);
  });
});
