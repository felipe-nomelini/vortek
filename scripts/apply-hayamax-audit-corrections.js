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

function getSellerSku(item) {
  const attribute = (item?.attributes || []).find(
    (row) => String(row?.id || '').toUpperCase() === 'SELLER_SKU',
  );
  return String(attribute?.value_name || attribute?.value_id || '').trim();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeAttributeValue(value) {
  return String(value || '')
    .split(',')
    .map((part) => normalize(part))
    .filter(Boolean)
    .join(',');
}

function attributeMatches(item, expected) {
  const actual = (item?.attributes || []).find(
    (row) =>
      String(row?.id || '').toUpperCase() ===
      String(expected?.id || '').toUpperCase(),
  );
  if (!actual) {
    return expected?.value_id === null && expected?.value_name === null;
  }
  if (Object.hasOwn(expected, 'value_id')) {
    if (expected.value_id === null && expected.value_name === null) {
      return actual.value_id === null && actual.value_name === null;
    }
    if (String(actual.value_id || '') !== String(expected.value_id || '')) {
      return false;
    }
  }
  if (Object.hasOwn(expected, 'value_name') && expected.value_name !== null) {
    return (
      normalizeAttributeValue(actual.value_name) ===
      normalizeAttributeValue(expected.value_name)
    );
  }
  return true;
}

function getAttributeMismatches(item, expectedAttributes = []) {
  return expectedAttributes
    .filter((expected) => !attributeMatches(item, expected))
    .map((expected) => {
      const actual = (item?.attributes || []).find(
        (row) =>
          String(row?.id || '').toUpperCase() ===
          String(expected?.id || '').toUpperCase(),
      );
      return {
        id: expected.id,
        expected: {
          value_id: Object.hasOwn(expected, 'value_id')
            ? expected.value_id
            : undefined,
          value_name: Object.hasOwn(expected, 'value_name')
            ? expected.value_name
            : undefined,
        },
        actual: actual
          ? {
              value_id: actual.value_id ?? null,
              value_name: actual.value_name ?? null,
            }
          : null,
      };
    });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const inputPath = path.resolve(
    argValue(
      '--input',
      'reports/auditoria-anuncios-hayamax-2026-07-24/lote-001-correcoes.json',
    ),
  );
  const itemFilter = String(argValue('--item', '') || '').trim();
  const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  let corrections = Array.isArray(payload.corrections)
    ? payload.corrections
    : [];
  if (itemFilter) {
    corrections = corrections.filter(
      (row) => String(row.ml_item_id) === itemFilter,
    );
  }

  for (const row of corrections) {
    if (!/^MLB\d+$/.test(String(row.ml_item_id || ''))) {
      throw new Error(`ml_item_id inválido: ${row.ml_item_id || '(vazio)'}`);
    }
    if (!/^VTK\d+$/.test(String(row.sku || ''))) {
      throw new Error(`SKU inválido em ${row.ml_item_id}`);
    }
    if (
      row.category_id &&
      !/^MLB\d+$/.test(String(row.category_id || ''))
    ) {
      throw new Error(`category_id inválido em ${row.ml_item_id}`);
    }
    if (row.title && row.family_name) {
      throw new Error(
        `Use title ou family_name, nunca ambos, em ${row.ml_item_id}`,
      );
    }
    if (row.title && [...row.title].length > 60) {
      throw new Error(`Título excede 60 caracteres em ${row.ml_item_id}`);
    }
    if (row.family_name && [...row.family_name].length > 60) {
      throw new Error(`Family name excede 60 caracteres em ${row.ml_item_id}`);
    }
    if (row.description) {
      const bulletCount = row.description
        .split(/\r?\n/)
        .filter((line) => /^\s*-\s+\S/.test(line)).length;
      const paragraphs = row.description
        .split(/\r?\n\s*\r?\n/)
        .filter((part) => part.trim()).length;
      if (bulletCount < 3 || paragraphs < 2) {
        throw new Error(
          `Descrição sem estrutura mínima em ${row.ml_item_id}`,
        );
      }
    }
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'dry-run',
          input: inputPath,
          corrections: corrections.length,
          items: corrections.map((row) => ({
            ml_item_id: row.ml_item_id,
            sku: row.sku,
            title: Boolean(row.title),
            family_name: Boolean(row.family_name),
            description: Boolean(row.description),
            attributes: row.attributes?.length || 0,
            category_id: row.category_id || null,
          })),
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

  async function getIntegration() {
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
    return data;
  }

  async function refreshToken(integration) {
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
      'apply-hayamax-audit-corrections:refresh',
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
    if (error) {
      throw new Error(`Falha ao persistir token ML: ${error.message}`);
    }
    return refreshed.access_token;
  }

  let token = null;
  async function getToken(forceRefresh = false) {
    if (token && !forceRefresh) return token;
    const integration = await getIntegration();
    if (
      !forceRefresh &&
      integration.access_token &&
      new Date(integration.token_expires_at || 0).getTime() >
        Date.now() + 60000
    ) {
      await assertAllowedMercadoLivreToken(
        integration.access_token,
        'apply-hayamax-audit-corrections:cached',
      );
      token = integration.access_token;
      return token;
    }
    token = await refreshToken(integration);
    return token;
  }

  async function mlRequest(pathname, options = {}, attempt = 1) {
    const accessToken = await getToken(attempt > 1 && options.refreshToken);
    const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
      return mlRequest(
        pathname,
        { ...options, refreshToken: true },
        attempt + 1,
      );
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
  for (const correction of corrections) {
    const itemPath = `/items/${encodeURIComponent(
      correction.ml_item_id,
    )}?include_internal_attributes=true`;
    const before = await mlRequest(itemPath);
    const liveSku = before.ok ? getSellerSku(before.data) : '';
    if (
      !before.ok ||
      before.data?.status !== 'active' ||
      liveSku !== correction.sku
    ) {
      results.push({
        ml_item_id: correction.ml_item_id,
        sku: correction.sku,
        status: 'blocked_precondition',
        live_status: before.data?.status || null,
        live_sku: liveSku || null,
        error:
          before.data?.message ||
          before.text ||
          'Status ou SKU ao vivo divergente',
      });
      continue;
    }
    if (before.data?.catalog_listing === true) {
      results.push({
        ml_item_id: correction.ml_item_id,
        sku: correction.sku,
        status: 'blocked_catalog_managed',
        live_status: before.data.status,
        live_sku: liveSku,
        catalog_product_id: before.data.catalog_product_id || null,
        error:
          'Título, descrição e ficha técnica são controlados pelo produto de catálogo do Mercado Livre',
      });
      continue;
    }

    const steps = {};
    const isUserProduct = (before.data?.tags || []).includes(
      'user_product_listing',
    );
    if (isUserProduct && correction.title) {
      results.push({
        ml_item_id: correction.ml_item_id,
        sku: correction.sku,
        status: 'blocked_invalid_input',
        error:
          'Item User Products exige family_name; title é gerado pelo Mercado Livre',
      });
      continue;
    }
    if (!isUserProduct && correction.family_name) {
      results.push({
        ml_item_id: correction.ml_item_id,
        sku: correction.sku,
        status: 'blocked_invalid_input',
        error: 'Item legado exige title; family_name não se aplica',
      });
      continue;
    }
    const desiredEditableTitle = isUserProduct
      ? correction.family_name
      : correction.title;
    const currentEditableTitle = isUserProduct
      ? before.data?.family_name
      : before.data?.title;

    if (
      correction.category_id &&
      String(before.data?.category_id || '') !== correction.category_id
    ) {
      const categoryResult = await mlRequest(
        `/items/${encodeURIComponent(correction.ml_item_id)}`,
        {
          method: 'PUT',
          body: {
            category_id: correction.category_id,
            ...(correction.attributes?.length
              ? { attributes: correction.attributes }
              : {}),
          },
        },
      );
      steps.category = {
        ok: categoryResult.ok,
        status: categoryResult.status,
        error: categoryResult.ok
          ? null
          : categoryResult.data?.message || categoryResult.text,
        error_details: categoryResult.ok ? null : categoryResult.data,
      };
      if (!categoryResult.ok) {
        results.push({
          ml_item_id: correction.ml_item_id,
          sku: correction.sku,
          status: 'blocked_category_update',
          live_status: before.data.status,
          live_sku: liveSku,
          steps,
        });
        continue;
      }
    } else {
      steps.category = { ok: true, skipped: true };
    }

    if (
      desiredEditableTitle &&
      normalize(currentEditableTitle) !== normalize(desiredEditableTitle)
    ) {
      const titleResult = await mlRequest(
        isUserProduct
          ? `/items/${encodeURIComponent(correction.ml_item_id)}/family_name`
          : `/items/${encodeURIComponent(correction.ml_item_id)}`,
        {
          method: 'PUT',
          body: isUserProduct
            ? { family_name: desiredEditableTitle }
            : { title: desiredEditableTitle },
        },
      );
      steps.title = {
        ok: titleResult.ok,
        status: titleResult.status,
        field: isUserProduct ? 'family_name' : 'title',
        error: titleResult.ok
          ? null
          : titleResult.data?.message || titleResult.text,
      };
    } else {
      steps.title = { ok: true, skipped: true };
    }

    if (Array.isArray(correction.attributes) && correction.attributes.length) {
      const attributeResult = await mlRequest(
        `/items/${encodeURIComponent(correction.ml_item_id)}`,
        { method: 'PUT', body: { attributes: correction.attributes } },
      );
      steps.attributes = {
        ok: attributeResult.ok,
        status: attributeResult.status,
        error: attributeResult.ok
          ? null
          : attributeResult.data?.message || attributeResult.text,
        error_details: attributeResult.ok ? null : attributeResult.data,
      };
    } else {
      steps.attributes = { ok: true, skipped: true };
    }

    if (correction.description) {
      const descriptionResult = await mlRequest(
        `/items/${encodeURIComponent(
          correction.ml_item_id,
        )}/description?api_version=2`,
        { method: 'PUT', body: { plain_text: correction.description } },
      );
      steps.description = {
        ok: descriptionResult.ok,
        status: descriptionResult.status,
        error: descriptionResult.ok
          ? null
          : descriptionResult.data?.message || descriptionResult.text,
        error_details: descriptionResult.ok ? null : descriptionResult.data,
      };
    } else {
      steps.description = { ok: true, skipped: true };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    let [after, descriptionAfter] = await Promise.all([
      mlRequest(itemPath),
      mlRequest(
        `/items/${encodeURIComponent(correction.ml_item_id)}/description`,
      ),
    ]);
    for (let verifyAttempt = 1; verifyAttempt < 3; verifyAttempt += 1) {
      const titleReady =
        !desiredEditableTitle ||
        normalize(
          isUserProduct ? after.data?.family_name : after.data?.title,
        ) === normalize(desiredEditableTitle);
      const descriptionReady =
        !correction.description ||
        String(descriptionAfter.data?.plain_text || '').trim() ===
          correction.description.trim();
      const attributesReady =
        !correction.attributes?.length ||
        correction.attributes.every((attribute) =>
          attributeMatches(after.data, attribute),
        );
      if (titleReady && descriptionReady && attributesReady) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      [after, descriptionAfter] = await Promise.all([
        mlRequest(itemPath),
        mlRequest(
          `/items/${encodeURIComponent(correction.ml_item_id)}/description`,
        ),
      ]);
    }
    const titleVerified =
      !desiredEditableTitle ||
      normalize(isUserProduct ? after.data?.family_name : after.data?.title) ===
        normalize(desiredEditableTitle);
    const descriptionVerified =
      !correction.description ||
      String(descriptionAfter.data?.plain_text || '').trim() ===
        correction.description.trim();
    const attributesVerified =
      !correction.attributes?.length ||
      correction.attributes.every((attribute) =>
        attributeMatches(after.data, attribute),
      );
    const skuVerified =
      after.ok && getSellerSku(after.data) === correction.sku;
    const categoryVerified =
      !correction.category_id ||
      String(after.data?.category_id || '') === correction.category_id;
    const verified =
      titleVerified &&
      descriptionVerified &&
      attributesVerified &&
      skuVerified &&
      categoryVerified;
    const hasStepWarning = Object.values(steps).some((step) => !step.ok);

    if (titleVerified && desiredEditableTitle) {
      const { error } = await supabase
        .from('anuncios_ml')
        .update({ titulo: String(after.data?.title || desiredEditableTitle) })
        .eq('ml_item_id', correction.ml_item_id);
      steps.database_title = {
        ok: !error,
        error: error?.message || null,
      };
    }

    results.push({
      ml_item_id: correction.ml_item_id,
      sku: correction.sku,
      status: verified
        ? hasStepWarning
          ? 'success_verified_with_api_warning'
          : 'success'
        : 'partial_or_error',
      title_before: before.data?.title || null,
      title_after: after.data?.title || null,
      family_name_before: before.data?.family_name || null,
      family_name_after: after.data?.family_name || null,
      sku_after: after.ok ? getSellerSku(after.data) : null,
      category_after: after.data?.category_id || null,
      category_verified: categoryVerified,
      description_verified: descriptionVerified,
      attributes_verified: attributesVerified,
      attribute_mismatches: attributesVerified
        ? []
        : getAttributeMismatches(after.data, correction.attributes),
      steps,
    });
  }

  const outputPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, '.json')}-resultado-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total: results.length,
        counts: results.reduce((counts, row) => {
          counts[row.status] = (counts[row.status] || 0) + 1;
          return counts;
        }, {}),
        results,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify(
      {
        ok: results.every(
          (row) =>
            row.status.startsWith('success') ||
            row.status === 'blocked_catalog_managed',
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
