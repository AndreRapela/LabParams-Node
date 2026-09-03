'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildExpectedSchema,
  parseCreateIndex,
  splitSqlStatements,
} = require('../scripts/lib/migration-analysis');
const { validateMigrations } = require('../scripts/check-migrations');

const fixtureDirectory = path.resolve(__dirname, 'fixtures', 'migrations');

function fixture(name, file = `20260812000000_${name}.sql`) {
  const sql = fs.readFileSync(path.join(fixtureDirectory, `${name}.sql`), 'utf8');
  return { file, sql, buffer: Buffer.from(sql) };
}

describe('segurança estática das migrations', () => {
  test('aceita identificadores entre aspas, tabela unlogged e função com dollar tag', () => {
    const result = validateMigrations([fixture('safe_quoted')]);

    expect(result.errors).toEqual([]);
    expect(result.expected.tables.has('public.safe_table')).toBe(true);
    expect(result.expected.functions.has('public.secure_fn()')).toBe(true);
  });

  test('comentários não conseguem simular RLS ou REVOKE', () => {
    const result = validateMigrations([fixture('comment_bypass')]);

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('sem habilitar RLS'),
      expect.stringContaining('anon não foi revogado'),
      expect.stringContaining('authenticated não foi revogado'),
    ]));
  });

  test('bloqueia DELETE mesmo quando a migration está transacionada', () => {
    const result = validateMigrations([fixture('destructive')]);

    expect(result.errors).toContain(
      '20260812000000_destructive.sql: operação destrutiva bloqueada (DELETE FROM).'
    );
  });

  test('bloqueia DELETE escondido em CTE e bloco DO não analisável', () => {
    const sql = `begin;
      with removed as (delete from public.resultado_analise returning id) select count(*) from removed;
      do $body$ begin execute 'drop table public.usuario'; end $body$;
      commit;`;
    const result = validateMigrations([{
      file: '20260812000002_hidden_destructive.sql', sql, buffer: Buffer.from(sql),
    }]);

    expect(result.errors).toEqual(expect.arrayContaining([
      '20260812000002_hidden_destructive.sql: operação destrutiva bloqueada (DELETE FROM).',
      '20260812000002_hidden_destructive.sql: operação destrutiva bloqueada (EXECUTE dinâmico em bloco DO).',
    ]));
  });

  test('bloqueia SECURITY DEFINER sem search_path vazio em caixa alta', () => {
    const sql = `
      BEGIN;
      CREATE FUNCTION public.unsafe_fn() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER AS $body$ BEGIN RETURN NEW; END $body$;
      REVOKE EXECUTE ON FUNCTION public.unsafe_fn() FROM public, anon, authenticated;
      COMMIT;
    `;
    const result = validateMigrations([{
      file: '20260812000001_unsafe_function.sql',
      sql,
      buffer: Buffer.from(sql),
    }]);

    expect(result.errors).toContain(
      "20260812000001_unsafe_function.sql: public.unsafe_fn() usa SECURITY DEFINER sem SET search_path = ''."
    );
  });

  test('detecta literais e blocos SQL não encerrados', () => {
    const parsed = splitSqlStatements("begin; select 'segredo; commit;");
    expect(parsed.errors).toContain('literal de texto não foi encerrado');
  });

  test('estado esperado remove índice descartado e mantém a definição substituta', () => {
    const migrations = [{
      file: 'one.sql',
      sql: `begin;
        create index old_idx on public.resultado_analise (datacoleta);
        drop index public.old_idx;
        create unique index new_idx on public.resultado_analise (parametro_id, datacoleta desc)
          where deleted_at is null;
        commit;`,
    }];
    const expected = buildExpectedSchema(migrations);

    expect(expected.indexes.has('public.old_idx')).toBe(false);
    expect(expected.indexes.get('public.new_idx')).toEqual(expect.objectContaining({
      unique: true,
      tableName: 'resultado_analise',
      keys: ['parametro_id', 'datacoleta desc'],
      predicate: 'deleted_at is null',
    }));
    expect(parseCreateIndex('CREATE INDEX x ON public.t USING btree (id DESC)')).toEqual(
      expect.objectContaining({ method: 'btree', keys: ['id desc'] })
    );
  });

  test('aceita migration não transacional somente para índice concorrente retomável', () => {
    const sql = `
      set lock_timeout = '5s';
      create index concurrently if not exists safe_concurrent_idx on public.resultado_analise (id);
      do $$ begin if to_regclass('public.safe_concurrent_idx') is null then raise exception 'missing'; end if; end $$;
      comment on index public.safe_concurrent_idx is 'Índice aplicado em janela controlada';
    `;
    const result = validateMigrations([{
      file: '20260812000003_concurrent_index.sql', sql, buffer: Buffer.from(sql),
    }]);
    expect(result.errors).toEqual([]);
  });

  test('reprova mistura de índice concorrente com DML ou transação explícita', () => {
    const sql = `begin;
      create index concurrently unsafe_idx on public.resultado_analise (id);
      update public.usuario set perfil = 'Gestor' where id is not null;
      commit;`;
    const result = validateMigrations([{
      file: '20260812000004_unsafe_concurrent.sql', sql, buffer: Buffer.from(sql),
    }]);
    const errors = result.errors.join('\n');
    expect(errors).toContain('não pode estar dentro de transação explícita');
    expect(errors).toContain('deve usar IF NOT EXISTS');
    expect(errors).toContain('migration não transacional contém operação não permitida: update public.usuario');
  });

  test('reprova mutação escondida em bloco DO de migration concorrente', () => {
    const result = validateMigrations([fixture(
      'unsafe_concurrent_do',
      '20260812000005_unsafe_concurrent_do.sql'
    )]);
    const errors = result.errors.join('\n');

    expect(errors).toContain(
      'migration não transacional contém bloco DO mutável (DML em bloco DO (INSERT INTO))'
    );
    expect(errors).toContain(
      'operação destrutiva bloqueada (DML em bloco DO (INSERT INTO))'
    );
    expect(errors).toContain(
      'migration não transacional contém bloco DO mutável (privilégio/sessão alterado em bloco DO (GRANT))'
    );
    expect(errors).toContain(
      'migration não transacional contém bloco DO mutável (DDL em bloco DO (CREATE))'
    );
  });
});
