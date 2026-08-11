const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const REPORT_DIR = path.resolve('reports/ml-profitable-shelf-2-2026-08-10');
const AUDIT_PATH = path.join(REPORT_DIR, 'final-log.json');
const OUTPUT_PATH = path.join(REPORT_DIR, 'image-repair-log.json');
const BUCKET = 'product-images';
const PUBLIC_STORAGE_BASE = 'https://supabase.vortek.shop/storage/v1/object/public/product-images';

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function token() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) throw new Error(error?.message || 'Token ML ausente');
  return data.access_token;
}

async function mlRequest(accessToken, pathname, options = {}) {
  const response = await fetch(`https://api.mercadolibre.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function stablePictures(product) {
  if (!Array.isArray(product.imagens) || product.imagens.length === 0) {
    throw new Error(`${product.sku}: sem imagem no ERP`);
  }
  const urls = [];
  for (let index = 0; index < product.imagens.length; index += 1) {
    const source = String(product.imagens[index]);
    const response = await fetch(source, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const contentType = String(response.headers.get('content-type') || '');
    if (!response.ok || !contentType.startsWith('image/')) {
      throw new Error(`${product.sku}: imagem ${index + 1} inválida, HTTP ${response.status}`);
    }
    const original = Buffer.from(await response.arrayBuffer());
    const normalized = await sharp(original)
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize(1200, 1200, { fit: 'contain', background: '#ffffff' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer();
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    const objectPath = `catalog/profitable-shelf-2/${product.sku}/${index + 1}-${hash}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(objectPath, normalized, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    });
    if (error) throw new Error(`${product.sku}: falha no Storage: ${error.message}`);
    const publicUrl = `${PUBLIC_STORAGE_BASE}/${objectPath}`;
    const check = await fetch(publicUrl, { signal: AbortSignal.timeout(30000) });
    const checkType = String(check.headers.get('content-type') || '');
    const checkImage = Buffer.from(await check.arrayBuffer());
    const metadata = await sharp(checkImage).metadata();
    if (
      !check.ok || !checkType.startsWith('image/') ||
      Number(metadata.width) !== 1200 || Number(metadata.height) !== 1200
    ) {
      throw new Error(`${product.sku}: cópia pública da imagem não foi validada`);
    }
    urls.push(publicUrl);
  }
  return urls;
}

async function main() {
  const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
  const targets = (audit.listings || []).filter(
    (row) => row.sub_status?.includes('picture_download_pending') && row.status !== 'active',
  );
  const accessToken = await token();
  const results = [];

  for (const target of targets) {
    try {
      const { data: product, error } = await supabase
        .from('produtos')
        .select('id,sku,imagens')
        .eq('id', target.produto_id)
        .single();
      if (error || !product) throw new Error(error?.message || 'Produto ausente');
      const pictures = await stablePictures(product);
      await supabase.from('produtos').update({ imagens: pictures }).eq('id', product.id);
      const updated = await mlRequest(accessToken, `/items/${encodeURIComponent(target.mlb)}`, {
        method: 'PUT',
        body: JSON.stringify({ pictures: pictures.map((source) => ({ source })) }),
      });
      results.push({
        sku: target.sku,
        mlb: target.mlb,
        success: true,
        pictures: pictures.length,
        status_after_put: updated.status,
        sub_status_after_put: updated.sub_status || [],
      });
      console.log(`[ok] ${target.sku} ${target.mlb} pictures=${pictures.length}`);
    } catch (error) {
      results.push({ sku: target.sku, mlb: target.mlb, success: false, error: error.message });
      console.log(`[fail] ${target.sku} ${error.message}`);
    }
  }

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    let pending = 0;
    for (const result of results.filter((row) => row.success)) {
      const item = await mlRequest(accessToken, `/items/${encodeURIComponent(result.mlb)}`);
      result.final_status = item.status;
      result.final_sub_status = item.sub_status || [];
      result.final_pictures = Array.isArray(item.pictures) ? item.pictures.length : 0;
      if (item.status !== 'active' && result.final_sub_status.includes('picture_download_pending')) {
        pending += 1;
      }
    }
    console.log(`[poll] attempt=${attempt} pending=${pending}`);
    if (pending === 0 || attempt === 12) break;
    await sleep(20000);
  }

  for (const result of results.filter((row) => row.success)) {
    const localStatus = result.final_status === 'active' ? 'ativo' : 'pausado';
    await supabase.from('produtos').update({ ml_status: localStatus }).eq('sku', result.sku);
    await supabase.from('anuncios_ml').update({ status: localStatus }).eq('ml_item_id', result.mlb);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, total: results.length, success: results.filter((row) => row.success).length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
