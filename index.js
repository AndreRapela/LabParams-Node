const dotenv = require('dotenv');

dotenv.config({ quiet: process.env.NODE_ENV === 'test' });

const cors = require('cors');
const compression = require('compression');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { randomUUID } = require('crypto');
const authMiddleware = require('./middleware/Auth');
const roleFromTable = require('./middleware/RoleFromTable');
const pool = require('./config/database');
const logger = require('./utils/logger');
const { errorCategory, safeErrorCode, safeErrorLogFields } = require('./utils/safeError');
const { safeRequestPath } = require('./utils/safeRequestPath');

const alertasRoutes = require('./routes/AlertaRoutes');
const acessoAtualRoutes = require('./routes/AcessoAtualRoutes');
const amostraRoutes = require('./routes/AmostraRoutes');
const dashboardTvRoutes = require('./routes/DashboardTvRoutes');
const dashboardWebRoutes = require('./routes/DashboardWebRoutes');
const gerenciamentoParametrosRoutes = require('./routes/GerenciamentoParametrosRoutes');
const graficoParametroRoutes = require('./routes/GraficoParametroRoutes');
const importacaoRoutes = require('./routes/ImportacaoRoutes');
const legislacaoRoutes = require('./routes/LegislacaoRoutes');
const matrizRoutes = require('./routes/MatrizRoutes');
const parametroRoutes = require('./routes/ParametroRoutes');
const resultadoAnaliseRoutes = require('./routes/ResultadoAnaliseRoutes');
const usuariosRoutes = require('./routes/UsuarioRoutes');
const auditLogRoutes = require('./routes/AuditLogRoutes');
const clienteRoutes = require('./routes/ClienteRoutes');
const pedidoAnaliseRoutes = require('./routes/PedidoAnaliseRoutes');
const metodoAnaliticoRoutes = require('./routes/MetodoAnaliticoRoutes');
const laudoRoutes = require('./routes/LaudoRoutes');
const inventarioRoutes = require('./routes/InventarioRoutes');
const equipamentoRoutes = require('./routes/EquipamentoRoutes');
const qualidadeRoutes = require('./routes/QualidadeRoutes');
const verificacaoLaudoRoutes = require('./routes/VerificacaoLaudoRoutes');

const app = express();
app.set('trust proxy', 1);
const configuredRateLimit = Number(process.env.RATE_LIMIT_MAX);
const globalRateLimit = Number.isInteger(configuredRateLimit)
  && configuredRateLimit > 0
  && configuredRateLimit <= 10_000
  ? configuredRateLimit
  : 600;
const defaultOrigins = [
  'https://frontendsysmlab.vercel.app',
  'http://localhost:4200',
  'http://localhost:4300',
];
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const configuredReadinessCacheMs = Number(process.env.READINESS_CACHE_MS);
const readinessCacheMs = Number.isInteger(configuredReadinessCacheMs)
  && configuredReadinessCacheMs >= 250
  && configuredReadinessCacheMs <= 30_000
  ? configuredReadinessCacheMs
  : 2_000;
let readinessCache = { ready: false, expiresAt: 0 };
let readinessProbe = null;

async function databaseIsReady(requestId) {
  const now = Date.now();
  if (readinessCache.expiresAt > now) return readinessCache.ready;
  if (readinessProbe) return readinessProbe;

  readinessProbe = (async () => {
    try {
      await pool.query('select 1');
      readinessCache = { ready: true, expiresAt: Date.now() + readinessCacheMs };
      return true;
    } catch (error) {
      readinessCache = { ready: false, expiresAt: Date.now() + readinessCacheMs };
      logger.warn('readiness_check_failed', {
        request_id: requestId || null,
        category: errorCategory(error),
        code: safeErrorCode(error),
      });
      return false;
    } finally {
      readinessProbe = null;
    }
  })();

  return readinessProbe;
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const error = new Error('Origin not allowed');
    error.code = 'CORS_NOT_ALLOWED';
    return callback(error);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  maxAge: 86_400,
};

app.disable('x-powered-by');
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info('http_request', {
      request_id: req.requestId,
      method: req.method,
      path: safeRequestPath(req.originalUrl),
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      actor_user_id: req.user?.id || null,
    });
  });
  next();
});
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: globalRateLimit,
  skip: (req) => ['/health', '/health/live', '/health/ready'].includes(req.path),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Muitas requisições. Tente novamente em alguns minutos.' },
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
  if (req.body === undefined) {
    req.body = {};
    return next();
  }
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_BODY',
      message: 'O corpo da requisição deve ser um objeto JSON.',
      request_id: req.requestId,
    });
  }
  return next();
});

