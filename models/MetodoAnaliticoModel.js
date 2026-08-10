const pool = require('../config/database');
const AuditLogModel = require('./AuditLogModel');
const { parsePagination, workflowError } = require('../utils/workflowPiloto');

function text(value, field, required = false, max = 2_000) {
  const normalized = String(value ?? '').trim();
  if (required && !normalized) throw workflowError(`${field} é obrigatório.`, 400, 'VALIDACAO');
  if (normalized.length > max) throw workflowError(`${field} excede ${max} caracteres.`, 400, 'VALIDACAO');
  return normalized || null;
}
function positiveNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) throw workflowError(`${field} deve ser um número não negativo.`, 400, 'VALIDACAO');
  return parsed;
}
function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw workflowError(`${field} inválido.`, 400, 'VALIDACAO');
  return parsed;
}

class MetodoAnaliticoModel {
  static parseBoolean(value, { defaultValue, field = 'Ativo', allowString = false } = {}) {
    if (value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (allowString && (value === 'true' || value === 'false')) return value === 'true';
    throw workflowError(`${field} deve ser booleano (true ou false).`, 400, 'BOOLEANO_INVALIDO');
  }

  static normalize(data, { defaultAtivo = true } = {}) {
    const ld = positiveNumber(data.limite_deteccao, 'Limite de detecção');
    const lq = positiveNumber(data.limite_quantificacao, 'Limite de quantificação');
    if (ld !== null && lq !== null && ld > lq) {
      throw workflowError('O limite de detecção não pode superar o limite de quantificação.', 400, 'VALIDACAO');
    }
    return {
      codigo: text(data.codigo, 'Código', true, 80),
      nome: text(data.nome, 'Nome', true, 200),
      versao: text(data.versao, 'Versão', true, 50),
      parametro_id: optionalId(data.parametro_id, 'Parâmetro'),
      matriz_id: optionalId(data.matriz_id, 'Matriz'),
      referencia_normativa: text(data.referencia_normativa, 'Referência normativa', false, 500),
      principio: text(data.principio, 'Princípio', false, 2_000),
      procedimento_resumido: text(data.procedimento_resumido, 'Procedimento resumido', false, 5_000),
      unidade_resultado: text(data.unidade_resultado, 'Unidade do resultado', false, 100),
      limite_deteccao: ld,
      limite_quantificacao: lq,
      incerteza_padrao: positiveNumber(data.incerteza_padrao, 'Incerteza padrão'),
      ativo: this.parseBoolean(data.ativo, { defaultValue: defaultAtivo }),
    };
  }

  static async save(id, data, audit = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let before = null;
      let value;
      if (id) {
        const locked = await client.query('select * from metodo_analitico where id=$1 for update', [id]);
        before = locked.rows[0];
        if (!before) throw workflowError('Método analítico não encontrado.', 404, 'NAO_ENCONTRADO');
        value = this.normalize(data, { defaultAtivo: before.ativo });
        const referenced = await client.query(
          'select 1 from resultado_analise where metodo_analitico_id=$1 limit 1',
          [id]
        );
        if (referenced.rowCount) {
          throw workflowError(
            'Este metodo ja foi usado em resultados. Crie uma nova versao em vez de altera-lo.',
            409,
            'METODO_REFERENCIADO_IMUTAVEL'
          );
        }
      } else {
        value = this.normalize(data);
      }
      const params = Object.values(value);
      const result = id
        ? await client.query(`
            update metodo_analitico set codigo=$2,nome=$3,versao=$4,parametro_id=$5,
              matriz_id=$6,referencia_normativa=$7,principio=$8,procedimento_resumido=$9,
              unidade_resultado=$10,limite_deteccao=$11,limite_quantificacao=$12,
              incerteza_padrao=$13,ativo=$14
            where id=$1 returning *
          `, [id, ...params])
        : await client.query(`
            insert into metodo_analitico (codigo,nome,versao,parametro_id,matriz_id,
              referencia_normativa,principio,procedimento_resumido,unidade_resultado,
              limite_deteccao,limite_quantificacao,incerteza_padrao,ativo)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *
          `, params);
      await AuditLogModel.record(client, {
        actorUserId: audit.actorUserId, requestId: audit.requestId,
        action: id ? 'UPDATE' : 'CREATE', entityType: 'metodo_analitico',
        entityId: result.rows[0].id, beforeData: before, afterData: result.rows[0],
      });
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw workflowError('Já existe este código e versão de método.', 409, 'DUPLICADO');
      if (error.code === '23503') throw workflowError('Parâmetro ou matriz não encontrado.', 400, 'REFERENCIA_INVALIDA');
      throw error;
    } finally { client.release(); }
  }

