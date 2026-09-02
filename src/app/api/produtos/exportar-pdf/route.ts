import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { NextResponse } from 'next/server';
import { GET as getProducts } from '@/app/api/produtos/route';
import { calculateNetProfitAtPrice, calculateSuggestedPrice } from '@/services/pricing';
import { benteviColors } from '@/theme/bentevi';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ProductMlListing = {
  itemId: string;
  type: 'standard' | 'catalog';
  status: string;
  catalogStatus: 'ganhando' | 'competindo' | 'perdendo' | 'sem_catalogo';
};

type ExportRow = {
  sku: string;
  name: string;
  brand: string;
  active: boolean;
  isKit: boolean;
  safeQuantity: number;
  internalQuantity: number;
  supplierQuantity: number;
  supplier: string;
  offersCount: number;
  preferredSupplierManual: boolean;
  displayPrice: number;
  customPrice: boolean;
  cost: number;
  profit: number | null;
  margin: number | null;
  mlStatus: string;
  mlShipping: number;
  mlListings: ProductMlListing[];
};

type SupplierOption = {
  id: string;
  label: string;
  apelido?: string;
  dsliteId: string;
};

type ProductListItem = {
  product?: Record<string, any>;
  preferredOffer?: Record<string, any> | null;
  offersCount?: number;
  fulfillmentCapacity?: { internal?: number; supplier?: number; safe?: number };
  mlListings?: Array<Record<string, any>>;
  isKit?: boolean;
};

type ProductListPayload = {
  data?: ProductListItem[];
  total?: number;
  pageSize?: number;
  fornecedores?: SupplierOption[];
  pricingTaxContext?: { appliedRate?: number };
};

type ColumnKey = 'product' | 'availability' | 'supplier' | 'commercial' | 'profitability' | 'marketplace';
type TableColumn = { key: ColumnKey; label: string; width: number };
type PreparedLine = { text: string; font: PDFFont; size: number; color: RGB; lineHeight: number };
type PreparedCell = { lines: PreparedLine[] };
type PreparedRow = { cells: Record<ColumnKey, PreparedCell>; height: number };
type ReportFonts = { regular: PDFFont; bold: PDFFont; supportedCharacters: Set<number> };

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const TABLE_BOTTOM = 35;
const TABLE_HEADER_HEIGHT = 21;
const FIRST_PAGE_TABLE_TOP = 410;
const CONTINUATION_TABLE_TOP = PAGE_HEIGHT - 76;
const CELL_PADDING = 5;
const MIN_ROW_HEIGHT = 45;
const MARKETPLACE_LINES_PER_FRAGMENT = 18;

const columns: TableColumn[] = [
  { key: 'product', label: 'Produto', width: 178 },
  { key: 'availability', label: 'Disponibilidade', width: 96 },
  { key: 'supplier', label: 'Fornecimento', width: 105 },
  { key: 'commercial', label: 'Comercial', width: 105 },
  { key: 'profitability', label: 'Rentabilidade', width: 92 },
  { key: 'marketplace', label: 'Mercado Livre', width: 209 },
];

