/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const SKU = 'VTK000427';
const ITEM_ID = 'MLB4988488561';
const INPUT = path.resolve('reports/ml-repair-2026-08-03/images/VTK000427-kit-12.png');
const BUCKET = 'product-images';
const OBJECT_PATH = 'catalog/hayamax/VTK000427/01-kit-12.png';
const PUBLIC_STORAGE_BASE = 'https://supabase.vortek.shop/storage/v1/object/public/product-images';

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mlRequest(token, pathname, method = 'GET', body) {
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function uploadPicture(token, image) {
  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/png' }), 'VTK000427-kit-12.png');
  const response = await fetch('https://api.mercadolibre.com/pictures/items/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function main() {
  if (!fs.existsSync(INPUT)) throw new Error(`Imagem não encontrada: ${INPUT}`);
  const image = fs.readFileSync(INPUT);
  const metadata = await sharp(image).metadata();
  if ((metadata.width || 0) < 1200 || (metadata.height || 0) < 1200) {
    throw new Error(`Imagem abaixo de 1200 px: ${metadata.width}x${metadata.height}`);
  }

  const [{ data: product, error: productError }, { data: integration, error: integrationError }] = await Promise.all([
    supabase.from('produtos').select('id,sku,ml_item_id,imagens').eq('sku', SKU).single(),
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
  ]);
  if (productError || !product) throw new Error(productError?.message || 'Produto não encontrado');
  if (product.ml_item_id !== ITEM_ID) throw new Error(`Vínculo inesperado: ${product.ml_item_id || '(vazio)'}`);
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'Token ML indisponível');
  await assertAllowedMercadoLivreToken(integration.access_token, 'repair-ml-kit-image-2026-08-03');

  const before = await mlRequest(integration.access_token, `/items/${ITEM_ID}?include_internal_attributes=true`);
  if (!before.ok) throw new Error(`Anúncio não encontrado: HTTP ${before.status}`);
  if (String((before.data.attributes || []).find((row) => row.id === 'SELLER_SKU')?.value_name || '') !== SKU) {
    throw new Error('SKU ao vivo divergente');
  }

  if (!APPLY) {
    console.log(JSON.stringify({ apply: false, sku: SKU, itemId: ITEM_ID, dimensions: metadata, statusBefore: before.data.status }, null, 2));
    return;
  }

  const upload = await supabase.storage.from(BUCKET).upload(OBJECT_PATH, image, {
    contentType: 'image/png',
    cacheControl: '3600',
    upsert: true,
  });
  if (upload.error) throw new Error(`Upload falhou: ${upload.error.message}`);
  const publicUrl = `${PUBLIC_STORAGE_BASE}/${OBJECT_PATH}`;

  const uploadedPicture = await uploadPicture(integration.access_token, image);
  if (!uploadedPicture.ok || !uploadedPicture.data?.id) {
    throw new Error(`Upload direto ao Mercado Livre falhou: HTTP ${uploadedPicture.status}`);
  }
  const update = await mlRequest(integration.access_token, `/items/${ITEM_ID}`, 'PUT', {
    pictures: [{ id: uploadedPicture.data.id }],
  });
  if (!update.ok) {
    throw new Error(`Mercado Livre recusou imagem: HTTP ${update.status} ${update.data?.message || ''}`.trim());
  }

  const { error: productUpdateError } = await supabase
    .from('produtos')
    .update({ imagens: [publicUrl] })
    .eq('id', product.id);
  if (productUpdateError) throw new Error(`Imagem enviada ao ML, mas ERP não atualizou: ${productUpdateError.message}`);

  let after = null;
  let moderation = null;
  let pictureErrors = [];
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (attempt > 1) await sleep(5000);
    after = await mlRequest(integration.access_token, `/items/${ITEM_ID}?include_internal_attributes=true`);
    moderation = await mlRequest(integration.access_token, `/moderations/last_moderation/${ITEM_ID}-ITM`);
    pictureErrors = [];
    for (const picture of after.data?.pictures || []) {
      const result = await mlRequest(integration.access_token, `/pictures/${encodeURIComponent(picture.id)}/errors`);
      const errors = Array.isArray(result.data) ? result.data : result.data?.errors || [];
      if (result.status !== 404 && errors.length > 0) pictureErrors.push({ pictureId: picture.id, errors });
    }
    const subStatus = Array.isArray(after.data?.sub_status) ? after.data.sub_status : [];
    if (!subStatus.includes('picture_download_pending') && pictureErrors.length === 0) break;
  }

  if (!after?.ok) throw new Error(`Falha na validação final: HTTP ${after?.status}`);
  if (pictureErrors.length > 0) throw new Error('Nova imagem ainda foi reprovada pelo diagnóstico do ML');

  const thumbnail = after.data?.thumbnail || after.data?.pictures?.[0]?.secure_url || publicUrl;
  const { error: listingUpdateError } = await supabase
    .from('anuncios_ml')
    .update({ thumbnail, updated_at: new Date().toISOString() })
    .eq('ml_item_id', ITEM_ID);
  if (listingUpdateError) throw new Error(`Imagem corrigida, mas anúncio ERP não atualizou: ${listingUpdateError.message}`);

  const report = {
    apply: true,
    sku: SKU,
    itemId: ITEM_ID,
    publicUrl,
    statusBefore: before.data.status,
    statusAfter: after.data.status,
    subStatusAfter: after.data.sub_status || [],
    pictureIds: (after.data.pictures || []).map((picture) => picture.id),
    pictureErrors,
    moderation: moderation?.data || null,
  };
  fs.writeFileSync(
    path.resolve('reports/ml-repair-2026-08-03/repaired-kit-image.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
