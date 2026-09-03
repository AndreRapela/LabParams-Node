const fs = require('fs');
const path = require('path');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260811020000_access_approval_and_operational_status.sql'
);
const dashboardIndexMigrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260811010000_secure_defaults_and_dashboard_indexes.sql'
);

describe('migration de aprovação e invariantes operacionais', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

  test('preserva usuários legados e deixa novos Auth pendentes por padrão', () => {
    expect(sql).toContain('set acesso_aprovado = true');
    expect(sql).toContain('alter column acesso_aprovado set default false');
    expect(sql).toContain("raw_app_meta_data ->> 'sysmlab_access_approved'");
    expect(sql).toContain('case when aprovacao_informada then acesso_aprovado_claim else false end');
  });

  test('exige ao menos um Gestor e usa contador transacional para impedir corrida', () => {
    expect(sql).toContain('sysmlab_migration_requires_approved_gestor');
    expect(sql).toContain('check (gestores_aprovados >= 1)');
    expect(sql).toMatch(/set gestores_aprovados = gestores_aprovados - 1[\s\S]+gestores_aprovados > 1/);
    expect(sql).toContain('sysmlab_last_approved_gestor');
    expect(sql).toContain('before insert or update or delete on public.usuario');
  });

  test('materializa e indexa a mesma taxonomia para todos os caminhos de escrita', () => {
    expect(sql).toContain('status_operacional_aplicado text');
    expect(sql).toContain('generated always as');
    expect(sql).toContain("then 'alerta'");
    expect(sql).toContain("'nao-conforme'");
    expect(sql).toContain("then 'critico'");
    expect(sql).toContain('resultado_publicado_status_data_idx');
    expect(sql).toContain('sysmlab_index_collision');
  });
});

describe('migration online dos índices de dashboard', () => {
  const sql = fs.readFileSync(dashboardIndexMigrationPath, 'utf8').toLowerCase();

  test('cria os três índices concorrentemente fora de transação explícita', () => {
    expect(sql.match(/create index concurrently if not exists/g)).toHaveLength(3);
    expect(sql).not.toMatch(/^\s*begin\s*;/m);
    expect(sql).not.toMatch(/^\s*commit\s*;/m);
  });

  test('faz precheck e postcheck sem apagar índice em caso de colisão', () => {
    expect(sql).toContain('sysmlab_index_collision');
    expect(sql).toContain('sysmlab_index_postcheck_failed');
    expect(sql).toContain('indisvalid');
    expect(sql).toContain('indisready');
    expect(sql).not.toMatch(/drop\s+index/i);
  });
});
