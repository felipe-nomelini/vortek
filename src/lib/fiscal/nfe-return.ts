import { z } from 'zod';
import { resolveDestIePolicy } from '@/lib/fiscal/ie-policy';

export const fiscalReturnTypeSchema = z.enum([
  'devolucao_pos_recebimento',
  'recusa_total',
  'recusa_parcial',
  'nao_localizado',
]);

export type FiscalReturnType = z.infer<typeof fiscalReturnTypeSchema>;

export const createFiscalReturnSchema = z.object({
  pedidoId: z.string().uuid(),
  tipoRetorno: fiscalReturnTypeSchema,
  motivo: z.string().trim().min(15).max(500),
  idempotencyKey: z.string().uuid(),
  itens: z.array(z.object({
    pedidoItemId: z.string().uuid(),
    quantidade: z.coerce.number().positive().max(99_999),
  })).min(1).max(100),
});

export type CreateFiscalReturnInput = z.infer<typeof createFiscalReturnSchema>;

export type FiscalReturnSnapshotItem = {
  pedido_item_id: string;
  nitem_original: number;
  titulo: string;
  seller_sku: string | null;
  ml_item_id: string | null;
  quantidade_vendida: number;
  quantidade_retorno: number;
  valor_unitario: number;
  valor_total: number;
  ncm: string | null;
  cest: string | null;
  gtin: string | null;
  origem_fiscal: string | null;
  csosn: string | null;
  cfop_original: string | null;
};

export const FISCAL_RETURN_TYPE_LABELS: Record<FiscalReturnType, string> = {
  devolucao_pos_recebimento: 'Devolução após recebimento',
  recusa_total: 'Recusa total na entrega',
  recusa_parcial: 'Recusa parcial na entrega',
  nao_localizado: 'Destinatário não localizado',
};

function digits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function textTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || null;
}

