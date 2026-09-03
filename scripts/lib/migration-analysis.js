'use strict';

const IDENTIFIER_SOURCE = '(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)';
const QUALIFIED_NAME_SOURCE = `(?:(${IDENTIFIER_SOURCE})\\s*\\.\\s*)?(${IDENTIFIER_SOURCE})`;

function normalizeIdentifier(identifier) {
  if (!identifier) return '';
  const trimmed = identifier.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed.toLowerCase();
}

function qualifiedKey(schema, name) {
  return `${normalizeIdentifier(schema || 'public')}.${normalizeIdentifier(name)}`;
}

function readDollarTag(source, index) {
  const match = source.slice(index).match(/^\$[a-z_][a-z0-9_]*\$|^\$\$/i);
  return match?.[0] || null;
}

/**
 * Splits PostgreSQL statements while removing comments. Semicolons inside quoted
 * values, identifiers and dollar-quoted function bodies are deliberately ignored.
 */
function splitSqlStatements(source) {
  const statements = [];
  const errors = [];
  let buffer = '';
  let state = 'normal';
  let blockDepth = 0;
  let dollarTag = '';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        buffer += '\n';
        state = 'normal';
      } else {
        buffer += ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (char === '/' && next === '*') {
        blockDepth += 1;
        buffer += '  ';
        index += 1;
      } else if (char === '*' && next === '/') {
        blockDepth -= 1;
        buffer += '  ';
        index += 1;
        if (blockDepth === 0) state = 'normal';
      } else {
        buffer += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state === 'single-quote') {
      buffer += char;
      if (char === "'" && next === "'") {
        buffer += next;
        index += 1;
      } else if (char === "'") {
        state = 'normal';
      }
      continue;
    }

    if (state === 'double-quote') {
      buffer += char;
      if (char === '"' && next === '"') {
        buffer += next;
        index += 1;
      } else if (char === '"') {
        state = 'normal';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (source.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length - 1;
        state = 'normal';
      } else {
        buffer += char;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      buffer += '  ';
      index += 1;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      buffer += '  ';
      index += 1;
      blockDepth = 1;
      state = 'block-comment';
      continue;
    }
    if (char === "'") {
      buffer += char;
      state = 'single-quote';
      continue;
    }
    if (char === '"') {
      buffer += char;
      state = 'double-quote';
      continue;
    }
    if (char === '$') {
      const tag = readDollarTag(source, index);
      if (tag) {
        buffer += tag;
        index += tag.length - 1;
        dollarTag = tag;
        state = 'dollar-quote';
        continue;
      }
    }
    if (char === ';') {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += char;
  }

  if (buffer.trim()) statements.push(buffer.trim());
  if (state === 'block-comment') errors.push('comentário de bloco não foi encerrado');
  if (state === 'single-quote') errors.push('literal de texto não foi encerrado');
  if (state === 'double-quote') errors.push('identificador entre aspas não foi encerrado');
  if (state === 'dollar-quote') errors.push(`bloco ${dollarTag} não foi encerrado`);

  return { statements, errors };
}

/** Masks literal and dollar-quoted contents so policy regexes only see DDL/DML. */
function maskSqlBodies(statement) {
  let result = '';
  let state = 'normal';
  let dollarTag = '';
  let literalContent = '';

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    const next = statement[index + 1];

    if (state === 'single-quote') {
      if (char === "'" && next === "'") {
        literalContent += "'";
        index += 1;
      } else if (char === "'") {
        result += literalContent.length === 0 ? "''" : "'__literal__'";
        literalContent = '';
        state = 'normal';
      } else {
        literalContent += char;
      }
      continue;
    }

    if (state === 'double-quote') {
      result += char;
      if (char === '"' && next === '"') {
        result += next;
        index += 1;
      } else if (char === '"') {
        state = 'normal';
      }
      continue;
    }

    if (state === 'dollar-quote') {
      if (statement.startsWith(dollarTag, index)) {
        result += dollarTag;
        index += dollarTag.length - 1;
        state = 'normal';
      } else {
        result += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (char === "'") {
      state = 'single-quote';
      literalContent = '';
      continue;
    }
    if (char === '"') {
      result += char;
      state = 'double-quote';
      continue;
    }
    if (char === '$') {
      const tag = readDollarTag(statement, index);
      if (tag) {
        result += tag;
        index += tag.length - 1;
        dollarTag = tag;
        state = 'dollar-quote';
        continue;
      }
    }
    result += char;
  }

  return result;
}

function splitTopLevel(source, delimiter = ',') {
  const parts = [];
  let buffer = '';
  let depth = 0;
  let state = 'normal';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'single') {
      buffer += char;
      if (char === "'" && next === "'") {
        buffer += next;
        index += 1;
      } else if (char === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      buffer += char;
      if (char === '"' && next === '"') {
        buffer += next;
        index += 1;
      } else if (char === '"') state = 'normal';
      continue;
    }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;

    if (char === delimiter && depth === 0 && state === 'normal') {
      parts.push(buffer.trim());
      buffer = '';
    } else {
      buffer += char;
    }
  }
  if (buffer.trim() || source.trim()) parts.push(buffer.trim());
  return parts;
}

function findMatchingParenthesis(source, openIndex) {
  let depth = 0;
  let state = 'normal';
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'single') {
      if (char === "'" && next === "'") index += 1;
      else if (char === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') state = 'normal';
      continue;
    }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function canonicalSqlFragment(value = '') {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/::\s*(?:text|character varying|varchar)\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>])\s*/g, '$1');

  let previous;
  do {
    previous = normalized;
    if (normalized.startsWith('(') && normalized.endsWith(')')
      && findMatchingParenthesis(normalized, 0) === normalized.length - 1) {
      normalized = normalized.slice(1, -1).trim();
    }
  } while (normalized !== previous);
  return normalized;
}

