/** Integração server-side com o catálogo e os pedidos triangulares da Evolusom. */
const EVOLUSOM_API_ORIGIN = 'https://api2.evolusom.com.br';
const EVOLUSOM_PAGE_SIZE = 100;
const EVOLUSOM_REQUEST_INTERVAL_MS = 1_000;

let nextRequestAt = 0;

export interface EvolusomProduct {
  codigo: number | string;
  nome: string;
  cod_ean?: string | null;
  ncm?: string | null;
  marca?: string | null;
  peso?: number | string | null;
  largura?: number | string | null;
  altura?: number | string | null;
  comprimento?: number | string | null;
  origem?: string | null;
  descricao?: { descricao?: string | null; especificacao?: string | null } | null;
  imagens?: string[] | null;
  categorias?: Array<{ nome?: string | null }> | null;
  tabelas?: { PR?: { preco?: number | null; ipi?: number | null; estoque?: number | null } | null } | null;
  data_ult_atualizacao?: string | null;
}

interface EvolusomCatalogPage {
  data?: EvolusomProduct[];
  meta?: { current_page?: number; last_page?: number; per_page?: number; total?: number };
}

export class EvolusomApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'EvolusomApiError';
    this.status = status;
  }
}

export function isEvolusomAccessError(error: unknown): error is EvolusomApiError {
  return error instanceof EvolusomApiError
    && (error.status === 401 || error.status === 403);
}

function getToken(): string {
  const token = String(process.env.EVOLUSOM_API_TOKEN || '').trim().replace(/^Bearer\s+/i, '');
  if (!token) throw new EvolusomApiError('Token da Evolusom não configurado', 401);
  return token;
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + EVOLUSOM_REQUEST_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

export async function evolusomRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/v1/')) throw new EvolusomApiError('Caminho Evolusom inválido');
  await throttle();
  const response = await fetch(`${EVOLUSOM_API_ORIGIN}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    cache: 'no-store',
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After');
    const reason = response.status === 429 && retryAfter
      ? `Limite de requisições Evolusom; tente novamente após ${retryAfter}s`
      : `Evolusom respondeu HTTP ${response.status}`;
    throw new EvolusomApiError(reason, response.status);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new EvolusomApiError('Evolusom retornou JSON inválido', response.status);
  }
}

export async function loadEvolusomCatalogPage(page: number, requestedSize: number): Promise<{
  products: EvolusomProduct[];
  page: number;
  pageSize: number;
  total: number;
}> {
  // A API documenta paginação, mas em produção aceita somente lotes de 100.
  // Manter o argumento preserva o contrato do adaptador DSLite; a Evolusom
  // sempre recebe o tamanho suportado pelo endpoint.
  void requestedSize;
  const pageSize = EVOLUSOM_PAGE_SIZE;
  const currentPage = Math.max(1, Math.trunc(page));
  const result = await evolusomRequest<EvolusomCatalogPage>(
    `/v1/produtos/cliente?page=${currentPage}&per_page=${pageSize}`,
  );
  if (!Array.isArray(result.data) || !result.meta || !Number.isFinite(Number(result.meta.total))) {
    throw new EvolusomApiError('Resposta de catálogo Evolusom incompleta');
  }
  return {
    products: result.data,
    page: currentPage,
    pageSize,
    total: Number(result.meta.total),
  };
}

export function mapEvolusomProduct(product: EvolusomProduct) {
  const sku = String(product.codigo ?? '').trim();
  const pr = product.tabelas?.PR;
  const cost = pr?.preco == null ? Number.NaN : Number(pr.preco);
  const stock = pr?.estoque == null ? Number.NaN : Number(pr.estoque);
  if (!sku || !product.nome?.trim() || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(stock) || stock < 0) {
    throw new EvolusomApiError(`Produto Evolusom inválido: ${sku || 'sem código'}`);
  }
  return {
    produtoid: sku,
    produtoid_empresa: sku,
    fornecedorid: 133,
    titulo: product.nome.trim(),
    preco_normal: cost,
    preco_crossdocking: cost,
    estoque: Math.trunc(stock),
    ean11: product.cod_ean || undefined,
    ncm: product.ncm || undefined,
    marca: product.marca || undefined,
    peso: Number(product.peso || 0),
    largura: Number(product.largura || 0),
    altura: Number(product.altura || 0),
    profundidade: Number(product.comprimento || 0),
    origem: product.origem || undefined,
    descricao: [product.descricao?.descricao, product.descricao?.especificacao].filter(Boolean).join('\n\n'),
    categoria_nome: product.categorias?.[0]?.nome || undefined,
    link_imagem: product.imagens?.[0] || undefined,
    midias: (product.imagens || []).map((url, index) => ({ tipo: 'imagem', indice: String(index), valor: url })),
    ipi: Number(pr?.ipi || 0),
  };
}
