#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env.local'), quiet: true });

const endpoint = 'https://app.bentevi.shop/api/ml/agente/preco';
const [action, productId, itemId, price, operationId] = process.argv.slice(2);
const secret = process.env.ML_AGENT_PRICE_SECRET || '';
if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('ML_AGENT_PRICE_SECRET ausente ou inválido');

async function call(method, url, body) {
  const timestamp = String(Date.now());
  const payload = body ? JSON.stringify(body) : '';
  const target = new URL(url);
  const message = `${method}\n${target.pathname}${target.search}\n${timestamp}\n${payload}`;
  const signature = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(message).digest('hex');
  const response = await fetch(url, { method, headers: {
    'x-bentevi-agent-timestamp': timestamp,
    'x-bentevi-agent-signature': signature,
    ...(body ? { 'content-type': 'application/json' } : {}),
  }, ...(body ? { body: payload } : {}) });
  const result = await response.json();
  process.stdout.write(JSON.stringify({ status: response.status, ...result }) + '\n');
  if (!response.ok) process.exitCode = 1;
}

if (action === 'status' && /^[a-f0-9-]{36}$/i.test(productId || '') && !itemId) {
  call('GET', `${endpoint}?operationId=${encodeURIComponent(productId)}`).catch(error => {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  });
} else if (['check', 'apply'].includes(action)
  && /^[a-f0-9-]{36}$/i.test(productId || '') && /^MLB\d+$/.test(itemId || '')
  && /^\d+$/.test(price || '') && Number(price) > 0 && Number.isSafeInteger(Number(price))
  && /^[a-f0-9-]{36}$/i.test(operationId || '')) {
  const body = { operationId, produtoId: productId, mlItemId: itemId, priceCents: Number(price),
    ...(action === 'check' ? { checkOnly: true } : {}) };
  process.stdout.write(`operationId=${operationId}\n`);
  call('POST', endpoint, body).catch(error => {
    process.stderr.write(`${error.message}\n`); process.exitCode = 1;
  });
} else {
  process.stderr.write('Uso: ml-agent-price.js check|apply <produtoId> <MLB> <centavos> <operationId> | status <operationId>\n');
  process.exitCode = 2;
}
