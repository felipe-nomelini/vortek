import { createServiceClient } from '@/lib/supabase';

interface DsliteConfig {
  url: string;
  token: string;
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

async function fetchDslite<T>(path: string, options?: RequestInit): Promise<T | null> {
  const cfg = await getConfig();
  if (!cfg) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

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
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DsliteProdutoCatalogo {
  id: number;
  nome: string;
  codigo?: string;
  marca?: string;
  categoria?: string;
  preco?: number;
  estoque?: number;
  gtin?: string;
  ncm?: string;
}

export interface DslitePrecoEstoque {
  id: number;
  preco: number;
  estoque: number;
}

export interface DslitePedidoRetorno {
  dsid: number;
  status: string;
  xml_fatura?: string;
  xml_remessa?: string;
  xml_simbolica?: string;
}

export async function sincronizarCatalogo(fornecedorId: number | string): Promise<DsliteProdutoCatalogo[] | null> {
  return fetchDslite<DsliteProdutoCatalogo[]>(`/v1/CrossDocking/Catalogo/${fornecedorId}`);
}

export async function sincronizarPrecoEstoque(fornecedorId: number | string): Promise<DslitePrecoEstoque[] | null> {
  return fetchDslite<DslitePrecoEstoque[]>(`/v1/CrossDocking/PrecoEstoque/${fornecedorId}`);
}

export async function mapearProduto(fornecedorId: number | string, produtoId: number | string, produtoIdEmpresa: number | string): Promise<boolean> {
  const result = await fetchDslite(`/v1/CrossDocking/Catalogo/${fornecedorId}/${produtoId}/${produtoIdEmpresa}`, { method: 'PUT' });
  return result !== null;
}

export async function criarPedidoDropshipping(
  fornecedorId: number | string,
  transportadoraId: number | string,
  xmlConteudo: string
): Promise<DslitePedidoRetorno | null> {
  return fetchDslite<DslitePedidoRetorno>(
    `/v1/DropShipping/fornecedor/${fornecedorId}/transportadora/${transportadoraId}`,
    {
      method: 'POST',
      body: xmlConteudo,
      headers: { 'Content-Type': 'application/xml' },
    }
  );
}

export async function consultarPedido(dsid: number | string): Promise<DslitePedidoRetorno | null> {
  return fetchDslite<DslitePedidoRetorno>(`/v1/DropShipping/${dsid}`);
}

export async function consultarStatusEntrega(dsid: number | string): Promise<string | null> {
  const pedido = await consultarPedido(dsid);
  return pedido?.status ?? null;
}

export async function listarCategorias(): Promise<any[] | null> {
  return fetchDslite('/v1/CrossDocking/Categoria');
}
