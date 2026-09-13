import "server-only";

import {
  BVF_FAMILY_ATTRIBUTE_KEYS,
  bvfFamilyResearchSnapshotSchema,
  type BvfFamilyAttributeKey,
  type BvfFamilyResearchFact,
  type BvfFamilyResearchSnapshot,
} from "@/lib/video-factory/contracts";

export type BvfFamilyResearchInput = {
  productId: string;
  name: string;
  brand: string | null;
  gtin: string | null;
  supplierSkus: string[];
  missingFields: BvfFamilyAttributeKey[];
  signal?: AbortSignal;
};

type SearchCandidate = { url: string; trusted: boolean };

const CACHE_TTL_MS = 10 * 60 * 1_000;
const cache = new Map<
  string,
  { expiresAt: number; value: BvfFamilyResearchSnapshot }
>();

function clean(value: unknown, max = 1_000): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function marketplace(host: string): boolean {
  return [
    "mercadolivre.com.br",
    "mercadolivre.com",
    "shopee.com.br",
    "amazon.com.br",
    "magazineluiza.com.br",
    "americanas.com.br",
  ].some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function trustedHost(host: string, brand: string | null): boolean {
  const brandToken = clean(brand)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const hostToken = host.replace(/[^a-z0-9]/g, "");
  return Boolean(host && brandToken.length >= 2 && hostToken.includes(brandToken));
}

function candidates(payload: any, brand: string | null): SearchCandidate[] {
  const rows = [
    ...(Array.isArray(payload?.data?.web) ? payload.data.web : []),
    ...(Array.isArray(payload?.web) ? payload.web : []),
    ...(Array.isArray(payload?.data) ? payload.data : []),
    ...(Array.isArray(payload?.results) ? payload.results : []),
  ];
  const seen = new Set<string>();
  return rows
    .map((row: any) => {
      const url = clean(row?.url || row?.metadata?.sourceURL || row?.metadata?.url);
      const host = hostOf(url);
      return { url, trusted: trustedHost(host, brand) };
    })
    .filter((row: SearchCandidate) => {
      if (!row.url.startsWith("https://") || marketplace(hostOf(row.url))) return false;
      if (seen.has(row.url)) return false;
      seen.add(row.url);
      return true;
    })
    .sort((left, right) => Number(right.trusted) - Number(left.trusted))
    .slice(0, 2);
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function buildQuery(input: BvfFamilyResearchInput): string {
  const labels: Record<BvfFamilyAttributeKey, string> = {
    brand: "marca",
    category: "categoria",
    model: "modelo",
    voltage: "tensão voltagem",
    color: "cor",
    size: "tamanho medida",
    quantity: "quantidade unidades",
    kit: "kit conteúdo",
    capacity: "capacidade",
    power: "potência",
    finish: "acabamento",
    width_cm: "largura física",
    height_cm: "altura física",
    depth_cm: "profundidade física",
    weight_g: "peso líquido",
  };
  return [
    clean(input.brand, 100),
    clean(input.name, 250),
    clean(input.gtin, 100),
    ...input.supplierSkus.slice(0, 3).map((sku) => clean(sku, 100)),
    input.missingFields.map((key) => labels[key]).join(" "),
    "ficha técnica manual especificações",
    "-site:mercadolivre.com.br -site:mercadolivre.com -site:shopee.com.br",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
}

function quoteExists(markdown: string, quote: string): boolean {
  const normalizedMarkdown = clean(markdown, 100_000).toLocaleLowerCase("pt-BR");
  const normalizedQuote = clean(quote, 1_000).toLocaleLowerCase("pt-BR");
  return normalizedQuote.length >= 3 && normalizedMarkdown.includes(normalizedQuote);
}

async function scrape(
  candidate: SearchCandidate,
  input: BvfFamilyResearchInput,
  apiKey: string,
): Promise<{ url: string; facts: BvfFamilyResearchFact[] } | null> {
  const response = await timedFetch(
    "https://api.firecrawl.dev/v2/scrape",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: candidate.url,
        onlyMainContent: true,
        formats: [
          { type: "markdown" },
          {
            type: "json",
            prompt:
              "Extract only explicitly stated product facts for the exact product. Copy a short supporting quote exactly. Do not infer, calculate, merge variants, or use package dimensions/weight.",
            schema: {
              type: "object",
              properties: {
                facts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string", enum: input.missingFields },
                      value: { type: "string" },
                      unit: { type: ["string", "null"] },
                      quote: { type: "string" },
                    },
                    required: ["key", "value", "unit", "quote"],
                  },
                },
              },
              required: ["facts"],
            },
          },
        ],
      }),
    },
    12_000,
    input.signal,
  );
  if (!response.ok) return null;
  const payload = await response.json();
  const markdown = String(payload?.data?.markdown ?? "");
  const extracted = payload?.data?.json?.facts;
  if (!markdown || !Array.isArray(extracted)) return null;

  const accepted = new Set(input.missingFields);
  const collectedAt = new Date().toISOString();
  const facts = extracted
    .map((fact: any) => ({
      key: clean(fact?.key, 30),
      value: clean(fact?.value, 500),
      unit: clean(fact?.unit, 40) || null,
      quote: clean(fact?.quote, 1_000),
      url: candidate.url,
      collectedAt,
    }))
    .filter(
      (fact: any) =>
        accepted.has(fact.key) && Boolean(fact.value) && quoteExists(markdown, fact.quote),
    )
    .flatMap((fact: any) => {
      const parsed = bvfFamilyResearchSnapshotSchema.shape.acceptedFacts.element.safeParse(fact);
      return parsed.success ? [parsed.data] : [];
    });
  return { url: candidate.url, facts };
}