export function parseOriginalNfeItems(xml: string): Array<{
  nitem: number;
  sku: string | null;
  title: string | null;
  cfop: string | null;
}> {
  const items: Array<{ nitem: number; sku: string | null; title: string | null; cfop: string | null }> = [];
  const detPattern = /<det\b[^>]*\bnItem=["'](\d+)["'][^>]*>([\s\S]*?)<\/det>/gi;
  let match: RegExpExecArray | null;
  while ((match = detPattern.exec(xml)) !== null) {
    items.push({
      nitem: Number(match[1]),
      sku: textTag(match[2], 'cProd'),
      title: textTag(match[2], 'xProd'),
      cfop: textTag(match[2], 'CFOP'),
    });
  }
  return items;
}

export function resolveOriginalItemReference(input: {
  originalItems: ReturnType<typeof parseOriginalNfeItems>;
  sellerSku?: string | null;
  title?: string | null;
}): { nitem: number; cfop: string | null } | null {
  const sku = String(input.sellerSku || '').trim();
  if (sku) {
    const matches = input.originalItems.filter((item) => item.sku === sku);
    if (matches.length === 1) return { nitem: matches[0].nitem, cfop: matches[0].cfop };
  }
  const title = String(input.title || '').trim().toLocaleLowerCase('pt-BR');
  if (title) {
    const matches = input.originalItems.filter(
      (item) => String(item.title || '').trim().toLocaleLowerCase('pt-BR') === title,
    );
    if (matches.length === 1) return { nitem: matches[0].nitem, cfop: matches[0].cfop };
  }
  return null;
}

export function mapSaleCfopToReturn(cfop: unknown): 1202 | 2202 | null {
  const normalized = digits(cfop);
  if (normalized === '5102') return 1202;
  if (normalized === '6102') return 2202;
  return null;
}

export function resolveFiscalReturnEnvironment():
  | { ok: true; tipoAmbiente: 1 | 2 }
  | { ok: false; error: string } {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().toLowerCase();
  const isProductionWeb = /^https:\/\/app\.bentevi\.shop(?:\/|$)/.test(appUrl);
  const returnEnvironment = String(process.env.BRASILNFE_RETURN_TIPO_AMBIENTE || '').trim();
  const tipo = Number(returnEnvironment || (isProductionWeb ? process.env.BRASILNFE_TIPO_AMBIENTE : ''));
  if (tipo !== 1 && tipo !== 2) {
    return { ok: false, error: 'BRASILNFE_TIPO_AMBIENTE deve ser 1 ou 2.' };
  }
  if (!isProductionWeb && tipo !== 2) {
    return {
      ok: false,
      error: 'Emissão de devolução bloqueada: configure BRASILNFE_RETURN_TIPO_AMBIENTE=2 em desenvolvimento/homologação.',
    };
  }
  return { ok: true, tipoAmbiente: tipo };
}

export function buildFiscalReturnPayload(input: {
  pedido: any;
  retorno: any;
}): { ok: true; payload: Record<string, any> } | { ok: false; error: string } {
  const { pedido, retorno } = input;
  const items = Array.isArray(retorno?.itens_snapshot)
    ? retorno.itens_snapshot as FiscalReturnSnapshotItem[]
    : [];
  if (items.length === 0) return { ok: false, error: 'Retorno fiscal sem itens reservados.' };

  const document = digits(pedido?.billing_documento || pedido?.contato_documento);
  if (document.length !== 11 && document.length !== 14) {
    return { ok: false, error: 'Documento fiscal do cliente inválido.' };
  }
  const address = pedido?.billing_endereco || {};
  const uf = String(address.state_id || '').trim().toUpperCase();
  const municipalityCode = digits(address.cod_municipio || address.city_id);
  const zipCode = digits(address.zip_code);
  if (!/^[A-Z]{2}$/.test(uf) || municipalityCode.length !== 7 || zipCode.length !== 8) {
    return { ok: false, error: 'Endereço fiscal original incompleto para a nota de entrada.' };
  }

  const iePolicy = resolveDestIePolicy({
    documento: document,
    billingIe: String(pedido?.billing_ie || ''),
    taxpayerTypeMlRaw: address.ie_policy_resolved || address.taxpayer_type || null,
  });
  if (document.length === 14 && iePolicy.ieRequired && !String(pedido?.billing_ie || '').trim()) {
    return { ok: false, error: 'Cliente contribuinte sem inscrição estadual no snapshot fiscal.' };
  }

  const partial = retorno.escopo === 'parcial';
  const isDeliveryFailure = retorno.tipo_retorno !== 'devolucao_pos_recebimento';
  const products: Record<string, any>[] = [];
  for (const item of items) {
    const cfop = mapSaleCfopToReturn(item.cfop_original);
    if (!cfop) {
      return {
        ok: false,
        error: `CFOP original do item “${item.titulo}” não possui regra de retorno homologada.`,
      };
    }
    const product: Record<string, any> = {
      CodProdutoServico: String(item.seller_sku || item.titulo || 'ITEM'),
      NmProduto: String(item.titulo || 'Item devolvido').trim().slice(0, 120),
      NCM: digits(item.ncm),
      CFOP: cfop,
      UnidadeComercial: 'UN',
      Quantidade: Number(item.quantidade_retorno),
      ValorUnitario: Number(item.valor_unitario),
      ValorTotal: Number(item.valor_total),
      OrigemProduto: Number(item.origem_fiscal || 2),
      GTIN: item.gtin || undefined,
      CEST: item.cest || undefined,
      Imposto: {
        ICMS: { CodSituacaoTributaria: String(item.csosn || '102'), AliquotaICMS: 0 },
        PIS: { CodSituacaoTributaria: '49', Aliquota: 0, BaseCalculo: 0 },
        COFINS: { CodSituacaoTributaria: '49', Aliquota: 0, BaseCalculo: 0 },
        IPI: {
          CodSituacaoTributaria: '99', BaseCalculo: 0, Aliquota: 0,
          Valor: 0, CodEnquadramento: '999',
        },
      },
    };
    if (partial) {
      product.ChaveAcessoReferenciada = retorno.nfe_original_chave;
      product.NItemReferenciado = Number(item.nitem_original);
    }
    products.push(product);
  }

  const payload: Record<string, any> = {
    IdentificadorInterno: retorno.identificador_interno,
    TipoAmbiente: Number(retorno.tipo_ambiente),
    ModeloDocumento: 55,
    Finalidade: isDeliveryFailure ? 5 : 4,
    NaturezaOperacao: isDeliveryFailure
      ? 'Retorno por Recusa ou não localização'
      : 'DEVOLUÇÃO DE MERCADORIA',
    IndicadorPresenca: 0,
    ConsumidorFinal: true,
    Cliente: {
      CpfCnpj: document,
      NmCliente: String(pedido?.billing_nome || pedido?.contato_nome || 'Cliente').trim().slice(0, 60),
      IndicadorIe: iePolicy.indicadorIe,
      ...(document.length === 14 && iePolicy.indicadorIe === 1 && pedido?.billing_ie
        ? { IE: String(pedido.billing_ie).trim() }
        : {}),
      Endereco: {
        Logradouro: String(address.street_name || '').trim(),
        Numero: String(address.street_number || 'S/N').trim(),
        Bairro: String(address.neighborhood || '').trim(),
        CodMunicipio: municipalityCode,
        Municipio: String(address.city_name || '').trim(),
        Uf: uf,
        Cep: zipCode,
      },
    },
    Produtos: products,
    Transporte: { ModalidadeFrete: 9 },
    Observacao: retorno.motivo,
    ...(!partial ? { NFReferencia: [retorno.nfe_original_chave] } : {}),
    ...(isDeliveryFailure
      ? { TpNFCredito: retorno.tipo_retorno === 'recusa_parcial' ? 6 : 3 }
      : {}),
  };
  return { ok: true, payload };
}
