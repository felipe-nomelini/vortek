/**
 * Backfill de status fiscal (nfe_status) com fonte oficial do Mercado Livre.
 *
 * Uso:
 *   set -a; source .env.local; set +a; node scripts/backfill-nfe-status.js
 *
 * Opcional:
 *   ORDER_ID=2000016078960210 node scripts/backfill-nfe-status.js
 *   LIMIT=100 node scripts/backfill-nfe-status.js
 */

const { createClient } = require('@supabase/supabase-js');

function normalizeNfeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'authorized' || normalized === 'autorizada') return 'autorizada';
  if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'cancelada') return 'cancelada';
  if (!normalized) return 'pendente';
  return normalized;
}

async function getValidMLToken(sb, force = false) {
  const { data: integracao, error } = await sb
    .from('integracoes')
    .select('*')
    .eq('tipo', 'mercadolivre')
    .maybeSingle();

  if (error || !integracao?.refresh_token) return null;

  if (!force && integracao.access_token && integracao.token_expires_at) {
    const expiresAt = new Date(integracao.token_expires_at).getTime();
    if (expiresAt - Date.now() > 300000) return integracao.access_token;
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
  if (!token) return { ok: false, status: 401, data: null, errorText: 'missing_token' };

  const doFetch = async (tok) => fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });

  let res = await doFetch(token);
  if (res.status === 401) {
    console.warn(JSON.stringify({
      event: 'ml_auth_retry',
      attempt: 'retry_after_forced_refresh',
      path,
      method: 'GET',
      status: 401,
      timestamp_utc: new Date().toISOString(),
    }));
    const freshToken = await getValidMLToken(sb, true);
    if (!freshToken) return { ok: false, status: 401, data: null, errorText: 'refresh_failed' };
    token = freshToken;
    res = await doFetch(token);
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    return { ok: false, status: res.status, data: null, errorText };
  }

  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data, errorText: null };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRole) {
    throw new Error('SUPABASE não configurado no ambiente.');
  }

  const sb = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const orderId = (process.env.ORDER_ID || '').trim();
  const limit = Number(process.env.LIMIT || 200);

  const meResult = await fetchMLJson(sb, '/users/me');
  const me = meResult.data;
  if (!meResult.ok || !me?.id) {
    throw new Error('Falha ao obter /users/me no ML.');
  }

  let query = sb
    .from('pedidos')
    .select('id, ml_order_id, situacao, nota_fiscal_emitida, nfe_status')
    .not('ml_order_id', 'is', null)
    .eq('nota_fiscal_emitida', true)
    .limit(limit)
    .order('updated_at', { ascending: false });

  if (orderId) {
    query = query.eq('ml_order_id', orderId);
  }

  const { data: pedidos, error: pedidosError } = await query;

  if (pedidosError) {
    throw new Error(`Erro ao buscar pedidos: ${pedidosError.message}`);
  }

  let checked = 0;
  let updated = 0;
  let semInvoice = 0;
  let unchanged = 0;
  const errors = [];

  for (const p of pedidos || []) {
    checked += 1;
    const oid = String(p.ml_order_id);

    try {
      const invResult = await fetchMLJson(sb, `/users/${me.id}/invoices/orders/${oid}`);
      if (invResult.status === 404) {
        semInvoice += 1;
        continue;
      }

      if (!invResult.ok) {
        errors.push({ orderId: oid, status: invResult.status || 0, error: String(invResult.errorText || '').slice(0, 200) });
        continue;
      }

      const invoice = invResult.data;
      const nextNfeStatus = normalizeNfeStatus(invoice?.status);
      const currentNfeStatus = String(p.nfe_status || '').toLowerCase();

      if (currentNfeStatus === nextNfeStatus.toLowerCase()) {
        unchanged += 1;
        continue;
      }

      const { error: updateErr } = await sb
        .from('pedidos')
        .update({
          nfe_status: nextNfeStatus,
          nota_fiscal_numero: invoice?.invoice_number ? String(invoice.invoice_number) : undefined,
          nfe_chave: invoice?.attributes?.invoice_key || undefined,
        })
        .eq('id', p.id);

      if (updateErr) {
        errors.push({ orderId: oid, status: 0, error: updateErr.message });
      } else {
        updated += 1;
      }
    } catch (err) {
      errors.push({ orderId: oid, status: 0, error: err?.message || String(err) });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    checked,
    updated,
    unchanged,
    semInvoice,
    errorsCount: errors.length,
    errors: errors.slice(0, 20),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
