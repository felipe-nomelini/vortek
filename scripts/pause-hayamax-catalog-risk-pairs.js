/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

function argValue(name, fallback = null) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : fallback;
}

function sellerSku(item) {
  const attribute = (item?.attributes || []).find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(
    attribute?.value_name ||
      attribute?.value_id ||
      item?.seller_custom_field ||
      '',
  ).trim();
}

function relatedItemId(item) {
  for (const relation of item?.item_relations || []) {
    const id =
      relation?.id ||
      relation?.item_id ||
      relation?.item?.id ||
      relation?.item?.item_id;
    if (id) return String(id);
  }
  return item?.parent_item_id ? String(item.parent_item_id) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const keepTraditionalActive = process.argv.includes(
    '--keep-traditional-active',
  );
  const itemFilter = String(argValue('--item', '') || '').trim();
  const inputPath = path.resolve(argValue('--input', ''));
  if (!inputPath || !fs.existsSync(inputPath)) {
    throw new Error('Informe --input=ARQUIVO');
  }
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  let targets = (input.catalog_review || []).filter(
    (row) => row.status === 'catalog_divergence_high_risk',
  );
  let standaloneTargets = (input.standalone_review || []).filter(
    (row) => row.status === 'listing_divergence_high_risk_uneditable',
  );
  if (itemFilter) {
    targets = targets.filter(
      (row) => String(row.ml_item_id || '') === itemFilter,
    );
    standaloneTargets = standaloneTargets.filter(
      (row) => String(row.ml_item_id || '') === itemFilter,
    );
  }
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          input: inputPath,
          total: targets.length + standaloneTargets.length,
          targets: targets.map(({ ml_item_id, sku, divergences }) => ({
            ml_item_id,
            sku,
            kind: 'catalog_pair',
            divergences,
          })).concat(
            standaloneTargets.map(({ ml_item_id, sku, divergences }) => ({
              ml_item_id,
              sku,
              kind: 'standalone',
              divergences,
            })),
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios',
    );
  }
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let integration = null;
  let accessToken = null;
  async function token(forceRefresh = false) {
    if (accessToken && !forceRefresh) return accessToken;
    if (!integration) {
      const { data, error } = await supabase
        .from('integracoes')
        .select(
          'access_token,refresh_token,token_expires_at,client_id,client_secret',
        )
        .eq('tipo', 'mercadolivre')
        .maybeSingle();
      if (error || !data) {
        throw new Error(
          `Integração ML indisponível: ${error?.message || 'sem registro'}`,
        );
      }
      integration = data;
    }
    if (
      !forceRefresh &&
      integration.access_token &&
      new Date(integration.token_expires_at || 0).getTime() >
        Date.now() + 60000
    ) {
      await assertAllowedMercadoLivreToken(
        integration.access_token,
        'pause-hayamax-catalog-risk-pairs:cached',
      );
      accessToken = integration.access_token;
      return accessToken;
    }
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: integration.client_id || '',
        client_secret: integration.client_secret || '',
        refresh_token: integration.refresh_token || '',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const refreshed = await response.json().catch(() => ({}));
    if (!response.ok || !refreshed.access_token) {
      throw new Error(
        `Falha no refresh ML: HTTP ${response.status} ${
          refreshed.error || refreshed.message || ''
        }`,
      );
    }
    await assertAllowedMercadoLivreToken(
      refreshed.access_token,
      'pause-hayamax-catalog-risk-pairs:refresh',
    );
    const { error } = await supabase
      .from('integracoes')
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || integration.refresh_token,
        token_expires_at: new Date(
          Date.now() + Number(refreshed.expires_in || 10800) * 1000,
        ).toISOString(),
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
        last_refresh_error_code: null,
      })
      .eq('tipo', 'mercadolivre');
    if (error) throw new Error(`Falha ao persistir token ML: ${error.message}`);
    integration = {
      ...integration,
      ...refreshed,
      token_expires_at: new Date(
        Date.now() + Number(refreshed.expires_in || 10800) * 1000,
      ).toISOString(),
    };
    accessToken = refreshed.access_token;
    return accessToken;
  }

  async function mlRequest(pathname, options = {}, attempt = 1) {
    const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${await token(attempt > 1)}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (response.status === 401 && attempt === 1) {
      accessToken = null;
      return mlRequest(pathname, options, 2);
    }
    if (
      [408, 429, 500, 502, 503, 504].includes(response.status) &&
      attempt < 3
    ) {
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      return mlRequest(pathname, options, attempt + 1);
    }
    return { ok: response.ok, status: response.status, data, text };
  }

  const results = [];
  for (const target of targets) {
    let catalogBefore = await mlRequest(
      `/items/${encodeURIComponent(
        target.ml_item_id,
      )}?include_internal_attributes=true`,
    );
    const catalogSkuBefore = catalogBefore.ok
      ? sellerSku(catalogBefore.data)
      : '';
    let catalogSkuUpdate = null;
    if (
      catalogBefore.ok &&
      /^HYX\d+$/i.test(catalogSkuBefore) &&
      catalogSkuBefore !== target.sku
    ) {
      catalogSkuUpdate = await mlRequest(
        `/items/${encodeURIComponent(target.ml_item_id)}`,
        {
          method: 'PUT',
          body: {
            attributes: [
              {
                id: 'SELLER_SKU',
                value_name: target.sku,
              },
            ],
          },
        },
      );
      if (catalogSkuUpdate.ok) {
        catalogBefore = await mlRequest(
          `/items/${encodeURIComponent(
            target.ml_item_id,
          )}?include_internal_attributes=true`,
        );
      }
    }
    const liveSku = catalogBefore.ok ? sellerSku(catalogBefore.data) : '';
    const relatedId = catalogBefore.ok
      ? relatedItemId(catalogBefore.data)
      : null;
    if (
      !catalogBefore.ok ||
      catalogBefore.data?.catalog_listing !== true ||
      liveSku !== target.sku ||
      !relatedId
    ) {
      results.push({
        ml_item_id: target.ml_item_id,
        sku: target.sku,
        status: 'blocked_precondition',
        live_sku: liveSku || null,
        catalog_sku_before: catalogSkuBefore || null,
        catalog_sku_update_http: catalogSkuUpdate?.status || null,
        catalog_listing: catalogBefore.data?.catalog_listing ?? null,
        related_traditional_id: relatedId,
        error:
          catalogBefore.data?.message ||
          catalogBefore.text ||
          'Catálogo, SKU ou relação ao vivo divergente',
      });
      continue;
    }

    let traditionalBefore = await mlRequest(
      `/items/${encodeURIComponent(
        relatedId,
      )}?include_internal_attributes=true`,
    );
    const relatedSkuBefore = traditionalBefore.ok
      ? sellerSku(traditionalBefore.data)
      : '';
    let relatedSkuUpdate = null;
    if (
      traditionalBefore.ok &&
      /^HYX\d+$/i.test(relatedSkuBefore) &&
      relatedSkuBefore !== target.sku
    ) {
      relatedSkuUpdate = await mlRequest(
        `/items/${encodeURIComponent(relatedId)}`,
        {
          method: 'PUT',
          body: {
            attributes: [
              {
                id: 'SELLER_SKU',
                value_name: target.sku,
              },
            ],
          },
        },
      );
      if (relatedSkuUpdate.ok) {
        traditionalBefore = await mlRequest(
          `/items/${encodeURIComponent(
            relatedId,
          )}?include_internal_attributes=true`,
        );
      }
    }
    if (
      !traditionalBefore.ok ||
      sellerSku(traditionalBefore.data) !== target.sku
    ) {
      results.push({
        ml_item_id: target.ml_item_id,
        related_traditional_id: relatedId,
        sku: target.sku,
        status: 'blocked_related_precondition',
        related_sku_before: relatedSkuBefore || null,
        related_sku_update_http: relatedSkuUpdate?.status || null,
        error:
          traditionalBefore.data?.message ||
          traditionalBefore.text ||
          'Anúncio tradicional relacionado não confere',
      });
      continue;
    }

    if (keepTraditionalActive) {
      const catalogPause =
        catalogBefore.data.status !== 'active'
          ? { ok: true, status: 200, skipped: true }
          : await mlRequest(
              `/items/${encodeURIComponent(target.ml_item_id)}`,
              {
                method: 'PUT',
                body: { status: 'paused' },
              },
            );
      await new Promise((resolve) => setTimeout(resolve, 12000));
      let [catalogAfter, traditionalAfter] = await Promise.all([
        mlRequest(`/items/${encodeURIComponent(target.ml_item_id)}`),
        mlRequest(`/items/${encodeURIComponent(relatedId)}`),
      ]);
      let traditionalActivate = null;
      if (traditionalAfter.data?.status !== 'active') {
        traditionalActivate = await mlRequest(
          `/items/${encodeURIComponent(relatedId)}`,
          {
            method: 'PUT',
            body: { status: 'active' },
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 12000));
        [catalogAfter, traditionalAfter] = await Promise.all([
          mlRequest(`/items/${encodeURIComponent(target.ml_item_id)}`),
          mlRequest(`/items/${encodeURIComponent(relatedId)}`),
        ]);
      }

      const separated =
        catalogAfter.ok &&
        catalogAfter.data?.status !== 'active' &&
        traditionalAfter.ok &&
        traditionalAfter.data?.status === 'active';
      let restored = null;
      if (!separated) {
        const [catalogRestore, traditionalRestore] = await Promise.all([
          catalogAfter.data?.status === 'active'
            ? Promise.resolve({ ok: true, status: 200, skipped: true })
            : mlRequest(`/items/${encodeURIComponent(target.ml_item_id)}`, {
                method: 'PUT',
                body: { status: 'active' },
              }),
          traditionalAfter.data?.status === 'active'
            ? Promise.resolve({ ok: true, status: 200, skipped: true })
            : mlRequest(`/items/${encodeURIComponent(relatedId)}`, {
                method: 'PUT',
                body: { status: 'active' },
              }),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 12000));
        [catalogAfter, traditionalAfter] = await Promise.all([
          mlRequest(`/items/${encodeURIComponent(target.ml_item_id)}`),
          mlRequest(`/items/${encodeURIComponent(relatedId)}`),
        ]);
        restored = {
          catalog_restore_http: catalogRestore.status,
          traditional_restore_http: traditionalRestore.status,
          catalog_active: catalogAfter.data?.status === 'active',
          traditional_active: traditionalAfter.data?.status === 'active',
        };
      }

      const { data: product, error: productLookupError } = await supabase
        .from('produtos')
        .select('id')
        .eq('sku', target.sku)
        .maybeSingle();
      let database = {
        ok: false,
        error: productLookupError?.message || 'Produto local não encontrado',
      };
      if (product) {
        const catalogActive = catalogAfter.data?.status === 'active';
        const traditionalActive =
          traditionalAfter.data?.status === 'active';
        const ads = [
          {
            produto_id: product.id,
            ml_item_id: target.ml_item_id,
            sku: target.sku,
            titulo: String(catalogAfter.data?.title || target.ml_item_id),
            status: catalogActive ? 'ativo' : 'pausado',
            tipo: String(
              catalogAfter.data?.listing_type_id || 'gold_special',
            ),
            preco_ml: Number(catalogAfter.data?.price || 0),
            permalink: catalogAfter.data?.permalink || null,
            thumbnail: catalogAfter.data?.thumbnail || null,
            vendidos: Number(catalogAfter.data?.sold_quantity || 0),
            catalogo: true,
          },
          {
            produto_id: product.id,
            ml_item_id: relatedId,
            sku: target.sku,
            titulo: String(traditionalAfter.data?.title || relatedId),
            status: traditionalActive ? 'ativo' : 'pausado',
            tipo: String(
              traditionalAfter.data?.listing_type_id || 'gold_special',
            ),
            preco_ml: Number(traditionalAfter.data?.price || 0),
            permalink: traditionalAfter.data?.permalink || null,
            thumbnail: traditionalAfter.data?.thumbnail || null,
            vendidos: Number(traditionalAfter.data?.sold_quantity || 0),
            catalogo: false,
          },
        ];
        const [{ error: productError }, { error: adsError }] =
          await Promise.all([
            supabase
              .from('produtos')
              .update({
                ml_item_id: relatedId,
                ml_status: traditionalActive ? 'ativo' : 'pausado',
              })
              .eq('id', product.id),
            supabase
              .from('anuncios_ml')
              .upsert(ads, { onConflict: 'ml_item_id' }),
          ]);
        database = {
          ok: !productError && !adsError,
          error: productError?.message || adsError?.message || null,
          canonical_ml_item_id: relatedId,
        };
      }

      results.push({
        ml_item_id: target.ml_item_id,
        related_traditional_id: relatedId,
        sku: target.sku,
        risk: (target.divergences || []).join('; '),
        status: separated
          ? 'catalog_paused_traditional_active'
          : restored?.catalog_active && restored?.traditional_active
            ? 'unable_to_separate_restored_active'
            : 'partial_or_error',
        catalog_pause_http: catalogPause.status,
        traditional_activate_http: traditionalActivate?.status || null,
        catalog_status: catalogAfter.data?.status || null,
        traditional_status: traditionalAfter.data?.status || null,
        restored,
        database,
      });
      continue;
    }

    const traditionalPause =
      traditionalBefore.data.status === 'paused'
        ? { ok: true, status: 200, skipped: true }
        : await mlRequest(`/items/${encodeURIComponent(relatedId)}`, {
            method: 'PUT',
            body: { status: 'paused' },
          });
    const catalogPause =
      catalogBefore.data.status !== 'active'
        ? { ok: true, status: 200, skipped: true }
        : await mlRequest(
            `/items/${encodeURIComponent(target.ml_item_id)}`,
            {
              method: 'PUT',
              body: { status: 'paused' },
            },
          );

    await new Promise((resolve) => setTimeout(resolve, 500));
    const [catalogAfter, traditionalAfter] = await Promise.all([
      mlRequest(`/items/${encodeURIComponent(target.ml_item_id)}`),
      mlRequest(`/items/${encodeURIComponent(relatedId)}`),
    ]);
    const catalogUnavailable =
      catalogAfter.ok && catalogAfter.data?.status !== 'active';
    const traditionalPaused =
      traditionalAfter.data?.status === 'paused' &&
      (traditionalAfter.data?.sub_status || []).includes('paused_by_seller');

    let database = { ok: false, error: 'Pausa não confirmada no ML' };
    if (catalogUnavailable && traditionalPaused) {
      const { data: product, error: productLookupError } = await supabase
        .from('produtos')
        .select('id')
        .eq('sku', target.sku)
        .maybeSingle();
      if (productLookupError || !product) {
        database = {
          ok: false,
          error: productLookupError?.message || 'Produto local não encontrado',
        };
      } else {
        const ads = [
          {
            produto_id: product.id,
            ml_item_id: target.ml_item_id,
            sku: target.sku,
            titulo: String(catalogAfter.data?.title || target.ml_item_id),
            status: 'pausado',
            tipo: String(catalogAfter.data?.listing_type_id || 'gold_special'),
            preco_ml: Number(catalogAfter.data?.price || 0),
            permalink: catalogAfter.data?.permalink || null,
            thumbnail: catalogAfter.data?.thumbnail || null,
            vendidos: Number(catalogAfter.data?.sold_quantity || 0),
            catalogo: true,
          },
          {
            produto_id: product.id,
            ml_item_id: relatedId,
            sku: target.sku,
            titulo: String(traditionalAfter.data?.title || relatedId),
            status: 'pausado',
            tipo: String(
              traditionalAfter.data?.listing_type_id || 'gold_special',
            ),
            preco_ml: Number(traditionalAfter.data?.price || 0),
            permalink: traditionalAfter.data?.permalink || null,
            thumbnail: traditionalAfter.data?.thumbnail || null,
            vendidos: Number(traditionalAfter.data?.sold_quantity || 0),
            catalogo: false,
          },
        ];
        const [{ error: productError }, { error: adsError }] =
          await Promise.all([
            supabase
              .from('produtos')
              .update({
                ml_item_id: relatedId,
                ml_status: 'pausado',
              })
              .eq('id', product.id),
            supabase
              .from('anuncios_ml')
              .upsert(ads, { onConflict: 'ml_item_id' }),
          ]);
        database = {
          ok: !productError && !adsError,
          error: productError?.message || adsError?.message || null,
          canonical_ml_item_id: relatedId,
        };
      }
    }

    results.push({
      ml_item_id: target.ml_item_id,
      related_traditional_id: relatedId,
      sku: target.sku,
      risk: (target.divergences || []).join('; '),
      status:
        catalogUnavailable && traditionalPaused && database.ok
          ? 'paused'
          : 'partial_or_error',
      catalog_pause_http: catalogPause.status,
      traditional_pause_http: traditionalPause.status,
      related_sku_before: relatedSkuBefore || null,
      related_sku_update_http: relatedSkuUpdate?.status || null,
      catalog_sku_before: catalogSkuBefore || null,
      catalog_sku_update_http: catalogSkuUpdate?.status || null,
      catalog_status: catalogAfter.data?.status || null,
      catalog_sub_status: catalogAfter.data?.sub_status || [],
      traditional_status: traditionalAfter.data?.status || null,
      traditional_sub_status: traditionalAfter.data?.sub_status || [],
      database,
    });
  }

  for (const target of standaloneTargets) {
    const before = await mlRequest(
      `/items/${encodeURIComponent(
        target.ml_item_id,
      )}?include_internal_attributes=true`,
    );
    const liveSku = before.ok ? sellerSku(before.data) : '';
    if (!before.ok || liveSku !== target.sku) {
      results.push({
        ml_item_id: target.ml_item_id,
        sku: target.sku,
        kind: 'standalone',
        status: 'blocked_precondition',
        live_sku: liveSku || null,
        error:
          before.data?.message ||
          before.text ||
          'Anúncio ou SKU ao vivo divergente',
      });
      continue;
    }
    const pause =
      before.data.status === 'paused'
        ? { ok: true, status: 200, skipped: true }
        : await mlRequest(`/items/${encodeURIComponent(target.ml_item_id)}`, {
            method: 'PUT',
            body: { status: 'paused' },
          });
    const after = await mlRequest(
      `/items/${encodeURIComponent(target.ml_item_id)}`,
    );
    const paused =
      after.data?.status === 'paused' &&
      (after.data?.sub_status || []).includes('paused_by_seller');
    let database = { ok: false, error: 'Pausa não confirmada no ML' };
    if (paused) {
      const { data: ad, error: adLookupError } = await supabase
        .from('anuncios_ml')
        .select('produto_id')
        .eq('ml_item_id', target.ml_item_id)
        .maybeSingle();
      if (adLookupError || !ad?.produto_id) {
        database = {
          ok: false,
          error:
            adLookupError?.message || 'Vínculo local do anúncio não encontrado',
        };
      } else {
        const [{ error: adError }, { error: productError }] =
          await Promise.all([
            supabase
              .from('anuncios_ml')
              .update({ status: 'pausado' })
              .eq('ml_item_id', target.ml_item_id),
            supabase
              .from('produtos')
              .update({ ml_status: 'pausado' })
              .eq('id', ad.produto_id),
          ]);
        database = {
          ok: !adError && !productError,
          error: adError?.message || productError?.message || null,
          canonical_ml_item_id: target.ml_item_id,
        };
      }
    }
    results.push({
      ml_item_id: target.ml_item_id,
      sku: target.sku,
      kind: 'standalone',
      risk: (target.divergences || []).join('; '),
      status: paused && database.ok ? 'paused' : 'partial_or_error',
      pause_http: pause.status,
      live_status: after.data?.status || null,
      live_sub_status: after.data?.sub_status || [],
      database,
    });
  }

  const outputPath = path.join(
    path.dirname(inputPath),
    `pausas-catalogo-risco-alto-checkpoint-10-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        source: inputPath,
        results,
        counts: results.reduce((counts, row) => {
          counts[row.status] = (counts[row.status] || 0) + 1;
          return counts;
        }, {}),
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify(
      {
        ok: results.every((row) =>
          [
            'paused',
            'catalog_paused_traditional_active',
            'restored_both_active',
          ].includes(row.status),
        ),
        counts: results.reduce((counts, row) => {
          counts[row.status] = (counts[row.status] || 0) + 1;
          return counts;
        }, {}),
        output: outputPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
