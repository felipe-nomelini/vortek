/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');

const PAGE_SIZE = 1000;
const DEFAULT_REPORT_LIMIT = 50;

function normalizeText(input) {
  return String(input ?? '').trim();
}

function toIsoNow() {
  return new Date().toISOString();
}

function statusRank(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (normalized === 'ativo') return 3;
  if (normalized === 'pausado') return 2;
  if (normalized === 'sem_anuncio') return 1;
  return 0;
}

function hasText(value) {
  return normalizeText(value).length > 0;
}

function maxNumber(values) {
  const numbers = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return 0;
  return Math.max(...numbers);
}

function pickFirstNonEmpty(values) {
  for (const value of values) {
    if (hasText(value)) return value;
  }
  return null;
}

async function fetchAllRows(queryFactory) {
  const rows = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

function buildProductsBySku(produtos) {
  const map = new Map();
  for (const produto of produtos) {
    const sku = normalizeText(produto.sku);
    if (!sku) continue;
    if (!map.has(sku)) map.set(sku, []);
    map.get(sku).push(produto);
  }
  return map;
}

function chooseCanonicalRow(rows, produto) {
  return [...rows].sort((a, b) => {
    const score = (row) => {
      let total = 0;
      if (produto && normalizeText(produto.ml_item_id) === normalizeText(row.ml_item_id)) total += 1000;
      total += statusRank(row.status) * 100;
      if (normalizeText(row.produto_id)) total += 50;
      if (row.catalogo === true) total += 5;
      if (hasText(row.permalink)) total += 3;
      if (hasText(row.thumbnail)) total += 1;
      total += Math.min(20, Number(row.vendidos || 0));
      total += Math.min(10, Number(row.visitas || 0) / 100);
      return total;
    };

    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
  })[0];
}

function buildCanonicalPatch(rows, canonical, produto) {
  const ordered = [canonical, ...rows.filter((row) => row.id !== canonical.id)];
  const produtoId = normalizeText(canonical.produto_id) || normalizeText(produto?.id) || null;

  return {
    sku: normalizeText(canonical.sku),
    produto_id: produtoId,
    titulo: pickFirstNonEmpty(ordered.map((row) => row.titulo)) || '',
    thumbnail: pickFirstNonEmpty(ordered.map((row) => row.thumbnail)) || null,
    permalink: pickFirstNonEmpty(ordered.map((row) => row.permalink)) || null,
    preco_ml: Number(canonical.preco_ml || 0),
    vendidos: maxNumber(rows.map((row) => row.vendidos)),
    visitas: maxNumber(rows.map((row) => row.visitas)),
    status: canonical.status,
    catalogo: canonical.catalogo === true,
    updated_at: toIsoNow(),
  };
}

function summarizeGroup(sku, rows, canonical, produto) {
  const duplicates = rows.filter((row) => row.id !== canonical.id);
  return {
    sku,
    count: rows.length,
    produto: produto
      ? {
          id: produto.id,
          ml_item_id: produto.ml_item_id || null,
          ml_status: produto.ml_status || null,
        }
      : null,
    canonical: {
      id: canonical.id,
      ml_item_id: canonical.ml_item_id,
      produto_id: canonical.produto_id || null,
      status: canonical.status,
      catalogo: canonical.catalogo,
      updated_at: canonical.updated_at,
    },
    duplicates: duplicates.map((row) => ({
      id: row.id,
      ml_item_id: row.ml_item_id,
      produto_id: row.produto_id || null,
      status: row.status,
      catalogo: row.catalogo,
      updated_at: row.updated_at,
    })),
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const reportLimitArg = process.argv.find((arg) => arg.startsWith('--report-limit='));
  const reportLimit = Number.isFinite(Number(reportLimitArg?.split('=')[1]))
    ? Math.max(1, Math.trunc(Number(reportLimitArg.split('=')[1])))
    : DEFAULT_REPORT_LIMIT;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const anuncios = await fetchAllRows((from, to) => (
    supabase
      .from('anuncios_ml')
      .select('id,ml_item_id,produto_id,sku,titulo,preco_ml,vendidos,visitas,status,catalogo,thumbnail,permalink,created_at,updated_at')
      .order('sku', { ascending: true })
      .range(from, to)
  ));

  const produtos = await fetchAllRows((from, to) => (
    supabase
      .from('produtos')
      .select('id,sku,ml_item_id,ml_status,updated_at')
      .order('sku', { ascending: true })
      .range(from, to)
  ));

  const productsBySku = buildProductsBySku(produtos);
  const groups = new Map();

  for (const anuncio of anuncios) {
    const sku = normalizeText(anuncio.sku);
    if (!sku) continue;
    if (!groups.has(sku)) groups.set(sku, []);
    groups.get(sku).push(anuncio);
  }

  const duplicateGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1);

  const report = {
    dry_run: !apply,
    duplicated_skus: duplicateGroups.length,
    duplicated_rows: duplicateGroups.reduce((total, [, rows]) => total + rows.length, 0),
    canonical_updates: 0,
    anuncios_deleted: 0,
    snapshot_deleted: 0,
    produtos_updated: 0,
    conflicts: 0,
    groups: [],
  };

  for (const [sku, rows] of duplicateGroups) {
    const produtoRows = productsBySku.get(sku) || [];
    const groupBase = { sku, count: rows.length };

    if (produtoRows.length > 1) {
      report.conflicts += 1;
      report.groups.push({
        ...groupBase,
        conflict: 'multiple_produtos_for_same_sku',
        produto_ids: produtoRows.map((row) => row.id),
        anuncios: rows.map((row) => ({ id: row.id, ml_item_id: row.ml_item_id, status: row.status, catalogo: row.catalogo })),
      });
      continue;
    }

    const produto = produtoRows[0] || null;
    const canonical = chooseCanonicalRow(rows, produto);
    const duplicates = rows.filter((row) => row.id !== canonical.id);
    const canonicalPatch = buildCanonicalPatch(rows, canonical, produto);
    const groupSummary = summarizeGroup(sku, rows, canonical, produto);

    if (apply) {
      const { error: updateCanonicalError } = await supabase
        .from('anuncios_ml')
        .update(canonicalPatch)
        .eq('id', canonical.id);
      if (updateCanonicalError) {
        report.conflicts += 1;
        report.groups.push({
          ...groupSummary,
          conflict: 'update_canonical_failed',
          error: updateCanonicalError.message,
        });
        continue;
      }
      report.canonical_updates += 1;

      if (produto) {
        const { error: updateProdutoError } = await supabase
          .from('produtos')
          .update({
            ml_item_id: canonical.ml_item_id,
            ml_status: canonical.status,
            updated_at: toIsoNow(),
          })
          .eq('id', produto.id);
        if (updateProdutoError) {
          report.conflicts += 1;
          report.groups.push({
            ...groupSummary,
            conflict: 'update_produto_failed',
            error: updateProdutoError.message,
          });
          continue;
        }
        report.produtos_updated += 1;
      }

      const duplicateIds = duplicates.map((row) => row.id);
      const duplicateMlItemIds = duplicates.map((row) => row.ml_item_id).filter(Boolean);

      if (duplicateIds.length > 0) {
        const { error: deleteAnunciosError } = await supabase
          .from('anuncios_ml')
          .delete()
          .in('id', duplicateIds);
        if (deleteAnunciosError) {
          report.conflicts += 1;
          report.groups.push({
            ...groupSummary,
            conflict: 'delete_anuncios_failed',
            error: deleteAnunciosError.message,
          });
          continue;
        }
        report.anuncios_deleted += duplicateIds.length;
      }

      if (duplicateMlItemIds.length > 0) {
        const { error: deleteSnapshotError } = await supabase
          .from('catalogo_ml_snapshot')
          .delete()
          .in('ml_item_id', duplicateMlItemIds);
        if (deleteSnapshotError) {
          report.conflicts += 1;
          report.groups.push({
            ...groupSummary,
            conflict: 'delete_snapshot_failed',
            error: deleteSnapshotError.message,
          });
          continue;
        }
        report.snapshot_deleted += duplicateMlItemIds.length;
      }
    }

    if (report.groups.length < reportLimit) {
      report.groups.push(groupSummary);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
