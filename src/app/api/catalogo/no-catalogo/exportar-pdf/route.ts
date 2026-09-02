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
import { GET as getCatalogListings } from '@/app/api/catalogo/no-catalogo/route';
import { catalogCompetitionPresentation } from '@/lib/catalogo/dashboard';
import { benteviColors } from '@/theme/bentevi';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CatalogListingRow = {
  ml_item_id: string;
  relacionado_id: string | null;
  related_status?: string | null;
  title: string;
  sku_local: string | null;
  produto_nome?: string | null;
  catalog_product_id: string | null;
  status: string | null;
  buy_box_status: string | null;
  price_to_win: number | null;
  price: number;
  last_updated: string | null;
};

type CatalogPayload = {
  data?: CatalogListingRow[];
  total?: number;
  lastSyncedAt?: string | null;
};

type ExportRow = {
  itemId: string;
  title: string;
  status: string;
  productName: string;
  productSku: string;
  relatedItemId: string | null;
  relatedStatus: string | null;
  catalogProductId: string | null;
  competitionStatus: string | null;
  price: number;
  priceToWin: number | null;
};

type ColumnKey = 'listing' | 'product' | 'relation' | 'competition' | 'price';
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
const FIRST_PAGE_TABLE_TOP = 365;
const CONTINUATION_TABLE_TOP = PAGE_HEIGHT - 76;
const CELL_PADDING = 5;
const MIN_ROW_HEIGHT = 54;
const LINES_PER_FRAGMENT = 13;

