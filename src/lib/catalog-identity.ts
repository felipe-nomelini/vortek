import { createHash } from 'node:crypto';

export const CATALOG_IDENTITY_RULE_VERSION = 'BNT-ML-CATALOG-IDENTITY-01/v1';

export type CatalogIdentityState =
  | 'SEM_CONFLITO'
  | 'CONFLITO_CONFIRMADO'
  | 'PENDENCIA_VALIDACAO'
  | 'INCONCLUSIVO';
export type CatalogIdentityRisk = 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAIXO';
export type CatalogIdentityComparison = {
  field: string;
  local: string | null;
  remote: string | null;
  status: 'match' | 'conflict' | 'missing';
  reason: string;
};

const clean = (value: unknown) => String(value ?? '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const identifier = (value: unknown) => clean(value).replace(/[^a-z0-9]/g, '');

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function single(values: string[]) {
  const distinct = unique(values.filter(Boolean));
  return distinct.length === 1 ? distinct[0] : null;
}

export function catalogIdentityFingerprint(value: unknown) {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .filter(([key]) => !['observed_at','synced_at','updated_at','last_updated','last_updated_ml'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stable(entry)]));
  };
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function batteryType(value: unknown) {
  const text = ` ${clean(value).toUpperCase()} `;
  return single(Array.from(text.matchAll(/(?:^|[^A-Z0-9])(AAA|AA|A27|A23)(?=$|[^A-Z0-9])/g)).map(match => match[1]));
}

function storageCapacity(value: unknown) {
  const factors: Record<string, number> = { KB: 1, MB: 1024, GB: 1024 ** 2, TB: 1024 ** 3 };
  const values = Array.from(clean(value).toUpperCase().matchAll(/\b(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|TB)\b/g))
    .map(match => `${Math.round(Number(match[1].replace(',', '.')) * factors[match[2]])}KB`);
  return single(values);
}

function voltage(value: unknown) {
  const text = clean(value);
  if (/\bbivolt\b/.test(text)) return 'bivolt';
  return single(Array.from(text.matchAll(/\b(110|115|120|127|220|230|240)\s*v\b/g)).map(match => `${match[1]}v`));
}

function dimension(value: unknown) {
  const text = clean(value);
  const inches = Array.from(text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:"|pol(?:egadas?)?)(?=$|[^a-z0-9])/g))
    .map(match => `${Number(match[1].replace(',', '.'))}in`);
  const compound = Array.from(text.matchAll(
    /\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)\b/g,
  )).map(match => `${[match[1], match[2], match[3]].filter(Boolean)
    .map(entry => Number(String(entry).replace(',', '.'))).join('x')}${match[4]}`);
  return single([...inches, ...compound]);
}

function color(value: unknown) {
  const text = clean(value);
  const colors = ['preto','branco','azul','vermelho','verde','amarelo','cinza','prata','dourado','rosa','roxo','laranja','marrom'];
  return single(colors.filter(candidate => new RegExp(`\\b${candidate}\\b`).test(text)));
}

function length(value: unknown) {
  const text = clean(value);
  if (!/\b(cabo|rolo|fio|mangueira|extensao|adaptador)\b/.test(text)) return null;
  const values = Array.from(text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/g)).map(match => {
    const number = Number(match[1].replace(',', '.'));
    const meters = number * ({ mm: 0.001, cm: 0.01, m: 1 } as const)[match[2] as 'mm' | 'cm' | 'm'];
    return `${Number(meters.toFixed(6))}m`;
  });
  return single(values);
}

function packQuantity(value: unknown) {
  const text = clean(value);
  const matches = Array.from(text.matchAll(
    /(?:^|\b)(\d{1,4})\s*(?:un(?:idades?)?|pilhas?|baterias?|pecas?|pcs?|pares?)\b|\b(?:kit|pack|combo|caixa|cartela|blister|pacote)\s*(?:com|de|c\/)?\s*(\d{1,4})\b/g,
  )).map(match => Number(match[1] || match[2])).filter(value => value > 0);
  const result = single(matches.map(String));
  return result ? Number(result) : null;
}

