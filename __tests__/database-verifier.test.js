'use strict';

const { buildExpectedSchema } = require('../scripts/lib/migration-analysis');
const {
  canonicalMigrationStatements,
  evaluateDatabaseSnapshot,
  hasEmptySearchPath,
  indexDifference,
  withReadOnlyClient,
} = require('../scripts/verify-database');

const migrationSql = `
begin;
create table public.sample (id bigint primary key, status text, deleted_at timestamptz);
create or replace function public.guard_sample()
returns trigger language plpgsql security definer set search_path = ''
as $body$ begin return new; end; $body$;
create trigger guard_sample_trigger before update or delete on public.sample
for each row execute function public.guard_sample();
create index sample_active_idx on public.sample (status, id desc)
where deleted_at is null;
commit;
`;

const localMigrations = [{
  file: '20260812000000_verify_fixture.sql',
  version: '20260812000000',
  sql: migrationSql,
}];
const expected = buildExpectedSchema(localMigrations);

function validSnapshot() {
  return {
    migrations: [{
      version: '20260812000000',
      statements: canonicalMigrationStatements(migrationSql),
    }],
    relations: [{
      schema_name: 'public',
      object_name: 'sample',
      object_kind: 'r',
      rls_enabled: true,
      rls_forced: false,
      exposed_to_api: false,
      is_owned_sequence: false,
    }],
    triggers: [{
      table_schema: 'public',
      table_name: 'sample',
      trigger_name: 'guard_sample_trigger',
      enabled_state: 'O',
      trigger_type: 27, // ROW + BEFORE + UPDATE + DELETE
      is_constraint: false,
      function_schema: 'public',
      function_name: 'guard_sample',
    }],
    indexes: [{
      index_schema: 'public',
      index_name: 'sample_active_idx',
      table_schema: 'public',
      table_name: 'sample',
      is_valid: true,
      is_ready: true,
      is_constraint_backed: false,
      index_definition: 'CREATE INDEX sample_active_idx ON public.sample USING btree (status, id DESC) WHERE (deleted_at IS NULL)',
    }],
    functions: [{
      function_schema: 'public',
      function_name: 'guard_sample',
      identity_arguments: '',
      security_definer: true,
      configuration: ['search_path=""'],
      exposed_to_api: false,
    }],
    defaultPrivileges: [
      { owner_name: 'postgres', object_type: 'r', exposed_grants: 0 },
      { owner_name: 'postgres', object_type: 'S', exposed_grants: 0 },
      { owner_name: 'postgres', object_type: 'f', exposed_grants: 0 },
    ],
    integrity: {
      duplicate_active_results: 0,
      results_outside_sample_scope: 0,
      reports_without_signature: 0,
    },
    transport: { ssl: true, server_version: '17.5' },
  };
}

function evaluate(snapshot, environment = {}) {
  return evaluateDatabaseSnapshot({ expected, localMigrations, snapshot, environment });
}

describe('verificador semântico do banco', () => {
  test('aprova snapshot estrutural e semanticamente equivalente', () => {
    const result = evaluate(validSnapshot());
    expect(result.failures).toEqual([]);
    expect(result.report.status).toBe('OK');
    expect(result.report.migration_contents_checked).toBe('1/1');
  });

  test('reprova trigger desabilitado, com função e eventos divergentes', () => {
    const snapshot = validSnapshot();
    Object.assign(snapshot.triggers[0], {
      enabled_state: 'D',
      trigger_type: 5, // ROW + INSERT
      function_name: 'wrong_guard',
    });

    const failures = evaluate(snapshot).failures.join('\n');
    expect(failures).toContain('não está habilitado');
    expect(failures).toContain('função do trigger diverge');
    expect(failures).toContain('eventos/timing do trigger divergem');
  });

  test('reprova colisão de índice IF NOT EXISTS com definição errada', () => {
    const snapshot = validSnapshot();
    snapshot.indexes[0].index_definition =
      'CREATE UNIQUE INDEX sample_active_idx ON public.sample USING btree (id)';

    expect(evaluate(snapshot).failures.join('\n')).toContain(
      'public.sample_active_idx: definição divergente'
    );
  });

  test('não esconde overload público atrás de função segura', () => {
    const snapshot = validSnapshot();
    snapshot.functions.push({
      ...snapshot.functions[0],
      identity_arguments: 'value integer',
      exposed_to_api: true,
    });

    const failures = evaluate(snapshot).failures.join('\n');
    expect(failures).toContain('public.guard_sample(integer): função pública inesperada e executável pela API');
  });

  test('detecta objeto inesperado, grant, default ACL e ausência de TLS', () => {
    const snapshot = validSnapshot();
    snapshot.relations.push({
      schema_name: 'public', object_name: 'leaked', object_kind: 'r',
      rls_enabled: false, rls_forced: false, exposed_to_api: true, is_owned_sequence: false,
    });
    snapshot.defaultPrivileges[0].exposed_grants = 1;
    snapshot.transport.ssl = false;

    expect(evaluate(snapshot).failures).toEqual(expect.arrayContaining([
      'public.leaked: objeto público inesperado (r)',
      'public.leaked: privilégio direto para public/anon/authenticated',
      'privilégios padrão do owner postgres expõem futuros objetos r',
      'conexão com o banco sem TLS',
    ]));
  });

  test('detecta migration aplicada com conteúdo alterado e mistura de projetos', () => {
    const snapshot = validSnapshot();
    snapshot.migrations[0].statements = ['create table public.other(id int)'];
    const environment = {
      SUPABASE_URL: 'https://abcdefghijk.supabase.co',
      DATABASE_URL: 'postgresql://postgres:x@db.zzzzzzzzzzz.supabase.co/postgres',
    };

    expect(evaluate(snapshot, environment).failures).toEqual(expect.arrayContaining([
      '20260812000000: conteúdo local diverge da migration aplicada',
      'banco PostgreSQL e SUPABASE_URL apontam para projetos diferentes',
    ]));
  });

  test('normaliza search_path e compara semântica de índice', () => {
    expect(hasEmptySearchPath(['search_path=""'])).toBe(true);
    expect(hasEmptySearchPath(['search_path=public'])).toBe(false);
    expect(indexDifference(
      expected.indexes.get('public.sample_active_idx'),
      expected.indexes.get('public.sample_active_idx')
    )).toEqual([]);
  });

  test('executa coleta dentro de transação somente leitura e sempre libera conexão', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const databasePool = { connect: jest.fn().mockResolvedValue(client) };
    const operation = jest.fn().mockResolvedValue('ok');

    await expect(withReadOnlyClient(databasePool, operation)).resolves.toBe('ok');
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'begin transaction read only',
      'rollback',
    ]);
    expect(operation).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
