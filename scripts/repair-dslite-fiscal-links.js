#!/usr/bin/env node

require('dotenv').config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const baseUrl = process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!baseUrl || !serviceKey) {
  throw new Error('SUPABASE_SERVICE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};

async function fetchAll(table, select, filters = []) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const url = new URL(`/rest/v1/${table}`, baseUrl);
    url.searchParams.set('select', select);
    url.searchParams.set('order', 'created_at.asc');
    for (const [key, value] of filters) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    if (!response.ok) throw new Error(`${table}: ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function updatePedido(id, values) {
  const url = new URL('/rest/v1/pedidos', baseUrl);
  url.searchParams.set('id', `eq.${id}`);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`pedido ${id}: ${await response.text()}`);
}

function increment(map, value) {
  const key = String(value || '').trim();
  if (key) map.set(key, (map.get(key) || 0) + 1);
}

async function main() {
  const [pedidos, eventos, compras] = await Promise.all([
    fetchAll('pedidos', 'id,ml_order_id,nfe_chave,dslite_id,created_at'),
    fetchAll(
      'nf_auditoria_eventos',
      'pedido_id,evento,resposta_ml,created_at',
      [['evento', 'in.(dslite_purchase_created_with_brasilnfe_xml,dslite_create_with_supplier_success,dslite_create_without_supplier_fallback_success)']],
    ),
    fetchAll('compras', 'id,dsid,nf_chave,nf_numero,status,status_dslite,created_at'),
  ]);

  const nfeCounts = new Map();
  const dsliteCounts = new Map();
  for (const pedido of pedidos) {
    increment(nfeCounts, pedido.nfe_chave);
    increment(dsliteCounts, pedido.dslite_id);
  }

  // Grupos operacionais legítimos têm poucos componentes. Cinco ou mais
  // vendas compartilhando NF/DSLite são tratados como contaminação.
  const suspects = pedidos.filter((pedido) =>
    (nfeCounts.get(String(pedido.nfe_chave || '')) || 0) > 4
    || (dsliteCounts.get(String(pedido.dslite_id || '')) || 0) > 4,
  );

  const compraByPair = new Map();
  for (const compra of compras) {
    const dsid = String(compra.dsid || '').trim();
    const nfe = String(compra.nf_chave || '').trim();
    if (!dsid || !nfe) continue;
    const pair = `${dsid}|${nfe}`;
    if (!compraByPair.has(pair)) compraByPair.set(pair, compra);
  }

  const evidenceByPedido = new Map();
  for (const evento of eventos) {
    const pedidoId = String(evento.pedido_id || '').trim();
    const dsid = String(evento.resposta_ml?.dsid || '').trim();
    const nfe = String(evento.resposta_ml?.nfe_chave || '').trim();
    const pair = `${dsid}|${nfe}`;
    if (!pedidoId || !dsid || !nfe || !compraByPair.has(pair)) continue;
    const pairs = evidenceByPedido.get(pedidoId) || new Set();
    pairs.add(pair);
    evidenceByPedido.set(pedidoId, pairs);
  }

  const repairs = [];
  let alreadyCorrect = 0;
  let ambiguous = 0;
  let missingEvidence = 0;

  for (const pedido of suspects) {
    const pairs = Array.from(evidenceByPedido.get(String(pedido.id)) || []);
    if (pairs.length > 1) {
      ambiguous += 1;
      continue;
    }
    if (pairs.length === 0) {
      missingEvidence += 1;
      continue;
    }

    const [dsid, nfe] = pairs[0].split('|');
    if (dsid === String(pedido.dslite_id || '') && nfe === String(pedido.nfe_chave || '')) {
      alreadyCorrect += 1;
      continue;
    }
    const compra = compraByPair.get(pairs[0]);
    repairs.push({ pedido, compra, dsid, nfe });
  }

  let repaired = 0;
  if (APPLY) {
    for (const repair of repairs) {
      await updatePedido(repair.pedido.id, {
        dslite_id: repair.dsid,
        dslite_status: repair.compra.status_dslite || repair.compra.status || null,
        nfe_chave: repair.nfe,
        nota_fiscal_numero: repair.compra.nf_numero || null,
        nfe_provider: 'brasilnfe',
        nfe_status: null,
        nfe_xml: null,
        nfe_external_id: null,
        nfe_protocolo: null,
        nfe_danfe_url: null,
        nfe_cfop: null,
        nota_fiscal_emitida: false,
        nfe_last_sync_at: null,
      });
      repaired += 1;
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    pedidos_total: pedidos.length,
    suspeitos: suspects.length,
    reparaveis: repairs.length,
    reparados: repaired,
    ja_corretos: alreadyCorrect,
    evidencias_ambiguas: ambiguous,
    sem_evidencia: missingEvidence,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
