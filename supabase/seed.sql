insert into public.matriz (nome)
values
  ('Água'),
  ('Água Bruta'),
  ('Efluente')
on conflict do nothing;

insert into public.legislacao (nome, sigla)
values
  ('Portaria GM/MS nº 888/2021', 'Portaria 888/2021'),
  ('Resolução CONAMA nº 357/2005', 'CONAMA nº 357/2005'),
  ('Resolução CONAMA nº 430/2011', 'CONAMA nº 430/2011')
on conflict do nothing;

-- Os contextos, parâmetros e limites legais são versionados na migration
-- 20260728010000_legal_limits_catalog.sql para que todos os ambientes recebam
-- o mesmo catálogo de referência.