function family(value: unknown) {
  const text = clean(value);
  if (/\bglobo\b.*\bmicrofone\b|\bmicrofone\b.*\bglobo\b/.test(text)) return 'globo_microfone';
  if (/\bmicrofone\b/.test(text)) return 'microfone';
  if (/\bssd\b|solid state/.test(text)) return 'ssd';
  if (/\broteador\b|\brouter\b/.test(text)) return 'roteador';
  if (/\bpilha\b|\bbateria\b/.test(text)) return 'bateria';
  if (/\bdesengripante\b|\blubrificante\b/.test(text)) return 'lubrificante';
  if (/\bcabo\b|\badaptador\b/.test(text)) return 'cabo_adaptador';
  return null;
}

function modelTokens(value: unknown) {
  const excluded = new Set(['AAA','AA','A23','A27']);
  return unique(Array.from(String(value ?? '').toUpperCase().matchAll(/\b(?=[A-Z0-9-]{3,}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/g))
    .map(match => match[0].replace(/-/g, ''))
    .filter(token => !excluded.has(token) && !/^(?:\d+(?:GB|TB|MB|KB|V|M|CM|MM)|V\d+)$/.test(token)));
}

function gtin(source: any) {
  const attrs = Array.isArray(source?.attributes) ? source.attributes : [];
  const raw = source?.gtin ?? attrs.find((attribute: any) => String(attribute?.id).toUpperCase() === 'GTIN')?.value_name;
  const digits = String(raw || '').replace(/\D/g, '');
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits) ? digits.padStart(14, '0') : null;
}

function brand(source: any) {
  const attrs = Array.isArray(source?.attributes) ? source.attributes : [];
  const raw = source?.marca ?? attrs.find((attribute: any) => String(attribute?.id).toUpperCase() === 'BRAND')?.value_name;
  return identifier(raw) || null;
}

function sellerSku(source: any) {
  const attrs = Array.isArray(source?.attributes) ? source.attributes : [];
  return identifier(source?.sku ?? source?.seller_sku ?? source?.seller_custom_field
    ?? attrs.find((attribute: any) => String(attribute?.id).toUpperCase() === 'SELLER_SKU')?.value_name) || null;
}

function attributeText(source: any) {
  if (!Array.isArray(source?.attributes)) return '';
  return source.attributes.flatMap((attribute: any) => [
    attribute?.name,
    attribute?.value_name,
    ...(Array.isArray(attribute?.values) ? attribute.values.map((value: any) => value?.name) : []),
  ]).filter(Boolean).join(' ');
}

function compareValue(field: string, local: string | number | null, remote: string | number | null): CatalogIdentityComparison | null {
  if (local == null && remote == null) return null;
  if (local == null || remote == null) return { field, local: local == null ? null : String(local), remote: remote == null ? null : String(remote), status: 'missing', reason: 'EVIDENCIA_PARCIAL' };
  const matches = String(local) === String(remote);
  return { field, local: String(local), remote: String(remote), status: matches ? 'match' : 'conflict', reason: matches ? 'COERENTE' : `${field}_DIVERGENTE` };
}