app.get('/', (_req, res) => {
  res.json({ message: 'API SYSmLab online', version: '1.0.0' });
});

app.get('/health/live', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get(['/health', '/health/ready'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (await databaseIsReady(req.requestId)) {
    return res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      request_id: req.requestId,
    });
  }
  return res.status(503).json({
    status: 'unavailable',
    timestamp: new Date().toISOString(),
    request_id: req.requestId,
  });
});

const noStore = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

// O portador do documento pode validar o hash sem expor cliente ou resultados.
app.use('/verificar-laudo', noStore, verificacaoLaudoRoutes);

// Permite que a própria conta autenticada descubra se está pendente sem passar
// pelo RBAC, evitando navegar para o dashboard antes de mostrar o estado real.
app.use('/acesso-atual', authMiddleware, noStore, acessoAtualRoutes);

const protectedRoutes = [
  ['/parametros', parametroRoutes],
  ['/matrizes', matrizRoutes],
  ['/legislacoes', legislacaoRoutes],
  ['/dashboardtv', dashboardTvRoutes],
  ['/resultados-analise', resultadoAnaliseRoutes],
  ['/grafico-parametros', graficoParametroRoutes],
  ['/dashboard-web', dashboardWebRoutes],
  ['/amostras', amostraRoutes],
  ['/gerenciamento-parametros', gerenciamentoParametrosRoutes],
  ['/importacao', importacaoRoutes],
  ['/clientes', clienteRoutes],
  ['/pedidos-analise', pedidoAnaliseRoutes],
  ['/metodos-analiticos', metodoAnaliticoRoutes],
  ['/laudos', laudoRoutes],
  ['/inventario', inventarioRoutes],
  ['/equipamentos', equipamentoRoutes],
  ['/qualidade', qualidadeRoutes],
];
const registeredUser = roleFromTable('Gestor', 'Analista', 'Usuário');

for (const [path, router] of protectedRoutes) {
  app.use(path, authMiddleware, noStore, registeredUser, router);
}

app.use(
  '/usuarios',
  authMiddleware,
  noStore,
  roleFromTable('Gestor'),
  usuariosRoutes
);
app.use(
  '/alertas',
  authMiddleware,
  noStore,
  roleFromTable('Gestor', 'Analista'),
  alertasRoutes
);
app.use(
  '/auditoria',
  authMiddleware,
  noStore,
  roleFromTable('Gestor'),
  auditLogRoutes
);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint não encontrado',
    path: req.originalUrl,
    method: req.method,
    request_id: req.requestId,
  });
});

app.use((error, _req, res, _next) => {
  if (error.code === 'CORS_NOT_ALLOWED') {
    return res.status(403).json({
      success: false,
      error: 'Origem não autorizada',
      request_id: _req.requestId,
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_JSON',
      message: 'O corpo da requisição contém JSON inválido.',
      request_id: _req.requestId,
    });
  }

  if (error.type === 'entity.too.large' || error.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'PAYLOAD_TOO_LARGE',
      message: 'O corpo da requisição excede o limite permitido.',
      request_id: _req.requestId,
    });
  }

  if (process.env.NODE_ENV !== 'test') {
    logger.error('unhandled_error', {
      request_id: _req.requestId,
      method: _req.method,
      path: safeRequestPath(_req.originalUrl),
      ...safeErrorLogFields(error),
    });
  }

  const status = Number(error.statusCode || error.status);
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600
    ? status
    : 500;
  return res.status(safeStatus).json({
    success: false,
    error: safeStatus >= 500 ? 'Erro interno do servidor' : 'Requisição inválida',
    request_id: _req.requestId,
  });
});

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => logger.info('server_started', { port }));
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('server_shutdown_started', { signal });

    const forcedExit = setTimeout(() => {
      logger.error('server_shutdown_timeout', { signal });
      process.exit(1);
    }, 10_000);
    forcedExit.unref();

    server.close(async (error) => {
      try {
        if (typeof pool.end === 'function') await pool.end();
      } catch (poolError) {
        logger.error('database_pool_shutdown_failed', safeErrorLogFields(poolError));
        error ||= poolError;
      } finally {
        clearTimeout(forcedExit);
      }

      if (error) {
        logger.error('server_shutdown_failed', safeErrorLogFields(error));
        process.exit(1);
      }
      logger.info('server_shutdown_completed', { signal });
      process.exit(0);
    });
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
