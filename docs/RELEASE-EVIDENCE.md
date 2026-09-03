# Evidência de liberação

Copie este modelo para o sistema de mudanças do laboratório. Não preencha com senhas, tokens, URL de banco ou dados pessoais.

## Identificação

- Versão/commit:
- Ambiente:
- Data e janela:
- Responsável pela execução:
- Aprovador técnico:
- Aprovador do laboratório:
- Ticket/mudança:

## Escopo e risco

- Funcionalidades alteradas:
- Migrations novas:
- Compatibilidade API/frontend:
- Avaliação de risco e impacto em registros laboratoriais:
- Estratégia expand/contract e retorno do código:

## Gates anteriores

- [ ] `npm ci`
- [ ] `npm test -- --runInBand`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] `node scripts/check-migrations.js`
- [ ] `node scripts/check-supabase-config.js`
- [ ] `node scripts/check-production-env.js`
- [ ] `node scripts/verify-database.js` em homologação
- [ ] Configuração remota Supabase exportada/evidenciada: signup, política de senha, MFA, redirects, SMTP/rate limit, SSL enforcement e restrições de rede
- [ ] Duração e bloqueios de migrations/índices medidos em volume representativo; janela de manutenção aprovada quando aplicável
- [ ] UAT e smoke test assinados
- [ ] Catálogo/métodos/identidade do laboratório aprovados
- [ ] Segredos expostos rotacionados e antigos revogados

Anexe as saídas sem dados sensíveis e registre desvios/aceites de risco.

## Backup e recuperação

- Identificador e horário do backup pré-release:
- Política de retenção:
- Última restauração testada (data/ambiente/duração):
- RPO/RTO medidos e aprovados:
- Validação pós-restauração: migrations, contagens, autenticação, hashes, auditoria e anexos externos.

## Implantação

- Horário de início/fim:
- Resultado de `db push`/histórico de migrations:
- Contagem de conteúdo de migrations conferido (`migration_contents_checked`):
- Versão da API e do frontend:
- Resultado de `node scripts/verify-database.js` em produção:
- Evidência da configuração remota Supabase e responsável pela conferência:
- Health live/ready:
- Smoke test: login, permissões, resultado assinado, laudo e verificação pública.

## Monitoramento e aceite

- Período de observação:
- Erros/latência/conexões/429:
- Responsável de sobreaviso e canal de incidente:
- Desvios encontrados e tratamento:
- Decisão final: aprovado, aprovado com restrição ou revertido.
- Assinaturas/aprovações e data:
