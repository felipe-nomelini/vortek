import { createServiceClient } from '@/lib/supabase';
import { parseAuthorizedStockNfeXml, type StockNfe } from '@/lib/estoque-nfe';
import { isValidCnpj, normalizeCnpj } from '@/lib/fiscal/cnpj.js';

type ServiceDb = ReturnType<typeof createServiceClient>;

export function resolveStockNfeEnvironment(): 1 | 2 {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().toLowerCase();
  if (/^https:\/\/app\.bentevi\.shop(?:\/|$)/.test(appUrl)) return 1;
  return 2;
}

async function loadCompanyCnpj(db: ServiceDb): Promise<string> {
  const { data, error } = await db.from('empresa').select('cnpj').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const cnpj = normalizeCnpj(data?.cnpj);
  if (!isValidCnpj(cnpj)) throw new Error('CNPJ da empresa não está configurado.');
  return cnpj;
}

async function findProductMatches(db: ServiceDb, nfe: StockNfe) {
  const codes = Array.from(new Set(nfe.itens.map((item) => item.codigoFornecedor).filter(Boolean))) as string[];
  const gtins = Array.from(new Set(nfe.itens.map((item) => item.gtin).filter(Boolean))) as string[];

  const [mappings, productsBySku, productsByGtin, offersByCode, offersByGtin] = await Promise.all([
    codes.length
      ? (db as any).from('estoque_mapeamentos_fornecedor').select('codigo_fornecedor,produto_id').eq('emitente_cnpj', nfe.emitenteCnpj).in('codigo_fornecedor', codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? db.from('produtos').select('id,sku,nome').in('sku', codes)
      : Promise.resolve({ data: [], error: null }),
    gtins.length
      ? db.from('produtos').select('id,sku,nome,gtin').in('gtin', gtins)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? (db as any).from('produto_fornecedor_ofertas').select('produto_id,sku_oferta,sku_fornecedor,dslite_produto_id').or(`sku_oferta.in.(${codes.map(escapePostgrestValue).join(',')}),sku_fornecedor.in.(${codes.map(escapePostgrestValue).join(',')}),dslite_produto_id.in.(${codes.map(escapePostgrestValue).join(',')})`)
      : Promise.resolve({ data: [], error: null }),
    gtins.length
      ? (db as any).from('produto_fornecedor_ofertas').select('produto_id,gtin').in('gtin', gtins)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [mappings, productsBySku, productsByGtin, offersByCode, offersByGtin]) {
    if (result.error) throw new Error(result.error.message);
  }

  const productIds = Array.from(new Set([
    ...(mappings.data || []).map((row: any) => row.produto_id),
    ...(productsBySku.data || []).map((row: any) => row.id),
    ...(productsByGtin.data || []).map((row: any) => row.id),
    ...(offersByCode.data || []).map((row: any) => row.produto_id),
    ...(offersByGtin.data || []).map((row: any) => row.produto_id),
  ].map(String).filter(Boolean)));
  const { data: matchedProducts, error: productsError } = productIds.length
    ? await db.from('produtos').select('id,sku,nome').in('id', productIds)
    : { data: [], error: null };
  if (productsError) throw new Error(productsError.message);
  const products = new Map((matchedProducts || []).map((product: any) => [String(product.id), product]));

  return nfe.itens.map((item) => {
    const explicit = (mappings.data || []).find((row: any) => row.codigo_fornecedor === item.codigoFornecedor);
    const candidates = new Set<string>();
    if (explicit?.produto_id) candidates.add(String(explicit.produto_id));
    if (!explicit) {
      for (const row of productsByGtin.data || []) if (item.gtin && row.gtin === item.gtin) candidates.add(String(row.id));
      for (const row of offersByGtin.data || []) if (item.gtin && row.gtin === item.gtin) candidates.add(String(row.produto_id));
      for (const row of productsBySku.data || []) if (item.codigoFornecedor && row.sku === item.codigoFornecedor) candidates.add(String(row.id));
      for (const row of offersByCode.data || []) {
        if (item.codigoFornecedor && [row.sku_oferta, row.sku_fornecedor, row.dslite_produto_id].includes(item.codigoFornecedor)) {
          candidates.add(String(row.produto_id));
        }
      }
    }
    const productId = explicit?.produto_id || (candidates.size === 1 ? [...candidates][0] : null);
    const product = productId ? products.get(String(productId)) : null;
    return {
      numero_item: item.numeroItem,
      produto_id: productId ? String(productId) : null,
      produto: product ? { id: String(product.id), sku: product.sku, nome: product.nome } : null,
      codigo_fornecedor: item.codigoFornecedor,
      gtin: item.gtin,
      descricao: item.descricao,
      quantidade_esperada: item.quantidade,
      match_automatico: Boolean(productId),
      match_ambiguo: !explicit && candidates.size > 1,
    };
  });
}

function escapePostgrestValue(value: string): string {
  return `"${String(value).replace(/["\\]/g, '\\$&')}"`;
}

export async function saveStockReceiptFromXml(input: {
  xml: string;
  chave: string;
  source: 'brasilnfe' | 'upload';
  userId: string;
}) {
  const db = createServiceClient();
  const nfe = parseAuthorizedStockNfeXml({
    xml: input.xml,
    expectedKey: input.chave,
    expectedEnvironment: resolveStockNfeEnvironment(),
    expectedRecipientCnpj: await loadCompanyCnpj(db),
  });
  const items = await findProductMatches(db, nfe);
  const { data, error } = await (db as any).rpc('upsert_internal_stock_receipt', {
    p_receipt: {
      chave_nfe: nfe.chave,
      tipo_ambiente: nfe.tipoAmbiente,
      numero: nfe.numero,
      serie: nfe.serie,
      emitente_cnpj: nfe.emitenteCnpj,
      emitente_nome: nfe.emitenteNome,
      destinatario_cnpj: nfe.destinatarioCnpj,
      emitida_em: nfe.emitidaEm,
      valor_total: nfe.valorTotal,
      xml_nfe: nfe.xml,
      origem_xml: input.source,
    },
    p_items: items.map(({ produto, match_automatico, match_ambiguo, ...item }) => item),
    p_user_id: input.userId,
  });
  if (error) throw new Error(error.message);
  return loadStockReceipt(String(data));
}

export async function loadStockReceipt(receiptId: string) {
  const db = createServiceClient();
  const { data: receipt, error } = await (db as any)
    .from('estoque_recebimentos_nfe')
    .select('id,chave_nfe,tipo_ambiente,numero,serie,emitente_cnpj,emitente_nome,destinatario_cnpj,emitida_em,valor_total,origem_xml,status,manifestacao_status,manifestacao_protocolo,created_at,updated_at,confirmado_em')
    .eq('id', receiptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!receipt) throw new Error('Recebimento não encontrado.');
  const { data: items, error: itemsError } = await (db as any)
    .from('estoque_recebimento_itens')
    .select('id,numero_item,produto_id,codigo_fornecedor,gtin,descricao,quantidade_esperada,quantidade_liberada,quantidade_nao_aproveitavel,produtos(id,sku,nome)')
    .eq('recebimento_id', receiptId)
    .order('numero_item');
  if (itemsError) throw new Error(itemsError.message);
  return { ...receipt, itens: items || [] };
}

export async function findStockReceiptByKey(chave: string) {
  const db = createServiceClient();
  const { data, error } = await (db as any)
    .from('estoque_recebimentos_nfe')
    .select('id')
    .eq('chave_nfe', chave)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? loadStockReceipt(String(data.id)) : null;
}
