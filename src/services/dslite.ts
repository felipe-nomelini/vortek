/**
 * Serviço de integração com a API DSLite.
 * Gerencia catálogo de produtos, preços/estoque, pedidos dropshipping e fornecedores.
 * Autenticação via token fixo no header `Token:`.
 */
import { createServiceClient } from '@/lib/supabase';

interface DsliteConfig {
  url: string;
  token: string;
}

const DSLITE_FETCH_MAX_ATTEMPTS = 3;
const DSLITE_FETCH_RETRY_DELAYS_MS = [750, 2000];
const DSLITE_CREATE_ORDER_MAX_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDsliteStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isDsliteLockWaitTimeout(value: unknown): boolean {
  return JSON.stringify(value || {})
    .toLowerCase()
    .includes('lock wait timeout exceeded');
}

async function getConfig(): Promise<DsliteConfig | null> {
  const client = createServiceClient();
  const { data } = await client
    .from('integracoes')
    .select('url, access_token')
    .eq('tipo', 'dslite')
    .single();
  if (!data?.url || !data?.access_token) return null;
  return { url: data.url.replace(/\/+$/, ''), token: data.access_token };
}

export async function fetchDslite<T>(path: string, options?: RequestInit): Promise<T | null> {
  const cfg = await getConfig();
  if (!cfg) return null;

  for (let attempt = 1; attempt <= DSLITE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(`${cfg.url}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Token: cfg.token,
          ...options?.headers,
        },
      });

      if (!res.ok) {
        const retryable = isRetryableDsliteStatus(res.status);
        console.warn(`[dslite] HTTP ${res.status} em ${path} (tentativa ${attempt}/${DSLITE_FETCH_MAX_ATTEMPTS})`);
        if (retryable && attempt < DSLITE_FETCH_MAX_ATTEMPTS) {
          await sleep(DSLITE_FETCH_RETRY_DELAYS_MS[attempt - 1] || 2000);
          continue;
        }
        return null;
      }

      return res.json();
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError';
      console.warn(
        `[dslite] ${isAbort ? 'timeout' : 'erro'} em ${path} (tentativa ${attempt}/${DSLITE_FETCH_MAX_ATTEMPTS}): ${err?.message || 'sem detalhe'}`,
      );
      if (attempt < DSLITE_FETCH_MAX_ATTEMPTS) {
        await sleep(DSLITE_FETCH_RETRY_DELAYS_MS[attempt - 1] || 2000);
        continue;
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

// ── API response types ──────────────────────────────────────

export interface DsliteCatalogoResponse {
  fornecedorid: number;
  nome: string;
  cnpj: string;
  apelido: string;
  detalhesConsulta: {
    offset: number;
    limit: number;
    registrosRetornados: number;
    totalRegistros: number;
  };
  produtos: DsliteProduto[];
}

export interface DslitePrecoEstoqueResponse {
  fornecedorid: number;
  nome: string;
  cnpj: string;
  apelido: string;
  detalhesConsulta: {
    offset: number;
    limit: number;
    registrosRetornados: number;
    totalRegistros: number;
  };
  produtos: DslitePrecoEstoqueItem[];
}

export interface DsliteProduto {
  produtoid: string;
  produtoid_empresa: string;
  fornecedorid: number;
  titulo: string;
  titulo_curto?: string;
  preco_normal: number;
  preco_crossdocking: number;
  preco_promocional?: number;
  margem_lucro?: number;
  estoque: number;
  estoque_total?: number;
  ean11?: string;
  ncm?: string;
  marca?: string;
  modelo?: string;
  peso?: number;
  largura?: number;
  altura?: number;
  profundidade?: number;
  descricao?: string;
  caracteristicas?: string;
  informacoes?: string;
  link_imagem?: string;
  link?: string;
  categoria_nome?: string;
  categoriaid?: string;
  cest?: string;
  ipi?: number;
  icmsrate?: number;
  origem?: string;
  origem_faturamento?: string;
  cep_origem?: string;
  tempo_garantia?: number;
  status_empresa?: string;
  status_fornecedor?: string;
  data_atualizacao_preco?: { date: string; timezone_type: number; timezone: string };
  data_atualizacao_estoque?: { date: string; timezone_type: number; timezone: string };
  midias?: { tipo: string; indice: string; valor: string }[];
  volumes?: number;
  embalagem_unidade?: string;
  variacoes?: any[];
}

export interface DslitePrecoEstoqueItem {
  produtoid: string;
  produtoid_empresa: string;
  fornecedorid: number;
  titulo: string;
  preco_normal: number;
  preco_crossdocking: number;
  estoque: number;
  ean11?: string;
  ncm?: string;
  marca?: string;
  status_empresa?: string;
}

export interface DsliteFornecedorStatus {
  id: number;
  apelido: string;
  status: string;
  crossdocking: string;
  dropshipping: string;
  nome?: string;
  cnpj?: string;
  endereco?: string;
  email?: string;
  telefone?: string;
  [key: string]: unknown;
}

export interface DslitePedidoRetorno {
  dsid: number;
  status: string;
  chave_acesso: string;
  nf_numero: string;
}

export type DsliteCreateOrderFailureType =
  | 'http_error'
  | 'timeout'
  | 'invalid_response'
  | 'cancelled';

export type DsliteCreateOrderMode = 'with_supplier' | 'without_supplier';

export type DsliteCreateOrderResult =
  | ({
      success: true;
      raw: DsliteCriarPedidoResponse;
      createMode: DsliteCreateOrderMode;
      endpointPath: string;
    } & DslitePedidoRetorno)
  | {
      success: false;
      failureType: DsliteCreateOrderFailureType;
      statusHttp: number | null;
      responseText: string | null;
      parsedBody: unknown;
      message: string;
      createMode: DsliteCreateOrderMode;
      endpointPath: string;
    };

export type DsliteProductLookupFailureReason =
  | 'produto_nao_encontrado_por_id_direto'
  | 'produto_nao_encontrado_por_produtoid_empresa'
  | 'catalogo_paginado_sem_match'
  | 'falha_http_dslite_catalogo';

export type DsliteProductLookupMethod =
  | 'direct_produtoid'
  | 'catalog_scan_produtoid_empresa'
  | 'catalog_scan_produtoid';

export interface DsliteProductLookupResult {
  product: DsliteProduto | null;
  method: DsliteProductLookupMethod | null;
  failureReason: DsliteProductLookupFailureReason | null;
  diagnostics: {
    fornecedorId: string;
    dsliteProdutoId: string | null;
    skuLocal: string;
    skuSemPrefixo: string;
    attempts: Array<{
      method: DsliteProductLookupMethod;
      success: boolean;
      status: 'found' | 'not_found' | 'http_error';
      page?: number;
      produtoid?: string | null;
      produtoid_empresa?: string | null;
    }>;
  };
}

export interface DsliteCriarPedidoResponse {
  total: number;
  sucesso: number;
  erros: number;
  logs: {
    dsid: number;
    status: string;
    chave_acesso: string;
    nf_numero: string;
    mensagem_tipo: string;
    mensagem_conteudo: string;
  }[];
}

// ── Services ─────────────────────────────────────────────────

export async function listarFornecedores(): Promise<DsliteFornecedorStatus[] | null> {
  const data = await fetchDslite<any>('/v1/Empresa/fornecedor/status');
  return data?.fornecedores ?? null;
}

export async function sincronizarCatalogo(
  fornecedorId: number | string,
  page: number = 1,
  limit: number = 1000
): Promise<DsliteCatalogoResponse | null> {
  return fetchDslite<DsliteCatalogoResponse>(
    `/v1/CrossDocking/Catalogo/${fornecedorId}?page=${page}&limit=${limit}`
  );
}

export async function obterProdutoEspecifico(
  fornecedorId: number | string,
  produtoId: number | string
): Promise<DsliteProduto | null> {
  const data = await fetchDslite<any>(`/v1/CrossDocking/Catalogo/${fornecedorId}/${produtoId}`);
  if (data?.produto) return data.produto;
  if (Array.isArray(data?.produtos) && data.produtos.length > 0) {
    return data.produtos[0] ?? null;
  }
  return null;
}

export async function sincronizarPrecoEstoque(
  fornecedorId: number | string,
  page: number = 1,
  limit: number = 1000
): Promise<DslitePrecoEstoqueResponse | null> {
  return fetchDslite<DslitePrecoEstoqueResponse>(
    `/v1/CrossDocking/PrecoEstoque/${fornecedorId}?page=${page}&limit=${limit}`
  );
}

export async function mapearProduto(
  fornecedorId: number | string,
  produtoId: number | string,
  produtoIdEmpresa: number | string
): Promise<boolean> {
  const result = await fetchDslite(
    `/v1/CrossDocking/Catalogo/${fornecedorId}/${produtoId}/${produtoIdEmpresa}`,
    { method: 'PUT' }
  );
  return result !== null;
}

async function criarPedidoDropshippingBase(
  xmlConteudo: string,
  params: { fornecedorId?: number | string | null }
): Promise<DsliteCreateOrderResult> {
  const cfg = await getConfig();
  const hasSupplier = String(params.fornecedorId || '').trim().length > 0;
  const createMode: DsliteCreateOrderMode = hasSupplier ? 'with_supplier' : 'without_supplier';
  const endpointPath = hasSupplier
    ? `/v1/DropShipping/fornecedor/${encodeURIComponent(String(params.fornecedorId).trim())}`
    : '/v1/DropShipping';

  if (!cfg) {
    return {
      success: false,
      failureType: 'invalid_response',
      statusHttp: null,
      responseText: null,
      parsedBody: null,
      message: 'Integração DSLite não configurada',
      createMode,
      endpointPath,
    };
  }

  let lastFailure: DsliteCreateOrderResult | null = null;

  for (let attempt = 1; attempt <= DSLITE_CREATE_ORDER_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const formData = new FormData();
    const blob = new Blob([xmlConteudo], { type: 'application/xml' });
    formData.append('files', blob, 'nota.xml');

    try {
      const res = await fetch(`${cfg.url}${endpointPath}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          Token: cfg.token,
        },
        body: formData,
      });

      const responseText = await res.text().catch(() => '');
      let parsedBody: unknown = null;
      if (responseText) {
        try {
          parsedBody = JSON.parse(responseText);
        } catch {
          parsedBody = null;
        }
      }

      if (!res.ok) {
        const message = `HTTP ${res.status}: ${responseText.substring(0, 500) || 'resposta vazia da DSLite'}`;
        console.error(`[dslite] Erro ao criar pedido: ${message}`);
        lastFailure = {
          success: false,
          failureType: 'http_error',
          statusHttp: res.status,
          responseText,
          parsedBody,
          message,
          createMode,
          endpointPath,
        };
        if (isRetryableDsliteStatus(res.status) && attempt < DSLITE_CREATE_ORDER_MAX_ATTEMPTS) {
          await sleep(DSLITE_FETCH_RETRY_DELAYS_MS[attempt - 1] || 2000);
          continue;
        }
        return lastFailure;
      }

      const data = parsedBody as DsliteCriarPedidoResponse | null;
      const log = data?.logs?.[0];
      if (!log?.dsid) {
        const message = 'Resposta DSLite sem dsid no payload de criação';
        console.error(`[dslite] ${message}:`, JSON.stringify(data, null, 2));
        lastFailure = {
          success: false,
          failureType: 'invalid_response',
          statusHttp: res.status,
          responseText,
          parsedBody,
          message,
          createMode,
          endpointPath,
        };
        if (isDsliteLockWaitTimeout(parsedBody) && attempt < DSLITE_CREATE_ORDER_MAX_ATTEMPTS) {
          await sleep(DSLITE_FETCH_RETRY_DELAYS_MS[attempt - 1] || 2000);
          continue;
        }
        return lastFailure;
      }

      return {
        success: true,
        dsid: log.dsid,
        status: log.status,
        chave_acesso: log.chave_acesso,
        nf_numero: log.nf_numero,
        raw: data as DsliteCriarPedidoResponse,
        createMode,
        endpointPath,
      };
    } catch (err: any) {
      const failureType: DsliteCreateOrderFailureType = err?.name === 'AbortError' ? 'timeout' : 'cancelled';
      const message = err?.message || 'Erro inesperado ao criar pedido na DSLite';
      console.error(`[dslite] Erro inesperado ao criar pedido:`, err);
      lastFailure = {
        success: false,
        failureType,
        statusHttp: null,
        responseText: null,
        parsedBody: null,
        message,
        createMode,
        endpointPath,
      };
      if (attempt < DSLITE_CREATE_ORDER_MAX_ATTEMPTS) {
        await sleep(DSLITE_FETCH_RETRY_DELAYS_MS[attempt - 1] || 2000);
        continue;
      }
      return lastFailure;
    } finally {
      clearTimeout(timeout);
    }
  }

  return lastFailure || {
    success: false,
    failureType: 'invalid_response',
    statusHttp: null,
    responseText: null,
    parsedBody: null,
    message: 'Falha ao criar pedido na DSLite após tentativas',
    createMode,
    endpointPath,
  };
}

