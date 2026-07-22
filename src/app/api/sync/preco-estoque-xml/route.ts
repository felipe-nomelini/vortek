import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { syncPreferredProductSnapshot } from '@/lib/produto-fornecedor';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';
import { getSyncRuntimeJson } from '@/lib/sync/runtime-config';
import { enfileirarSyncMlEstoqueInterno } from '@/lib/estoque-interno';
import { enqueueKitStockUpdates, recalculateProductKits } from '@/lib/produto-kits';
import { enqueueAutomaticPricesForCostChanges } from '@/lib/ml/automatic-pricing';

export const maxDuration = 300;

const CONFIG_KEY = 'dslite_catalog_xml_urls';
const OFFER_PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 300;
const XML_FETCH_MAX_ATTEMPTS = 2;
const XML_FETCH_RETRY_DELAYS_MS = [1_000];
const XML_FETCH_CONCURRENCY = 2;

type XmlFeedConfig = Record<string, string>;
type XmlCatalogItem = { produtoId: string; custo: number; estoque: number };

function normalizeNumber(value: string): number {
  const raw = String(value || '').trim();
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  const normalized = lastComma >= 0 && lastDot >= 0
    ? (lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''))
    : raw.replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function extractXmlValue(block: string, field: string): string {
  const match = new RegExp(`<${field}(?:\\s[^>]*)?>([\\s\\S]*?)</${field}>`, 'i').exec(block);
  if (!match) return '';
  return String(match[1] || '')
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/i, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseXmlCatalog(xml: string): XmlCatalogItem[] {
  const products: XmlCatalogItem[] = [];
  const productPattern = /<product(?:\s[^>]*)?>([\s\S]*?)<\/product>/gi;
  let match: RegExpExecArray | null;

  while ((match = productPattern.exec(xml))) {
    const block = match[1];
    const produtoId = extractXmlValue(block, 'prod_id');
    if (!produtoId) continue;
    products.push({
      produtoId,
      custo: normalizeNumber(extractXmlValue(block, 'price')),
      estoque: Math.trunc(normalizeNumber(extractXmlValue(block, 'stock'))),
    });
  }

  if (products.length === 0) throw new Error('XML DSLite sem produtos válidos');
  return products;
}

function validateFeedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'app.dslite.com.br') return null;
    if (!url.pathname.includes('/getXMLCrossdocking/')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableXmlStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function downloadFeed(url: string): Promise<XmlCatalogItem[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= XML_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        const error = new Error(`DSLite XML respondeu HTTP ${response.status}`);
        if (!isRetryableXmlStatus(response.status)) {
          (error as Error & { retryable?: boolean }).retryable = false;
          throw error;
        }
        if (attempt === XML_FETCH_MAX_ATTEMPTS) throw error;
        lastError = error;
      } else {
        const size = Number(response.headers.get('content-length') || '0');
        if (size > 80 * 1024 * 1024) throw new Error('XML DSLite excede limite de 80 MB');
        return parseXmlCatalog(await response.text());
      }
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error('Falha ao baixar XML DSLite');
      if (error?.retryable === false || attempt === XML_FETCH_MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }

    await sleep(XML_FETCH_RETRY_DELAYS_MS[attempt - 1] || 3_000);
  }

  throw new Error(`Falha ao baixar XML DSLite após ${XML_FETCH_MAX_ATTEMPTS} tentativas: ${lastError?.message || 'sem detalhe'}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function loadSupplierOffers(client: ReturnType<typeof createServiceClient>, supplierId: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += OFFER_PAGE_SIZE) {
    const { data, error } = await client
      .from('produto_fornecedor_ofertas')
      .select('id,produto_id,dslite_produto_id,sku_oferta,nome,custo,estoque,product:produtos!produto_fornecedor_ofertas_produto_id_fkey(ativo)')
      .eq('dslite_fornecedor_id', supplierId)
      .eq('ativo', true)
      .order('id', { ascending: true })
      .range(from, from + OFFER_PAGE_SIZE - 1);
    if (error) throw new Error(`Falha ao carregar ofertas do fornecedor ${supplierId}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < OFFER_PAGE_SIZE) return rows;
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const errors: Array<{ supplierId?: string; message: string }> = [];
  let lockOwnerToken = '';

  try {
    const lock = await acquireDomainLock({
      domain: 'produtos:dslite_preco',
      ownerTask: 'sync_dslite_xml_preco_estoque',
      ttlSeconds: 15 * 60,
      metadata: { source: 'api/sync/preco-estoque-xml' },
    });
    lockOwnerToken = lock.ownerToken;
    if (!lock.acquired) {
      const message = 'Domínio de preço/estoque já está em execução';
      return NextResponse.json({
        success: false,
        code: 'domain_lock_conflict',
        error: message,
        errors: [{ code: 'domain_lock_conflict', message }],
      }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const selectedSupplierIds = Array.isArray(body?.fornecedorIds)
      ? new Set(body.fornecedorIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))
      : null;
    const configuredFeeds = await getSyncRuntimeJson<XmlFeedConfig>(CONFIG_KEY, {});
    const client = createServiceClient();
    const { data: activeSuppliers, error: activeSuppliersError } = await client
      .from('fornecedores')
      .select('dslite_id')
      .eq('ativo', true)
      .not('dslite_id', 'is', null);
    if (activeSuppliersError) throw new Error(activeSuppliersError.message);

    const supplierIds = (activeSuppliers || [])
      .map((supplier) => String(supplier.dslite_id || '').trim())
      .filter((supplierId) => Boolean(supplierId && configuredFeeds[supplierId]))
      .filter((supplierId) => !selectedSupplierIds || selectedSupplierIds.has(supplierId));

    let feedsDownloaded = 0;
    let offersChanged = 0;
    let productsRecalculated = 0;
    let mlEnqueued = 0;
    let mlManualBlocked = 0;
    let kitsUpdated = 0;
    let mlPriceProductsUpdated = 0;
    let mlPriceOutboxEnqueued = 0;

    for (const supplierBatch of chunk(supplierIds, XML_FETCH_CONCURRENCY)) {
      const downloadedFeeds = new Map<string, XmlCatalogItem[]>();
      const feedErrors = new Map<string, Error>();
      await Promise.all(supplierBatch.map(async (supplierId) => {
        try {
          const feedUrl = validateFeedUrl(String(configuredFeeds[supplierId] || ''));
          if (!feedUrl) throw new Error('URL XML DSLite inválida ou não permitida');
          downloadedFeeds.set(supplierId, await downloadFeed(feedUrl));
        } catch (error: any) {
          feedErrors.set(supplierId, error instanceof Error ? error : new Error('Falha ao baixar XML DSLite'));
        }
      }));

      for (const supplierId of supplierBatch) {
        try {
        const feedError = feedErrors.get(supplierId);
        if (feedError) throw feedError;
        const xmlProducts = downloadedFeeds.get(supplierId);
        if (!xmlProducts) throw new Error('XML DSLite não foi carregado');
        const localOffers = await loadSupplierOffers(client, supplierId);
        feedsDownloaded += 1;
        const xmlByProductId = new Map(xmlProducts.map((item) => [item.produtoId, item]));
        const changedOffers = localOffers.flatMap((offer) => {
          if (offer?.product?.ativo === false) return [];
          const xml = xmlByProductId.get(String(offer.dslite_produto_id || '').trim());
          if (!xml) return [];
          const oldCost = Number(offer.custo || 0);
          const oldStock = Number(offer.estoque || 0);
          if (Math.abs(oldCost - xml.custo) < 0.0001 && oldStock === xml.estoque) return [];
          return [{
            id: String(offer.id),
            produto_id: String(offer.produto_id),
            dslite_fornecedor_id: supplierId,
            dslite_produto_id: xml.produtoId,
            sku_oferta: String(offer.sku_oferta || ''),
            nome: String(offer.nome || '').trim() || `Produto ${xml.produtoId}`,
            custo: xml.custo,
            estoque: xml.estoque,
            last_sync_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }];
        });
        offersChanged += changedOffers.length;

        for (const rows of chunk(changedOffers, UPSERT_CHUNK_SIZE)) {
          const { error } = await client
            .from('produto_fornecedor_ofertas')
            .upsert(rows as any, { onConflict: 'id' });
          if (error) throw new Error(`Falha ao atualizar ofertas: ${error.message}`);

          const productIds = Array.from(new Set(rows.map((row) => row.produto_id)));
          const snapshots = await syncPreferredProductSnapshot(client, productIds);
          productsRecalculated += snapshots.length;
          const automaticPricing = await enqueueAutomaticPricesForCostChanges(client, snapshots);
          mlPriceProductsUpdated += automaticPricing.productsUpdated;
          mlPriceOutboxEnqueued += automaticPricing.outboxEnqueued;
          for (const priceError of automaticPricing.errors) {
            errors.push({ supplierId, message: `Preço automático ${priceError.productId}: ${priceError.message}` });
          }
          const kits = await recalculateProductKits(client, productIds);
          kitsUpdated += kits.filter((kit) => kit.oldStock !== kit.newStock || kit.oldCost !== kit.newCost).length;
          await enqueueKitStockUpdates(client, kits);

          for (const snapshot of snapshots) {
            if (!snapshot.changed || String(snapshot.previous.ml_status || '') === 'sem_anuncio') continue;
            const result = await enfileirarSyncMlEstoqueInterno(String(snapshot.productId));
            mlEnqueued += result.enfileirados;
            mlManualBlocked += result.bloqueadosManualmente;
          }
        }
        } catch (error: any) {
          errors.push({ supplierId, message: error?.message || 'Falha ao processar XML DSLite' });
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      source: 'dslite_xml',
      feeds_downloaded: feedsDownloaded,
      offers_changed: offersChanged,
      products_recalculated: productsRecalculated,
      kits_updated: kitsUpdated,
      ml_enqueued: mlEnqueued,
      ml_manual_blocked: mlManualBlocked,
      ml_price_products_updated: mlPriceProductsUpdated,
      ml_price_outbox_enqueued: mlPriceOutboxEnqueued,
      errors,
      duration_ms: Date.now() - startedAt,
    }, { status: errors.length === 0 ? 200 : 207 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Falha inesperada no sync XML DSLite' }, { status: 500 });
  } finally {
    if (lockOwnerToken) await releaseDomainLock({ domain: 'produtos:dslite_preco', ownerToken: lockOwnerToken }).catch(() => null);
  }
}
