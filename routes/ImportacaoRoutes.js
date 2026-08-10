// routes/ImportacaoRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const ImportacaoController = require('../controllers/ImportacaoController');
const roleFromTable = require('../middleware/RoleFromTable');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const serverlessUploadDir = path.join(os.tmpdir(), 'uploads');
    const localUploadDir = path.join(__dirname, '../uploads/temp');

    let uploadDir = (process.env.VERCEL || process.env.NODE_ENV === 'production')
      ? serverlessUploadDir
      : localUploadDir;

    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    } catch (error) {
      // Em ambientes serverless (Vercel), /var/task é read-only.
      // Se por qualquer motivo cairmos no caminho local e falhar, faz fallback para /tmp.
      uploadDir = serverlessUploadDir;
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    }

    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const extension = path.extname(path.basename(file.originalname)).toLowerCase();
    cb(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  },
  fileFilter: function (req, file, cb) {
    // Validação 1: Extensão do arquivo
    const extensoesPermitidas = ['.csv', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Validação 2: MIME type
    const mimeTypesPermitidos = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/csv',
      'text/x-csv',
      'application/x-csv',
      'text/comma-separated-values',
      'text/x-comma-separated-values',
      'application/octet-stream' // Alguns sistemas enviam CSV como octet-stream
    ];
    
    // Verifica extensão (prioridade na validação)
    if (!extensoesPermitidas.includes(ext)) {
      return cb(new Error('Apenas arquivos CSV e XLSX são permitidos'));
    }
    
    // Verifica MIME type apenas se não for octet-stream genérico
    // (pois octet-stream pode ser qualquer arquivo, então confiamos na extensão)
    if (file.mimetype && 
        file.mimetype !== 'application/octet-stream' && 
        !mimeTypesPermitidos.includes(file.mimetype)) {
      return cb(new Error(`Tipo de arquivo inválido: ${file.mimetype}. Apenas CSV e XLSX são permitidos`));
    }
    
    cb(null, true);
  }
});

router.post(
  '/resultado-analise',
  roleFromTable('Gestor', 'Analista'),
  upload.single('arquivo'),
  ImportacaoController.importarResultadosAnalise
);

/**
 * @route GET /importacao/template
 * @description Baixa template de exemplo (CSV ou XLSX)
 * @query formato - 'csv' ou 'xlsx' (padrão: csv)
 * @access Protegido (requer autenticação)
 */
router.get(
  '/template',
  roleFromTable('Gestor', 'Analista', 'Usuário'),
  ImportacaoController.baixarTemplate
);

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Arquivo muito grande',
        error: 'O arquivo deve ter no máximo 10 MB'
      });
    }
    return res.status(400).json({
      success: false,
      message: 'Erro no upload',
      error: error.message
    });
  }
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Erro ao processar arquivo',
      error: error.message
    });
  }
  
  next();
});

module.exports = router;
