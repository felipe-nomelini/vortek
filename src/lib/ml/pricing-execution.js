/** PRC-03: a memória econômica não substitui governança, trilha e autorização. */
/** @returns {{ code: string; error: string } | null} */
export function getPricingExecutionBlock() {
  return {
    code: 'pricing_execution_not_ready',
    error: 'Criação e alteração de preço aguardam os contratos canônicos de execução e homologação. Nenhum preço foi alterado.',
  };
}

export function assertPricingExecutionReady() {
  const block = getPricingExecutionBlock();
  if (block) throw new Error(`${block.code}: ${block.error}`);
}

/** A capability for the approved test operation, never a global switch for legacy writers. */
export function testPricingExecutionAllowed({ mode, appUrl, allowedSellerIds, account, sellerId }) {
  let url;
  try { url = new URL(appUrl); } catch { return false; }
  return mode === 'test_only'
    && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    && ['dev.bentevi.shop', 'localhost', '127.0.0.1'].includes(url.hostname)
    && Array.isArray(allowedSellerIds) && allowedSellerIds.includes(String(sellerId))
    && String(account?.id) === String(sellerId) && account?.site_id === 'MLB'
    && Array.isArray(account?.tags) && account.tags.includes('test_user');
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