function hexToRgb(value: string): RGB {
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return rgb(((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255);
}

const colors = {
  background: hexToRgb(benteviColors.background),
  surface: hexToRgb(benteviColors.surface),
  surfaceElevated: hexToRgb(benteviColors.surfaceElevated),
  border: hexToRgb(benteviColors.border),
  text: hexToRgb(benteviColors.text),
  textSecondary: hexToRgb(benteviColors.textSecondary),
  primary: hexToRgb(benteviColors.primary),
  success: hexToRgb('#52C41A'),
  error: hexToRgb('#FF4D4F'),
};

function formatCurrency(value: number): string {
  const [integer, decimals] = Number(value || 0).toFixed(2).split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(2).replace('.', ',')}%`;
}

function normalizeStatus(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function mlStatusLabel(value: unknown): string {
  const normalized = normalizeStatus(value);
  if (normalized === 'ativo' || normalized === 'active') return 'Ativo';
  if (normalized === 'pausado' || normalized === 'paused') return 'Pausado';
  if (normalized === 'encerrado' || normalized === 'closed') return 'Encerrado';
  return 'Sem anúncio';
}

function mlStatusColor(value: unknown): RGB {
  const normalized = normalizeStatus(value);
  if (normalized === 'ativo' || normalized === 'active') return colors.success;
  if (normalized === 'pausado' || normalized === 'paused') return colors.primary;
  if (normalized === 'encerrado' || normalized === 'closed') return colors.error;
  return colors.textSecondary;
}

function catalogStatusLabel(value: ProductMlListing['catalogStatus']): string {
  if (value === 'ganhando') return 'Ganhando';
  if (value === 'competindo') return 'Competindo';
  if (value === 'perdendo') return 'Fora da disputa';
  return '';
}

function sanitizeText(value: unknown, supportedCharacters: Set<number>): string {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ').trim())
    .map((character) => supportedCharacters.has(character.codePointAt(0) || 0) ? character : '?')
    .join('');
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const character of word) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(current);
      current = character;
    } else current = candidate;
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(value: unknown, font: PDFFont, size: number, maxWidth: number, supported: Set<number>): string[] {
  const text = sanitizeText(value, supported);
  if (!text) return ['—'];
  const tokens = text.split(' ').flatMap((word) => (
    font.widthOfTextAtSize(word, size) > maxWidth ? splitLongWord(word, font, size, maxWidth) : [word]
  ));
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = token;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['—'];
}

function fitText(value: unknown, font: PDFFont, size: number, maxWidth: number, supported: Set<number>): string {
  const text = sanitizeText(value, supported);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const suffix = '...';
  let fitted = text;
  while (fitted && font.widthOfTextAtSize(`${fitted}${suffix}`, size) > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted}${suffix}`;
}

function makeLines(
  value: unknown,
  width: number,
  fonts: ReportFonts,
  options: { bold?: boolean; size?: number; color?: RGB; lineHeight?: number } = {},
): PreparedLine[] {
  const font = options.bold ? fonts.bold : fonts.regular;
  const size = options.size || 6.1;
  const lineHeight = options.lineHeight || size + 1.7;
  return wrapText(value, font, size, width, fonts.supportedCharacters).map((text) => ({
    text, font, size, color: options.color || colors.text, lineHeight,
  }));
}

function blankLine(fonts: ReportFonts): PreparedLine {
  return { text: '', font: fonts.regular, size: 2.2, color: colors.textSecondary, lineHeight: 3.2 };
}

function buildMarketplaceLines(row: ExportRow, width: number, fonts: ReportFonts): PreparedLine[] {
  const lines = makeLines(mlStatusLabel(row.mlStatus), width, fonts, {
    bold: true, size: 6.2, color: mlStatusColor(row.mlStatus),
  });
  if (!row.mlListings.length) {
    lines.push(...makeLines('Nenhum anúncio vinculado', width, fonts, { size: 5.4, color: colors.textSecondary }));
  } else {
    for (const listing of row.mlListings) {
      lines.push(blankLine(fonts));
      lines.push(...makeLines(
        `${listing.type === 'catalog' ? 'Catálogo' : 'Padrão'} · ${listing.itemId}`,
        width,
        fonts,
        { bold: true, size: 5.8 },
      ));
      const catalogStatus = listing.type === 'catalog' ? catalogStatusLabel(listing.catalogStatus) : '';
      lines.push(...makeLines(
        [mlStatusLabel(listing.status), catalogStatus].filter(Boolean).join(' · '),
        width,
        fonts,
        { size: 5.3, color: mlStatusColor(listing.status) },
      ));
    }
  }
  if (normalizeStatus(row.mlStatus) !== 'sem_anuncio' && row.mlShipping <= 0) {
    lines.push(blankLine(fonts));
    lines.push(...makeLines('Frete precisa de revisão', width, fonts, { size: 5.3, color: colors.error }));
  }
  return lines;
}

function chunkLines(lines: PreparedLine[]): PreparedLine[][] {
  const chunks: PreparedLine[][] = [];
  for (let index = 0; index < lines.length; index += MARKETPLACE_LINES_PER_FRAGMENT) {
    chunks.push(lines.slice(index, index + MARKETPLACE_LINES_PER_FRAGMENT));
  }
  return chunks.length ? chunks : [[]];
}

function cellHeight(cell: PreparedCell): number {
  return (CELL_PADDING * 2) + cell.lines.reduce((total, line) => total + line.lineHeight, 0);
}

function prepareRowFragments(row: ExportRow, fonts: ReportFonts): PreparedRow[] {
  const widths = Object.fromEntries(columns.map((column) => [column.key, column.width - (CELL_PADDING * 2)])) as Record<ColumnKey, number>;
  const marketplaceChunks = chunkLines(buildMarketplaceLines(row, widths.marketplace, fonts));
  return marketplaceChunks.map((marketplaceLines, fragmentIndex) => {
    const productLines = [
      ...makeLines(row.name, widths.product, fonts, { bold: true, size: 6.2, lineHeight: 7.8 }),
      ...makeLines(`SKU ${row.sku}${row.brand ? ` · ${row.brand}` : ''}`, widths.product, fonts, { size: 5.3, color: colors.textSecondary }),
      ...makeLines(
        [row.isKit ? 'Kit' : null, row.active ? 'Ativo' : 'Inativo', fragmentIndex > 0 ? 'Continuação' : null].filter(Boolean).join(' · '),
        widths.product,
        fonts,
        { size: 5.3, color: row.active ? colors.success : colors.error },
      ),
    ];
    const availabilityLines = [
      ...makeLines(`Q segura ${row.safeQuantity} un.`, widths.availability, fonts, {
        bold: true, size: 6.1, color: row.safeQuantity > 0 ? colors.success : colors.error,
      }),
      ...makeLines(`Interno ${row.internalQuantity}`, widths.availability, fonts, { size: 5.4, color: colors.textSecondary }),
      ...makeLines(`Fornecedor ${row.supplierQuantity}`, widths.availability, fonts, { size: 5.4, color: colors.textSecondary }),
    ];
    const supplierLines = [
      ...makeLines(row.supplier, widths.supplier, fonts, { bold: true, size: 6 }),
      ...makeLines(`${row.offersCount} oferta${row.offersCount === 1 ? '' : 's'}`, widths.supplier, fonts, { size: 5.3, color: colors.textSecondary }),
      ...makeLines(row.preferredSupplierManual ? 'Preferência manual' : 'Melhor oferta automática', widths.supplier, fonts, { size: 5.2, color: colors.textSecondary }),
    ];
    const commercialLines = [
      ...makeLines(formatCurrency(row.displayPrice), widths.commercial, fonts, { bold: true, size: 6.3, color: colors.primary }),
      ...makeLines(`Preço ${row.customPrice ? 'personalizado' : 'calculado'}`, widths.commercial, fonts, { size: 5.2, color: colors.textSecondary }),
      ...makeLines(`Custo ${formatCurrency(row.cost)}`, widths.commercial, fonts, { size: 5.3, color: colors.textSecondary }),
    ];
    const profitColor = row.profit === null || row.profit === 0 ? colors.textSecondary : row.profit > 0 ? colors.success : colors.error;
    const profitabilityLines = row.profit === null
      ? [
          ...makeLines('—', widths.profitability, fonts, { bold: true, size: 6.3, color: colors.textSecondary }),
          ...makeLines('Após publicação', widths.profitability, fonts, { size: 5.3, color: colors.textSecondary }),
        ]
      : [
          ...makeLines(formatCurrency(row.profit), widths.profitability, fonts, { bold: true, size: 6.1, color: profitColor }),
          ...makeLines(row.margin === null ? 'Margem —' : `${formatPercent(row.margin)} de margem`, widths.profitability, fonts, { size: 5.2, color: profitColor }),
        ];
    const cells: Record<ColumnKey, PreparedCell> = {
      product: { lines: productLines },
      availability: { lines: availabilityLines },
      supplier: { lines: supplierLines },
      commercial: { lines: commercialLines },
      profitability: { lines: profitabilityLines },
      marketplace: { lines: marketplaceLines },
    };
    return { cells, height: Math.max(MIN_ROW_HEIGHT, ...Object.values(cells).map(cellHeight)) };
  });
}

function drawRightText(page: PDFPage, value: string, rightX: number, y: number, font: PDFFont, size: number, color: RGB, supported: Set<number>): void {
  const text = sanitizeText(value, supported);
  page.drawText(text, { x: rightX - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function drawPageHeader(page: PDFPage, logo: PDFImage, fonts: ReportFonts, generatedAt: string): void {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors.background });
  const logoSize = logo.scaleToFit(119, 27);
  page.drawImage(logo, { x: PAGE_MARGIN, y: PAGE_HEIGHT - 49, width: logoSize.width, height: logoSize.height });
  page.drawText('Relatório de produtos', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 31, size: 17, font: fonts.bold, color: colors.text });
  page.drawText('Disponibilidade, fornecimento, rentabilidade e Mercado Livre', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 47, size: 7.2, font: fonts.regular, color: colors.textSecondary });
  drawRightText(page, `Gerado em ${generatedAt}`, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 39, fonts.regular, 6.4, colors.textSecondary, fonts.supportedCharacters);
  page.drawRectangle({ x: PAGE_MARGIN, y: PAGE_HEIGHT - 62, width: PAGE_WIDTH - (PAGE_MARGIN * 2), height: 1.4, color: colors.primary });
}

