/**
 * Script de teste para o endpoint de tracking
 * Uso: source .env.local && node scripts/test-tracking.js {pedido_id}
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function getValidMLToken(force = false) {
  const { data: integracao } = await supabase
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .single();

  if (!integracao?.refresh_token) return null;

  if (!force && integracao.access_token && integracao.token_expires_at) {
    const expiresAt = new Date(integracao.token_expires_at).getTime();
    if (expiresAt - Date.now() > 300000) {
      return integracao.access_token;
    }
  }

  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integracao.client_id || '',
      client_secret: integracao.client_secret || '',
      refresh_token: integracao.refresh_token,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();

  await supabase.from('integracoes').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    conectado: true,
  }).eq('tipo', 'mercadolivre');

  return data.access_token;
}

async function fetchMLRaw(token, path, extraHeaders = {}) {
  const res = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
  });
  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

async function fetchMLWithRefresh(path, extraHeaders = {}) {
  let token = await getValidMLToken();
  if (!token) return { ok: false, status: 401, data: null, text: 'missing_token' };

  let res = await fetchMLRaw(token, path, extraHeaders);
  if (res.ok) return res;
  if (res.status !== 401) return res;

  console.warn(JSON.stringify({
    event: 'ml_auth_retry',
    attempt: 'retry_after_forced_refresh',
    path,
    method: 'GET',
    status: 401,
    timestamp_utc: new Date().toISOString(),
  }));
  token = await getValidMLToken(true);
  if (!token) return { ok: false, status: 401, data: null, text: 'refresh_failed' };
  return fetchMLRaw(token, path, extraHeaders);
}

async function main() {
  const pedidoId = process.argv[2];
  if (!pedidoId) {
    console.error('Usage: node scripts/test-tracking.js {pedido_id}');
    process.exit(1);
  }

  console.log(`Testing tracking for pedido: ${pedidoId}`);

  const { data: pedido, error } = await supabase
    .from('pedidos')
    .select('ml_order_id, ml_shipment_id, ml_claim_id, ml_claim_status, rastreio')
    .eq('id', pedidoId)
    .maybeSingle();

  if (error) { console.error('DB error:', error); process.exit(1); }
  if (!pedido) { console.error('Pedido not found'); process.exit(1); }

  console.log('Pedido:', pedido);

  console.log('Token obtained successfully');

  if (pedido.ml_shipment_id) {
    console.log('\n=== FETCHING SHIPMENT DATA ===');

    // Status atual
    const currentRes = await fetchMLWithRefresh(`/shipments/${pedido.ml_shipment_id}`);
    const current = currentRes.data;
    console.log('Current status:', current?.status, current?.substatus);

    // History
    const historyRes = await fetchMLWithRefresh(`/shipments/${pedido.ml_shipment_id}/history`, { 'x-format-new': 'true' });
    console.log('History response status:', historyRes.status);

    if (historyRes.ok) {
      const historyData = historyRes.data;
      console.log('History is array:', Array.isArray(historyData));
      console.log('History length:', historyData.length);
      console.log('History items:');
      historyData.forEach((h, i) => {
        console.log(`  ${i + 1}. ${h.status} / ${h.substatus} @ ${h.date}`);
      });
    } else {
      console.error('History error:', historyRes.text);
    }

    // Carrier
    const carrierRes = await fetchMLWithRefresh(`/shipments/${pedido.ml_shipment_id}/carrier`);
    const carrier = carrierRes.data;
    console.log('Carrier:', carrier);
  }

  if (pedido.ml_claim_id) {
    console.log('\n=== FETCHING CLAIM DATA ===');
    const claimRes = await fetchMLWithRefresh(`/post-purchase/v1/claims/${pedido.ml_claim_id}`);
    const claim = claimRes.data;
    console.log('Claim:', JSON.stringify(claim, null, 2));
  }
}

main().catch(console.error);
