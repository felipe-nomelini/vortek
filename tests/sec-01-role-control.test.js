const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const publicRegisterRoute = path.join(
  root,
  'src/app/api/auth/register/route.ts',
);
const usersRouteSource = fs.readFileSync(
  path.join(root, 'src/app/api/configuracoes/usuarios/route.ts'),
  'utf8',
);
const userRouteSource = fs.readFileSync(
  path.join(root, 'src/app/api/configuracoes/usuarios/[id]/route.ts'),
  'utf8',
);
const userContracts = require('../src/lib/configuracoes/contracts.ts');
const migrationSource = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20260828163450_protect_profiles_cargo.sql',
  ),
  'utf8',
);

test('cadastro público de usuário não existe', () => {
  assert.equal(fs.existsSync(publicRegisterRoute), false);
});

test('contas internas novas são proprietárias e cargo não é mais editável', () => {
  assert.match(usersRouteSource, /requireAdminUser\(supabase\)/);
  assert.match(usersRouteSource, /auth\.admin\.createUser\(/);
  assert.match(usersRouteSource, /const cargo = 'admin' as const/);
  assert.match(userRouteSource, /requireAdminUser\(supabase\)/);
  assert.match(userRouteSource, /auth\.admin\.updateUserById\(/);
  assert.doesNotMatch(userRouteSource, /\.update\(\{[\s\S]*?cargo,/);

  const owner = { nome: 'Sócio', email: 'socio@example.com', senha: '123456' };
  assert.equal(userContracts.createUserConfigurationSchema.safeParse(owner).success, true);
  assert.equal(userContracts.createUserConfigurationSchema.safeParse({ ...owner, cargo: 'operador' }).success, false);
  assert.equal(userContracts.updateUserConfigurationSchema.safeParse({
    nome: owner.nome,
    email: owner.email,
    senha: '',
    cargo: 'gerente',
  }).success, false);
});

test('authenticated edita somente campos pessoais do próprio profile', () => {
  assert.match(
    migrationSource,
    /revoke update on table public\.profiles from authenticated;/,
  );
  assert.match(
    migrationSource,
    /grant update \(nome, avatar_url\) on table public\.profiles to authenticated;/,
  );

  const executableSql = migrationSource
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  assert.doesNotMatch(
    executableSql,
    /grant update(?:\s+on|\s*\([^)]*cargo)/i,
  );
});
