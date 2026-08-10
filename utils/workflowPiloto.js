const RESULTADO_STATUS = Object.freeze([
  'rascunho',
  'em_revisao',
  'aprovado',
  'rejeitado',
  'publicado',
]);

const AMOSTRA_STATUS = Object.freeze([
  'recebida',
  'em_triagem',
  'em_analise',
  'aguardando_revisao',
  'concluida',
  'rejeitada',
  'cancelada',
]);

const PEDIDO_STATUS = Object.freeze([
  'rascunho',
  'recebido',
  'em_execucao',
  'concluido',
  'cancelado',
]);

const resultadoTransitions = Object.freeze({
  rascunho: ['em_revisao'],
  em_revisao: ['aprovado', 'rejeitado'],
  aprovado: ['publicado', 'rascunho'],
  rejeitado: ['rascunho'],
  publicado: [],
});

const amostraTransitions = Object.freeze({
  recebida: ['em_triagem', 'em_analise', 'rejeitada', 'cancelada'],
  em_triagem: ['em_analise', 'rejeitada', 'cancelada'],
  em_analise: ['aguardando_revisao', 'cancelada'],
  aguardando_revisao: ['em_analise', 'concluida', 'cancelada'],
  concluida: [],
  rejeitada: [],
  cancelada: [],
});

const pedidoTransitions = Object.freeze({
  rascunho: ['recebido', 'cancelado'],
  recebido: ['em_execucao', 'cancelado'],
  em_execucao: ['concluido', 'cancelado'],
  concluido: [],
  cancelado: [],
});

function workflowError(message, statusCode = 409, code = 'TRANSICAO_INVALIDA') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertTransition(map, currentStatus, nextStatus, label) {
  if (!Object.prototype.hasOwnProperty.call(map, currentStatus)) {
    throw workflowError(`Estado atual de ${label} inválido: ${currentStatus}`, 422);
  }

  if (!Object.prototype.hasOwnProperty.call(map, nextStatus)) {
    throw workflowError(`Novo estado de ${label} inválido: ${nextStatus}`, 422);
  }

  if (!map[currentStatus].includes(nextStatus)) {
    throw workflowError(
      `Não é permitido alterar ${label} de "${currentStatus}" para "${nextStatus}".`
    );
  }

  return true;
}

function assertResultadoTransition(currentStatus, nextStatus) {
  return assertTransition(resultadoTransitions, currentStatus, nextStatus, 'o resultado');
}

function assertAmostraTransition(currentStatus, nextStatus) {
  return assertTransition(amostraTransitions, currentStatus, nextStatus, 'a amostra');
}

function assertPedidoTransition(currentStatus, nextStatus) {
  return assertTransition(pedidoTransitions, currentStatus, nextStatus, 'o pedido');
}

function requireComment(value, action) {
  const comment = String(value ?? '').trim();
  if (comment.length < 3) {
    throw workflowError(`Informe um comentário para ${action}.`, 400, 'COMENTARIO_OBRIGATORIO');
  }
  if (comment.length > 2_000) {
    throw workflowError('O comentário deve ter no máximo 2.000 caracteres.', 400, 'COMENTARIO_LONGO');
  }
  return comment;
}

function optionalComment(value) {
  const comment = String(value ?? '').trim();
  if (comment.length > 2_000) {
    throw workflowError('O comentário deve ter no máximo 2.000 caracteres.', 400, 'COMENTARIO_LONGO');
  }
  return comment || null;
}

function parsePagination(query = {}) {
  const requested = query.page !== undefined || query.page_size !== undefined;
  if (!requested) return null;

  const page = Number(query.page ?? 1);
  const pageSize = Number(query.page_size ?? 25);
  if (!Number.isInteger(page) || page < 1) {
    throw workflowError('page deve ser um inteiro maior que zero.', 400, 'PAGINACAO_INVALIDA');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw workflowError('page_size deve ser um inteiro entre 1 e 100.', 400, 'PAGINACAO_INVALIDA');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

module.exports = {
  AMOSTRA_STATUS,
  PEDIDO_STATUS,
  RESULTADO_STATUS,
  assertAmostraTransition,
  assertPedidoTransition,
  assertResultadoTransition,
  optionalComment,
  parsePagination,
  requireComment,
  workflowError,
};
