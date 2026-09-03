'use strict';

describe('configuração TLS do banco', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env.DATABASE_URL = '';
    process.env.DB_HOST = '';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_SSL = 'true';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'true';
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL_CA_PATH;
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  test('não confunde senha ou caminho contendo localhost com host local', () => {
    const { buildSslConfig } = require('../config/database');

    expect(buildSslConfig('postgresql://user:localhost@db.example.com/postgres'))
      .toEqual({ rejectUnauthorized: true });
    expect(buildSslConfig('postgresql://user:secret@db.example.com/localhost'))
      .toEqual({ rejectUnauthorized: true });
  });

  test.each([
    'postgresql://user:secret@localhost/postgres',
    'postgresql://user:secret@127.0.0.1/postgres',
    'postgresql://user:secret@[::1]/postgres',
  ])('desativa TLS somente para hostname loopback (%s)', (connectionString) => {
    const { buildSslConfig } = require('../config/database');
    expect(buildSslConfig(connectionString)).toBe(false);
  });

  test('URL inválida falha fechada e mantém validação TLS', () => {
    const { buildSslConfig } = require('../config/database');
    expect(buildSslConfig('credencial-localhost-sem-url')).toEqual({ rejectUnauthorized: true });
    process.env.DATABASE_SSL = 'false';
    expect(buildSslConfig('http://localhost/postgres')).toEqual({ rejectUnauthorized: true });
  });

  test('produção ignora flags permissivas e exige TLS validado inclusive em loopback', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL = 'false';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
    const { buildSslConfig } = require('../config/database');

    expect(buildSslConfig('postgresql://user:secret@db.example.com/postgres'))
      .toEqual({ rejectUnauthorized: true });
    expect(buildSslConfig('postgresql://user:secret@localhost/postgres'))
      .toEqual({ rejectUnauthorized: true });
  });

  test('produção mantém CA configurada e sempre valida o certificado', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_SSL = 'false';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
    process.env.DATABASE_SSL_CA = '-----BEGIN CERTIFICATE-----\\nconteudo\\n-----END CERTIFICATE-----';
    const { buildSslConfig } = require('../config/database');

    expect(buildSslConfig('postgresql://user:secret@db.example.com/postgres')).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nconteudo\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    });
  });

  test.each([
    'postgresql://user:secret@db.example.com/postgres?sslmode=no-verify',
    'postgresql://user:secret@db.example.com/postgres?ssl=0',
    'postgresql://user:secret@db.example.com/postgres?ssl=false',
    'postgresql://user:secret@db.example.com/postgres?uselibpqcompat=true&sslmode=require',
    'postgresql://user:secret@db.example.com/postgres?sslmode=verify-full&sslmode=no-verify',
  ])('produção rejeita parâmetro da URL que poderia neutralizar TLS (%s)', (connectionString) => {
    process.env.NODE_ENV = 'production';
    const { normalizeProductionDatabaseUrl } = require('../config/database');

    expect(() => normalizeProductionDatabaseUrl(connectionString)).toThrow(
      'DATABASE_URL contém configuração TLS não permitida'
    );
  });

  test.each(['verify-full', 'verify-ca'])(
    'remove sslmode=%s aceito para a opção ssl explícita prevalecer no pg',
    (sslmode) => {
      process.env.NODE_ENV = 'production';
      const { Client } = require('pg');
      const { buildSslConfig, normalizeProductionDatabaseUrl } = require('../config/database');
      const raw = `postgresql://user:secret@db.example.com/postgres?sslmode=${sslmode}`;
      const normalized = normalizeProductionDatabaseUrl(raw);
      const client = new Client({
        connectionString: normalized,
        ssl: buildSslConfig(normalized),
      });

      expect(normalized).not.toContain('sslmode');
      expect(client.connectionParameters.ssl).toEqual({ rejectUnauthorized: true });
    }
  );
});