export function assessCatalogIdentity(input: {
  item: any | null;
  catalogProduct: any | null;
  localProduct: any | null;
  relatedListing?: any | null;
  localOwners?: string[];
  priceToWin?: number | null;
  currentPrice?: number | null;
  liveAvailable: boolean;
}) {
  const remote = input.catalogProduct || input.item;
  const localText = [input.localProduct?.nome, input.localProduct?.descricao, attributeText(input.localProduct)].filter(Boolean).join(' ');
  const remoteText = [remote?.name, remote?.title, input.item?.title,
    attributeText(remote), attributeText(input.item)].filter(Boolean).join(' ');
  const comparisons = [
    compareValue('BATTERY_TYPE', batteryType(localText), batteryType(remoteText)),
    compareValue('CAPACITY', storageCapacity(localText), storageCapacity(remoteText)),
    compareValue('PACK_QUANTITY', packQuantity(localText), packQuantity(remoteText)),
    compareValue('LENGTH', length(localText), length(remoteText)),
    compareValue('DIMENSION', dimension(localText), dimension(remoteText)),
    compareValue('VOLTAGE', voltage(localText), voltage(remoteText)),
    compareValue('COLOR_VARIANT', color(localText), color(remoteText)),
    compareValue('PRODUCT_FAMILY', family(localText), family(remoteText)),
    compareValue('GTIN', gtin(input.localProduct), gtin(remote)),
    compareValue('BRAND', brand(input.localProduct), brand(remote)),
    compareValue('SELLER_SKU', sellerSku(input.localProduct), sellerSku(input.relatedListing || input.item)),
  ].filter((row): row is CatalogIdentityComparison => Boolean(row));
  const localModels = modelTokens(localText);
  const remoteModels = modelTokens(remoteText);
  if (localModels.length && remoteModels.length) {
    const overlap = localModels.some(model => remoteModels.includes(model));
    comparisons.push({ field: 'MODEL', local: localModels.join(' | '), remote: remoteModels.join(' | '), status: overlap ? 'match' : 'conflict', reason: overlap ? 'COERENTE' : 'MODEL_DIVERGENTE' });
  }
  const owners = unique((input.localOwners || []).filter(Boolean));
  if (owners.length > 1) comparisons.push({ field: 'LOCAL_OWNER', local: owners.join(' | '), remote: null, status: 'conflict', reason: 'PROPRIETARIOS_LOCAIS_DIVERGENTES' });

  const decisiveFields = new Set(['BATTERY_TYPE','CAPACITY','PACK_QUANTITY','LENGTH','DIMENSION','VOLTAGE','PRODUCT_FAMILY','MODEL','LOCAL_OWNER']);
  const conflicts = comparisons.filter(row => row.status === 'conflict' && decisiveFields.has(row.field));
  const gapPct = input.currentPrice && input.priceToWin && input.currentPrice > 0
    ? Number((((input.currentPrice - input.priceToWin) / input.currentPrice) * 100).toFixed(4)) : null;
  let identityState: CatalogIdentityState;
  let reasonCode: string;
  if (!input.liveAvailable || !input.item || !remote) {
    identityState = 'INCONCLUSIVO'; reasonCode = 'INCONCLUSIVO_FONTE_ML_INDISPONIVEL';
  } else if (!input.localProduct) {
    identityState = 'PENDENCIA_VALIDACAO'; reasonCode = 'PRODUTO_LOCAL_NAO_IDENTIFICADO';
  } else if (conflicts.length) {
    identityState = 'CONFLITO_CONFIRMADO'; reasonCode = conflicts.map(row => row.reason).join(',');
  } else {
    const skuMatch = comparisons.some(row => row.field === 'SELLER_SKU' && row.status === 'match');
    const gtinMatch = comparisons.some(row => row.field === 'GTIN' && row.status === 'match');
    const brandMatch = comparisons.some(row => row.field === 'BRAND' && row.status === 'match');
    const modelMatch = comparisons.some(row => row.field === 'MODEL' && row.status === 'match');
    const materialMatch = comparisons.some(row => decisiveFields.has(row.field) && row.status === 'match');
    if (skuMatch && (gtinMatch || (brandMatch && modelMatch) || (brandMatch && materialMatch))) {
      identityState = 'SEM_CONFLITO'; reasonCode = 'IDENTIDADE_COHERENTE_COM_DUAS_ANCORAS';
    } else {
      identityState = 'PENDENCIA_VALIDACAO'; reasonCode = 'EVIDENCIA_IDENTIDADE_INSUFICIENTE';
    }
  }
  const riskTier: CatalogIdentityRisk = identityState === 'CONFLITO_CONFIRMADO' && (gapPct ?? 0) >= 60 ? 'CRITICO'
    : identityState === 'CONFLITO_CONFIRMADO' || (gapPct ?? 0) >= 40 ? 'ALTO'
      : (gapPct ?? 0) >= 20 ? 'MEDIO' : 'BAIXO';
  return {
    identityState,
    reasonCode,
    conflictType: conflicts.map(row => row.field).join(',') || null,
    comparisons,
    gapPct,
    riskTier,
    blockPriceWrite: identityState !== 'SEM_CONFLITO',
    blockBuyBoxChase: identityState !== 'SEM_CONFLITO',
  };
}
