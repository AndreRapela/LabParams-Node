begin;

-- Contas existentes permanecem ativas. Depois desta migration, somente o
-- backend administrativo (app_metadata confiável) cria contas já aprovadas.
alter table public.usuario
  add column if not exists acesso_aprovado boolean,
  add column if not exists acesso_aprovado_em timestamptz,
  add column if not exists acesso_aprovado_por uuid
    references public.usuario(id) on update cascade on delete set null;

update public.usuario usuario_local
set acesso_aprovado = case
      when lower(coalesce(auth_user.raw_app_meta_data ->> 'sysmlab_access_approved', ''))
        in ('true', 'false')
        then (auth_user.raw_app_meta_data ->> 'sysmlab_access_approved')::boolean
      else true
    end,
    acesso_aprovado_em = case
      when lower(coalesce(auth_user.raw_app_meta_data ->> 'sysmlab_access_approved', '')) = 'false'
        then null
      else coalesce(usuario_local.acesso_aprovado_em, timezone('utc', now()))
    end
from auth.users auth_user
where auth_user.id = usuario_local.id
  and usuario_local.acesso_aprovado is null;

-- Preserva também registros locais legados sem correspondente no Auth.
update public.usuario
set acesso_aprovado = true,
    acesso_aprovado_em = coalesce(acesso_aprovado_em, timezone('utc', now()))
where acesso_aprovado is null;

update public.usuario
set acesso_aprovado_em = null,
    acesso_aprovado_por = null
where not acesso_aprovado;

alter table public.usuario
  alter column acesso_aprovado set default false,
  alter column acesso_aprovado set not null;

alter table public.usuario
  drop constraint if exists usuario_acesso_aprovacao_consistente_check;
alter table public.usuario
  add constraint usuario_acesso_aprovacao_consistente_check check (
    acesso_aprovado
    or (acesso_aprovado_em is null and acesso_aprovado_por is null)
  );

create index if not exists usuario_acesso_perfil_idx
  on public.usuario (acesso_aprovado, perfil);

do $$
declare
  index_definition text;
begin
  select lower(pg_get_indexdef(to_regclass('public.usuario_acesso_perfil_idx')))
    into index_definition;
  if index_definition is null
     or position('on public.usuario' in index_definition) = 0
     or position('(acesso_aprovado, perfil)' in index_definition) = 0 then
    raise exception 'SYSMLAB_INDEX_COLLISION: usuario_acesso_perfil_idx';
  end if;
end;
$$;

create or replace function public.sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  perfil_administrativo text;
  aprovacao_informada boolean;
  acesso_aprovado_claim boolean;
  aprovador_claim uuid;
  aprovador_texto text;
begin
  if new.email is null then
    return new;
  end if;

  perfil_administrativo := case
    when new.raw_app_meta_data ->> 'perfil' in ('Gestor', 'Analista', 'Usuário')
      then new.raw_app_meta_data ->> 'perfil'
    else null
  end;

  aprovacao_informada := lower(coalesce(
    new.raw_app_meta_data ->> 'sysmlab_access_approved',
    ''
  )) in ('true', 'false');
  acesso_aprovado_claim := case
    when aprovacao_informada
      then (new.raw_app_meta_data ->> 'sysmlab_access_approved')::boolean
    else false
  end;

  aprovador_texto := new.raw_app_meta_data ->> 'sysmlab_access_approved_by';
  if aprovador_texto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select usuario.id into aprovador_claim
    from public.usuario usuario
    where usuario.id = aprovador_texto::uuid;
  end if;

  insert into public.usuario (
    id, nome, email, telefone, perfil,
    acesso_aprovado, acesso_aprovado_em, acesso_aprovado_por
  )
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'nome'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'telefone'), ''),
    coalesce(perfil_administrativo, 'Usuário'),
    case when aprovacao_informada then acesso_aprovado_claim else false end,
    case when aprovacao_informada and acesso_aprovado_claim
      then timezone('utc', now()) else null end,
    case when aprovacao_informada and acesso_aprovado_claim
      then aprovador_claim else null end
  )
  on conflict (id) do update
  set nome = excluded.nome,
      email = excluded.email,
      telefone = excluded.telefone,
      perfil = coalesce(perfil_administrativo, usuario.perfil),
      acesso_aprovado = case
        when aprovacao_informada then acesso_aprovado_claim
        else usuario.acesso_aprovado
      end,
      acesso_aprovado_em = case
        when not aprovacao_informada then usuario.acesso_aprovado_em
        when not acesso_aprovado_claim then null
        when usuario.acesso_aprovado
          then coalesce(usuario.acesso_aprovado_em, timezone('utc', now()))
        else timezone('utc', now())
      end,
      acesso_aprovado_por = case
        when not aprovacao_informada then usuario.acesso_aprovado_por
        when not acesso_aprovado_claim then null
        else coalesce(aprovador_claim, usuario.acesso_aprovado_por)
      end;

  return new;
end;
$$;

-- Um contador serializado por row lock torna impossível que duas requisições
-- concorrentes rebaixem/bloqueiem os dois últimos Gestores ao mesmo tempo.
do $$
begin
  if not exists (
    select 1 from public.usuario
    where perfil = 'Gestor' and acesso_aprovado
  ) then
    raise exception 'SYSMLAB_MIGRATION_REQUIRES_APPROVED_GESTOR'
      using errcode = '23514';
  end if;
end;
$$;