function drawFilters(page: PDFPage, description: string, fonts: ReportFonts): void {
  const x = PAGE_MARGIN;
  const y = PAGE_HEIGHT - 112;
  const width = PAGE_WIDTH - (PAGE_MARGIN * 2);
  const height = 37;
  page.drawRectangle({ x, y, width, height, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  page.drawText('FILTROS E ORDENAÇÃO', { x: x + 9, y: y + height - 12, size: 5.4, font: fonts.bold, color: colors.primary });
  wrapText(description, fonts.regular, 6.3, width - 18, fonts.supportedCharacters).slice(0, 2).forEach((line, index) => {
    page.drawText(line, { x: x + 9, y: y + height - 24 - (index * 7.4), size: 6.3, font: fonts.regular, color: colors.text });
  });
}

function buildSummaryMetrics(rows: ExportRow[]): Array<{ label: string; value: string; detail: string; color: RGB }> {
  const revenuePotential = rows.reduce((total, row) => total + (row.displayPrice * row.safeQuantity), 0);
  const knownProfits = rows.flatMap((row) => row.profit === null ? [] : [row.profit]);
  const averageProfit = knownProfits.length ? knownProfits.reduce((total, value) => total + value, 0) / knownProfits.length : 0;
  const safeCount = rows.filter((row) => row.safeQuantity > 0).length;
  const withoutListing = rows.filter((row) => normalizeStatus(row.mlStatus) === 'sem_anuncio').length;
  return [
    { label: 'PRODUTOS', value: String(rows.length), detail: 'No conjunto exportado', color: colors.text },
    { label: 'COM Q SEGURA', value: String(safeCount), detail: 'Disponíveis para venda', color: safeCount ? colors.success : colors.textSecondary },
    { label: 'SEM ANÚNCIO', value: String(withoutListing), detail: 'Ainda não publicados', color: withoutListing ? colors.primary : colors.textSecondary },
    { label: 'RECEITA POTENCIAL', value: formatCurrency(revenuePotential), detail: 'Preço × Q segura', color: colors.primary },
    {
      label: 'LUCRO MÉDIO', value: formatCurrency(averageProfit),
      detail: knownProfits.length ? `${knownProfits.length} com lucro calculado` : 'Nenhum lucro calculado',
      color: averageProfit < 0 ? colors.error : averageProfit > 0 ? colors.success : colors.textSecondary,
    },
  ];
}

function drawSummary(page: PDFPage, rows: ExportRow[], fonts: ReportFonts): void {
  const metrics = buildSummaryMetrics(rows);
  const gap = 6;
  const width = ((PAGE_WIDTH - (PAGE_MARGIN * 2)) - (gap * (metrics.length - 1))) / metrics.length;
  const y = PAGE_HEIGHT - 164;
  metrics.forEach((metric, index) => {
    const x = PAGE_MARGIN + (index * (width + gap));
    page.drawRectangle({ x, y, width, height: 40, color: colors.surfaceElevated, borderColor: colors.border, borderWidth: 0.6 });
    page.drawRectangle({ x, y, width: 2.2, height: 40, color: metric.color });
    page.drawText(metric.label, { x: x + 8, y: y + 28, size: 5.1, font: fonts.bold, color: colors.textSecondary });
    page.drawText(fitText(metric.value, fonts.bold, 10, width - 16, fonts.supportedCharacters), { x: x + 8, y: y + 15, size: 10, font: fonts.bold, color: metric.color });
    page.drawText(fitText(metric.detail, fonts.regular, 5.1, width - 16, fonts.supportedCharacters), { x: x + 8, y: y + 6, size: 5.1, font: fonts.regular, color: colors.textSecondary });
  });
}

function drawTableHeader(page: PDFPage, tableTop: number, fonts: ReportFonts): number {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const y = tableTop - TABLE_HEADER_HEIGHT;
  page.drawRectangle({ x: PAGE_MARGIN, y, width: tableWidth, height: TABLE_HEADER_HEIGHT, color: colors.surfaceElevated, borderColor: colors.border, borderWidth: 0.6 });
  page.drawRectangle({ x: PAGE_MARGIN, y, width: tableWidth, height: 1.2, color: colors.primary });
  let x = PAGE_MARGIN;
  columns.forEach((column, index) => {
    page.drawText(fitText(column.label, fonts.bold, 6, column.width - 10, fonts.supportedCharacters), { x: x + CELL_PADDING, y: y + 7.2, size: 6, font: fonts.bold, color: colors.text });
    x += column.width;
    if (index < columns.length - 1) page.drawLine({ start: { x, y }, end: { x, y: tableTop }, thickness: 0.35, color: colors.border });
  });
  return y;
}

function drawPreparedCell(page: PDFPage, cell: PreparedCell, x: number, top: number): void {
  let cursor = top - CELL_PADDING;
  for (const line of cell.lines) {
    cursor -= line.size;
    if (line.text) page.drawText(line.text, { x: x + CELL_PADDING, y: cursor, size: line.size, font: line.font, color: line.color });
    cursor -= line.lineHeight - line.size;
  }
}

function drawTableRow(page: PDFPage, row: PreparedRow, top: number, rowIndex: number): number {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const bottom = top - row.height;
  page.drawRectangle({ x: PAGE_MARGIN, y: bottom, width: tableWidth, height: row.height, color: rowIndex % 2 ? colors.surfaceElevated : colors.surface, borderColor: colors.border, borderWidth: 0.35 });
  let x = PAGE_MARGIN;
  columns.forEach((column, index) => {
    drawPreparedCell(page, row.cells[column.key], x, top);
    x += column.width;
    if (index < columns.length - 1) page.drawLine({ start: { x, y: bottom }, end: { x, y: top }, thickness: 0.3, color: colors.border });
  });
  return bottom;
}

function drawEmptyState(page: PDFPage, top: number, fonts: ReportFonts): void {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  page.drawRectangle({ x: PAGE_MARGIN, y: top - 72, width: tableWidth, height: 72, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  const title = 'Nenhum produto encontrado';
  const detail = 'Altere os filtros da página de Produtos e gere o relatório novamente.';
  page.drawText(title, { x: PAGE_MARGIN + ((tableWidth - fonts.bold.widthOfTextAtSize(title, 10)) / 2), y: top - 31, size: 10, font: fonts.bold, color: colors.text });
  page.drawText(detail, { x: PAGE_MARGIN + ((tableWidth - fonts.regular.widthOfTextAtSize(detail, 6.3)) / 2), y: top - 46, size: 6.3, font: fonts.regular, color: colors.textSecondary });
}

function drawFooters(document: PDFDocument, fonts: ReportFonts, generatedAt: string): void {
  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: PAGE_MARGIN, y: 27 }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 27 }, thickness: 0.45, color: colors.border });
    page.drawText('Bentevi · Documento operacional interno', { x: PAGE_MARGIN, y: 16, size: 5.8, font: fonts.regular, color: colors.textSecondary });
    drawRightText(page, `Página ${index + 1} de ${pages.length} · ${generatedAt}`, PAGE_WIDTH - PAGE_MARGIN, 16, fonts.regular, 5.8, colors.textSecondary, fonts.supportedCharacters);
  });
}

