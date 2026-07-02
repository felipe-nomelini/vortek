export type MlProductFacts = {
  totalUnits?: number;
  saleFormat?: "Kit" | "Unidade";
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
  sectionSize?: string;
  conductorsNumber?: number;
  powerSupplyType?: string;
  withCutaway?: string;
  networkCableType?: string;
  compatibleBlenderBrand?: string;
  compatibleBlendersModels?: string;
  calculatorType?: string;
  motherboardCompatibility?: string;
  radioType?: string;
  mountType?: string;
  mountingPlaces?: string;
  modulationType?: string;
  formFactor?: string;
  airConditionerType?: string;
  coolingCapacity?: string;
  packagesNumber?: number;
  isRechargeable?: string;
};

function normalizeText(input: unknown) {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
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
    findNumber(
      /\bcom\s+(\d{1,3})\s+(?:pilhas?|baterias?|unidades?)\b/i,
      text,
    ) ||
    findNumber(/\b(\d{1,3})\s+(?:pilhas?|baterias?|unidades?)\b/i, text) ||
    findNumber(/\bbli\s*\/\s*(\d{1,3})\b/i, text)
  );
}

function extractVoltage(text: string): string | undefined {
  const hit = text.match(/\b(\d+(?:[,.]\d+)?)\s*v\b/i);
  if (!hit?.[1]) return undefined;
  return `${hit[1].replace(",", ".")} V`;
}

function extractCableLength(rawText: string): string | undefined {
  const roll = rawText.match(/\b(?:rl|rolo)\s*\/\s*(\d+(?:[,.]\d+)?)\b/i);
  if (roll?.[1]) return `${roll[1].replace(",", ".")} m`;

  const hit = rawText.match(/\b(\d+(?:[,.]\d+)?)\s*(m|cm)\b/i);
  if (!hit?.[1] || !hit?.[2]) return undefined;
  const value = hit[1].replace(",", ".");
  const unit = hit[2].toLowerCase();
  return `${value} ${unit}`;
}

function extractSectionSize(rawText: string): string | undefined {
  const withGauge = rawText.match(
    /\b\d+\s*x\s*\d+\s+(\d+(?:[,.]\d+)?)\s*mm\b/i,
  );
  const direct = rawText.match(/\b\d+\s*x\s*(\d+(?:[,.]\d+)?)\s*mm\b/i);
  const value = withGauge?.[1] || direct?.[1];
  if (!value) return undefined;
  return `${value.replace(",", ".")} mm²`;
}

