import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { fetchML, fetchMLResult, getMLAuthDiagnostics } from '@/services/integration';
import { acquireDomainLock, releaseDomainLock } from '@/lib/sync/domain-lock';

export const maxDuration = 300;

const CONCURRENCY = 3;

function extractSku(item: any): string | null {
  if (item?.seller_sku) return String(item.seller_sku).trim().toUpperCase();
  if (item?.seller_custom_field) return String(item.seller_custom_field).trim().toUpperCase();
  const skuAttr = Array.isArray(item?.attributes)
    ? item.attributes.find((a: any) => a.id === 'SELLER_SKU' && a.value_name)
    : null;
  if (skuAttr?.value_name) return String(skuAttr.value_name).trim().toUpperCase();
  return null;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  });
  await Promise.all(runners);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get('x-api-key');
  if (apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: 'Chave de API inválida' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const offset = Number(searchParams.get('offset') || 0);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || 100)));

  const errors: Array<{ code: string; message: string; context?: Record<string, unknown> }> = [];
  let lockOwnerToken = '';
  let lockAcquired = false;
  const domain = 'anuncios:ml_pull';

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: 'sync_ml_listings_observed',
      ttlSeconds: 20 * 60,
      metadata: { source: 'api/sync/anuncios' },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        domain,
        job: {
          key: 'sync_ml_listings_observed',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: false,
        },
        cursor: null,
        records: { seen: 0, snapshot_upserted: 0, failed: 0 },
        errors: [{ code: 'domain_lock_conflict', message: `Domínio ${domain} já está em execução` }],
        duration: { ms: Date.now() - startedAt },
      }, { status: 409 });
    }

    const meResult = await fetchMLResult<any>('/users/me');
    if (!meResult.ok || !meResult.data) {
      if (meResult.error?.category === 'auth_fatal') {
        const auth = await getMLAuthDiagnostics();
        return NextResponse.json({
          success: false,
          domain,
          failure_reason: 'auth_fatal',
          auth_state: auth.state,
          auth_blocked_until: auth.blocked_until,
          errors: [{ code: 'ml_auth_fatal', message: 'Integração ML requer reconexão para sincronizar anúncios' }],
        }, { status: 401 });
      }
      return NextResponse.json({
        success: false,
        domain,
        errors: [{ code: 'ml_connect_failed', message: 'Erro ao conectar com ML' }],
      }, { status: 502 });
    }

    const me = meResult.data;
    const search = await fetchML<any>(`/users/${me.id}/items/search?limit=${limit}&offset=${offset}`);
    if (!search) {
      return NextResponse.json({
        success: false,
        domain,
        errors: [{ code: 'ml_items_search_failed', message: 'Erro ao buscar anúncios no ML' }],
      }, { status: 502 });
    }

    const itemIds: string[] = Array.isArray(search.results) ? search.results : [];
    if (itemIds.length === 0) {
      return NextResponse.json({
        success: true,
        domain,
        job: {
          key: 'sync_ml_listings_observed',
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: true,
        },
        cursor: { offset, limit },
        records: { seen: 0, snapshot_upserted: 0, failed: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
        total: Number(search?.paging?.total || 0),
        proximo: offset,
        acabou: true,
      });
    }

    const serviceClient = createServiceClient();
    const snapshots: any[] = [];
    let recordsFailed = 0;

    await runPool(itemIds, CONCURRENCY, async (itemId) => {
      const itemResult = await fetchMLResult<any>(`/items/${itemId}`);
      if (!itemResult.ok || !itemResult.data) {
        recordsFailed += 1;
        errors.push({
          code: 'ml_item_fetch_failed',
          message: itemResult.error?.message || 'Falha ao carregar item do ML',
          context: { itemId },
        });
        return;
      }

      const item = itemResult.data;
      const sku = extractSku(item);

      let produtoId: string | null = null;
      let skuLocal: string | null = null;

      const { data: byItem } = await serviceClient
        .from('produtos')
        .select('id, sku')
        .eq('ml_item_id', String(item.id))
        .maybeSingle();

      const bySku = !byItem && sku
        ? await serviceClient
            .from('produtos')
            .select('id, sku')
            .eq('sku', sku)
            .maybeSingle()
        : { data: null } as any;

      const produto = byItem || bySku.data || null;
      if (produto?.id) {
        produtoId = String(produto.id);
        skuLocal = String(produto.sku || '') || null;
      }

      snapshots.push({
        ml_item_id: String(item.id),
        seller_id: Number(me.id),
        title: item.title || null,
        status: item.status || null,
        price: Number(item.price || 0),
        price_to_win: null,
        buy_box_status: null,
        buy_box_winning: false,
        permalink: item.permalink || null,
        thumbnail: item.thumbnail || null,
        seller_sku: sku,
        catalog_product_id: item.catalog_product_id || null,
        category_id: item.category_id || null,
        domain_id: item.domain_id || null,
        related_item_id: item.parent_item_id || null,
        related_permalink: null,
        produto_id: produtoId,
        sku_local: skuLocal,
        last_updated_ml: item.last_updated || null,
        synced_at: new Date().toISOString(),
      });
    });

    if (snapshots.length > 0) {
      const { error: upsertError } = await (serviceClient
        .from('catalogo_ml_snapshot' as any)
        .upsert(snapshots as any, { onConflict: 'ml_item_id' }) as any);
      if (upsertError) {
        errors.push({
          code: 'catalog_snapshot_upsert_failed',
          message: upsertError.message,
        });
        return NextResponse.json({
          success: false,
          domain,
          job: {
            key: 'sync_ml_listings_observed',
            started_at: new Date(startedAt).toISOString(),
            finished_at: new Date().toISOString(),
            lock_acquired: true,
          },
          cursor: null,
          records: { seen: itemIds.length, snapshot_upserted: 0, failed: recordsFailed + snapshots.length },
          errors,
          duration: { ms: Date.now() - startedAt },
        }, { status: 500 });
      }
    }

    const total = Number(search?.paging?.total || 0);
    const nextOffset = offset + limit;
    const done = nextOffset >= total || itemIds.length < limit;

    return NextResponse.json({
      success: errors.length === 0,
      domain,
      job: {
        key: 'sync_ml_listings_observed',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: done ? null : { offset: nextOffset, limit },
      records: {
        seen: itemIds.length,
        snapshot_upserted: snapshots.length,
        failed: recordsFailed,
      },
      errors,
      duration: { ms: Date.now() - startedAt },
      // Compatibilidade:
      ok: errors.length === 0,
      sincronizados: snapshots.length,
      total,
      proximo: done ? null : nextOffset,
      acabou: done,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      domain,
      job: {
        key: 'sync_ml_listings_observed',
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: lockAcquired,
      },
      cursor: null,
      records: { seen: 0, snapshot_upserted: 0, failed: 0 },
      errors: [{ code: 'ml_listings_sync_unexpected_error', message: err?.message || 'Erro inesperado no sync de anúncios ML' }],
      duration: { ms: Date.now() - startedAt },
    }, { status: 500 });
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}