const TYPE_ALIASES = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['int8', 'bigint'], ['int2', 'smallint'],
  ['bool', 'boolean'], ['varchar', 'character varying'], ['timestamptz', 'timestamp with time zone'],
  ['timestamp', 'timestamp without time zone'], ['float8', 'double precision'], ['float4', 'real'],
  ['decimal', 'numeric'],
]);

function normalizeType(type) {
  let normalized = canonicalSqlFragment(type)
    .replace(/\s*\[\s*]\s*$/g, '[]');
  const arraySuffix = normalized.endsWith('[]') ? '[]' : '';
  if (arraySuffix) normalized = normalized.slice(0, -2);
  normalized = TYPE_ALIASES.get(normalized) || normalized;
  return `${normalized}${arraySuffix}`;
}

function normalizeIdentityArguments(argumentSource = '') {
  if (!argumentSource.trim()) return '';
  return splitTopLevel(argumentSource).map((argument) => {
    let value = argument
      .replace(/\bdefault\b[\s\S]*$/i, '')
      .replace(/=[\s\S]*$/, '')
      .trim();
    value = value.replace(/^(?:in|out|inout|variadic)\s+/i, '');
    const tokens = value.match(/"(?:[^"]|"")+"|[^\s]+/g) || [];
    if (tokens.length > 1) {
      const first = normalizeIdentifier(tokens[0]);
      const knownSingleWordTypes = new Set([
        'bigint', 'bigserial', 'bit', 'boolean', 'box', 'bytea', 'char', 'cidr', 'circle',
        'date', 'decimal', 'double', 'inet', 'int', 'int2', 'int4', 'int8', 'integer',
        'interval', 'json', 'jsonb', 'macaddr', 'money', 'numeric', 'path', 'real',
        'record', 'serial', 'smallint', 'text', 'time', 'timestamp', 'timestamptz', 'uuid',
        'varchar', 'xml',
      ]);
      if (!knownSingleWordTypes.has(first) && !first.includes('.') && !first.endsWith('[]')) {
        tokens.shift();
        value = tokens.join(' ');
      }
    }
    return normalizeType(value);
  }).join(', ');
}

