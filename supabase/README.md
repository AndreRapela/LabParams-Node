# Banco Supabase do SYSmLab

Este diretório é a fonte de verdade do esquema PostgreSQL. As migrações devem ser aplicadas em ordem, primeiro em homologação e depois em produção com backup restaurável.

## Migrações

| Arquivo | Conteúdo principal |
|---|---|
| `20260726010000_initial_schema.sql` | Usuários, matrizes, legislações, parâmetros, amostras, resultados, sincronização com `auth.users`, índices, triggers e RLS inicial |
| `20260728010000_legal_limits_catalog.sql` | Contextos e limites da Portaria GM/MS nº 888/2021 e das Resoluções CONAMA nº 357/2005 e nº 430/2011 |
| `20260729010000_audit_and_retention.sql` | `audit_log` imutável, arquivamento lógico e metadados de retenção para amostras/resultados |
| `20260730010000_pilot_workflow.sql` | Clientes, pedidos, métodos, custódia, snapshots/versionamento de resultados, workflow assinado e laudos imutáveis |
| `20260730020000_quality_operations.sql` | Insumos/lotes/movimentações, equipamentos/calibração/manutenção/utilização e QMS/CAPA |
| `20260730030000_operational_hardening.sql` | Contador PostgreSQL compartilhado do limite de falhas de reautenticação, armazenado somente como SHA-256 |

`seed.sql` contém matrizes e legislações iniciais. Revise o seed antes de usar `--include-seed` fora de um banco novo ou de homologação.

## Entidades por domínio

- Identidade e governança: `usuario`, `audit_log`, `api_rate_limit_counter`.
- Catálogo técnico/legal: `matriz`, `legislacao`, `legislacao_contexto`, `parametro`, `metodo_analitico`.
- Comercial e operação: `cliente`, `pedido_analise`, `amostra`, `amostra_parametro`, `amostra_custodia_evento`.
- Resultados e documentos: `resultado_analise`, `resultado_versao_snapshot`, `resultado_workflow_evento`, `assinatura_eletronica`, `laudo_analitico`.
- Inventário: `insumo`, `insumo_lote`, `estoque_movimentacao`.
- Equipamentos: `equipamento`, `equipamento_evento`, `equipamento_utilizacao`.
- Qualidade: `qms_ocorrencia`, `qms_acao_capa`.

## Integridade e retenção

- Um resultado ativo é único por amostra/parâmetro e só pode usar parâmetro pertencente ao escopo da amostra.
- Cada edição do resultado cria um snapshot analítico versionado. Aprovação, rejeição, publicação e reabertura exigem assinatura eletrônica vinculada à versão e à transição.
- Quem submeteu uma versão não pode aprová-la nem rejeitá-la; a separação é verificada também no banco.
- Métodos já utilizados não podem ter seu conteúdo alterado; deve ser criada uma nova versão.
- Custódia, versões, eventos de workflow, assinaturas, laudos, movimentações de estoque e utilizações de equipamento possuem proteção append-only conforme sua finalidade.
- Laudo guarda snapshot imutável, hash SHA-256 e assinatura de emissão. Alterar cadastros posteriormente não reescreve a versão emitida.
- `audit_log` registra alterações críticas e rejeita atualização/exclusão.
- Arquivamento lógico preserva referências e histórico; não substitui a política formal de retenção do laboratório.
- Tabelas de domínio têm RLS habilitado e acesso direto removido de `anon` e `authenticated`; operações de negócio passam pela API.

## Enquadramento legal

1. A amostra define a matriz, como `Água`, `Água Bruta` ou `Efluente`.
2. A matriz restringe as legislações compatíveis.
3. A legislação exige um contexto, como classe da água ou tipo de lançamento.
4. O contexto disponibiliza somente seus parâmetros e limites.
5. O resultado congela limite, critério, fonte legal, unidade, método e versão analítica usados naquele momento.

Na importação, a coluna `contexto` é obrigatória e aceita o nome exibido ou o código estável, por exemplo `P888_POTABILIDADE`, `C357_DOCE_2` ou `C430_GERAL`. Resultados importados entram como rascunho e seguem o mesmo workflow de revisão/publicação.

## Aplicar em projeto remoto

No PowerShell, a partir da raiz da API:

```powershell
$env:SYSMLAB_DB_URL = "postgresql://postgres:SUA_SENHA@db.SEU_PROJECT_REF.supabase.co:5432/postgres"
npx supabase@latest db push --db-url $env:SYSMLAB_DB_URL --include-seed
Remove-Item Env:SYSMLAB_DB_URL
```

Para produção, remova `--include-seed` quando o banco já possuir catálogo controlado. Nunca edite uma migração que já foi aplicada; crie uma nova migração incremental.

Depois da aplicação, verifique ao menos:

- histórico de migrações e presença das tabelas/constraints;
- ausência de resultados ativos duplicados ou fora do escopo da amostra;
- triggers append-only e de integridade de assinatura/laudo;
- RLS e revogações para `anon`/`authenticated`;
- fluxo completo em homologação, incluindo restauração de backup.

## Credenciais

A URL e as chaves ficam nas variáveis de ambiente das aplicações. Senha do banco e chaves Secret/Service Role nunca devem entrar em migrações, seed, Git, log ou frontend. A chave Publishable pode estar no frontend, pois é pública, mas não concede acesso direto às tabelas de negócio sem políticas/permissões.

## Primeiro Gestor

Cadastre o usuário pelo fluxo administrativo confiável. Garanta que `app_metadata.perfil` e a linha correspondente em `public.usuario` estejam como `Gestor`; depois encerre e inicie a sessão para obter um token atualizado. Mantenha pelo menos dois Gestores treinados para permitir a separação de funções e a continuidade operacional.
