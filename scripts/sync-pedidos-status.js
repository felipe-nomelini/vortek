/**
 * Script de sync de pedidos standalone.
 * Atualiza os pedidos existentes no banco com os dados mais recentes do ML.
 * Uso: source .env.local && node scripts/sync-pedidos-status.js
 */

const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

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
      await assertAllowedMercadoLivreToken(integracao.access_token, 'sync-pedidos-status:cached');
      return integracao.access_token;
    }
  }

  // Refresh token
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
  await assertAllowedMercadoLivreToken(data.access_token, 'sync-pedidos-status');

  await supabase.from('integracoes').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    conectado: true,
  }).eq('tipo', 'mercadolivre');

  return data.access_token;
}

async function fetchMLRaw(token, path) {
  const res = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data, text };
}

async function fetchMLWithRefresh(path) {
  let token = await getValidMLToken();
  if (!token) return { ok: false, status: 401, data: null };

  let res = await fetchMLRaw(token, path);
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
  if (!token) return { ok: false, status: 401, data: null };
  return fetchMLRaw(token, path);
}

function mapearStatusShipment(shipmentStatus, shipmentSubstatus) {
  switch (shipmentStatus) {
    case 'pending': return 'pendente';
    case 'handling': return 'preparando';
    case 'ready_to_ship':
      if (shipmentSubstatus === 'printed') return 'etiqueta_impressa';
      if (shipmentSubstatus === 'picked_up') return 'coletado';
      return 'preparando';
    case 'shipped':
      if (shipmentSubstatus === 'out_for_delivery') return 'saiu_entrega';
      if (shipmentSubstatus === 'receiver_absent') return 'dest_ausente';
      return 'em_transito';
    case 'delivered': return 'entregue';
    case 'not_delivered':
      if (shipmentSubstatus === 'refused_delivery') return 'recusado';
      return 'dest_ausente';
    case 'cancelled': return 'cancelado';
    default: return 'aberto';
  }
}

async function main() {
  const meRes = await fetchMLWithRefresh('/users/me');
  const me = meRes.data;
  if (!meRes.ok || !me) {
    console.error('Failed to get user info');
    process.exit(1);
  }

  console.log(`Seller ID: ${me.id}`);

  // Buscar todos os pedidos do banco
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('id, ml_order_id, situacao')
    .not('ml_order_id', 'is', null);

  if (error) {
    console.error('Error fetching orders:', error);
    process.exit(1);
  }

  console.log(`Found ${pedidos?.length || 0} orders to sync`);

  let updated = 0;
  let skipped = 0;

  for (const pedido of pedidos || []) {
    try {
      const orderId = pedido.ml_order_id;

      // Buscar detalhes do pedido
      const detailRes = await fetchMLWithRefresh(`/orders/${orderId}`);
      const detail = detailRes.data;
      if (!detailRes.ok || !detail) {
        console.log(`[SKIP] Order ${orderId}: not found in ML`);
        skipped++;
        continue;
      }

      // Buscar shipment
      let mlShipmentId = null;
      let situacao = pedido.situacao;
      try {
        const shipmentRes = await fetchMLWithRefresh(`/orders/${orderId}/shipments`);
        const shipment = shipmentRes.data;
        if (shipmentRes.ok && shipment?.id) {
          mlShipmentId = String(shipment.id);
          const shipStatus = shipment.status;
          const shipSubstatus = shipment.substatus;
          if (shipStatus) {
            situacao = mapearStatusShipment(shipStatus, shipSubstatus);
          }
        }
      } catch (e) {
        // ignore
      }

      // Buscar claims via search endpoint
      let mlClaimId = null;
      let mlClaimStatus = null;
      let isDevolvido = false;
      try {
        const claimsSearchRes = await fetchMLWithRefresh(`/post-purchase/v1/claims/search?resource_id=${orderId}&resource=order`);
        const claimsSearch = claimsSearchRes.data;
        if (claimsSearchRes.ok && claimsSearch?.data && Array.isArray(claimsSearch.data) && claimsSearch.data.length > 0) {
          const claim = claimsSearch.data[0];
          mlClaimId = String(claim.id);
          mlClaimStatus = claim.status;
          isDevolvido = claim.resolution?.reason === 'item_returned' ||
                        (claim.resolution?.closed_by === 'mediator' &&
                         claim.resolution?.benefited?.includes('complainant'));
          if (isDevolvido) {
            situacao = 'devolvido';
          }
        }
      } catch (e) {
        // ignore
      }

      // Fallback: buscar pelo campo claim_id do pedido
      if (!mlClaimId && detail.claim_id) {
        try {
          mlClaimId = String(detail.claim_id);
          const claimRes = await fetchMLWithRefresh(`/post-purchase/v1/claims/${detail.claim_id}`);
          const claim = claimRes.data;
          if (claimRes.ok && claim?.status) {
            mlClaimStatus = claim.status;
          }
        } catch (e) {
          // ignore
        }
      }

      // Atualizar pedido
      const { error: updateError } = await supabase
        .from('pedidos')
        .update({
          situacao,
          ml_shipment_id: mlShipmentId,
          ml_claim_id: mlClaimId,
          ml_claim_status: mlClaimStatus,
        })
        .eq('id', pedido.id);

      if (updateError) {
        console.error(`[ERROR] Order ${orderId}:`, updateError.message);
        skipped++;
      } else {
        console.log(`[OK] Order ${orderId}: ${situacao} (shipment=${mlShipmentId}, claim=${mlClaimId}, devolvido=${isDevolvido})`);
        updated++;
      }

      // Pequeno delay para não sobrecarregar a API
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[ERROR] Order ${pedido.ml_order_id}:`, err.message);
      skipped++;
    }
  }

  console.log(`\nSync complete: ${updated} updated, ${skipped} skipped`);
}

main().catch(console.error);
