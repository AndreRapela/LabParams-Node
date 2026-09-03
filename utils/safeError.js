'use strict';

const logger = require('./logger');

function safeErrorCode(error) {
  const code = String(error?.code || '').trim();
  return /^[A-Z0-9_]{1,40}$/i.test(code) ? code.toUpperCase() : 'UNKNOWN';
}

function errorCategory(error) {
  const code = safeErrorCode(error);
  if (['DATABASE_NOT_CONFIGURED', 'REPORT_CONFIGURATION_INVALID'].includes(code)) {
    return 'configuration';
  }
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'dns';
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) return 'timeout';
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(code)) return 'connection';
  if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) {
    return 'tls';
  }
  if (code.startsWith('28')) return 'authentication';
  if (code === '57P03') return 'database_unavailable';
  if (code.startsWith('23')) return 'constraint';
  if (code.startsWith('42') || code === '3D000') return 'schema';
  return 'database';
}

function safeErrorLogFields(error, {
  environment = process.env.NODE_ENV,
} = {}) {
  const fields = {
    category: errorCategory(error),
    code: safeErrorCode(error),
  };
  if (environment === 'development') {
    fields.message = error instanceof Error ? error.message : String(error || 'Erro desconhecido');
    fields.stack = error instanceof Error ? error.stack : undefined;
  }
  return fields;
}

function safeDatabaseFailureMessage(error) {
  const category = errorCategory(error);
  const messages = {
    configuration: 'Banco de dados não configurado.',
    dns: 'Falha de resolução DNS ao conectar ao banco.',
    timeout: 'Tempo limite ao conectar ou consultar o banco.',
    connection: 'Não foi possível estabelecer conexão com o banco.',
    tls: 'A validação TLS da conexão com o banco falhou.',
    authentication: 'O banco rejeitou a autenticação.',
    database_unavailable: 'O banco está temporariamente indisponível.',
    constraint: 'O banco encontrou uma violação de integridade.',
    schema: 'O esquema do banco não corresponde ao esperado.',
    database: 'Não foi possível verificar o banco.',
  };
  return `${messages[category]} Código: ${safeErrorCode(error)}.`;
}

function logSafeError(event, error, fields = {}) {
  logger.error(event, {
    ...fields,
    ...safeErrorLogFields(error),
  });
}

module.exports = {
  errorCategory,
  logSafeError,
  safeDatabaseFailureMessage,
  safeErrorCode,
  safeErrorLogFields,
};
