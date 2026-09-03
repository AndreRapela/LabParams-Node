const PedidoAnaliseModel = require('../models/PedidoAnaliseModel');
const {logSafeError}=require('../utils/safeError');
function audit(req){return{actorUserId:req.user?.id,requestId:req.requestId};}
function fail(res,error){const status=Number(error.statusCode)||500;if(status>=500)logSafeError('analysis_order_controller_failed',error,{request_id:res.getHeader('X-Request-Id')||null});return res.status(status).json({success:false,message:status<500?error.message:'Erro interno ao processar pedido',code:error.code});}
function list(res,r){if(Array.isArray(r))return res.json({success:true,data:r,count:r.length});return res.json({success:true,data:r.rows,count:r.rows.length,pagination:{page:r.page,page_size:r.pageSize,total:r.total,total_pages:Math.ceil(r.total/r.pageSize)}});}
class PedidoAnaliseController{
 static async findAll(req,res){try{return list(res,await PedidoAnaliseModel.findAll(req.query));}catch(e){return fail(res,e);}}
 static async findById(req,res){try{const data=await PedidoAnaliseModel.findById(req.params.id);return data?res.json({success:true,data}):res.status(404).json({success:false,message:'Pedido não encontrado'});}catch(e){return fail(res,e);}}
 static async create(req,res){try{return res.status(201).json({success:true,data:await PedidoAnaliseModel.create(req.body,audit(req))});}catch(e){return fail(res,e);}}
 static async update(req,res){try{return res.json({success:true,data:await PedidoAnaliseModel.update(req.params.id,req.body,audit(req))});}catch(e){return fail(res,e);}}
 static async status(req,res){try{return res.json({success:true,data:await PedidoAnaliseModel.transitionStatus(req.params.id,req.body.status,req.body.comentario??req.body.motivo,audit(req))});}catch(e){return fail(res,e);}}
 static async archive(req,res){try{const ok=await PedidoAnaliseModel.archive(req.params.id,req.body?.motivo,audit(req));return ok?res.json({success:true,message:'Pedido arquivado.'}):res.status(404).json({success:false,message:'Pedido não encontrado'});}catch(e){return fail(res,e);}}
}
module.exports=PedidoAnaliseController;
