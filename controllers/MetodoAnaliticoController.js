const Model=require('../models/MetodoAnaliticoModel');
function audit(req){return{actorUserId:req.user?.id,requestId:req.requestId};}
function fail(res,e){const s=Number(e.statusCode)||500;if(s>=500)console.error('Erro em métodos:',e);return res.status(s).json({success:false,message:s<500?e.message:'Erro interno ao processar método',code:e.code});}
function list(res,r){if(Array.isArray(r))return res.json({success:true,data:r,count:r.length});return res.json({success:true,data:r.rows,count:r.rows.length,pagination:{page:r.page,page_size:r.pageSize,total:r.total,total_pages:Math.ceil(r.total/r.pageSize)}});}
class MetodoAnaliticoController{
 static async findAll(req,res){try{return list(res,await Model.findAll(req.query));}catch(e){return fail(res,e);}}
 static async findById(req,res){try{const data=await Model.findById(req.params.id);return data?res.json({success:true,data}):res.status(404).json({success:false,message:'Método não encontrado'});}catch(e){return fail(res,e);}}
 static async create(req,res){try{return res.status(201).json({success:true,data:await Model.create(req.body,audit(req))});}catch(e){return fail(res,e);}}
 static async update(req,res){try{return res.json({success:true,data:await Model.update(req.params.id,req.body,audit(req))});}catch(e){return fail(res,e);}}
 static async deactivate(req,res){try{const data=await Model.deactivate(req.params.id,audit(req));return data?res.json({success:true,message:'Método desativado.',data}):res.status(404).json({success:false,message:'Método não encontrado'});}catch(e){return fail(res,e);}}
}
module.exports=MetodoAnaliticoController;
