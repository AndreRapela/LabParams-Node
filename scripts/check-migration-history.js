'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { MIGRATION_NAME_PATTERN } = require('./check-migrations');

const MIGRATION_PREFIX = 'supabase/migrations/';

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
}

function ensureRevisionAvailable(revision) {
  const probe = git(['cat-file', '-e', `${revision}^{commit}`]);
  if (probe.status === 0) return;
  const fetch = git(['fetch', '--no-tags', '--depth=1', 'origin', revision]);
  if (fetch.status !== 0 || git(['cat-file', '-e', `${revision}^{commit}`]).status !== 0) {
    throw new Error('SHA base não está disponível; histórico não pode ser validado com segurança.');
  }
}

function parseChanges(output) {
  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...paths] = line.split('\t');
    return { status, paths, raw: line };
  });
}

function migrationVersion(filePath) {
  const file = path.posix.basename(filePath.replace(/\\/g, '/'));
  return file.match(MIGRATION_NAME_PATTERN)?.[1] || null;
}

function validateHistory({ changes, baseFiles }) {
  const errors = [];
  const forbidden = changes.filter(({ status }) => status !== 'A');
  if (forbidden.length) {
    errors.push('Migrations existentes são imutáveis. Crie uma nova migration incremental:');
    for (const change of forbidden) errors.push(`- ${change.raw}`);
  }

  const baseVersions = baseFiles.map(migrationVersion).filter(Boolean).sort();
  const latestBaseVersion = baseVersions.at(-1) || null;
  const additions = changes.filter(({ status }) => status === 'A').map(({ paths }) => paths.at(-1));
  for (const file of additions) {
    const version = migrationVersion(file);
    if (!version) continue; // check-migrations apresenta o erro de nomenclatura.
    if (latestBaseVersion && version <= latestBaseVersion) {
      errors.push(
        `${file}: timestamp ${version} deve ser posterior à última migration da base (${latestBaseVersion}).`
      );
    }
  }

  return { errors, additions, latestBaseVersion };
}

function inspectHistory(baseRevision) {
  if (!baseRevision || !/^[0-9a-f]{7,40}$/i.test(baseRevision)) {
    throw new Error('Informe o SHA base do pull request ou push.');
  }

  if (/^0+$/.test(baseRevision)) {
    const tree = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations']);
    if (tree.status !== 0) throw new Error('Não foi possível ler as migrations do primeiro push.');
    const changes = tree.stdout.trim().split(/\r?\n/).filter(Boolean)
      .map((file) => ({ status: 'A', paths: [file], raw: `A\t${file}` }));
    return validateHistory({ changes, baseFiles: [] });
  }

  ensureRevisionAvailable(baseRevision);
  const diff = git([
    'diff', '--name-status', '--find-renames', baseRevision, 'HEAD', '--', 'supabase/migrations',
  ]);
  if (diff.status !== 0) throw new Error('Não foi possível comparar as migrations com o SHA base.');
  const tree = git(['ls-tree', '-r', '--name-only', baseRevision, '--', 'supabase/migrations']);
  if (tree.status !== 0) throw new Error('Não foi possível ler as migrations existentes no SHA base.');

  return validateHistory({
    changes: parseChanges(diff.stdout),
    baseFiles: tree.stdout.trim().split(/\r?\n/).filter(Boolean),
  });
}

function runCli() {
  try {
    const result = inspectHistory(process.argv[2]);
    if (result.errors.length) {
      console.error(`Histórico de migrations reprovado (${result.errors.length} ocorrência(s)):`);
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Histórico preservado: ${result.additions.length} nova(s) migration(s), `
        + 'nenhuma existente foi alterada ou removida.'
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Falha ao validar histórico de migrations.');
    process.exitCode = 2;
  }
}

if (require.main === module) runCli();

module.exports = {
  inspectHistory,
  migrationVersion,
  parseChanges,
  validateHistory,
};