create table if not exists public.usuario_gestor_guard (
  singleton boolean primary key default true check (singleton),
  gestores_aprovados integer not null check (gestores_aprovados >= 1),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.usuario_gestor_guard (singleton, gestores_aprovados)
select true, count(*)::integer
from public.usuario
where perfil = 'Gestor' and acesso_aprovado
on conflict (singleton) do update
set gestores_aprovados = excluded.gestores_aprovados,
    updated_at = timezone('utc', now());

create or replace function public.enforce_approved_gestor_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  era_gestor boolean := false;
  sera_gestor boolean := false;
  contador_atualizado integer;
begin
  if tg_op <> 'INSERT' then
    era_gestor := old.perfil = 'Gestor' and old.acesso_aprovado;
  end if;
  if tg_op <> 'DELETE' then
    sera_gestor := new.perfil = 'Gestor' and new.acesso_aprovado;
  end if;

  if era_gestor and not sera_gestor then
    update public.usuario_gestor_guard
    set gestores_aprovados = gestores_aprovados - 1,
        updated_at = timezone('utc', now())
    where singleton and gestores_aprovados > 1
    returning gestores_aprovados into contador_atualizado;

    if contador_atualizado is null then
      raise exception 'SYSMLAB_LAST_APPROVED_GESTOR'
        using errcode = '23514',
          constraint = 'usuario_ultimo_gestor_aprovado_check';
    end if;
  elsif sera_gestor and not era_gestor then
    update public.usuario_gestor_guard
    set gestores_aprovados = gestores_aprovados + 1,
        updated_at = timezone('utc', now())
    where singleton
    returning gestores_aprovados into contador_atualizado;

    if contador_atualizado is null then
      raise exception 'SYSMLAB_GESTOR_GUARD_MISSING'
        using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_approved_gestor_guard on public.usuario;
create trigger enforce_approved_gestor_guard
before insert or update or delete on public.usuario
for each row execute function public.enforce_approved_gestor_guard();

-- Status materializado e indexável para paginação/estatísticas. É derivado dos
-- limites congelados; portanto importações e gravações diretas também recebem a
-- mesma classificação, sem depender de preencher JSON no código da API.
alter table public.resultado_analise
  add column if not exists status_operacional_aplicado text
  generated always as (
    case
      when tipo_limite_aplicado = 'informativo' then 'informativo'
      when tipo_limite_aplicado = 'ausencia' then
        case
          when translate(
            lower(trim(coalesce(valor_qualitativo, ''))),
            'áàãâäéèêëíìîïóòõôöúùûüç',
            'aaaaaeeeeiiiiooooouuuuc'
          ) in ('ausente', 'nao detectado', 'negativo') then 'conforme'
          else 'nao-conforme'
        end
      when valor_medido is null then 'informativo'
      when (limite_minimo_aplicado is not null and valor_medido < limite_minimo_aplicado)
        or (limite_maximo_aplicado is not null and valor_medido > limite_maximo_aplicado) then
        case
          when limite_minimo_aplicado is not null
            and limite_maximo_aplicado is not null
            and limite_maximo_aplicado > limite_minimo_aplicado
            and (
              valor_medido < limite_minimo_aplicado
                - (limite_maximo_aplicado - limite_minimo_aplicado) * 0.20
              or valor_medido > limite_maximo_aplicado
                + (limite_maximo_aplicado - limite_minimo_aplicado) * 0.20
            ) then 'critico'
          when limite_maximo_aplicado is not null and limite_maximo_aplicado > 0
            and valor_medido > limite_maximo_aplicado * 1.20 then 'critico'
          when limite_minimo_aplicado is not null and limite_minimo_aplicado > 0
            and valor_medido < limite_minimo_aplicado * 0.80 then 'critico'
          else 'nao-conforme'
        end
      when limite_minimo_aplicado is not null
        and limite_maximo_aplicado is not null
        and limite_maximo_aplicado > limite_minimo_aplicado then
        case
          when least(
            valor_medido - limite_minimo_aplicado,
            limite_maximo_aplicado - valor_medido
          ) <= (limite_maximo_aplicado - limite_minimo_aplicado) * 0.10
            then 'alerta'
          else 'conforme'
        end
      when limite_maximo_aplicado is not null and limite_maximo_aplicado > 0
        and valor_medido >= limite_maximo_aplicado * 0.90 then 'alerta'
      when limite_minimo_aplicado is not null and limite_minimo_aplicado > 0
        and valor_medido <= limite_minimo_aplicado * 1.10 then 'alerta'
      else 'conforme'
    end
  ) stored;

create index if not exists resultado_publicado_status_data_idx
  on public.resultado_analise (
    status_operacional_aplicado,
    publicado_em desc,
    id desc
  )
  where deleted_at is null and status_resultado = 'publicado';

do $$
declare
  index_definition text;
begin
  select lower(pg_get_indexdef(to_regclass('public.resultado_publicado_status_data_idx')))
    into index_definition;
  if index_definition is null
     or position('on public.resultado_analise' in index_definition) = 0
     or position('(status_operacional_aplicado, publicado_em desc, id desc)' in index_definition) = 0
     or position('deleted_at is null' in index_definition) = 0
     or position('status_resultado' in index_definition) = 0
     or position('publicado' in index_definition) = 0 then
    raise exception 'SYSMLAB_INDEX_COLLISION: resultado_publicado_status_data_idx';
  end if;
end;
$$;

alter table public.usuario_gestor_guard enable row level security;
revoke all on table public.usuario_gestor_guard from public, anon, authenticated;
revoke execute on function public.sync_auth_user() from public, anon, authenticated;
revoke execute on function public.enforce_approved_gestor_guard()
  from public, anon, authenticated;

comment on column public.usuario.acesso_aprovado is
  'Somente contas explicitamente aprovadas podem usar rotas protegidas.';
comment on column public.resultado_analise.status_operacional_aplicado is
  'Classificação operacional derivada dos limites legais congelados no resultado.';
comment on table public.usuario_gestor_guard is
  'Contador transacional que impede remoção concorrente do último Gestor aprovado.';

commit;
