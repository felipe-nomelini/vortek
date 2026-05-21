/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');

const PREFIXES = ['FJ', 'NMC', 'VO'];

function normalizeSku(input) {
  return String(input ?? '').trim().toUpperCase();
}

function stripKnownPrefix(sku) {
  const normalized = normalizeSku(sku);
  for (const p of PREFIXES.sort((a, b) => b.length - a.length)) {
    if (normalized.startsWith(p)) {
      return normalized.slice(p.length);
    }
  }
  return normalized;
}

function canonicalSkuForDslite(row, baseSku) {
  const fid = String(row.dslite_fornecedor_id || '').trim();
  if (!fid) return null;
  const map = { '27': 'FJ', '39': 'NMC', '81': 'VO' };
  const prefix = map[fid];
  if (!prefix) return null;
  const pid = String(row.dslite_produto_id || '').trim() || baseSku;
  if (!pid) return null;
  return normalizeSku(`${prefix}${pid}`);
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function pickCanonical(rows) {
  const score = (row) => {
    let s = 0;
    if (!isEmpty(row.fornecedor)) s += 100;
    if (!isEmpty(row.dslite_fornecedor_id)) s += 40;
    if (!isEmpty(row.ml_item_id)) s += 30;
    if (!isEmpty(row.gtin)) s += 8;
    if (!isEmpty(row.ncm)) s += 8;
    if (!isEmpty(row.cest)) s += 6;
    if (!isEmpty(row.descricao)) s += 4;
    if (!isEmpty(row.imagens)) s += 4;
    if (!isEmpty(row.marca)) s += 3;
    if (!isEmpty(row.nome)) s += 2;
    return s;
  };
  return [...rows].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  })[0];
}

async function run() {
  const apply = process.argv.includes('--apply');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const pageSize = 1000;
  const produtos = [];
  let page = 0;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('produtos')
      .select('id, sku, nome, fornecedor, dslite_fornecedor_id, dslite_produto_id, ml_item_id, ml_status, ml_fee, ml_shipping, gtin, ncm, cest, imagens, descricao, custo, estoque, updated_at')
      .order('sku', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Erro ao buscar produtos:', error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      break;
    }
    produtos.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page += 1;
  }

  const groups = new Map();
  for (const p of produtos) {
    const base = stripKnownPrefix(p.sku);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(p);
  }

  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const report = {
    dry_run: !apply,
    duplicates_detected: duplicateGroups.length,
    merged: 0,
    deleted: 0,
    conflicts: 0,
    groups: [],
  };

  const fillableFields = ['ml_item_id', 'ml_status', 'ml_fee', 'ml_shipping', 'gtin', 'ncm', 'cest', 'imagens', 'descricao', 'fornecedor', 'dslite_fornecedor_id', 'dslite_produto_id'];
  const conflictFields = ['ml_item_id', 'fornecedor', 'dslite_fornecedor_id', 'dslite_produto_id'];

  for (const [baseSku, rows] of duplicateGroups) {
    const canonical = pickCanonical(rows);
    const duplicates = rows.filter((r) => r.id !== canonical.id);
    const groupResult = {
      base_sku: baseSku,
      canonical_id: canonical.id,
      canonical_sku: canonical.sku,
      duplicate_ids: duplicates.map((d) => d.id),
      duplicate_skus: duplicates.map((d) => d.sku),
      updates: {},
      deleted_ids: [],
      conflicts: [],
    };

    let nextCanonical = { ...canonical };
    for (const dup of duplicates) {
      for (const field of fillableFields) {
        if (isEmpty(nextCanonical[field]) && !isEmpty(dup[field])) {
          nextCanonical[field] = dup[field];
          groupResult.updates[field] = dup[field];
        }
      }

      for (const field of conflictFields) {
        if (!isEmpty(nextCanonical[field]) && !isEmpty(dup[field]) && String(nextCanonical[field]) !== String(dup[field])) {
          groupResult.conflicts.push({
            duplicate_id: dup.id,
            field,
            canonical_value: nextCanonical[field],
            duplicate_value: dup[field],
          });
        }
      }
    }

    if (groupResult.conflicts.length > 0) {
      report.conflicts += groupResult.conflicts.length;
      report.groups.push(groupResult);
      continue;
    }

    if (apply) {
      const forcedCanonicalSku = canonicalSkuForDslite(nextCanonical, baseSku);
      if (forcedCanonicalSku && nextCanonical.sku !== forcedCanonicalSku) {
        groupResult.updates.sku = forcedCanonicalSku;
        nextCanonical.sku = forcedCanonicalSku;
      }

      if (Object.keys(groupResult.updates).length > 0) {
        const { error: updateErr } = await supabase
          .from('produtos')
          .update(groupResult.updates)
          .eq('id', canonical.id);
        if (updateErr) {
          groupResult.conflicts.push({ field: 'update_canonical', error: updateErr.message });
          report.conflicts += 1;
          report.groups.push(groupResult);
          continue;
        }
      }

      for (const dup of duplicates) {
        await supabase
          .from('anuncios_ml')
          .update({ sku: canonical.sku, produto_id: canonical.id })
          .eq('sku', dup.sku);

        await supabase
          .from('anuncios_ml')
          .update({ produto_id: canonical.id })
          .eq('produto_id', dup.id);

        const { error: delErr } = await supabase
          .from('produtos')
          .delete()
          .eq('id', dup.id);

        if (delErr) {
          groupResult.conflicts.push({ duplicate_id: dup.id, field: 'delete', error: delErr.message });
          report.conflicts += 1;
          continue;
        }
        groupResult.deleted_ids.push(dup.id);
        report.deleted += 1;
      }
    }

    report.merged += 1;
    report.groups.push(groupResult);
  }

  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
