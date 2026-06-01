import { createServiceClient } from '@/lib/supabase';
import { getExpectedCfopByUf } from '@/lib/fiscal/cfop';
import {
  buscarNotaBrasilNfePorIdentificadorInterno,
  getFiscalProvider,
  obterXmlBrasilNfePorChave,
  parseBrasilNfeDuplicateIdentifier,
} from '@/services/fiscal-provider';
import { registrarEventoNfAuditoria } from '@/services/nf-auditoria';

const UF_CODES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
const HOMOLOG_DEST_NAME_MARKER = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
const ITEM_TOTAL_TOLERANCE = 0.01;

function nowIso() {
  return new Date().toISOString();
}

function normalizeDocument(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeUf(value: string | null | undefined): string | null {
  const uf = String(value || '').trim().toUpperCase();
  if (!UF_CODES.has(uf)) return null;
  return uf;
}

function extractUfFromAddress(value: string | null | undefined): string | null {
  const raw = String(value || '').toUpperCase();
  const dashMatch = raw.match(/-\s*([A-Z]{2})(?:\b|,)/);
  if (dashMatch?.[1] && UF_CODES.has(dashMatch[1])) return dashMatch[1];
  const endMatch = raw.match(/,\s*([A-Z]{2})\s*$/);
  if (endMatch?.[1] && UF_CODES.has(endMatch[1])) return endMatch[1];
  const tokens = raw
    .replace(/[^\w\s-]/g, ' ')
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (UF_CODES.has(tokens[i])) return tokens[i];
  }
  return null;
}

function resolveEmitUf(empresa: any): string | null {
  return normalizeUf(empresa?.uf_fiscal) || extractUfFromAddress(empresa?.endereco || null);
}

