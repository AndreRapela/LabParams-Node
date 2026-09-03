'use strict';

const fs = require('fs');
const path = require('path');

const {
  IDENTIFIER_SOURCE,
  buildExpectedSchema,
  destructiveReason,
  maskSqlBodies,
  normalizeIdentifier,
  normalizeIdentityArguments,
  parseCreateFunction,
  parseCreateTrigger,
  qualifiedKey,
  splitSqlStatements,
} = require('./lib/migration-analysis');

const DEFAULT_MIGRATION_DIRECTORY = path.resolve(__dirname, '..', 'supabase', 'migrations');
const MIGRATION_NAME_PATTERN = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
// Migrations anteriores já foram aplicadas e não podem receber anotações sem
// reescrever o histórico. A política ampliada vale deste hardening em diante.
const STRICT_DESTRUCTIVE_POLICY_SINCE = '20260811010000';
const PUBLIC_ROLES = new Set(['public', 'anon', 'authenticated']);

function loadMigrations(migrationDirectory = DEFAULT_MIGRATION_DIRECTORY) {
  return fs.readdirSync(migrationDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      file,
      buffer: fs.readFileSync(path.join(migrationDirectory, file)),
    }))
    .map((migration) => ({ ...migration, sql: migration.buffer.toString('utf8') }));
}

function rolesFromList(value) {
  return new Set(value.replace(/\s+with\s+grant\s+option\s*$/i, '')
    .split(',').map((role) => normalizeIdentifier(role.trim())).filter(Boolean));
}