async function buildPdf(rows: ExportRow[], filterDescription: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular: regularFont, bold: boldFont, supportedCharacters: new Set(regularFont.getCharacterSet()) };
  const logoBytes = await readFile(path.join(process.cwd(), 'public', 'branding', 'bentevi', 'bentevi-wordmark.png'));
  const logo = await document.embedPng(logoBytes);
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const addPage = (first: boolean): { page: PDFPage; cursor: number } => {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageHeader(page, logo, fonts, generatedAt);
    if (first) {
      drawFilters(page, filterDescription, fonts);
      drawSummary(page, rows, fonts);
    }
    return { page, cursor: drawTableHeader(page, first ? FIRST_PAGE_TABLE_TOP : CONTINUATION_TABLE_TOP, fonts) };
  };
  let current = addPage(true);
  if (!rows.length) drawEmptyState(current.page, current.cursor, fonts);
  else {
    rows.flatMap((row) => prepareRowFragments(row, fonts)).forEach((prepared, rowIndex) => {
      if (current.cursor - prepared.height < TABLE_BOTTOM) current = addPage(false);
      current.cursor = drawTableRow(current.page, prepared, current.cursor, rowIndex);
    });
  }
  drawFooters(document, fonts, generatedAt);
  document.setTitle('Bentevi — Relatório de produtos');
  document.setAuthor('Bentevi');
  document.setCreator('Bentevi ERP');
  document.setProducer('Bentevi ERP');
  document.setSubject('Relatório operacional de produtos');
  document.setKeywords(['Bentevi', 'produtos', 'estoque', 'Mercado Livre']);
  document.setCreationDate(new Date());
  return document.save({ useObjectStreams: false });
}