export async function criarPedidoDropshipping(
  xmlConteudo: string
): Promise<DsliteCreateOrderResult> {
  return criarPedidoDropshippingBase(xmlConteudo, { fornecedorId: null });
}

export async function criarPedidoDropshippingComFornecedor(
  xmlConteudo: string,
  fornecedorId: number | string
): Promise<DsliteCreateOrderResult> {
  return criarPedidoDropshippingBase(xmlConteudo, { fornecedorId });
}

export async function consultarPedido(dsid: number | string): Promise<DslitePedidoRetorno | null> {
  return fetchDslite<DslitePedidoRetorno>(`/v1/DropShipping/${dsid}`);
}

export async function consultarPedidoPorChaveAcesso(
  chaveAcesso: string
): Promise<{ dsid: number; status: string; cancelado: boolean } | null> {
  const data = await fetchDslite<any>(`/v1/DropShipping/${chaveAcesso}`);
  if (!data?.dsid) return null;

  const status = data.status || '';
  const statusCode = data.status_code || '';
  const cancelado =
    statusCode === 'CAN' ||
    statusCode === 'CEM' ||
    status.toLowerCase().includes('cancelado');

  return {
    dsid: data.dsid,
    status,
    cancelado,
  };
}

export async function listarCategorias(): Promise<any[] | null> {
  return fetchDslite('/v1/CrossDocking/Categoria');
}

