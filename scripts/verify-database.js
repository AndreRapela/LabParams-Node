'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true });

const pool = require('../config/database');
const { safeDatabaseFailureMessage } = require('../utils/safeError');
const {
  buildExpectedSchema,
  canonicalSqlFragment,
  normalizeIdentityArguments,
  parseCreateIndex,
  qualifiedKey,
  splitSqlStatements,
} = require('./lib/migration-analysis');
const {
  projectRefFromDatabase,
  projectRefFromSupabaseUrl,
} = require('./check-production-env');

const migrationsDirectory = path.resolve(__dirname, '..', 'supabase', 'migrations');

function loadLocalMigrations(directory = migrationsDirectory) {
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(directory, file), 'utf8');
      const version = file.match(/^(\d{14})_[a-z0-9_]+\.sql$/i)?.[1];
      return { file, version, sql };
    })
    .filter(({ version }) => Boolean(version));
}

function canonicalMigrationStatements(sqlOrStatements) {
  const values = Array.isArray(sqlOrStatements) ? sqlOrStatements : [sqlOrStatements];
  return values.flatMap((value) => splitSqlStatements(String(value || '')).statements)
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter((statement) => !/^(?:begin(?:\s+transaction)?|commit)$/i.test(statement));
}

function migrationDigest(sqlOrStatements) {
  const canonical = canonicalMigrationStatements(sqlOrStatements).join(';\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function difference(expected, actual) {
  return [...expected].filter((item) => !actual.has(item)).sort();
}

function triggerSemantics(row) {
  const type = Number(row.trigger_type);
  const events = [];
  if (type & 4) events.push('insert');
  if (type & 8) events.push('delete');
  if (type & 16) events.push('update');
  if (type & 32) events.push('truncate');
  return {
    timing: type & 64 ? 'instead of' : (type & 2 ? 'before' : 'after'),
    events: events.sort(),
    rowLevel: Boolean(type & 1),
  };
}

function hasEmptySearchPath(configuration) {
  const values = Array.isArray(configuration)
    ? configuration
    : String(configuration || '').replace(/^\{|}$/g, '').split(',');
  return values.some((entry) => {
    const match = String(entry).match(/^search_path=(.*)$/i);
    if (!match) return false;
    return ['', "''", '""'].includes(match[1].trim());
  });
}

function indexDifference(expected, actual) {
  const differences = [];
  for (const property of ['tableSchema', 'tableName', 'unique', 'method']) {
    if (expected[property] !== actual[property]) differences.push(property);
  }
  if (expected.keys.length !== actual.keys.length
    || expected.keys.some((key, index) => canonicalSqlFragment(key) !== canonicalSqlFragment(actual.keys[index]))) {
    differences.push('chaves/ordem');
  }
  if (canonicalPredicate(expected.predicate) !== canonicalPredicate(actual.predicate)) {
    differences.push('predicado');
  }
  return differences;
}

function canonicalPredicate(value = '') {
  let normalized = canonicalSqlFragment(value);
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(
      /\(([^()]*(?:\bis\b|\bin\b|\blike\b|=|<>|<=|>=|<|>)[^()]*)\)/gi,
      '$1'
    );
  } while (normalized !== previous);
  return normalized;
}

function configuredProjectRefs(environment) {
  let authUrl = null;
  let databaseUrl = null;
  try {
    if (environment.SUPABASE_URL) authUrl = new URL(environment.SUPABASE_URL);
  } catch { /* check-production-env fornece a mensagem detalhada. */ }
  try {
    if (environment.DATABASE_URL) {
      databaseUrl = new URL(environment.DATABASE_URL);
    } else if (environment.DB_HOST) {
      databaseUrl = new URL(
        `postgresql://${encodeURIComponent(environment.DB_USER || '')}@${environment.DB_HOST}:${environment.DB_PORT || '5432'}/x`
      );
    }
  } catch { /* check-production-env fornece a mensagem detalhada. */ }
  return {
    auth: projectRefFromSupabaseUrl(authUrl),
    database: projectRefFromDatabase(databaseUrl, environment.DB_USER),
  };
}

function relationExpectedKeys(expected) {
  return new Set([
    ...expected.tables.keys(),
    ...expected.views.keys(),
    ...expected.sequences.keys(),
  ]);
}

