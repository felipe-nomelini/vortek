/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const TITLES = {
  VTK000021: 'Bateria Selada Unipower UP12120 12V 12Ah VRLA',
  VTK000088: 'Bateria Selada Unipower UP1223 12V 2,3Ah VRLA',
  VTK000244: 'Antena Externa Aquário DTV-3000 VHF UHF FM HDTV',
  VTK000402: 'Kit 12 Air Duster Implastec Pró 400ml',
  VTK000427: 'Kit 12 Álcool Isopropílico Spray Implastec 227ml',
  VTK000706: 'Cabo Rede Fortrek FK500C CAT5e 305m Branco',
  VTK000841: 'Mouse Gamer Sem Fio Fortrek Rogue Branco 16000 DPI',
  VTK001221: 'Kit 18 Álcool Isopropílico Implastec 1L 99,8%',
  VTK001300: 'Kit 6 Copos Mixer Philips Walita RI7630 RI7632 RI7636',
  VTK001318: 'Inversor Hayonik MSW2115 1500W 24V Para 127V',
  VTK001459: 'Suporte Móvel Subwoofer HH TNA-DF1 Aço',
  VTK002659: 'Venova Yamaha YVS-100 Soprano Branco Com Estojo',
  VTK003157: 'Kit 100 Emendas Jack F Fêmea Metal Storm',
  VTK006330: 'Ar-Condicionado Agratto Fit Top 12000 BTU Split 220V',
  VTK009748: 'Estante Dupla Para Conga New York Cromada',
  VTK012415: 'Cabeçote Amplificador Voxstorm PSG160 USB Bluetooth 15W',
  VTK012425: 'Cabeçote Amplificador Voxstorm PSG180 40W Bivolt',
};

const DESCRIPTIONS = {
  VTK000021: `BATERIA SELADA UNIPOWER UP12120 12V 12AH

Bateria estacionária selada VRLA indicada para equipamentos compatíveis de energia de reserva, como nobreaks, telecomunicações, sistemas de segurança, iluminação de emergência e sinalização.

ESPECIFICAÇÕES
- Marca: Unipower
- Modelo: UP12120
- Tensão nominal: 12 V
- Capacidade: 12 Ah
- Tecnologia: chumbo-ácido selada VRLA
- Dimensões aproximadas: 15,1 x 10 x 9,8 cm
- Peso bruto aproximado: 3,703 kg

CONTEÚDO DA EMBALAGEM
- 1 bateria estacionária Unipower UP12120

Confirme tensão, capacidade, dimensões e terminais exigidos pelo equipamento antes da compra.

SKU: VTK000021`,
  VTK000088: `BATERIA SELADA UNIPOWER UP1223 12V 2,3AH

Bateria estacionária selada VRLA indicada para equipamentos compatíveis de energia de reserva, alarmes, iluminação de emergência e sistemas de segurança.

ESPECIFICAÇÕES
- Marca: Unipower
- Modelo: UP1223
- Tensão nominal: 12 V
- Capacidade: 2,3 Ah
- Tecnologia: chumbo-ácido selada VRLA
- Dimensões aproximadas: 17,8 x 6,6 x 3,4 cm
- Peso bruto aproximado: 0,973 kg

CONTEÚDO DA EMBALAGEM
- 1 bateria estacionária Unipower UP1223

Confirme tensão, capacidade, dimensões e terminais exigidos pelo equipamento antes da compra.

SKU: VTK000088`,
  VTK000244: `ANTENA EXTERNA AQUÁRIO DTV-3000 4 EM 1

Antena externa para recepção de canais VHF, UHF, FM e HDTV, compatível com sinais digitais e analógicos.

CARACTERÍSTICAS
- Marca: Aquário
- Modelo: DTV-3000
- Instalação: externa
- Recepção: VHF, UHF, FM e HDTV
- Compatível com TVs e conversores digitais
- Cabo coaxial incluso: 16 metros
- Produto pré-montado para facilitar a instalação

CONTEÚDO DA EMBALAGEM
- 1 antena externa Aquário DTV-3000
- Dipolos, mastro e suporte de parede
- Cabo coaxial de 16 metros
- Parafusos de fixação
- Manual de instalação

SKU: VTK000244`,
  VTK000402: `KIT 12 AIR DUSTER IMPLASTEC PRÓ 400ML

Caixa com doze aerossóis de ar comprimido para remoção de poeira e pequenas sujeiras em áreas de difícil acesso.

CARACTERÍSTICAS
- Marca: Implastec
- Linha: Air Duster Pró
- Conteúdo por lata: 400 ml
- Quantidade: 12 latas
- Jato de ar para limpeza sem contato
- Indicado para aplicações compatíveis em eletrônicos e equipamentos

CONTEÚDO DA EMBALAGEM
- 12 latas de Air Duster Implastec Pró 400 ml

CUIDADOS
- Produto inflamável e pressurizado
- Use somente conforme as instruções da embalagem
- Mantenha longe de calor, chamas e do alcance de crianças

SKU: VTK000402`,
  VTK001221: `KIT 18 ÁLCOOIS ISOPROPÍLICOS IMPLASTEC 1 LITRO

Caixa com dezoito frascos de álcool isopropílico Implastec com pureza de 99,8%, indicado para limpeza técnica de componentes eletrônicos e placas de circuito impresso.

CARACTERÍSTICAS
- Marca: Implastec
- Princípio ativo: isopropanol
- Pureza: 99,8%
- Conteúdo por frasco: 1.000 ml
- Quantidade: 18 frascos
- Cor: incolor
- Ação desengordurante sem deixar resíduos

CONTEÚDO DA EMBALAGEM
- 18 frascos de álcool isopropílico Implastec 1 litro

CUIDADOS
- Produto inflamável
- Use máscara, óculos de proteção e mantenha o ambiente ventilado
- Mantenha o recipiente fechado, em local fresco e longe de fontes de ignição

SKU: VTK001221`,
  VTK006330: `AR-CONDICIONADO AGRATTO FIT TOP 12.000 BTU 220V

Ar-condicionado Split Agratto Fit Top indicado para climatização residencial em instalação elétrica 220 V.

CARACTERÍSTICAS
- Marca: Agratto
- Linha: Fit Top
- Tipo: Split
- Capacidade de refrigeração: 12.000 BTU/h
- Tensão: 220 V
- Classificação energética: Classe A
- Serpentina de cobre
- Gás refrigerante R410A
- Painel com iluminação backlight

CONTEÚDO DA EMBALAGEM
- 1 unidade interna evaporadora
- 1 unidade externa condensadora
- Controle remoto e documentação do fabricante

O produto é enviado em duas caixas. A instalação deve ser feita por profissional qualificado.

SKU: VTK006330`,
};

