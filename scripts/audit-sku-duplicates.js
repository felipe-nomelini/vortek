/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');

const PREFIXES = ['FJ', 'NMC', 'VO'];

function normalizeSku(input) {
  return String(input ?? '').trim().toUpperCase();
}

function stripKnownPrefix(sku) {
  const normalized = normalizeSku(sku);
  for (const p of PREFIXES.sort((a, b) => b.length - a.length)) {
    if (normalized.startsWith(p)) return normalized.slice(p.length);
  }
  return normalized;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fornecedorId = (process.env.FORNECEDOR_ID || '').trim();
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let query = supabase
    .from('produtos')
    .select('id, sku, nome, fornecedor, dslite_fornecedor_id, dslite_produto_id, ml_item_id, updated_at')
    .order('sku', { ascending: true })
    .limit(10000);

  if (fornecedorId) {
    query = query.eq('dslite_fornecedor_id', fornecedorId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const groups = new Map();
  for (const p of data || []) {
    const base = stripKnownPrefix(p.sku);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }

  const duplicates = [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([baseSku, rows]) => ({
      base_sku: baseSku,
      count: rows.length,
      fornecedores: [...new Set(rows.map((r) => r.dslite_fornecedor_id || null))],
      skus: rows.map((r) => r.sku),
      ids: rows.map((r) => r.id),
      ml_items: rows.map((r) => r.ml_item_id).filter(Boolean),
    }));

  console.log(JSON.stringify({
    ok: true,
    total_rows: (data || []).length,
    duplicates_detected: duplicates.length,
    duplicates: duplicates.slice(0, 300),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});