function evaluateDatabaseSnapshot({ expected, localMigrations, snapshot, environment = process.env }) {
  const failures = [];
  const warnings = [];

  const remoteMigrationMap = new Map(
    snapshot.migrations.map((row) => [String(row.version), row])
  );
  const localMigrationMap = new Map(localMigrations.map((migration) => [migration.version, migration]));
  const missingMigrations = difference(new Set(localMigrationMap.keys()), new Set(remoteMigrationMap.keys()));
  const unknownMigrations = difference(new Set(remoteMigrationMap.keys()), new Set(localMigrationMap.keys()));
  if (missingMigrations.length) failures.push(`migrations não aplicadas: ${missingMigrations.join(', ')}`);
  if (unknownMigrations.length) failures.push(`migrations remotas ausentes no repositório: ${unknownMigrations.join(', ')}`);

  let checkedMigrationContents = 0;
  for (const [version, local] of localMigrationMap) {
    const remote = remoteMigrationMap.get(version);
    if (!remote || !Array.isArray(remote.statements) || remote.statements.length === 0) continue;
    checkedMigrationContents += 1;
    if (migrationDigest(local.sql) !== migrationDigest(remote.statements)) {
      failures.push(`${version}: conteúdo local diverge da migration aplicada`);
    }
  }
  if (checkedMigrationContents < remoteMigrationMap.size) {
    warnings.push('o servidor não disponibilizou conteúdo para conferir todas as migrations por hash');
  }

  const relations = new Map(snapshot.relations.map((row) => [
    qualifiedKey(row.schema_name, row.object_name), row,
  ]));
  const expectedRelationKeys = relationExpectedKeys(expected);
  const tableKinds = new Set(['r', 'p']);
  const viewKinds = new Set(['v', 'm', 'f']);

  for (const key of expected.tables.keys()) {
    const relation = relations.get(key);
    if (!relation || !tableKinds.has(relation.object_kind)) {
      failures.push(`${key}: tabela ausente`);
      continue;
    }
    if (!relation.rls_enabled) failures.push(`${key}: RLS desabilitado`);
  }
  for (const [key, view] of expected.views) {
    const relation = relations.get(key);
    const expectedKind = view.materialized ? 'm' : 'v';
    if (!relation || relation.object_kind !== expectedKind) {
      failures.push(`${key}: ${view.materialized ? 'materialized view' : 'view'} ausente ou com tipo divergente`);
    }
  }
  for (const key of expected.sequences.keys()) {
    if (relations.get(key)?.object_kind !== 'S') failures.push(`${key}: sequence ausente`);
  }
  if (expected.tables.has('public.api_rate_limit_counter')
    && !relations.get('public.api_rate_limit_counter')?.rls_forced) {
    failures.push('public.api_rate_limit_counter: FORCE ROW LEVEL SECURITY não está ativo');
  }

  for (const row of snapshot.relations) {
    const key = qualifiedKey(row.schema_name, row.object_name);
    const isUnexpectedTableOrView = (tableKinds.has(row.object_kind) || viewKinds.has(row.object_kind))
      && !expectedRelationKeys.has(key);
    const isUnexpectedStandaloneSequence = row.object_kind === 'S' && !row.is_owned_sequence
      && !expected.sequences.has(key);
    if (isUnexpectedTableOrView || isUnexpectedStandaloneSequence) {
      failures.push(`${key}: objeto público inesperado (${row.object_kind})`);
    }
    if (row.exposed_to_api) failures.push(`${key}: privilégio direto para public/anon/authenticated`);
  }

  const triggers = new Map(snapshot.triggers.map((row) => [
    `${qualifiedKey(row.table_schema, row.table_name)}.${String(row.trigger_name).toLowerCase()}`,
    row,
  ]));
  for (const [key, trigger] of expected.triggers) {
    const remote = triggers.get(key);
    if (!remote) {
      failures.push(`${key}: trigger ausente`);
      continue;
    }
    const semantics = triggerSemantics(remote);
    if (remote.enabled_state !== 'O') failures.push(`${key}: trigger não está habilitado no modo normal`);
    if (String(remote.function_schema).toLowerCase() !== trigger.functionSchema
      || String(remote.function_name).toLowerCase() !== trigger.functionName) {
      failures.push(`${key}: função do trigger diverge da migration`);
    }
    if (semantics.timing !== trigger.timing
      || semantics.rowLevel !== trigger.rowLevel
      || semantics.events.join(',') !== trigger.events.join(',')) {
      failures.push(`${key}: eventos/timing do trigger divergem da migration`);
    }
    if (Boolean(remote.is_constraint) !== trigger.constraint) {
      failures.push(`${key}: natureza constraint do trigger diverge da migration`);
    }
  }
  for (const key of triggers.keys()) {
    if (!expected.triggers.has(key)) failures.push(`${key}: trigger público inesperado`);
  }

  const indexes = new Map(snapshot.indexes.map((row) => [
    qualifiedKey(row.index_schema, row.index_name), row,
  ]));
  for (const [key, index] of expected.indexes) {
    const remote = indexes.get(key);
    if (!remote) {
      failures.push(`${key}: índice ausente`);
      continue;
    }
    if (!remote.is_valid || !remote.is_ready) failures.push(`${key}: índice inválido ou incompleto`);
    const parsedRemote = parseCreateIndex(remote.index_definition || '');
    if (!parsedRemote) {
      failures.push(`${key}: definição remota do índice não pôde ser analisada`);
      continue;
    }
    const semanticDifferences = indexDifference(index, parsedRemote);
    if (semanticDifferences.length) {
      failures.push(`${key}: definição divergente (${semanticDifferences.join(', ')})`);
    }
  }
  for (const [key, index] of indexes) {
    if (!index.is_constraint_backed && !expected.indexes.has(key)) {
      failures.push(`${key}: índice público inesperado`);
    }
  }

  const functions = new Map();
  for (const row of snapshot.functions) {
    const args = normalizeIdentityArguments(row.identity_arguments || '');
    const key = `${qualifiedKey(row.function_schema, row.function_name)}(${args})`;
    if (functions.has(key)) failures.push(`${key}: assinatura de função duplicada no catálogo`);
    functions.set(key, row);
  }
  for (const [key, fn] of expected.functions) {
    const remote = functions.get(key);
    if (!remote) {
      failures.push(`${key}: função ausente`);
      continue;
    }
    if (Boolean(remote.security_definer) !== fn.securityDefiner) {
      failures.push(`${key}: modo SECURITY DEFINER diverge da migration`);
    }
    if ((fn.emptySearchPath || remote.security_definer) && !hasEmptySearchPath(remote.configuration)) {
      failures.push(`${key}: search_path não está vazio`);
    }
    if (remote.exposed_to_api) failures.push(`${key}: EXECUTE concedido a public/anon/authenticated`);
  }
  for (const [key, fn] of functions) {
    if (!expected.functions.has(key)) {
      failures.push(`${key}: função pública inesperada${fn.exposed_to_api ? ' e executável pela API' : ''}`);
    }
  }

  if (snapshot.defaultPrivileges.length === 0 && expectedRelationKeys.size > 0) {
    failures.push('privilégios padrão dos owners não foram avaliados');
  }
  const defaultTypesByOwner = new Map();
  for (const row of snapshot.defaultPrivileges) {
    const ownerTypes = defaultTypesByOwner.get(row.owner_name) || new Set();
    ownerTypes.add(row.object_type);
    defaultTypesByOwner.set(row.owner_name, ownerTypes);
    if (Number(row.exposed_grants) > 0) {
      failures.push(`privilégios padrão do owner ${row.owner_name} expõem futuros objetos ${row.object_type}`);
    }
  }
  for (const [owner, types] of defaultTypesByOwner) {
    for (const type of ['r', 'S', 'f']) {
      if (!types.has(type)) failures.push(`privilégios padrão do owner ${owner} incompletos para ${type}`);
    }
  }

  for (const [name, rawValue] of Object.entries(snapshot.integrity || {})) {
    const value = Number(rawValue);
    if (value !== 0) failures.push(`${name}: ${value}`);
  }
  if (!snapshot.transport?.ssl) failures.push('conexão com o banco sem TLS');

  const refs = configuredProjectRefs(environment);
  if (refs.auth && refs.database && refs.auth !== refs.database) {
    failures.push('banco PostgreSQL e SUPABASE_URL apontam para projetos diferentes');
  } else if (refs.auth && !refs.database) {
    warnings.push('não foi possível comprovar automaticamente o vínculo entre banco e projeto Supabase');
  }

  return {
    failures: [...new Set(failures)],
    warnings: [...new Set(warnings)],
    report: {
      status: failures.length ? 'FAIL' : 'OK',
      migrations: `${remoteMigrationMap.size}/${localMigrationMap.size}`,
      migration_contents_checked: `${checkedMigrationContents}/${remoteMigrationMap.size}`,
      tables: `${[...expected.tables.keys()].filter((key) => relations.has(key)).length}/${expected.tables.size}`,
      triggers: `${[...expected.triggers.keys()].filter((key) => triggers.has(key)).length}/${expected.triggers.size}`,
      functions: `${[...expected.functions.keys()].filter((key) => functions.has(key)).length}/${expected.functions.size}`,
      indexes: `${[...expected.indexes.keys()].filter((key) => indexes.has(key)).length}/${expected.indexes.size}`,
      tls: Boolean(snapshot.transport?.ssl),
      server_version: snapshot.transport?.server_version,
      integrity: snapshot.integrity,
    },
  };
}

