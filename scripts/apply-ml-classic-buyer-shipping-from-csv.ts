import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const SOURCE_FILE =
  process.env.ML_CLASSIC_CSV ||
  '/home/felipe/Downloads/rebaixamento_78_90_vortek.csv';
const APPLY = process.env.ML_CLASSIC_APPLY === '1';
const TARGET_PRICE = 78.9;
const EXPECTED_ACCOUNT_ID = '3294514937';
const RESULT_DIR = path.resolve(
  process.env.ML_CLASSIC_RESULT_DIR ||
    `reports/ml-classic-buyer-shipping/${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

type CsvRow = {
  sku: string;
  targetPrice: number;
};

type ProductRow = {
  id: string;
  sku: string;
  ml_item_id: string | null;
};

let fetchMLResult: any;
let updatePrice: any;
let supabase: any;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function roundMoney(value: unknown): number {
  return Math.round(Number(value) * 100) / 100;
}

function hasMandatoryFreeShipping(item: any): boolean {
  return (
    (item?.shipping?.tags || []).includes('mandatory_free_shipping') ||
    (item?.tags || []).includes('mandatory_free_shipping')
  );
}

function localStatus(status: unknown): 'ativo' | 'pausado' {
  return String(status) === 'active' ? 'ativo' : 'pausado';
}

function standardPrice(pricesBody: any): number {
  const prices = Array.isArray(pricesBody?.prices) ? pricesBody.prices : [];
  const standard =
    prices.find(
      (price: any) =>
        price?.type === 'standard' &&
        !(price?.conditions?.context_restrictions || []).length,
    ) || prices.find((price: any) => price?.type === 'standard');
  return roundMoney(standard?.amount);
}

function quantityPricingOk(pricesBody: any): boolean {
  const expected = new Map([
    [3, 76.53],
    [5, 75.74],
    [10, 74.96],
  ]);
  const prices = Array.isArray(pricesBody?.prices) ? pricesBody.prices : [];
  const tiers = prices.filter((price: any) =>
    (price?.conditions?.context_restrictions || []).includes(
      'user_type_business',
    ),
  );
  return [...expected].every(([unit, amount]) =>
    tiers.some(
      (tier: any) =>
        Number(tier?.conditions?.min_purchase_unit) === unit &&
        Math.abs(roundMoney(tier?.amount) - amount) < 0.009,
    ),
  );
}

function writeSummary(summary: Record<string, any>) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULT_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
}

const rows: CsvRow[] = parseCsv(fs.readFileSync(SOURCE_FILE, 'utf8'))
  .slice(1)
  .filter((row) => /^VTK\d+$/.test(String(row[0] || '').trim()))
  .map((row) => ({
    sku: String(row[0]).trim(),
    targetPrice: roundMoney(row[5]),
  }));

const uniqueSkus = new Set(rows.map((row) => row.sku));
if (rows.length !== 223 || uniqueSkus.size !== 223) {
  throw new Error(
    `CSV divergente: esperado 223 SKUs únicos, recebido ${rows.length}/${uniqueSkus.size}`,
  );
}
if (rows.some((row) => row.targetPrice !== TARGET_PRICE)) {
  throw new Error('CSV divergente: todos os preços novos devem ser R$ 78,90');
}
if (!APPLY) {
  throw new Error('Execução bloqueada: defina ML_CLASSIC_APPLY=1');
}

async function getMl(apiPath: string) {
  const result = await fetchMLResult(apiPath, { method: 'GET' });
  if (!result.ok || !result.data) {
    throw new Error(
      `${apiPath}: ${result.error?.message || `HTTP ${result.status}`}`,
    );
  }
  return result.data;
}

async function getItem(itemId: string) {
  return getMl(`/items/${encodeURIComponent(itemId)}`);
}

async function getPrices(itemId: string) {
  const result = await fetchMLResult(
    `/items/${encodeURIComponent(itemId)}/prices`,
    { method: 'GET', headers: { 'show-all-prices': 'true' } },
  );
  if (!result.ok || !result.data) {
    throw new Error(
      `${itemId}: falha ao consultar preços: ${result.error?.message || result.status}`,
    );
  }
  return result.data;
}

async function waitUntilShippingOptional(itemId: string) {
  let item = await getItem(itemId);
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    if (!hasMandatoryFreeShipping(item)) return item;
    if (attempt < 10) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      item = await getItem(itemId);
    }
  }
  throw new Error(`${itemId}: mandatory_free_shipping não foi removido`);
}

async function calculateClassicFee(item: any): Promise<number> {
  const result = await getMl(
    `/sites/MLB/listing_prices?price=${TARGET_PRICE}` +
      `&category_id=${encodeURIComponent(String(item.category_id))}` +
      '&listing_type_id=gold_special',
  );
  const percentage =
    result?.sale_fee_details?.percentage_fee ??
    result?.sale_fee_details?.meli_percentage_fee;
  if (!Number.isFinite(Number(percentage))) {
    throw new Error(`${item.id}: taxa Classic não retornada pelo ML`);
  }
  return Number(percentage) / 100;
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  ({ POST: updatePrice } = await import(
    '../src/app/api/ml/anuncio/atualizar-preco/route'
  ));
  ({ fetchMLResult } = await import('../src/services/integration'));
  supabase = createClient(
    process.env.SUPABASE_SERVICE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

const [{ data: products, error: productsError }, { data: ads, error: adsError }] =
  await Promise.all([
    supabase
      .from('produtos')
      .select('id,sku,ml_item_id')
      .in('sku', [...uniqueSkus]),
    supabase
      .from('anuncios_ml')
      .select('produto_id,sku,ml_item_id')
      .in('sku', [...uniqueSkus]),
  ]);

if (productsError || adsError) {
  throw new Error(productsError?.message || adsError?.message);
}
if (products?.length !== 223 || ads?.length !== 223) {
  throw new Error(
    `Vínculos locais divergentes: produtos=${products?.length}, anúncios=${ads?.length}`,
  );
}

const productBySku = new Map(
  (products as ProductRow[]).map((product) => [product.sku, product]),
);
const adsBySku = new Map<string, any[]>();
for (const ad of ads || []) {
  const list = adsBySku.get(ad.sku) || [];
  list.push(ad);
  adsBySku.set(ad.sku, list);
}

const account = await getMl('/users/me');
if (String(account.id) !== EXPECTED_ACCOUNT_ID) {
  throw new Error(
    `Conta ML divergente: ${account.id}/${account.nickname || ''}`,
  );
}

const automatedItemIds = new Set<string>();
let offset = 0;
let total = 1;
while (offset < total) {
  const page = await getMl(
    `/pricing-automation/users/${account.id}/items?offset=${offset}&limit=100`,
  );
  for (const itemId of page.items || []) {
    automatedItemIds.add(String(itemId));
  }
  total = Number(page.paging?.total || 0);
  offset += 100;
}

console.log(`[resultado] ${RESULT_DIR}`);
console.log('[preflight] validando 223 anúncios');
for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  const product = productBySku.get(row.sku);
  const linkedAds = adsBySku.get(row.sku) || [];
  if (!product?.ml_item_id || linkedAds.length !== 1) {
    throw new Error(`${row.sku}: vínculo local inválido`);
  }
  const item = await getItem(product.ml_item_id);
  if (
    String(item.seller_id) !== EXPECTED_ACCOUNT_ID ||
    !['active', 'paused'].includes(String(item.status)) ||
    !['gold_pro', 'gold_special'].includes(String(item.listing_type_id)) ||
    String(item.shipping?.mode) !== 'me2' ||
    String(item.shipping?.logistic_type) !== 'xd_drop_off' ||
    automatedItemIds.has(String(item.id)) ||
    (item.tags || []).includes('dynamic_standard_price')
  ) {
    throw new Error(`${row.sku}: pré-voo ML inválido`);
  }
  if ((index + 1) % 25 === 0 || index + 1 === rows.length) {
    console.log(`[preflight] ${index + 1}/${rows.length}`);
  }
}

const summary: Record<string, any> = {
  startedAt: new Date().toISOString(),
  sourceFile: SOURCE_FILE,
  resultDir: RESULT_DIR,
  account: { id: account.id, nickname: account.nickname },
  selected: rows.length,
  totals: {
    priceUpdated: 0,
    listingTypeUpdated: 0,
    shippingUpdated: 0,
    alreadyFinal: 0,
    verified: 0,
    failed: 0,
  },
  rows: [],
};
writeSummary(summary);

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index];
  const product = productBySku.get(row.sku)!;
  const itemId = String(product.ml_item_id);
  const resultRow: Record<string, any> = {
    sequence: index + 1,
    sku: row.sku,
    itemId,
    operations: [],
  };

  try {
    let item = await getItem(itemId);
    let prices = await getPrices(itemId);
    const wasAlreadyFinal =
      standardPrice(prices) === TARGET_PRICE &&
      item.listing_type_id === 'gold_special' &&
      item.shipping?.free_shipping === false &&
      !hasMandatoryFreeShipping(item);

    if (standardPrice(prices) !== TARGET_PRICE) {
      const response = await updatePrice(
        new Request('http://local/api/ml/anuncio/atualizar-preco', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            produtoId: product.id,
            targetPrice: TARGET_PRICE,
            source: 'default',
          }),
        }),
      );
      const body = await response.json();
      if (
        !response.ok ||
        !body.success ||
        !body.price_updated ||
        !body.quantity_pricing_updated
      ) {
        throw new Error(
          `preço falhou HTTP ${response.status}: ${body.error || body.message || JSON.stringify(body)}`,
        );
      }
      summary.totals.priceUpdated += 1;
      resultRow.operations.push('price');
    }

    item = await waitUntilShippingOptional(itemId);

    if (item.listing_type_id === 'gold_pro') {
      const listingTypeResult = await fetchMLResult(
        `/items/${encodeURIComponent(itemId)}/listing_type`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'gold_special' }),
        },
      );
      if (!listingTypeResult.ok) {
        throw new Error(
          `listing_type falhou: ${listingTypeResult.error?.message || listingTypeResult.status}`,
        );
      }
      summary.totals.listingTypeUpdated += 1;
      resultRow.operations.push('listing_type');
      item = await getItem(itemId);
    }

    if (hasMandatoryFreeShipping(item)) {
      throw new Error('mandatory_free_shipping presente após rebaixamento');
    }
    if (item.shipping?.free_shipping !== false) {
      const shippingResult = await fetchMLResult(
        `/items/${encodeURIComponent(itemId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipping: { free_shipping: false } }),
        },
      );
      if (!shippingResult.ok) {
        throw new Error(
          `frete falhou: ${shippingResult.error?.message || shippingResult.status}`,
        );
      }
      summary.totals.shippingUpdated += 1;
      resultRow.operations.push('shipping');
      item = await getItem(itemId);
    }

    prices = await getPrices(itemId);
    const classicFee = await calculateClassicFee(item);
    if (
      standardPrice(prices) !== TARGET_PRICE ||
      !quantityPricingOk(prices) ||
      item.listing_type_id !== 'gold_special' ||
      item.shipping?.free_shipping !== false ||
      hasMandatoryFreeShipping(item) ||
      !['active', 'paused'].includes(String(item.status))
    ) {
      throw new Error('verificação final do Mercado Livre divergente');
    }

    const [{ error: productUpdateError }, { error: adUpdateError }] =
      await Promise.all([
        supabase
          .from('produtos')
          .update({
            custom_price: TARGET_PRICE,
            ml_status: localStatus(item.status),
            ml_shipping: 0,
            ml_shipping_warning: null,
            ml_fee: classicFee,
          })
          .eq('id', product.id)
          .eq('ml_item_id', itemId),
        supabase
          .from('anuncios_ml')
          .update({
            preco_ml: TARGET_PRICE,
            status: localStatus(item.status),
            tipo: 'Classic',
            updated_at: new Date().toISOString(),
          })
          .eq('produto_id', product.id)
          .eq('ml_item_id', itemId),
      ]);
    if (productUpdateError || adUpdateError) {
      throw new Error(
        `sincronização local falhou: ${productUpdateError?.message || adUpdateError?.message}`,
      );
    }

    if (wasAlreadyFinal) summary.totals.alreadyFinal += 1;
    summary.totals.verified += 1;
    resultRow.status = 'verified';
    resultRow.final = {
      price: standardPrice(prices),
      listingType: item.listing_type_id,
      freeShipping: item.shipping.free_shipping,
      status: item.status,
      mlFee: classicFee,
    };
    summary.rows.push(resultRow);
    writeSummary(summary);
    console.log(
      `[verified] ${index + 1}/223 ${row.sku} ${itemId} ops=${resultRow.operations.join(',') || 'none'}`,
    );
  } catch (error: any) {
    summary.totals.failed += 1;
    resultRow.status = 'failed';
    resultRow.error = error?.message || String(error);
    summary.rows.push(resultRow);
    writeSummary(summary);
    throw new Error(`${row.sku}: ${resultRow.error}`);
  }
}

summary.finishedAt = new Date().toISOString();
writeSummary(summary);
console.log(JSON.stringify(summary.totals, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
