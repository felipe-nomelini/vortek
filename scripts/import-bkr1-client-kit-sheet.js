/* Importa kits BKR1 de uma planilha do fornecedor.
 * Uso:
 *   node -r dotenv/config scripts/import-bkr1-client-kit-sheet.js --file "/caminho/Elixir.xls" dotenv_config_path=.env.local
 *   node -r dotenv/config scripts/import-bkr1-client-kit-sheet.js --file "/caminho/Elixir.xls" --apply dotenv_config_path=.env.local
 */
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const fileIndex = process.argv.indexOf('--file');
const FILE = fileIndex >= 0 ? path.resolve(process.argv[fileIndex + 1] || '') : '';
const SUPPLIER_ID = '108';

const BRAND_BY_FILE = {
  atk: 'ATK',
  duracell: 'Duracell',
  elgin: 'Elgin',
  elixir: 'Elixir',
  energizer: 'Energizer',
  giannini: 'Giannini',
  nig: 'NIG',
  philips: 'Philips',
  rayovac: 'Rayovac',
  rouxinol: 'Rouxinol',
  sg: 'SG',
  'sao goncalo': 'São Gonçalo',
  tonante: 'Tonante',
  wireconex: 'Wireconex',
};

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  return Number(text(value).replace(',', '.')) || 0;
}

