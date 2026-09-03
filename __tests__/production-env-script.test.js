'use strict';

const {
  projectRefFromDatabase,
  validateProductionEnv,
} = require('../scripts/check-production-env');

function legacyJwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role })}.test-signature`;
}

function validEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres:strong@db.abcdefghijk.supabase.co:5432/postgres?sslmode=verify-full',
    DATABASE_SSL: 'true',
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    SUPABASE_URL: 'https://abcdefghijk.supabase.co',
    SUPABASE_JWKS_URL: 'https://abcdefghijk.supabase.co/auth/v1/.well-known/jwks.json',
    SUPABASE_SECRET_KEY: 'sb_secret_safe_value',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_safe_value',
    PUBLIC_APP_URL: 'https://lab.example.org',
    CORS_ORIGINS: 'https://lab.example.org',
    LAB_NOME: 'Laboratório Central',
    LAB_DOCUMENTO: '00.000.000/0001-00',
    LAB_ENDERECO: 'Rua Um, 10',
    LAB_CONTATO: 'contato@lab.invalid',
    RATE_LIMIT_MAX: '600',
    SIGNATURE_RATE_LIMIT_MAX: '5',
    SIGNATURE_RATE_LIMIT_WINDOW_MS: '600000',
    SIGNATURE_TIMEOUT_MS: '7000',
    DB_POOL_MAX: '10',
    ...overrides,
  };
}

describe('pré-flight seguro de produção', () => {
  test('aprova configuração moderna coerente', () => {
    expect(validateProductionEnv(validEnvironment(), { runtimeVersion: '22.18.0' })).toEqual({
      failures: [],
      warnings: [],
    });
  });

  test('preserva projeto legado com service role, anon key e segredo HS256', () => {
    const env = validEnvironment({
      SUPABASE_SECRET_KEY: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: legacyJwt('service_role'),
      SUPABASE_ANON_KEY: legacyJwt('anon'),
      SUPABASE_JWT_SECRET: 'legacy_hs256_secret_value',
    });

    expect(validateProductionEnv(env).failures).toEqual([]);
  });

  test('reprova mistura entre projeto do banco e Auth sem revelar refs', () => {
    const env = validEnvironment({
      DATABASE_URL: 'postgresql://postgres:secret@db.zzzzzzzzzzz.supabase.co:5432/postgres',
    });
    const result = validateProductionEnv(env);

    expect(result.failures).toContain('banco PostgreSQL e SUPABASE_URL apontam para projetos diferentes');
    expect(result.failures.join(' ')).not.toContain('abcdefghijk');
    expect(result.failures.join(' ')).not.toContain('zzzzzzzzzzz');
    expect(result.failures.join(' ')).not.toContain('secret');
  });

  test('reprova TLS permissivo na URL e runtime incompatível', () => {
    const result = validateProductionEnv(validEnvironment({
      DATABASE_URL: 'postgresql://postgres:strong@db.abcdefghijk.supabase.co/postgres?sslmode=prefer',
    }), { runtimeVersion: '20.19.0' });

    expect(result.failures).toEqual(expect.arrayContaining([
      'DATABASE_URL deve usar apenas sslmode=verify-full ou sslmode=verify-ca',
      'Node.js deve estar na versão >=22 e <25',
    ]));
  });

  test.each([
    ['sslmode=no-verify', 'DATABASE_URL deve usar apenas sslmode=verify-full ou sslmode=verify-ca'],
    ['ssl=0', 'DATABASE_URL contém parâmetro TLS não permitido'],
    ['uselibpqcompat=true&sslmode=require', 'DATABASE_URL contém parâmetro TLS não permitido'],
    ['sslmode=misterioso', 'DATABASE_URL deve usar apenas sslmode=verify-full ou sslmode=verify-ca'],
    ['opcao_desconhecida=1', 'DATABASE_URL contém parâmetro de conexão não permitido'],
  ])('reprova parâmetro de conexão inseguro ou desconhecido (%s)', (query, expectedFailure) => {
    const result = validateProductionEnv(validEnvironment({
      DATABASE_URL: `postgresql://postgres:strong@db.abcdefghijk.supabase.co/postgres?${query}`,
    }));

    expect(result.failures).toContain(expectedFailure);
    expect(result.failures.join(' ')).not.toContain('strong');
  });

  test('identifica project ref em pooler pelo usuário sem devolver credenciais', () => {
    const parsed = new URL(
      'postgresql://postgres.abcdefghijk:password@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'
    );
    expect(projectRefFromDatabase(parsed)).toBe('abcdefghijk');
  });

  test('reprova chaves trocadas ou JWT legado com role incorreta sem revelar valores', () => {
    const modern = validateProductionEnv(validEnvironment({
      SUPABASE_SECRET_KEY: 'sb_publishable_wrong_class',
      SUPABASE_PUBLISHABLE_KEY: 'sb_secret_wrong_class',
    }));
    expect(modern.failures).toEqual(expect.arrayContaining([
      'chave administrativa Supabase não é Secret nem JWT service_role legado',
      'chave pública Supabase não é Publishable nem JWT anon legado',
    ]));

    const legacy = validateProductionEnv(validEnvironment({
      SUPABASE_SECRET_KEY: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: legacyJwt('anon'),
      SUPABASE_ANON_KEY: legacyJwt('service_role'),
      SUPABASE_JWT_SECRET: 'legacy_hs256_secret_value',
    }));
    expect(legacy.failures).toEqual(expect.arrayContaining([
      'chave administrativa Supabase não é Secret nem JWT service_role legado',
      'chave pública Supabase não é Publishable nem JWT anon legado',
    ]));
    expect([...modern.failures, ...legacy.failures].join(' ')).not.toContain('wrong_class');
    expect([...modern.failures, ...legacy.failures].join(' ')).not.toContain('test-signature');
  });
});
