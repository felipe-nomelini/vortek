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
import { GET as getListings } from '@/app/api/anuncios/route';
import type { MlCatalogStatus, MlListingDashboardRow } from '@/lib/ml/listings-dashboard';
import { benteviColors } from '@/theme/bentevi';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ExportRow = Pick<MlListingDashboardRow,
  | 'itemId'
  | 'productSku'
  | 'productName'
  | 'listingTitle'
  | 'listingType'
  | 'catalogProductId'
  | 'relatedItemId'
  | 'price'
  | 'profit'
  | 'marginPercent'
  | 'sold'
  | 'visits'
  | 'qualityScore'
  | 'qualityAvailable'
  | 'qualityPrimaryIssue'
  | 'observedStatus'
  | 'blockReason'
  | 'lastError'
  | 'catalogStatus'
  | 'priceToWin'
  | 'listingSyncedAt'
  | 'isOperational'
  | 'latestPublish'
>;

type ListingPayload = {
  data?: MlListingDashboardRow[];
  total?: number;
  pageSize?: number;
};

type ColumnKey = 'listing' | 'product' | 'commercial' | 'performance' | 'quality' | 'state' | 'catalog';
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
const MIN_ROW_HEIGHT = 49;
const LINES_PER_FRAGMENT = 12;

const columns: TableColumn[] = [
  { key: 'listing', label: 'Anúncio', width: 104 },
  { key: 'product', label: 'Produto', width: 172 },
  { key: 'commercial', label: 'Preço e resultado', width: 104 },
  { key: 'performance', label: 'Desempenho', width: 76 },
  { key: 'quality', label: 'Qualidade', width: 91 },
  { key: 'state', label: 'Estado', width: 105 },
  { key: 'catalog', label: 'Catálogo', width: 133 },
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
  info: hexToRgb('#40A9FF'),
};

