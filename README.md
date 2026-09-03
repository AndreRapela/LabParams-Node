# SYSmLab API

API REST do SYSmLab, um sistema de gestão laboratorial voltado ao fluxo de clientes e pedidos, recebimento e custódia de amostras, execução e revisão de resultados, emissão de laudos, inventário, equipamentos e gestão da qualidade.

## O que está implementado

- Node.js 22–24, Express 4 e PostgreSQL/Supabase.
- Autenticação Supabase; JWT validado por JWKS e autorização no servidor para `Gestor`, `Analista` e `Usuário`.
- Clientes, solicitantes e pedidos de análise com prioridade, prazo e ciclo de vida controlado.
- Amostras vinculadas a pedido, parâmetros aplicáveis e cadeia de custódia append-only.
- Catálogo legal versionado por legislação, matriz e contexto, com resultados numéricos, qualitativos e informativos.
- Métodos analíticos/SOP versionados; um método já referenciado por resultado não pode ser alterado em lugar.
- Workflow de resultado `rascunho → em_revisao → aprovado/rejeitado → publicado`, histórico imutável e separação obrigatória entre submissor e revisor.
- Reautenticação por senha para decisões assinadas; a senha e o token nunca são persistidos.
- Laudos versionados e imutáveis, com snapshot do conteúdo, assinatura de emissão, hash SHA-256, HTML para impressão, QR Code e verificação pública sem exposição dos resultados.
- Inventário de insumos e lotes, validade, saldo e razão de movimentações imutável.
- Equipamentos, disponibilidade, calibração, manutenção e histórico de utilização imutável.
- QMS para não conformidades, desvios, investigação, ações corretivas/preventivas (CAPA) e verificação de eficácia.
- Importação segura de CSV/XLSX, dashboards baseados apenas em resultados publicados, alertas, auditoria e arquivamento lógico.
- CORS por allowlist, Helmet, compressão, limites de payload/upload, rate limiting, logs JSON, request ID e health checks.

O produto apoia controles relevantes da ISO/IEC 17025, mas **não concede certificação, acreditação nem conformidade automática**. A validação do sistema, dos métodos, dos limites, dos procedimentos e da operação continua sob responsabilidade do laboratório.

## Instalação local

Pré-requisitos: Node.js 22, 23 ou 24, npm e um banco PostgreSQL compatível com as migrações.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

A API fica em `http://localhost:3000`. Para confirmar processo e banco:

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

Produção:

```powershell
npm ci --omit=dev
npm start
```

## Banco e migrações

As migrações estão em `supabase/migrations` e o catálogo legal inicial em `supabase/seed.sql`. Faça backup e valide primeiro em homologação.

```powershell
$env:SYSMLAB_DB_URL = "postgresql://postgres:SUA_SENHA@db.SEU_PROJECT_REF.supabase.co:5432/postgres"
npx supabase@latest db push --db-url $env:SYSMLAB_DB_URL --include-seed
Remove-Item Env:SYSMLAB_DB_URL
```

Nunca versione `.env`, senha do banco, chave Secret/Service Role ou tokens. O frontend recebe somente a URL e a chave Publishable do Supabase.

## Perfis de acesso

| Recurso | Usuário | Analista | Gestor |
|---|---:|---:|---:|
| Dashboards, catálogos, clientes, pedidos, amostras, resultados, laudos, inventário, equipamentos e QMS | leitura | leitura | leitura |
| Pedidos e amostras | — | criar/editar/operar | criar/editar/operar/arquivar e concluir/cancelar |
| Resultados | — | lançar, editar rascunho e submeter | lançar, revisar, aprovar, rejeitar, publicar, reabrir e arquivar |
| Métodos analíticos e clientes | — | — | administrar |
| Laudos | — | — | emitir nova versão; leitura para os demais perfis |
| Inventário | — | cadastrar/editar, criar lotes, entradas/saídas | mesmos recursos, ajustes, decisões de status e arquivo |
| Equipamentos | — | cadastrar/editar, agendar/iniciar evento e registrar uso | mesmos recursos, concluir/cancelar evento, status, calibração e arquivo |
| QMS | — | abrir/editar ocorrência e executar CAPA | decisões, cancelamentos, encerramento e arquivo |
| Importação e alertas | — | operar | operar |
| Usuários, perfis, parâmetros legais e auditoria | — | — | administrar |

