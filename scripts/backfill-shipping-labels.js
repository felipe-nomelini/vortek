/**
 * Backfill de etiquetas ML no Supabase Storage.
 *
 * Uso:
 *   set -a; source .env.local; set +a; node scripts/backfill-shipping-labels.js
 *   LIMIT=50 node scripts/backfill-shipping-labels.js
 *   ORDER_ID=2000016976350266 node scripts/backfill-shipping-labels.js
 *   DRY_RUN=1 node scripts/backfill-shipping-labels.js
 */

const { createClient } = require('@supabase/supabase-js');

const LABEL_BUCKET = 'etiquetas';

function buildShippingLabelPath(pedidoNumero, shipmentId) {
  const shipment = String(shipmentId || '').trim().replace(/[^\w.-]+/g, '_');
  if (!shipment) return null;
  const pedido = String(pedidoNumero || 'sem_pedido').trim().replace(/[^\w.-]+/g, '_') || 'sem_pedido';
  return `${pedido}/${shipment}.pdf`;
}

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

async function fetchMlLabel(sb, shipmentId) {
  let token = await getValidMLToken(sb);
  if (!token) return { ok: false, status: 401, error: 'Token ML indisponível' };

  const doFetch = async (tok) => fetch(
    `https://api.mercadolibre.com/shipment_labels?shipment_ids=${encodeURIComponent(shipmentId)}&response_type=pdf`,
    { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/pdf' } },
  );

  let res = await doFetch(token);
  if (res.status === 401) {
    token = await getValidMLToken(sb, true);
    if (!token) return { ok: false, status: 401, error: 'Refresh ML falhou' };
    res = await doFetch(token);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.toLowerCase().includes('pdf')) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: body.slice(0, 500) || `ML retornou ${res.status}`,
    };
  }

  const arrayBuffer = await res.arrayBuffer();
  return { ok: true, status: res.status, pdf: Buffer.from(arrayBuffer) };
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const dryRun = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());
  const limit = Number(process.env.LIMIT || 100);
  const orderId = String(process.env.ORDER_ID || '').trim();

  let query = sb
    .from('pedidos')
    .select('id,numero,ml_order_id,ml_shipment_id,ml_label_storage_path')
    .not('ml_shipment_id', 'is', null)
    .is('ml_label_storage_path', null)
    .order('data', { ascending: false })
    .limit(limit);

  if (orderId) query = query.eq('ml_order_id', orderId);

  const { data: pedidos, error } = await query;
  if (error) throw error;

  const result = {
    ok: true,
    dryRun,
    checked: 0,
    stored: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const pedido of pedidos || []) {
    result.checked += 1;
    const shipmentId = String(pedido.ml_shipment_id || '').trim();
    const storagePath = buildShippingLabelPath(pedido.numero, shipmentId);
    if (!shipmentId || !storagePath) {
      result.skipped += 1;
      continue;
    }

    if (dryRun) {
      result.skipped += 1;
      continue;
    }

    const label = await fetchMlLabel(sb, shipmentId);
    if (!label.ok || !label.pdf?.length) {
      result.failed += 1;
      result.errors.push({
        pedido: pedido.numero,
        ml_order_id: pedido.ml_order_id,
        shipment_id: shipmentId,
        status: label.status,
        error: label.error,
      });
      continue;
    }

    const upload = await sb.storage.from(LABEL_BUCKET).upload(storagePath, label.pdf, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upload.error) {
      result.failed += 1;
      result.errors.push({
        pedido: pedido.numero,
        ml_order_id: pedido.ml_order_id,
        shipment_id: shipmentId,
        error: upload.error.message,
      });
      continue;
    }

    const signed = await sb.storage.from(LABEL_BUCKET).createSignedUrl(storagePath, 60 * 60);
    const update = await sb.from('pedidos').update({
      ml_label_storage_path: storagePath,
      ml_label_url: signed.data?.signedUrl || null,
      ml_label_downloaded_at: new Date().toISOString(),
      ml_label_bytes: label.pdf.length,
    }).eq('id', pedido.id);

    if (update.error) {
      result.failed += 1;
      result.errors.push({
        pedido: pedido.numero,
        ml_order_id: pedido.ml_order_id,
        shipment_id: shipmentId,
        error: update.error.message,
      });
      continue;
    }

    result.stored += 1;
  }

  console.log(JSON.stringify({
    ...result,
    errors: result.errors.slice(0, 50),
    errorsCount: result.errors.length,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
