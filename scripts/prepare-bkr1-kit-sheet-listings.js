/* Prepara anúncios de kits simples BKR1 cadastrados a partir de uma planilha.
 *
 * Uso:
 *   node scripts/prepare-bkr1-kit-sheet-listings.js --file "/caminho/Elixir.xls"
 *   node scripts/prepare-bkr1-kit-sheet-listings.js --file "/caminho/Elixir.xls" --mirror-images
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const sharp = require('sharp');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { assertAllowedMercadoLivreToken } = require('./lib/ml-token-guard');

dotenv.config({ path: '.env.local' });

const FILE_INDEX = process.argv.indexOf('--file');
const SOURCE_FILE = FILE_INDEX >= 0 ? path.resolve(process.argv[FILE_INDEX + 1] || '') : '';
const MIRROR_IMAGES = process.argv.includes('--mirror-images');
const SUPPLIER_ID = '108';
const DEFAULT_CATEGORY_ID = 'MLB278076';
const BATCH_SIZE = Math.max(1, Number(process.env.ML_BATCH_SIZE || '5'));
const BUCKET = 'product-images';
const STORAGE_PREFIX =
  'https://supabase.vortek.shop/storage/v1/object/public/product-images/';
const REPORT_ROOT = path.join(process.cwd(), 'reports', 'ml-anuncio-batches');

const SHEET_CONFIGS = {
  atk: {
    brand: 'Atk Eletroacústica',
    allowedComponentCategoryMismatches: [1556],
    categories: {
      1539: 'MLB418066',
      1540: 'MLB46559',
      1541: 'MLB46559',
      1542: 'MLB418066',
      1552: 'MLB3905',
      1553: 'MLB3905',
      1554: 'MLB3905',
      1556: 'MLB3905',
      1562: 'MLB3905',
      1565: 'MLB3905',
      1567: 'MLB3905',
      1568: 'MLB3905',
      1570: 'MLB3905',
    },
    models: {
      1539: '35MH2560B-8',
      1540: '45MH2580B-8',
      1541: '45MH2510B-8',
      1542: '75MH5016B-8',
      1552: '8WF310B8',
      1553: '10WF310B8',
      1554: '10WF510B8',
      1556: 'WF3004600B2',
      1562: 'WF200800B8',
      1565: 'WF3001200B4',
      1567: 'WF300500B4',
      1568: 'WF300500B8',
      1570: 'WF380500B8',
    },
    attributes: {
      1539: { kind: 'driver', material: 'Titânio', power: 30, impedance: 8, diameter: '25 mm', hornDiameter: '1 in', minFrequency: 1500, maxFrequency: 18000 },
      1540: { kind: 'driver', material: 'Titânio', power: 40, impedance: 8, diameter: '25 mm', hornDiameter: '1 in', minFrequency: 1500, maxFrequency: 18000 },
      1541: { kind: 'driver', material: 'Poliéster', power: 50, impedance: 8, diameter: '25 mm', hornDiameter: '1 in', minFrequency: 1500, maxFrequency: 18000 },
      1542: { kind: 'driver', material: 'Titânio', power: 80, impedance: 8, diameter: '50 mm', hornDiameter: '2 in', minFrequency: 600, maxFrequency: 18000 },
      1552: { kind: 'speaker', power: 150, impedance: 8, diameter: 8, frequencyRange: '50 a 3000 Hz', sensitivity: 95 },
      1553: { kind: 'speaker', power: 150, impedance: 8, diameter: 10, frequencyRange: '50 a 3000 Hz', sensitivity: 94 },
      1554: { kind: 'speaker', power: 250, impedance: 8, diameter: 10 },
      1556: { kind: 'speaker', power: 1300, impedance: 2, diameter: 12, frequencyRange: '60 a 2500 Hz', sensitivity: 95 },
      1562: { kind: 'speaker', power: 400, impedance: 8, diameter: 8, frequencyRange: '50 a 4000 Hz', sensitivity: 93 },
      1565: { kind: 'speaker', power: 600, impedance: 4, diameter: 12, frequencyRange: '60 a 3000 Hz', sensitivity: 95 },
      1567: { kind: 'speaker', power: 250, impedance: 4, diameter: 12, frequencyRange: '50 a 2000 Hz', sensitivity: 95 },
      1568: { kind: 'speaker', power: 250, impedance: 8, diameter: 12, frequencyRange: '40 a 2500 Hz', sensitivity: 96 },
      1570: { kind: 'speaker', power: 250, impedance: 8, diameter: 15, frequencyRange: '30 a 5000 Hz', sensitivity: 96 },
    },
  },
  duracell: {
    brand: 'Duracell',
    categoryId: 'MLB7060',
    allowVerifiedCategoryFallback: true,
    blockedComponentIds: [3865, 3866, 3870, 3871],
    models: {
      3852: 'MN1604',
      3853: 'MN1604',
      3854: 'MN1500',
      3855: 'MN1500',
      3856: 'MN1500',
      3857: 'MN1500',
      3858: 'MN2400',
      3859: 'MN2400',
      3860: 'MN2400',
      3862: 'MN1400',
      3863: 'CR2032',
      3864: 'MN1300',
      3865: '10',
      3866: '13',
      3867: 'CR2032',
      3868: 'LR44/A76',
      3869: 'MN21/A23',
      3870: '312',
      3871: '675',
    },
    attributes: {
      3852: { unitsEach: 1, size: '9V', shape: 'Retangular', voltage: '9 V', composition: 'Alcalina' },
      3853: { unitsEach: 2, size: '9V', shape: 'Retangular', voltage: '9 V', composition: 'Alcalina' },
      3854: { unitsEach: 16, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3855: { unitsEach: 2, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3856: { unitsEach: 4, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3857: { unitsEach: 8, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3858: { unitsEach: 16, size: 'AAA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3859: { unitsEach: 2, size: 'AAA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3860: { unitsEach: 4, size: 'AAA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3862: { unitsEach: 2, size: 'C', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3863: { unitsEach: 2, size: 'CR2032', shape: 'Botão', voltage: '3 V', composition: 'Lítio' },
      3864: { unitsEach: 2, size: 'D', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina' },
      3865: { unitsEach: 6, size: '10', shape: 'Botão' },
      3866: { unitsEach: 6, size: '13', shape: 'Botão' },
      3867: { unitsEach: 5, size: 'CR2032', shape: 'Botão', voltage: '3 V', composition: 'Lítio' },
      3868: { unitsEach: 4, size: 'LR44/A76', shape: 'Botão', voltage: '1,5 V', composition: 'Alcalina' },
      3869: { unitsEach: 2, size: 'MN21/A23', shape: 'Cilíndrica', voltage: '12 V', composition: 'Alcalina' },
      3870: { unitsEach: 6, size: '312', shape: 'Botão' },
      3871: { unitsEach: 6, size: '675', shape: 'Botão' },
    },
  },
  elgin: {
    brand: 'Elgin',
    categoryId: 'MLB7060',
    allowVerifiedCategoryFallback: true,
    // Estes GTINs identificam corretamente cartelas Elgin de pilhas-moeda,
    // embora os anúncios unitários estejam na categoria legada MLB431681.
    // Para os kits, publicamos em MLB7060 sem reutilizar o GTIN da cartela.
    allowedComponentCategoryMismatches: [2391, 2392, 2393, 2608, 2611, 2790],
    models: {
      2382: 'AA',
      2383: 'AA',
      2384: 'AAA',
      2386: 'C',
      2391: 'CR2016',
      2392: 'CR2025',
      2393: 'CR2032',
      2395: 'A23',
      2396: '9V 250mAh',
      2397: '6F22 9V',
      2398: 'A23',
      2399: '13 PR48',
      2400: '10/230 PR70',
      2401: '675 PR44',
      2408: 'CR2032',
      2409: '312 PR41',
      2462: 'AAA 1000mAh',
      2463: 'AA 2700mAh',
      2608: 'CR1220',
      2609: 'CR1620',
      2610: 'CR2450',
      2611: 'CR1616',
      2786: '18650 2600mAh',
      2787: 'A27',
      2789: 'LR41',
      2790: 'CR2430',
      2791: 'LR621/AG1',
      2792: 'LR626/AG4',
      2864: 'AA',
      3122: 'AAA 900mAh',
      3123: 'AAA 900mAh',
      3124: 'AA 2500mAh',
      3125: 'AA 2500mAh',
      3666: 'LR1120/AG8',
      3667: 'LR43/AG12',
    },
    attributes: {
      2382: { unitsEach: 2, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2383: { unitsEach: 4, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2384: { unitsEach: 2, size: 'AAA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2386: { unitsEach: 2, size: 'C', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2391: { unitsEach: 5, size: 'CR2016', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2392: { unitsEach: 5, size: 'CR2025', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2393: { unitsEach: 5, size: 'CR2032', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2395: { unitsEach: 5, size: 'A23', shape: 'Cilíndrica', voltage: '12 V', composition: 'Alcalina', rechargeable: false },
      2396: { unitsEach: 1, size: '9V', shape: 'Retangular', voltage: '9 V', composition: 'Ni-MH', rechargeable: true },
      2397: { unitsEach: 1, size: '9V', shape: 'Retangular', voltage: '9 V', composition: 'Zinco-carvão', rechargeable: false },
      2398: { unitsEach: 1, size: 'A23', shape: 'Cilíndrica', voltage: '12 V', composition: 'Alcalina', rechargeable: false },
      2399: { unitsEach: 6, size: '13', shape: 'Botão', voltage: '1,4 V', composition: 'Zinco-ar', rechargeable: false },
      2400: { unitsEach: 6, size: '10/PR70', shape: 'Botão', voltage: '1,4 V', composition: 'Zinco-ar', rechargeable: false },
      2401: { unitsEach: 6, size: '675/PR44', shape: 'Botão', voltage: '1,4 V', composition: 'Zinco-ar', rechargeable: false },
      2408: { unitsEach: 1, size: 'CR2032', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2409: { unitsEach: 6, size: '312/PR41', shape: 'Botão', voltage: '1,4 V', composition: 'Zinco-ar', rechargeable: false },
      2462: { unitsEach: 4, size: 'AAA', shape: 'Cilíndrica', voltage: '1,2 V', composition: 'Ni-MH', rechargeable: true },
      2463: { unitsEach: 4, size: 'AA', shape: 'Cilíndrica', voltage: '1,2 V', composition: 'Ni-MH', rechargeable: true },
      2608: { unitsEach: 5, size: 'CR1220', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2609: { unitsEach: 5, size: 'CR1620', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2610: { unitsEach: 5, size: 'CR2450', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2611: { unitsEach: 5, size: 'CR1616', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2786: { unitsEach: 1, size: '18650', shape: 'Cilíndrica', voltage: '3,7 V', composition: 'Lítio', rechargeable: true, itemLabel: 'baterias' },
      2787: { unitsEach: 5, size: 'A27', shape: 'Cilíndrica', voltage: '12 V', composition: 'Alcalina', rechargeable: false },
      2789: { unitsEach: 10, size: 'LR41', shape: 'Botão', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2790: { unitsEach: 5, size: 'CR2430', shape: 'Botão', voltage: '3 V', composition: 'Lítio', rechargeable: false },
      2791: { unitsEach: 10, size: 'LR621/AG1', shape: 'Botão', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2792: { unitsEach: 10, size: 'LR626/AG4', shape: 'Botão', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      2864: { unitsEach: 8, size: 'AA', shape: 'Cilíndrica', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      3122: { unitsEach: 2, size: 'AAA', shape: 'Cilíndrica', voltage: '1,2 V', composition: 'Ni-MH', rechargeable: true },
      3123: { unitsEach: 4, size: 'AAA', shape: 'Cilíndrica', voltage: '1,2 V', composition: 'Ni-MH', rechargeable: true },
      3124: { unitsEach: 2, size: 'AA', shape: 'Cilíndrica', voltage: '1,2 V', composition: 'Ni-MH', rechargeable: true, itemLabel: 'pilhas' },
      3125: { unitsEach: 4, size: 'AA', shape: 'Cilíndrica', voltage: '1,2 V', composition: 'Ni-MH', rechargeable: true },
      3666: { unitsEach: 10, size: 'LR1120/AG8', shape: 'Botão', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
      3667: { unitsEach: 10, size: 'LR43/AG12', shape: 'Botão', voltage: '1,5 V', composition: 'Alcalina', rechargeable: false },
    },
  },
  elixir: {
    brand: 'Elixir',
    categoryId: DEFAULT_CATEGORY_ID,
    models: {
      1421: '11002',
      1422: '11027',
      1423: '11052',
      1424: '12002',
      1425: '12027',
      1426: '12052',
      1427: '12102',
      1428: '16002',
      1429: '16027',
      1430: '19052',
      2042: 'Cordas 013 Medium 80/20 Nanoweb',
      2043: '16052',
      2496: '19002',
      2497: '19102',
    },
    attributes: {},
  },
  nig: {
    brand: 'NIG',
    categoryId: DEFAULT_CATEGORY_ID,
    models: {
      1403: 'N475',
      1404: 'N500',
      1405: 'N511',
      1406: 'N63',
      1407: 'N64',
      1417: 'NPB520',
      1418: 'NPB560',
    },
    attributes: {
      1403: {
        instrument: 'Violão acústico',
        materials: 'Nylon cristal e bordões de aço revestido com cobre prateado',
        tension: 'Média',
      },
      1404: {
        instrument: 'Violão acústico',
        materials: 'Aço com bronze 85/15',
        gauges: '.010 - .050',
      },
      1405: {
        instrument: 'Violão acústico',
        materials: 'Aço com bronze 85/15',
        gauges: '.011 - .050',
        tension: 'Média',
      },
      1406: {
        instrument: 'Guitarra elétrica',
        materials: 'Aço niquelado',
        gauges: '.009 - .042',
        tension: 'Leve',
      },
      1407: {
        instrument: 'Guitarra elétrica',
        materials: 'Aço niquelado',
        gauges: '.010 - .046',
        tension: 'Média',
      },
      1417: {
        instrument: 'Violão acústico',
        materials: 'Aço com fósforo bronze',
        gauges: '.011 - .050',
        tension: 'Média',
      },
      1418: {
        instrument: 'Violão acústico',
        materials: 'Aço com fósforo bronze',
        gauges: '.010 - .047',
      },
    },
  },
  giannini: {
    brand: 'Giannini',
    categoryId: DEFAULT_CATEGORY_ID,
    allowVerifiedCategoryFallback: true,
    models: {
      1741: 'GESPW',
      1742: 'GENWBG',
      1743: 'GENWBS',
      1744: 'GENWG',
      1745: 'GENWS',
      1746: 'GENWPL',
      1747: 'GENWPA',
      1748: 'GESVL',
      1749: 'GESVM',
      1750: 'GESCL',
      1751: 'GESCP',
      1752: 'GEEWAK',
      1753: 'GEEWAK',
      1754: 'GEEGST.8',
      1757: 'GEAVVA',
      1822: 'GESWB',
      1823: 'GENW',
      1824: 'GESWAL',
      1825: 'GEEFLE',
      1826: 'GEEGST.11',
      1827: 'GESGT9',
      1829: 'GENWB',
      1830: 'GEEFLK',
      1831: 'GEEGST.9',
      1833: 'GENWPM',
      1834: 'GEEGST.10',
      1835: 'GESWAM',
    },
    attributes: {
      1741: { instrument: 'Violão acústico', materials: 'Metal', tension: 'Alta', stringsNumber: 6, line: 'Acústico' },
      1742: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'MPB' },
      1743: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'MPB' },
      1744: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'MPB' },
      1745: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'MPB' },
      1746: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Leve', stringsNumber: 6, line: 'Clássico' },
      1747: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Alta', stringsNumber: 6, line: 'Clássico' },
      1748: { instrument: 'Viola Caipira', materials: 'Metal', tension: 'Leve', stringsNumber: 10, line: 'Cobra' },
      1749: { instrument: 'Viola Caipira', materials: 'Metal', tension: 'Média', stringsNumber: 10, line: 'Cobra' },
      1750: { instrument: 'Cavaquinho', materials: 'Metal', tension: 'Leve', stringsNumber: 4, line: 'Cobra' },
      1751: { instrument: 'Cavaquinho', materials: 'Metal', tension: 'Alta', stringsNumber: 4, line: 'Cobra' },
      1752: { instrument: 'Violão acústico', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Cobra' },
      1753: { instrument: 'Violão acústico', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Cobra' },
      1754: { instrument: 'Guitarra elétrica', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Electric' },
      1757: { instrument: 'Violino', materials: 'Metal', tension: 'Média', stringsNumber: 4, line: 'Arco' },
      1822: { instrument: 'Violão acústico', materials: 'Metal', tension: 'Média', stringsNumber: 6, line: 'Canário' },
      1823: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'Canário' },
      1824: { instrument: 'Violão acústico', materials: 'Metal', stringsNumber: 6, line: 'Acústico' },
      1825: { instrument: 'Violão acústico', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Cobra' },
      1826: { instrument: 'Guitarra elétrica', materials: 'Metal', tension: 'Média', stringsNumber: 6, line: 'Electric' },
      1827: { instrument: 'Guitarra elétrica', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Canário' },
      1829: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'Canário' },
      1830: { instrument: 'Violão acústico', materials: 'Metal', tension: 'Média', stringsNumber: 6, line: 'Cobra' },
      1831: { instrument: 'Guitarra elétrica', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Electric' },
      1833: { instrument: 'Violão acústico', materials: 'Náilon', tension: 'Média', stringsNumber: 6, line: 'Clássico' },
      1834: { instrument: 'Guitarra elétrica', materials: 'Metal', tension: 'Leve', stringsNumber: 6, line: 'Electric' },
      1835: { instrument: 'Violão acústico', materials: 'Metal', stringsNumber: 6, line: 'Acústico' },
    },
  },
};
const SHEET_SLUG = path
  .basename(SOURCE_FILE, path.extname(SOURCE_FILE))
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const SHEET_CONFIG = SHEET_CONFIGS[SHEET_SLUG];

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function text(value) {
  return String(value ?? '').trim();
}

function digits(value) {
  return text(value).replace(/\D/g, '');
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sourceId(sourceSku) {
  return Number(text(sourceSku).match(/^(\d+)/)?.[1] || 0);
}

function sourceQuantity(sourceSku) {
  return Number(text(sourceSku).match(/(?:CX|K)(\d+)$/i)?.[1] || 0);
}

function categoryForSource(sourceSku) {
  const source = sourceId(sourceSku);
  return text(SHEET_CONFIG.categories?.[source] || SHEET_CONFIG.categoryId);
}

function instrument(name) {
  return /guitarra/i.test(text(name)) ? 'Guitarra elétrica' : 'Violão acústico';
}

function tension(name) {
  const value = text(name);
  if (/custom light/i.test(value)) return 'Custom Light';
  if (/super light/i.test(value)) return 'Super Light';
  if (/extra light/i.test(value)) return 'Extra Light';
  if (/medium/i.test(value)) return 'Medium';
  if (/\blight\b/i.test(value)) return 'Light';
  return '';
}

function gauges(description) {
  const match = text(description).match(
    /calibre\s*:\s*(?:[^(\n]{0,50}\()?(\.?\d{2,3})\s*[-–]\s*(\.?\d{2,3})/i,
  );
  if (!match) return '';
  const normalize = (value) => `.${value.replace(/\D/g, '').padStart(3, '0')}`;
  return `${normalize(match[1])} - ${normalize(match[2])}`;
}

function imageList(value) {
  return Array.isArray(value) ? unique(value).slice(0, 12) : [];
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function duracellTotalUnits(sourceSku, productName, componentQuantity) {
  const source = sourceId(sourceSku);
  const unitsEach = Number(SHEET_CONFIG.attributes?.[source]?.unitsEach || 0);
  const calculated = unitsEach * Number(componentQuantity || 0);
  const declared = Number(text(productName).match(/^(\d+)\s+/)?.[1] || 0);
  return declared > 0 && declared === calculated ? declared : 0;
}

function elginTotalUnits(sourceSku, productName, componentQuantity) {
  const source = sourceId(sourceSku);
  const unitsEach = Number(SHEET_CONFIG.attributes?.[source]?.unitsEach || 0);
  const calculated = unitsEach * Number(componentQuantity || 0);
  const declared = Number(text(productName).match(/^(\d+)\s+/)?.[1] || 0);
  return declared > 0 && declared === calculated ? declared : 0;
}

function pricePreview(product) {
  const cost = Number(product.custo || 0);
  const shipping = Number(product.ml_shipping || 0);
  const fee = Number(product.ml_fee || 0.15);
  const strategy =
    cost <= 400
      ? { margin: 0.15, minProfit: 20 }
      : cost <= 1000
        ? { margin: 0.2, minProfit: 60 }
        : { margin: 0.25, minProfit: 150 };
  const denominator = 1 - 0.04 - fee;
  if (!(cost > 0) || denominator <= 0) return null;
  return round2(
    Math.max(
      (cost + shipping + cost * strategy.margin) / denominator,
      (cost + shipping + strategy.minProfit) / denominator,
    ),
  );
}

async function mlAccount() {
  const { data, error } = await supabase
    .from('integracoes')
    .select('access_token')
    .eq('tipo', 'mercadolivre')
    .single();
  if (error || !data?.access_token) {
    throw new Error(`Token ML indisponível: ${error?.message || 'sem token'}`);
  }
  const account = await assertAllowedMercadoLivreToken(
    data.access_token,
    'prepare-bkr1-kit-sheet-listings',
  );
  return {
    token: data.access_token,
    userId: String(account.userId),
    nickname: String(account.nickname || ''),
  };
}

async function fetchMl(account, apiPath) {
  const response = await fetch(`https://api.mercadolibre.com${apiPath}`, {
    headers: { Authorization: `Bearer ${account.token}` },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${apiPath} HTTP ${response.status}: ${payload?.message || 'erro'}`,
    );
  }
  return payload;
}

async function searchLiveSku(account, sku) {
  const results = await Promise.all(
    ['sku', 'seller_sku'].map((field) =>
      fetchMl(
      account,
      `/users/${account.userId}/items/search?${field}=${encodeURIComponent(sku)}&limit=100`,
      ),
    ),
  );
  return unique(
    results.flatMap((result) =>
      Array.isArray(result?.results) ? result.results.map(String) : [],
    ),
  );
}

async function normalizeImage(sourceUrl) {
  const response = await fetch(sourceUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'Vortek/1.0 BKR1-kit-image-audit' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = text(response.headers.get('content-type')).split(';')[0];
  if (!contentType.startsWith('image/')) {
    throw new Error(`content-type ${contentType || 'ausente'}`);
  }
  const source = Buffer.from(await response.arrayBuffer());
  if (!source.length || source.length > 10 * 1024 * 1024) {
    throw new Error(`tamanho inválido ${source.length}`);
  }
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) throw new Error('dimensões ausentes');
  if (metadata.width < 250 || metadata.height < 250) {
    throw new Error(`dimensões insuficientes ${metadata.width}x${metadata.height}`);
  }
  let pipeline = sharp(source).rotate().flatten({ background: '#ffffff' });
  if (Math.max(metadata.width, metadata.height) <= 500) {
    pipeline = pipeline.resize({
      width: 800,
      height: 800,
      fit: 'inside',
      withoutEnlargement: false,
    });
  }
  return pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function mirrorImage(product, sourceUrl, position) {
  if (sourceUrl.startsWith(STORAGE_PREFIX)) {
    const response = await fetch(sourceUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    });
    if (
      response.status !== 200 ||
      !text(response.headers.get('content-type')).startsWith('image/')
    ) {
      throw new Error(`imagem Vortek indisponível HTTP ${response.status}`);
    }
    return sourceUrl;
  }
  if (!MIRROR_IMAGES) throw new Error('image_mirror_required');
  const normalized = await normalizeImage(sourceUrl);
  const hash = crypto
    .createHash('sha256')
    .update(sourceUrl)
    .update(normalized)
    .digest('hex')
    .slice(0, 20);
  const objectPath =
    `catalog/bkr1-kits/${SHEET_SLUG}/${product.sku}/` +
    `${String(position + 1).padStart(2, '0')}-${hash}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, normalized, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
  if (error && !/already exists/i.test(error.message || '')) {
    throw new Error(`upload: ${error.message}`);
  }
  const publicUrl = `${STORAGE_PREFIX}${objectPath}`;
  const validation = await fetch(publicUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  if (
    validation.status !== 200 ||
    !text(validation.headers.get('content-type')).startsWith('image/')
  ) {
    throw new Error(`URL pública inválida HTTP ${validation.status}`);
  }
  return publicUrl;
}

async function prepareImages(product) {
  const sources = imageList(product.imagens);
  const attempts = await Promise.all(
    sources.map(async (source, index) => {
      try {
        return { ok: true, url: await mirrorImage(product, source, index) };
      } catch (error) {
        return { ok: false, url: source, error: error.message };
      }
    }),
  );
  const prepared = attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.url);
  const failures = attempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => ({ url: attempt.url, error: attempt.error }));
  if (!prepared.length) {
    return { ok: false, reason: failures[0]?.error || 'sem imagem válida', failures };
  }
  if (MIRROR_IMAGES && JSON.stringify(prepared) !== JSON.stringify(sources)) {
    const { error } = await supabase
      .from('produtos')
      .update({ imagens: prepared })
      .eq('id', product.id);
    if (error) {
      return { ok: false, reason: `falha ao atualizar imagens: ${error.message}`, failures };
    }
  }
  return { ok: true, images: prepared, failures };
}

function attributesFor(row, product, quantity) {
  const source = sourceId(row.sku_origem);
  const verified = SHEET_CONFIG.attributes[source] || {};
  if (SHEET_SLUG === 'atk') {
    const common = [
      { id: 'BRAND', value_name: SHEET_CONFIG.brand },
      { id: 'MODEL', value_name: SHEET_CONFIG.models[source] },
      { id: 'VEHICLE_TYPE', value_id: '11377043', value_name: 'Carro/Caminhonete' },
      { id: 'IS_KIT', value_id: '242085', value_name: 'Sim' },
    ];
    if (verified.kind === 'driver') {
      return [
        ...common,
        { id: 'PART_NUMBER', value_name: SHEET_CONFIG.models[source] },
        { id: 'MATERIAL', value_name: verified.material },
        { id: 'IMPEDANCE', value_name: `${verified.impedance} Ω` },
        { id: 'MIN_FREQUENCY', value_name: `${verified.minFrequency} Hz` },
        { id: 'MAX_FREQUENCY', value_name: `${verified.maxFrequency} Hz` },
        { id: 'DIAMETER', value_name: verified.diameter },
        { id: 'HORN_DIAMETER', value_name: verified.hornDiameter },
      ];
    }
    return [
      ...common,
      { id: 'VEHICLE_SPEAKER_WIDTH', value_name: `${verified.diameter} in` },
      { id: 'VEHICLE_SPEAKER_DIAMETER', value_name: `${verified.diameter} in` },
      { id: 'COLOR', value_name: 'Preto' },
      { id: 'IMPEDANCE', value_name: `${verified.impedance} Ω` },
      { id: 'SPEAKERS_NUMBER', value_name: String(quantity) },
      { id: 'VEHICLE_SPEAKER_TYPE', value_id: '7509874', value_name: 'Woofer' },
      { id: 'COILS_NUMBER', value_name: '1' },
      { id: 'RMS_POWER', value_name: `${verified.power} W` },
      ...(verified.frequencyRange
        ? [{ id: 'FREQUENCY_RANGE', value_name: verified.frequencyRange }]
        : []),
      ...(verified.sensitivity
        ? [{ id: 'SENSITIVITY', value_name: `${verified.sensitivity} dB` }]
        : []),
    ];
  }
  if (SHEET_SLUG === 'duracell') {
    const totalUnits = duracellTotalUnits(row.sku_origem, product.nome, quantity);
    return [
      { id: 'BRAND', value_id: '106681', value_name: 'Duracell' },
      { id: 'MODEL', value_name: SHEET_CONFIG.models[source] },
      { id: 'CELL_BATTERY_SIZE', value_name: verified.size },
      { id: 'CELL_BATTERY_SHAPE', value_name: verified.shape },
      { id: 'SALE_FORMAT', value_id: '1359392', value_name: 'Kit' },
      { id: 'UNITS_PER_PACK', value_name: String(totalUnits) },
      { id: 'IS_RECHARGEABLE', value_id: '242084', value_name: 'Não' },
      ...(verified.voltage
        ? [{ id: 'NOMINAL_VOLTAGE', value_name: verified.voltage }]
        : []),
      ...(verified.composition
        ? [{ id: 'CELL_BATTERY_COMPOSITION', value_name: verified.composition }]
        : []),
    ];
  }
  if (SHEET_SLUG === 'elgin') {
    const totalUnits = elginTotalUnits(row.sku_origem, product.nome, quantity);
    return [
      { id: 'BRAND', value_id: '102992', value_name: 'Elgin' },
      { id: 'MODEL', value_name: SHEET_CONFIG.models[source] },
      { id: 'CELL_BATTERY_SIZE', value_name: verified.size },
      { id: 'CELL_BATTERY_SHAPE', value_name: verified.shape },
      { id: 'SALE_FORMAT', value_id: '1359392', value_name: 'Kit' },
      { id: 'UNITS_PER_PACK', value_name: String(totalUnits) },
      {
        id: 'IS_RECHARGEABLE',
        value_id: verified.rechargeable ? '242085' : '242084',
        value_name: verified.rechargeable ? 'Sim' : 'Não',
      },
      { id: 'NOMINAL_VOLTAGE', value_name: verified.voltage },
      { id: 'CELL_BATTERY_COMPOSITION', value_name: verified.composition },
    ];
  }
  const verifiedInstrument = verified.instrument || instrument(product.nome);
  const verifiedGauges = verified.gauges || gauges(product.descricao);
  const verifiedTension = verified.tension || tension(product.nome);
  return [
    { id: 'BRAND', value_name: SHEET_CONFIG.brand },
    { id: 'MODEL', value_name: SHEET_CONFIG.models[source] },
    { id: 'RECOMMENDED_INSTRUMENT', value_name: verifiedInstrument },
    { id: 'SALE_FORMAT', value_id: '1359392', value_name: 'Kit' },
    { id: 'UNITS_PER_PACK', value_name: String(quantity) },
    { id: 'STRINGS_NUMBER', value_name: String(verified.stringsNumber || 6) },
    ...(verified.line
      ? [{ id: 'LINE', value_name: verified.line }]
      : []),
    ...(verifiedGauges
      ? [{ id: 'GAUGES', value_name: verifiedGauges }]
      : []),
    ...(verified.materials
      ? [{ id: 'MATERIALS', value_name: verified.materials }]
      : []),
    ...(verifiedTension
      ? [{ id: 'TENSION', value_name: verifiedTension }]
      : []),
  ];
}

function verifiedDescription(row, product, quantity) {
  if (SHEET_SLUG === 'atk') {
    const source = sourceId(row.sku_origem);
    const verified = SHEET_CONFIG.attributes[source] || {};
    const model = SHEET_CONFIG.models[source];
    const itemName = verified.kind === 'driver' ? 'drivers de compressão' : 'alto-falantes';
    return [
      text(product.nome),
      `Kit com ${quantity} ${itemName} originais ATK Eletroacústica, modelo ${model}.`,
      'CONTEÚDO DA EMBALAGEM',
      `- ${quantity} unidades ATK ${model}`,
      'CARACTERÍSTICAS',
      '- Marca: ATK Eletroacústica',
      `- Modelo: ${model}`,
      `- Quantidade: ${quantity} unidades`,
      `- Potência nominal por unidade: ${verified.power} W RMS`,
      `- Impedância por unidade: ${verified.impedance} ohms`,
      verified.kind === 'driver'
        ? `- Diâmetro da garganta: ${verified.diameter}`
        : `- Diâmetro nominal: ${verified.diameter} polegadas`,
      verified.material ? `- Material do diafragma: ${verified.material}` : '',
      verified.frequencyRange ? `- Resposta de frequência: ${verified.frequencyRange}` : '',
      verified.minFrequency && verified.maxFrequency
        ? `- Resposta de frequência: ${verified.minFrequency} a ${verified.maxFrequency} Hz`
        : '',
      verified.sensitivity ? `- Sensibilidade: ${verified.sensitivity} dB SPL` : '',
      'Confira o modelo, a impedância e a quantidade antes da compra.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  if (SHEET_SLUG === 'duracell') {
    const source = sourceId(row.sku_origem);
    const verified = SHEET_CONFIG.attributes[source] || {};
    const model = SHEET_CONFIG.models[source];
    const totalUnits = duracellTotalUnits(row.sku_origem, product.nome, quantity);
    return [
      text(product.nome),
      `Kit original Duracell com ${totalUnits} pilhas ou baterias, distribuídas em ${quantity} embalagens do fabricante.`,
      'CONTEÚDO DA EMBALAGEM',
      `- ${quantity} embalagens com ${verified.unitsEach} unidade(s) cada`,
      `- Total: ${totalUnits} pilhas ou baterias`,
      'CARACTERÍSTICAS',
      '- Marca: Duracell',
      `- Modelo: ${model}`,
      `- Tamanho: ${verified.size}`,
      `- Formato: ${verified.shape}`,
      `- Quantidade total: ${totalUnits} unidades`,
      '- Recarregável: Não',
      verified.voltage ? `- Voltagem nominal: ${verified.voltage}` : '',
      verified.composition ? `- Composição: ${verified.composition}` : '',
      'Confira o modelo, o tamanho e a quantidade total antes da compra.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  if (SHEET_SLUG === 'elgin') {
    const source = sourceId(row.sku_origem);
    const verified = SHEET_CONFIG.attributes[source] || {};
    const model = SHEET_CONFIG.models[source];
    const totalUnits = elginTotalUnits(row.sku_origem, product.nome, quantity);
    const itemLabel = verified.itemLabel || 'pilhas ou baterias';
    return [
      text(product.nome),
      `Kit original Elgin com ${totalUnits} ${itemLabel}, distribuídas em ${quantity} embalagens do fabricante.`,
      'CONTEÚDO DA EMBALAGEM',
      `- ${quantity} embalagens com ${verified.unitsEach} unidade(s) cada`,
      `- Total: ${totalUnits} ${itemLabel}`,
      'CARACTERÍSTICAS',
      '- Marca: Elgin',
      `- Modelo: ${model}`,
      `- Tamanho: ${verified.size}`,
      `- Formato: ${verified.shape}`,
      `- Quantidade total: ${totalUnits} unidades`,
      `- Recarregável: ${verified.rechargeable ? 'Sim' : 'Não'}`,
      `- Voltagem nominal: ${verified.voltage}`,
      `- Composição: ${verified.composition}`,
      'Confira o modelo, o tamanho e a quantidade total antes da compra.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
  if (SHEET_SLUG !== 'giannini') return text(product.descricao);
  const source = sourceId(row.sku_origem);
  const verified = SHEET_CONFIG.attributes[source] || {};
  const model = SHEET_CONFIG.models[source];
  return [
    text(product.nome),
    `Kit com ${quantity} jogos de cordas originais Giannini, modelo ${model}.`,
    `Indicado para ${verified.instrument}. Cada jogo possui ${verified.stringsNumber} cordas.`,
    'CONTEÚDO DA EMBALAGEM',
    `- ${quantity} jogos de cordas Giannini ${model}`,
    'CARACTERÍSTICAS',
    `- Marca: Giannini`,
    `- Modelo: ${model}`,
    `- Instrumento recomendado: ${verified.instrument}`,
    `- Quantidade de jogos: ${quantity}`,
    `- Cordas por jogo: ${verified.stringsNumber}`,
    verified.line ? `- Linha: ${verified.line}` : '',
    verified.materials ? `- Material principal: ${verified.materials}` : '',
    verified.tension ? `- Tensão: ${verified.tension}` : '',
    'Confira o modelo, o instrumento indicado e a quantidade antes da compra.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function main() {
  if (!SOURCE_FILE || !fs.existsSync(SOURCE_FILE)) {
    throw new Error('Informe uma planilha válida com --file.');
  }
  if (!SHEET_CONFIG) {
    throw new Error(
      `Planilha sem configuração segura: ${path.basename(SOURCE_FILE)}.`,
    );
  }
  const workbook = XLSX.readFile(SOURCE_FILE);
  const sheet = workbook.Sheets.Produtos || workbook.Sheets[workbook.SheetNames[0]];
  const sheetRows = XLSX.utils
    .sheet_to_json(sheet, { defval: '', raw: false })
    .filter((row) => text(row['Código (SKU)']));
  const sourceSkus = unique(sheetRows.map((row) => row['Código (SKU)']));
  const account = await mlAccount();

  const { data: kits, error } = await supabase
    .from('produto_kits')
    .select(
      'produto_id,sku_origem,ativo,produto:produtos!produto_kits_produto_id_fkey(*),componentes:produto_kit_componentes(componente_produto_id,quantidade,componente:produtos!produto_kit_componentes_componente_produto_id_fkey(id,sku,nome,gtin,ativo,estoque,ml_item_id))',
    )
    .eq('fornecedor_dslite_id', SUPPLIER_ID)
    .in('sku_origem', sourceSkus);
  if (error) throw error;
  const foundSourceSkus = new Set((kits || []).map((row) => text(row.sku_origem)));
  const unregisteredSourceSkus = sourceSkus.filter((sku) => !foundSourceSkus.has(sku));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(REPORT_ROOT, `bkr1-${SHEET_SLUG}-kits-${stamp}`);
  fs.mkdirSync(reportDir, { recursive: true });
  const ready = [];
  const blocked = unregisteredSourceSkus.map((sourceSku) => ({
    produtoId: '',
    sku: '',
    sourceSku,
    reason: 'kit_not_registered',
    details: null,
  }));
  const imageReport = [];

  for (const row of kits || []) {
    const product = row.produto;
    const componentRow = Array.isArray(row.componentes) ? row.componentes[0] : null;
    const quantity = Number(componentRow?.quantidade || 0);
    const source = sourceId(row.sku_origem);
    const expectedCategoryId = categoryForSource(row.sku_origem);
    const block = (reason, details = null) => {
      blocked.push({
        produtoId: text(product?.id),
        sku: text(product?.sku),
        sourceSku: text(row.sku_origem),
        reason,
        details,
      });
    };
    if (!row.ativo || !product?.ativo) {
      block('inactive_kit');
      continue;
    }
    if (!product?.sku || !product?.nome || !(Number(product?.custo) > 0)) {
      block('invalid_product_core_data');
      continue;
    }
    if (!(Number(product.estoque) > 0)) {
      block('out_of_stock');
      continue;
    }
    if (!componentRow || row.componentes.length !== 1 || quantity !== sourceQuantity(row.sku_origem)) {
      block('invalid_simple_kit_link');
      continue;
    }
    const canonicalSourceSku = text(row.sku_origem).replace(
      /^(\d+)CX(\d+)$/i,
      '$1K$2',
    );
    if (
      canonicalSourceSku !== text(row.sku_origem) &&
      foundSourceSkus.has(canonicalSourceSku)
    ) {
      block('duplicate_simple_kit_configuration', {
        canonicalSourceSku,
        componentSku: componentRow.componente?.sku || null,
        quantity,
      });
      continue;
    }
    if (
      SHEET_SLUG === 'duracell' &&
      !duracellTotalUnits(row.sku_origem, product.nome, quantity)
    ) {
      block('battery_total_units_mismatch', {
        productName: product.nome,
        componentQuantity: quantity,
        unitsEach: SHEET_CONFIG.attributes[source]?.unitsEach || null,
      });
      continue;
    }
    if (
      SHEET_SLUG === 'elgin' &&
      !elginTotalUnits(row.sku_origem, product.nome, quantity)
    ) {
      block('battery_total_units_mismatch', {
        productName: product.nome,
        componentQuantity: quantity,
        unitsEach: SHEET_CONFIG.attributes[source]?.unitsEach || null,
      });
      continue;
    }
    if (SHEET_CONFIG.blockedComponentIds?.includes(source)) {
      block('ml_auto_recategorizes_to_incorrect_hearing_aids_category', {
        requestedCategory: expectedCategoryId,
        automaticCategory: 'MLB270521',
      });
      continue;
    }
    if (
      !componentRow.componente?.ativo ||
      !(Number(componentRow.componente?.estoque) >= quantity)
    ) {
      block('component_unavailable');
      continue;
    }
    if (text(product.ml_item_id) || text(product.ml_status) !== 'sem_anuncio') {
      block('already_has_listing');
      continue;
    }
    if (!expectedCategoryId) {
      block('missing_verified_category');
      continue;
    }
    const { data: localListings, error: localError } = await supabase
      .from('anuncios_ml')
      .select('ml_item_id,sku,status')
      .or(`produto_id.eq.${product.id},sku.eq.${product.sku}`);
    if (localError) throw localError;
    if ((localListings || []).length) {
      block('local_listing_link_exists', localListings);
      continue;
    }
    const liveItems = await searchLiveSku(account, product.sku);
    if (liveItems.length) {
      block('live_ml_sku_exists', liveItems);
      continue;
    }
    let componentItem = null;
    if (componentRow.componente.ml_item_id) {
      componentItem = await fetchMl(
        account,
        `/items/${encodeURIComponent(componentRow.componente.ml_item_id)}?attributes=category_id,status`,
      );
      if (
        text(componentItem.category_id) !== expectedCategoryId &&
        !SHEET_CONFIG.allowedComponentCategoryMismatches?.includes(source)
      ) {
        block('component_category_mismatch', {
          expected: expectedCategoryId,
          actual: componentItem.category_id,
        });
        continue;
      }
    } else if (!SHEET_CONFIG.allowVerifiedCategoryFallback) {
      block('component_unlisted');
      continue;
    }
    const componentGtin = digits(componentRow.componente.gtin);
    if (!digits(product.gtin) && !componentGtin) {
      block('missing_component_gtin');
      continue;
    }
    if (
      componentGtin &&
      componentItem?.category_id &&
      text(componentItem.category_id) !== expectedCategoryId &&
      !SHEET_CONFIG.allowedComponentCategoryMismatches?.includes(source)
    ) {
      block('component_gtin_category_conflict', {
        expected: expectedCategoryId,
        actual: componentItem.category_id,
        componentItemId: componentRow.componente.ml_item_id,
      });
      continue;
    }
    if (!SHEET_CONFIG.models[sourceId(row.sku_origem)]) {
      block('missing_verified_model');
      continue;
    }
    const imageResult = await prepareImages(product);
    imageReport.push({
      produtoId: product.id,
      sku: product.sku,
      oldImages: imageList(product.imagens),
      ...imageResult,
    });
    if (!imageResult.ok) {
      block('image_preparation_failed', imageResult);
      continue;
    }
    ready.push({
      produtoId: text(product.id),
      sku: text(product.sku),
      nome: text(product.nome),
      fornecedor: 'BKR1',
      dsliteFornecedorId: SUPPLIER_ID,
      categoryId: expectedCategoryId,
      custo: round2(product.custo),
      estoque: Number(product.estoque),
      suggestedPricePreview: pricePreview(product),
      description: verifiedDescription(row, product, quantity),
      attributeOverrides: attributesFor(row, product, quantity),
      preflight: {
        strictEvidence: true,
        sourceSheet: path.basename(SOURCE_FILE),
        sourceSku: text(row.sku_origem),
        componentSku: text(componentRow.componente.sku),
        componentGtin: digits(componentRow.componente.gtin),
        componentQuantity: quantity,
        trustedOptionalAttributeOverrides: true,
        expectedAttributeValues:
          SHEET_SLUG === 'atk'
            ? {
                MODEL: SHEET_CONFIG.models[source],
                ...(SHEET_CONFIG.attributes[source]?.kind === 'speaker'
                  ? { SPEAKERS_NUMBER: String(quantity) }
                  : { PART_NUMBER: SHEET_CONFIG.models[source] }),
              }
            : SHEET_SLUG === 'duracell'
              ? {
                  MODEL: SHEET_CONFIG.models[source],
                  SALE_FORMAT: 'Kit',
                  UNITS_PER_PACK: String(
                    duracellTotalUnits(row.sku_origem, product.nome, quantity),
                  ),
                  IS_RECHARGEABLE: 'Não',
                }
              : SHEET_SLUG === 'elgin'
                ? {
                    MODEL: SHEET_CONFIG.models[source],
                    SALE_FORMAT: 'Kit',
                    UNITS_PER_PACK: String(
                      elginTotalUnits(row.sku_origem, product.nome, quantity),
                    ),
                    IS_RECHARGEABLE:
                      SHEET_CONFIG.attributes[source]?.rechargeable ? 'Sim' : 'Não',
                  }
                : null,
        allowMissingIdentifier:
          SHEET_SLUG === 'atk' &&
          SHEET_CONFIG.attributes[source]?.kind === 'driver',
        // Packs simples usam o GTIN da cartela e multiplicam o componente no
        // pedido/nota. Só omitir quando o GTIN estiver preso a outra categoria.
        omitComponentGtin:
          Boolean(componentItem?.category_id) &&
          text(componentItem.category_id) !== expectedCategoryId,
        imagesOnVortekStorage: imageResult.images.every((url) =>
          url.startsWith(STORAGE_PREFIX),
        ),
        categoryEvidence: componentRow.componente.ml_item_id
          ? text(componentItem?.category_id) === expectedCategoryId
            ? `Componente ${componentRow.componente.ml_item_id} em ${expectedCategoryId}`
            : `Categoria ${expectedCategoryId} validada pelo preditor oficial; componente ${componentRow.componente.ml_item_id} está classificado incorretamente em ${componentItem?.category_id}`
          : `Família ${SHEET_CONFIG.brand} validada em ${expectedCategoryId}; componente sem anúncio unitário`,
        descriptionFormat: 'paragraphs_and_bullet_points',
      },
    });
  }

  ready.sort((left, right) => left.sku.localeCompare(right.sku, 'pt-BR'));
  const batches = chunks(ready, BATCH_SIZE);
  batches.forEach((items, index) => {
    const number = String(index + 1).padStart(3, '0');
    fs.writeFileSync(
      path.join(reportDir, `${number}-bkr1-kit-${SHEET_SLUG}-${number}.json`),
      JSON.stringify(
        {
          batchNumber: index + 1,
          batchId: `bkr1-kit-${SHEET_SLUG}-${number}`,
          strategy: 'one_item_then_verify',
          items,
        },
        null,
        2,
      ),
    );
  });
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_FILE,
    account: { userId: account.userId, nickname: account.nickname },
    mode: MIRROR_IMAGES ? 'mirror_images_and_prepare' : 'audit_only',
    sheetCount: sourceSkus.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    batchCount: batches.length,
    reportDir,
  };
  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportDir, 'ready-items.json'), JSON.stringify(ready, null, 2));
  fs.writeFileSync(path.join(reportDir, 'blocked-items.json'), JSON.stringify(blocked, null, 2));
  fs.writeFileSync(path.join(reportDir, 'image-report.json'), JSON.stringify(imageReport, null, 2));
  fs.writeFileSync(
    path.join(REPORT_ROOT, `bkr1-${SHEET_SLUG}-kits-latest-path.txt`),
    `${reportDir}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  if (blocked.some((row) => row.reason !== 'out_of_stock')) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
