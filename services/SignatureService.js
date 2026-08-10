const { createClient } = require('@supabase/supabase-js');
const { workflowError } = require('../utils/workflowPiloto');

class SignatureService {
  static async verifyPassword({ email, userId, password }) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const suppliedPassword = String(password ?? '');

    if (!normalizedEmail || normalizedEmail.length > 320
        || !userId || !suppliedPassword || suppliedPassword.length > 200) {
      throw workflowError(
        'Informe sua senha para confirmar a assinatura eletrônica.',
        400,
        'REAUTENTICACAO_OBRIGATORIA'
      );
    }

    const url = process.env.SUPABASE_URL;
    const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !publicKey) {
      throw workflowError(
        'Reautenticação indisponível: configure a chave pública do Supabase.',
        503,
        'REAUTENTICACAO_NAO_CONFIGURADA'
      );
    }

    const configuredTimeout = Number(process.env.SIGNATURE_TIMEOUT_MS ?? 7_000);
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.min(15_000, Math.max(1_000, configuredTimeout))
      : 7_000;
    const timedFetch = async (input, init = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal = init.signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
      try {
        return await fetch(input, { ...init, signal });
      } finally {
        clearTimeout(timer);
      }
    };
    const client = createClient(url, publicKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: timedFetch },
    });

    let timeoutId;
    let authResult;
    try {
      authResult = await Promise.race([
        client.auth.signInWithPassword({
          email: normalizedEmail,
          password: suppliedPassword,
        }),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(workflowError(
            'O serviço de autenticação não respondeu a tempo. Tente novamente.',
            504,
            'REAUTENTICACAO_TIMEOUT'
          )), timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error?.code === 'REAUTENTICACAO_TIMEOUT') throw error;
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
        throw workflowError(
          'O serviço de autenticação não respondeu a tempo. Tente novamente.',
          504,
          'REAUTENTICACAO_TIMEOUT'
        );
      }
      throw workflowError(
        'O serviço de autenticação está temporariamente indisponível. Tente novamente.',
        503,
        'REAUTENTICACAO_INDISPONIVEL'
      );
    } finally {
      clearTimeout(timeoutId);
    }
    const { data, error } = authResult;

    if (error?.name === 'AuthRetryableFetchError' || Number(error?.status) >= 500) {
      const timedOut = /abort|timeout|timed out/i.test(String(error.message ?? ''));
      throw workflowError(
        timedOut
          ? 'O serviço de autenticação não respondeu a tempo. Tente novamente.'
          : 'O serviço de autenticação está temporariamente indisponível. Tente novamente.',
        timedOut ? 504 : 503,
        timedOut ? 'REAUTENTICACAO_TIMEOUT' : 'REAUTENTICACAO_INDISPONIVEL'
      );
    }

    if (error || !data?.user || data.user.id !== userId) {
      throw workflowError(
        'Não foi possível confirmar sua identidade. Verifique a senha.',
        401,
        'REAUTENTICACAO_FALHOU'
      );
    }

    return {
      userId: data.user.id,
      email: data.user.email,
      authMethod: 'supabase_password',
      authenticatedAt: new Date().toISOString(),
    };
  }
}

module.exports = SignatureService;
