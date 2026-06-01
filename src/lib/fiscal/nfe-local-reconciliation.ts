const HOMOLOG_DEST_NAME_MARKER = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

type NfeAuthorizedSnapshotFields = {
  nfe_status?: string | null;
  nfe_xml?: string | null;
  nfe_chave?: string | null;
  nota_fiscal_numero?: string | null;
  nfe_protocolo?: string | null;
  nfe_cfop?: string | null;
};

export type XmlNfeProducaoValidation = {
  ok: boolean;
  tpAmb: string | null;
  destinatarioNome: string | null;
  marcadorHomologacao: boolean;
  message?: string;
};

export type NfeLocalReconciliationResult = {
  hasXml: boolean;
  xmlValidation: XmlNfeProducaoValidation | null;
  xmlAuthorizedProduction: boolean;
  xmlFields: {
    cStat: string | null;
    tpAmb: string | null;
    destinatarioNome: string | null;
    marcadorHomologacao: boolean;
    chNFe: string | null;
    nNF: string | null;
    nProt: string | null;
    CFOP: string | null;
  };
  statusAnterior: string | null;
  statusCorrigido: string | null;
  shouldUpdate: boolean;
  updates: Partial<{
    nfe_status: string;
    nfe_chave: string;
    nota_fiscal_numero: string;
    nfe_protocolo: string;
    nfe_cfop: string;
  }>;
};

function normalizeForCompare(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeStatus(value: string | null | undefined): string | null {
  const status = String(value || '').trim().toLowerCase();
  return status || null;
}

export function extractXmlTag(xml: string | null | undefined, tag: string): string | null {
  try {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(xml || '').match(new RegExp(`<${escaped}>([^<]+)</${escaped}>`));
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function extractDestinatarioNomeFromXml(xml: string | null | undefined): string | null {
  try {
    const match = String(xml || '').match(/<dest>[\s\S]*?<xNome>([^<]+)<\/xNome>/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function extractCfopFromXml(xml: string | null | undefined): string | null {
  return extractXmlTag(xml, 'CFOP');
}

export function validateXmlNfeProducao(xml: string | null | undefined): XmlNfeProducaoValidation {
  const tpAmb = extractXmlTag(xml, 'tpAmb');
  const destinatarioNome = extractDestinatarioNomeFromXml(xml);
  const marcadorHomologacao = normalizeForCompare(destinatarioNome).includes(normalizeForCompare(HOMOLOG_DEST_NAME_MARKER));

  if (tpAmb !== '1') {
    return {
      ok: false,
      tpAmb,
      destinatarioNome,
      marcadorHomologacao,
      message: 'NF-e em ambiente de homologação ou sem tpAmb=1. Emissão em produção é obrigatória.',
    };
  }

  if (marcadorHomologacao) {
    return {
      ok: false,
      tpAmb,
      destinatarioNome,
      marcadorHomologacao,
      message: 'NF-e com destinatário de homologação detectado no XML. Emissão em produção com dados reais é obrigatória.',
    };
  }

  return {
    ok: true,
    tpAmb,
    destinatarioNome,
    marcadorHomologacao,
  };
}

export function reconcileLocalNfeSnapshotFromXml(input: NfeAuthorizedSnapshotFields): NfeLocalReconciliationResult {
  const xml = normalizeNullableText(input.nfe_xml);
  const statusAnterior = normalizeStatus(input.nfe_status);

  if (!xml) {
    return {
      hasXml: false,
      xmlValidation: null,
      xmlAuthorizedProduction: false,
      xmlFields: {
        cStat: null,
        tpAmb: null,
        destinatarioNome: null,
        marcadorHomologacao: false,
        chNFe: null,
        nNF: null,
        nProt: null,
        CFOP: null,
      },
      statusAnterior,
      statusCorrigido: statusAnterior,
      shouldUpdate: false,
      updates: {},
    };
  }

  const xmlValidation = validateXmlNfeProducao(xml);
  const cStat = extractXmlTag(xml, 'cStat');
  const chNFe = extractXmlTag(xml, 'chNFe');
  const nNF = extractXmlTag(xml, 'nNF');
  const nProt = extractXmlTag(xml, 'nProt');
  const CFOP = extractCfopFromXml(xml);
  const xmlAuthorizedProduction = Boolean(xmlValidation.ok && cStat === '100' && chNFe);

  const updates: NfeLocalReconciliationResult['updates'] = {};
  if (xmlAuthorizedProduction) {
    if (statusAnterior !== 'authorized') updates.nfe_status = 'authorized';
    if (chNFe && normalizeNullableText(input.nfe_chave) !== chNFe) updates.nfe_chave = chNFe;
    if (nNF && normalizeNullableText(input.nota_fiscal_numero) !== nNF) updates.nota_fiscal_numero = nNF;
    if (nProt && normalizeNullableText(input.nfe_protocolo) !== nProt) updates.nfe_protocolo = nProt;
    if (CFOP && normalizeNullableText(input.nfe_cfop) !== CFOP) updates.nfe_cfop = CFOP;
  }

  const hasUpdates = Object.keys(updates).length > 0;
  return {
    hasXml: true,
    xmlValidation,
    xmlAuthorizedProduction,
    xmlFields: {
      cStat,
      tpAmb: xmlValidation.tpAmb,
      destinatarioNome: xmlValidation.destinatarioNome,
      marcadorHomologacao: xmlValidation.marcadorHomologacao,
      chNFe,
      nNF,
      nProt,
      CFOP,
    },
    statusAnterior,
    statusCorrigido: hasUpdates && updates.nfe_status ? updates.nfe_status : statusAnterior,
    shouldUpdate: hasUpdates,
    updates,
  };
}
