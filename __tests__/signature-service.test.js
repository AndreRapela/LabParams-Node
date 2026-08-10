jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const { createClient } = require('@supabase/supabase-js');
const SignatureService = require('../services/SignatureService');

describe('reautenticação para assinatura eletrônica', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test-key';
    delete process.env.SIGNATURE_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('não tenta assinar sem senha', async () => {
    await expect(SignatureService.verifyPassword({
      email: 'gestor@example.com', userId: 'user-1', password: '',
    })).rejects.toMatchObject({ statusCode: 400, code: 'REAUTENTICACAO_OBRIGATORIA' });
    expect(createClient).not.toHaveBeenCalled();
  });

  test('rejeita quando a sessão autenticada pertence a outro usuário', async () => {
    createClient.mockReturnValue({
      auth: { signInWithPassword: jest.fn().mockResolvedValue({ data: { user: { id: 'other' } }, error: null }) },
    });
    await expect(SignatureService.verifyPassword({
      email: 'gestor@example.com', userId: 'user-1', password: 'correct-password',
    })).rejects.toMatchObject({ statusCode: 401, code: 'REAUTENTICACAO_FALHOU' });
  });

  test('retorna somente evidência mínima e nunca devolve a senha', async () => {
    createClient.mockReturnValue({
      auth: { signInWithPassword: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'gestor@example.com' } }, error: null,
      }) },
    });
    const result = await SignatureService.verifyPassword({
      email: 'GESTOR@example.com', userId: 'user-1', password: 'correct-password',
    });
    expect(result).toMatchObject({
      userId: 'user-1', email: 'gestor@example.com', authMethod: 'supabase_password',
    });
    expect(result.password).toBeUndefined();
  });

  test('interrompe reautenticação que excede o timeout configurado', async () => {
    process.env.SIGNATURE_TIMEOUT_MS = '1000';
    createClient.mockReturnValue({
      auth: { signInWithPassword: jest.fn(() => new Promise(() => {})) },
    });

    await expect(SignatureService.verifyPassword({
      email: 'gestor@example.com', userId: 'user-1', password: 'correct-password',
    })).rejects.toMatchObject({ statusCode: 504, code: 'REAUTENTICACAO_TIMEOUT' });
  });

  test('traduz aborto de rede para timeout controlado', async () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    createClient.mockReturnValue({
      auth: { signInWithPassword: jest.fn().mockRejectedValue(aborted) },
    });

    await expect(SignatureService.verifyPassword({
      email: 'gestor@example.com', userId: 'user-1', password: 'correct-password',
    })).rejects.toMatchObject({ statusCode: 504, code: 'REAUTENTICACAO_TIMEOUT' });
  });

  test('não expõe erro interno quando o provedor está indisponível', async () => {
    createClient.mockReturnValue({
      auth: { signInWithPassword: jest.fn().mockRejectedValue(new Error('socket com detalhe interno')) },
    });

    await expect(SignatureService.verifyPassword({
      email: 'gestor@example.com', userId: 'user-1', password: 'correct-password',
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'REAUTENTICACAO_INDISPONIVEL',
      message: expect.not.stringContaining('socket'),
    });
  });

  test('distingue falha transitória retornada pelo cliente de senha incorreta', async () => {
    const providerError = new Error('fetch failed');
    providerError.name = 'AuthRetryableFetchError';
    providerError.status = 0;
    createClient.mockReturnValue({
      auth: { signInWithPassword: jest.fn().mockResolvedValue({
        data: { user: null }, error: providerError,
      }) },
    });

    await expect(SignatureService.verifyPassword({
      email: 'gestor@example.com', userId: 'user-1', password: 'correct-password',
    })).rejects.toMatchObject({ statusCode: 503, code: 'REAUTENTICACAO_INDISPONIVEL' });
  });
});