function mapListing(value: Record<string, any>): ProductMlListing | null {
  const itemId = String(value?.itemId || '').trim().toUpperCase();
  if (!itemId) return null;
  const catalogStatus = value?.catalogStatus === 'ganhando' || value?.catalogStatus === 'competindo' || value?.catalogStatus === 'perdendo'
    ? value.catalogStatus
    : 'sem_catalogo';
  return { itemId, type: value?.type === 'catalog' ? 'catalog' : 'standard', status: String(value?.status || ''), catalogStatus };
}

function mapExportRow(item: ProductListItem, taxRate: number, supplierNames: Map<string, string>): ExportRow {
  const product = item.product || {};
  const preferredOffer = item.preferredOffer || null;
  const cost = Number(preferredOffer?.custo ?? product.custo ?? 0);
  const mlShipping = Number(product.ml_shipping || 0);
  const mlFee = Number(product.ml_fee ?? 0.15);
  let displayPrice = Number(product.custom_price ?? cost);
  let profit: number | null = null;
  try {
    const calculated = calculateSuggestedPrice({ cost, shipping: mlShipping, mlFee, taxRate });
    displayPrice = Math.round(Number(product.custom_price ?? calculated.suggestedPrice) * 100) / 100;
    if (normalizeStatus(product.ml_status) !== 'sem_anuncio') {
      profit = Math.round(calculateNetProfitAtPrice({ price: displayPrice, cost, shipping: mlShipping, mlFee, taxRate }) * 100) / 100;
    }
  } catch {
    displayPrice = Math.round(displayPrice * 100) / 100;
  }
  const supplierId = String(product.dslite_fornecedor_id || preferredOffer?.dslite_fornecedor_id || '').trim();
  const supplier = supplierNames.get(supplierId) || String(preferredOffer?.fornecedor_nome || product.fornecedor || '').trim() || 'Sem fornecedor';
  const mappedListings = (Array.isArray(item.mlListings) ? item.mlListings : []).map(mapListing).filter((listing): listing is ProductMlListing => listing !== null);
  if (!mappedListings.length && String(product.ml_item_id || '').trim()) {
    mappedListings.push({ itemId: String(product.ml_item_id).trim().toUpperCase(), type: 'standard', status: String(product.ml_status || ''), catalogStatus: 'sem_catalogo' });
  }
  const margin = profit === null || displayPrice <= 0 ? null : Math.round((profit / displayPrice) * 10000) / 100;
  return {
    sku: String(product.sku || '').trim(),
    name: String(product.nome || '').trim(),
    brand: String(product.marca || '').trim(),
    active: product.ativo !== false,
    isKit: Boolean(item.isKit),
    safeQuantity: Number(item.fulfillmentCapacity?.safe || 0),
    internalQuantity: Number(item.fulfillmentCapacity?.internal || 0),
    supplierQuantity: Number(item.fulfillmentCapacity?.supplier || 0),
    supplier,
    offersCount: Number(item.offersCount || 0),
    preferredSupplierManual: product.fornecedor_preferencial_manual === true,
    displayPrice,
    customPrice: product.custom_price !== null && product.custom_price !== undefined,
    cost,
    profit,
    margin,
    mlStatus: String(product.ml_status || 'sem_anuncio'),
    mlShipping,
    mlListings: mappedListings,
  };
}

