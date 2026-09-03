'use strict';

const {
  safeDatabaseFailureMessage,
  safeErrorLogFields,
} = require('../utils/safeError');

describe('sanitização de erros operacionais', () => {
  const sensitiveError = Object.assign(
    new Error('connect ENOTFOUND db.secret-project.supabase.co password=admin123'),
    { code: 'ENOTFOUND', hostname: 'db.secret-project.supabase.co' }
  );

  test('produção mantém apenas categoria e código seguro', () => {
    const fields = safeErrorLogFields(sensitiveError, { environment: 'production' });
    expect(fields).toEqual({ category: 'dns', code: 'ENOTFOUND' });
    expect(JSON.stringify(fields)).not.toContain('secret-project');
    expect(JSON.stringify(fields)).not.toContain('admin123');
  });

  test('mensagem da CLI não reutiliza error.message', () => {
    const message = safeDatabaseFailureMessage(sensitiveError);
    expect(message).toBe('Falha de resolução DNS ao conectar ao banco. Código: ENOTFOUND.');
    expect(message).not.toContain('secret-project');
    expect(message).not.toContain('admin123');
  });

  test('desenvolvimento ainda recebe diagnóstico local', () => {
    const fields = safeErrorLogFields(sensitiveError, { environment: 'development' });
    expect(fields.message).toContain('secret-project');
    expect(fields.stack).toBeTruthy();
  });
});
