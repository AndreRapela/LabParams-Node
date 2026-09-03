# Segurança e privacidade

## Modelo de confiança

O navegador não é uma fronteira de autorização. A API valida token, identidade, perfil, estado do registro e regra de negócio em cada operação. O PostgreSQL é acessado somente pelo backend; as tabelas do domínio têm RLS habilitado e não concedem acesso direto a `anon`/`authenticated`.

## Controles implementados

- JWT validado pelo JWKS do Supabase, com algoritmos aceitos explicitamente e fallback HS256 apenas para legado.
- RBAC no servidor para `Gestor`, `Analista` e `Usuário`; decisões terminais e assinadas têm middleware adicional.
- Chave Secret/Service Role restrita ao backend; reautenticação usa chave Publishable em cliente isolado, sem sessão persistida.
- Reautenticação com timeout, mensagem de falha sem distinguir conta/senha e um orçamento global por usuário/IP compartilhado entre ações e instâncias da API, persistido no PostgreSQL apenas como chave SHA-256.
- Separação obrigatória entre submissor e revisor, validada na aplicação e no banco para aprovação e rejeição.
- CORS por allowlist, Helmet, compressão, limite JSON de 1 MB e rate limit global.
- Upload com tipo/extensão/tamanho/linhas limitados; arquivo temporário removido após o processamento.
- SQL parametrizado, transações e bloqueios de linha nas operações críticas.
- Restrições no banco para duplicidade, escopo amostra/parâmetro, status e saldos.
- Logs JSON sem corpo/credenciais; `X-Request-Id` para correlação.
- Auditoria imutável, snapshots versionados, assinaturas, custódia e razões de estoque/uso append-only.
- Laudo imutável com snapshot canônico e SHA-256; identidade do laboratório vem apenas de `LAB_*`.
- Verificação pública retorna metadados do documento, indicadores de integridade e evidência técnica da assinatura; não retorna cliente, amostra, identidade do assinante nem conteúdo analítico.
- Arquivamento lógico para registros retidos e bloqueio de alterações incompatíveis com rastreabilidade.

## Assinatura eletrônica e laudo

A confirmação por senha comprova que o usuário autenticado controlava a credencial Supabase no instante registrado. A tabela de assinatura armazena usuário, ação, método, datas, hash, request ID, IP/user-agent e metadados; nunca senha, access token ou refresh token.

Esse mecanismo é uma **assinatura eletrônica de aplicação**, não uma assinatura digital qualificada ICP-Brasil. Se contrato ou regulação exigir certificado digital, carimbo do tempo, verificação offline ou PDF assinado, integre um provedor apropriado e valide juridicamente o fluxo.

O hash SHA-256 detecta alteração do snapshot armazenado, mas não substitui backup, storage imutável, controle de acesso e verificação operacional. O link/QR deve ser tratado como informação sensível não secreta: é impraticável adivinhar um hash aleatório, mas quem recebe o link pode consultar seus metadados públicos.

## Segredos

- Nunca salvar credenciais reais em Git, frontend, screenshot, ticket, chat ou log.
- Manter apenas placeholders em `.env.example` e usar cofre/variáveis protegidas no provedor.
- Publicar no frontend somente `SUPABASE_URL` e chave Publishable.
- Restringir e rotacionar a senha do banco, Secret/Service Role e chaves de deploy.
- Rotacionar imediatamente qualquer segredo já exposto; apagar a mensagem não revoga a credencial.
- Separar credenciais e projetos por ambiente; impedir acesso de desenvolvimento ao banco comercial.
- Desabilitar cadastro público no Supabase: uma conta criada recebe perfil básico de leitura e, portanto, o signup aberto não é aceitável para um LIMS privado.

Antes de qualquer piloto, rotacione toda senha ou chave administrativa que tenha sido compartilhada fora do cofre de segredos.

## LGPD

Clientes, usuários, solicitantes, locais de coleta e laudos podem conter dados pessoais e informações comerciais. Para operar, documente:

- controlador, operador, encarregado/DPO quando aplicável e suboperadores;
- finalidade e base legal de cada categoria de dado;
- minimização, acesso por função e revisão periódica de permissões;
- tabela de retenção, legal hold, exportação e descarte;
- atendimento aos direitos dos titulares e registro das operações de tratamento;
- transferências internacionais e região dos serviços Supabase/hospedagem;
- avaliação de risco, resposta a incidente e comunicação à ANPD/titulares;
- política de privacidade, termos de uso e contrato de tratamento de dados.

Referências oficiais: [guia de segurança da ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte), [materiais educativos](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes) e [comunicação de incidente](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis).

## Riscos e controles ainda externos

- MFA depende da política/configuração do provedor; a aplicação não o torna obrigatório.
- Não há SSO empresarial, gestão de dispositivos, sessão por risco ou detecção de credencial vazada.
- Não há WAF, SIEM, métricas/traces ou alertas centralizados no repositório; devem ser fornecidos pela plataforma.
- Não há antivírus/sandbox de upload; os parsers e limites reduzem, mas não eliminam, esse risco.
- Não há storage imutável de PDF nem certificado digital ICP-Brasil.
- Isolamento multi-tenant não existe; cada laboratório exige implantação segregada.
- OpenAPI e testes reduzem regressões, mas pentest e revisão independente continuam necessários.

## Checklist antes de produção

- [ ] Credenciais expostas rotacionadas e armazenadas em cofre.
- [ ] MFA obrigatório para gestores e contas de infraestrutura.
- [ ] Cadastro público desativado e criação de contas restrita ao fluxo administrativo.
- [ ] CORS e `PUBLIC_APP_URL` restritos aos domínios HTTPS oficiais.
- [ ] `LAB_*` revisadas pelo responsável técnico.
- [ ] Maker-checker ativo e pelo menos dois gestores habilitados para continuidade.
- [ ] TLS validado até o banco (`DATABASE_SSL_REJECT_UNAUTHORIZED=true` e CA privada quando exigida pelo provedor).
- [ ] Backups automáticos e restauração integral testada.
- [ ] Desenvolvimento, homologação e produção separados.
- [ ] Logs centralizados, acesso controlado e alertas configurados.
- [ ] Catálogo legal e métodos aprovados tecnicamente.
- [ ] UAT, pentest e revisão independente concluídos.
- [ ] Plano de incidente, canal privado e responsáveis definidos.

## Relato de vulnerabilidade

Não abra issue pública com segredo ou dado real. Antes da venda, publique um canal privado de segurança, política de divulgação coordenada, severidades, prazo inicial de resposta e processo de correção/comunicação.
