#!/usr/bin/env node
require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' });

const baseUrl = String(process.env.WAHA_BASE_URL || process.env.WAHA_URL || '').trim().replace(/\/+$/, '');
const apiKey = String(process.env.WAHA_API_KEY || '').trim();
const session = String(process.env.WAHA_SESSION || 'default').trim() || 'default';
const expectedEngine = String(process.env.WAHA_EXPECTED_ENGINE || 'GOWS').trim().toUpperCase();
const testPhone = String(process.env.WAHA_TEST_RECIPIENT_PHONE || '').replace(/\D/g, '');

function fail(message, detail) {
  console.error(`[waha:gows] ${message}`);
  if (detail) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
}

function chatIdFromPhone(phone) {
  if (!phone) return null;
  const withCountry = phone.startsWith('55') ? phone : `55${phone}`;
  if (withCountry.length < 12 || withCountry.length > 13) {
    fail('WAHA_TEST_RECIPIENT_PHONE invalido. Use DDD + numero ou 55 + DDD + numero.');
  }
  return `${withCountry}@c.us`;
}

async function call(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

(async () => {
  if (!baseUrl) fail('WAHA_BASE_URL nao configurado');
  if (!apiKey) fail('WAHA_API_KEY nao configurado');

  const version = await call('/api/version');
  if (!version.ok) fail('Falha ao consultar /api/version', version);

  const sessionStatus = await call(`/api/sessions/${encodeURIComponent(session)}`);
  if (!sessionStatus.ok) fail(`Falha ao consultar sessao ${session}`, sessionStatus);

  const actualEngine = String(
    sessionStatus.body?.engine?.engine || version.body?.engine || '',
  ).toUpperCase();
  const status = String(sessionStatus.body?.status || '');

  console.log(JSON.stringify({
    session,
    status,
    engine: actualEngine,
    version: version.body?.version || null,
    tier: version.body?.tier || null,
    platform: version.body?.platform || null,
  }, null, 2));

  if (actualEngine !== expectedEngine) {
    fail(`Engine esperada ${expectedEngine}, mas WAHA retornou ${actualEngine || 'vazia'}`);
  }
  if (status !== 'WORKING') {
    fail(`Sessao ${session} nao esta WORKING`, sessionStatus.body);
  }

  const chatId = chatIdFromPhone(testPhone);
  if (!chatId) {
    console.log('[waha:gows] sem WAHA_TEST_RECIPIENT_PHONE; envio real pulado.');
    return;
  }

  const textResult = await call('/api/sendText', {
    method: 'POST',
    body: JSON.stringify({
      session,
      chatId,
      text: `Teste WAHA ${actualEngine} - ${new Date().toISOString()}`,
    }),
  });
  if (!textResult.ok) fail('Falha ao enviar sendText', textResult);
  console.log('[waha:gows] sendText OK');

  const fileResult = await call('/api/sendFile', {
    method: 'POST',
    body: JSON.stringify({
      session,
      chatId,
      caption: `Teste arquivo WAHA ${actualEngine}`,
      file: {
        mimetype: 'text/plain',
        filename: 'waha-gows-smoke-test.txt',
        data: Buffer.from('waha gows smoke test\n', 'utf8').toString('base64'),
      },
    }),
  });
  if (!fileResult.ok) fail('Falha ao enviar sendFile', fileResult);
  console.log('[waha:gows] sendFile OK');
})().catch((err) => fail(err?.message || 'Erro inesperado', err?.stack));
