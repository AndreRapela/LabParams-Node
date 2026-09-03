# Operação e deploy

## Ambientes

Mantenha projetos Supabase, bancos, credenciais, domínios e storage separados para desenvolvimento, homologação e produção. Migração deve ser validada em homologação com backup restaurável antes do banco comercial.

## Configuração

Obrigatórias em produção:

- `NODE_ENV=production`
- `DATABASE_URL` (ou o conjunto `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`)
- `DATABASE_SSL=true`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY` legado)
- `SUPABASE_PUBLISHABLE_KEY`, usada na reautenticação de assinaturas
- `SUPABASE_JWKS_URL`
- `CORS_ORIGINS`
- `PUBLIC_APP_URL`, URL pública que recebe o hash do QR do laudo
- `LAB_NOME`, `LAB_DOCUMENTO`, `LAB_ENDERECO` e `LAB_CONTATO`

Ajustes operacionais:

| Variável | Padrão | Uso |
|---|---:|---|
| `PORT` | `3000` | porta HTTP |
| `LOG_LEVEL` | `info` | nível mínimo do log JSON |
| `RATE_LIMIT_MAX` | `600` | requisições por IP/15 min |
| `SIGNATURE_RATE_LIMIT_MAX` | `5` | falhas de reautenticação por usuário/IP na janela global |
| `SIGNATURE_RATE_LIMIT_WINDOW_MS` | `600000` | janela compartilhada por todas as ações assinadas |
| `SIGNATURE_TIMEOUT_MS` | `7000` | timeout da confirmação no Supabase (1–15 s) |
| `CUSTODY_MAX_BACKDATE_HOURS` | `24` | retroatividade máxima de custódia (0–168 h) |
| `DB_POOL_MAX` | `10` | tamanho máximo do pool |
| `DB_CONNECT_TIMEOUT_MS` | `5000` | conexão ao banco |
| `DB_IDLE_TIMEOUT_MS` | `30000` | conexão ociosa |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | duração máxima de consulta |

Mantenha `DATABASE_SSL_REJECT_UNAUTHORIZED=true`, que é o padrão seguro, e informe `DATABASE_SSL_CA` ou `DATABASE_SSL_CA_PATH` quando o provedor exigir uma CA privada. Para o Supabase hospedado, o repositório inclui `config/certs/supabase-prod-ca-2021.crt`, obtido do endereço oficial de certificados do provedor; acompanhe a rotação e a validade da CA. O verificador de banco sempre exige TLS. `SUPABASE_JWT_SECRET` e `SUPABASE_ANON_KEY` continuam suportados em conjunto para projetos HS256 legados; projetos modernos devem usar Publishable/Secret e JWKS. A referência identificável no host/usuário PostgreSQL deve coincidir com a de `SUPABASE_URL`.

## Release

Antes da janela, execute os gates automatizados abaixo. Eles categorizam falhas sem imprimir senha, host, URL de banco ou chaves:

```powershell
node scripts/check-migrations.js
node scripts/check-supabase-config.js
$env:NODE_ENV = "production"
node scripts/check-production-env.js
node scripts/verify-database.js
```

`check-migrations` faz análise léxica sem considerar comentários ou corpos de funções como DDL, valida nome, transação, codificação, RLS/revogação, `SECURITY DEFINER` e bloqueia operações destrutivas nas migrations novas. `check-supabase-config` impede regressão nos padrões locais de cadastro, senha e TOTP. `check-production-env` rejeita placeholders, HTTP, CORS aberto, TLS permissivo, combinação incompleta de credenciais modernas/legadas, versão Node fora de 22–24, divergência identificável entre projetos e identidade laboratorial incompleta. `verify-database` abre transação somente leitura, exige TLS e compara versões/conteúdo disponível das migrations, objetos inesperados, definições de índices, estado/tabela/função de triggers, overloads e configuração das funções, RLS, grants, ACLs padrão por owner e invariantes de dados.

Esses verificadores são gates adicionais, não um parser SQL completo nem substitutos do `db push` em banco descartável de homologação. Migrations anteriores a `20260811010000` permanecem imutáveis; a política destrutiva ampliada vale desse marco em diante.

1. Registrar versão implantada, janela e responsável; criar backup identificado.
2. Rotacionar qualquer segredo que tenha sido exposto e atualizar o cofre/provedor.
3. Executar testes, build, verificação sintática e auditoria de dependências.
4. Aplicar migrações em homologação e executar UAT com os três perfis.
5. Validar fluxos completos: pedido → amostra/custódia → resultado → assinatura → conclusão → laudo/QR.
6. Validar inventário, equipamento bloqueado por calibração e QMS/CAPA.
7. Aplicar migrações em produção; publicar API e frontend compatíveis.
8. Confirmar health checks, login, emissão e verificação pública.
9. Monitorar erros, latência, conexões, filas do provedor e tentativas de assinatura.

Guarde a saída dos gates, o identificador do backup, o resultado da restauração, a versão implantada e as aprovações no registro da mudança. O modelo mínimo está em [`RELEASE-EVIDENCE.md`](./RELEASE-EVIDENCE.md).

Comandos mínimos:

```powershell
# API
npm ci
npm test
npm audit --omit=dev
node --check index.js
npm start

