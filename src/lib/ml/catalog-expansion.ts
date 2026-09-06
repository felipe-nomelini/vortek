/** Autorização limitada ao lote da Diretoria; não concede autonomia a outros produtos. */
export const CATALOG_EXPANSION_BATCH = 'CATALOG_EXPANSION_BATCH_01';
export const CATALOG_EXPANSION_SKUS = ['VTK018319','VTK017249','VTK017680','VTK017308','VTK002091','VTK019530','VTK017291','VTK018523','VTK017289','VTK018716'] as const;
export type CatalogExpansionContext = { batchId: typeof CATALOG_EXPANSION_BATCH; preparationId: string };
export function validateCatalogExpansionContext(input: unknown, sku: string): CatalogExpansionContext {
  const c = input as CatalogExpansionContext | null;
  if (!c || c.batchId !== CATALOG_EXPANSION_BATCH || !(CATALOG_EXPANSION_SKUS as readonly string[]).includes(sku) || !/^[0-9a-f-]{36}$/i.test(c.preparationId)) throw Error('LOTE_NAO_AUTORIZADO');
  return c;
}
export function catalogExpansionKey(productId: string) { return `catalog_expansion:${CATALOG_EXPANSION_BATCH}:${productId}`; }
/** Uma tentativa cujo efeito não foi conciliado bloqueia o próximo produto, mesmo após reinício. */
export function assertCatalogExpansionCanAdvance(events: any[]) {
  if (events.some(e => e.event_type === 'CATALOG_EXPANSION_SAFETY_STOP')) throw Error(`${CATALOG_EXPANSION_BATCH}_SAFETY_STOP`);
  const completed = new Set(events.filter(e => e.event_type === 'CATALOG_EXPANSION_VALIDATED').map(e => e.produto_id));
  if (events.some(e => e.event_type === 'CREATE_REQUESTED' && !completed.has(e.produto_id))) throw Error('LOTE_RECONCILIACAO_REMOTA_PENDENTE');
}
export function catalogExpansionReadbackIssues(expected: any, item: any, memory: any): string[] {
  const issues: string[] = [];
  if (!item?.id) return ['READBACK_INDISPONIVEL'];
  if (Number(item.price) !== Number(expected.price)) issues.push('PRECO_DIVERGENTE');
  if (Number(item.available_quantity) !== Number(expected.quantity)) issues.push('ESTOQUE_DIVERGENTE');
  if (item.category_id !== expected.categoryId) issues.push('CATEGORIA_DIVERGENTE');
  if ((item.catalog_product_id ?? null) !== (expected.catalogProductId ?? null)) issues.push('CATALOGO_DIVERGENTE');
  if (item.condition !== 'new') issues.push('CONDICAO_DIVERGENTE');
  if (item.shipping?.mode !== 'me2') issues.push('LOGISTICA_DIVERGENTE');
  if (!memory || memory.result === null || !Number.isFinite(memory.margin) || !memory.band || memory.fee?.source !== 'ml_live' || memory.shipping?.source !== 'ml_live') issues.push('ECONOMIA_INCONCLUSIVA');
  else if (memory.margin < memory.band.floor) issues.push('ECONOMIA_ABAIXO_DO_PISO');
  if (item.status !== 'active' || (item.sub_status?.length ?? 0) > 0) issues.push('STATUS_NAO_VALIDADO');
  return issues;
}
