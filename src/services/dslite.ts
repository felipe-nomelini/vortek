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
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
}

export interface DslitePedidoRetorno {
  dsid: number;
  status: string;
  xml_fatura?: string;
  xml_remessa?: string;
  xml_simbolica?: string;
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
  return data?.produto ?? null;
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

export async function criarPedidoDropshipping(
  fornecedorId: number | string,
  transportadoraId: number | string,
  xmlConteudo: string
): Promise<DslitePedidoRetorno | null> {
  return fetchDslite<DslitePedidoRetorno>(
    `/v1/DropShipping/fornecedor/${fornecedorId}/transportadora/${transportadoraId}`,
    { method: 'POST', body: xmlConteudo, headers: { 'Content-Type': 'application/xml' } }
  );
}

export async function consultarPedido(dsid: number | string): Promise<DslitePedidoRetorno | null> {
  return fetchDslite<DslitePedidoRetorno>(`/v1/DropShipping/${dsid}`);
}

export async function listarCategorias(): Promise<any[] | null> {
  return fetchDslite('/v1/CrossDocking/Categoria');
}