const EXPECTED_CATEGORIES = {
  VTK000021: 'MLB57843', VTK000088: 'MLB57843', VTK000244: 'MLB44572', VTK000402: 'MLB270488',
  VTK000427: 'MLB270480', VTK000706: 'MLB270088', VTK000841: 'MLB1714', VTK001221: 'MLB270480',
  VTK001300: 'MLB73056', VTK001318: 'MLB433449', VTK001459: 'MLB10233', VTK002659: 'MLB3771',
  VTK003157: 'MLB420707', VTK006330: 'MLB1646', VTK009748: 'MLB9678', VTK012415: 'MLB7892', VTK012425: 'MLB7892',
};

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function main() {
  const onlySkus = String(
    process.argv.find((argument) => argument.startsWith('--only-skus='))?.split('=')[1] || '',
  ).split(',').map((sku) => sku.trim()).filter(Boolean);
  const skus = Object.keys(TITLES).filter((sku) => onlySkus.length === 0 || onlySkus.includes(sku));
  const [{ data: products, error: productError }, { data: integration, error: integrationError }] = await Promise.all([
    supabase.from('produtos').select('*').in('sku', skus),
    supabase.from('integracoes').select('access_token').eq('tipo', 'mercadolivre').single(),
  ]);
  if (productError) throw new Error(productError.message);
  if (integrationError || !integration?.access_token) throw new Error(integrationError?.message || 'Token ML indisponível');

  const dryRuns = [
    'reports/ml-repair-2026-08-03/replacements-dry-run-result.json',
    'reports/ml-repair-2026-08-03/replacements-pending-dry-run.json',
    'reports/ml-repair-2026-08-03/amplifiers-correct-category-dry-run.json',
  ].flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')).created || []);

  const corrections = [];
  for (const sku of skus) {
    const product = (products || []).find((row) => row.sku === sku);
    if (!product?.ml_item_id) throw new Error(`${sku}: anúncio novo não vinculado`);
    const [itemResponse, descriptionResponse] = await Promise.all([
      fetch(`https://api.mercadolibre.com/items/${product.ml_item_id}?include_internal_attributes=true`, { headers: { Authorization: `Bearer ${integration.access_token}` } }),
      fetch(`https://api.mercadolibre.com/items/${product.ml_item_id}/description`, { headers: { Authorization: `Bearer ${integration.access_token}` } }),
    ]);
    const item = await itemResponse.json();
    const description = await descriptionResponse.json();
    if (!itemResponse.ok || item.category_id !== EXPECTED_CATEGORIES[sku]) {
      throw new Error(`${sku}: categoria final divergente ${item.category_id || itemResponse.status}`);
    }
    const dryRun = [...dryRuns].reverse().find((row) => row.sku === sku);
    const attributes = (dryRun?.attributes || [])
      .filter((attribute) => !['GTIN', 'EMPTY_GTIN_REASON'].includes(attribute.id))
      .map(({ id, value_id, value_name }) => ({ id, ...(value_id ? { value_id } : {}), ...(value_name ? { value_name } : {}) }));
    attributes.push(
      { id: 'SELLER_SKU', value_name: sku },
      { id: 'SELLER_PACKAGE_HEIGHT', value_name: `${product.altura} cm` },
      { id: 'SELLER_PACKAGE_WIDTH', value_name: `${product.largura} cm` },
      { id: 'SELLER_PACKAGE_LENGTH', value_name: `${product.profundidade} cm` },
      { id: 'SELLER_PACKAGE_WEIGHT', value_name: `${Math.round(Number(product.peso_bruto) * 1000)} g` },
    );
    const isUserProduct = (item.tags || []).includes('user_product_listing');
    corrections.push({
      ml_item_id: product.ml_item_id,
      sku,
      ...(isUserProduct ? { family_name: TITLES[sku] } : { title: TITLES[sku] }),
      description: DESCRIPTIONS[sku] || String(description.plain_text || '')
        .replace(/^•\s*/gm, '- ')
        .replace(/\n(VISÃO GERAL|CARACTERÍSTICAS CONFIRMADAS|IDENTIFICAÇÃO DO PRODUTO|CONTEÚDO DA EMBALAGEM|EMBALAGEM)\n/g, '\n\n$1\n'),
      attributes,
    });
  }

  const outputPath = path.resolve('reports/ml-repair-2026-08-03/created-replacements-corrections.json');
  fs.writeFileSync(outputPath, `${JSON.stringify({ generated_at: new Date().toISOString(), corrections }, null, 2)}\n`);
  console.log(JSON.stringify({ total: corrections.length, outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
