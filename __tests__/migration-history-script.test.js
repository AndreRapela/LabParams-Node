'use strict';

const {
  migrationVersion,
  parseChanges,
  validateHistory,
} = require('../scripts/check-migration-history');

describe('proteção do histórico de migrations', () => {
  const baseFiles = [
    'supabase/migrations/20260726010000_initial_schema.sql',
    'supabase/migrations/20260811010000_secure_defaults.sql',
  ];

  test('aceita somente migration nova com timestamp posterior', () => {
    const result = validateHistory({
      changes: parseChanges('A\tsupabase/migrations/20260811020000_next.sql\n'),
      baseFiles,
    });

    expect(result.errors).toEqual([]);
    expect(result.latestBaseVersion).toBe('20260811010000');
  });

  test('bloqueia alteração e remoção também em push direto', () => {
    const result = validateHistory({
      changes: parseChanges(
        'M\tsupabase/migrations/20260726010000_initial_schema.sql\n'
          + 'D\tsupabase/migrations/20260811010000_secure_defaults.sql\n'
      ),
      baseFiles,
    });

    expect(result.errors.join('\n')).toContain('M\tsupabase/migrations/20260726010000_initial_schema.sql');
    expect(result.errors.join('\n')).toContain('D\tsupabase/migrations/20260811010000_secure_defaults.sql');
  });

  test('bloqueia migration nova retroativa', () => {
    const result = validateHistory({
      changes: parseChanges('A\tsupabase/migrations/20260810000000_late_backfill.sql'),
      baseFiles,
    });

    expect(result.errors).toContain(
      'supabase/migrations/20260810000000_late_backfill.sql: timestamp 20260810000000 deve ser posterior à última migration da base (20260811010000).'
    );
  });

  test('extrai versão de caminhos Windows e rejeita nomes livres', () => {
    expect(migrationVersion('supabase\\migrations\\20260811020000_valid.sql')).toBe('20260811020000');
    expect(migrationVersion('supabase/migrations/manual.sql')).toBeNull();
  });
});
