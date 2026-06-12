export type MlProductFacts = {
  totalUnits?: number;
  saleFormat?: 'Kit' | 'Unidade';
  unitsPerPack?: number;
  packsNumber?: number;
  batterySize?: string;
  nominalVoltage?: string;
  batteryComposition?: string;
  model?: string;
  color?: string;
  cableLength?: string;
  cableType?: string;
  productType?: string;
  inputConnector?: string;
  outputConnector?: string;
  inputConnectorGender?: string;
  outputConnectorGender?: string;
  inputConnectorsNumber?: number;
  outputConnectorsNumber?: number;
  recommendedInstrument?: string;
  stringsNumber?: number;
  gauges?: string;
  material?: string;
  tension?: string;
};

function normalizeText(input: unknown) {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNumber(pattern: RegExp, text: string): number | undefined {
  const hit = text.match(pattern);
  const value = hit?.[1] ? Number(hit[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractTotalUnits(text: string): number | undefined {
  return (
    findNumber(/\bc\s*\/\s*(\d{1,3})\b/i, text) ||
    findNumber(/\bcom\s+(\d{1,3})\s+(?:pilhas?|baterias?|unidades?)\b/i, text) ||
    findNumber(/\b(\d{1,3})\s+(?:pilhas?|baterias?|unidades?)\b/i, text) ||
    findNumber(/\bbli\s*\/\s*(\d{1,3})\b/i, text)
  );
}

function extractVoltage(text: string): string | undefined {
  const hit = text.match(/\b(\d+(?:[,.]\d+)?)\s*v\b/i);
  if (!hit?.[1]) return undefined;
  return `${hit[1].replace(',', '.')} V`;
}

function extractCableLength(rawText: string): string | undefined {
  const hit = rawText.match(/\b(\d+(?:[,.]\d+)?)\s*(m|cm)\b/i);
  if (!hit?.[1] || !hit?.[2]) return undefined;
  const value = hit[1].replace(',', '.');
  const unit = hit[2].toLowerCase();
  return `${value} ${unit}`;
}

function extractStringGauges(text: string): string | undefined {
  const range = text.match(/\.?0?\d{2,3}\s*(?:[-–/]|a)\s*\.?0?\d{2,3}/i);
  if (!range?.[0]) return undefined;
  const numbers = range[0].match(/0?\d{2,3}/g) || [];
  if (numbers.length < 2) return range[0].replace(/\s+/g, ' ');
  const firstGauge = String(numbers[0] || '').replace(/^0+/, '').padStart(3, '0');
  const lastGauge = String(numbers[1] || '').replace(/^0+/, '').padStart(3, '0');
  return `.${firstGauge} - .${lastGauge}`;
}

export function extractMlProductFacts(produto: any): MlProductFacts {
  const rawText = `${produto?.nome || ''} ${produto?.descricao || ''} ${produto?.categoria || ''}`;
  const text = normalizeText(rawText);
  const totalUnits = extractTotalUnits(text);
  const saleFormat = totalUnits && totalUnits > 1 ? 'Kit' : undefined;

  const isCable = text.includes('cabo') || text.includes('plug') || text.includes('p10') || text.includes('jack');
  const isString = text.includes('encordoamento') || text.includes('cordas') || text.includes('calibre');
  const isBattery = text.includes('pilha') || text.includes('bateria');

  const model = text.match(/\bmn\s*1500\b/i)
    ? 'MN1500'
    : isCable && text.includes('ninja')
      ? 'Ninja P'
      : undefined;
  const batterySize = /\baa\b/i.test(rawText) ? 'AA' : /\baaa\b/i.test(rawText) ? 'AAA' : undefined;
  const nominalVoltage = extractVoltage(text);
  const batteryComposition = text.includes('alcalina') || text.includes('alcalino') ? 'Alcalina' : undefined;
  const color = text.includes('preto') ? 'Preto' : text.includes('branco') ? 'Branco' : undefined;
  const cableLength = extractCableLength(rawText);
  const hasJackOrP10 = text.includes('p10') || text.includes('jack') || text.includes('guitarra') || text.includes('instrumento');
  const recommendedInstrument = text.includes('contrabaixo') || text.includes('contra baixo') || text.includes('contra-baixo')
    ? 'Contrabaixo'
    : text.includes('guitarra')
      ? 'Guitarra elétrica'
      : undefined;
  const stringsNumber = text.match(/\b4\s*cordas?\b/i) ? 4 : undefined;
  const gauges = extractStringGauges(text);
  const tension = text.includes('extra light') || text.includes('extra leve')
    ? 'Extra Light'
    : text.includes('light') || text.includes('leve')
      ? 'Light'
      : undefined;

  return {
    totalUnits,
    saleFormat,
    unitsPerPack: totalUnits,
    packsNumber: totalUnits ? 1 : undefined,
    batterySize,
    nominalVoltage,
    batteryComposition,
    model,
    color,
    cableLength,
    cableType: isCable && hasJackOrP10 ? 'Plug' : undefined,
    productType: isCable ? 'Fio' : undefined,
    inputConnector: isCable && hasJackOrP10 ? 'Jack' : undefined,
    outputConnector: isCable && hasJackOrP10 ? 'Jack' : undefined,
    inputConnectorGender: isCable && hasJackOrP10 ? 'Macho' : undefined,
    outputConnectorGender: isCable && hasJackOrP10 ? 'Macho' : undefined,
    inputConnectorsNumber: isCable && hasJackOrP10 ? 1 : undefined,
    outputConnectorsNumber: isCable && hasJackOrP10 ? 1 : undefined,
    recommendedInstrument,
    stringsNumber,
    gauges,
    material: isString && (text.includes('aco') || text.includes('niquel') || text.includes('metal')) ? 'Metal' : undefined,
    tension,
  };
}

export function applyProductFactsToMlAttribute(
  field: { id?: string; name?: string; tags?: Record<string, any> },
  facts: MlProductFacts,
): { value_name?: string } | null {
  const id = String(field?.id || '').toUpperCase();
  const name = normalizeText(field?.name);
  const tags = field?.tags || {};

  if ((id === 'SALE_FORMAT' || name.includes('formato de venda')) && facts.saleFormat) {
    return { value_name: facts.saleFormat };
  }
  if ((id === 'UNITS_PER_PACK' || tags.unit_yield || name.includes('unidades por kit')) && facts.unitsPerPack) {
    return { value_name: String(facts.unitsPerPack) };
  }
  if ((id === 'PACKS_NUMBER' || tags.pack_multiplier || name.includes('quantidade de kits')) && facts.packsNumber) {
    return { value_name: String(facts.packsNumber) };
  }
  if ((id === 'CELL_BATTERY_SIZE' || name.includes('tamanho da pilha')) && facts.batterySize) {
    return { value_name: facts.batterySize };
  }
  if ((id === 'NOMINAL_VOLTAGE' || name.includes('voltagem nominal')) && facts.nominalVoltage) {
    return { value_name: facts.nominalVoltage };
  }
  if ((id === 'CELL_BATTERY_COMPOSITION' || name.includes('composicao')) && facts.batteryComposition) {
    return { value_name: facts.batteryComposition };
  }
  if ((id === 'MODEL' || name.includes('modelo')) && facts.model) {
    return { value_name: facts.model };
  }
  if ((id === 'COLOR' || name.includes('cor')) && facts.color) {
    return { value_name: facts.color };
  }
  if ((id === 'CABLE_LENGTH' || name.includes('comprimento do cabo')) && facts.cableLength) {
    return { value_name: facts.cableLength };
  }
  if ((id === 'CABLE_AND_ADAPTER_TYPE' || name.includes('tipo de cabo')) && facts.cableType) {
    return { value_name: facts.cableType };
  }
  if ((id === 'PRODUCT_TYPE' || name.includes('tipo de produto')) && facts.productType) {
    return { value_name: facts.productType };
  }
  if ((id === 'INPUT_CONNECTOR' || name.includes('conector de entrada')) && facts.inputConnector) {
    return { value_name: facts.inputConnector };
  }
  if ((id === 'OUTPUT_CONNECTOR' || name.includes('conector de saida')) && facts.outputConnector) {
    return { value_name: facts.outputConnector };
  }
  if ((id === 'INPUT_CONNECTOR_GENDER' || name.includes('genero do conector de entrada')) && facts.inputConnectorGender) {
    return { value_name: facts.inputConnectorGender };
  }
  if ((id === 'OUTPUT_CONNECTOR_GENDER' || name.includes('genero do conector de saida')) && facts.outputConnectorGender) {
    return { value_name: facts.outputConnectorGender };
  }
  if ((id === 'INPUT_CONNECTORS_NUMBER' || name.includes('quantidade de conectores de entrada')) && facts.inputConnectorsNumber) {
    return { value_name: String(facts.inputConnectorsNumber) };
  }
  if ((id === 'OUTPUT_CONNECTORS_NUMBER' || name.includes('quantidade de conectores de saida')) && facts.outputConnectorsNumber) {
    return { value_name: String(facts.outputConnectorsNumber) };
  }
  if ((id === 'RECOMMENDED_INSTRUMENT' || name.includes('instrumento recomendado')) && facts.recommendedInstrument) {
    return { value_name: facts.recommendedInstrument };
  }
  if ((id === 'STRINGS_NUMBER' || name.includes('quantidade de cordas')) && facts.stringsNumber) {
    return { value_name: String(facts.stringsNumber) };
  }
  if ((id === 'GAUGES' || name.includes('calibres')) && facts.gauges) {
    return { value_name: facts.gauges };
  }
  if ((id === 'MATERIALS' || name.includes('materiais')) && facts.material) {
    return { value_name: facts.material };
  }
  if ((id === 'TENSION' || name.includes('tensao')) && facts.tension) {
    return { value_name: facts.tension };
  }

  return null;
}