function extractConductorsNumber(rawText: string): number | undefined {
  const hit = rawText.match(/\b(\d+)\s*x\s*\d+(?:\s+\d+(?:[,.]\d+)?\s*mm)?\b/i);
  const value = hit?.[1] ? Number(hit[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractStringGauges(text: string): string | undefined {
  const range = text.match(/\.?0?\d{2,3}\s*(?:[-–/]|a)\s*\.?0?\d{2,3}/i);
  if (!range?.[0]) return undefined;
  const numbers = range[0].match(/0?\d{2,3}/g) || [];
  if (numbers.length < 2) return range[0].replace(/\s+/g, " ");
  const firstGauge = String(numbers[0] || "")
    .replace(/^0+/, "")
    .padStart(3, "0");
  const lastGauge = String(numbers[1] || "")
    .replace(/^0+/, "")
    .padStart(3, "0");
  return `.${firstGauge} - .${lastGauge}`;
}

function extractJewelryModel(text: string): string | undefined {
  const isEarring = text.includes("brinco");
  if (!isEarring) return undefined;

  const parts: string[] = [];
  if (text.includes("argola")) parts.push("Argola");
  if (text.includes("paz")) parts.push("Paz");
  if (text.includes("coracao")) parts.push("Coração");
  if (text.includes("pingente")) parts.push("Pingente");
  if (text.includes("banhado") && text.includes("ouro"))
    parts.push("Banhado Ouro 18k");
  if (parts.length >= 2) return parts.join(" ").slice(0, 60);
  return undefined;
}

function extractJewelryMaterial(text: string): string | undefined {
  if (
    /(banhad[oa]|folhead[oa]|banho de ouro|ouro 18k banhad[oa])/.test(text) &&
    text.includes("ouro")
  ) {
    return "Banhado em ouro 18k";
  }
  if (/(ouro macico|ouro maciço|ouro 18k macico|ouro 18k maciço)/.test(text)) {
    return "Ouro";
  }
  return undefined;
}

export function extractMlProductFacts(produto: any): MlProductFacts {
  const rawText = `${produto?.nome || ""} ${produto?.descricao || ""} ${produto?.categoria || ""}`;
  const text = normalizeText(rawText);
  const totalUnits = extractTotalUnits(text);
  const saleFormat = totalUnits && totalUnits > 1 ? "Kit" : undefined;

  const isCable =
    text.includes("cabo") ||
    text.includes("fio") ||
    text.includes("plug") ||
    text.includes("p10") ||
    text.includes("jack");
  const isString =
    text.includes("encordoamento") ||
    text.includes("cordas") ||
    text.includes("calibre");
  const isGuitar =
    text.includes("violao") ||
    text.includes("guitarra") ||
    text.includes("contrabaixo");
  const isBattery = text.includes("pilha") || text.includes("bateria");
  const isBlade = text.includes("lamina") || text.includes("lâmina");
  const isBlenderCup = text.includes("copo") && text.includes("liquidificador");
  const isCalculator = text.includes("calculadora");
  const isComputerCase =
    text.includes("gabinete") &&
    (text.includes("gamer") || text.includes("mid tower"));
  const isProcessorCooler = text.includes("cooler para processador");
  const isWaterCooler = text.includes("water cooler");
  const isPowerSupply =
    (text.includes("fonte") && text.includes("atx")) ||
    text.includes("fonte gamer");
  const isStabilizer = text.includes("estabilizador");
  const isAirConditioner =
    text.includes("ar-condicionado") || text.includes("ar condicionado");
  const isFan = text.includes("ventilador");
  const isMonitorMount = text.includes("suporte") && text.includes("monitor");
  const isPortableRadio =
    text.includes("radio portatil") || text.includes("rádio portátil");

  const jewelryModel = extractJewelryModel(text);
  const jewelryMaterial = extractJewelryMaterial(text);
  const model = jewelryModel
    ? jewelryModel
    : text.match(/\bmn\s*1500\b/i)
      ? "MN1500"
      : isCable && text.includes("ninja")
        ? "Ninja P"
        : undefined;
  const batterySize = /\baa\b/i.test(rawText)
    ? "AA"
    : /\baaa\b/i.test(rawText)
      ? "AAA"
      : undefined;
  const nominalVoltage = extractVoltage(text);
  const batteryComposition =
    text.includes("alcalina") || text.includes("alcalino")
      ? "Alcalina"
      : undefined;
  const hasJackOrP10 =
    text.includes("p10") ||
    text.includes("jack") ||
    text.includes("guitarra") ||
    text.includes("instrumento");
  const color = text.includes("preto")
    ? "Preto"
    : text.includes("branco")
      ? "Branco"
      : undefined;
  const cableLength = isCable ? extractCableLength(rawText) : undefined;
  const sectionSize = isCable ? extractSectionSize(rawText) : undefined;
  const conductorsNumber = isCable
    ? extractConductorsNumber(rawText)
    : undefined;
  const recommendedInstrument =
    text.includes("contrabaixo") ||
    text.includes("contra baixo") ||
    text.includes("contra-baixo")
      ? "Contrabaixo"
      : text.includes("guitarra")
        ? "Guitarra elétrica"
        : text.includes("violao") || text.includes("violão")
          ? "Violão acústico"
          : undefined;
  const stringsNumber = text.match(/\b4\s*cordas?\b/i)
    ? 4
    : isGuitar
      ? 6
      : undefined;
  const gauges = extractStringGauges(text);
  const tension =
    text.includes("extra light") || text.includes("extra leve")
      ? "Extra Light"
      : text.includes("light") || text.includes("leve")
        ? "Light"
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
    cableType:
      isCable && text.includes("fio paralelo")
        ? "Cordão Paralelo"
        : isCable && hasJackOrP10
          ? "Plug"
          : undefined,
    productType: isBlade
      ? "Lâmina"
      : isWaterCooler
        ? "Cooler Líquido AIO"
        : isProcessorCooler
          ? "Ventoinha"
          : isStabilizer
            ? "Estabilizador"
            : isCable
              ? "Fio"
              : undefined,
    inputConnector: isCable && hasJackOrP10 ? "Jack" : undefined,
    outputConnector: isCable && hasJackOrP10 ? "Jack" : undefined,
    inputConnectorGender: isCable && hasJackOrP10 ? "Macho" : undefined,
    outputConnectorGender: isCable && hasJackOrP10 ? "Macho" : undefined,
    inputConnectorsNumber: isCable && hasJackOrP10 ? 1 : undefined,
    outputConnectorsNumber: isCable && hasJackOrP10 ? 1 : undefined,
    recommendedInstrument,
    stringsNumber,
    gauges,
    material:
      jewelryMaterial ||
      (isString &&
      (text.includes("aco") ||
        text.includes("niquel") ||
        text.includes("metal"))
        ? "Metal"
        : undefined),
    tension,
    sectionSize,
    conductorsNumber,
    powerSupplyType:
      isAirConditioner || isFan || text.includes("liquidificador")
        ? "Elétrica"
        : text.includes("alicate amperimetro") || text.includes("multimetro")
          ? "Bateria/Pilha"
          : isBattery
            ? "Bateria/Pilha"
            : undefined,
    withCutaway: text.includes("cutaway")
      ? "Sim"
      : isGuitar
        ? "Não"
        : undefined,
    networkCableType: /cat\s*5|cat5|cat\s*5e|cat5e|rede|ethernet/.test(text)
      ? "Par trançado UTP"
      : undefined,
    compatibleBlenderBrand:
      isBlenderCup && /walita|philips/.test(text)
        ? "Philips Walita"
        : undefined,
    compatibleBlendersModels: isBlenderCup
      ? (rawText.match(/\bHR\s*\d{3,5}\b/i)?.[0] || "").replace(/\s+/g, "") ||
        undefined
      : undefined,
    calculatorType: isCalculator
      ? text.includes("bobina")
        ? "Com bobina"
        : text.includes("mesa")
          ? "De mesa"
          : undefined
      : undefined,
    motherboardCompatibility: isComputerCase
      ? "ATX, Micro-ATX, Mini-ITX"
      : undefined,
    radioType: isPortableRadio ? "Analógico" : undefined,
    mountType: text.includes("fogao eletrico") ? "De mesa" : undefined,
    mountingPlaces: isMonitorMount
      ? text.includes("parede")
        ? "Parede"
        : text.includes("mesa")
          ? "Mesa"
          : undefined
      : undefined,
    modulationType: isPowerSupply ? "Permanente" : undefined,
    formFactor: isPowerSupply ? "ATX" : undefined,
    airConditionerType:
      isAirConditioner && text.includes("split") ? "Split" : undefined,
    coolingCapacity: isAirConditioner
      ? rawText
          .match(/\b(\d{1,2}(?:\.\d{3})?)\s*btus?\b/i)?.[1]
          ?.replace(".", "")
      : undefined,
    packagesNumber: isAirConditioner && text.includes("split") ? 2 : undefined,
    isRechargeable:
      isBattery && (text.includes("alcalina") || text.includes("alcalino"))
        ? "Não"
        : undefined,
  };
}

export function applyProductFactsToMlAttribute(
  field: { id?: string; name?: string; tags?: Record<string, any> },
  facts: MlProductFacts,
): { value_name?: string } | null {
  const id = String(field?.id || "").toUpperCase();
  const name = normalizeText(field?.name);
  const tags = field?.tags || {};

  if (
    (id === "SALE_FORMAT" || name.includes("formato de venda")) &&
    facts.saleFormat
  ) {
    return { value_name: facts.saleFormat };
  }
  if (
    (id === "UNITS_PER_PACK" ||
      tags.unit_yield ||
      name.includes("unidades por kit")) &&
    facts.unitsPerPack
  ) {
    return { value_name: String(facts.unitsPerPack) };
  }
  if (
    (id === "PACKS_NUMBER" ||
      tags.pack_multiplier ||
      name.includes("quantidade de kits")) &&
    facts.packsNumber
  ) {
    return { value_name: String(facts.packsNumber) };
  }
  if (
    (id === "CELL_BATTERY_SIZE" || name.includes("tamanho da pilha")) &&
    facts.batterySize
  ) {
    return { value_name: facts.batterySize };
  }
  if (
    (id === "NOMINAL_VOLTAGE" || name.includes("voltagem nominal")) &&
    facts.nominalVoltage
  ) {
    return { value_name: facts.nominalVoltage };
  }
  if (
    (id === "CELL_BATTERY_COMPOSITION" || name.includes("composicao")) &&
    facts.batteryComposition
  ) {
    return { value_name: facts.batteryComposition };
  }
  if ((id === "MODEL" || name.includes("modelo")) && facts.model) {
    return { value_name: facts.model };
  }
  if (
    (id === "COLOR" || name === "cor" || name.includes("cor principal")) &&
    facts.color
  ) {
    return { value_name: facts.color };
  }
  if (
    (id === "CABLE_LENGTH" || name.includes("comprimento do cabo")) &&
    facts.cableLength
  ) {
    return { value_name: facts.cableLength };
  }
  if (
    (id === "SECTION_SIZE" || name.includes("tamanho da secao")) &&
    facts.sectionSize
  ) {
    return { value_name: facts.sectionSize };
  }
  if (
    (id === "CONDUCTORS_NUMBER" || name.includes("quantidade de pinos")) &&
    facts.conductorsNumber
  ) {
    return { value_name: String(facts.conductorsNumber) };
  }
  if (
    (id === "CABLE_AND_ADAPTER_TYPE" ||
      id === "ELECTRIC_CABLE_TYPE" ||
      name.includes("tipo de cabo")) &&
    facts.cableType
  ) {
    return { value_name: facts.cableType };
  }
  if (
    (id === "PRODUCT_TYPE" || name.includes("tipo de produto")) &&
    facts.productType
  ) {
    return { value_name: facts.productType };
  }
  if (
    (id === "INPUT_CONNECTOR_GENDER" ||
      name.includes("genero do conector de entrada")) &&
    facts.inputConnectorGender
  ) {
    return { value_name: facts.inputConnectorGender };
  }
  if (
    (id === "OUTPUT_CONNECTOR_GENDER" ||
      name.includes("genero do conector de saida")) &&
    facts.outputConnectorGender
  ) {
    return { value_name: facts.outputConnectorGender };
  }
  if (
    (id === "INPUT_CONNECTOR" || name.includes("conector de entrada")) &&
    facts.inputConnector
  ) {
    return { value_name: facts.inputConnector };
  }
  if (
    (id === "OUTPUT_CONNECTOR" || name.includes("conector de saida")) &&
    facts.outputConnector
  ) {
    return { value_name: facts.outputConnector };
  }
  if (
    (id === "INPUT_CONNECTORS_NUMBER" ||
      name.includes("quantidade de conectores de entrada")) &&
    facts.inputConnectorsNumber
  ) {
    return { value_name: String(facts.inputConnectorsNumber) };
  }
  if (
    (id === "OUTPUT_CONNECTORS_NUMBER" ||
      name.includes("quantidade de conectores de saida")) &&
    facts.outputConnectorsNumber
  ) {
    return { value_name: String(facts.outputConnectorsNumber) };
  }
  if (
    (id === "RECOMMENDED_INSTRUMENT" ||
      name.includes("instrumento recomendado")) &&
    facts.recommendedInstrument
  ) {
    return { value_name: facts.recommendedInstrument };
  }
  if (
    (id === "STRINGS_NUMBER" || name.includes("quantidade de cordas")) &&
    facts.stringsNumber
  ) {
    return { value_name: String(facts.stringsNumber) };
  }
  if ((id === "GAUGES" || name.includes("calibres")) && facts.gauges) {
    return { value_name: facts.gauges };
  }
  if (
    (id === "MATERIAL" || id === "MATERIALS" || name.includes("material")) &&
    facts.material
  ) {
    return { value_name: facts.material };
  }
  if ((id === "TENSION" || name.includes("tensao")) && facts.tension) {
    return { value_name: facts.tension };
  }
  if (
    (id === "POWER_SUPPLY_TYPE" || name.includes("tipo de alimentacao")) &&
    facts.powerSupplyType
  ) {
    return { value_name: facts.powerSupplyType };
  }
  if (
    (id === "CALCULATOR_TYPE" || name.includes("tipo de calculadora")) &&
    facts.calculatorType
  ) {
    return { value_name: facts.calculatorType };
  }
  if (
    (id === "MOTHERBOARDS_COMPATIBILITY" ||
      name.includes("placas mae compativeis")) &&
    facts.motherboardCompatibility
  ) {
    return { value_name: facts.motherboardCompatibility };
  }
  if (
    (id === "MOUNT_TYPE" ||
      id === "MOUNTING_TYPE" ||
      name.includes("tipo de montagem")) &&
    facts.mountType
  ) {
    return { value_name: facts.mountType };
  }
  if (
    (id === "MOUNTING_PLACES" || name.includes("lugares de montagem")) &&
    facts.mountingPlaces
  ) {
    return { value_name: facts.mountingPlaces };
  }
  if (
    (id === "MODULATION_TYPE" || name.includes("tipo de modulacao")) &&
    facts.modulationType
  ) {
    return { value_name: facts.modulationType };
  }
  if (
    (id === "FORM_FACTOR" || name.includes("fator de forma")) &&
    facts.formFactor
  ) {
    return { value_name: facts.formFactor };
  }
  if (
    (id === "AIR_CONDITIONER_TYPE" ||
      name.includes("tipo de ar condicionado")) &&
    facts.airConditionerType
  ) {
    return { value_name: facts.airConditionerType };
  }
  if (
    (id === "COOLING_CAPACITY" ||
      name.includes("capacidade de refrigeracao")) &&
    facts.coolingCapacity
  ) {
    return { value_name: facts.coolingCapacity };
  }
  if (
    (id === "PACKAGES_NUMBER" || name.includes("quantidade de caixas")) &&
    facts.packagesNumber
  ) {
    return { value_name: String(facts.packagesNumber) };
  }
  if (
    (id === "RADIO_TYPE" || name.includes("tipo de radio")) &&
    facts.radioType
  ) {
    return { value_name: facts.radioType };
  }
  if (
    (id === "IS_RECHARGEABLE" || name.includes("recarregavel")) &&
    facts.isRechargeable
  ) {
    return { value_name: facts.isRechargeable };
  }
  if (
    (id === "NETWORK_CABLE_TYPE" || name.includes("tipo de cabo de rede")) &&
    facts.networkCableType
  ) {
    return { value_name: facts.networkCableType };
  }
  if (
    (id === "COMPATIBLE_BLENDER_BRAND" ||
      name.includes("marca de liquidificador compativel")) &&
    facts.compatibleBlenderBrand
  ) {
    return { value_name: facts.compatibleBlenderBrand };
  }
  if (
    (id === "COMPATIBLE_BLENDERS_MODELS" ||
      name.includes("modelos de liquidificadores compativeis")) &&
    facts.compatibleBlendersModels
  ) {
    return { value_name: facts.compatibleBlendersModels };
  }
  if (
    (id === "WITH_CUTAWAY" || name.includes("cutaway")) &&
    facts.withCutaway
  ) {
    return { value_name: facts.withCutaway };
  }

  return null;
}