Status terminais de pedido (`concluido`, `cancelado`) e amostra (`concluida`, `rejeitada`, `cancelada`) exigem `Gestor`. O frontend apenas reflete essas permissões; a decisão final é sempre da API.

## Fluxo operacional mínimo

1. O Gestor cadastra o cliente e os métodos analíticos versionados.
2. Analista ou Gestor abre o pedido e recebe a amostra com sua lista de parâmetros.
3. A cadeia de custódia registra aceite, movimentação, armazenamento e mudanças de estado.
4. O Analista lança resultados como rascunho, seleciona um método aplicável e os submete.
5. Um Gestor diferente de quem submeteu aprova ou rejeita mediante reautenticação; a publicação também exige nova confirmação de senha.
6. Depois que todos os parâmetros esperados estiverem publicados, a amostra pode ser concluída.
7. O Gestor emite o laudo informando a senha; a partir da segunda versão, também informa o motivo da revisão.
8. O destinatário valida o hash/QR em `GET /verificar-laudo/:hash`, sem autenticação.

## Endpoints principais

Todos os endpoints de negócio exigem `Authorization: Bearer <token>`, exceto health checks e verificação pública de laudo.

| Grupo | Rotas base |
|---|---|
| Saúde | `/health/live`, `/health/ready` |
| Comercial | `/clientes`, `/pedidos-analise` |
| Operação laboratorial | `/amostras`, `/resultados-analise`, `/metodos-analiticos`, `/importacao` |
| Laudos | `/laudos`, `/verificar-laudo/:hash` |
| Qualidade operacional | `/inventario`, `/equipamentos`, `/qualidade` |
| Monitoramento | `/dashboard-web`, `/dashboardtv`, `/grafico-parametros`, `/alertas` |
| Administração | `/usuarios`, `/parametros`, `/gerenciamento-parametros`, `/auditoria` |

O contrato detalhado, com payloads, filtros, workflows e respostas, está em [openapi.yaml](./openapi.yaml).

## Testes e verificações

```powershell
npm test
npm audit --omit=dev
node --check index.js
node scripts/check-migrations.js
node scripts/check-supabase-config.js
```

Antes de publicar, execute também `node scripts/check-production-env.js` com as variáveis reais de produção e `node scripts/verify-database.js` contra o ambiente de destino. Os erros são categorizados sem imprimir senha, chave, host ou URL de conexão. O pipeline em `.github/workflows/ci.yml` executa testes, auditoria de dependências, valida as migrations e impede a reescrita ou inserção retroativa do histórico tanto em pull requests quanto em pushes para `main`. Uma aprovação de pipeline não substitui homologação com dados representativos nem UAT do laboratório.

## Documentação

- [Arquitetura](./docs/ARCHITECTURE.md)
- [Segurança e privacidade](./docs/SECURITY.md)
- [Operação, deploy e recuperação](./docs/OPERATIONS.md)
- [Prontidão comercial e limitações](./docs/PRODUCT-READINESS.md)

## Limites atuais

- Uma instalação atende um laboratório; não há isolamento multi-tenant.
- O laudo é entregue como HTML imprimível. Geração de PDF assinável, armazenamento de arquivo e certificado digital ICP-Brasil não estão implementados.
- Não há portal do cliente, orçamento/faturamento, agenda de bancada, integração automática com instrumentos, webhooks, SSO empresarial ou MFA obrigatório pela aplicação.
- Inventário, equipamentos e QMS possuem controles operacionais essenciais, mas ainda não cobrem compras, qualificação completa de fornecedores, cartas de controle, ensaio de proficiência ou gestão documental.
- Catálogo legal e regras de conformidade precisam de validação técnica e atualização controlada pelo laboratório antes do uso decisório.

## Licença

Código proprietário (`UNLICENSED`). Antes de distribuir ou vender, formalize titularidade, licença comercial, termos de uso, política de privacidade, tratamento de dados, suporte e SLA.
