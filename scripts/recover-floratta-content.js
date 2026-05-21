/**
 * Recupera descrição/imagens ausentes de produtos Floratta (fornecedor 27 / SKU FJ*)
 * consultando DSLite item a item.
 *
 * Dry-run (default):
 *   set -a; source .env.local; set +a; node scripts/recover-floratta-content.js
 *
 * Aplicar alterações:
 *   set -a; source .env.local; set +a; node scripts/recover-floratta-content.js --apply
 *
 * Opcional:
 *   LIMIT=200 node scripts/recover-floratta-content.js --apply
 */

const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.env.LIMIT || 500);

function normalizeText(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function pickBestDescription(item) {
  const descricao = normalizeText(item?.descricao);
  if (descricao) return descricao;
  const caracteristicas = normalizeText(item?.caracteristicas);
  if (caracteristicas) return caracteristicas;
  const informacoes = normalizeText(item?.informacoes);
  if (informacoes) return informacoes;
  return '';
}

function extractImageUrls(item) {
  const urls = [];
  const midias = Array.isArray(item?.midias) ? item.midias : [];
  for (const media of midias) {
    const tipo = normalizeText(media?.tipo).toLowerCase();
    const valor = normalizeText(media?.valor);
    if (!valor) continue;
    if (tipo === 'imagem' || tipo === 'image' || tipo === 'img') {
      urls.push(valor);
    }
  }
  if (urls.length === 0) {
    const fallback = normalizeText(item?.link_imagem);
    if (fallback) urls.push(fallback);
  }
  return Array.from(new Set(urls));
}

function parseProdutoIdFromSku(sku) {
  const normalized = normalizeText(sku).toUpperCase();
  if (!normalized.startsWith('FJ')) return null;
  const raw = normalized.slice(2).trim();
  return raw || null;
}

async function fetchDsliteProduto(dsliteUrl, dsliteToken, fornecedorId, produtoId) {
  const res = await fetch(`${dsliteUrl}/v1/CrossDocking/Catalogo/${fornecedorId}/${produtoId}`, {
    headers: {
      'Content-Type': 'application/json',
      Token: dsliteToken,
    },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.produto || null;
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

  const { data: dsliteCfg, error: dsliteErr } = await sb
    .from('integracoes')
    .select('url, access_token')
    .eq('tipo', 'dslite')
    .single();

  if (dsliteErr || !dsliteCfg?.url || !dsliteCfg?.access_token) {
    throw new Error(`Integração DSLite indisponível: ${dsliteErr?.message || 'sem url/token'}`);
  }

  const dsliteUrl = String(dsliteCfg.url).replace(/\/+$/, '');
  const dsliteToken = dsliteCfg.access_token;

  const { data: produtos, error: produtosErr } = await sb
    .from('produtos')
    .select('id, sku, nome, dslite_fornecedor_id, dslite_produto_id, descricao, imagens')
    .or('dslite_fornecedor_id.eq.27,sku.ilike.FJ%')
    .limit(LIMIT);

  if (produtosErr) {
    throw new Error(`Erro ao consultar produtos: ${produtosErr.message}`);
  }

  let checked = 0;
  let candidates = 0;
  let recoveredDescription = 0;
  let recoveredImages = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const preview = [];

  for (const row of produtos || []) {
    checked += 1;
    const existingDescription = normalizeText(row.descricao);
    const existingImages = Array.isArray(row.imagens)
      ? row.imagens.map((v) => normalizeText(v)).filter(Boolean)
      : [];
    const missingDescription = !existingDescription;
    const missingImages = existingImages.length === 0;

    if (!missingDescription && !missingImages) {
      skipped += 1;
      continue;
    }
    candidates += 1;

    const fornecedorId = String(row.dslite_fornecedor_id || '27');
    const produtoId = String(row.dslite_produto_id || parseProdutoIdFromSku(row.sku || ''));
    if (!produtoId) {
      errors.push({ id: row.id, sku: row.sku, error: 'Sem dslite_produto_id e sem parse de SKU' });
      continue;
    }

    const dsliteProduto = await fetchDsliteProduto(dsliteUrl, dsliteToken, fornecedorId, produtoId);
    if (!dsliteProduto) {
      errors.push({ id: row.id, sku: row.sku, error: 'Produto não encontrado na DSLite' });
      continue;
    }

    const nextDescriptionRaw = pickBestDescription(dsliteProduto);
    const nextImagesRaw = extractImageUrls(dsliteProduto);

    const nextDescription = missingDescription ? nextDescriptionRaw : existingDescription;
    const nextImages = missingImages ? nextImagesRaw : existingImages;

    const willRecoverDescription = missingDescription && Boolean(nextDescriptionRaw);
    const willRecoverImages = missingImages && nextImagesRaw.length > 0;
    if (willRecoverDescription) recoveredDescription += 1;
    if (willRecoverImages) recoveredImages += 1;

    if (!willRecoverDescription && !willRecoverImages) {
      continue;
    }

    if (preview.length < 25) {
      preview.push({
        id: row.id,
        sku: row.sku,
        recovered_description: willRecoverDescription,
        recovered_images: willRecoverImages,
      });
    }

    if (!APPLY) continue;

    const payload = {
      descricao: nextDescription || '',
      imagens: Array.from(new Set(nextImages)),
      dslite_ultima_sync: new Date().toISOString(),
    };

    const { error: updateErr } = await sb
      .from('produtos')
      .update(payload)
      .eq('id', row.id);

    if (updateErr) {
      errors.push({ id: row.id, sku: row.sku, error: updateErr.message });
      continue;
    }
    updated += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    apply: APPLY,
    checked,
    candidates,
    recovered_description: recoveredDescription,
    recovered_images: recoveredImages,
    updated,
    skipped,
    errors_count: errors.length,
    errors: errors.slice(0, 30),
    preview,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});

