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

test('criação e mudança de cargo permanecem restritas a admin', () => {
  assert.match(usersRouteSource, /requireAdminUser\(supabase\)/);
  assert.match(usersRouteSource, /auth\.admin\.createUser\(/);
  assert.match(userRouteSource, /requireAdminUser\(supabase\)/);
  assert.match(userRouteSource, /auth\.admin\.updateUserById\(/);
  assert.match(userRouteSource, /\.update\(\{[\s\S]*?cargo,/);
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
