begin;

-- Contadores compartilhados entre todas as instâncias da API. A aplicação
-- persiste somente SHA-256 da identidade; usuário e IP nunca ficam em claro.
create table if not exists public.api_rate_limit_counter (
  key_hash text primary key,
  total_hits bigint not null default 0 check (total_hits >= 0),
  reset_at timestamptz not null,
  constraint api_rate_limit_counter_key_hash_check
    check (key_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists api_rate_limit_counter_reset_at_idx
  on public.api_rate_limit_counter (reset_at);

alter table public.api_rate_limit_counter enable row level security;
alter table public.api_rate_limit_counter force row level security;

-- A tabela é infraestrutura interna e não pode ser acessada pelo PostgREST.
-- O backend usa a conexão PostgreSQL administrativa configurada em DATABASE_URL.
revoke all on table public.api_rate_limit_counter from public, anon, authenticated;

comment on table public.api_rate_limit_counter is
  'Contadores internos de rate limit. Linhas expiradas são removidas em lotes pela API.';
comment on column public.api_rate_limit_counter.key_hash is
  'SHA-256 da chave lógica; não contém usuário ou endereço IP em claro.';

commit;