function formatCurrency(value: number): string {
  const [integer, decimals] = Number(value || 0).toFixed(2).split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(2).replace('.', ',')}%`;
}

function normalizeStatus(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function statusLabel(value: unknown): string {
  const status = normalizeStatus(value);
  if (status === 'active' || status === 'ativo') return 'Ativo';
  if (status === 'paused' || status === 'pausado') return 'Pausado';
  if (status === 'under_review') return 'Em revisão';
  if (status === 'closed' || status === 'encerrado') return 'Encerrado';
  if (status === 'inactive' || status === 'inativo') return 'Inativo';
  return String(value || 'Estado desconhecido');
}

function statusColor(value: unknown): RGB {
  const status = normalizeStatus(value);
  if (status === 'active' || status === 'ativo') return colors.success;
  if (status === 'paused' || status === 'pausado') return colors.primary;
  if (status === 'under_review') return colors.info;
  if (status === 'closed' || status === 'encerrado' || status === 'inactive' || status === 'inativo') return colors.error;
  return colors.textSecondary;
}

function catalogStatusLabel(value: MlCatalogStatus): string {
  if (value === 'ganhando') return 'Ganhando a Buy Box';
  if (value === 'competindo') return 'Competindo pela Buy Box';
  if (value === 'perdendo') return 'Fora da Buy Box';
  return 'Anúncio padrão';
}

function catalogStatusColor(value: MlCatalogStatus): RGB {
  if (value === 'ganhando') return colors.success;
  if (value === 'competindo') return colors.primary;
  if (value === 'perdendo') return colors.error;
  return colors.textSecondary;
}

function sanitizeText(value: unknown, supported: Set<number>): string {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ').trim())
    .map((character) => supported.has(character.codePointAt(0) || 0) ? character : '?')
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
  const size = options.size || 5.8;
  const lineHeight = options.lineHeight || size + 1.7;
  return wrapText(value, font, size, width, fonts.supportedCharacters).map((text) => ({
    text,
    font,
    size,
    color: options.color || colors.text,
    lineHeight,
  }));
}

function blankLine(fonts: ReportFonts): PreparedLine {
  return { text: '', font: fonts.regular, size: 2, color: colors.textSecondary, lineHeight: 3 };
}

function cellHeight(cell: PreparedCell): number {
  return (CELL_PADDING * 2) + cell.lines.reduce((total, line) => total + line.lineHeight, 0);
}

function latestProblem(row: ExportRow): string | null {
  return row.blockReason || row.lastError || row.latestPublish?.error || null;
}

function prepareRow(row: ExportRow, fonts: ReportFonts): PreparedRow {
  const widths = Object.fromEntries(columns.map((column) => [column.key, column.width - (CELL_PADDING * 2)])) as Record<ColumnKey, number>;
  const profitColor = row.profit === null || row.profit === 0 ? colors.textSecondary : row.profit > 0 ? colors.success : colors.error;
  const qualityColor = !row.qualityAvailable || row.qualityScore === null
    ? colors.textSecondary
    : row.qualityScore < 80 ? colors.error : row.qualityScore < 100 ? colors.primary : colors.success;
  const problem = latestProblem(row);
  const commercialLines = [
    ...makeLines(formatCurrency(row.price), widths.commercial, fonts, { bold: true, size: 6.2, color: colors.primary }),
    ...(row.profit === null
      ? makeLines('Lucro não calculado', widths.commercial, fonts, { size: 5.1, color: colors.textSecondary })
      : makeLines(`Lucro ${formatCurrency(row.profit)}`, widths.commercial, fonts, { bold: true, size: 5.3, color: profitColor })),
    ...(row.marginPercent === null
      ? []
      : makeLines(`Margem ${formatPercent(row.marginPercent)}`, widths.commercial, fonts, { size: 5.1, color: profitColor })),
  ];
  const catalogLines = [
    ...makeLines(catalogStatusLabel(row.catalogStatus), widths.catalog, fonts, { bold: true, size: 5.6, color: catalogStatusColor(row.catalogStatus) }),
  ];
  if (row.listingType === 'catalog') {
    if (row.catalogProductId) catalogLines.push(...makeLines(`Catálogo ${row.catalogProductId}`, widths.catalog, fonts, { size: 5, color: colors.textSecondary }));
    if (row.priceToWin !== null && row.priceToWin > 0) catalogLines.push(...makeLines(`Preço para ganhar ${formatCurrency(row.priceToWin)}`, widths.catalog, fonts, { size: 5.1, color: colors.primary }));
    if (row.relatedItemId) catalogLines.push(...makeLines(`Relacionado ${row.relatedItemId}`, widths.catalog, fonts, { size: 5, color: colors.textSecondary }));
  }
  const cells: Record<ColumnKey, PreparedCell> = {
    listing: { lines: [
      ...makeLines(row.itemId, widths.listing, fonts, { bold: true, size: 6.1, color: colors.primary }),
      ...makeLines(row.listingType === 'catalog' ? 'Anúncio de catálogo' : 'Anúncio padrão', widths.listing, fonts, { size: 5.2, color: colors.textSecondary }),
      ...(row.isOperational ? makeLines('Operacional', widths.listing, fonts, { size: 5.1, color: colors.success }) : []),
    ] },
    product: { lines: [
      ...makeLines(row.productName || row.listingTitle, widths.product, fonts, { bold: true, size: 5.9, lineHeight: 7.5 }),
      ...makeLines(`SKU Bentevi ${row.productSku || 'não informado'}`, widths.product, fonts, { size: 5.1, color: colors.textSecondary }),
      ...(row.listingTitle && row.listingTitle !== row.productName
        ? [blankLine(fonts), ...makeLines(`Título ML: ${row.listingTitle}`, widths.product, fonts, { size: 5, color: colors.textSecondary })]
        : []),
    ] },
    commercial: { lines: commercialLines },
    performance: { lines: [
      ...makeLines(`${formatInteger(row.sold)} vendidos`, widths.performance, fonts, { bold: true, size: 5.6 }),
      ...makeLines(`${formatInteger(row.visits)} visitas`, widths.performance, fonts, { size: 5.2, color: colors.textSecondary }),
    ] },
    quality: { lines: row.qualityAvailable && row.qualityScore !== null ? [
      ...makeLines(`${formatInteger(row.qualityScore)} / 100`, widths.quality, fonts, { bold: true, size: 6.1, color: qualityColor }),
      ...makeLines(row.qualityPrimaryIssue || 'Sem alerta principal', widths.quality, fonts, { size: 5, color: row.qualityPrimaryIssue ? qualityColor : colors.textSecondary }),
    ] : makeLines('Leitura indisponível', widths.quality, fonts, { size: 5.3, color: colors.textSecondary }) },
    state: { lines: [
      ...makeLines(statusLabel(row.observedStatus), widths.state, fonts, { bold: true, size: 5.8, color: statusColor(row.observedStatus) }),
      ...(problem ? makeLines(problem, widths.state, fonts, { size: 5, color: colors.error }) : makeLines('Sem bloqueio observado', widths.state, fonts, { size: 5, color: colors.textSecondary })),
    ] },
    catalog: { lines: catalogLines },
  };
  return { cells, height: Math.max(MIN_ROW_HEIGHT, ...Object.values(cells).map(cellHeight)) };
}

function prepareRowFragments(row: ExportRow, fonts: ReportFonts): PreparedRow[] {
  const prepared = prepareRow(row, fonts);
  const fragmentCount = Math.max(
    1,
    ...Object.values(prepared.cells).map((cell) => Math.ceil(cell.lines.length / LINES_PER_FRAGMENT)),
  );
  return Array.from({ length: fragmentCount }, (_unused, fragmentIndex) => {
    const cells = Object.fromEntries(columns.map((column) => {
      const source = prepared.cells[column.key].lines;
      const lines = source.slice(fragmentIndex * LINES_PER_FRAGMENT, (fragmentIndex + 1) * LINES_PER_FRAGMENT);
      if (fragmentIndex > 0 && column.key === 'listing') {
        lines.unshift(...makeLines('Continuação', column.width - (CELL_PADDING * 2), fonts, {
          bold: true,
          size: 5.1,
          color: colors.primary,
        }));
      }
      return [column.key, { lines }];
    })) as Record<ColumnKey, PreparedCell>;
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
  page.drawText('Relatório de anúncios', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 31, size: 17, font: fonts.bold, color: colors.text });
  page.drawText('Preço, desempenho, qualidade, estado e competição no Mercado Livre', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 47, size: 7.2, font: fonts.regular, color: colors.textSecondary });
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

function isQualityRisk(row: ExportRow): boolean {
  return row.qualityAvailable && row.qualityScore !== null && row.qualityScore < 80;
}

function isPriceReview(row: ExportRow): boolean {
  return row.listingType === 'catalog' && row.catalogStatus !== 'ganhando' && row.priceToWin !== null && row.priceToWin > 0;
}

function buildSummaryMetrics(rows: ExportRow[]): Array<{ label: string; value: string; detail: string; color: RGB }> {
  const active = rows.filter((row) => ['active', 'ativo'].includes(normalizeStatus(row.observedStatus))).length;
  const paused = rows.filter((row) => ['paused', 'pausado'].includes(normalizeStatus(row.observedStatus))).length;
  const qualityRisk = rows.filter(isQualityRisk).length;
  const priceReview = rows.filter(isPriceReview).length;
  return [
    { label: 'ANÚNCIOS', value: formatInteger(rows.length), detail: 'No conjunto exportado', color: colors.text },
    { label: 'ATIVOS', value: formatInteger(active), detail: 'Publicados agora', color: active ? colors.success : colors.textSecondary },
    { label: 'PAUSADOS', value: formatInteger(paused), detail: 'Fora de venda', color: paused ? colors.primary : colors.textSecondary },
    { label: 'QUALIDADE EM RISCO', value: formatInteger(qualityRisk), detail: 'Score disponível abaixo de 80', color: qualityRisk ? colors.error : colors.textSecondary },
    { label: 'PREÇO EM REVISÃO', value: formatInteger(priceReview), detail: 'Catálogo com preço para ganhar', color: priceReview ? colors.primary : colors.textSecondary },
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
  const title = 'Nenhum anúncio encontrado';
  const detail = 'Altere os filtros da página de Anúncios e gere o relatório novamente.';
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
  document.setTitle('Bentevi — Relatório de anúncios');
  document.setAuthor('Bentevi');
  document.setCreator('Bentevi ERP');
  document.setProducer('Bentevi ERP');
  document.setSubject('Relatório operacional de anúncios do Mercado Livre');
  document.setKeywords(['Bentevi', 'anúncios', 'Mercado Livre', 'qualidade', 'catálogo']);
  document.setCreationDate(new Date());
  return document.save({ useObjectStreams: false });
}

function mapExportRow(row: MlListingDashboardRow): ExportRow {
  return {
    itemId: String(row.itemId || '').trim(),
    productSku: String(row.productSku || '').trim(),
    productName: String(row.productName || '').trim(),
    listingTitle: String(row.listingTitle || '').trim(),
    listingType: row.listingType === 'catalog' ? 'catalog' : 'standard',
    catalogProductId: row.catalogProductId || null,
    relatedItemId: row.relatedItemId || null,
    price: Number(row.price || 0),
    profit: row.profit === null ? null : Number(row.profit),
    marginPercent: row.marginPercent === null ? null : Number(row.marginPercent),
    sold: Number(row.sold || 0),
    visits: Number(row.visits || 0),
    qualityScore: row.qualityScore === null ? null : Number(row.qualityScore),
    qualityAvailable: row.qualityAvailable === true,
    qualityPrimaryIssue: row.qualityPrimaryIssue || null,
    observedStatus: String(row.observedStatus || ''),
    blockReason: row.blockReason || null,
    lastError: row.lastError || null,
    catalogStatus: row.catalogStatus || 'sem_catalogo',
    priceToWin: row.priceToWin === null ? null : Number(row.priceToWin),
    listingSyncedAt: row.listingSyncedAt || null,
    isOperational: row.isOperational === true,
    latestPublish: row.latestPublish || null,
  };
}

function parseNumber(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildFilterDescription(sourceUrl: URL): string {
  const params = sourceUrl.searchParams;
  const focusLabels: Record<string, string> = { active: 'ativos', paused: 'pausados', quality_risk: 'qualidade em risco', price_review: 'preço em revisão' };
  const qualityLabels: Record<string, string> = { risk: 'em risco (< 80)', good: 'boa (80–99)', perfect: 'completa (100)', unavailable: 'sem leitura' };
  const catalogLabels: Record<string, string> = { standard: 'padrão', catalog: 'catálogo', winning: 'ganhando Buy Box', competing: 'competindo', losing: 'perdendo' };
  const profitabilityLabels: Record<string, string> = { positive: 'lucro positivo', negative: 'prejuízo', unknown: 'sem cálculo' };
  const sortLabels: Record<string, string> = { item: 'anúncio', product: 'produto', price: 'preço', profit: 'lucro', sold: 'vendidos', visits: 'visitas', quality: 'qualidade', status: 'estado', catalog: 'catálogo' };
  const priceMin = parseNumber(params, 'priceMin');
  const priceMax = parseNumber(params, 'priceMax');
  const filters = [
    params.get('search') ? `Busca: ${params.get('search')}` : null,
    params.get('focus') && params.get('focus') !== 'all' ? `Visão: ${focusLabels[params.get('focus') || ''] || params.get('focus')}` : null,
    params.get('quality') && params.get('quality') !== 'all' ? `Qualidade: ${qualityLabels[params.get('quality') || ''] || params.get('quality')}` : null,
    params.get('catalog') && params.get('catalog') !== 'all' ? `Tipo: ${catalogLabels[params.get('catalog') || ''] || params.get('catalog')}` : null,
    params.get('profitability') && params.get('profitability') !== 'all' ? `Rentabilidade: ${profitabilityLabels[params.get('profitability') || ''] || params.get('profitability')}` : null,
    priceMin !== null ? `Preço mínimo: ${formatCurrency(priceMin)}` : null,
    priceMax !== null ? `Preço máximo: ${formatCurrency(priceMax)}` : null,
  ].filter(Boolean);
  const sortBy = params.get('sortBy') || 'product';
  const sortOrder = params.get('sortOrder') === 'desc' ? 'decrescente' : 'crescente';
  return [filters.length ? filters.join(' · ') : 'Nenhum filtro — todos os anúncios', `Ordenação: ${sortLabels[sortBy] || 'produto'} ${sortOrder}`].join(' · ');
}

export async function GET(request: Request) {
  try {
    const sourceUrl = new URL(request.url);
    const listUrl = new URL('/api/anuncios', request.url);
    for (const key of ['search', 'focus', 'quality', 'catalog', 'profitability', 'priceMin', 'priceMax', 'sortBy', 'sortOrder']) {
      const value = sourceUrl.searchParams.get(key);
      if (value) listUrl.searchParams.set(key, value);
    }
    const headers = new Headers(request.headers);
    headers.set('x-vortek-read-only', '1');
    const rows: ExportRow[] = [];
    let page = 1;
    let total = 0;
    do {
      listUrl.searchParams.set('page', String(page));
      const response = await getListings(new Request(listUrl, { headers }));
      const payload = await response.json().catch(() => ({})) as ListingPayload & { erro?: string; error?: string };
      if (!response.ok) {
        return NextResponse.json({ erro: payload.erro || payload.error || 'Falha ao consultar anúncios' }, { status: response.status });
      }
      const pageRows = Array.isArray(payload.data) ? payload.data : [];
      rows.push(...pageRows.map(mapExportRow));
      total = Number(payload.total || 0);
      page += 1;
      if (!pageRows.length) break;
    } while (rows.length < total);
    const pdf = await buildPdf(rows, buildFilterDescription(sourceUrl));
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="anuncios-mercado-livre-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[api/anuncios/exportar-pdf] Falha:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao gerar PDF dos anúncios' }, { status: 500 });
  }
}