function normalized(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferredBrand(file) {
  const key = normalized(path.basename(file, path.extname(file)));
  return BRAND_BY_FILE[key] || path.basename(file, path.extname(file));
}

function images(row, fallback = []) {
  return Array.from(new Set(
    [1, 2, 3, 4, 5, 6]
      .map((position) => text(row[`URL imagem ${position}`]))
      .filter(Boolean)
      .concat(Array.isArray(fallback) ? fallback.map(text).filter(Boolean) : []),
  ));
}

function plainHtml(value) {
  return text(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function description(row, brand, quantity, componentName) {
  const title = text(row.Descrição);
  const complement = plainHtml(row['Descrição complementar']);
  return [
    title,
    '',
    `Kit com ${quantity} unidades originais ${brand}.`,
    '',
    'Conteúdo da embalagem:',
    `- ${quantity}x ${componentName}`,
    '',
    'Informações principais:',
    `- Marca: ${brand}`,
    `- Quantidade: ${quantity} unidades`,
    ...(text(row['Formato embalagem']) ? [`- Embalagem: ${text(row['Formato embalagem'])}`] : []),
    ...(complement ? ['', complement] : []),
    '',
    'Confira o modelo e a quantidade antes de concluir a compra. Itens não descritos não acompanham o produto.',
  ].join('\n');
}

function componentFor(sku) {
  const match = /^(\d+)(?:CX|K)(\d+)$/i.exec(text(sku));
  if (!match) return null;
  return { dsliteId: match[1], quantity: Number(match[2]) };
}

async function main() {
  if (!FILE) throw new Error('--file é obrigatório');

  const url = text(process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('SUPABASE_SERVICE_URL/NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');

  const workbook = XLSX.readFile(FILE);
  const sheet = workbook.Sheets.Produtos || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
    .filter((row) => text(row['Código (SKU)']) || text(row.Descrição));
  const brand = inferredBrand(FILE);
  const kits = rows.map((row) => ({
    row,
    sku: text(row['Código (SKU)']),
    component: componentFor(row['Código (SKU)']),
  }));

  const unsupported = kits.filter((kit) => !kit.component);
  if (unsupported.length) {
    throw new Error(`SKUs compostos ou fora do padrão simples: ${unsupported.map((kit) => kit.sku).join(', ')}`);
  }

  const duplicateSkus = kits
    .map((kit) => kit.sku)
    .filter((sku, index, values) => values.indexOf(sku) !== index);
  if (duplicateSkus.length) throw new Error(`SKUs duplicados: ${Array.from(new Set(duplicateSkus)).join(', ')}`);

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const baseIds = Array.from(new Set(kits.map((kit) => kit.component.dsliteId)));
  const { data: baseOffers, error: baseError } = await client
    .from('produto_fornecedor_ofertas')
    .select('dslite_produto_id,produto_id,ativo,produto:produtos!produto_fornecedor_ofertas_produto_id_fkey(id,sku,nome,gtin,ncm,categoria,custo,estoque,ativo,imagens)')
    .eq('dslite_fornecedor_id', SUPPLIER_ID)
    .in('dslite_produto_id', baseIds);
  if (baseError) throw baseError;

  const offersByDsliteId = new Map();
  for (const offer of baseOffers || []) {
    const id = text(offer.dslite_produto_id);
    if (offersByDsliteId.has(id)) throw new Error(`Mais de uma oferta BKR1 para componente ${id}`);
    offersByDsliteId.set(id, offer);
  }

  const missing = baseIds.filter((id) => !offersByDsliteId.has(id));
  if (missing.length) throw new Error(`Componentes BKR1 ausentes: ${missing.join(', ')}`);

  const inactive = baseIds.filter((id) => {
    const offer = offersByDsliteId.get(id);
    return offer.ativo === false || offer.produto?.ativo === false;
  });
  if (inactive.length) throw new Error(`Componentes BKR1 inativos: ${inactive.join(', ')}`);

  const gtinMismatch = kits.filter((kit) => {
    const sheetGtin = text(kit.row['GTIN/EAN']).replace(/\D/g, '');
    const productGtin = text(offersByDsliteId.get(kit.component.dsliteId)?.produto?.gtin).replace(/\D/g, '');
    return sheetGtin && productGtin && sheetGtin !== productGtin;
  });
  if (gtinMismatch.length) throw new Error(`GTIN divergente: ${gtinMismatch.map((kit) => kit.sku).join(', ')}`);

  const { data: existingKits, error: existingError } = await client
    .from('produto_kits')
    .select('produto_id,sku_origem')
    .eq('fornecedor_dslite_id', SUPPLIER_ID)
    .in('sku_origem', kits.map((kit) => kit.sku));
  if (existingError) throw existingError;
  const existingBySku = new Map((existingKits || []).map((kit) => [text(kit.sku_origem), text(kit.produto_id)]));

  const newKits = kits.filter((kit) => !existingBySku.has(kit.sku));
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    file: FILE,
    brand,
    kits: kits.length,
    existing: kits.length - newKits.length,
    toCreate: newKits.length,
    components: baseIds.length,
    zeroStock: kits
      .filter((kit) => Number(offersByDsliteId.get(kit.component.dsliteId)?.produto?.estoque || 0) < kit.component.quantity)
      .map((kit) => kit.sku),
  }, null, 2));
  if (!APPLY) return;

  const created = [];
  for (const kit of newKits) {
    const source = offersByDsliteId.get(kit.component.dsliteId).produto;
    const quantity = kit.component.quantity;
    const productPayload = {
      nome: text(kit.row.Descrição),
      marca: brand,
      estoque: Math.floor(Math.max(0, Number(source.estoque || 0)) / quantity),
      custo: Math.round(Math.max(0, Number(source.custo || 0)) * quantity * 100) / 100,
      ml_fee: 0.15,
      peso_liq: number(kit.row['Peso líquido (Kg)']),
      peso_bruto: number(kit.row['Peso bruto (Kg)']),
      largura: number(kit.row['Largura embalagem']),
      altura: number(kit.row['Altura embalagem']),
      profundidade: number(kit.row['Comprimento embalagem']),
      ncm: text(kit.row['Classificação fiscal']) || source.ncm || null,
      cest: text(kit.row.CEST) || null,
      gtin: '',
      descricao: description(kit.row, brand, quantity, text(source.nome)),
      imagens: images(kit.row, source.imagens),
      categoria: source.categoria || null,
      fornecedor: 'BKR1',
      ativo: true,
    };

    let productId = '';
    try {
      const { data: product, error: productError } = await client
        .from('produtos')
        .insert(productPayload)
        .select('id,sku')
        .single();
      if (productError) throw productError;
      productId = text(product.id);

      const { error: kitError } = await client.from('produto_kits').insert({
        produto_id: productId,
        fornecedor_dslite_id: SUPPLIER_ID,
        sku_origem: kit.sku,
        ativo: true,
      });
      if (kitError) throw kitError;

      const { error: componentError } = await client.from('produto_kit_componentes').insert({
        kit_produto_id: productId,
        componente_produto_id: source.id,
        quantidade: quantity,
      });
      if (componentError) throw componentError;
      created.push({ skuOrigem: kit.sku, skuVortek: text(product.sku), produtoId: productId });
    } catch (error) {
      if (productId) {
        const { error: rollbackError } = await client.from('produtos').delete().eq('id', productId);
        if (rollbackError) {
          throw new Error(`${error.message}; rollback falhou para ${productId}: ${rollbackError.message}`);
        }
      }
      throw error;
    }
  }

  console.log(JSON.stringify({ created: created.length, products: created }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