function tableKeyFromAlter(statement, suffix) {
  const pattern = new RegExp(
    `^alter\\s+table\\s+(?:only\\s+)?(?:(${IDENTIFIER_SOURCE})\\s*\\.\\s*)?(${IDENTIFIER_SOURCE})\\s+${suffix}`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  if (!match) return null;
  return qualifiedKey(normalizeIdentifier(match[1] || 'public'), normalizeIdentifier(match[2]));
}

function parseTableRevoke(statement) {
  const pattern = new RegExp(
    `^revoke\\s+(?:all(?:\\s+privileges)?|select\\s*,[\\s\\S]*?)\\s+on\\s+table\\s+`
      + `(?:(${IDENTIFIER_SOURCE})\\s*\\.\\s*)?(${IDENTIFIER_SOURCE})\\s+from\\s+([\\s\\S]+)$`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  if (!match) return null;
  return {
    key: qualifiedKey(normalizeIdentifier(match[1] || 'public'), normalizeIdentifier(match[2])),
    roles: rolesFromList(match[3]),
  };
}

function parseFunctionRevoke(statement) {
  const source = maskSqlBodies(statement);
  const pattern = new RegExp(
    `^revoke\\s+(?:all(?:\\s+privileges)?|execute)\\s+on\\s+function\\s+`
      + `(?:(${IDENTIFIER_SOURCE})\\s*\\.\\s*)?(${IDENTIFIER_SOURCE})\\s*\\(`,
    'i'
  );
  const match = source.match(pattern);
  if (!match) return null;
  const openIndex = match[0].lastIndexOf('(');
  let depth = 0;
  let closeIndex = -1;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')' && --depth === 0) {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex < 0) return null;
  const rolesMatch = source.slice(closeIndex + 1).match(/^\s+from\s+([\s\S]+)$/i);
  if (!rolesMatch) return null;
  const schema = normalizeIdentifier(match[1] || 'public');
  const name = normalizeIdentifier(match[2]);
  const args = normalizeIdentityArguments(source.slice(openIndex + 1, closeIndex));
  return {
    key: `${qualifiedKey(schema, name)}(${args})`,
    roles: rolesFromList(rolesMatch[1]),
  };
}

function droppedTriggerKey(statement) {
  const pattern = new RegExp(
    `^drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(${IDENTIFIER_SOURCE})\\s+on\\s+`
      + `(?:(${IDENTIFIER_SOURCE})\\s*\\.\\s*)?(${IDENTIFIER_SOURCE})`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  if (!match) return null;
  const table = qualifiedKey(normalizeIdentifier(match[2] || 'public'), normalizeIdentifier(match[3]));
  return `${table}.${normalizeIdentifier(match[1])}`;
}

function constraintKey(statement, action) {
  const pattern = new RegExp(
    `^alter\\s+table\\s+(?:only\\s+)?(?:(${IDENTIFIER_SOURCE})\\s*\\.\\s*)?`
      + `(${IDENTIFIER_SOURCE})\\s+${action}\\s+constraint\\s+(?:if\\s+(?:not\\s+)?exists\\s+)?`
      + `(${IDENTIFIER_SOURCE})`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  if (!match) return null;
  return `${qualifiedKey(normalizeIdentifier(match[1] || 'public'), normalizeIdentifier(match[2]))}`
    + `.${normalizeIdentifier(match[3])}`;
}

function unsafeDoBlockReason(statement) {
  const match = statement.trim().match(/^do(?:\s+language\s+[a-z_][a-z0-9_]*)?\s+(\$[a-z_][a-z0-9_]*\$|\$\$)([\s\S]*)\1$/i);
  if (!match) return null;
  const body = splitSqlStatements(match[2]);
  const visibleBody = body.statements.map(maskSqlBodies).join('\n');
  if (/\bexecute\b/i.test(visibleBody)) return 'EXECUTE dinâmico em bloco DO';
  const dataMutation = visibleBody.match(
    /\b(insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?|copy)\b/i
  );
  if (dataMutation) return `DML em bloco DO (${dataMutation[1].toUpperCase().replace(/\s+/g, ' ')})`;
  const schemaMutation = visibleBody.match(
    /\b(create|alter|drop|reindex|cluster|vacuum|analyze|refresh\s+materialized\s+view)\b/i
  );
  if (schemaMutation) return `DDL em bloco DO (${schemaMutation[1].toUpperCase().replace(/\s+/g, ' ')})`;
  const privilegeMutation = visibleBody.match(
    /\b(grant|revoke|set\s+(?:role|session\s+authorization)|reset\s+role)\b/i
  );
  if (privilegeMutation) {
    return `privilégio/sessão alterado em bloco DO (${privilegeMutation[1].toUpperCase().replace(/\s+/g, ' ')})`;
  }
  const transactionControl = visibleBody.match(
    /\b(commit|rollback|start\s+transaction|begin\s+(?:transaction|work)|savepoint|release\s+savepoint)\b/i
  );
  if (transactionControl) {
    return `controle transacional em bloco DO (${transactionControl[1].toUpperCase().replace(/\s+/g, ' ')})`;
  }
  const sideEffect = visibleBody.match(
    /\b(call|perform|notify|listen|unlisten|lock\s+table|discard|checkpoint|load)\b/i
  );
  if (sideEffect) return `comando com efeito colateral em bloco DO (${sideEffect[1].toUpperCase().replace(/\s+/g, ' ')})`;
  const mutatingFunction = visibleBody.match(
    /\b(nextval|setval|pg_advisory_lock|pg_advisory_xact_lock|pg_notify|dblink_exec|lo_import|lo_export)\s*\(/i
  );
  if (mutatingFunction) return `função mutável em bloco DO (${mutatingFunction[1].toLowerCase()})`;
  return null;
}

function isConcurrentIndexStatement(statement) {
  return /^create\s+(?:unique\s+)?index\s+concurrently\b/i.test(maskSqlBodies(statement));
}

function validateNonTransactionalIndexMigration(file, statements) {
  const errors = [];
  const concurrentIndexes = statements.filter(isConcurrentIndexStatement);
  if (concurrentIndexes.length === 0) return { applicable: false, errors };

  for (const statement of statements) {
    const visible = maskSqlBodies(statement).trim();
    if (/^(?:begin(?:\s+transaction)?|commit|rollback)$/i.test(visible)) {
      errors.push(`${file}: CREATE INDEX CONCURRENTLY não pode estar dentro de transação explícita.`);
      continue;
    }
    if (isConcurrentIndexStatement(statement)) {
      if (!/^create\s+(?:unique\s+)?index\s+concurrently\s+if\s+not\s+exists\b/i.test(visible)) {
        errors.push(`${file}: índice concorrente deve usar IF NOT EXISTS para permitir retomada segura.`);
      }
      continue;
    }
    if (/^alter\s+default\s+privileges\b[\s\S]*\brevoke\b/i.test(visible)
      || /^comment\s+on\s+index\b/i.test(visible)
      || /^set\s+(?:lock_timeout|statement_timeout)\s*(?:=|to)\s*/i.test(visible)) {
      continue;
    }
    if (/^do\b/i.test(visible)) {
      const unsafeDoBlock = unsafeDoBlockReason(statement);
      if (!unsafeDoBlock) continue;
      errors.push(`${file}: migration não transacional contém bloco DO mutável (${unsafeDoBlock}).`);
      continue;
    }
    errors.push(`${file}: migration não transacional contém operação não permitida: ${visible.split(/\s+/).slice(0, 4).join(' ')}.`);
  }

  return { applicable: true, errors };
}

function unsafePrivilegeReason(statement) {
  const source = maskSqlBodies(statement);
  const grant = source.match(/^grant\s+[\s\S]+?\s+to\s+([\s\S]+)$/i);
  if (grant && [...rolesFromList(grant[1])].some((role) => PUBLIC_ROLES.has(role))) {
    return 'GRANT direto para public/anon/authenticated';
  }
  if (/^alter\s+default\s+privileges[\s\S]+\bgrant\b[\s\S]+\bto\s+(?:public|anon|authenticated)\b/i.test(source)) {
    return 'privilégio padrão público';
  }
  if (/^alter\s+table\b[\s\S]+\bdisable\s+row\s+level\s+security\b/i.test(source)) {
    return 'desativação de RLS';
  }
  return null;
}

function validateMigrations(migrations, {
  strictSince = STRICT_DESTRUCTIVE_POLICY_SINCE,
} = {}) {
  const errors = [];
  const versions = new Set();
  const parsedMigrations = [];
  const rlsEnabled = new Set();
  const tableRevokes = new Map();
  const functionRevokes = new Map();

  if (migrations.length === 0) errors.push('Nenhuma migration SQL foi encontrada.');

  for (const migration of migrations) {
    const match = migration.file.match(MIGRATION_NAME_PATTERN);
    if (!match) {
      errors.push(`${migration.file}: use o formato AAAAMMDDHHMMSS_nome_em_snake_case.sql.`);
      continue;
    }
    const version = match[1];
    if (versions.has(version)) errors.push(`${migration.file}: timestamp de migration duplicado (${version}).`);
    versions.add(version);

    if (migration.buffer?.length >= 3
      && migration.buffer[0] === 0xef && migration.buffer[1] === 0xbb && migration.buffer[2] === 0xbf) {
      errors.push(`${migration.file}: remova o BOM UTF-8.`);
    }
    if (migration.sql.includes('\uFFFD') || migration.sql.includes('\0')) {
      errors.push(`${migration.file}: contém bytes inválidos para UTF-8 ou caractere NUL.`);
    }

    const parsed = splitSqlStatements(migration.sql);
    for (const lexicalError of parsed.errors) errors.push(`${migration.file}: ${lexicalError}.`);
    parsedMigrations.push({ file: migration.file, sql: migration.sql });

    const nonTransactional = validateNonTransactionalIndexMigration(migration.file, parsed.statements);
    errors.push(...nonTransactional.errors);
    if (!nonTransactional.applicable) {
      if (!/^begin(?:\s+transaction)?$/i.test(parsed.statements[0] || '')) {
        errors.push(`${migration.file}: a migration deve iniciar com BEGIN;`);
      }
      if (!/^commit$/i.test(parsed.statements.at(-1) || '')) {
        errors.push(`${migration.file}: a migration deve terminar com COMMIT;.`);
      }
    }

    const createdTriggerKeys = new Set(
      parsed.statements.map(parseCreateTrigger).filter(Boolean).map((trigger) => trigger.key)
    );
    const addedConstraintKeys = new Set(
      parsed.statements.map((statement) => constraintKey(statement, 'add')).filter(Boolean)
    );

    for (const statement of parsed.statements) {
      const topLevel = maskSqlBodies(statement);
      if (version >= strictSince) {
        const destructive = destructiveReason(statement);
        const replacementTrigger = droppedTriggerKey(statement);
        const replacementConstraint = constraintKey(statement, 'drop');
        const safeReplacement = (replacementTrigger && createdTriggerKeys.has(replacementTrigger))
          || (replacementConstraint && addedConstraintKeys.has(replacementConstraint));
        if (destructive && !safeReplacement) {
          errors.push(`${migration.file}: operação destrutiva bloqueada (${destructive}).`);
        }
        const unsafeDoBlock = unsafeDoBlockReason(statement);
        if (unsafeDoBlock) {
          errors.push(`${migration.file}: operação destrutiva bloqueada (${unsafeDoBlock}).`);
        }
        const unsafePrivilege = unsafePrivilegeReason(statement);
        if (unsafePrivilege) errors.push(`${migration.file}: regressão de segurança bloqueada (${unsafePrivilege}).`);
      }

      const fn = parseCreateFunction(statement);
      if (fn?.securityDefiner && !fn.emptySearchPath) {
        errors.push(`${migration.file}: ${fn.key} usa SECURITY DEFINER sem SET search_path = ''.`);
      }

      const enabledTable = tableKeyFromAlter(statement, 'enable\\s+row\\s+level\\s+security\\b');
      if (enabledTable) rlsEnabled.add(enabledTable);

      const tableRevoke = parseTableRevoke(statement);
      if (tableRevoke) {
        const current = tableRevokes.get(tableRevoke.key) || new Set();
        for (const role of tableRevoke.roles) current.add(role);
        tableRevokes.set(tableRevoke.key, current);
      }

      const functionRevoke = parseFunctionRevoke(statement);
      if (functionRevoke) {
        const current = functionRevokes.get(functionRevoke.key) || new Set();
        for (const role of functionRevoke.roles) current.add(role);
        functionRevokes.set(functionRevoke.key, current);
      }

      if (/^create\s+(?:or\s+replace\s+)?function\b/i.test(topLevel) && !fn) {
        errors.push(`${migration.file}: declaração CREATE FUNCTION não pôde ser analisada com segurança.`);
      }
    }
  }

  const expected = buildExpectedSchema(parsedMigrations);
  errors.push(...expected.errors);

  for (const [key, table] of expected.tables) {
    if (table.schema !== 'public') continue;
    if (!rlsEnabled.has(key)) errors.push(`${key}: tabela criada sem habilitar RLS.`);
    const revoked = tableRevokes.get(key) || new Set();
    for (const role of ['anon', 'authenticated']) {
      if (!revoked.has(role)) errors.push(`${key}: acesso direto de ${role} não foi revogado.`);
    }
  }

  for (const [key, fn] of expected.functions) {
    if (fn.schema !== 'public') continue;
    const revoked = functionRevokes.get(key) || new Set();
    for (const role of PUBLIC_ROLES) {
      if (!revoked.has(role)) errors.push(`${key}: EXECUTE de ${role} não foi revogado.`);
    }
  }

  return {
    errors: [...new Set(errors)],
    summary: {
      migrations: migrations.length,
      tables: expected.tables.size,
      functions: expected.functions.size,
      triggers: expected.triggers.size,
      indexes: expected.indexes.size,
    },
    expected,
  };
}

function runCli() {
  const result = validateMigrations(loadMigrations());
  if (result.errors.length > 0) {
    console.error(`Falha na análise estática de migrations (${result.errors.length}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  const { summary } = result;
  console.log(
    `Migrations analisadas: ${summary.migrations} arquivo(s), ${summary.tables} tabela(s), `
      + `${summary.functions} função(ões), ${summary.triggers} trigger(s) e ${summary.indexes} índice(s).`
  );
}

if (require.main === module) runCli();

module.exports = {
  MIGRATION_NAME_PATTERN,
  STRICT_DESTRUCTIVE_POLICY_SINCE,
  loadMigrations,
  parseFunctionRevoke,
  parseTableRevoke,
  runCli,
  unsafePrivilegeReason,
  unsafeDoBlockReason,
  validateNonTransactionalIndexMigration,
  validateMigrations,
};
