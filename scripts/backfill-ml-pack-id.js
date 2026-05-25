/**
 * Backfill de ml_pack_id em pedidos usando API oficial do Mercado Livre.
 *
 * Uso:
 *   set -a; source .env.local; set +a; node scripts/backfill-ml-pack-id.js
 *   ORDER_ID=2000016561767694 node scripts/backfill-ml-pack-id.js
 *   LIMIT=200 node scripts/backfill-ml-pack-id.js
 */

const { createClient } = require('@supabase/supabase-js');

async function getValidMLToken(sb, force = false) {
  const { data: integracao } = await sb
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .maybeSingle();

  if (!integracao?.refresh_token) return null;

  if (!force && integracao.access_token && integracao.token_expires_at) {
    const expiresAt = new Date(integracao.token_expires_at).getTime();
    if (expiresAt - Date.now() > 300000) return integracao.access_token;
  }

  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integracao.client_id || '',
      client_secret: integracao.client_secret || '',
      refresh_token: integracao.refresh_token,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.access_token || !data?.refresh_token) return null;

  await sb.from('integracoes').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: new Date(Date.now() + (data.expires_in || 10800) * 1000).toISOString(),
    conectado: true,
  }).eq('tipo', 'mercadolivre');

  return data.access_token;
}

async function fetchMLJson(sb, path) {
  let token = await getValidMLToken(sb);
  if (!token) return { ok: false, status: 401, data: null };

  const doFetch = async (tok) => fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });

  let res = await doFetch(token);
  if (res.status === 401) {
    token = await getValidMLToken(sb, true);
    if (!token) return { ok: false, status: 401, data: null };
    res = await doFetch(token);
  }

  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orderId = (process.env.ORDER_ID || '').trim();
  const limit = Number(process.env.LIMIT || 300);

  let query = sb
    .from('pedidos')
    .select('id, ml_order_id, ml_pack_id')
    .not('ml_order_id', 'is', null)
    .limit(limit)
    .order('updated_at', { ascending: false });

  if (orderId) query = query.eq('ml_order_id', orderId);

  const { data: pedidos, error } = await query;
  if (error) throw error;

  let checked = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const p of pedidos || []) {
    checked += 1;
    if (p.ml_pack_id) {
      skipped += 1;
      continue;
    }

    const orderFetch = await fetchMLJson(sb, `/orders/${p.ml_order_id}`);
    if (!orderFetch.ok || !orderFetch.data) {
      errors.push({ orderId: p.ml_order_id, status: orderFetch.status });
      continue;
    }

    const packId = orderFetch.data.pack_id ? String(orderFetch.data.pack_id) : null;
    const { error: upErr } = await sb
      .from('pedidos')
      .update({ ml_pack_id: packId })
      .eq('id', p.id);

    if (upErr) {
      errors.push({ orderId: p.ml_order_id, status: 0, error: upErr.message });
      continue;
    }

    updated += 1;
  }

  console.log(JSON.stringify({ ok: true, checked, updated, skipped, errorsCount: errors.length, errors: errors.slice(0, 20) }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