function parseQualifiedMatch(match, schemaGroup = 1, nameGroup = 2) {
  return {
    schema: normalizeIdentifier(match[schemaGroup] || 'public'),
    name: normalizeIdentifier(match[nameGroup]),
  };
}

function canonicalFunctionTokens(source = '') {
  const parsed = splitSqlStatements(String(source));
  if (parsed.errors.length) return null;
  const value = parsed.statements.join(';');
  const tokens = [];

  for (let index = 0; index < value.length;) {
    const char = value[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let token = char;
      index += 1;
      while (index < value.length) {
        token += value[index];
        if (value[index] === "'" && value[index + 1] === "'") {
          token += value[index + 1];
          index += 2;
          continue;
        }
        if (value[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push(token);
      continue;
    }
    if (char === '"') {
      let token = char;
      index += 1;
      while (index < value.length) {
        token += value[index];
        if (value[index] === '"' && value[index + 1] === '"') {
          token += value[index + 1];
          index += 2;
          continue;
        }
        if (value[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push(token);
      continue;
    }
    if (char === '$') {
      const tag = readDollarTag(value, index);
      if (tag) {
        const end = value.indexOf(tag, index + tag.length);
        if (end >= 0) {
          tokens.push(`$body$${value.slice(index + tag.length, end)}$body$`);
          index = end + tag.length;
          continue;
        }
      }
    }
    if (/[a-z0-9_$]/i.test(char)) {
      let end = index + 1;
      while (end < value.length && /[a-z0-9_$]/i.test(value[end])) end += 1;
      tokens.push(value.slice(index, end).toLowerCase());
      index = end;
      continue;
    }
    let end = index + 1;
    while (end < value.length && !/[\s'a-z0-9_$"]/i.test(value[end])) end += 1;
    tokens.push(value.slice(index, end));
    index = end;
  }
  return tokens.join('\u001f');
}

function functionDefinitionSemantics(statement) {
  const source = String(statement || '').trim();
  const header = maskSqlBodies(source);
  const pattern = new RegExp(
    `^create\\s+(?:or\\s+replace\\s+)?function\\s+${QUALIFIED_NAME_SOURCE}\\s*\\(`,
    'i'
  );
  const match = header.match(pattern);
  if (!match) return null;
  const openIndex = match[0].lastIndexOf('(');
  const closeIndex = findMatchingParenthesis(header, openIndex);
  if (closeIndex < 0) return null;

  const tail = source.slice(closeIndex + 1);
  const asMatch = tail.match(/\bas\s+(\$[a-z_][a-z0-9_]*\$|\$\$)/i);
  if (!asMatch) return null;
  const bodyTag = asMatch[1];
  const bodyStart = closeIndex + 1 + asMatch.index + asMatch[0].length;
  const bodyEnd = source.indexOf(bodyTag, bodyStart);
  if (bodyEnd < 0) return null;
  const options = source.slice(closeIndex + 1, closeIndex + 1 + asMatch.index);
  const returns = options.match(
    /\breturns\s+([\s\S]*?)(?=\s+\b(?:language|transform|window|immutable|stable|volatile|security|parallel|cost|rows|support|set|strict|called)\b|$)/i
  );
  const language = options.match(/\blanguage\s+([a-z_][a-z0-9_$]*)/i)?.[1]?.toLowerCase() || '';
  const settings = [];
  const settingPattern = /\bset\s+([a-z_][a-z0-9_.]*)\s*(?:=|to)\s*([\s\S]*?)(?=\s+\b(?:language|transform|window|immutable|stable|volatile|security|parallel|cost|rows|support|set|strict|called)\b|$)/gi;
  for (const setting of options.matchAll(settingPattern)) {
    settings.push(`${setting[1].toLowerCase()}=${canonicalFunctionTokens(setting[2])}`);
  }

  return {
    arguments: canonicalFunctionTokens(source.slice(openIndex + 1, closeIndex)),
    resultType: canonicalFunctionTokens(returns?.[1] || ''),
    language,
    volatility: options.match(/\b(immutable|stable|volatile)\b/i)?.[1]?.toLowerCase() || 'volatile',
    strict: /\bstrict\b|\breturns\s+null\s+on\s+null\s+input\b/i.test(options),
    security: options.match(/\bsecurity\s+(definer|invoker)\b/i)?.[1]?.toLowerCase() || 'invoker',
    parallel: options.match(/\bparallel\s+(safe|restricted|unsafe)\b/i)?.[1]?.toLowerCase() || 'unsafe',
    leakproof: /\bleakproof\b/i.test(options) && !/\bnot\s+leakproof\b/i.test(options),
    window: /\bwindow\b/i.test(options),
    configuration: settings.sort(),
    body: canonicalFunctionTokens(source.slice(bodyStart, bodyEnd)),
  };
}

function parseCreateFunction(statement) {
  const header = maskSqlBodies(statement);
  const pattern = new RegExp(
    `^create\\s+(?:or\\s+replace\\s+)?function\\s+${QUALIFIED_NAME_SOURCE}\\s*\\(`,
    'i'
  );
  const match = header.match(pattern);
  if (!match) return null;
  const openIndex = match[0].lastIndexOf('(');
  const closeIndex = findMatchingParenthesis(header, openIndex);
  if (closeIndex < 0) return null;
  const identityArguments = normalizeIdentityArguments(header.slice(openIndex + 1, closeIndex));
  const { schema, name } = parseQualifiedMatch(match);
  const securityDefiner = /\bsecurity\s+definer\b/i.test(header.slice(closeIndex));
  const emptySearchPath = /\bset\s+search_path\s*(?:=|to)\s*''(?:\s|$)/i.test(header.slice(closeIndex));
  return {
    schema,
    name,
    identityArguments,
    key: `${qualifiedKey(schema, name)}(${identityArguments})`,
    securityDefiner,
    emptySearchPath,
    definition: statement.trim(),
  };
}

function parseCreateTable(statement) {
  const header = maskSqlBodies(statement);
  const pattern = new RegExp(
    `^create\\s+(?:(?:global|local)\\s+)?(?:unlogged\\s+)?table\\s+(?!temporary\\b|temp\\b)(?:if\\s+not\\s+exists\\s+)?${QUALIFIED_NAME_SOURCE}`,
    'i'
  );
  const match = header.match(pattern);
  if (!match) return null;
  const parsed = parseQualifiedMatch(match);
  return { ...parsed, key: qualifiedKey(parsed.schema, parsed.name) };
}

function parseCreateIndex(statement) {
  const source = statement.trim();
  const prefix = new RegExp(
    `^create\\s+(unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${QUALIFIED_NAME_SOURCE}\\s+on\\s+(?:only\\s+)?${QUALIFIED_NAME_SOURCE}`,
    'i'
  );
  const match = source.match(prefix);
  if (!match) return null;
  const indexSchema = normalizeIdentifier(match[2] || 'public');
  const name = normalizeIdentifier(match[3]);
  const tableSchema = normalizeIdentifier(match[4] || 'public');
  const tableName = normalizeIdentifier(match[5]);
  const restStart = match[0].length;
  const rest = source.slice(restStart);
  const methodMatch = rest.match(/^\s*using\s+([a-z_][a-z0-9_]*)/i);
  const method = normalizeIdentifier(methodMatch?.[1] || 'btree');
  const keysOpen = source.indexOf('(', restStart + (methodMatch?.[0].length || 0));
  const keysClose = keysOpen >= 0 ? findMatchingParenthesis(source, keysOpen) : -1;
  if (keysClose < 0) return null;
  const keys = splitTopLevel(source.slice(keysOpen + 1, keysClose)).map(canonicalSqlFragment);
  const suffix = source.slice(keysClose + 1);
  const predicateMatch = suffix.match(/\bwhere\b([\s\S]*)$/i);
  return {
    schema: indexSchema,
    name,
    key: qualifiedKey(indexSchema, name),
    tableSchema,
    tableName,
    unique: Boolean(match[1]),
    method,
    keys,
    predicate: predicateMatch ? canonicalSqlFragment(predicateMatch[1]) : '',
  };
}

function parseCreateTrigger(statement) {
  const source = maskSqlBodies(statement);
  const start = new RegExp(`^create\\s+(constraint\\s+)?trigger\\s+(${IDENTIFIER_SOURCE})\\s+`, 'i');
  const match = source.match(start);
  if (!match) return null;
  const name = normalizeIdentifier(match[2]);
  const onPattern = new RegExp(`\\bon\\s+${QUALIFIED_NAME_SOURCE}\\s+`, 'i');
  const onMatch = source.match(onPattern);
  const executePattern = new RegExp(
    `\\bexecute\\s+(?:function|procedure)\\s+${QUALIFIED_NAME_SOURCE}\\s*\\(`,
    'i'
  );
  const executeMatch = source.match(executePattern);
  if (!onMatch || !executeMatch) return null;
  const table = parseQualifiedMatch(onMatch);
  const fn = parseQualifiedMatch(executeMatch);
  const timingMatch = source.match(/\b(before|after|instead\s+of)\b/i);
  const eventsRegion = timingMatch && onMatch
    ? source.slice(timingMatch.index + timingMatch[0].length, onMatch.index)
    : '';
  const events = [...eventsRegion.matchAll(/\b(insert|update|delete|truncate)\b/gi)]
    .map((item) => item[1].toLowerCase())
    .sort();
  return {
    schema: table.schema,
    name,
    key: `${qualifiedKey(table.schema, table.name)}.${name}`,
    tableSchema: table.schema,
    tableName: table.name,
    functionSchema: fn.schema,
    functionName: fn.name,
    timing: (timingMatch?.[1] || '').toLowerCase().replace(/\s+/g, ' '),
    events,
    rowLevel: /\bfor\s+each\s+row\b/i.test(source),
    constraint: Boolean(match[1]),
  };
}

function parseCreateSequence(statement) {
  const pattern = new RegExp(
    `^create\\s+sequence\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED_NAME_SOURCE}`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  if (!match) return null;
  const parsed = parseQualifiedMatch(match);
  return { ...parsed, key: qualifiedKey(parsed.schema, parsed.name) };
}

function parseCreateView(statement) {
  const pattern = new RegExp(
    `^create\\s+(?:or\\s+replace\\s+)?(materialized\\s+)?view\\s+`
      + `(?:if\\s+not\\s+exists\\s+)?${QUALIFIED_NAME_SOURCE}`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  if (!match) return null;
  const parsed = parseQualifiedMatch(match, 2, 3);
  return {
    ...parsed,
    key: qualifiedKey(parsed.schema, parsed.name),
    materialized: Boolean(match[1]),
  };
}

function parseDropQualified(statement, objectType) {
  const pattern = new RegExp(
    `^drop\\s+${objectType}\\s+(?:if\\s+exists\\s+)?${QUALIFIED_NAME_SOURCE}`,
    'i'
  );
  const match = maskSqlBodies(statement).match(pattern);
  return match ? parseQualifiedMatch(match) : null;
}

function destructiveReason(statement) {
  const sql = maskSqlBodies(statement).trim();
  const rules = [
    [/\bdelete\s+from\b/i, 'DELETE FROM'],
    [/\btruncate(?:\s+table)?\b/i, 'TRUNCATE'],
    [/^drop\s+(?:owned\s+by|table|schema|view|materialized\s+view|index|sequence|type|domain|extension|function|procedure|trigger|policy)\b/i, 'DROP de objeto'],
    [/^alter\s+table\b[\s\S]*\bdrop\s+(?:column|constraint)\b/i, 'ALTER TABLE DROP'],
    [/^alter\s+table\b[\s\S]*\balter\s+column\b[\s\S]*\btype\b/i, 'alteração de tipo de coluna'],
    [/^update\b(?![\s\S]*\bwhere\b)/i, 'UPDATE sem WHERE'],
    [/^copy\b[\s\S]*\bprogram\b/i, 'COPY PROGRAM'],
  ];
  return rules.find(([pattern]) => pattern.test(sql))?.[1] || null;
}

function applyStatementToState(state, statement) {
  const table = parseCreateTable(statement);
  if (table && table.schema === 'public') state.tables.set(table.key, table);

  const fn = parseCreateFunction(statement);
  if (fn && fn.schema === 'public') state.functions.set(fn.key, fn);

  const trigger = parseCreateTrigger(statement);
  if (trigger && trigger.tableSchema === 'public') state.triggers.set(trigger.key, trigger);

  const index = parseCreateIndex(statement);
  if (index && index.tableSchema === 'public') state.indexes.set(index.key, index);

  const sequence = parseCreateSequence(statement);
  if (sequence && sequence.schema === 'public') state.sequences.set(sequence.key, sequence);

  const view = parseCreateView(statement);
  if (view && view.schema === 'public') state.views.set(view.key, view);

  const droppedTable = parseDropQualified(statement, 'table');
  if (droppedTable) state.tables.delete(qualifiedKey(droppedTable.schema, droppedTable.name));
  const droppedIndex = parseDropQualified(statement, 'index');
  if (droppedIndex) state.indexes.delete(qualifiedKey(droppedIndex.schema, droppedIndex.name));
  const droppedSequence = parseDropQualified(statement, 'sequence');
  if (droppedSequence) state.sequences.delete(qualifiedKey(droppedSequence.schema, droppedSequence.name));
  const droppedView = parseDropQualified(statement, '(?:materialized\\s+)?view');
  if (droppedView) state.views.delete(qualifiedKey(droppedView.schema, droppedView.name));

  const dropTriggerPattern = new RegExp(
    `^drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(${IDENTIFIER_SOURCE})\\s+on\\s+${QUALIFIED_NAME_SOURCE}`,
    'i'
  );
  const droppedTrigger = maskSqlBodies(statement).match(dropTriggerPattern);
  if (droppedTrigger) {
    const tableSchema = normalizeIdentifier(droppedTrigger[2] || 'public');
    const tableName = normalizeIdentifier(droppedTrigger[3]);
    state.triggers.delete(`${qualifiedKey(tableSchema, tableName)}.${normalizeIdentifier(droppedTrigger[1])}`);
  }

  const dropFunctionPattern = new RegExp(
    `^drop\\s+function\\s+(?:if\\s+exists\\s+)?${QUALIFIED_NAME_SOURCE}\\s*\\(`,
    'i'
  );
  const droppedFunction = maskSqlBodies(statement).match(dropFunctionPattern);
  if (droppedFunction) {
    const openIndex = droppedFunction[0].lastIndexOf('(');
    const closeIndex = findMatchingParenthesis(maskSqlBodies(statement), openIndex);
    const args = closeIndex >= 0
      ? normalizeIdentityArguments(maskSqlBodies(statement).slice(openIndex + 1, closeIndex))
      : '';
    const parsed = parseQualifiedMatch(droppedFunction);
    state.functions.delete(`${qualifiedKey(parsed.schema, parsed.name)}(${args})`);
  }
}

function emptySchemaState() {
  return {
    tables: new Map(),
    functions: new Map(),
    triggers: new Map(),
    indexes: new Map(),
    sequences: new Map(),
    views: new Map(),
  };
}

function buildExpectedSchema(migrations) {
  const state = emptySchemaState();
  const errors = [];
  for (const migration of migrations) {
    const parsed = splitSqlStatements(migration.sql);
    for (const error of parsed.errors) errors.push(`${migration.file}: ${error}.`);
    for (const statement of parsed.statements) applyStatementToState(state, statement);
  }
  return { ...state, errors };
}

module.exports = {
  IDENTIFIER_SOURCE,
  applyStatementToState,
  buildExpectedSchema,
  canonicalFunctionTokens,
  canonicalSqlFragment,
  destructiveReason,
  maskSqlBodies,
  functionDefinitionSemantics,
  normalizeIdentifier,
  normalizeIdentityArguments,
  parseCreateFunction,
  parseCreateIndex,
  parseCreateTable,
  parseCreateTrigger,
  parseCreateView,
  qualifiedKey,
  readDollarTag,
  splitSqlStatements,
  splitTopLevel,
};
