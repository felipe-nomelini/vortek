import 'server-only';

export type AssistantReadFault = 'fonte_indisponivel' | 'fonte_parcial' | 'cancelado' | 'consulta_bloqueada';
export class AssistantReadError extends Error {
  constructor(public readonly code: AssistantReadFault) {
    super(code);
    // Interrupção deliberada do transporte: PostgREST não deve repetir um bloqueio local como erro de rede.
    this.name = 'AbortError';
  }
}

/** RPCs locais STABLE auditadas. Nenhum nome ou comando vem do usuário/modelo. */
const READ_RPCS = new Set(['get_pricing_monthly_revenue', 'get_internal_clearance_stock', 'get_product_pricing_clearances']);
const READ_TABLES = new Set(['profiles', 'configuracoes', 'fornecedores', 'pedidos', 'pedidos_operacionais', 'pedido_itens',
  'compras', 'produtos', 'produto_kits', 'produto_kit_componentes', 'produto_fornecedor_ofertas', 'estoque_interno_movimentacoes',
  'estoque_interno_posicoes', 'nf_auditoria_eventos', 'anuncios_ml', 'catalogo_ml_snapshot', 'ml_pricing_groups',
  'ml_pricing_group_members', 'ml_pricing_group_revisions', 'manual_pricing_overrides', 'pricing_operations']);

export function assertAssistantDestination(url: string) {
  const parsed = new URL(url);
  // IP literal evita que um DNS re-resolvido aponte para produção entre check e fetch.
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== '192.168.1.162'
    || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new AssistantReadError('consulta_bloqueada');
  }
  return parsed.origin;
}

/** Necessário: projeções existentes usam service_role e algumas toleram erros de leitura.
 * O latch impede que erro, truncamento ou tentativa de escrita se transforme em resposta completa.
 * Não é cliente SQL genérico nem é exportado ao navegador/modelo.
 */
export function createAssistantReadTransport(url: string, signal: AbortSignal) {
  const origin = assertAssistantDestination(url);
  let fault: AssistantReadError | null = null;
  let requests = 0;
  let bytes = 0;
  function fail(code: AssistantReadFault): never {
    fault ??= new AssistantReadError(code);
    throw fault;
  }
  function assertHealthy() {
    if (signal.aborted) fail('cancelado');
    if (fault) throw fault;
  }
  const readFetch: typeof fetch = async (input, init) => {
    assertHealthy();
    const request = new Request(input, init);
    const target = new URL(request.url);
    const rpc = target.pathname.startsWith('/rest/v1/rpc/');
    const name = target.pathname.slice('/rest/v1/rpc/'.length);
    if (target.origin !== origin || target.username || target.password
      || !/^\/rest\/v1\/[a-z_]+(?:\/[a-z_]+)?$/.test(target.pathname)
      || (rpc ? !READ_RPCS.has(name) || !['GET', 'POST'].includes(request.method)
        : request.method !== 'GET' || !READ_TABLES.has(target.pathname.slice('/rest/v1/'.length)))) {
      fail('consulta_bloqueada');
    }
    if (++requests > 80) fail('fonte_parcial');
    const headers = new Headers(request.headers);
    if (!rpc) headers.set('Prefer', 'count=exact');
    let response: Response;
    try {
      response = await fetch(new Request(request, { headers, signal, redirect: 'error', cache: 'no-store' }));
    } catch { return fail(signal.aborted ? 'cancelado' : 'fonte_indisponivel'); }
    assertHealthy();
    if (!response.ok) fail('fonte_indisponivel');
    const body = await response.arrayBuffer();
    bytes += body.byteLength;
    if (bytes > 4 * 1024 * 1024) fail('fonte_parcial');
    // Serviços antigos sem paginação não podem perder linhas silenciosamente no limite PostgREST.
    if (!rpc && !target.searchParams.has('limit') && !request.headers.has('Range')) {
      const range = response.headers.get('content-range')?.match(/^(\d+)-(\d+)\/(\d+)$/);
      if (range && Number(range[3]) > Number(range[2]) - Number(range[1]) + 1) fail('fonte_parcial');
    }
    assertHealthy();
    return new Response(body, { status: response.status, headers: response.headers });
  };
  return { fetch: readFetch, assertHealthy };
}
