const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('configura Supabase local em PostgreSQL 17 e URLs de loopback', () => {
  const config = read('supabase/config.toml');

  assert.match(config, /^project_id = "bentevi-dev-local"$/m);
  assert.match(config, /^major_version = 17$/m);
  assert.match(config, /^site_url = "http:\/\/127\.0\.0\.1:3000"$/m);
  assert.match(config, /^additional_redirect_urls = \["http:\/\/127\.0\.0\.1:3000"\]$/m);
  assert.doesNotMatch(config, /192\.168\.1\.(?:160|162)|app\.vortek\.shop|app\.bentevi\.shop/);
});

test('wrapper exige local_dev, rede loopback e confirmação de reset', () => {
  const wrapper = read('scripts/dev-supabase.sh');

  assert.match(wrapper, /VORTEK_RUNTIME_ENVIRONMENT:-local_dev/);
  assert.match(wrapper, /host_binding_ipv4=127\.0\.0\.1/);
  assert.match(wrapper, /\.NetworkSettings\.Ports/);
  assert.match(wrapper, /Supabase local desligado porque há portas fora do loopback/);
  assert.match(wrapper, /status --workdir .* --output env/);
  assert.doesNotMatch(wrapper, /status --workdir "\$\{PROJECT_ROOT\}"\s*$/m);
  assert.match(wrapper, /redact_sensitive_output/);
  assert.match(wrapper, /ANON_KEY\|DB_URL\|JWT_SECRET\|PUBLISHABLE_KEY\|SECRET_KEY\|SERVICE_ROLE_KEY/);
  assert.match(wrapper, /--network-id "\$\{NETWORK_NAME\}" 2>&1 \| redact_sensitive_output/);
  assert.match(wrapper, /--confirm-local-reset/);
  assert.doesNotMatch(wrapper, /192\.168\.1\.(?:160|162)/);

  const production = spawnSync('bash', ['scripts/dev-supabase.sh', 'status'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, VORTEK_RUNTIME_ENVIRONMENT: 'production' },
  });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /aceita somente .*local_dev/);

  const unconfirmedReset = spawnSync('bash', ['scripts/dev-supabase.sh', 'reset'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, VORTEK_RUNTIME_ENVIRONMENT: 'local_dev' },
  });
  assert.notEqual(unconfirmedReset.status, 0);
  assert.match(unconfirmedReset.stderr, /exige --confirm-local-reset/);
});

test('seed é mínimo, sintético e mantém integrações desconectadas', () => {
  const seed = read('supabase/seed.sql');

  assert.match(seed, /Bentevi DEV Local/);
  assert.match(seed, /'mercadolivre', false/);
  assert.match(seed, /'dslite', false/);
  assert.match(seed, /'brasilnfe', false/);
  assert.doesNotMatch(seed, /notificacoes_email/);
  assert.doesNotMatch(seed, /insert into public\.configuracoes/i);
  assert.doesNotMatch(seed, /VORTEKTECNOLOGIA|TechSound|192\.168\.1\.(?:160|162)/);
  assert.doesNotMatch(seed, /insert into public\.produtos/i);
});

test('package expõe comandos locais sem reset implícito', () => {
  const manifest = JSON.parse(read('package.json'));

  assert.equal(manifest.scripts['dev:db:start'], 'bash scripts/dev-supabase.sh start');
  assert.equal(manifest.scripts['dev:db:status'], 'bash scripts/dev-supabase.sh status');
  assert.equal(manifest.scripts['dev:db:stop'], 'bash scripts/dev-supabase.sh stop');
  assert.equal(manifest.scripts['dev:db:reset'], 'bash scripts/dev-supabase.sh reset');
});

test('estado local do CLI e arquivos de ambiente ficam fora do Git', () => {
  const gitignore = read('.gitignore');

  assert.match(gitignore, /^\/\.supabase\/$/m);
  assert.match(gitignore, /^supabase\/\.branches\/$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});