export async function buscarProdutoPorSku(
  fornecedorId: number | string,
  sku: string
): Promise<DsliteProduto | null> {
  let page = 1;
  while (true) {
    const data = await fetchDslite<DsliteCatalogoResponse>(
      `/v1/CrossDocking/Catalogo/${fornecedorId}?page=${page}&limit=100`
    );
    if (!data?.produtos?.length) return null;

    // Busca pelo produtoid_empresa (SKU sem prefixo)
    const produto = data.produtos.find(p => String(p.produtoid_empresa) === sku);
    if (produto) return produto;

    // Fallback: busca pelo produtoid
    const byProdutoid = data.produtos.find(p => String(p.produtoid) === sku);
    if (byProdutoid) return byProdutoid;

    const totalRegistros = data.detalhesConsulta?.totalRegistros || 0;
    const registrosRetornados = data.detalhesConsulta?.registrosRetornados || data.produtos.length;
    const totalPaginas = Math.ceil(totalRegistros / registrosRetornados);

    if (page >= totalPaginas) return null;
    page++;
  }
}

export async function resolverProdutoMapeadoDslite(params: {
  fornecedorId: number | string;
  dsliteProdutoId?: number | string | null;
  skuLocal: string;
  skuSemPrefixo: string;
}): Promise<DsliteProductLookupResult> {
  const fornecedorId = String(params.fornecedorId || '').trim();
  const dsliteProdutoId = String(params.dsliteProdutoId || '').trim() || null;
  const skuLocal = String(params.skuLocal || '').trim();
  const skuSemPrefixo = String(params.skuSemPrefixo || '').trim();
  const attempts: DsliteProductLookupResult['diagnostics']['attempts'] = [];

  const diagnostics = {
    fornecedorId,
    dsliteProdutoId,
    skuLocal,
    skuSemPrefixo,
    attempts,
  };

  if (dsliteProdutoId) {
    const directProduct = await obterProdutoEspecifico(fornecedorId, dsliteProdutoId);
    if (directProduct) {
      attempts.push({
        method: 'direct_produtoid',
        success: true,
        status: 'found',
        produtoid: String(directProduct.produtoid || ''),
        produtoid_empresa: String(directProduct.produtoid_empresa || ''),
      });
      return {
        product: directProduct,
        method: 'direct_produtoid',
        failureReason: null,
        diagnostics,
      };
    }

    attempts.push({
      method: 'direct_produtoid',
      success: false,
      status: 'not_found',
      produtoid: dsliteProdutoId,
      produtoid_empresa: null,
    });
  }

  let page = 1;
  let sawHttpFailure = false;

  while (true) {
    const data = await fetchDslite<DsliteCatalogoResponse>(
      `/v1/CrossDocking/Catalogo/${fornecedorId}?page=${page}&limit=100`
    );

    if (!data) {
      sawHttpFailure = true;
      attempts.push({
        method: 'catalog_scan_produtoid_empresa',
        success: false,
        status: 'http_error',
        page,
        produtoid: dsliteProdutoId,
        produtoid_empresa: skuLocal,
      });
      return {
        product: null,
        method: null,
        failureReason: 'falha_http_dslite_catalogo',
        diagnostics,
      };
    }

    if (!data.produtos?.length) break;

    const byProdutoIdEmpresa = data.produtos.find((item) => String(item.produtoid_empresa) === skuLocal);
    if (byProdutoIdEmpresa) {
      attempts.push({
        method: 'catalog_scan_produtoid_empresa',
        success: true,
        status: 'found',
        page,
        produtoid: String(byProdutoIdEmpresa.produtoid || ''),
        produtoid_empresa: String(byProdutoIdEmpresa.produtoid_empresa || ''),
      });
      return {
        product: byProdutoIdEmpresa,
        method: 'catalog_scan_produtoid_empresa',
        failureReason: null,
        diagnostics,
      };
    }

    if (page === 1) {
      attempts.push({
        method: 'catalog_scan_produtoid_empresa',
        success: false,
        status: 'not_found',
        page,
        produtoid: dsliteProdutoId,
        produtoid_empresa: skuLocal,
      });
    }

    const byProdutoId = data.produtos.find((item) => String(item.produtoid) === skuSemPrefixo);
    if (byProdutoId) {
      attempts.push({
        method: 'catalog_scan_produtoid',
        success: true,
        status: 'found',
        page,
        produtoid: String(byProdutoId.produtoid || ''),
        produtoid_empresa: String(byProdutoId.produtoid_empresa || ''),
      });
      return {
        product: byProdutoId,
        method: 'catalog_scan_produtoid',
        failureReason: null,
        diagnostics,
      };
    }

    const totalRegistros = data.detalhesConsulta?.totalRegistros || 0;
    const registrosRetornados = data.detalhesConsulta?.registrosRetornados || data.produtos.length;
    const totalPaginas = Math.ceil(totalRegistros / registrosRetornados);

    if (page >= totalPaginas) break;
    page++;
  }

  return {
    product: null,
    method: null,
    failureReason: sawHttpFailure
      ? 'falha_http_dslite_catalogo'
      : attempts.some((attempt) => attempt.method === 'catalog_scan_produtoid' && attempt.status === 'found')
        ? null
        : attempts.some((attempt) => attempt.method === 'catalog_scan_produtoid_empresa' && attempt.status === 'not_found')
          ? 'catalogo_paginado_sem_match'
          : attempts.some((attempt) => attempt.method === 'direct_produtoid' && attempt.status === 'not_found')
            ? 'produto_nao_encontrado_por_id_direto'
            : 'produto_nao_encontrado_por_produtoid_empresa',
    diagnostics,
  };
}

