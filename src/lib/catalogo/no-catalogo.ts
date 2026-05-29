export type BuyBoxFilter = 'all' | 'ganhando' | 'perdendo';

export interface NoCatalogFilters {
  search: string;
  statusMl: string;
  buyBox: BuyBoxFilter;
  priceMin: number | null;
  priceMax: number | null;
}

function safeText(term: string): string {
  return term
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNoCatalogFilters(searchParams: URLSearchParams): NoCatalogFilters {
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const statusMl = (searchParams.get('statusMl') || 'all').trim().toLowerCase();
  const rawBuyBox = (searchParams.get('buyBox') || 'all').trim().toLowerCase();
  const buyBox: BuyBoxFilter =
    rawBuyBox === 'ganhando' || rawBuyBox === 'perdendo' ? rawBuyBox : 'all';

  const minRaw = searchParams.get('priceMin');
  const maxRaw = searchParams.get('priceMax');
  const minParsed = minRaw !== null ? Number(minRaw) : null;
  const maxParsed = maxRaw !== null ? Number(maxRaw) : null;

  return {
    search,
    statusMl,
    buyBox,
    priceMin: minParsed !== null && Number.isFinite(minParsed) ? minParsed : null,
    priceMax: maxParsed !== null && Number.isFinite(maxParsed) ? maxParsed : null,
  };
}

export function isWinningBuyBoxStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'winning' || normalized === 'sharing_first_place';
}

export function normalizeBuyBoxStatus(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload.status,
    payload.buy_box_status,
    payload.item_status,
    payload?.buy_box?.status,
    payload?.result?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function normalizePriceToWin(payload: any): number | null {
  if (!payload || typeof payload !== 'object') return null;

  const numericCandidates = [
    payload.price_to_win,
    payload.price,
    payload.suggested_price,
    payload.winning_price,
    payload?.price_to_win?.price,
    payload?.price_to_win?.amount,
    payload?.price_to_win?.value,
    payload?.result?.price_to_win,
    payload?.result?.price,
  ];

  for (const candidate of numericCandidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return null;
}

export function applyNoCatalogFilters<T>(query: T, filters: NoCatalogFilters): T {
  let q: any = query;

  if (filters.statusMl !== 'all') {
    q = q.eq('status', filters.statusMl);
  }

  if (filters.buyBox === 'ganhando') {
    q = q.eq('buy_box_winning', true);
  } else if (filters.buyBox === 'perdendo') {
    q = q.eq('buy_box_winning', false);
  }

  if (filters.priceMin !== null) {
    q = q.gte('price', filters.priceMin);
  }
  if (filters.priceMax !== null) {
    q = q.lte('price', filters.priceMax);
  }

  if (filters.search) {
    const term = safeText(filters.search);
    if (term) {
      q = q.or([
        `ml_item_id.ilike.%${term}%`,
        `title.ilike.%${term}%`,
        `seller_sku.ilike.%${term}%`,
        `sku_local.ilike.%${term}%`,
        `catalog_product_id.ilike.%${term}%`,
        `related_item_id.ilike.%${term}%`,
      ].join(','));
    }
  }

  return q;
}