  static async create(data, audit) { return this.save(null, data, audit); }
  static async update(id, data, audit) { return this.save(id, data, audit); }

  static async findById(id) {
    const { rows } = await pool.query(`
      select ma.*, p.nome as parametro_nome, m.nome as matriz_nome,
             count(ra.id) filter (where ra.deleted_at is null)::int as total_resultados
      from metodo_analitico ma
      left join parametro p on ma.parametro_id=p.id
      left join matriz m on ma.matriz_id=m.id
      left join resultado_analise ra on ra.metodo_analitico_id=ma.id
      where ma.id=$1 group by ma.id,p.nome,m.nome
    `, [id]);
    return rows[0] || null;
  }

  static async findAll(options = {}) {
    const pagination = parsePagination(options);
    const values=[];const filters=[];
    if(options.ativo!==undefined&&options.ativo!==''){
      values.push(this.parseBoolean(options.ativo,{field:'Filtro ativo',allowString:true}));
      filters.push(`ma.ativo=$${values.length}`);
    }
    if(options.parametro_id){values.push(optionalId(options.parametro_id,'Filtro de parâmetro'));filters.push(`ma.parametro_id=$${values.length}`);}
    if(options.matriz_id){values.push(optionalId(options.matriz_id,'Filtro de matriz'));filters.push(`ma.matriz_id=$${values.length}`);}
    if(options.aplicavel_parametro_id){values.push(optionalId(options.aplicavel_parametro_id,'Parâmetro aplicável'));filters.push(`(ma.parametro_id is null or ma.parametro_id=$${values.length})`);}
    if(options.aplicavel_matriz_id){values.push(optionalId(options.aplicavel_matriz_id,'Matriz aplicável'));filters.push(`(ma.matriz_id is null or ma.matriz_id=$${values.length})`);}
    if(options.q){values.push(`%${String(options.q).trim().slice(0,100)}%`);filters.push(`(ma.codigo ilike $${values.length} or ma.nome ilike $${values.length} or coalesce(ma.referencia_normativa,'') ilike $${values.length})`);}
    let limit='';if(pagination){values.push(pagination.pageSize,pagination.offset);limit=`limit $${values.length-1} offset $${values.length}`;}
    const where=filters.length?`where ${filters.join(' and ')}`:'';
    const {rows}=await pool.query(`
      select ma.*,p.nome as parametro_nome,m.nome as matriz_nome,
        count(ra.id) filter(where ra.deleted_at is null)::int as total_resultados,
        count(*) over()::int as total_count
      from metodo_analitico ma left join parametro p on ma.parametro_id=p.id
      left join matriz m on ma.matriz_id=m.id
      left join resultado_analise ra on ra.metodo_analitico_id=ma.id
      ${where} group by ma.id,p.nome,m.nome
      order by ma.ativo desc,ma.nome,ma.codigo,ma.versao desc ${limit}
    `,values);
    const total=rows[0]?.total_count??0;const clean=rows.map(({total_count,...row})=>row);
    return pagination?{rows:clean,total,...pagination}:clean;
  }

  static async deactivate(id, audit = {}) {
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const before=await client.query('select * from metodo_analitico where id=$1 for update',[id]);
      if(!before.rows[0]){await client.query('ROLLBACK');return false;}
      const {rows}=await client.query('update metodo_analitico set ativo=false where id=$1 returning *',[id]);
      await AuditLogModel.record(client,{actorUserId:audit.actorUserId,requestId:audit.requestId,action:'UPDATE',entityType:'metodo_analitico',entityId:id,beforeData:before.rows[0],afterData:rows[0],metadata:{motivo:'Método desativado'}});
      await client.query('COMMIT');return rows[0];
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
}

module.exports=MetodoAnaliticoModel;
