'use strict';

const { workflowError } = require('./workflowPiloto');

const LAB_FIELDS = Object.freeze(['nome', 'documento', 'endereco', 'contato']);
const PLACEHOLDER_PATTERN = /seu[-_. ]|sua[-_. ]|exemplo|example|changeme|admin123|laborat[oó]rio emissor/i;

function configurationError() {
  return workflowError(
    'O serviço de laudos está temporariamente indisponível por configuração incompleta.',
    503,
    'REPORT_CONFIGURATION_INVALID'
  );
}

function validateLaboratoryIdentity(laboratory) {
  for (const field of LAB_FIELDS) {
    const value = String(laboratory?.[field] ?? '').trim();
    if (!value || PLACEHOLDER_PATTERN.test(value)) throw configurationError();
  }
}

function publicAppBaseUrl(value, { environment = process.env.NODE_ENV } = {}) {
  const fallback = environment === 'production' ? '' : 'http://localhost:4200';
  const configured = String(value || fallback).trim().replace(/\/+$/, '');
  if (environment !== 'production') return configured;

  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:'
        || parsed.username
        || parsed.password
        || parsed.pathname !== '/'
        || parsed.search
        || parsed.hash) {
      throw configurationError();
    }
    return parsed.origin;
  } catch (error) {
    if (error?.code === 'REPORT_CONFIGURATION_INVALID') throw error;
    throw configurationError();
  }
}

function resolveReportConfiguration({
  laboratory,
  publicAppUrl = process.env.PUBLIC_APP_URL,
  environment = process.env.NODE_ENV,
} = {}) {
  if (environment === 'production') validateLaboratoryIdentity(laboratory);
  return {
    laboratory,
    publicAppUrl: publicAppBaseUrl(publicAppUrl, { environment }),
  };
}

module.exports = {
  publicAppBaseUrl,
  resolveReportConfiguration,
  validateLaboratoryIdentity,
};
