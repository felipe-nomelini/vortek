export type StockNfeItem = {
  numeroItem: number;
  codigoFornecedor: string | null;
  gtin: string | null;
  descricao: string;
  quantidade: number;
};

export type StockNfe = {
  chave: string;
  tipoAmbiente: 1 | 2;
  numero: string | null;
  serie: string | null;
  emitenteCnpj: string;
  emitenteNome: string;
  destinatarioCnpj: string;
  emitidaEm: string | null;
  valorTotal: number;
  itens: StockNfeItem[];
  xml: string;
};

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tag(xml: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<(?:[\\w-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escaped}>`, 'i'));
  return match?.[1] ? decodeXml(match[1]) : null;
}

function section(xml: string, name: string): string | null {
  return tag(xml, name);
}

export function extractNfeAccessKey(value: unknown): string | null {
  const candidates = String(value || '').match(/\d(?:[\s.-]*\d){43}/g) || [];
  for (const candidate of candidates) {
    const normalized = digits(candidate);
    if (normalized.length === 44 && isValidNfeAccessKey(normalized)) return normalized;
  }
  const normalized = digits(value);
  return normalized.length === 44 && isValidNfeAccessKey(normalized) ? normalized : null;
}

export function isValidNfeAccessKey(value: unknown): boolean {
  const chave = digits(value);
  if (!/^\d{44}$/.test(chave)) return false;
  let weight = 2;
  let sum = 0;
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(chave[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return digit === Number(chave[43]);
}

export function parseAuthorizedStockNfeXml(input: {
  xml: string;
  expectedKey: string;
  expectedEnvironment: 1 | 2;
  expectedRecipientCnpj: string;
}): StockNfe {
  const xml = String(input.xml || '').trim();
  if (!xml || !/<(?:[\w-]+:)?nfeProc\b/i.test(xml)) {
    throw new Error('O arquivo não contém uma NF-e processada (nfeProc).');
  }

  const chave = digits(tag(xml, 'chNFe'));
  if (!isValidNfeAccessKey(chave) || chave !== input.expectedKey) {
    throw new Error('A chave do XML não corresponde à NF-e informada.');
  }

  if (tag(xml, 'cStat') !== '100') {
    throw new Error('A NF-e ainda não está autorizada pela SEFAZ.');
  }

  const tipoAmbiente = Number(tag(xml, 'tpAmb'));
  if (tipoAmbiente !== input.expectedEnvironment) {
    throw new Error('A NF-e pertence a outro ambiente fiscal.');
  }

  const emit = section(xml, 'emit') || '';
  const dest = section(xml, 'dest') || '';
  const emitenteCnpj = digits(tag(emit, 'CNPJ'));
  const destinatarioCnpj = digits(tag(dest, 'CNPJ'));
  if (destinatarioCnpj !== digits(input.expectedRecipientCnpj)) {
    throw new Error('O CNPJ destinatário da NF-e não pertence à empresa configurada.');
  }
  if (emitenteCnpj.length !== 14) throw new Error('CNPJ do fornecedor inválido no XML.');

  const itemMatches = [...xml.matchAll(/<(?:[\w-]+:)?det\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?det>/gi)];
  const itens = itemMatches.map((match, index): StockNfeItem => {
    const attributes = match[1] || '';
    const body = match[2] || '';
    const prod = section(body, 'prod') || body;
    const numeroItem = Number(attributes.match(/\bnItem=["'](\d+)["']/i)?.[1] || index + 1);
    const quantidadeRaw = Number(tag(prod, 'qCom'));
    if (!Number.isInteger(quantidadeRaw) || quantidadeRaw <= 0) {
      throw new Error(`O item ${numeroItem} possui quantidade fracionada ou inválida.`);
    }
    const descricao = tag(prod, 'xProd') || '';
    if (!descricao) throw new Error(`O item ${numeroItem} não possui descrição.`);
    const rawGtin = tag(prod, 'cEAN');
    const gtin = rawGtin && !/^SEM GTIN$/i.test(rawGtin) ? digits(rawGtin) : null;
    return {
      numeroItem,
      codigoFornecedor: tag(prod, 'cProd'),
      gtin: gtin || null,
      descricao,
      quantidade: quantidadeRaw,
    };
  });
  if (itens.length === 0) throw new Error('A NF-e não possui itens para recebimento.');

  const total = section(xml, 'ICMSTot') || xml;
  const valorTotal = Number(tag(total, 'vNF') || 0);
  return {
    chave,
    tipoAmbiente: tipoAmbiente as 1 | 2,
    numero: tag(xml, 'nNF'),
    serie: tag(xml, 'serie'),
    emitenteCnpj,
    emitenteNome: tag(emit, 'xNome') || 'Fornecedor não informado',
    destinatarioCnpj,
    emitidaEm: tag(xml, 'dhEmi') || tag(xml, 'dEmi'),
    valorTotal: Number.isFinite(valorTotal) ? valorTotal : 0,
    itens,
    xml,
  };
}