# Web
npm ci
npm test -- --watch=false
npm run build
npm audit --omit=dev
```

Não use `--include-seed` em produção sem revisar o seed e sua idempotência. Migrações de tabelas append-only e hashes devem ser tratadas como expansão; não remova colunas ou snapshots antigos durante o mesmo release.

Nunca altere ou remova um arquivo já aplicado. O CI bloqueia esse tipo de mudança em pull requests e pushes para `main`, recusa migrations novas com timestamp anterior ou igual ao último da base e toda correção deve entrar em uma nova migration posterior. Antes e depois de `db push`, execute `node scripts/verify-database.js` e confirme contagem e conteúdo verificado do histórico.

A migration `20260811010000` é a exceção deliberadamente não transacional: seus três índices usam `CREATE INDEX CONCURRENTLY`, que o PostgreSQL proíbe dentro de uma transação explícita. O gate aceita apenas esse padrão restrito — `CONCURRENTLY IF NOT EXISTS`, verificações semânticas antes/depois e operações idempotentes permitidas — e reprova mistura com DML ou DDL destrutivo.

Execute-a primeiro em homologação com a mesma versão do executor da produção, meça duração, I/O e locks e monitore `pg_stat_progress_create_index`. Se houver interrupção e um índice ficar inválido, os checks semânticos abortarão a continuidade; inspecione `pg_index` e aplique um procedimento de recuperação aprovado e evidenciado. O deploy não remove nem recria automaticamente um índice potencialmente incorreto.

## Health e logs

- `GET /health/live`: confirma que o processo responde.
- `GET /health/ready`: executa `select 1`; retorna `503` sem banco.
- `X-Request-Id`: presente em respostas e no log `http_request` para correlação.
- Logs são JSON estruturado e devem ir para um agregador com retenção e acesso controlados.

Nunca registre `Authorization`, senha de reautenticação, chave Supabase, URL de banco ou conteúdo completo de laudo. Filtre o caminho antes de indexar para evitar que o hash público do laudo se torne um identificador amplamente pesquisável.

## Smoke test de release

- Gestor, Analista e Usuário conseguem autenticar; um token inválido recebe `401`.
- Usuário de consulta recebe `403` ao tentar mutação.
- Analista não conclui/cancela pedido ou amostra e não aprova/publica resultado.
- Gestor não aprova nem rejeita a mesma versão que submeteu.
- Senha incorreta falha sem criar assinatura; limite retorna `429` após tentativas excessivas.
- Resultado fora do escopo da amostra e duplicado são rejeitados.
- Laudo falha com amostra incompleta e a segunda versão exige motivo.
- Hash válido verifica metadados mínimos; hash desconhecido recebe `404` e não revela cliente/amostra/resultados.
- Lote vencido/bloqueado não é consumido; ajuste exige Gestor.
- Equipamento sem calibração válida não registra utilização.
- QMS só encerra após CAPA e evidência de eficácia.

## Backup, restauração e retenção

- Defina RPO/RTO no SLA e retenção compatível com contrato, LGPD e requisitos do laboratório.
- Faça backup automatizado do banco e das configurações de Auth/Storage; mantenha cópia em domínio de falha independente quando necessário.
- Execute e evidencie restauração periódica em ambiente isolado.
- Após restauração, valide contagens, chaves, hashes de laudo, trilhas append-only e autenticação.
- Defina exportação e descarte seguro. Arquivamento lógico no aplicativo não substitui política de retenção.

O teste de restauração não está concluído apenas porque o banco iniciou. Registre duração e valide `node scripts/verify-database.js`, autenticação, contagens acordadas, amostras publicadas, hashes de laudo, trilhas de workflow/auditoria e anexos externos. A credencial usada no teste deve ser exclusiva do ambiente isolado e revogada ao final.

## Configuração Supabase fora do código

O arquivo `supabase/config.toml` mantém cadastro público desativado, senha forte, confirmação de e-mail, troca segura de senha e TOTP disponível como padrão local. No projeto hospedado, confirme separadamente no Dashboard/API de gestão:

- cadastro público desativado; usuários criados apenas pelo fluxo administrativo;
- senha mínima e proteção contra senhas vazadas conforme o plano contratado;
- MFA obrigatório para Gestores e contas de infraestrutura;
- URLs de site/redirect limitadas ao domínio HTTPS oficial;
- proteção SMTP, CAPTCHA/rate limits e alertas de autenticação;
- SSL enforcement do banco e restrição de rede compatível com o provedor de deploy.

Não use `supabase/config.toml` como evidência de que o projeto remoto já recebeu essas opções; exporte ou registre a configuração efetiva do ambiente na liberação.

## Monitoramento mínimo

- disponibilidade e latência p50/p95/p99 da API;
- 4xx/5xx, `429`, falhas JWKS e timeout de assinatura;
- saturação do pool, consultas lentas e espaço do PostgreSQL;
- falhas/rejeições de importação e crescimento de `audit_log`/snapshots;
- pedidos/amostras fora do prazo, resultados em revisão e laudos emitidos;
- lotes vencidos/baixo estoque, calibrações vencidas e CAPA atrasadas;
- resultado e data do último backup e teste de restauração.

## Incidente

1. Preservar evidências, request IDs, horário, atores e escopo.
2. Conter acesso sem apagar auditoria, assinaturas ou registros append-only.
3. Rotacionar credenciais comprometidas e revogar as anteriores.
4. Avaliar integridade de resultados/laudos e dados pessoais afetados.
5. Comunicar conforme contrato e obrigações LGPD/ANPD.
6. Restaurar serviço, verificar hashes/invariantes e documentar causa, impacto e correção.

## Rollback

Código deve permitir retorno à versão compatível anterior. Para banco, prefira expand/contract; migração destrutiva não deve depender de rollback automático. Caso uma migração incompatível tenha sido aplicada, interrompa gravações, preserve evidências e restaure o backup aprovado em vez de editar registros críticos manualmente.
