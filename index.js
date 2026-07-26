const dotenv = require('dotenv');

dotenv.config({ quiet: process.env.NODE_ENV === 'test' });

const cors = require('cors');
const express = require('express');
const authMiddleware = require('./middleware/Auth');
const roleFromTable = require('./middleware/RoleFromTable');

const alertasRoutes = require('./routes/AlertaRoutes');
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

const app = express();
const defaultOrigins = [
  'https://frontendsysmlab.vercel.app',
  'http://localhost:4200',
];
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

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
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.info(`${req.method} ${req.originalUrl}`);
    next();
  });
}

app.get('/', (_req, res) => {
  res.json({ message: 'API SYSmLab online', version: '1.0.0' });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

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
];

for (const [path, router] of protectedRoutes) {
  app.use(path, authMiddleware, router);
}

app.use(
  '/usuarios',
  authMiddleware,
  roleFromTable('Gestor'),
  usuariosRoutes
);
app.use(
  '/alertas',
  authMiddleware,
  roleFromTable('Gestor'),
  alertasRoutes
);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint não encontrado',
    path: req.originalUrl,
    method: req.method,
  });
});

app.use((error, _req, res, _next) => {
  if (error.code === 'CORS_NOT_ALLOWED') {
    return res.status(403).json({
      success: false,
      error: 'Origem não autorizada',
    });
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error('Erro não tratado:', error.message);
  }

  return res.status(error.status || 500).json({
    success: false,
    error: 'Erro interno do servidor',
  });
});

module.exports = app;

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.info(`API SYSmLab disponível na porta ${port}`));
}
