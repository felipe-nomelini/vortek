/* Importa kits Panasonic do arquivo do fornecedor. Uso: node -r dotenv/config scripts/import-panasonic-kits.js --apply dotenv_config_path=.env.local */
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const SUPPLIER_ID = '108';
const FILE = path.resolve(process.cwd(), 'Panasonic.xls');
const composite = {
  '2313-2292K2': { 2313: 1, 2292: 2 },
  '2312-2292K2': { 2312: 1, 2292: 2 },
  '2312-2313-2292': { 2312: 1, 2313: 1, 2292: 1 },
  '2312-2313-2292K2': { 2312: 1, 2313: 1, 2292: 2 },
  '2313K2-2292K4': { 2313: 2, 2292: 4 },
  '2312K2-2292K4': { 2312: 2, 2292: 4 },
  '2312-2313-2292K4': { 2312: 1, 2313: 1, 2292: 4 },
  '2292K-10': { 2292: 10 },
};

function text(value) { return String(value ?? '').trim(); }
function number(value) { return Number(String(value ?? '').replace(',', '.')) || 0; }
function images(row) {
  return Array.from(new Set([1, 2, 3, 4, 5, 6].map((n) => text(row[`URL imagem ${n}`])).filter(Boolean)));
}
function description(row) {
  const title = text(row.Descrição) || 'Kit Panasonic';
  const brand = text(row.Marca) || 'Panasonic';
  const packaging = text(row['Formato embalagem']);
  const warranty = text(row.Garantia);
  const complement = text(row['Descrição complementar']);
  return [
    title,
    '',
    `Este anúncio corresponde ao kit ${title}.`,
    'Conteúdo da embalagem:',
    `- ${title}`,
    '',
    'Detalhes do produto:',
    `- Marca: ${brand}`,
    ...(packaging ? [`- Embalagem: ${packaging}`] : []),
    ...(warranty ? [`- Garantia do fornecedor: ${warranty}`] : []),
    ...(complement ? ['', complement] : []),
    '',
    'Confira o modelo e a quantidade antes de concluir a compra. Itens não descritos não acompanham o produto.',
  ].join('\n');
}
function componentsFor(sku) {
  if (composite[sku]) return composite[sku];
  const match = /^(\d+)(?:CX|K)(\d+)$/i.exec(sku);
  return match ? { [match[1]]: Number(match[2]) } : null;
}

async function main() {
  const url = text(process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('SUPABASE_SERVICE_URL/NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');

  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(FILE).Sheets.Produtos, { defval: '' });
  const kits = rows.map((row) => ({ row, sku: text(row['Código (SKU)']) }))
    .map(({ row, sku }) => ({ row, sku, components: componentsFor(sku) }))
    .filter((item) => item.components);
  const baseIds = Array.from(new Set(kits.flatMap((kit) => Object.keys(kit.components))));
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: baseOffers, error: baseError } = await client
    .from('produto_fornecedor_ofertas')
    .select('dslite_produto_id,produto_id')
    .eq('dslite_fornecedor_id', SUPPLIER_ID)
    .in('dslite_produto_id', baseIds);
  if (baseError) throw baseError;
  const productByDsliteId = new Map((baseOffers || []).map((offer) => [text(offer.dslite_produto_id), text(offer.produto_id)]));
  const invalid = kits.filter((kit) => Object.keys(kit.components).some((id) => !productByDsliteId.get(id)));
  if (invalid.length) throw new Error(`Componentes BKR1 ausentes: ${invalid.map((kit) => kit.sku).join(', ')}`);

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    kits: kits.length,
    bases: baseIds.length,
    invalid: invalid.length,
    descricao_exemplo: description(kits.find((kit) => kit.sku === '2062K5')?.row || kits[0]?.row || {}),
  }, null, 2));
  if (!APPLY) return;

  let imported = 0;
  let updated = 0;
  for (const kit of kits) {
    const canFulfillInOneDsliteItem = Object.keys(kit.components).length === 1;
    const { data: existingKit, error: kitLookupError } = await client
      .from('produto_kits')
      .select('produto_id')
      .eq('fornecedor_dslite_id', SUPPLIER_ID)
      .eq('sku_origem', kit.sku)
      .maybeSingle();
    if (kitLookupError) throw kitLookupError;

    const sourceComponents = Object.entries(kit.components).map(([dsliteId, quantidade]) => ({
      componente_produto_id: productByDsliteId.get(dsliteId),
      quantidade,
    }));
    let produtoId = text(existingKit?.produto_id);
    if (!produtoId) {
      const row = kit.row;
      const { data: product, error: productError } = await client.from('produtos').insert({
        nome: text(row.Descrição),
        marca: text(row.Marca) || 'Panasonic',
        estoque: 0,
        custo: 0,
        ml_fee: 0.15,
        peso_liq: number(row['Peso líquido (Kg)']),
        peso_bruto: number(row['Peso bruto (Kg)']),
        largura: number(row['Largura embalagem']),
        altura: number(row['Altura embalagem']),
        profundidade: number(row['Comprimento embalagem']),
        ncm: text(row['Classificação fiscal']) || null,
        gtin: text(row['GTIN/EAN']),
        descricao: description(row),
        imagens: images(row),
        categoria: text(row.Categoria) || null,
        fornecedor: 'BKR1',
        // DSLite recebe um produto-base por item. Kits compostos seguem bloqueados.
        ativo: canFulfillInOneDsliteItem,
      }).select('id').single();
      if (productError) throw productError;
      produtoId = text(product.id);
      const { error: newKitError } = await client.from('produto_kits').insert({
        produto_id: produtoId,
        fornecedor_dslite_id: SUPPLIER_ID,
        sku_origem: kit.sku,
        ativo: canFulfillInOneDsliteItem,
      });
      if (newKitError) throw newKitError;
      imported += 1;
    } else {
      await client.from('produto_kit_componentes').delete().eq('kit_produto_id', produtoId);
      const { error: activeError } = await client
        .from('produtos')
        .update({
          ativo: canFulfillInOneDsliteItem,
          descricao: description(kit.row),
        })
        .eq('id', produtoId);
      if (activeError) throw activeError;
      const { error: kitActiveError } = await client
        .from('produto_kits')
        .update({ ativo: canFulfillInOneDsliteItem })
        .eq('produto_id', produtoId);
      if (kitActiveError) throw kitActiveError;
      updated += 1;
    }
    const { error: componentsError } = await client.from('produto_kit_componentes').insert(
      sourceComponents.map((component) => ({ kit_produto_id: produtoId, ...component })),
    );
    if (componentsError) throw componentsError;
  }
  console.log(JSON.stringify({ imported, updated, total: kits.length }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
