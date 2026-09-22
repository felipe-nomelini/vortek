import 'server-only';

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export async function queryProductReadModel(client: RpcClient, args: Record<string, unknown>, allRows = false) {
  const pageSize = allRows ? 500 : Number(args.p_page_size || 100);
  const first = await client.rpc('search_ui_product_projection', { ...args, p_page: allRows ? 1 : args.p_page, p_page_size: pageSize });
  if (first.error) throw new Error(first.error.message || 'Falha ao consultar a projeção de produtos');
  const result = first.data || {};
  if (!allRows) return result;
  const rows = Array.isArray(result.data) ? [...result.data] : [];
  const total = Number(result.total || 0);
  for (let page = 2; rows.length < total; page += 1) {
    const next = await client.rpc('search_ui_product_projection', { ...args, p_page: page, p_page_size: pageSize });
    if (next.error) throw new Error(next.error.message || 'Falha ao continuar a projeção de produtos');
    const batch = Array.isArray(next.data?.data) ? next.data.data : [];
    if (!batch.length) throw new Error('A projeção de produtos mudou durante a exportação');
    rows.push(...batch);
  }
  return { ...result, data: rows, page: 1, pageSize: rows.length };
}
export async function queryListingReadModel(client: RpcClient, args: Record<string, unknown>, allRows = false) {
  const pageSize = allRows ? 500 : Number(args.p_page_size || 100);
  const first = await client.rpc('search_ui_listing_projection', { ...args, p_page: allRows ? 1 : args.p_page, p_page_size: pageSize });
  if (first.error) throw new Error(first.error.message || 'Falha ao consultar a projeção de anúncios');
  const result = first.data || {};
  if (!allRows) return result;
  const rows = Array.isArray(result.data) ? [...result.data] : [];
  const total = Number(result.total || 0);
  for (let page = 2; rows.length < total; page += 1) {
    const next = await client.rpc('search_ui_listing_projection', { ...args, p_page: page, p_page_size: pageSize });
    if (next.error) throw new Error(next.error.message || 'Falha ao continuar a projeção de anúncios');
    const batch = Array.isArray(next.data?.data) ? next.data.data : [];
    if (!batch.length) throw new Error('A projeção de anúncios mudou durante a exportação');
    rows.push(...batch);
  }
  return { ...result, data: rows, page: 1, pageSize: rows.length };
}
