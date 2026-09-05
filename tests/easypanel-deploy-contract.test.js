const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/deploy-easypanel-vortek.sh');

async function fixture(t, { status = 200, disconnect = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bnt-easypanel-contract-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'git'), [
    '#!/bin/sh',
    'case "$1" in',
    '  rev-parse)',
    '    if [ "$2" = "--abbrev-ref" ]; then',
    '      echo "${TEST_GIT_BRANCH:-dev}"',
    '    else',
    '      echo abc1234',
    '    fi',
    '    ;;',
    '  diff)',
    '    if [ "$2" = "--cached" ]; then',
    '      exit "${TEST_GIT_STAGED:-0}"',
    '    fi',
    '    exit "${TEST_GIT_DIRTY:-0}"',
    '    ;;',
    '  *) exit 9 ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o700 });
  const envFile = path.join(directory, 'deploy.env');
  await fs.writeFile(envFile, '# Configuração sintética; nunca carregar credenciais locais.\n');
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, headers: req.headers, body });
      if (disconnect) { req.socket.destroy(); return; }
      res.writeHead(status);
      res.end('Resposta sintética');
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const url = `http://127.0.0.1:${server.address().port}/api/deploy/token-sintetico`;

  async function run(overrides = {}, args = []) {
    const env = {
      PATH: `${directory}:/usr/bin:/bin`,
      CURL_HOME: directory,
      TMPDIR: directory,
      EASYPANEL_DEPLOY_ENV_FILE: envFile,
      EASYPANEL_DEPLOY_WEBHOOK_URL: url,
      EASYPANEL_DEPLOY_EXPECTED_BRANCH: 'dev',
      EASYPANEL_DEPLOY_HTTP_METHOD: 'POST',
      EASYPANEL_DEPLOY_CONNECT_TIMEOUT: '1',
      EASYPANEL_DEPLOY_MAX_TIME: '2',
      ...overrides,
    };
    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', [script, ...args], { cwd: root, env, timeout: 5000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (signal) { reject(new Error(`Script interrompido: ${signal}`)); return; }
        resolve({ code, stdout, stderr });
      });
    });
  }
  return { requests, run, url };
}

test('POST entrega corpo JSON explícito e não expõe a URL', async (t) => {
  const { run, requests, url } = await fixture(t);
  const result = await run();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers['content-type'], 'application/json');
  assert.equal(requests[0].body, '{}');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(url));
  assert.ok(!`${result.stdout}${result.stderr}`.includes('token-sintetico'));
});

test('GET permanece sem corpo e sem cabeçalho JSON', async (t) => {
  const { run, requests } = await fixture(t);
  const result = await run({ EASYPANEL_DEPLOY_HTTP_METHOD: 'GET' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].body, '');
  assert.equal(requests[0].headers['content-type'], undefined);
});

for (const status of [204, 299, 400, 500]) {
  test(`HTTP ${status} respeita o resultado do webhook sem repetir chamada`, async (t) => {
    const { run, requests } = await fixture(t, { status });
    const result = await run();
    assert.equal(result.code, status < 300 ? 0 : 1);
    assert.match(`${result.stdout}${result.stderr}`, new RegExp(`HTTP ${status}`));
    assert.equal(requests.length, 1);
  });
}

test('falha de conexão encerra com erro e não declara aceite', async (t) => {
  const { run, requests } = await fixture(t, { disconnect: true });
  const result = await run();
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(result.stdout, /webhook accepted/);
  assert.equal(requests.length, 1);
});

test('dry-run não faz requisição nem imprime a URL', async (t) => {
  const { run, requests, url } = await fixture(t);
  const result = await run({}, ['--dry-run']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /dry-run: webhook not called/);
  assert.ok(!result.stdout.includes(url));
  assert.equal(requests.length, 0);
});

for (const [name, env, expected] of [
  ['branch divergente', { TEST_GIT_BRANCH: 'branch-simulada' }, /expected 'dev'/],
  ['alteração não commitada', { TEST_GIT_DIRTY: '1' }, /not committed/],
  ['alteração no stage', { TEST_GIT_STAGED: '1' }, /not committed/],
  ['URL ausente', { EASYPANEL_DEPLOY_WEBHOOK_URL: '' }, /missing EASYPANEL_DEPLOY_WEBHOOK_URL/],
  ['método inválido', { EASYPANEL_DEPLOY_HTTP_METHOD: 'DELETE' }, /must be POST or GET/],
]) {
  test(`${name} impede chamada HTTP`, async (t) => {
    const { run, requests } = await fixture(t);
    const result = await run(env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, expected);
    assert.equal(requests.length, 0);
  });
}
