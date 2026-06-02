import type { Database } from '@/types/database';

type ServiceClientLike = {
  from: (table: string) => any;
};

type ExistingAnuncioRow = Pick<
  Database['public']['Tables']['anuncios_ml']['Row'],
  'id' | 'ml_item_id' | 'preco_ml' | 'status' | 'titulo' | 'permalink' | 'thumbnail'
>;

type MlListingLike = {
  id?: string | number | null;
  price?: number | null;
  status?: string | null;
  title?: string | null;
  permalink?: string | null;
  thumbnail?: string | null;
};

function mapMlStatusToLocalStatus(value: unknown): Database['public']['Enums']['ml_status'] {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'active') return 'ativo';
  if (raw === 'paused') return 'pausado';
  return 'sem_anuncio';
}

function normalizePrice(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isDifferentNullableString(a: string | null, b: string | null): boolean {
  return (a || null) !== (b || null);
}

export async function reconcileAnuncioMlFromItem(
  client: ServiceClientLike,
  item: MlListingLike,
  source: 'publish_reconcile' | 'observed_sync' | 'items_webhook',
  existingRow?: ExistingAnuncioRow | null,
): Promise<
  | { ok: true; found: false; updated: false; mlItemId: string }
  | { ok: true; found: true; updated: boolean; mlItemId: string; previousPrice: number; nextPrice: number }
  | { ok: false; mlItemId: string; error: string }
> {
  const mlItemId = String(item?.id || '').trim();
  if (!mlItemId) {
    return { ok: false, mlItemId: '', error: 'ml_item_id ausente para reconciliar anúncio' };
  }

  let current = existingRow ?? null;
  if (!current) {
    const { data, error } = await (client
      .from('anuncios_ml')
      .select('id, ml_item_id, preco_ml, status, titulo, permalink, thumbnail')
      .eq('ml_item_id', mlItemId)
      .maybeSingle() as any);

    if (error) {
      return { ok: false, mlItemId, error: error.message };
    }

    current = (data as ExistingAnuncioRow | null) ?? null;
  }

  if (!current) {
    return { ok: true, found: false, updated: false, mlItemId };
  }

  const nextPrice = normalizePrice(item?.price);
  const nextStatus = mapMlStatusToLocalStatus(item?.status);
  const nextTitle = toNullableString(item?.title);
  const nextPermalink = toNullableString(item?.permalink);
  const nextThumbnail = toNullableString(item?.thumbnail);

  const patch: Database['public']['Tables']['anuncios_ml']['Update'] = {};
  if (normalizePrice(current.preco_ml) !== nextPrice) patch.preco_ml = nextPrice;
  if (current.status !== nextStatus) patch.status = nextStatus;
  if (isDifferentNullableString(current.titulo, nextTitle)) patch.titulo = nextTitle || '';
  if (isDifferentNullableString(current.permalink, nextPermalink)) patch.permalink = nextPermalink;
  if (isDifferentNullableString(current.thumbnail, nextThumbnail)) patch.thumbnail = nextThumbnail;

  if (Object.keys(patch).length === 0) {
    return {
      ok: true,
      found: true,
      updated: false,
      mlItemId,
      previousPrice: normalizePrice(current.preco_ml),
      nextPrice,
    };
  }

  patch.updated_at = new Date().toISOString();

  const { error: updateError } = await (client
    .from('anuncios_ml')
    .update(patch as any)
    .eq('ml_item_id', mlItemId) as any);

  if (updateError) {
    return { ok: false, mlItemId, error: updateError.message };
  }

  console.log(JSON.stringify({
    event: 'ml_anuncio_price_reconciled',
    timestamp_utc: new Date().toISOString(),
    source,
    ml_item_id: mlItemId,
    preco_ml_anterior: normalizePrice(current.preco_ml),
    preco_ml_novo: nextPrice,
    status_anterior: current.status,
    status_novo: nextStatus,
  }));

  return {
    ok: true,
    found: true,
    updated: true,
    mlItemId,
    previousPrice: normalizePrice(current.preco_ml),
    nextPrice,
  };
}
