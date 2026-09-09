const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');

const {
  REQUIRED,
  validateProductionEnvironment,
} = require('../scripts/check-bentevi-prod-env');

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.bentevi.shop',
  SUPABASE_SERVICE_URL: 'http://192.168.1.162:8000',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-real-format-for-contract',
  SUPABASE_SERVICE_ROLE_KEY: 'service-real-format-for-contract',
  NEXT_PUBLIC_APP_URL: 'https://app.bentevi.shop',
  VORTEK_RUNTIME_ENVIRONMENT: 'production',
  API_SECRET_KEY: 'api-real-format-for-contract',
  JWT_SECRET: 'jwt-real-format-for-contract',
  BRASILNFE_TIPO_AMBIENTE: '1',
  BRASILNFE_RETURN_TIPO_AMBIENTE: '1',
  BENTEVI_ASSISTANT_ENABLED: '0',
  BENTEVI_ASSISTANT_DATA_APPROVED: '0',
  ML_PRICING_EXECUTION_MODE: 'disabled',
  ML_ALLOWED_USER_IDS: '7000000001',
  INTERNAL_APP_URL: 'http://bentevi-prod:80',
  NODE_ENV: 'production',
};

test('aprova somente o runtime produtivo restrito acordado', () => {
  const result = validateProductionEnvironment(valid);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.summary.appHost, 'app.bentevi.shop');
  assert.equal(result.summary.serviceSupabaseHost, '192.168.1.162');
  assert.equal(result.summary.configuredRequiredVariables, REQUIRED.length);
  assert.deepEqual(result.errors, []);
});

test('bloqueia ambiente, destino, Assistente, pricing e fiscal divergentes', () => {
  const result = validateProductionEnvironment({
    ...valid,
    NEXT_PUBLIC_APP_URL: 'https://dev.bentevi.shop',
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase-dev.vortek.shop',
    SUPABASE_SERVICE_URL: 'http://192.168.1.160:8000',
    VORTEK_RUNTIME_ENVIRONMENT: 'local_dev',
    BENTEVI_ASSISTANT_ENABLED: '1',
    ML_PRICING_EXECUTION_MODE: 'production_controlled',
    BRASILNFE_RETURN_TIPO_AMBIENTE: '2',
    ALLOW_ML_FISCAL_LEGACY: 'true',
  });
  assert.equal(result.ok, false);
  const errors = result.errors.join('\n');
  for (const expected of [
    'exatamente https://app.bentevi.shop',
    'exatamente https://supabase.bentevi.shop',
    '192.168.1.162',
    'VORTEK_RUNTIME_ENVIRONMENT',
    'Assistente bloqueado',
    'ML_PRICING_EXECUTION_MODE=disabled',
    'Brasil NFe',
    'ALLOW_ML_FISCAL_LEGACY',
  ]) assert.match(errors, new RegExp(expected));
});

test('bloqueia variáveis ausentes e placeholders sem incluir os valores no resumo', () => {
  const secret = 'troque_por_um_segredo_forte';
  const result = validateProductionEnvironment({
    ...valid,
    API_SECRET_KEY: secret,
    JWT_SECRET: '',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /API_SECRET_KEY ainda contém valor de exemplo/);
  assert.match(result.errors.join('\n'), /JWT_SECRET não configurada/);
  assert.ok(!JSON.stringify(result.summary).includes(secret));
});

test('CLI não imprime secrets do arquivo privado', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bnt-prod-env-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, 'production.env');
  const secret = 'secret-value-that-must-not-leak';
  const contents = Object.entries({ ...valid, API_SECRET_KEY: secret })
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  await fs.writeFile(envFile, `${contents}\n`, { mode: 0o600 });

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve(__dirname, '../scripts/check-bentevi-prod-env.js'),
      `--env-file=${envFile}`,
    ], { cwd: path.resolve(__dirname, '..'), env: { PATH: process.env.PATH } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });

  assert.equal(result.code, 0, result.output);
  assert.ok(!result.output.includes(secret));
  assert.match(result.output, /nenhum secret foi exibido/);
});
