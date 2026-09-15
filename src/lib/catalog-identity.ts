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
  if (/\bbiv(?:olt)?\b/.test(text)
    || /\b(?:110|115|120|127)\s*[\/-]\s*(?:220|230|240)\s*v\b/.test(text)) return 'bivolt';
  return single(Array.from(text.matchAll(/\b(110|115|120|127|220|230|240)\s*v\b/g))
    .map(match => ['110','115','120','127'].includes(match[1]) ? 'low_voltage' : `${match[1]}v`));
}

function dimension(value: unknown) {
  const text = clean(value);
  const ranges = Array.from(text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(?:-|a)\s*(\d+(?:[.,]\d+)?)\s*(?:"|pol(?:egadas?)?)(?=$|[^a-z0-9])/g))
    .map(match => `inch_range:${Number(match[1].replace(',', '.'))}-${Number(match[2].replace(',', '.'))}`);
  const inches = Array.from(text.matchAll(/\b(\d+(?:[.,]\d+)?)(?:[-\s](\d+)\/(\d+))?\s*(?:"|pol(?:egadas?)?)(?=$|[^a-z0-9])/g))
    .map(match => `inch:${Number(match[1].replace(',', '.')) + (match[2] ? Number(match[2]) / Number(match[3]) : 0)}`);
  const compound = Array.from(text.matchAll(
    /\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)\b/g,
  )).map(match => `compound:${[match[1], match[2], match[3]].filter(Boolean)
    .map(entry => Number(String(entry).replace(',', '.'))).join('x')}${match[4]}`);
  return single([...ranges, ...inches, ...compound]);
}

function color(value: unknown) {
  const text = clean(value);
  const colors = ['preto','branco','azul','vermelho','verde','amarelo','cinza','prata','dourado','rosa','roxo','laranja','marrom'];
  return single(colors.filter(candidate => new RegExp(`\\b${candidate}\\b`).test(text)));
}

function length(value: unknown) {
  const text = clean(value);
  if (!/\b(cabo|rolo|fio|mangueira|extensao|adaptador)\b/.test(text)) return null;
  const values = Array.from(text.matchAll(/(?<![\d.,x×])(\d+(?:[.,]\d+)?)\s*(cm|m|mt|metros?)\b/g)).map(match => {
    const number = Number(match[1].replace(',', '.'));
    const meters = number * (match[2] === 'cm' ? 0.01 : 1);
    return String(Number(meters.toFixed(6)));
  });
  return single(values);
}

function packQuantity(value: unknown) {
  const text = clean(value);
  const matches = Array.from(text.matchAll(
    /(?:^|\b)(\d{1,4})\s*(?:un(?:idades?)?|pilhas?|baterias?|pecas?|pcs?|pares?|tubos?)\b|\b(?:kit|pack|combo|caixa|cartela|blister|pacote)\s*(?:com|de|c\/)?\s*(\d{1,4})\b/g,
  )).map(match => Number(match[1] || match[2])).filter(value => value > 0);
  const result = single(matches.map(String));
  return result ? Number(result) : null;
}

function family(value: unknown) {
  const text = clean(value);
  if (/\bglobo\b.*\bmicrofone\b|\bmicrofone\b.*\bglobo\b/.test(text)) return 'globo_microfone';
  if (/\bssd\b|solid state/.test(text)) return 'ssd';
  if (/\broteador\b|\brouter\b/.test(text)) return 'roteador';
  if (/\bsuporte\b|\bpedestal\b|\bestante\b/.test(text)) return null;
  if (/\bpilha\b|\bbateria\b/.test(text)) return 'bateria';
  if (/\bdesengripante\b|\blubrificante\b/.test(text)) return 'lubrificante';
  if (/\b(?:cabo|fio)\s+(?:(?:para|de|p\/?)\s+)?microfone\b|\brolo\b.*\b(?:cabo|fio)\b|\b(?:cabo|fio)\b.*\brolo\b/.test(text)) return 'cabo_adaptador';
  if (/\bmicrofone\b/.test(text)) return 'microfone';
  if (/\bcabo\b|\bfio\b|\badaptador\b/.test(text)) return 'cabo_adaptador';
  return null;
}

function modelTokens(value: unknown) {
  const excluded = new Set(['AAA','AA','A23','A27']);
  const source = String(value ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const words = Array.from(source.matchAll(/\b[A-Z0-9-]+\b/g)).map(match => match[0]);
  const direct = words
    .filter(token => /[A-Z]/.test(token) && /\d/.test(token))
    .map(token => token.replace(/-/g, ''));
  const measurementUnits = new Set(['GB','TB','MB','KB','V','W','A','G','KG','ML','L','M','CM','MM']);
  const joined = Array.from(source.matchAll(/\b([A-Z]{2,3})\s+(\d[A-Z0-9]*)\b/g)).flatMap(match => {
    const prefix = match[1];
    const next = match[2];
    const suffix = source.slice((match.index || 0) + match[0].length).trimStart();
    const measurement = /^\d+(?:GB|TB|MB|KB|V|W|A|G|KG|ML|L|M|CM|MM)$/.test(next)
      || (/^\d+$/.test(next) && measurementUnits.has(suffix.match(/^([A-Z]+)/)?.[1] || ''));
    const formFactor = /^\d+$/.test(next) && /^(?:EM|X)\s+\d+\b/.test(suffix);
    return next.length <= 10 && !measurement && !formFactor ? [`${prefix}${next}`] : [];
  });
  const modelSuffixes = new Set(['PLUS','PRO','TC','ID','IN','RD','BK']);
  const joinedSuffix = words.slice(0, -1).flatMap((token, index) => {
    const base = token.replace(/-/g, '');
    const suffix = words[index + 1].replace(/-/g, '');
    return /[A-Z]/.test(base) && /\d/.test(base) && modelSuffixes.has(suffix) ? [`${base}${suffix}`] : [];
  });
  const candidates = unique([...direct, ...joined, ...joinedSuffix]).filter(token =>
    !excluded.has(token)
    && !/^VTK\d+$/.test(token)
    && !/^(?:SATA|USB|HDMI|WIFI|BLUETOOTH|BT|RJ|XLR|CAT|COM|COR|PAR|PRO|SEM|KIT|KITS|PACK|PCT|CAIXA|CABO|ROLO|FIO|DICA|DIN|HS|LED|AZUL|PRETO|BRANCO)\d+[A-Z]*$/.test(token)
    && !/^(?:\d+(?:GB|TB|MB|KB|V|VA|W|WRMS|RMS|A|G|KG|ML|L|M|CM|MM|MS|HZ|OHMS|R|P)|V\d+|HD\d+HZ)$/.test(token));
  return candidates.filter(candidate => !candidates.some(other =>
    other !== candidate && other.length > candidate.length && other.endsWith(candidate)));
}

function explicitModelTokens(source: any): string[] {
  const attributes = Array.isArray(source?.attributes) ? source.attributes : [];
  return unique<string>(attributes
    .filter((attribute: any) => String(attribute?.id || '').toUpperCase() === 'MODEL')
    .flatMap((attribute: any) => [attribute?.value_name,
      ...(Array.isArray(attribute?.values) ? attribute.values.map((value: any) => value?.name) : [])])
    .map((value: unknown) => identifier(value))
    .filter((value: string) => value.length >= 3 && /[a-z]/.test(value) && /\d/.test(value))
    .map((value: string) => value.toUpperCase()));
}

function modelEquivalent(left: string, right: string) {
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length >= 4 && (longer.endsWith(shorter) || longer.startsWith(shorter))) return true;
  const signature = (model: string) => ({
    alpha: model.replace(/[^A-Z]/g, ''),
    numeric: model.replace(/\D/g, ''),
  });
  const leftSignature = signature(left);
  const rightSignature = signature(right);
  return leftSignature.alpha.length >= 2 && leftSignature.alpha === rightSignature.alpha
    && Math.min(leftSignature.numeric.length, rightSignature.numeric.length) >= 2
    && (leftSignature.numeric.endsWith(rightSignature.numeric)
      || rightSignature.numeric.endsWith(leftSignature.numeric));
}

function namedSeriesModel(value: unknown) {
  const text = clean(value).toUpperCase();
  return text.match(/\bARCHER(?:\s+WI-?FI)?\s+([A-Z]+\d+)\b/)?.[1] || null;
}

function strongModelConflict(localModels: string[], remoteModels: string[]) {
  const signature = (model: string) => ({
    alpha: model.replace(/[^A-Z]/g, ''),
    numeric: model.replace(/\D/g, ''),
  });
  return localModels.some(local => remoteModels.some(remote => {
    const left = signature(local);
    const right = signature(remote);
    return left.alpha.length >= 2 && left.alpha === right.alpha
      && left.numeric.length >= 1 && right.numeric.length >= 1
      && left.numeric !== right.numeric;
  }));
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

function compareRemoteValues(
  field: string,
  local: string | number | null,
  remoteValues: Array<string | number | null>,
): CatalogIdentityComparison | null {
  const remotes = unique(remoteValues.filter((value): value is string | number => value != null).map(String));
  if (local == null && !remotes.length) return null;
  if (local == null || !remotes.length) {
    return {
      field,
      local: local == null ? null : String(local),
      remote: remotes.length ? remotes.join(' | ') : null,
      status: 'missing',
      reason: 'EVIDENCIA_PARCIAL',
    };
  }
  const matches = remotes.every(remote => remote === String(local));
  return {
    field,
    local: String(local),
    remote: remotes.join(' | '),
    status: matches ? 'match' : 'conflict',
    reason: matches ? 'COERENTE' : `${field}_DIVERGENTE`,
  };
}

function compareDimensions(local: string | null, remoteValues: Array<string | null>): CatalogIdentityComparison | null {
  const remotes = unique(remoteValues.filter((value): value is string => Boolean(value)));
  if (local == null && !remotes.length) return null;
  if (local == null || !remotes.length) return compareRemoteValues('DIMENSION', local, remotes);
  const kind = local.split(':', 1)[0];
  const comparable = remotes.filter(remote => remote.split(':', 1)[0] === kind);
  if (!comparable.length) {
    return { field: 'DIMENSION', local, remote: remotes.join(' | '), status: 'missing', reason: 'DIMENSOES_NAO_COMPARAVEIS' };
  }
  if (kind === 'inch') {
    const localInches = Number(local.slice('inch:'.length));
    const matches = comparable.every(remote => Math.abs(localInches - Number(remote.slice('inch:'.length))) < 1);
    return {
      field: 'DIMENSION', local, remote: comparable.join(' | '), status: matches ? 'match' : 'conflict',
      reason: matches ? 'COERENTE' : 'DIMENSION_DIVERGENTE',
    };
  }
  return compareRemoteValues('DIMENSION', local, comparable);
}

function compareLengths(local: string | null, remoteValues: Array<string | null>): CatalogIdentityComparison | null {
  const remotes = unique(remoteValues.filter((value): value is string => Boolean(value)));
  if (local == null && !remotes.length) return null;
  if (local == null || !remotes.length) return compareRemoteValues('LENGTH', local, remotes);
  const localMeters = Number(local);
  const matches = remotes.every(remote => {
    const remoteMeters = Number(remote);
    return Number.isFinite(remoteMeters)
      && Math.abs(localMeters - remoteMeters) <= Math.max(0.02, localMeters * 0.02);
  });
  return {
    field: 'LENGTH',
    local,
    remote: remotes.join(' | '),
    status: matches ? 'match' : 'conflict',
    reason: matches ? 'COERENTE' : 'LENGTH_DIVERGENTE',
  };
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
  const localText = [input.localProduct?.nome].filter(Boolean).join(' ');
  const remoteTexts = [
    unique([input.item?.title, input.item?.name].filter(Boolean)).join(' '),
    unique([input.catalogProduct?.title, input.catalogProduct?.name].filter(Boolean)).join(' '),
  ].filter(Boolean);
  const compareText = (field: string, extractor: (value: unknown) => string | number | null) =>
    compareRemoteValues(field, extractor(localText), remoteTexts.map(extractor));
  const comparisons = [
    compareText('BATTERY_TYPE', batteryType),
    compareText('CAPACITY', storageCapacity),
    compareText('PACK_QUANTITY', packQuantity),
    compareLengths(length(localText), remoteTexts.map(length)),
    compareDimensions(dimension(localText), remoteTexts.map(dimension)),
    compareText('VOLTAGE', voltage),
    compareText('COLOR_VARIANT', color),
    compareText('PRODUCT_FAMILY', family),
    compareRemoteValues('GTIN', gtin(input.localProduct), [gtin(input.item), gtin(input.catalogProduct)]),
    compareRemoteValues('BRAND', brand(input.localProduct), [brand(input.item), brand(input.catalogProduct)]),
    compareValue('SELLER_SKU', sellerSku(input.localProduct), sellerSku(input.relatedListing || input.item)),
  ].filter((row): row is CatalogIdentityComparison => Boolean(row));
  const localModels = modelTokens(localText);
  const explicitRemoteModels = unique([
    ...explicitModelTokens(input.item),
    ...explicitModelTokens(input.catalogProduct),
  ]);
  const remoteModels = unique([...remoteTexts.flatMap(modelTokens), ...explicitRemoteModels]);
  let inconclusiveModelDivergence = false;
  if (localModels.length && remoteModels.length) {
    const overlap = localModels.some(local => remoteModels.some(remoteModel => modelEquivalent(local, remoteModel)));
    const localSeriesModel = namedSeriesModel(localText);
    const remoteSeriesModels = unique(remoteTexts.map(namedSeriesModel).filter((value): value is string => Boolean(value)));
    const namedSeriesConflict = Boolean(localSeriesModel && remoteSeriesModels.length
      && remoteSeriesModels.every(remoteModel => !modelEquivalent(localSeriesModel, remoteModel)));
    const confirmedConflict = !overlap && (strongModelConflict(localModels, remoteModels) || namedSeriesConflict);
    inconclusiveModelDivergence = !overlap && !confirmedConflict;
    comparisons.push({
      field: 'MODEL',
      local: localModels.join(' | '),
      remote: remoteModels.join(' | '),
      status: overlap ? 'match' : confirmedConflict ? 'conflict' : 'missing',
      reason: overlap ? 'COERENTE' : confirmedConflict ? 'MODEL_DIVERGENTE' : 'DIVERGENCIA_MODELO_NAO_CONCLUSIVA',
    });
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
  } else if (inconclusiveModelDivergence) {
    identityState = 'PENDENCIA_VALIDACAO'; reasonCode = 'DIVERGENCIA_MODELO_NAO_CONCLUSIVA';
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