function parseNumber(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildFilterDescription(sourceUrl: URL, supplierOptions: SupplierOption[]): string {
  const searchParams = sourceUrl.searchParams;
  const supplierIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const suppliers = supplierOptions.filter((option) => supplierIds.includes(String(option.id))).map((option) => option.apelido || option.label);
  const activeStatus = searchParams.get('ativo') || 'todos';
  const stockStatus = searchParams.get('estoque') || '';
  const priceField = searchParams.get('priceField') || 'cost';
  const priceFieldLabel = priceField === 'suggestedPrice' ? 'preço' : priceField === 'profit' ? 'lucro' : 'custo';
  const sortLabels: Record<string, string> = {
    sku: 'SKU', nome: 'produto', fornecedor: 'fornecedor', estoque: 'disponibilidade', custo: 'custo',
    ml_fee: 'taxa ML', ml_shipping: 'frete ML', suggested_price: 'preço', profit: 'lucro', ml_status: 'status ML',
  };
  const sortBy = searchParams.get('sortBy') || 'sku';
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'decrescente' : 'crescente';
  const priceMin = parseNumber(searchParams, 'priceMin');
  const priceMax = parseNumber(searchParams, 'priceMax');
  const filters = [
    searchParams.get('search') ? `Busca: ${searchParams.get('search')}` : null,
    activeStatus !== 'todos' ? `Situação: ${activeStatus === 'inativo' ? 'inativos' : 'ativos'}` : null,
    suppliers.length ? `Fornecedor: ${suppliers.join(', ')}` : null,
    searchParams.get('ml_status') ? `Mercado Livre: ${mlStatusLabel(searchParams.get('ml_status'))}` : null,
    stockStatus ? `Q segura: ${stockStatus === 'com_estoque' ? 'com estoque' : 'sem estoque'}` : null,
    priceMin !== null ? `${priceFieldLabel} mínimo: ${formatCurrency(priceMin)}` : null,
    priceMax !== null ? `${priceFieldLabel} máximo: ${formatCurrency(priceMax)}` : null,
  ].filter(Boolean);
  return [filters.length ? filters.join(' · ') : 'Nenhum filtro — todos os produtos', `Ordenação: ${sortLabels[sortBy] || 'SKU'} ${sortOrder}`].join(' · ');
}

export async function GET(request: Request) {
  try {
    const sourceUrl = new URL(request.url);
    const listUrl = new URL('/api/produtos', request.url);
    for (const key of ['search', 'fornecedores', 'ml_status', 'estoque', 'priceMin', 'priceMax', 'priceField', 'sortBy', 'sortOrder']) {
      const value = sourceUrl.searchParams.get(key);
      if (value) listUrl.searchParams.set(key, value);
    }
    listUrl.searchParams.set('ativo', sourceUrl.searchParams.get('ativo') || 'todos');
    const headers = new Headers(request.headers);
    headers.set('x-vortek-read-only', '1');
    const items: ProductListItem[] = [];
    let page = 1;
    let total = 0;
    let supplierOptions: SupplierOption[] = [];
    let taxRate: number | null = null;
    do {
      listUrl.searchParams.set('page', String(page));
      const response = await getProducts(new Request(listUrl, { headers }));
      const payload = await response.json().catch(() => ({})) as ProductListPayload & { erro?: string; error?: string };
      if (!response.ok) {
        return NextResponse.json({ erro: payload.erro || payload.error || 'Falha ao consultar produtos' }, { status: response.status });
      }
      const pageItems = Array.isArray(payload.data) ? payload.data : [];
      if (!supplierOptions.length && Array.isArray(payload.fornecedores)) supplierOptions = payload.fornecedores;
      if (taxRate === null && Number.isFinite(Number(payload.pricingTaxContext?.appliedRate))) taxRate = Number(payload.pricingTaxContext?.appliedRate);
      items.push(...pageItems);
      total = Number(payload.total || 0);
      page += 1;
      if (!pageItems.length) break;
    } while (items.length < total);
    if (taxRate === null) throw new Error('Alíquota tributária indisponível para gerar o relatório');
    const supplierNames = new Map(
      supplierOptions.filter((option) => String(option.dsliteId || '').trim()).map((option) => [String(option.dsliteId), String(option.apelido || option.label)]),
    );
    const rows = items.map((item) => mapExportRow(item, taxRate, supplierNames));
    const pdf = await buildPdf(rows, buildFilterDescription(sourceUrl, supplierOptions));
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="produtos-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[api/produtos/exportar-pdf] Falha:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao gerar PDF dos produtos' }, { status: 500 });
  }
}
