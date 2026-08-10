jest.mock('../config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const { createHash } = require('crypto');
const pool = require('../config/database');
const { canonicalStringify } = require('../utils/canonicalJson');
const LaudoModel = require('../models/LaudoModel');

function hash(value) {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function signedReportRow() {
  const snapshot = {
    documento: { id: '7', numero: 'LAU-001-V1', versao: 1 },
    laboratorio: { nome: 'Laboratório Exemplo' },
    amostra: { codigo_amostra: 'DADO-PRIVADO', numero_da_amostra: 'PRIVADO-1' },
    resultados: [{ parametro: 'pH', valor_medido: 7 }],
  };
  const conteudoHash = hash(snapshot);
  const signedEntityHash = hash({ snapshot, conteudo_hash: conteudoHash });
  const signature = {
    actorUserId: '7aa03144-b26b-46fa-b85e-fb5d9fb4d654',
    entityType: 'laudo_analitico',
    entityId: '7',
    action: 'REPORT_ISSUE',
    authMethod: 'supabase_password',
    authenticatedAt: '2026-07-29T14:00:00.000Z',
    signedAt: '2026-07-29T14:00:01.000Z',
    snapshotHash: signedEntityHash,
    requestId: null,
    nonce: 'f0b8d1ad-79b5-4a67-82a6-c3fedfb32e13',
  };

  return {
    id: '7',
    numero: 'LAU-001-V1',
    versao: 1,
    emitido_em: '2026-07-29T14:00:01.000Z',
    conteudo_hash: conteudoHash,
    assinatura_id: '11',
    snapshot,
    laboratorio_nome: 'Laboratório Exemplo',
    total_resultados: 1,
    assinatura_signer_user_id: signature.actorUserId,
    assinatura_entity_type: signature.entityType,
    assinatura_entity_id: signature.entityId,
    assinatura_action: signature.action,
    assinatura_auth_method: signature.authMethod,
    assinatura_authenticated_at: signature.authenticatedAt,
    assinatura_signed_at: signature.signedAt,
    assinatura_payload_hash: hash(signature),
    assinatura_request_id: null,
    assinatura_metadata: {
      snapshot_hash: signedEntityHash,
      nonce: signature.nonce,
    },
  };
}

describe('verificação pública de laudos', () => {
  beforeEach(() => jest.clearAllMocks());

  test('recalcula conteúdo e assinatura sem expor identificadores da amostra', async () => {
    const row = signedReportRow();
    pool.query.mockResolvedValue({ rows: [row] });

    const report = await LaudoModel.verify(row.conteudo_hash);

    expect(report).toMatchObject({
      numero: 'LAU-001-V1',
      integridade_conteudo_valida: true,
      assinatura_valida: true,
      integridade_valida: true,
    });
    expect(report).not.toHaveProperty('snapshot');
    expect(report).not.toHaveProperty('codigo_amostra');
    expect(report).not.toHaveProperty('numero_da_amostra');
  });

  test('marca como inválido quando o snapshot armazenado foi adulterado', async () => {
    const row = signedReportRow();
    row.snapshot.resultados[0].valor_medido = 9;
    pool.query.mockResolvedValue({ rows: [row] });

    const report = await LaudoModel.verify(row.conteudo_hash);

    expect(report.integridade_conteudo_valida).toBe(false);
    expect(report.assinatura_valida).toBe(false);
    expect(report.integridade_valida).toBe(false);
  });

  test('valida a assinatura também na consulta interna do laudo', async () => {
    const row = signedReportRow();
    pool.query.mockImplementation(async (sql) => {
      expect(sql).toContain('s.id as assinatura_id');
      return { rows: [row] };
    });

    const report = await LaudoModel.findById(row.id);

    expect(report).toMatchObject({
      assinatura_valida: true,
      integridade_valida: true,
      assinatura: { id: '11', valida: true },
    });
  });

  test('invalida assinatura cuja reautenticação excedeu cinco minutos', async () => {
    const row = signedReportRow();
    row.assinatura_authenticated_at = '2026-07-29T13:50:00.000Z';
    pool.query.mockResolvedValue({ rows: [row] });

    const report = await LaudoModel.verify(row.conteudo_hash);

    expect(report.assinatura_valida).toBe(false);
    expect(report.integridade_valida).toBe(false);
  });

  test('rejeita hash malformado sem consultar o banco', async () => {
    await expect(LaudoModel.verify('invalido')).rejects.toMatchObject({
      statusCode: 400,
      code: 'HASH_INVALIDO',
    });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
