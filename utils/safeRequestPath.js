'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HEX_PATTERN = /^[0-9a-f]{32,}$/i;
const NUMERIC_ID_PATTERN = /^\d+$/;
const OPAQUE_ID_PATTERN = /^[a-z0-9_-]{24,}$/i;

function decodedForClassification(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sensitiveSegment(segment) {
  const decoded = decodedForClassification(segment);
  return UUID_PATTERN.test(decoded)
    || LONG_HEX_PATTERN.test(decoded)
    || NUMERIC_ID_PATTERN.test(decoded)
    || OPAQUE_ID_PATTERN.test(decoded)
    || segment.length > 80;
}

function safeRequestPath(originalUrl = '') {
  const rawPath = String(originalUrl || '').split(/[?#]/, 1)[0].replace(/[\x00-\x1f\x7f]/g, '');
  const segments = rawPath.split('/');
  const verificationRoute = decodedForClassification(segments[1] || '').toLowerCase()
    === 'verificar-laudo';

  const sanitized = segments.map((segment, index) => {
    if (!segment) return segment;
    if (verificationRoute && index === 2) return ':hash';
    return sensitiveSegment(segment) ? ':id' : segment;
  }).join('/');

  return sanitized.slice(0, 300) || '/';
}

module.exports = { safeRequestPath, sensitiveSegment };