export async function researchBvfFamilyMemberFacts(
  input: BvfFamilyResearchInput,
): Promise<BvfFamilyResearchSnapshot> {
  const missingFields = [...new Set(input.missingFields)].filter((field) =>
    BVF_FAMILY_ATTRIBUTE_KEYS.includes(field),
  );
  if (!missingFields.length) {
    return { status: "not_needed", searchedFields: [], sourceUrls: [], acceptedFacts: [] };
  }
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      status: "unavailable",
      searchedFields: missingFields,
      sourceUrls: [],
      acceptedFacts: [],
    };
  }
  const cacheKey = JSON.stringify({
    productId: input.productId,
    name: input.name,
    brand: input.brand,
    gtin: input.gtin,
    supplierSkus: input.supplierSkus.slice(0, 3),
    missingFields,
  });
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: BvfFamilyResearchSnapshot;
  try {
    const response = await timedFetch(
      "https://api.firecrawl.dev/v2/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: buildQuery(input), limit: 4, sources: ["web"] }),
      },
      10_000,
      input.signal,
    );
    if (!response.ok) throw new Error("BVF_FAMILY_FIRECRAWL_SEARCH_FAILED");
    const searchPayload = await response.json();
    const rows = candidates(searchPayload, input.brand);
    const scraped: Array<{ url: string; facts: BvfFamilyResearchFact[] }> = [];
    for (const candidate of rows) {
      const result = await scrape(candidate, input, apiKey);
      if (result) scraped.push(result);
    }
    const acceptedByKey = new Map<BvfFamilyAttributeKey, BvfFamilyResearchFact>();
    for (const result of scraped) {
      for (const fact of result.facts) {
        if (!acceptedByKey.has(fact.key)) acceptedByKey.set(fact.key, fact);
      }
    }
    value = bvfFamilyResearchSnapshotSchema.parse({
      status: acceptedByKey.size ? "completed" : "no_match",
      searchedFields: missingFields,
      sourceUrls: scraped.map((row) => row.url).slice(0, 4),
      acceptedFacts: [...acceptedByKey.values()],
    });
  } catch {
    value = {
      status: "unavailable",
      searchedFields: missingFields,
      sourceUrls: [],
      acceptedFacts: [],
    };
  }
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
