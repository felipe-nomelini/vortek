type ResearchSource = {
  title: string;
  url: string;
  content: string;
  trusted: boolean;
};

export type ProductAttributeResearchResult = {
  searched: boolean;
  summary: string;
  sourceUrls: string[];
  confidenceHint: number;
};

type ResearchInput = {
  produto: Record<string, any>;
  field: { id: string; name: string };
  categoriaId?: string;
  supplierSkus?: string[];
  supplierEvidence?: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: ProductAttributeResearchResult }>();

function normalize(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isMarketplaceHost(host: string): boolean {
  return [
    'mercadolivre.com.br',
    'mercadolibre.com',
    'shopee.com.br',
    'amazon.com.br',
    'magazineluiza.com.br',
    'americanas.com.br',
  ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function isTrustedHost(host: string, brand?: string): boolean {
  if (!host) return false;
  const brandToken = normalize(brand).toLowerCase().replace(/[^a-z0-9]/g, '');
  const hostToken = host.replace(/[^a-z0-9]/g, '');
  if (brandToken && brandToken.length >= 2 && hostToken.includes(brandToken)) return true;
  return !isMarketplaceHost(host);
}

function compactText(value: unknown, max = 900): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function buildQuery(input: ResearchInput): string {
  const produto = input.produto || {};
  const parts = [
    normalize(produto.marca),
    normalize(produto.nome),
    normalize(produto.gtin),
    ...(input.supplierSkus || []).slice(0, 3),
    normalize(input.supplierEvidence).slice(0, 120),
    normalize(input.field.name),
  ].filter(Boolean);

  return [
    parts.join(' '),
    '-site:mercadolivre.com.br',
    '-site:mercadolibre.com',
    '-site:shopee.com.br',
  ].join(' ');
}

function normalizeFirecrawlRows(payload: any, brand?: string): ResearchSource[] {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.results)
      ? payload.results
      : [];

  return rows
    .map((row: any) => {
      const url = String(row?.url || row?.metadata?.sourceURL || '').trim();
      const host = normalizeHost(url);
      return {
        title: compactText(row?.title || row?.metadata?.title || '', 160),
        url,
        content: compactText(row?.description || row?.markdown || row?.content || row?.summary || '', 1000),
        trusted: isTrustedHost(host, brand),
      };
    })
    .filter((row: ResearchSource) => row.url && (row.title || row.content))
    .sort((a: ResearchSource, b: ResearchSource) => Number(b.trusted) - Number(a.trusted))
    .slice(0, 3);
}

export async function researchProductAttribute(input: ResearchInput): Promise<ProductAttributeResearchResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { searched: false, summary: '', sourceUrls: [], confidenceHint: 0 };
  }

  const cacheKey = JSON.stringify({
    produtoId: input.produto?.id,
    fieldId: input.field.id,
    name: input.produto?.nome,
    gtin: input.produto?.gtin,
    supplierEvidence: input.supplierEvidence?.slice(0, 80),
  });
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  try {
    const response = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: buildQuery(input),
        limit: 3,
        scrapeOptions: {
          formats: [{ type: 'markdown' }],
          onlyMainContent: true,
          timeout: 8000,
        },
      }),
    });

    if (!response.ok) {
      return { searched: true, summary: '', sourceUrls: [], confidenceHint: 0 };
    }

    const payload = await response.json();
    const rows = normalizeFirecrawlRows(payload, input.produto?.marca);
    const sourceUrls = rows.map((row) => row.url);
    const summary = rows
      .map((row, index) => `[${index + 1}] ${row.title}\nURL: ${row.url}\n${row.content}`)
      .join('\n\n')
      .slice(0, 3500);
    const result = {
      searched: true,
      summary,
      sourceUrls,
      confidenceHint: rows.some((row) => row.trusted) ? 0.75 : rows.length ? 0.55 : 0,
    };

    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  } catch {
    return { searched: true, summary: '', sourceUrls: [], confidenceHint: 0 };
  }
}
