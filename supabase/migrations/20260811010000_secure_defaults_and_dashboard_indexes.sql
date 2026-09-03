-- Esta migration é intencionalmente não transacional: CREATE INDEX
-- CONCURRENTLY mantém escrita disponível e não pode executar em BEGIN/COMMIT.
-- O precheck aborta antes de qualquer alteração quando um nome já aponta para
-- outra definição. Um índice inválido deixado por interrupção também exige
-- reparo operacional explícito; ele nunca é apagado silenciosamente.
do $$
declare
  expected record;
  definition text;
  key_count integer;
  attribute_count integer;
  is_unique boolean;
  is_valid boolean;
  is_ready boolean;
  table_name text;
  access_method text;
begin
  for expected in
    select * from (values
      ('resultado_publicado_coleta_idx', '(datacoleta desc, id desc)', 2),
      ('resultado_publicado_parametro_publicacao_idx', '(parametro_id, publicado_em desc nulls last, created_at desc, id desc)', 4),
      ('resultado_publicado_parametro_coleta_idx', '(parametro_id, datacoleta desc, id desc)', 3)
    ) as definitions(index_name, column_signature, expected_keys)
  loop
    if to_regclass('public.' || expected.index_name) is null then
      continue;
    end if;

    select lower(pg_get_indexdef(index_data.indexrelid)),
           index_data.indnkeyatts,
           index_data.indnatts,
           index_data.indisunique,
           index_data.indisvalid,
           index_data.indisready,
           index_data.indrelid::regclass::text,
           access_method_data.amname
      into definition, key_count, attribute_count, is_unique, is_valid,
           is_ready, table_name, access_method
    from pg_catalog.pg_index index_data
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_data.indexrelid
    join pg_catalog.pg_am access_method_data
      on access_method_data.oid = index_relation.relam
    where index_data.indexrelid = to_regclass('public.' || expected.index_name);

    if definition is null
       or table_name not in ('resultado_analise', 'public.resultado_analise')
       or access_method <> 'btree'
       or key_count <> expected.expected_keys
       or attribute_count <> expected.expected_keys
       or is_unique
       or not is_valid
       or not is_ready
       or position(expected.column_signature in definition) = 0
       or position('deleted_at is null' in definition) = 0
       or position('status_resultado' in definition) = 0
       or position('publicado' in definition) = 0 then
      raise exception 'SYSMLAB_INDEX_COLLISION: %', expected.index_name;
    end if;
  end loop;
end;
$$;

-- Evita exposição acidental de novos objetos no Data API. Estas regras valem
-- para objetos futuros criados pelo papel postgres; migrations continuam
-- revogando explicitamente os privilégios dos objetos que criam.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Dashboards consultam apenas resultados publicados. Índices parciais mantêm
-- esse conjunto menor que os índices históricos completos.
create index concurrently if not exists resultado_publicado_coleta_idx
  on public.resultado_analise (datacoleta desc, id desc)
  where deleted_at is null and status_resultado = 'publicado';

create index concurrently if not exists resultado_publicado_parametro_publicacao_idx
  on public.resultado_analise
    (parametro_id, publicado_em desc nulls last, created_at desc, id desc)
  where deleted_at is null and status_resultado = 'publicado';

create index concurrently if not exists resultado_publicado_parametro_coleta_idx
  on public.resultado_analise (parametro_id, datacoleta desc, id desc)
  where deleted_at is null and status_resultado = 'publicado';

-- Postcheck: além de proteger contra colisão, confirma que nenhuma criação
-- concorrente/interrompida deixou um índice incompleto ou com outra semântica.
do $$
declare
  expected record;
  definition text;
  key_count integer;
  attribute_count integer;
  is_unique boolean;
  is_valid boolean;
  is_ready boolean;
  table_name text;
  access_method text;
begin
  for expected in
    select * from (values
      ('resultado_publicado_coleta_idx', '(datacoleta desc, id desc)', 2),
      ('resultado_publicado_parametro_publicacao_idx', '(parametro_id, publicado_em desc nulls last, created_at desc, id desc)', 4),
      ('resultado_publicado_parametro_coleta_idx', '(parametro_id, datacoleta desc, id desc)', 3)
    ) as definitions(index_name, column_signature, expected_keys)
  loop
    select lower(pg_get_indexdef(index_data.indexrelid)),
           index_data.indnkeyatts,
           index_data.indnatts,
           index_data.indisunique,
           index_data.indisvalid,
           index_data.indisready,
           index_data.indrelid::regclass::text,
           access_method_data.amname
      into definition, key_count, attribute_count, is_unique, is_valid,
           is_ready, table_name, access_method
    from pg_catalog.pg_index index_data
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_data.indexrelid
    join pg_catalog.pg_am access_method_data
      on access_method_data.oid = index_relation.relam
    where index_data.indexrelid = to_regclass('public.' || expected.index_name);

    if definition is null
       or table_name not in ('resultado_analise', 'public.resultado_analise')
       or access_method <> 'btree'
       or key_count <> expected.expected_keys
       or attribute_count <> expected.expected_keys
       or is_unique
       or not is_valid
       or not is_ready
       or position(expected.column_signature in definition) = 0
       or position('deleted_at is null' in definition) = 0
       or position('status_resultado' in definition) = 0
       or position('publicado' in definition) = 0 then
      raise exception 'SYSMLAB_INDEX_POSTCHECK_FAILED: %', expected.index_name;
    end if;
  end loop;
end;
$$;

comment on index public.resultado_publicado_coleta_idx is
  'Acelera dashboard web por data de coleta somente sobre resultados publicados.';
comment on index public.resultado_publicado_parametro_publicacao_idx is
  'Acelera o snapshot da TV pelo resultado publicado mais recente de cada parametro.';
comment on index public.resultado_publicado_parametro_coleta_idx is
  'Acelera filtros e séries por parâmetro somente sobre resultados publicados.';
