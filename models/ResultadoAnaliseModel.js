const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const AmostraModel = require('./AmostraModel');
const AssinaturaEletronicaModel = require('./AssinaturaEletronicaModel');
const { avaliarConformidade, avaliarStatusOperacional } = require('../utils/conformidade');
const {
  RESULTADO_STATUS,
  assertResultadoTransition,
  optionalComment,
  parsePagination,
  requireComment,
  workflowError,
} = require('../utils/workflowPiloto');

class ResultadoAnaliseModel {
  static async create(dados, auditContext = {}) {
    return this.salvar(null, dados, auditContext);
  }

  static async update(id, dados, auditContext = {}) {
    return this.salvar(id, dados, auditContext);
  }

  static async salvar(id, dados, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let original = null;
      let amostra = null;
      if (id) {
        const locator = await client.query(
          'select amostra_id from resultado_analise where id = $1 and deleted_at is null',
          [id]
        );
        if (!locator.rows[0]) throw workflowError('Resultado não encontrado.', 404, 'NAO_ENCONTRADO');
        if (Number(dados.amostra_id) !== Number(locator.rows[0].amostra_id)) {
          throw workflowError(
            'A amostra de um resultado existente não pode ser alterada.',
            409,
            'IDENTIDADE_RESULTADO_IMUTAVEL'
          );
        }
        amostra = await this.verificarAmostraExiste(locator.rows[0].amostra_id, client, true);
        const originalResult = await client.query(
          'select * from resultado_analise where id = $1 and deleted_at is null for update',
          [id]
        );
        original = originalResult.rows[0];
        if (!original) throw workflowError('Resultado não encontrado.', 404, 'NAO_ENCONTRADO');
        if (!['rascunho', 'rejeitado'].includes(original.status_resultado)) {
          throw workflowError(
            `O resultado no estado "${original.status_resultado}" está bloqueado para edição.`,
            409,
            'RESULTADO_BLOQUEADO'
          );
        }
        if (Number(original.amostra_id) !== Number(amostra?.id)) {
          throw workflowError('O resultado foi alterado por outra operação. Tente novamente.', 409, 'CONFLITO');
        }
        if (Number(dados.parametro_id) !== Number(original.parametro_id)) {
          throw workflowError(
            'O parâmetro de um resultado existente não pode ser alterado.',
            409,
            'IDENTIDADE_RESULTADO_IMUTAVEL'
          );
        }
      } else {
        amostra = await this.verificarAmostraExiste(dados.amostra_id, client, true);
      }

      const parametro = await this.verificarParametroExiste(dados.parametro_id, client);
      if (!amostra) throw workflowError('Amostra não existe.', 400, 'AMOSTRA_INVALIDA');
      if (['concluida', 'rejeitada', 'cancelada'].includes(amostra.status_amostra)) {
        throw workflowError(
          `Não é possível registrar resultados em amostra ${amostra.status_amostra}.`,
          409,
          'AMOSTRA_BLOQUEADA'
        );
      }
      if (!parametro) {
        throw workflowError('Parâmetro legal não existe ou está inativo.', 400, 'PARAMETRO_INVALIDO');
      }

      const assignment = await client.query(`
        select metodo_analitico_id
        from amostra_parametro
        where amostra_id = $1 and parametro_id = $2
      `, [amostra.id, parametro.id]);
      if (!assignment.rows[0]) {
        throw workflowError(
          'O parâmetro não faz parte do escopo cadastrado para esta amostra.',
          409,
          'PARAMETRO_FORA_DO_ESCOPO'
        );
      }

      this.validarCombinacaoLegal(dados, amostra, parametro);
      const metodo = await this.verificarMetodo(
        dados.metodo_analitico_id || assignment.rows[0].metodo_analitico_id,
        parametro,
        amostra,
        client
      );
      const valores = this.validarValor(dados, parametro);
      const dataColeta = this.validarDataColeta(dados.datacoleta);
      const legislacao = `${parametro.legislacao_nome} (${parametro.legislacao_sigla}) — ${parametro.contexto_nome}`;
      const status = id && original.status_resultado === 'rejeitado'
        ? 'rascunho'
        : (original?.status_resultado || 'rascunho');
      const version = id ? Number(original.versao) + 1 : 1;
      const analyticalSnapshot = this.buildAnalyticalSnapshot({
        version,
        values: valores,
        collectedAt: dataColeta,
        sample: amostra,
        parameter: parametro,
        method: metodo,
      });

      const fields = [
        valores.valor_medido,
        valores.valor_qualitativo,
        amostra.id,
        parametro.id,
        parametro.contexto_legislacao_id,
        dataColeta,
        amostra.codigo_amostra,
        amostra.numero_da_amostra,
        amostra.matriz_nome,
        legislacao,
        parametro.limite_minimo,
        parametro.limite_maximo,
        parametro.tipo_limite,
        parametro.criterio_texto,
        parametro.fonte_referencia,
        metodo?.id || null,
        status,
        parametro.nome,
        parametro.unidade_medida,
        JSON.stringify(analyticalSnapshot.metodo),
        JSON.stringify(analyticalSnapshot),
      ];

      const query = id
        ? `
          update resultado_analise set
            valor_medido = $1, valor_qualitativo = $2, amostra_id = $3,
            parametro_id = $4, contexto_legislacao_id = $5, datacoleta = $6,
            datadapublicacao = null, codigodaamostra = $7, numerodaamostra = $8,
            matriz = $9, legislacao = $10, limite_minimo_aplicado = $11,
            limite_maximo_aplicado = $12, tipo_limite_aplicado = $13,
            criterio_legal_aplicado = $14, fonte_legal_aplicada = $15,
            metodo_analitico_id = $16, status_resultado = $17,
            parametro_nome_aplicado = $18, unidade_medida_aplicada = $19,
            metodo_snapshot = $20::jsonb, snapshot_analitico = $21::jsonb,
            versao = versao + 1, submetido_em = null, submetido_por = null,
            aprovado_em = null, aprovado_por = null, publicado_em = null,
            publicado_por = null, rejeitado_em = null, rejeitado_por = null,
            ultimo_comentario = null
          where id = $22 and deleted_at is null
          returning *
        `
        : `
          insert into resultado_analise (
            valor_medido, valor_qualitativo, amostra_id, parametro_id,
            contexto_legislacao_id, datacoleta, datadapublicacao,
            codigodaamostra, numerodaamostra, matriz, legislacao,
            limite_minimo_aplicado, limite_maximo_aplicado,
            tipo_limite_aplicado, criterio_legal_aplicado, fonte_legal_aplicada,
            metodo_analitico_id, status_resultado, parametro_nome_aplicado,
            unidade_medida_aplicada, metodo_snapshot, snapshot_analitico, versao
          ) values (
            $1, $2, $3, $4, $5, $6, null, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, 1
          )
          returning *
        `;

      if (id) fields.push(id);
      const result = await client.query(query, fields);
      const saved = result.rows[0];

      await client.query(`
        insert into resultado_versao_snapshot (
          resultado_id, versao, snapshot_analitico, criado_por, request_id
        ) values ($1, $2, $3::jsonb, $4, $5)
      `, [
        saved.id,
        saved.versao,
        JSON.stringify(analyticalSnapshot),
        auditContext.actorUserId || null,
        auditContext.requestId || null,
      ]);

      await client.query(`
        insert into resultado_workflow_evento (
          resultado_id, status_anterior, status_novo, decisao, comentario,
          actor_user_id, request_id, metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `, [
        saved.id,
        original?.status_resultado || null,
        saved.status_resultado,
        id ? 'edicao' : 'criacao',
        id && original?.status_resultado === 'rejeitado'
          ? 'Resultado corrigido após rejeição.'
          : null,
        auditContext.actorUserId || null,
        auditContext.requestId || null,
        JSON.stringify({ versao: saved.versao }),
      ]);

      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: id ? 'UPDATE' : 'CREATE',
        entityType: 'resultado_analise',
        entityId: saved.id,
        beforeData: original,
        afterData: saved,
      });

      if (!id && ['recebida', 'em_triagem'].includes(amostra.status_amostra)) {
        await AmostraModel.applyStatusTransition(
          client,
          amostra,
          'em_analise',
          { automatico: true, observacao: 'Análise iniciada com o primeiro resultado.' },
          auditContext
        );
      }

      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505'
          && error.constraint === 'resultado_amostra_parametro_active_uidx') {
        throw workflowError(
          'Já existe um resultado ativo para este parâmetro na amostra.',
          409,
          'RESULTADO_DUPLICADO'
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  static buildAnalyticalSnapshot({ version, values, collectedAt, sample, parameter, method }) {
    const statusOperacional = avaliarStatusOperacional({
      valor_medido: values.valor_medido,
      valor_qualitativo: values.valor_qualitativo,
      limite_minimo: parameter.limite_minimo,
      limite_maximo: parameter.limite_maximo,
      tipo_limite: parameter.tipo_limite,
    });

    return {
      schema_version: 1,
      versao_resultado: Number(version),
      valor_medido: values.valor_medido,
      valor_qualitativo: values.valor_qualitativo,
      status_operacional: statusOperacional,
      datacoleta: collectedAt,
      parametro: {
        id: parameter.id,
        nome: parameter.nome,
        unidade_medida: parameter.unidade_medida,
        tipo_resultado: parameter.tipo_resultado,
        categoria: parameter.categoria,
      },
      matriz: {
        id: sample.matriz_id,
        nome: sample.matriz_nome,
      },
      referencia_legal: {
        legislacao_id: parameter.legislacao_id,
        legislacao_nome: parameter.legislacao_nome,
        legislacao_sigla: parameter.legislacao_sigla,
        contexto_id: parameter.contexto_legislacao_id,
        contexto_codigo: parameter.contexto_codigo,
        contexto_nome: parameter.contexto_nome,
        limite_minimo: parameter.limite_minimo,
        limite_maximo: parameter.limite_maximo,
        tipo_limite: parameter.tipo_limite,
        criterio: parameter.criterio_texto,
        fonte: parameter.fonte_referencia,
      },
      metodo: method ? {
        id: method.id,
        codigo: method.codigo,
        nome: method.nome,
        versao: method.versao,
        referencia_normativa: method.referencia_normativa,
        principio: method.principio,
        procedimento_resumido: method.procedimento_resumido,
        unidade_resultado: method.unidade_resultado,
        limite_deteccao: method.limite_deteccao,
        limite_quantificacao: method.limite_quantificacao,
        incerteza_padrao: method.incerteza_padrao,
      } : null,
    };
  }

  static parseAnalyticalSnapshot(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  static withSnapshotPresentation(row) {
    const snapshot = this.parseAnalyticalSnapshot(row.snapshot_analitico);
    if (!snapshot) return row;

    const parameter = snapshot.parametro ?? {};
    const matrix = snapshot.matriz ?? {};
    const legal = snapshot.referencia_legal ?? {};
    const method = snapshot.metodo ?? {};
    return {
      ...row,
      parametro_nome: parameter.nome ?? row.parametro_nome_aplicado ?? null,
      unidade_medida: parameter.unidade_medida ?? row.unidade_medida_aplicada ?? null,
      tipo_resultado: parameter.tipo_resultado ?? null,
      matriz_nome: matrix.nome ?? null,
      limite_minimo: legal.limite_minimo ?? null,
      limite_maximo: legal.limite_maximo ?? null,
      tipo_limite: legal.tipo_limite ?? null,
      criterio_legal: legal.criterio ?? null,
      fonte_legal: legal.fonte ?? null,
      legislacao_sigla: legal.legislacao_sigla ?? null,
      legislacao_nome: legal.legislacao_nome ?? null,
      contexto_codigo: legal.contexto_codigo ?? null,
      contexto_nome: legal.contexto_nome ?? null,
      metodo_codigo: method.codigo ?? null,
      metodo_nome: method.nome ?? null,
      metodo_versao: method.versao ?? null,
      referencia_normativa: method.referencia_normativa ?? null,
    };
  }

  static signedSnapshot(result, nextStatus) {
    const analyticalSnapshot = this.parseAnalyticalSnapshot(result.snapshot_analitico);
    if (!analyticalSnapshot) {
      throw workflowError(
        'O resultado não possui snapshot analítico válido.',
        409,
        'SNAPSHOT_ANALITICO_INVALIDO'
      );
    }
    if (Number(analyticalSnapshot.versao_resultado) !== Number(result.versao)
        || Number(analyticalSnapshot.parametro?.id) !== Number(result.parametro_id)) {
      throw workflowError(
        'O snapshot analítico não corresponde à versão atual do resultado.',
        409,
        'SNAPSHOT_ANALITICO_DIVERGENTE'
      );
    }
    return {
      schema_version: 1,
      resultado_id: result.id,
      versao_resultado: Number(result.versao),
      status_origem: result.status_resultado,
      status_destino: nextStatus,
      snapshot_analitico: analyticalSnapshot,
    };
  }

  static assertMakerChecker(result, actorUserId) {
    if (result.submetido_por && String(result.submetido_por) === String(actorUserId)) {
      throw workflowError(
        'Quem submeteu o resultado não pode revisar a mesma versão.',
        409,
        'MAKER_CHECKER_OBRIGATORIO'
      );
    }
    return true;
  }

  static validarCombinacaoLegal(dados, amostra, parametro) {
    if (Number(amostra.matriz_id) !== Number(parametro.matriz_id)) {
      throw workflowError('O parâmetro não pertence à matriz da amostra selecionada.', 400);
    }
    if (dados.matriz_id_selecionada && Number(dados.matriz_id_selecionada) !== Number(amostra.matriz_id)) {
      throw workflowError('A matriz selecionada não corresponde à matriz da amostra.', 400);
    }
    if (dados.legislacao_id_selecionada && Number(dados.legislacao_id_selecionada) !== Number(parametro.legislacao_id)) {
      throw workflowError('O parâmetro não pertence à legislação selecionada.', 400);
    }
    if (dados.contexto_legislacao_id && Number(dados.contexto_legislacao_id) !== Number(parametro.contexto_legislacao_id)) {
      throw workflowError('O parâmetro não pertence à classe ou contexto legal selecionado.', 400);
    }
  }

  static validarValor(dados, parametro) {
    if (parametro.tipo_resultado === 'qualitativo') {
      const valor = String(dados.valor_qualitativo ?? '').trim();
      if (!['Ausente', 'Presente'].includes(valor)) {
        throw workflowError('Selecione Ausente ou Presente para este parâmetro.', 400);
      }
      return { valor_medido: null, valor_qualitativo: valor };
    }
    const rawValue = String(dados.valor_medido ?? '').trim();
    if (!rawValue) {
      throw workflowError('Informe o valor medido.', 400, 'VALOR_OBRIGATORIO');
    }
    const valor = Number(rawValue.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      throw workflowError('Valor medido inválido.', 400);
    }
    return { valor_medido: valor, valor_qualitativo: null };
  }

  static validarDataColeta(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) throw workflowError('Data de coleta inválida.', 400);
    if (date > new Date()) throw workflowError('A data de coleta não pode ser futura.', 400);
    return date.toISOString();
  }

  static async findAll(options = {}) {
    const pagination = parsePagination(options);
    const values = [];
    const filters = ['ra.deleted_at is null', 'a.deleted_at is null'];
    const add = (sql, value) => {
      values.push(value);
      filters.push(`${sql} $${values.length}`);
    };

    if (options.status && options.status_resultado && options.status !== options.status_resultado) {
      throw workflowError('Informe apenas um status de resultado.', 400, 'FILTRO_INVALIDO');
    }
    const requestedStatus = options.status ?? options.status_resultado;
    if (requestedStatus) {
      if (!RESULTADO_STATUS.includes(requestedStatus)) {
        throw workflowError('Status de resultado inválido.', 400, 'FILTRO_INVALIDO');
      }
      add('ra.status_resultado =', requestedStatus);
    }
    if (options.amostra_id) add('ra.amostra_id =', options.amostra_id);
    if (options.parametro_id) add('ra.parametro_id =', options.parametro_id);
    if (options.q) {
      values.push(`%${String(options.q).trim().slice(0, 100)}%`);
      filters.push(`(
        a.codigo_amostra ilike $${values.length}
        or a.numero_da_amostra ilike $${values.length}
        or ra.parametro_nome_aplicado ilike $${values.length}
      )`);
    }

    let limit = '';
    if (pagination) {
      values.push(pagination.pageSize, pagination.offset);
      limit = `limit $${values.length - 1} offset $${values.length}`;
    }

    const result = await pool.query(`
      select ra.*, a.codigo_amostra as amostra_codigo,
        a.numero_da_amostra as amostra_numero, a.status_amostra,
        count(*) over()::int as total_count
      from resultado_analise ra
      join amostra a on ra.amostra_id = a.id
      where ${filters.join(' and ')}
      order by ra.created_at desc
      ${limit}
    `, values);
    const total = result.rows[0]?.total_count ?? 0;
    const rows = result.rows.map(({ total_count, ...row }) => {
      const presented = this.withSnapshotPresentation(row);
      return { ...presented, status_conformidade: avaliarConformidade(presented) };
    });
    return pagination
      ? { rows, total, page: pagination.page, pageSize: pagination.pageSize }
      : rows;
  }

  static async findById(id) {
    const { rows } = await pool.query(`
      select ra.*, a.codigo_amostra as amostra_codigo,
             a.numero_da_amostra as amostra_numero, a.status_amostra
      from resultado_analise ra
      join amostra a on ra.amostra_id = a.id and a.deleted_at is null
      where ra.id = $1 and ra.deleted_at is null
    `, [id]);
    if (!rows[0]) return null;
    const presented = this.withSnapshotPresentation(rows[0]);
    return { ...presented, status_conformidade: avaliarConformidade(presented) };
  }

  static async delete(id, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const originalResult = await client.query(
        'select * from resultado_analise where id = $1 and deleted_at is null for update',
        [id]
      );
      const original = originalResult.rows[0];
      if (!original) {
        await client.query('ROLLBACK');
        return false;
      }
      if (['em_revisao', 'aprovado', 'publicado'].includes(original.status_resultado)) {
        throw workflowError(
          `O resultado no estado "${original.status_resultado}" não pode ser arquivado.`,
          409,
          'RETENCAO_OBRIGATORIA'
        );
      }
      const { rows } = await client.query(`
        update resultado_analise set
          deleted_at = timezone('utc', now()), deleted_by = $2, deletion_reason = $3
        where id = $1 and deleted_at is null
        returning *
      `, [id, auditContext.actorUserId || null, auditContext.reason || 'Arquivado pela interface']);
      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: 'ARCHIVE',
        entityType: 'resultado_analise',
        entityId: id,
        beforeData: original,
        afterData: rows[0],
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async submit(id, comment, auditContext = {}) {
    return this.transition(id, 'em_revisao', {
      decision: 'submissao',
      comment: optionalComment(comment),
      action: 'SUBMIT',
    }, auditContext);
  }

  static async review(id, decision, comment, signatureContext, auditContext = {}) {
    if (!['aprovar', 'rejeitar'].includes(decision)) {
      throw workflowError('Decisão de revisão inválida.', 400, 'DECISAO_INVALIDA');
    }
    const approved = decision === 'aprovar';
    return this.transition(id, approved ? 'aprovado' : 'rejeitado', {
      decision: approved ? 'aprovacao' : 'rejeicao',
      comment: requireComment(comment, approved ? 'aprovar o resultado' : 'rejeitar o resultado'),
      action: approved ? 'APPROVE' : 'REJECT',
      signatureContext,
    }, auditContext);
  }

  static async publish(id, comment, signatureContext, auditContext = {}) {
    return this.transition(id, 'publicado', {
      decision: 'publicacao',
      comment: optionalComment(comment),
      action: 'PUBLISH',
      signatureContext,
    }, auditContext);
  }

  static async reopen(id, comment, signatureContext, auditContext = {}) {
    return this.transition(id, 'rascunho', {
      decision: 'reabertura',
      comment: requireComment(comment, 'reabrir o resultado'),
      action: 'REOPEN',
      signatureContext,
    }, auditContext);
  }

  static async transition(id, nextStatus, details, auditContext = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locator = await client.query(
        'select amostra_id from resultado_analise where id = $1 and deleted_at is null',
        [id]
      );
      if (!locator.rows[0]) {
        throw workflowError('Resultado nao encontrado.', 404, 'NAO_ENCONTRADO');
      }
      await client.query(
        'select id from amostra where id = $1 and deleted_at is null for update',
        [locator.rows[0].amostra_id]
      );
      const currentResult = await client.query(
        'select * from resultado_analise where id = $1 and deleted_at is null for update',
        [id]
      );
      const current = currentResult.rows[0];
      if (!current) throw workflowError('Resultado não encontrado.', 404, 'NAO_ENCONTRADO');
      if (Number(current.amostra_id) !== Number(locator.rows[0].amostra_id)) {
        throw workflowError('O resultado foi alterado por outra operacao. Tente novamente.', 409, 'CONFLITO');
      }
      assertResultadoTransition(current.status_resultado, nextStatus);

      if (['APPROVE', 'REJECT'].includes(details.action)) {
        this.assertMakerChecker(current, auditContext.actorUserId);
      }

      if (nextStatus === 'em_revisao') {
        if (!current.metodo_analitico_id) {
          throw workflowError(
            'Selecione o método analítico antes de enviar o resultado para revisão.',
            409,
            'METODO_OBRIGATORIO'
          );
        }
        const activeMethod = await client.query(
          'select 1 from metodo_analitico where id=$1 and ativo=true for share',
          [current.metodo_analitico_id]
        );
        if (!activeMethod.rowCount) {
          throw workflowError(
            'O método analítico deste resultado está inativo.',
            409,
            'METODO_INATIVO'
          );
        }
        const evidence = this.signedSnapshot(current, nextStatus);
        if (!evidence.snapshot_analitico.metodo
            || Number(evidence.snapshot_analitico.metodo.id) !== Number(current.metodo_analitico_id)) {
          throw workflowError(
            'O snapshot analitico nao contem o metodo selecionado.',
            409,
            'SNAPSHOT_ANALITICO_INCOMPLETO'
          );
        }
      }

      let signature = null;
      if (['APPROVE', 'REJECT', 'PUBLISH', 'REOPEN'].includes(details.action)) {
        if (!details.signatureContext || details.signatureContext.userId !== auditContext.actorUserId) {
          throw workflowError('Assinatura eletrônica não confirmada.', 401, 'ASSINATURA_OBRIGATORIA');
        }
        const entitySnapshot = {
          ...this.signedSnapshot(current, nextStatus),
          decisao: details.decision,
          comentario: details.comment,
        };
        signature = await AssinaturaEletronicaModel.create(client, {
          actorUserId: auditContext.actorUserId,
          entityType: 'resultado_analise',
          entityId: current.id,
          action: details.action,
          authenticatedAt: details.signatureContext.authenticatedAt,
          authMethod: details.signatureContext.authMethod,
          entitySnapshot,
          ipAddress: auditContext.ipAddress,
          userAgent: auditContext.userAgent,
          requestId: auditContext.requestId,
        });
      }

      const now = new Date().toISOString();
      const fields = {
        submetido_em: nextStatus === 'em_revisao' ? now : (nextStatus === 'rascunho' ? null : current.submetido_em),
        submetido_por: nextStatus === 'em_revisao' ? auditContext.actorUserId : (nextStatus === 'rascunho' ? null : current.submetido_por),
        aprovado_em: nextStatus === 'aprovado' ? now : (nextStatus === 'rascunho' ? null : current.aprovado_em),
        aprovado_por: nextStatus === 'aprovado' ? auditContext.actorUserId : (nextStatus === 'rascunho' ? null : current.aprovado_por),
        rejeitado_em: nextStatus === 'rejeitado' ? now : current.rejeitado_em,
        rejeitado_por: nextStatus === 'rejeitado' ? auditContext.actorUserId : current.rejeitado_por,
        publicado_em: nextStatus === 'publicado' ? now : null,
        publicado_por: nextStatus === 'publicado' ? auditContext.actorUserId : null,
        datadapublicacao: nextStatus === 'publicado' ? now : null,
      };
      const updatedResult = await client.query(`
        update resultado_analise set
          status_resultado = $2, submetido_em = $3, submetido_por = $4,
          aprovado_em = $5, aprovado_por = $6, rejeitado_em = $7,
          rejeitado_por = $8, publicado_em = $9, publicado_por = $10,
          datadapublicacao = $11, ultimo_comentario = $12,
          ultima_assinatura_eletronica_id = $13
        where id = $1 and deleted_at is null
        returning *
      `, [
        id,
        nextStatus,
        fields.submetido_em,
        fields.submetido_por,
        fields.aprovado_em,
        fields.aprovado_por,
        fields.rejeitado_em,
        fields.rejeitado_por,
        fields.publicado_em,
        fields.publicado_por,
        fields.datadapublicacao,
        details.comment,
        signature?.id ?? current.ultima_assinatura_eletronica_id ?? null,
      ]);
      const updated = updatedResult.rows[0];

      const workflowEvent = await client.query(`
        insert into resultado_workflow_evento (
          resultado_id, status_anterior, status_novo, decisao, comentario,
          actor_user_id, assinatura_eletronica_id, request_id, metadata
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        returning *
      `, [
        id,
        current.status_resultado,
        nextStatus,
        details.decision,
        details.comment,
        auditContext.actorUserId || null,
        signature?.id || null,
        auditContext.requestId || null,
        JSON.stringify({ versao: updated.versao, signature_hash: signature?.payload_hash || null }),
      ]);

      await AuditLogModel.record(client, {
        actorUserId: auditContext.actorUserId,
        requestId: auditContext.requestId,
        action: details.action,
        entityType: 'resultado_analise',
        entityId: id,
        beforeData: current,
        afterData: updated,
        metadata: {
          workflow_event_id: workflowEvent.rows[0].id,
          assinatura_eletronica_id: signature?.id || null,
          assinatura_hash: signature?.payload_hash || null,
        },
      });

      await this.syncSampleStatus(client, updated.amostra_id, nextStatus, auditContext);
      await client.query('COMMIT');
      return { ...updated, assinatura: signature || undefined };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async syncSampleStatus(db, sampleId, resultStatus, auditContext) {
    const sampleResult = await db.query(
      'select * from amostra where id = $1 and deleted_at is null for update',
      [sampleId]
    );
    const sample = sampleResult.rows[0];
    if (!sample || ['concluida', 'rejeitada', 'cancelada'].includes(sample.status_amostra)) return;

    if (resultStatus === 'rejeitado' || resultStatus === 'rascunho') {
      if (sample.status_amostra === 'aguardando_revisao') {
        await AmostraModel.applyStatusTransition(
          db,
          sample,
          'em_analise',
          { automatico: true, observacao: 'Resultado devolvido para correção.' },
          auditContext
        );
      }
      return;
    }

    const countsResult = await db.query(`
      select
        (select count(*)::int from amostra_parametro where amostra_id = $1) as esperados,
        count(distinct parametro_id)::int as registrados,
        count(*) filter (where status_resultado in ('rascunho', 'rejeitado'))::int as pendentes,
        count(*) filter (where status_resultado <> 'publicado')::int as nao_publicados,
        count(*)::int as total
      from resultado_analise
      where amostra_id = $1 and deleted_at is null
    `, [sampleId]);
    const counts = countsResult.rows[0];
    const completeSet = counts.esperados > 0
      && counts.total === counts.esperados
      && counts.registrados === counts.esperados;

    if (resultStatus === 'em_revisao' && completeSet && counts.pendentes === 0
        && sample.status_amostra === 'em_analise') {
      await AmostraModel.applyStatusTransition(
        db,
        sample,
        'aguardando_revisao',
        { automatico: true, observacao: 'Todos os resultados foram enviados para revisão.' },
        auditContext
      );
      return;
    }

    if (resultStatus === 'publicado' && completeSet && counts.nao_publicados === 0
        && sample.status_amostra === 'aguardando_revisao') {
      await AmostraModel.applyStatusTransition(
        db,
        sample,
        'concluida',
        { automatico: true, observacao: 'Todos os resultados foram publicados.' },
        auditContext
      );
    }
  }

  static async findWorkflowHistory(id, query = {}) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.page_size ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw workflowError('Paginação inválida.', 400, 'PAGINACAO_INVALIDA');
    }
    const exists = await pool.query(
      'select 1 from resultado_analise where id = $1 and deleted_at is null',
      [id]
    );
    if (!exists.rowCount) throw workflowError('Resultado não encontrado.', 404, 'NAO_ENCONTRADO');
    const { rows } = await pool.query(`
      select e.id, e.resultado_id as resultado_analise_id,
             e.status_anterior, e.status_novo,
             e.decisao as acao, e.comentario, e.ocorrido_em as created_at,
             e.metadata, u.nome as ator_nome, u.email as ator_email,
             s.id as assinatura_id, s.action as assinatura_acao,
             s.auth_method as assinatura_metodo, s.signed_at,
             s.payload_hash as assinatura_hash,
             count(*) over()::int as total_count
      from resultado_workflow_evento e
      left join usuario u on e.actor_user_id = u.id
      left join assinatura_eletronica s on e.assinatura_eletronica_id = s.id
      where e.resultado_id = $1
      order by e.ocorrido_em desc, e.id desc
      limit $2 offset $3
    `, [id, pageSize, (page - 1) * pageSize]);
    const total = rows[0]?.total_count ?? 0;
    return {
      rows: rows.map(({ total_count, ...row }) => row),
      total,
      page,
      pageSize,
    };
  }

  static async findAmostras() {
    const { rows } = await pool.query(`
      select a.id, a.codigo_amostra, a.numero_da_amostra, a.data_coleta,
             a.localizacao, a.local_atual, a.status_amostra,
             m.nome as matriz_nome, m.id as matriz_id
      from amostra a
      join matriz m on a.matriz_id = m.id
      where a.deleted_at is null
        and a.status_amostra not in ('concluida', 'rejeitada', 'cancelada')
      order by a.codigo_amostra
    `);
    return rows;
  }

  static async findParametros({ contextoId, legislacaoId, matrizId } = {}) {
    const filters = [];
    const values = [];
    const add = (sql, value) => {
      values.push(value);
      filters.push(`${sql} $${values.length}`);
    };
    if (contextoId) add('p.contexto_legislacao_id =', contextoId);
    if (legislacaoId) add('p.legislacao_id =', legislacaoId);
    if (matrizId) add('p.matriz_id =', matrizId);
    const where = filters.length ? `and ${filters.join(' and ')}` : '';
    const { rows } = await pool.query(`
      select p.id, p.nome, p.unidade_medida, p.limite_minimo, p.limite_maximo,
        p.categoria, p.tipo_resultado, p.tipo_limite, p.criterio_texto,
        p.fonte_referencia, p.contexto_legislacao_id,
        m.id as matriz_id, m.nome as matriz_nome,
        l.id as legislacao_id, l.nome as legislacao_nome, l.sigla as legislacao_sigla,
        lc.nome as contexto_nome, lc.codigo as contexto_codigo
      from parametro p
      join matriz m on p.matriz_id = m.id
      join legislacao l on p.legislacao_id = l.id
      join legislacao_contexto lc on p.contexto_legislacao_id = lc.id
      where p.ativo = true and lc.ativo = true ${where}
      order by p.categoria, p.ordem, p.nome
    `, values);
    return rows;
  }

  static async findMatrizes() {
    const { rows } = await pool.query('select id, nome from matriz order by nome');
    return rows;
  }

  static async findLegislacoes(matrizId) {
    const values = matrizId ? [matrizId] : [];
    const filter = matrizId ? 'and lc.matriz_id = $1' : '';
    const { rows } = await pool.query(`
      select distinct l.id, l.nome, l.sigla, l.orgao_emissor, l.fonte_url, l.observacao
      from legislacao l
      join legislacao_contexto lc on lc.legislacao_id = l.id and lc.ativo = true
      where 1 = 1 ${filter}
      order by l.nome
    `, values);
    return rows;
  }

  static async findContextos({ legislacaoId, matrizId } = {}) {
    const values = [];
    const filters = [];
    if (legislacaoId) {
      values.push(legislacaoId);
      filters.push(`lc.legislacao_id = $${values.length}`);
    }
    if (matrizId) {
      values.push(matrizId);
      filters.push(`lc.matriz_id = $${values.length}`);
    }
    const where = filters.length ? `and ${filters.join(' and ')}` : '';
    const { rows } = await pool.query(`
      select lc.id, lc.codigo, lc.nome, lc.descricao, lc.referencia_legal,
             lc.legislacao_id, lc.matriz_id, l.fonte_url
      from legislacao_contexto lc
      join legislacao l on l.id = lc.legislacao_id
      where lc.ativo = true ${where}
      order by lc.ordem, lc.nome
    `, values);
    return rows;
  }

  static async verificarAmostraExiste(id, database = pool, lock = false) {
    const { rows } = await database.query(`
      select a.id, a.codigo_amostra, a.numero_da_amostra, a.matriz_id,
             a.status_amostra, a.local_atual, a.pedido_analise_id,
             m.nome as matriz_nome
      from amostra a
      join matriz m on a.matriz_id = m.id
      where a.id = $1 and a.deleted_at is null
      ${lock ? 'for update of a' : ''}
    `, [id]);
    return rows[0];
  }

  static async verificarParametroExiste(id, database = pool) {
    const { rows } = await database.query(`
      select p.*, l.nome as legislacao_nome, l.sigla as legislacao_sigla,
             lc.nome as contexto_nome, lc.codigo as contexto_codigo
      from parametro p
      join legislacao l on p.legislacao_id = l.id
      join legislacao_contexto lc on p.contexto_legislacao_id = lc.id
      where p.id = $1 and p.ativo = true and lc.ativo = true
    `, [id]);
    return rows[0];
  }

  static async verificarMetodo(id, parametro, amostra, database = pool) {
    if (!id) return null;
    const { rows } = await database.query(
      'select * from metodo_analitico where id = $1 and ativo = true for share',
      [id]
    );
    const method = rows[0];
    if (!method) throw workflowError('Método analítico não existe ou está inativo.', 400);
    if (method.parametro_id && Number(method.parametro_id) !== Number(parametro.id)) {
      throw workflowError('O método analítico não se aplica ao parâmetro selecionado.', 400);
    }
    if (method.matriz_id && Number(method.matriz_id) !== Number(amostra.matriz_id)) {
      throw workflowError('O método analítico não se aplica à matriz da amostra.', 400);
    }
    return method;
  }
}

module.exports = ResultadoAnaliseModel;