const columns: TableColumn[] = [
  { key: 'listing', label: 'Anúncio de catálogo', width: 180 },
  { key: 'product', label: 'Produto Bentevi', width: 162 },
  { key: 'relation', label: 'Relação no catálogo', width: 171 },
  { key: 'competition', label: 'Competição', width: 136 },
  { key: 'price', label: 'Preço e resultado', width: 136 },
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
  const amount = Math.abs(Number(value || 0));
  const [integer, decimals] = amount.toFixed(2).split('.');
  const formatted = `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
  return Number(value) < 0 ? `-${formatted}` : formatted;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Não informada';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function normalizeStatus(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function statusLabel(value: unknown): string {
  const status = normalizeStatus(value);
  if (status === 'active' || status === 'ativo') return 'Ativo';
  if (status === 'paused' || status === 'pausado') return 'Pausado';
  if (status === 'closed' || status === 'encerrado') return 'Encerrado';
  if (status === 'under_review') return 'Em revisão';
  return String(value || 'Estado desconhecido');
}

function statusColor(value: unknown): RGB {
  const status = normalizeStatus(value);
  if (status === 'active' || status === 'ativo') return colors.success;
  if (status === 'paused' || status === 'pausado') return colors.primary;
  if (status === 'under_review') return colors.info;
  if (status === 'closed' || status === 'encerrado') return colors.error;
  return colors.textSecondary;
}

function competitionColor(value: unknown): RGB {
  const key = catalogCompetitionPresentation(value).key;
  if (key === 'winning' || key === 'sharing_first_place') return colors.success;
  if (key === 'competing') return colors.primary;
  if (key === 'outside') return colors.error;
  return colors.textSecondary;
}

function competitionCode(value: unknown): string {
  const normalized = normalizeStatus(value);
  if (normalized === 'not_listed') return 'not_listed · legado observado';
  return normalized || 'não informado';
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

function prepareRow(row: ExportRow, fonts: ReportFonts): PreparedRow {
  const widths = Object.fromEntries(columns.map((column) => [column.key, column.width - (CELL_PADDING * 2)])) as Record<ColumnKey, number>;
  const competition = catalogCompetitionPresentation(row.competitionStatus);
  const target = row.priceToWin !== null && row.priceToWin > 0 ? row.priceToWin : null;
  const delta = target === null ? null : target - row.price;
  const deltaColor = delta === null || delta === 0 ? colors.textSecondary : delta < 0 ? colors.error : colors.success;
  const cells: Record<ColumnKey, PreparedCell> = {
    listing: { lines: [
      ...makeLines(row.title || 'Título não informado', widths.listing, fonts, { bold: true, size: 5.9, lineHeight: 7.5 }),
      blankLine(fonts),
      ...makeLines(row.itemId, widths.listing, fonts, { bold: true, size: 5.6, color: colors.primary }),
      ...makeLines(statusLabel(row.status), widths.listing, fonts, { size: 5.2, color: statusColor(row.status) }),
    ] },
    product: { lines: [
      ...makeLines(row.productName || 'Produto não vinculado', widths.product, fonts, { bold: true, size: 5.9, lineHeight: 7.5 }),
      ...makeLines(`SKU Bentevi ${row.productSku || 'não informado'}`, widths.product, fonts, { size: 5.2, color: colors.textSecondary }),
    ] },
    relation: { lines: [
      ...makeLines('Anúncio padrão', widths.relation, fonts, { bold: true, size: 5.3, color: colors.textSecondary }),
      ...makeLines(row.relatedItemId || 'Não localizado', widths.relation, fonts, { bold: true, size: 5.7, color: row.relatedItemId ? colors.text : colors.error }),
      ...makeLines(row.relatedItemId ? statusLabel(row.relatedStatus) : 'Relação não informada pelo ML', widths.relation, fonts, { size: 5.1, color: row.relatedItemId ? statusColor(row.relatedStatus) : colors.textSecondary }),
      blankLine(fonts),
      ...makeLines('Produto de catálogo', widths.relation, fonts, { bold: true, size: 5.3, color: colors.textSecondary }),
      ...makeLines(row.catalogProductId || 'Não informado', widths.relation, fonts, { bold: true, size: 5.6, color: row.catalogProductId ? colors.primary : colors.textSecondary }),
    ] },
    competition: { lines: [
      ...makeLines(competition.label, widths.competition, fonts, { bold: true, size: 5.9, color: competitionColor(row.competitionStatus) }),
      ...makeLines(competition.description, widths.competition, fonts, { size: 5.1, color: colors.textSecondary }),
      ...makeLines(`Estado ML: ${competitionCode(row.competitionStatus)}`, widths.competition, fonts, { size: 4.9, color: colors.textSecondary }),
    ] },
    price: { lines: [
      ...makeLines(formatCurrency(row.price), widths.price, fonts, { bold: true, size: 6.3, color: colors.primary }),
      ...makeLines(target === null ? 'Preço para ganhar não informado' : `Para ganhar ${formatCurrency(target)}`, widths.price, fonts, { size: 5.2, color: target === null ? colors.textSecondary : colors.text }),
      ...(delta === null
        ? []
        : makeLines(delta === 0 ? 'Preço já alinhado' : `Diferença ${formatCurrency(delta)}`, widths.price, fonts, { bold: true, size: 5.2, color: deltaColor })),
    ] },
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
  page.drawText('Relatório de catálogo', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 31, size: 17, font: fonts.bold, color: colors.text });
  page.drawText('Relação entre anúncios, produtos, competição e preço no Mercado Livre', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 47, size: 7.2, font: fonts.regular, color: colors.textSecondary });
  drawRightText(page, `Gerado em ${generatedAt}`, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 39, fonts.regular, 6.4, colors.textSecondary, fonts.supportedCharacters);
  page.drawRectangle({ x: PAGE_MARGIN, y: PAGE_HEIGHT - 62, width: PAGE_WIDTH - (PAGE_MARGIN * 2), height: 1.4, color: colors.primary });
}

function drawRelationshipGuide(page: PDFPage, fonts: ReportFonts): void {
  const y = PAGE_HEIGHT - 113;
  const height = 38;
  const width = PAGE_WIDTH - (PAGE_MARGIN * 2);
  page.drawRectangle({ x: PAGE_MARGIN, y, width, height, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  page.drawText('COMO O CATÁLOGO SE RELACIONA', { x: PAGE_MARGIN + 9, y: y + height - 12, size: 5.4, font: fonts.bold, color: colors.primary });
  const labels = [
    ['Anúncio padrão', 'Publicação original da loja'],
    ['Produto de catálogo', 'Página de produto do Mercado Livre'],
    ['Anúncio de catálogo', 'Publicação que disputa as vendas'],
  ];
  const startX = PAGE_MARGIN + 10;
  const cellWidth = 228;
  labels.forEach(([title, detail], index) => {
    const x = startX + (index * 262);
    page.drawText(title, { x, y: y + 15, size: 6.3, font: fonts.bold, color: colors.text });
    page.drawText(detail, { x, y: y + 6, size: 5.2, font: fonts.regular, color: colors.textSecondary });
    if (index < labels.length - 1) page.drawText('>', { x: x + cellWidth + 12, y: y + 11, size: 9, font: fonts.bold, color: colors.primary });
  });
}

function drawFilters(page: PDFPage, description: string, lastSyncedAt: string | null, fonts: ReportFonts): void {
  const x = PAGE_MARGIN;
  const y = PAGE_HEIGHT - 162;
  const width = PAGE_WIDTH - (PAGE_MARGIN * 2);
  const height = 37;
  page.drawRectangle({ x, y, width, height, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  page.drawText('FILTROS E ORDENAÇÃO', { x: x + 9, y: y + height - 12, size: 5.4, font: fonts.bold, color: colors.primary });
  wrapText(description, fonts.regular, 6.1, width - 190, fonts.supportedCharacters).slice(0, 2).forEach((line, index) => {
    page.drawText(line, { x: x + 9, y: y + height - 24 - (index * 7.2), size: 6.1, font: fonts.regular, color: colors.text });
  });
  drawRightText(page, 'ÚLTIMA ANÁLISE', x + width - 9, y + height - 12, fonts.bold, 5.4, colors.primary, fonts.supportedCharacters);
  drawRightText(page, formatDate(lastSyncedAt), x + width - 9, y + 8, fonts.regular, 6, colors.text, fonts.supportedCharacters);
}

function buildSummaryMetrics(rows: ExportRow[]): Array<{ label: string; value: string; detail: string; color: RGB }> {
  const counts = rows.reduce((accumulator, row) => {
    const key = catalogCompetitionPresentation(row.competitionStatus).key;
    if (key === 'winning') accumulator.winning += 1;
    else if (key === 'sharing_first_place') accumulator.sharing += 1;
    else if (key === 'competing') accumulator.competing += 1;
    else if (key === 'outside') accumulator.outside += 1;
    return accumulator;
  }, { winning: 0, sharing: 0, competing: 0, outside: 0 });
  return [
    { label: 'ANÚNCIOS', value: formatInteger(rows.length), detail: 'No conjunto exportado', color: colors.text },
    { label: 'GANHANDO', value: formatInteger(counts.winning), detail: 'Recebendo as vendas', color: counts.winning ? colors.success : colors.textSecondary },
    { label: 'DIVIDINDO 1º LUGAR', value: formatInteger(counts.sharing), detail: 'Primeira posição compartilhada', color: counts.sharing ? colors.success : colors.textSecondary },
    { label: 'COMPETINDO', value: formatInteger(counts.competing), detail: 'Participam sem liderar', color: counts.competing ? colors.primary : colors.textSecondary },
    { label: 'FORA DA COMPETIÇÃO', value: formatInteger(counts.outside), detail: 'Listados, mas impedidos', color: counts.outside ? colors.error : colors.textSecondary },
  ];
}

function drawSummary(page: PDFPage, rows: ExportRow[], fonts: ReportFonts): void {
  const metrics = buildSummaryMetrics(rows);
  const gap = 6;
  const width = ((PAGE_WIDTH - (PAGE_MARGIN * 2)) - (gap * (metrics.length - 1))) / metrics.length;
  const y = PAGE_HEIGHT - 214;
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
  const title = 'Nenhum anúncio de catálogo encontrado';
  const detail = 'Altere os filtros da página de Catálogo e gere o relatório novamente.';
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

async function buildPdf(rows: ExportRow[], filterDescription: string, lastSyncedAt: string | null): Promise<Uint8Array> {
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
      drawRelationshipGuide(page, fonts);
      drawFilters(page, filterDescription, lastSyncedAt, fonts);
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
  document.setTitle('Bentevi — Relatório de catálogo');
  document.setAuthor('Bentevi');
  document.setCreator('Bentevi ERP');
  document.setProducer('Bentevi ERP');
  document.setSubject('Relatório operacional de anúncios de catálogo do Mercado Livre');
  document.setKeywords(['Bentevi', 'catálogo', 'Mercado Livre', 'competição', 'preço']);
  document.setCreationDate(new Date());
  return document.save({ useObjectStreams: false });
}

function mapExportRow(row: CatalogListingRow): ExportRow {
  return {
    itemId: String(row.ml_item_id || '').trim(),
    title: String(row.title || '').trim(),
    status: String(row.status || '').trim(),
    productName: String(row.produto_nome || '').trim(),
    productSku: String(row.sku_local || '').trim(),
    relatedItemId: row.relacionado_id ? String(row.relacionado_id).trim() : null,
    relatedStatus: row.related_status ? String(row.related_status).trim() : null,
    catalogProductId: row.catalog_product_id ? String(row.catalog_product_id).trim() : null,
    competitionStatus: row.buy_box_status ? String(row.buy_box_status).trim() : null,
    price: Number(row.price || 0),
    priceToWin: row.price_to_win === null ? null : Number(row.price_to_win),
  };
}

function normalizeOpportunityIds(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  return new Set(value.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean));
}

function parseNumber(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildFilterDescription(sourceUrl: URL, opportunities: Set<string> | null): string {
  const params = sourceUrl.searchParams;
  const statusLabels: Record<string, string> = { active: 'ativos', paused: 'pausados', closed: 'encerrados' };
  const competitionLabels: Record<string, string> = {
    winning: 'ganhando',
    sharing_first_place: 'dividindo 1º lugar',
    competing: 'competindo',
    outside: 'fora da competição',
  };
  const sortLabels: Record<string, string> = {
    ml_item_id: 'anúncio de catálogo',
    title: 'título',
    status: 'estado',
    price: 'preço',
    price_to_win: 'preço para ganhar',
    buy_box_status: 'competição',
  };
  const priceMin = parseNumber(params, 'priceMin');
  const priceMax = parseNumber(params, 'priceMax');
  const filters = [
    params.get('search') ? `Busca: ${params.get('search')}` : null,
    params.get('statusMl') && params.get('statusMl') !== 'all' ? `Status: ${statusLabels[params.get('statusMl') || ''] || params.get('statusMl')}` : null,
    params.get('buyBox') && params.get('buyBox') !== 'all' ? `Competição: ${competitionLabels[params.get('buyBox') || ''] || params.get('buyBox')}` : null,
    priceMin !== null ? `Preço mínimo: ${formatCurrency(priceMin)}` : null,
    priceMax !== null ? `Preço máximo: ${formatCurrency(priceMax)}` : null,
    opportunities !== null ? `Visão: ${opportunities.size} oportunidade(s) da última análise` : null,
  ].filter(Boolean);
  const sortBy = params.get('sortBy') || 'ml_item_id';
  const sortOrder = params.get('sortOrder') === 'asc' ? 'crescente' : 'decrescente';
  return [filters.length ? filters.join(' · ') : 'Nenhum filtro — todos os anúncios de catálogo', `Ordenação: ${sortLabels[sortBy] || 'anúncio de catálogo'} ${sortOrder}`].join(' · ');
}

export async function POST(request: Request) {
  try {
    const sourceUrl = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const opportunityIds = normalizeOpportunityIds(body?.opportunityIds);
    const listUrl = new URL('/api/catalogo/no-catalogo', request.url);
    for (const key of ['search', 'statusMl', 'buyBox', 'priceMin', 'priceMax', 'sortBy', 'sortOrder', 'sellerId']) {
      const value = sourceUrl.searchParams.get(key);
      if (value) listUrl.searchParams.set(key, value);
    }
    listUrl.searchParams.set('pageSize', '100');
    const headers = new Headers(request.headers);
    headers.set('x-vortek-read-only', '1');
    const rows: ExportRow[] = [];
    let page = 1;
    let total = 0;
    let lastSyncedAt: string | null = null;
    do {
      listUrl.searchParams.set('page', String(page));
      const response = await getCatalogListings(new Request(listUrl, { headers }));
      const payload = await response.json().catch(() => ({})) as CatalogPayload & { erro?: string; error?: string };
      if (!response.ok) {
        return NextResponse.json({ erro: payload.erro || payload.error || 'Falha ao consultar o catálogo' }, { status: response.status });
      }
      const pageRows = Array.isArray(payload.data) ? payload.data : [];
      rows.push(...pageRows.map(mapExportRow));
      total = Number(payload.total || 0);
      lastSyncedAt ||= payload.lastSyncedAt || null;
      page += 1;
      if (!pageRows.length) break;
    } while (rows.length < total);
    const exportedRows = opportunityIds === null
      ? rows
      : rows.filter((row) => opportunityIds.has(row.itemId.toUpperCase()));
    const pdf = await buildPdf(exportedRows, buildFilterDescription(sourceUrl, opportunityIds), lastSyncedAt);
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="catalogo-mercado-livre-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[api/catalogo/no-catalogo/exportar-pdf] Falha:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao gerar PDF do catálogo' }, { status: 500 });
  }
}