export async function informarFornecedorPedido(
  dsid: number | string,
  fornecedorId: number | string
): Promise<{ success: boolean; message?: string; data?: any } | null> {
  const cfg = await getConfig();
  if (!cfg) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${cfg.url}/v1/DropShipping/${dsid}/fornecedor/${fornecedorId}`, {
      method: 'PUT',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Token': cfg.token,
      },
    });

    const responseText = await res.text();
    
    if (!res.ok) {
      return { 
        success: false, 
        message: `HTTP ${res.status}: ${responseText.substring(0, 300)}` 
      };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erro ao informar fornecedor' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function vincularProdutoItem(
  dsid: number | string,
  itemId: number | string,
  produtoId: number | string
): Promise<{ success: boolean; message?: string } | null> {
  const cfg = await getConfig();
  if (!cfg) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${cfg.url}/v1/DropShipping/${dsid}/item/${itemId}/${produtoId}`, {
      method: 'PUT',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Token': cfg.token,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, message: `HTTP ${res.status}: ${errText.substring(0, 300)}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erro ao vincular produto' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function definirTransportadoraPedido(
  dsid: number | string,
  transportadoraId: number | string
): Promise<{ success: boolean; message?: string } | null> {
  const cfg = await getConfig();
  if (!cfg) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${cfg.url}/v1/DropShipping/${dsid}/transportadora/${transportadoraId}`, {
      method: 'PUT',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Token': cfg.token,
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, message: `HTTP ${res.status}: ${errText.substring(0, 300)}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erro ao definir transportadora' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function enviarEtiqueta(
  dsid: number | string,
  pdfBuffer: Buffer,
  fileName: string = 'etiqueta.pdf'
): Promise<{ success: boolean; message?: string } | null> {
  const cfg = await getConfig();
  if (!cfg) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
  formData.append('file', blob, fileName);

  try {
    const res = await fetch(`${cfg.url}/v1/DropShipping/${dsid}/etiqueta`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Token: cfg.token,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, message: `HTTP ${res.status}: ${errText.substring(0, 300)}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Erro ao enviar etiqueta' };
  } finally {
    clearTimeout(timeout);
  }
}
