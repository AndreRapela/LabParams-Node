# API SysmLab - Backend

API RESTful para gerenciamento de análises laboratoriais desenvolvida em Node.js com Express e PostgreSQL.

## Tecnologias Utilizadas

* Node.js 21.7.3+
* Express 4.x
* PostgreSQL (via pg)
* Supabase (autenticação e banco de dados)
* Jest (testes)
* Multer (upload de arquivos)
* csv-parser e xlsx (processamento de planilhas)

## Pré-requisitos

* Node.js v18 ou superior
* PostgreSQL ou acesso ao Supabase
* Variáveis de ambiente configuradas

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env` na raiz do projeto `/api`:

```env
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=sua_senha
DB_NAME=sysmlab
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_chave_anon_publica
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role
PORT=3000
```

## Executando a Aplicação

Desenvolvimento:
```bash
npm run dev
```

Produção:
```bash
npm start
```

Servidor disponível em `http://localhost:3000`

## Testes

Executar todos os testes:
```bash
npm test
```

Executar com cobertura:
```bash
npm run test:coverage
```

Cobertura atual:
* Statements: 71.17%
* Branches: 61.33%
* Functions: 31.57%
* Lines: 70.77%

Total de 26 testes implementados cobrindo modelos, controllers e integração.

## Autenticação

A API utiliza autenticação JWT via Supabase. Todas as rotas protegidas requerem o header:

```
Authorization: Bearer <token>
```

Para obter o token:
```bash
POST /acessos/login
Content-Type: application/json

{
  "email": "usuario@exemplo.com",
  "senha": "senha123"
}
```

## Endpoints Principais

### Amostras
* `GET /amostra` - Listar amostras
* `POST /amostra` - Criar amostra
* `PUT /amostra/:id` - Atualizar amostra
* `DELETE /amostra/:id` - Deletar amostra

### Parâmetros
* `GET /parametro` - Listar parâmetros
* `POST /parametro` - Criar parâmetro
* `PUT /parametro/:id` - Atualizar parâmetro
* `DELETE /parametro/:id` - Deletar parâmetro

### Resultados de Análise
* `GET /resultado-analise` - Listar resultados
* `POST /resultado-analise` - Criar resultado
* `PUT /resultado-analise/:id` - Atualizar resultado
* `DELETE /resultado-analise/:id` - Deletar resultado

### Importação
* `POST /importacao/resultado-analise` - Importar planilha (CSV/XLSX)
* `GET /importacao/template` - Baixar template de importação

### Dashboard e Gráficos
* `GET /dashboard-web/resumo` - Resumo do dashboard
* `GET /grafico-parametro` - Dados para gráficos

### Alertas
* `GET /alerta-naoconformidade` - Listar alertas de não conformidade

## Importação de Planilhas

A API suporta importação de resultados de análises através de arquivos CSV, XLS e XLSX com limite de 10MB.

```bash
POST /importacao/resultado-analise
Content-Type: multipart/form-data
Authorization: Bearer <token>

Body: arquivo
```

Validações realizadas:
* Formato do arquivo (.csv, .xlsx, .xls)
* Tamanho máximo (10MB)
* Campos obrigatórios presentes
* Tipos de dados corretos
* Datas válidas
* Referências existentes (amostra, parâmetro, matriz, legislação)

## Segurança

* Autenticação JWT
* Queries parametrizadas (proteção contra SQL Injection)
* Sanitização de inputs
* CORS configurado
* SSL/TLS obrigatório em produção

## Deploy

Para deploy na Vercel:
```bash
npm i -g vercel
vercel
```

Configure as variáveis de ambiente no painel da Vercel.

## Licença

Propriedade de CAERN - Companhia de Águas e Esgotos do Rio Grande do Norte.