async function collectDatabaseSnapshot(database) {
  const migrations = await database.query(`
    select version,
           case when to_jsonb(migration) ? 'statements'
                then to_jsonb(migration)->'statements' else null end as statements
    from supabase_migrations.schema_migrations as migration
    order by version
  `);

  const relations = await database.query(`
    select n.nspname as schema_name,
           c.relname as object_name,
           c.relkind as object_kind,
           c.relrowsecurity as rls_enabled,
           c.relforcerowsecurity as rls_forced,
           exists (
             select 1
             from aclexplode(coalesce(
               c.relacl,
               acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner)
             )) acl
             where acl.grantee = 0
                or acl.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
           ) as exposed_to_api,
           exists (
             select 1 from pg_depend owned
             where owned.classid = 'pg_class'::regclass
               and owned.objid = c.oid
               and owned.deptype in ('a', 'i')
           ) as is_owned_sequence
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_depend extension_dependency
      on extension_dependency.classid = 'pg_class'::regclass
     and extension_dependency.objid = c.oid
     and extension_dependency.deptype = 'e'
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and extension_dependency.objid is null
    order by c.relkind, c.relname
  `);

  const triggers = await database.query(`
    select table_ns.nspname as table_schema,
           table_class.relname as table_name,
           trg.tgname as trigger_name,
           trg.tgenabled as enabled_state,
           trg.tgtype::int as trigger_type,
           trg.tgconstraint <> 0 as is_constraint,
           function_ns.nspname as function_schema,
           proc.proname as function_name
    from pg_trigger trg
    join pg_class table_class on table_class.oid = trg.tgrelid
    join pg_namespace table_ns on table_ns.oid = table_class.relnamespace
    join pg_proc proc on proc.oid = trg.tgfoid
    join pg_namespace function_ns on function_ns.oid = proc.pronamespace
    where table_ns.nspname = 'public' and not trg.tgisinternal
    order by table_class.relname, trg.tgname
  `);

  const indexes = await database.query(`
    select index_ns.nspname as index_schema,
           index_class.relname as index_name,
           table_ns.nspname as table_schema,
           table_class.relname as table_name,
           catalog_index.indisvalid as is_valid,
           catalog_index.indisready as is_ready,
           constraint_entry.oid is not null as is_constraint_backed,
           pg_get_indexdef(catalog_index.indexrelid) as index_definition
    from pg_index catalog_index
    join pg_class index_class on index_class.oid = catalog_index.indexrelid
    join pg_namespace index_ns on index_ns.oid = index_class.relnamespace
    join pg_class table_class on table_class.oid = catalog_index.indrelid
    join pg_namespace table_ns on table_ns.oid = table_class.relnamespace
    left join pg_constraint constraint_entry on constraint_entry.conindid = catalog_index.indexrelid
    left join pg_depend extension_dependency
      on extension_dependency.classid = 'pg_class'::regclass
     and extension_dependency.objid = index_class.oid
     and extension_dependency.deptype = 'e'
    left join pg_depend table_extension_dependency
      on table_extension_dependency.classid = 'pg_class'::regclass
     and table_extension_dependency.objid = table_class.oid
     and table_extension_dependency.deptype = 'e'
    where table_ns.nspname = 'public'
      and extension_dependency.objid is null
      and table_extension_dependency.objid is null
    order by index_class.relname
  `);

  const functions = await database.query(`
    select namespace.nspname as function_schema,
           proc.proname as function_name,
           pg_get_function_identity_arguments(proc.oid) as identity_arguments,
           proc.prosecdef as security_definer,
           proc.proconfig as configuration,
           exists (
             select 1
             from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
             where acl.grantee = 0
                or acl.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
           ) as exposed_to_api
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    left join pg_depend extension_dependency
      on extension_dependency.classid = 'pg_proc'::regclass
     and extension_dependency.objid = proc.oid
     and extension_dependency.deptype = 'e'
    where namespace.nspname = 'public' and extension_dependency.objid is null
    order by proc.proname, pg_get_function_identity_arguments(proc.oid)
  `);

  const defaultPrivileges = await database.query(`
    with owners as (
      select distinct object_owner.oid, object_owner.rolname
      from (
        select relowner as owner_oid
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        left join pg_depend extension_dependency
          on extension_dependency.classid = 'pg_class'::regclass
         and extension_dependency.objid = relation.oid
         and extension_dependency.deptype = 'e'
        where namespace.nspname = 'public'
          and extension_dependency.objid is null
        union
        select proowner
        from pg_proc proc
        join pg_namespace namespace on namespace.oid = proc.pronamespace
        left join pg_depend extension_dependency
          on extension_dependency.classid = 'pg_proc'::regclass
         and extension_dependency.objid = proc.oid
         and extension_dependency.deptype = 'e'
        where namespace.nspname = 'public'
          and extension_dependency.objid is null
      ) owned
      join pg_roles object_owner on object_owner.oid = owned.owner_oid
    ), object_types(object_type) as (
      values ('r'::"char"), ('S'::"char"), ('f'::"char")
    )
    select owners.rolname as owner_name,
           object_types.object_type,
           count(acl.grantee) filter (
             where acl.grantee = 0
                or acl.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
           )::int as exposed_grants
    from owners
    cross join object_types
    left join pg_default_acl defaults
      on defaults.defaclrole = owners.oid
     and defaults.defaclnamespace = 'public'::regnamespace
     and defaults.defaclobjtype = object_types.object_type
    cross join lateral aclexplode(
      coalesce(defaults.defaclacl, acldefault(object_types.object_type, owners.oid))
    ) acl
    group by owners.rolname, object_types.object_type
    order by owners.rolname, object_types.object_type
  `);

  const integrity = await database.query(`
    select
      (select count(*)::int from (
        select amostra_id, parametro_id
        from public.resultado_analise
        where deleted_at is null
        group by amostra_id, parametro_id
        having count(*) > 1
      ) duplicates) as duplicate_active_results,
      (select count(*)::int
       from public.resultado_analise result
       left join public.amostra_parametro sample_parameter
         on sample_parameter.amostra_id = result.amostra_id
        and sample_parameter.parametro_id = result.parametro_id
       where result.deleted_at is null and sample_parameter.amostra_id is null) as results_outside_sample_scope,
      (select count(*)::int
       from public.laudo_analitico report
       left join public.assinatura_eletronica signature
         on signature.id = report.assinatura_eletronica_id
       where signature.id is null) as reports_without_signature
  `);

  const transport = await database.query(`
    select coalesce(ssl.ssl, false) as ssl,
           current_setting('server_version') as server_version
    from (select 1) probe
    left join pg_stat_ssl ssl on ssl.pid = pg_backend_pid()
  `);

  return {
    migrations: migrations.rows,
    relations: relations.rows,
    triggers: triggers.rows,
    indexes: indexes.rows,
    functions: functions.rows,
    defaultPrivileges: defaultPrivileges.rows,
    integrity: integrity.rows[0],
    transport: transport.rows[0],
  };
}

