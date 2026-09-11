/** PRC-03: a memória econômica não substitui governança, trilha e autorização. */
/** @returns {{ code: string; error: string } | null} */
export function getPricingExecutionBlock() {
  return {
    code: 'pricing_execution_not_ready',
    error: 'A execução comercial canônica não está habilitada neste ambiente. Nenhum anúncio ou preço foi alterado.',
  };
}

export function assertPricingExecutionReady() {
  const block = getPricingExecutionBlock();
  if (block) throw new Error(`${block.code}: ${block.error}`);
}

const TEST_HOSTS = ['dev.bentevi.shop', 'localhost', '127.0.0.1'];
const PRODUCTION_ORIGIN = 'https://app.bentevi.shop';

function executionUrl(appUrl) {
  let url;
  try { url = new URL(appUrl); } catch { return null; }
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
}

/**
 * Sanitized server capability. It never grants access to a seller or unlocks legacy writers.
 * @param {{mode?: string, runtimeEnvironment?: string, appUrl?: string, allowedSellerIds?: string[], allowedOperations?: string[]}} input
 */
export function getPricingExecutionCapability({ mode, runtimeEnvironment, appUrl, allowedSellerIds, allowedOperations = [] }) {
  const normalizedMode = ['test_only', 'production_controlled'].includes(mode) ? mode : 'disabled';
  const target = normalizedMode === 'test_only' ? 'test'
    : normalizedMode === 'production_controlled' ? 'production' : null;
  const url = executionUrl(appUrl);
  const environmentAllowed = normalizedMode === 'test_only'
    ? !!url && TEST_HOSTS.includes(url.hostname)
    : normalizedMode === 'production_controlled'
      && runtimeEnvironment === 'production'
      && url?.origin === PRODUCTION_ORIGIN
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  const operations = [...new Set((Array.isArray(allowedOperations) ? allowedOperations : [])
    .filter(value => ['price_change', 'listing_create'].includes(value)))];
  const enabled = environmentAllowed && Array.isArray(allowedSellerIds) && allowedSellerIds.length > 0
    && operations.length > 0;
  return { mode: normalizedMode, enabled: Boolean(enabled), target, allowedOperations: operations };
}

/** Account-bound capability for the single canonical commercial executor. */
export function pricingExecutionAllowed({
  mode, runtimeEnvironment, appUrl, allowedSellerIds, allowedOperations, account, sellerId,
}) {
  const capability = getPricingExecutionCapability({ mode, runtimeEnvironment, appUrl, allowedSellerIds, allowedOperations });
  const tags = account?.tags;
  return capability.enabled
    && Array.isArray(allowedSellerIds) && allowedSellerIds.includes(String(sellerId))
    && String(account?.id) === String(sellerId) && account?.site_id === 'MLB'
    && Array.isArray(tags)
    && (capability.target === 'test' ? tags.includes('test_user') : !tags.includes('test_user'));
}

export function pricingOperationAllowed(capability, operationKind) {
  return capability?.enabled === true && capability.allowedOperations?.includes(operationKind) === true;
}

/** A price write is confirmed by the read-back, not by HTTP 2xx. */
export function pricingReadbackMatches(item, sellerId, priceCents, members = []) {
  return !!item && String(item.seller_id) === String(sellerId) && item.currency_id === 'BRL'
    && Number.isSafeInteger(priceCents) && priceCents > 0
    && typeof item.price === 'number' && Math.round(item.price * 100) === priceCents
    && members.every(m => {
      const price = m.variationId ? m.item?.variations?.find(v => String(v.id) === m.variationId)?.price : m.item?.price;
      return typeof price === 'number' && Math.round(price * 100) === priceCents
        && String(m.item?.seller_id) === String(sellerId) && m.item?.currency_id === 'BRL';
    });
}
