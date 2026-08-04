/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: '.env.local', quiet: true });

const CONFIG = {
  VTK000021: { categoryId: 'MLB57843', attributes: [['BRAND', 'UNIPOWER'], ['MODEL', 'UP12120'], ['BATTERY_CAPACITY', '12 Ah'], ['NOMINAL_VOLTAGE', '12 V']] },
  VTK000088: { categoryId: 'MLB57843', attributes: [['BRAND', 'UNIPOWER'], ['MODEL', 'UP1223'], ['BATTERY_CAPACITY', '2.3 Ah'], ['NOMINAL_VOLTAGE', '12 V']] },
  VTK000244: { categoryId: 'MLB44572', attributes: [['BRAND', 'Aquário'], ['MODEL', 'DTV-3000'], ['LOCATION', 'Externo'], ['IS_DIGITAL_FREEVIEW', 'Sim'], ['TV_ANTENNA_FREQUENCY_BAND', 'VHF/UHF/FM/HDTV']] },
  VTK000402: { categoryId: 'MLB270488', attributes: [['BRAND', 'Implastec'], ['MODEL', 'Air Duster Pró'], ['SALE_FORMAT', 'Kit'], ['UNITS_PER_PACK', '12'], ['UNIT_VOLUME', '400 mL']] },
  VTK000427: { categoryId: 'MLB270480', attributes: [['BRAND', 'Implastec'], ['MODEL', 'Álcool Isopropílico Aerossol'], ['UNIT_VOLUME', '227 mL']] },
  VTK000706: { categoryId: 'MLB270088', attributes: [['BRAND', 'Fortrek'], ['MODEL', 'FK 500C CMX'], ['NETWORK_CABLE_TYPE', 'Cabo de rede U/UTP'], ['NETWORK_CABLE_CATEGORY', 'CAT5e'], ['COLOR', 'Branco'], ['LENGTH', '305 m'], ['INCLUDES_CONNECTORS', 'Não']] },
  VTK000841: { categoryId: 'MLB1714', attributes: [['BRAND', 'Fortrek'], ['MODEL', 'Rogue'], ['COLOR', 'Branco'], ['MAIN_COLOR', 'Branco'], ['IS_WIRELESS', 'Sim'], ['WITH_WIRE', 'Não']] },
  VTK001221: { categoryId: 'MLB270480', attributes: [['BRAND', 'Implastec'], ['MODEL', 'Álcool para Limpeza de Eletrônicos 99,8%'], ['UNIT_VOLUME', '1000 mL']] },
  VTK001300: { categoryId: 'MLB73056', attributes: [['BRAND', 'Philips Walita'], ['MODEL', 'RI7630/RI7632/RI7636'], ['COMPATIBLE_BLENDER_BRAND', 'Philips Walita'], ['COMPATIBLE_BLENDERS_MODELS', 'RI7630, RI7632 e RI7636'], ['MATERIAL', 'Plástico']] },
  VTK001318: { categoryId: 'MLB433449', attributes: [['BRAND', 'Hayonik'], ['MODEL', 'MSW2115 Onda Modificada'], ['MIN_INPUT_VOLTAGE', '24 V'], ['MAX_INPUT_VOLTAGE', '24 V'], ['MIN_OUTPUT_VOLTAGE', '127 V'], ['MAX_OUTPUT_VOLTAGE', '127 V'], ['MAX_OPERATING_POWER', '1500 W']] },
  VTK001459: {
    categoryId: 'MLB10233',
    attributes: [['BRAND', 'HH'], ['MODEL', 'TNA-DF1'], ['INSTALLATION_PLACEMENT', 'Piso'], ['MATERIAL', 'Aço']],
    preflight: {
      omitGtin: true,
      emptyGtinReason: { value_id: '17055161', value_name: 'Outro motivo' },
    },
  },
  VTK002659: { categoryId: 'MLB3771', attributes: [['BRAND', 'Yamaha'], ['MODEL', 'YVS-100'], ['SAXOPHONE_TYPE', 'Soprano'], ['COLOR', 'Branco'], ['SAXOPHONE_MATERIAL', 'Resina ABS']] },
  VTK003157: { categoryId: 'MLB420707', attributes: [['BRAND', 'Storm'], ['MODEL', 'Emenda Jack F 1+1'], ['SALE_FORMAT', 'Kit'], ['UNITS_PER_PACK', '100'], ['CONNECTOR_TYPE', 'F'], ['CONNECTOR_GENDER', 'Fêmea'], ['COATING_MATERIAL', 'Metal']] },
  VTK006330: { categoryId: 'MLB1646', attributes: [['BRAND', 'Agratto'], ['MODEL', 'Fit Top'], ['POWER_SUPPLY_TYPE', 'Elétrica'], ['VOLTAGE', '220 V'], ['OUTDOOR_UNIT_VOLTAGE', '220 V'], ['AIR_CONDITIONER_TYPE', 'Split'], ['COOLING_CAPACITY', '12000 BTU'], ['PACKAGING_BOXES_NUMBER', '2']] },
  VTK009748: { categoryId: 'MLB9678', attributes: [['BRAND', 'New York'], ['MODEL', 'Estante Dupla para Conga'], ['COMPATIBLE_INSTRUMENTS', 'Congas'], ['MIN_HEIGHT', '71 cm'], ['MAX_HEIGHT', '122 cm'], ['WEIGHT', '3.8 kg']] },
  VTK012415: {
    categoryId: 'MLB7892',
    attributes: [['BRAND', 'Voxstorm'], ['MODEL', 'PSG 160 USB'], ['RMS_POWER_OUTPUT', '15 W'], ['VOLTAGE', '127/220V'], ['INPUT_CONNECTORS', 'RCA'], ['NUMBER_OF_CHANNELS', '2'], ['WITH_USB', 'Sim'], ['WITH_DISPLAY', 'Não'], ['WIDTH', '31.6 cm'], ['HEIGHT', '6.5 cm'], ['DEPTH', '16 cm'], ['WEIGHT', '1.2 kg']],
    preflight: { trustedOptionalAttributeOverrides: true },
  },
  VTK012425: {
    categoryId: 'MLB7892',
    attributes: [['BRAND', 'Voxstorm'], ['MODEL', 'PSG 180'], ['RMS_POWER_OUTPUT', '40 W'], ['VOLTAGE', '127/220V'], ['INPUT_CONNECTORS', 'RCA'], ['NUMBER_OF_CHANNELS', '2'], ['WITH_USB', 'Não'], ['WITH_DISPLAY', 'Não'], ['WIDTH', '31 cm'], ['HEIGHT', '8.5 cm'], ['DEPTH', '21.5 cm'], ['WEIGHT', '3 kg']],
    preflight: { trustedOptionalAttributeOverrides: true },
  },
};

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function main() {
  const pendingOnly = process.argv.includes('--pending-only');
  const skus = Object.keys(CONFIG);
  const { data: products, error } = await supabase.from('produtos').select('*').in('sku', skus);
  if (error) throw new Error(error.message);
  const items = skus.map((sku) => {
    const product = (products || []).find((row) => row.sku === sku);
    if (!product) throw new Error(`${sku}: produto não encontrado`);
    if (product.ml_item_id) {
      if (pendingOnly) return null;
      throw new Error(`${sku}: ainda possui anúncio vinculado ${product.ml_item_id}`);
    }
    if (Number(product.estoque) <= 0) throw new Error(`${sku}: sem estoque`);
    const config = CONFIG[sku];
    return {
      produtoId: product.id,
      sku,
      nome: product.nome,
      fornecedor: product.fornecedor,
      estoque: product.estoque,
      custo: product.custo,
      categoryId: config.categoryId,
      description: product.descricao,
      attributeOverrides: config.attributes.map(([id, value_name]) => ({ id, value_name })),
      pricingStrategy: { margin: 0.15, minProfit: 20 },
      preflight: {
        exactCategoryReviewed: true,
        exactAttributesReviewed: true,
        sources: ['ERP/DSLite', 'API oficial do Mercado Livre'],
        ...(config.preflight || {}),
      },
    };
  }).filter(Boolean);
  const outputPath = path.resolve('reports/ml-repair-2026-08-03/replacements-manifest.json');
  fs.writeFileSync(outputPath, `${JSON.stringify({ batchId: 'ml-replacements-2026-08-03', strategy: 'safe_one_by_one', items }, null, 2)}\n`);
  console.log(JSON.stringify({ total: items.length, outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
