const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const loginPage = fs.readFileSync(
  path.resolve(__dirname, '../src/app/(auth)/login/page.tsx'),
  'utf8',
);
const loginRoute = fs.readFileSync(
  path.resolve(__dirname, '../src/app/api/auth/login/route.ts'),
  'utf8',
);

test('login do navegador usa a rota same-origin e não instancia Supabase no bundle', () => {
  assert.doesNotMatch(loginPage, /supabase-client|createClient\(|signInWithPassword/);
  assert.match(loginPage, /fetch\('\/api\/auth\/login'/);
  assert.match(loginPage, /method: 'POST'/);
  assert.match(loginPage, /credentials: 'same-origin'/);
  assert.match(loginPage, /body: JSON\.stringify\(\{ email, senha \}\)/);
});

test('rota de login autentica no servidor e preserva o cookie da sessão', () => {
  assert.match(loginRoute, /resolveSupabaseServiceUrl\(\)/);
  assert.match(loginRoute, /resolveSupabaseAuthCookieName\(\)/);
  assert.match(loginRoute, /signInWithPassword\(\{ email, password: senha \}\)/);
  assert.match(loginRoute, /response\.cookies\.set/);
  assert.match(loginRoute, /status: 401/);
});