function normalizeForCompare(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function resolveBrasilNfeTipoAmbienteStrict():
  | { ok: true; value: 1; raw: string; interpreted: number }
  | { ok: false; value: null; error: string; raw: string; interpreted: number | null } {
  const envValue = process.env.BRASILNFE_TIPO_AMBIENTE;
  const raw = typeof envValue === 'string' ? envValue.trim() : '';
  const interpreted = raw === '' ? null : Number(raw);
  if (interpreted === 1) return { ok: true, value: 1, raw, interpreted };
  const interpretedDisplay = interpreted === null || Number.isNaN(interpreted) ? 'null' : String(interpreted);
  const rawDisplay = raw || '(vazio)';
  return {
    ok: false,
    value: null,
    raw,
    interpreted: interpreted === null || Number.isNaN(interpreted) ? null : interpreted,
    error: `Configuração fiscal inválida: BRASILNFE_TIPO_AMBIENTE="${rawDisplay}" (interpretado: ${interpretedDisplay}). Deve ser 1 (produção).`,
  };
}

function resolveModFrete(pedido: any): 0 | 2 | null {
  const candidates = [
    pedido?.totais_snapshot?.modFrete,
    pedido?.totais_snapshot?.modalidade_frete,
    pedido?.billing_endereco?.modFrete,
    pedido?.billing_endereco?.modalidade_frete,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (value === 0 || value === 2) return value;
  }
  return String(pedido?.ml_shipment_id || '').trim() ? 2 : 0;
}

function extractTag(xml: string, tag: string): string | null {
  try {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<${escaped}>([^<]+)</${escaped}>`));
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function extractDestinatarioNome(xml: string | null | undefined): string | null {
  try {
    const match = String(xml || '').match(/<dest>[\s\S]*?<xNome>([^<]+)<\/xNome>/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function validateXmlNfeProducao(xml: string | null | undefined): {
  ok: boolean;
  tpAmb: string | null;
  destinatarioNome: string | null;
  marcadorHomologacao: boolean;
  message?: string;
} {
  const rawXml = String(xml || '');
  const tpAmb = extractTag(rawXml, 'tpAmb');
  const destinatarioNome = extractDestinatarioNome(rawXml);
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

  return { ok: true, tpAmb, destinatarioNome, marcadorHomologacao };
}

function extractCfop(xml: string | null): string | null {
  if (!xml) return null;
  return extractTag(xml, 'CFOP');
}

function roundMoney(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function resolveProdutoValorTotalBruto(it: any): number {
  const quantidade = Number(it?.quantidade || 0);
  const valorUnitario = Number(it?.valor_unitario || 0);
  const valorTotalBruto = Number(it?.valor_total_bruto || 0);
  if (Number.isFinite(valorTotalBruto) && valorTotalBruto > 0) return roundMoney(valorTotalBruto);
  return roundMoney(quantidade * valorUnitario);
}

function validateProdutosTotalConsistency(payload: any): Array<{
  index: number;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total_item: number | null;
  valor_total_esperado: number;
}> {
  const produtos = Array.isArray(payload?.Produtos) ? payload.Produtos : [];
  const issues: Array<{
    index: number;
    quantidade: number | null;
    valor_unitario: number | null;
    valor_total_item: number | null;
    valor_total_esperado: number;
  }> = [];
  produtos.forEach((p: any, idx: number) => {
    const quantidade = Number(p?.Quantidade ?? 0);
    const valorUnitario = Number(p?.ValorUnitario ?? 0);
    const valorTotal = Number(p?.ValorTotal ?? 0);
    const esperado = roundMoney(quantidade * valorUnitario);
    if (!Number.isFinite(valorTotal) || Math.abs(valorTotal - esperado) > ITEM_TOTAL_TOLERANCE) {
      issues.push({
        index: idx,
        quantidade: Number.isFinite(quantidade) ? quantidade : null,
        valor_unitario: Number.isFinite(valorUnitario) ? roundMoney(valorUnitario) : null,
        valor_total_item: Number.isFinite(valorTotal) ? roundMoney(valorTotal) : null,
        valor_total_esperado: esperado,
      });
    }
  });
  return issues;
}

function buildPayloadFromSnapshot(
  pedido: any,
  itens: any[],
  empresa: any,
  identifierInternoOverride?: string | null,
) {
  if (!pedido) return { ok: false as const, error: 'Pedido não encontrado' };
  if (pedido.snapshot_incompleto) return { ok: false as const, error: 'Snapshot fiscal incompleto. Sincronize o pedido.' };
  if (!empresa?.cnpj) return { ok: false as const, error: 'Empresa/CNPJ não configurada para emissão.' };
  if (!Array.isArray(itens) || itens.length === 0) return { ok: false as const, error: 'Pedido sem itens para emissão.' };
  const tipoAmbienteConfig = resolveBrasilNfeTipoAmbienteStrict();
  if (!tipoAmbienteConfig.ok) {
    return {
      ok: false as const,
      error: tipoAmbienteConfig.error,
      reason: 'tipo_ambiente_config_invalido',
      brasilnfeTipoAmbienteRaw: tipoAmbienteConfig.raw,
      brasilnfeTipoAmbienteInterpretado: tipoAmbienteConfig.interpreted,
    };
  }

  const doc = normalizeDocument(pedido.billing_documento);
  if (!(doc.length === 11 || doc.length === 14)) {
    return { ok: false as const, error: 'Documento do destinatário inválido para emissão.' };
  }

  const addr = pedido.billing_endereco || {};
  const destUf = normalizeUf(addr.state_id);
  const emitUf = resolveEmitUf(empresa);
  const cityName = String(addr.city_name || '').trim();
  const cep = String(addr.zip_code || '').replace(/\D/g, '');
  const codMunicipio = String(addr.cod_municipio || '').trim()
    || (/^\d{7}$/.test(String(addr.city_id || '').trim()) ? String(addr.city_id || '').trim() : '');
  if (!destUf || !emitUf) {
    return { ok: false as const, error: 'UF emitente/destinatário ausente. Não é possível definir CFOP.' };
  }
  if (!cityName || !cep || !codMunicipio) {
    return { ok: false as const, error: 'Dados fiscais incompletos (cidade/CEP/código município).' };
  }

  const cfopEsperado = getExpectedCfopByUf(emitUf, destUf);
  if (!cfopEsperado) return { ok: false as const, error: 'Não foi possível calcular CFOP por UF.' };
  const modFrete = resolveModFrete(pedido);
  if (modFrete !== 0 && modFrete !== 2) return { ok: false as const, error: 'Não foi possível resolver modFrete.' };

  const billingIe = String(pedido.billing_ie || '').trim();
  const isCnpj = doc.length === 14;
  const indicadorIe = isCnpj ? (billingIe ? 1 : 2) : 9;
  if (isCnpj && !billingIe) {
    return {
      ok: false as const,
      error: 'Destinatário com CNPJ sem IE. Sincronize os dados fiscais e tente novamente.',
    };
  }

  const produtos = itens.map((it: any) => ({
    CodProdutoServico: String(it.seller_sku || it.titulo || 'ITEM'),
    NmProduto: String(it.titulo || 'Produto'),
    NCM: String(it.ncm || ''),
    CFOP: Number(cfopEsperado),
    UnidadeComercial: 'UN',
    Quantidade: Number(it.quantidade || 0),
    ValorUnitario: Number(it.valor_unitario || 0),
    ValorTotal: resolveProdutoValorTotalBruto(it),
    OrigemProduto: 2,
    GTIN: it.gtin || undefined,
    CEST: it.cest || undefined,
    Imposto: {
      ICMS: { CodSituacaoTributaria: '102', AliquotaICMS: 0 },
      PIS: { CodSituacaoTributaria: '49', Aliquota: 0, BaseCalculo: 0 },
      COFINS: { CodSituacaoTributaria: '49', Aliquota: 0, BaseCalculo: 0 },
      IPI: {
        CodSituacaoTributaria: '99',
        BaseCalculo: 0,
        Aliquota: 0,
        Valor: 0,
        CodEnquadramento: '999',
      },
    },
  }));

  return {
    ok: true as const,
    payload: {
      IdentificadorInterno: String(identifierInternoOverride || `VORTEK-${String(pedido.numero || pedido.id)}`),
      TipoAmbiente: tipoAmbienteConfig.value,
      ModeloDocumento: 55,
      Finalidade: 1,
      NaturezaOperacao: 'VENDA DE MERCADORIA',
      IndicadorPresenca: 1,
      ConsumidorFinal: true,
      Cliente: {
        CpfCnpj: doc,
        NmCliente: String(pedido.billing_nome || 'Cliente'),
        IndicadorIe: indicadorIe,
        ...(isCnpj ? { IE: billingIe || 'ISENTO' } : {}),
        Endereco: {
          Logradouro: String(addr.street_name || 'Não informado'),
          Numero: String(addr.street_number || 'S/N'),
          Bairro: String(addr.neighborhood || 'Não informado'),
          CodMunicipio: codMunicipio,
          Municipio: cityName,
          Uf: destUf,
          Cep: cep,
        },
      },
      Produtos: produtos,
      Pagamentos: [{ IndicadorPagamento: 0, FormaPagamento: '15', Valor: Number(pedido.total || 0) }],
      Transporte: { ModalidadeFrete: modFrete },
    },
  };
}

export type EnsureBrasilNfeInvoiceResult = {
  ok: boolean;
  issueType?: 'duplicate_identifier';
  alreadyExisted?: boolean;
  status?: string;
  xml?: string | null;
  chave?: string | null;
  numero?: string | null;
  externalId?: string | null;
  danfeUrl?: string | null;
  cfop?: string | null;
  error?: string;
  errorDetails?: Record<string, any> | null;
  identificadorInterno?: string | null;
  existingNfe?: {
    chave: string;
    numero?: number | null;
    status?: number | null;
    dataEmissao?: string | null;
    numeroProtocolo?: string | null;
    linkInterno?: string | null;
  } | null;
  consistency?: {
    checked: boolean;
    cleanupExecuted: boolean;
    recoveredFromExternalId: boolean;
  };
};

function isAuthorizedStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'authorized' || normalized === 'autorizada';
}

async function cleanupGhostNfeSnapshot(client: ReturnType<typeof createServiceClient>, pedidoId: string) {
  await client
    .from('pedidos')
    .update({
      nfe_xml: null,
      nfe_chave: null,
      nfe_status: null,
      nfe_external_id: null,
      nfe_protocolo: null,
      nota_fiscal_numero: null,
      nfe_danfe_url: null,
      nfe_cfop: null,
      nfe_last_sync_at: nowIso(),
    } as any)
    .eq('id', pedidoId);
}

export async function ensureBrasilNfeInvoice(input: {
  pedidoId: string;
  identifierInternoOverride?: string | null;
  skipDuplicateLookup?: boolean;
}): Promise<EnsureBrasilNfeInvoiceResult> {
  const client = createServiceClient();
  const { data: pedido } = await client
    .from('pedidos')
    .select('id,numero,total,ml_order_id,ml_shipment_id,billing_nome,billing_documento,billing_ie,billing_endereco,snapshot_incompleto,nfe_xml,nfe_status,nfe_provider,nfe_chave,nfe_external_id,nfe_danfe_url,nota_fiscal_numero,nfe_cfop,totais_snapshot,pedido_itens(*)')
    .eq('id', input.pedidoId)
    .maybeSingle();

  if (!pedido) return { ok: false, error: 'Pedido não encontrado para garantir NF Brasil NFe.' };

  const statusAtual = String((pedido as any).nfe_status || '').toLowerCase();
  const xmlAtual = String((pedido as any).nfe_xml || '');
  const providerAtual = String((pedido as any).nfe_provider || '').toLowerCase();
  const chaveAtual = String((pedido as any).nfe_chave || '').trim();
  const externalAtual = String((pedido as any).nfe_external_id || '');
  const mlOrderId = String((pedido as any).ml_order_id || '');

  const provider = getFiscalProvider('brasilnfe');
  const blockIfXmlNotProduction = async (xmlToCheck: string | null | undefined, stage: string) => {
    if (!String(xmlToCheck || '').trim()) return null;
    const check = validateXmlNfeProducao(xmlToCheck);
    if (check.ok) return null;
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId,
      evento: 'nfe_homologacao_bloqueada',
      respostaMl: {
        stage,
        reason: 'nf_xml_not_production',
        tpAmb_xml_recebido: check.tpAmb,
        destinatario_xml: check.destinatarioNome,
        marcador_homologacao_detectado: check.marcadorHomologacao,
      },
      statusResultante: 'blocked_homologation',
    });
    return check.message || 'NF-e inválida para fluxo fiscal.';
  };

  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    mlOrderId,
    evento: 'nfe_local_consistencia_check_start',
    payloadEnviado: {
      nfe_status_local_antes: statusAtual || null,
      nfe_external_id_local: externalAtual || null,
      xml_local_present: Boolean(xmlAtual),
      chave_local_present: Boolean(chaveAtual),
    },
    statusResultante: 'starting',
  });

  if (providerAtual === 'brasilnfe' && isAuthorizedStatus(statusAtual) && xmlAtual && chaveAtual) {
    const blockedMessage = await blockIfXmlNotProduction(xmlAtual, 'local_authorized_snapshot');
    if (blockedMessage) return { ok: false, error: blockedMessage };
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId,
      evento: 'nfe_local_consistencia_check_result',
      respostaMl: {
        cleanup_executado: false,
        recovered_from_external_id: false,
        motivo: 'nfe_local_ja_autorizada',
      },
      statusResultante: 'ok',
    });
    return {
      ok: true,
      alreadyExisted: true,
      status: 'authorized',
      xml: xmlAtual,
      chave: chaveAtual || extractTag(xmlAtual, 'chNFe'),
      numero: String((pedido as any).nota_fiscal_numero || '') || extractTag(xmlAtual, 'nNF'),
      externalId: externalAtual || null,
      danfeUrl: String((pedido as any).nfe_danfe_url || '') || null,
      cfop: String((pedido as any).nfe_cfop || '') || extractCfop(xmlAtual),
      consistency: {
        checked: true,
        cleanupExecuted: false,
        recoveredFromExternalId: false,
      },
    };
  }

  if (providerAtual === 'brasilnfe' && xmlAtual) {
    const chaveXml = extractTag(xmlAtual, 'chNFe');
    const cStatXml = extractTag(xmlAtual, 'cStat');
    if (chaveXml && cStatXml === '100') {
      const blockedMessage = await blockIfXmlNotProduction(xmlAtual, 'local_xml_autocorrect');
      if (blockedMessage) return { ok: false, error: blockedMessage };
      const numeroXml = extractTag(xmlAtual, 'nNF');
      const cfopXml = extractCfop(xmlAtual);
      await client
        .from('pedidos')
        .update({
          nfe_status: 'authorized',
          nfe_provider: 'brasilnfe',
          nfe_chave: chaveXml,
          nota_fiscal_numero: numeroXml || undefined,
          nfe_cfop: cfopXml || undefined,
          nfe_last_sync_at: nowIso(),
        } as any)
        .eq('id', input.pedidoId);
      await registrarEventoNfAuditoria({
        pedidoId: input.pedidoId,
        mlOrderId,
        evento: 'nfe_local_consistencia_check_result',
        respostaMl: {
          cleanup_executado: false,
          recovered_from_external_id: false,
          motivo: 'autocorrecao_por_xml_local_autorizado',
          chave_xml: chaveXml,
          cstat_xml: cStatXml,
        },
        statusResultante: 'autocorrected',
      });
      return {
        ok: true,
        alreadyExisted: true,
        status: 'authorized',
        xml: xmlAtual,
        chave: chaveXml,
        numero: numeroXml || null,
        externalId: externalAtual || null,
        danfeUrl: String((pedido as any).nfe_danfe_url || '') || null,
        cfop: cfopXml || null,
        consistency: {
          checked: true,
          cleanupExecuted: false,
          recoveredFromExternalId: false,
        },
      };
    }
  }

  const shouldCheckGhost = Boolean(
    providerAtual === 'brasilnfe'
    && externalAtual
    && !isAuthorizedStatus(statusAtual)
    && (!xmlAtual || !chaveAtual)
  );

  if (shouldCheckGhost) {
    const xmlFetch = await provider.obterXml(externalAtual);
    if (xmlFetch.xml) {
      const blockedMessage = await blockIfXmlNotProduction(xmlFetch.xml, 'external_id_recovery');
      if (blockedMessage) return { ok: false, error: blockedMessage };
      const chave = extractTag(xmlFetch.xml, 'chNFe');
      const numero = extractTag(xmlFetch.xml, 'nNF');
      const cfop = extractCfop(xmlFetch.xml);
      await client
        .from('pedidos')
        .update({
          nfe_xml: xmlFetch.xml,
          nfe_status: 'authorized',
          nfe_provider: 'brasilnfe',
          nfe_chave: chave || undefined,
          nfe_external_id: externalAtual,
          nota_fiscal_numero: numero || undefined,
          nfe_cfop: cfop || undefined,
          nfe_last_sync_at: nowIso(),
        } as any)
        .eq('id', input.pedidoId);
      await registrarEventoNfAuditoria({
        pedidoId: input.pedidoId,
        mlOrderId,
        evento: 'nfe_local_consistencia_check_result',
        respostaMl: {
          cleanup_executado: false,
          recovered_from_external_id: true,
          nfe_external_id_local: externalAtual,
        },
        statusResultante: 'recovered',
      });
      return {
        ok: true,
        alreadyExisted: true,
        status: 'authorized',
        xml: xmlFetch.xml,
        chave: chave || null,
        numero: numero || null,
        externalId: externalAtual,
        danfeUrl: String((pedido as any).nfe_danfe_url || '') || null,
        cfop,
        consistency: {
          checked: true,
          cleanupExecuted: false,
          recoveredFromExternalId: true,
        },
      };
    }

    await cleanupGhostNfeSnapshot(client, input.pedidoId);
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId,
      evento: 'nfe_local_cleanup_ghost_before_reissue',
      respostaMl: {
        nfe_status_local_antes: statusAtual || null,
        nfe_external_id_local: externalAtual || null,
        xml_local_present: Boolean(xmlAtual),
        chave_local_present: Boolean(chaveAtual),
        cleanup_executado: true,
      },
      statusResultante: 'cleaned',
    });
  }

  if (!shouldCheckGhost) {
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId,
      evento: 'nfe_local_consistencia_check_result',
      respostaMl: {
        cleanup_executado: false,
        recovered_from_external_id: false,
        motivo: 'nao_aplicavel',
      },
      statusResultante: 'ok',
    });
  }

  const { data: empresa } = await client
    .from('empresa')
    .select('nome,cnpj,endereco,email,uf_fiscal,cod_municipio_fiscal')
    .limit(1)
    .maybeSingle();
  const { data: itens } = await client
    .from('pedido_itens')
    .select('titulo,quantidade,valor_unitario,valor_total_bruto,valor_total_liquido,ncm,seller_sku,gtin,cest')
    .eq('pedido_id', input.pedidoId);

  const built = buildPayloadFromSnapshot(
    pedido,
    itens || [],
    empresa || null,
    input.identifierInternoOverride || null,
  );
  if (!built.ok) {
    if ((built as any)?.reason === 'tipo_ambiente_config_invalido') {
      await registrarEventoNfAuditoria({
        pedidoId: input.pedidoId,
        mlOrderId,
        evento: 'brasilnfe_tipo_ambiente_invalido',
        payloadEnviado: {
          brasilnfe_tipo_ambiente_raw: (built as any)?.brasilnfeTipoAmbienteRaw ?? null,
          tipo_ambiente_interpretado: (built as any)?.brasilnfeTipoAmbienteInterpretado ?? null,
          expected: 1,
        },
        respostaMl: {
          error: built.error,
          acao_recomendada: 'Definir BRASILNFE_TIPO_AMBIENTE=1 no runtime e redeploy',
        },
        statusResultante: 'blocked_invalid_env_config',
      });
    }
    return { ok: false, error: built.error };
  }
  const itemTotalIssues = validateProdutosTotalConsistency((built as any).payload);
  if (itemTotalIssues.length > 0) {
    const msg = 'Bloqueado na pré-validação fiscal: ValorTotal do item diverge de Quantidade x ValorUnitario.';
    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId,
      evento: 'payload_validacao_bloqueio',
      payloadEnviado: {
        provider: 'brasilnfe',
        tipo_ambiente_enviado: Number((built.payload as any)?.TipoAmbiente ?? 0) || null,
      },
      respostaMl: {
        motivo: 'valor_total_item_divergente_quantidade_valor_unitario',
        tolerancia: ITEM_TOTAL_TOLERANCE,
        items: itemTotalIssues,
      },
      statusResultante: 'blocked_payload_validation',
    });
    return { ok: false, error: msg };
  }
  await registrarEventoNfAuditoria({
    pedidoId: input.pedidoId,
    mlOrderId,
    evento: 'envio',
    payloadEnviado: {
      provider: 'brasilnfe',
      tipo_ambiente_enviado: Number((built.payload as any)?.TipoAmbiente ?? 0) || null,
    },
    statusResultante: 'sending',
  });

  const emissao = await provider.emitirNota({
    pedidoId: input.pedidoId,
    mlOrderId,
    nfePayload: built.payload,
  });
  if (!emissao.ok) {
    const duplicate = parseBrasilNfeDuplicateIdentifier(emissao.errorDetails || null);
    if (duplicate.isDuplicateIdentifier && !input.skipDuplicateLookup) {
      const identificadorInterno = duplicate.identificadorInterno
        || String((built.payload as any)?.IdentificadorInterno || '').trim()
        || null;
      let existingNfe: EnsureBrasilNfeInvoiceResult['existingNfe'] = null;
      if (identificadorInterno) {
        const found = await buscarNotaBrasilNfePorIdentificadorInterno({ identificadorInterno });
        if (found.ok && found.nota?.chave) {
          const xmlByKey = await obterXmlBrasilNfePorChave(found.nota.chave);
          if (xmlByKey.ok && xmlByKey.xml) {
            const numeroXml = extractTag(xmlByKey.xml, 'nNF');
            const cfopXml = extractCfop(xmlByKey.xml);
            await client
              .from('pedidos')
              .update({
                nfe_xml: xmlByKey.xml,
                nfe_status: 'authorized',
                nfe_provider: 'brasilnfe',
                nfe_chave: found.nota.chave,
                nota_fiscal_numero: numeroXml || found.nota.numero || undefined,
                nfe_cfop: cfopXml || undefined,
                nfe_last_sync_at: nowIso(),
              } as any)
              .eq('id', input.pedidoId);
          }
          existingNfe = {
            chave: found.nota.chave,
            numero: found.nota.numero,
            status: found.nota.status,
            dataEmissao: found.nota.dtEmissao,
            numeroProtocolo: found.nota.numeroProtocolo || null,
            linkInterno: `/api/notas-fiscais/${input.pedidoId}/pdf`,
          };
          await registrarEventoNfAuditoria({
            pedidoId: input.pedidoId,
            mlOrderId,
            evento: 'brasilnfe_duplicate_note_found',
            respostaMl: {
              identificador_interno: identificadorInterno,
              nfe_chave_encontrada: found.nota.chave,
              nfe_numero_encontrado: found.nota.numero,
            },
            statusResultante: 'found',
          });
        }
      }
      await registrarEventoNfAuditoria({
        pedidoId: input.pedidoId,
        mlOrderId,
        evento: 'brasilnfe_duplicate_identifier_detected',
        respostaMl: {
          identificador_interno: identificadorInterno,
          provider_error_raw: emissao.errorDetails || null,
        },
        statusResultante: existingNfe ? 'detected_with_note' : 'detected',
      });
      return {
        ok: false,
        issueType: 'duplicate_identifier',
        error: duplicate.message || emissao.error || 'NF já existente com identificador interno',
        errorDetails: emissao.errorDetails || null,
        identificadorInterno,
        existingNfe,
        consistency: {
          checked: true,
          cleanupExecuted: shouldCheckGhost,
          recoveredFromExternalId: false,
        },
      };
    }

    await registrarEventoNfAuditoria({
      pedidoId: input.pedidoId,
      mlOrderId,
      evento: 'brasilnfe_emit_failed_detailed',
      respostaMl: {
        error: emissao.error || null,
        provider_error_raw: emissao.errorDetails || null,
      },
      statusResultante: 'failed',
    });
    return {
      ok: false,
      error: emissao.error || 'Falha ao emitir NF na Brasil NFe.',
      errorDetails: emissao.errorDetails || null,
      consistency: {
        checked: true,
        cleanupExecuted: shouldCheckGhost,
        recoveredFromExternalId: false,
      },
    };
  }

  let xml = emissao.xml || null;
  const externalId = emissao.externalId || null;
  if (!xml && externalId) {
    const xmlFetch = await provider.obterXml(String(externalId));
    if (xmlFetch.xml) xml = xmlFetch.xml;
  }
  const blockedAfterEmission = await blockIfXmlNotProduction(xml, 'post_emission_xml');
  if (blockedAfterEmission) {
    return {
      ok: false,
      error: blockedAfterEmission,
      consistency: {
        checked: true,
        cleanupExecuted: shouldCheckGhost,
        recoveredFromExternalId: false,
      },
    };
  }

  let danfeUrl = emissao.danfeUrl || null;
  if (!danfeUrl && externalId) {
    const danfe = await provider.obterDanfe(String(externalId));
    if (danfe.url) danfeUrl = danfe.url;
  }

  const chave = emissao.chave || extractTag(xml || '', 'chNFe');
  const numero = emissao.numero || extractTag(xml || '', 'nNF');
  const cfop = emissao.cfop || extractCfop(xml);
  await client
    .from('pedidos')
    .update({
      nfe_provider: 'brasilnfe',
      nfe_external_id: externalId || undefined,
      nfe_status: emissao.status || 'authorized',
      nfe_chave: chave || undefined,
      nfe_protocolo: emissao.protocolo || undefined,
      nota_fiscal_numero: numero || undefined,
      nfe_xml: xml || undefined,
      nfe_danfe_url: danfeUrl || undefined,
      nfe_cfop: cfop || undefined,
      nfe_last_sync_at: nowIso(),
    } as any)
    .eq('id', input.pedidoId);

  return {
    ok: true,
    alreadyExisted: false,
    status: emissao.status || 'authorized',
    xml,
    chave: chave || null,
    numero: numero || null,
    externalId,
    danfeUrl,
    cfop: cfop || null,
    consistency: {
      checked: true,
      cleanupExecuted: shouldCheckGhost,
      recoveredFromExternalId: false,
    },
  };
}
