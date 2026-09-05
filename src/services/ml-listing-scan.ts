import { fetchMLResult, type MLRequestResult } from './integration';
const ML_SCAN_PAGE_SIZE = 100;
export async function fetchAllMlItemIds(sellerId: string | number, fetchMLResultWithRetry: <T>(path: string) => Promise<{
    result: MLRequestResult<T>;
    retries: number;
}> = async (path) => ({ result: await fetchMLResult(path), retries: 0 })): Promise<{
    ok: boolean;
    itemIds: string[];
    pagesFetched: number;
    retriesTransient: number;
    error?: {
        code: string;
        category: string;
        upstream_status: number | null;
        trace_id: string | null;
        message: string;
        endpoint: string;
        retries: number;
    };
}> {
    const uniqueIds = new Set<string>();
    let pagesFetched = 0;
    let retriesTransient = 0;
    let scrollId: string | null = null;
    while (pagesFetched < 500) {
        const requestPath: string = scrollId
            ? `/users/${encodeURIComponent(String(sellerId))}/items/search?search_type=scan&scroll_id=${encodeURIComponent(scrollId)}`
            : `/users/${encodeURIComponent(String(sellerId))}/items/search?search_type=scan&limit=${ML_SCAN_PAGE_SIZE}`;
        const scanCheck: {
            result: MLRequestResult<any>;
            retries: number;
        } = await fetchMLResultWithRetry<any>(requestPath);
        retriesTransient += scanCheck.retries;
        const scanResult: MLRequestResult<any> = scanCheck.result;
        if (!scanResult.ok || !scanResult.data) {
            return {
                ok: false,
                itemIds: [],
                pagesFetched,
                retriesTransient,
                error: {
                    code: scanResult.error?.code || 'ml_items_scan_failed',
                    category: scanResult.error?.category || 'error',
                    upstream_status: scanResult.status,
                    trace_id: scanResult.error?.traceId || null,
                    message: scanResult.error?.message || 'Erro ao buscar anúncios completos no ML',
                    endpoint: '/users/{seller_id}/items/search?search_type=scan',
                    retries: scanCheck.retries,
                },
            };
        }
        pagesFetched += 1;
        const payload: any = scanResult.data;
        const results: any[] = Array.isArray(payload?.results) ? payload.results : [];
        for (const rawId of results) {
            const itemId = String(rawId || '').trim();
            if (itemId)
                uniqueIds.add(itemId);
        }
        const nextScrollId: string = String(payload?.scroll_id || '').trim();
        if (results.length === 0 || (!nextScrollId && uniqueIds.size >= Number(payload.paging?.total ?? Infinity))) {
            return {
                ok: true,
                itemIds: Array.from(uniqueIds),
                pagesFetched,
                retriesTransient,
            };
        }
        if (!nextScrollId || results.every(id => typeof id !== "string"))
            break;
        scrollId = nextScrollId;
    }
    return { ok: false, itemIds: [], pagesFetched, retriesTransient };
}