async function verifyDatabase(database, {
  environment = process.env,
  localMigrations = loadLocalMigrations(),
} = {}) {
  const expected = buildExpectedSchema(localMigrations);
  if (expected.errors.length) throw new Error('Migrations locais não puderam ser analisadas.');
  const snapshot = await collectDatabaseSnapshot(database);
  return evaluateDatabaseSnapshot({ expected, localMigrations, snapshot, environment });
}

async function withReadOnlyClient(databasePool, operation) {
  const client = await databasePool.connect();
  let transactionStarted = false;
  try {
    await client.query('begin transaction read only');
    transactionStarted = true;
    return await operation(client);
  } finally {
    if (transactionStarted) {
      try { await client.query('rollback'); } catch { /* conexão já indisponível */ }
    }
    client.release?.();
  }
}

async function runCli() {
  try {
    const result = await withReadOnlyClient(pool, (client) => verifyDatabase(client));
    console.log(JSON.stringify(result.report, null, 2));
    for (const warning of result.warnings) console.warn(`Aviso: ${warning}.`);
    if (result.failures.length) {
      console.error('Falhas de prontidão do banco:');
      for (const failure of result.failures) console.error(`- ${failure}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(safeDatabaseFailureMessage(error));
    process.exitCode = 1;
  } finally {
    if (typeof pool.end === 'function') await pool.end().catch(() => {});
  }
}

if (require.main === module) runCli();

module.exports = {
  canonicalMigrationStatements,
  canonicalPredicate,
  collectDatabaseSnapshot,
  configuredProjectRefs,
  evaluateDatabaseSnapshot,
  hasEmptySearchPath,
  indexDifference,
  loadLocalMigrations,
  migrationDigest,
  runCli,
  triggerSemantics,
  verifyDatabase,
  withReadOnlyClient,
};
