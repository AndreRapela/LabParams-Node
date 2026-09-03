'use strict';

const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, '..', 'supabase', 'config.toml');
const source = fs.readFileSync(configPath, 'utf8');
const values = new Map();
const errors = [];
let section = '';

if (source.includes('\uFFFD') || source.includes('\0')) {
  errors.push('config.toml contém codificação inválida.');
}

for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;

  const sectionMatch = line.match(/^\[([a-z0-9_.]+)]$/i);
  if (sectionMatch) {
    section = sectionMatch[1];
    continue;
  }

  const propertyMatch = line.match(/^([a-z0-9_]+)\s*=\s*(.+)$/i);
  if (!propertyMatch) {
    errors.push(`linha ${index + 1}: sintaxe não reconhecida.`);
    continue;
  }
  const key = section ? `${section}.${propertyMatch[1]}` : propertyMatch[1];
  if (values.has(key)) errors.push(`chave duplicada: ${key}.`);
  values.set(key, propertyMatch[2].trim());
}

function expect(key, expected) {
  if (values.get(key) !== expected) errors.push(`${key} deve ser ${expected}.`);
}

expect('auth.enable_signup', 'false');
expect('auth.email.enable_signup', 'false');
expect('auth.email.enable_confirmations', 'true');
expect('auth.email.secure_password_change', 'true');
expect('auth.mfa.totp.enroll_enabled', 'true');
expect('auth.mfa.totp.verify_enabled', 'true');

const passwordLength = Number(values.get('auth.minimum_password_length'));
if (!Number.isInteger(passwordLength) || passwordLength < 12) {
  errors.push('auth.minimum_password_length deve ser no mínimo 12.');
}
expect('auth.password_requirements', '"lower_upper_letters_digits_symbols"');

if (values.get('api.auto_expose_new_tables') === 'true') {
  errors.push('api.auto_expose_new_tables não pode ser habilitado.');
}

if (errors.length > 0) {
  console.error(`Configuração Supabase reprovada (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Configuração Supabase válida: signup fechado, senha forte e TOTP disponível.');
