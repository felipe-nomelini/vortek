import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PDFDocument, StandardFonts, rgb,
  type PDFFont, type PDFImage, type PDFPage, type RGB,
} from 'pdf-lib';
import { NextResponse } from 'next/server';
import { GET as getOrders } from '@/app/api/pedidos/route';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { formatMlReleaseWindow, getMlReleaseComparableDate } from '@/lib/ml/release-window-display';
import {
  SALES_PROGRESS_STAGES,
  getOperationalUrgencyReasons,
  getOrderSalesProgress,
  type OrderSalesProgress,
} from '@/lib/orders/operational-view';
import { getSkuLookupVariants } from '@/lib/sku';
import { benteviColors } from '@/theme/bentevi';
import { createServiceClient } from '@/lib/supabase';
import { loadOperationRuntimeConfiguration } from '@/services/operation-configuration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ExportProduct = { title: string; quantity: number; sku: string; mlItemId: string };
type ExportRow = {
  date: string;
  time: string;
  saleId: string;
  packId: string;
  bundleKind: string;
  status: string;
  statusRaw: string;
  client: string;
  fiscalClient: string;
  total: number;
  profit: number | null;
  profitPending: boolean;
  products: ExportProduct[];
  source: string;
  dsliteIds: string[];
  splitFulfillment: boolean;
  progress: OrderSalesProgress;
  invoiceNumbers: string[];
  shipmentId: string;
  tracking: string;
  labelRelease: string;
  claimId: string;
  urgencyReasons: string[];
};

type ColumnKey = 'date' | 'sale' | 'client' | 'products' | 'values' | 'origin' | 'progress' | 'fiscal';
type TableColumn = { key: ColumnKey; label: string; width: number };
type PreparedLine = { text: string; font: PDFFont; size: number; color: RGB; lineHeight: number };
type PreparedCell = { lines: PreparedLine[] };
type PreparedRow = {
  cells: Record<Exclude<ColumnKey, 'progress'>, PreparedCell>;
  progress: OrderSalesProgress;
  progressNextLines: string[];
  height: number;
};
type ReportFonts = { regular: PDFFont; bold: PDFFont; supportedCharacters: Set<number> };

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const TABLE_BOTTOM = 35;
const TABLE_HEADER_HEIGHT = 21;
const FIRST_PAGE_TABLE_TOP = 410;
const CONTINUATION_TABLE_TOP = PAGE_HEIGHT - 76;
const CELL_PADDING = 5;
const MIN_ROW_HEIGHT = 47;
const PRODUCT_LINES_PER_FRAGMENT = 24;

const columns: TableColumn[] = [
  { key: 'date', label: 'Data', width: 56 },
  { key: 'sale', label: 'Venda ML', width: 87 },
  { key: 'client', label: 'Cliente', width: 95 },
  { key: 'products', label: 'Produtos e SKUs', width: 168 },
  { key: 'values', label: 'Valores', width: 72 },
  { key: 'origin', label: 'Origem', width: 88 },
  { key: 'progress', label: 'Andamento', width: 126 },
  { key: 'fiscal', label: 'Fiscal e entrega', width: 93 },
];

const statusLabels: Record<string, string> = {
  aberto: 'Aberto', pendente: 'Pendente', preparando: 'Preparando', pronto_envio: 'Pronto p/ envio',
  etiqueta_impressa: 'Etiqueta impressa', coletado: 'Coletado', em_transito: 'Em trânsito',
  saiu_entrega: 'Saiu p/ entrega', dest_ausente: 'Dest. ausente', atendido: 'Atendido',
  faturado: 'Faturado', entregue: 'Entregue', recusado: 'Recusado', devolvido: 'Devolvido',
  concretizada_ml: 'Concretizada pelo ML',
  cancelado: 'Cancelado',
};

const operationalViewLabels: Record<string, string> = {
  urgent: 'Urgentes', preparation: 'Preparação', shipping: 'Em transporte', delivered: 'Entregues', all: 'Todos',
};

function hexToRgb(value: string): RGB {
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return rgb(((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255);
}

const colors = {
  background: hexToRgb(benteviColors.background), surface: hexToRgb(benteviColors.surface),
  surfaceElevated: hexToRgb(benteviColors.surfaceElevated), border: hexToRgb(benteviColors.border),
  text: hexToRgb(benteviColors.text), textSecondary: hexToRgb(benteviColors.textSecondary),
  primary: hexToRgb(benteviColors.primary), success: hexToRgb('#52C41A'), error: hexToRgb('#FF4D4F'),
};

function formatCurrency(value: number): string {
  const [integer, decimals] = Number(value || 0).toFixed(2).split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function formatDateParts(value: unknown): { date: string; time: string } {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
  return {
    date: date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }),
    time: date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
  };
}

function normalizeStatus(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function statusColor(value: string): RGB {
  const normalized = normalizeStatus(value);
  if (['cancelado', 'recusado', 'devolvido'].includes(normalized)) return colors.error;
  if (normalized === 'entregue') return colors.success;
  return colors.primary;
}

function sanitizeMlTechnicalSuffix(value: unknown): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (!match) return raw || '—';
  const base = match[1].trim();
  const suffix = match[2].trim();
  return base && (/\d/.test(suffix) || /^[A-Z0-9_.-]+$/i.test(suffix)) ? base : raw || '—';
}

function displaySku(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return getSkuLookupVariants(raw).find((sku) => /^VTK[A-Z0-9]+$/.test(sku)) || raw;
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

function wrapText(value: unknown, font: PDFFont, size: number, maxWidth: number, supportedCharacters: Set<number>): string[] {
  const text = sanitizeText(value, supportedCharacters);
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

function fitText(value: unknown, font: PDFFont, size: number, maxWidth: number, supportedCharacters: Set<number>): string {
  const text = sanitizeText(value, supportedCharacters);
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
  const size = options.size || 6.2;
  const lineHeight = options.lineHeight || size + 1.7;
  return wrapText(value, font, size, width, fonts.supportedCharacters).map((text) => ({
    text, font, size, color: options.color || colors.text, lineHeight,
  }));
}

function buildProductLines(row: ExportRow, width: number, fonts: ReportFonts): PreparedLine[] {
  const lines: PreparedLine[] = [];
  row.products.forEach((product, index) => {
    if (index > 0) lines.push({ text: '', font: fonts.regular, size: 2.4, color: colors.textSecondary, lineHeight: 3.4 });
    lines.push(...makeLines(product.title, width, fonts, { bold: true, size: 6.1, lineHeight: 7.7 }));
    lines.push(...makeLines(`Qtd. ${product.quantity} · SKU ${product.sku}`, width, fonts, { size: 5.4, color: colors.textSecondary }));
    if (product.mlItemId !== '—') {
      lines.push(...makeLines(`Item ML ${product.mlItemId}`, width, fonts, { size: 5.2, color: colors.textSecondary }));
    }
  });
  return lines.length ? lines : makeLines('Itens ainda não sincronizados', width, fonts, { size: 5.7, color: colors.primary });
}

function chunkLines(lines: PreparedLine[]): PreparedLine[][] {
  const chunks: PreparedLine[][] = [];
  for (let index = 0; index < lines.length; index += PRODUCT_LINES_PER_FRAGMENT) {
    chunks.push(lines.slice(index, index + PRODUCT_LINES_PER_FRAGMENT));
  }
  return chunks.length ? chunks : [[]];
}

function prepareRowFragments(row: ExportRow, fonts: ReportFonts): PreparedRow[] {
  const widths = Object.fromEntries(columns.map((column) => [column.key, column.width - (CELL_PADDING * 2)])) as Record<ColumnKey, number>;
  const productChunks = chunkLines(buildProductLines(row, widths.products, fonts));

  return productChunks.map((productLines, fragmentIndex) => {
    const saleLines = [
      ...makeLines(`Venda #${row.saleId}`, widths.sale, fonts, { bold: true, size: 6.2 }),
      ...(row.packId !== '—' && row.packId !== row.saleId ? makeLines(`Pack #${row.packId}`, widths.sale, fonts, { size: 5.5, color: colors.textSecondary }) : []),
      ...(row.bundleKind ? makeLines(row.bundleKind, widths.sale, fonts, { size: 5.3, color: colors.textSecondary }) : []),
      ...makeLines(row.status, widths.sale, fonts, { size: 5.5, color: statusColor(row.statusRaw) }),
      ...(productChunks.length > 1 ? makeLines(`Itens ${fragmentIndex + 1}/${productChunks.length}`, widths.sale, fonts, { size: 5.2, color: colors.primary }) : []),
    ];
    const clientLines = [
      ...makeLines(row.client, widths.client, fonts, { bold: true, size: 6 }),
      ...(row.fiscalClient && normalizeStatus(row.fiscalClient) !== normalizeStatus(row.client)
        ? makeLines(`Fiscal: ${row.fiscalClient}`, widths.client, fonts, { size: 5.2, color: colors.textSecondary }) : []),
    ];
    const profitColor = row.profit == null || row.profit === 0 ? colors.textSecondary : row.profit > 0 ? colors.success : colors.error;
    const valuesLines = [
      ...makeLines(formatCurrency(row.total), widths.values, fonts, { bold: true, size: 6.1 }),
      ...makeLines(
        row.profit == null ? (row.profitPending ? 'Lucro calculando' : 'Lucro —') : `Lucro ${formatCurrency(row.profit)}`,
        widths.values, fonts, { size: 5.4, color: profitColor },
      ),
    ];
    const originLines = [
      ...makeLines(row.source, widths.origin, fonts, { bold: true, size: 5.9 }),
      ...(row.dsliteIds.length ? makeLines(`DSLite ${row.dsliteIds.map((id) => `#${id}`).join(', ')}`, widths.origin, fonts, { size: 5.2, color: colors.textSecondary }) : []),
      ...(row.splitFulfillment ? makeLines('Fluxo dividido', widths.origin, fonts, { size: 5.3, color: colors.error }) : []),
    ];
    const fiscalLines: PreparedLine[] = [];
    if (row.invoiceNumbers.length) fiscalLines.push(...makeLines(`NF ${row.invoiceNumbers.join(', ')}`, widths.fiscal, fonts, { bold: true, size: 5.6 }));
    if (row.shipmentId !== '—') fiscalLines.push(...makeLines(`Shipment ${row.shipmentId}`, widths.fiscal, fonts, { size: 5.2, color: colors.textSecondary }));
    if (row.tracking !== '—') fiscalLines.push(...makeLines(`Rastreio ${row.tracking}`, widths.fiscal, fonts, { size: 5.2, color: colors.textSecondary }));
    if (row.labelRelease !== '—') fiscalLines.push(...makeLines(`Etiqueta ${row.labelRelease}`, widths.fiscal, fonts, { size: 5.2, color: colors.primary }));
    if (row.claimId !== '—') fiscalLines.push(...makeLines(`Reclamação #${row.claimId}`, widths.fiscal, fonts, { size: 5.2, color: colors.error }));
    if (!fiscalLines.length) fiscalLines.push(...makeLines('Sem documento ou rastreio', widths.fiscal, fonts, { size: 5.4, color: colors.textSecondary }));

    const cells: PreparedRow['cells'] = {
      date: {
        lines: fragmentIndex > 0
          ? makeLines('Continuação', widths.date, fonts, { size: 5.3, color: colors.primary })
          : [...makeLines(row.date, widths.date, fonts, { bold: true, size: 6.2 }), ...(row.time ? makeLines(row.time, widths.date, fonts, { size: 5.5, color: colors.textSecondary }) : [])],
      },
      sale: { lines: saleLines }, client: { lines: clientLines }, products: { lines: productLines },
      values: { lines: valuesLines }, origin: { lines: originLines }, fiscal: { lines: fiscalLines },
    };
    const progressNextLines = wrapText(`Próxima: ${row.progress.nextLabel}`, fonts.regular, 5.4, widths.progress, fonts.supportedCharacters);
    const standardCellHeight = Math.max(...Object.values(cells).map((cell) => (
      (CELL_PADDING * 2) + cell.lines.reduce((total, line) => total + line.lineHeight, 0)
    )));
    const progressHeight = (CELL_PADDING * 2) + 25 + (progressNextLines.length * 7.1);
    return { cells, progress: row.progress, progressNextLines, height: Math.max(MIN_ROW_HEIGHT, standardCellHeight, progressHeight) };
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
  page.drawText('Relatório de vendas', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 31, size: 17, font: fonts.bold, color: colors.text });
  page.drawText('Operação comercial, fulfillment, fiscal e entrega', { x: PAGE_MARGIN + 143, y: PAGE_HEIGHT - 47, size: 7.2, font: fonts.regular, color: colors.textSecondary });
  drawRightText(page, `Gerado em ${generatedAt}`, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 39, fonts.regular, 6.4, colors.textSecondary, fonts.supportedCharacters);
  page.drawRectangle({ x: PAGE_MARGIN, y: PAGE_HEIGHT - 62, width: PAGE_WIDTH - (PAGE_MARGIN * 2), height: 1.4, color: colors.primary });
}

function drawFilters(page: PDFPage, description: string, fonts: ReportFonts): void {
  const x = PAGE_MARGIN;
  const y = PAGE_HEIGHT - 112;
  const width = PAGE_WIDTH - (PAGE_MARGIN * 2);
  const height = 37;
  page.drawRectangle({ x, y, width, height, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  page.drawText('FILTROS APLICADOS', { x: x + 9, y: y + height - 12, size: 5.4, font: fonts.bold, color: colors.primary });
  wrapText(description, fonts.regular, 6.3, width - 18, fonts.supportedCharacters).slice(0, 2).forEach((line, index) => {
    page.drawText(line, { x: x + 9, y: y + height - 24 - (index * 7.4), size: 6.3, font: fonts.regular, color: colors.text });
  });
}

function buildSummaryMetrics(rows: ExportRow[]): Array<{ label: string; value: string; detail: string; color: RGB }> {
  const activeRows = rows.filter((row) => normalizeStatus(row.statusRaw) !== 'cancelado');
  const activeTotal = activeRows.reduce((total, row) => total + row.total, 0);
  const knownProfit = activeRows.reduce((total, row) => total + Number(row.profit || 0), 0);
  const pendingProfit = activeRows.filter((row) => row.profit == null || row.profitPending).length;
  const urgentCount = rows.filter((row) => row.urgencyReasons.length > 0).length;
  const deliveredCount = rows.filter((row) => normalizeStatus(row.statusRaw) === 'entregue').length;
  return [
    { label: 'VENDAS', value: String(rows.length), detail: 'No conjunto exportado', color: colors.text },
    { label: 'VALOR DAS VENDAS', value: formatCurrency(activeTotal), detail: 'Canceladas não somam', color: colors.primary },
    { label: 'LUCRO CONHECIDO', value: formatCurrency(knownProfit), detail: pendingProfit ? `${pendingProfit} com lucro pendente` : 'Todas com lucro calculado', color: knownProfit < 0 ? colors.error : knownProfit > 0 ? colors.success : colors.textSecondary },
    { label: 'URGENTES', value: String(urgentCount), detail: 'Exigem atenção operacional', color: urgentCount ? colors.error : colors.textSecondary },
    { label: 'ENTREGUES', value: String(deliveredCount), detail: 'Fluxo concluído', color: colors.success },
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

function drawProgressCell(page: PDFPage, prepared: PreparedRow, x: number, top: number, width: number, fonts: ReportFonts): void {
  const innerWidth = width - (CELL_PADDING * 2);
  const title = `Etapa ${prepared.progress.currentStep}/${SALES_PROGRESS_STAGES.length} - ${prepared.progress.currentLabel}`;
  const toneColor = prepared.progress.tone === 'error' ? colors.error : prepared.progress.tone === 'success' ? colors.success : colors.text;
  page.drawText(fitText(title, fonts.bold, 5.7, innerWidth, fonts.supportedCharacters), { x: x + CELL_PADDING, y: top - CELL_PADDING - 5.7, size: 5.7, font: fonts.bold, color: toneColor });
  const gap = 2;
  const segmentWidth = (innerWidth - (gap * (SALES_PROGRESS_STAGES.length - 1))) / SALES_PROGRESS_STAGES.length;
  const segmentY = top - CELL_PADDING - 18;
  SALES_PROGRESS_STAGES.forEach((_stage, index) => {
    const completed = index < prepared.progress.completedSteps;
    const active = index === prepared.progress.currentStep - 1;
    const color = completed ? (prepared.progress.tone === 'error' ? colors.error : colors.success) : active ? (prepared.progress.tone === 'error' ? colors.error : colors.primary) : colors.border;
    page.drawRectangle({ x: x + CELL_PADDING + (index * (segmentWidth + gap)), y: segmentY, width: segmentWidth, height: 4, color });
  });
  let nextY = segmentY - 10;
  prepared.progressNextLines.forEach((line) => {
    page.drawText(line, { x: x + CELL_PADDING, y: nextY, size: 5.4, font: fonts.regular, color: prepared.progress.tone === 'error' ? colors.error : colors.textSecondary });
    nextY -= 7.1;
  });
}

function drawTableRow(page: PDFPage, row: PreparedRow, top: number, rowIndex: number, fonts: ReportFonts): number {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const bottom = top - row.height;
  page.drawRectangle({ x: PAGE_MARGIN, y: bottom, width: tableWidth, height: row.height, color: rowIndex % 2 ? colors.surfaceElevated : colors.surface, borderColor: colors.border, borderWidth: 0.35 });
  let x = PAGE_MARGIN;
  columns.forEach((column, index) => {
    if (column.key === 'progress') drawProgressCell(page, row, x, top, column.width, fonts);
    else drawPreparedCell(page, row.cells[column.key], x, top);
    x += column.width;
    if (index < columns.length - 1) page.drawLine({ start: { x, y: bottom }, end: { x, y: top }, thickness: 0.3, color: colors.border });
  });
  return bottom;
}

function drawEmptyState(page: PDFPage, top: number, fonts: ReportFonts): void {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  page.drawRectangle({ x: PAGE_MARGIN, y: top - 72, width: tableWidth, height: 72, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  const title = 'Nenhuma venda encontrada';
  const detail = 'Altere a fila ou os filtros da página de Vendas e gere o relatório novamente.';
  page.drawText(title, { x: PAGE_MARGIN + ((tableWidth - fonts.bold.widthOfTextAtSize(title, 10)) / 2), y: top - 31, size: 10, font: fonts.bold, color: colors.text });
  page.drawText(detail, { x: PAGE_MARGIN + ((tableWidth - fonts.regular.widthOfTextAtSize(detail, 6.3)) / 2), y: top - 46, size: 6.3, font: fonts.regular, color: colors.textSecondary });
}

function drawFooters(document: PDFDocument, fonts: ReportFonts, generatedAt: string): void {
  document.getPages().forEach((page, index, pages) => {
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
    if (first) { drawFilters(page, filterDescription, fonts); drawSummary(page, rows, fonts); }
    return { page, cursor: drawTableHeader(page, first ? FIRST_PAGE_TABLE_TOP : CONTINUATION_TABLE_TOP, fonts) };
  };
  let current = addPage(true);
  if (!rows.length) drawEmptyState(current.page, current.cursor, fonts);
  else {
    rows.flatMap((row) => prepareRowFragments(row, fonts)).forEach((prepared, rowIndex) => {
      if (current.cursor - prepared.height < TABLE_BOTTOM) current = addPage(false);
      current.cursor = drawTableRow(current.page, prepared, current.cursor, rowIndex, fonts);
    });
  }
  drawFooters(document, fonts, generatedAt);
  document.setTitle('Bentevi — Relatório de vendas');
  document.setAuthor('Bentevi');
  document.setCreator('Bentevi ERP');
  document.setProducer('Bentevi ERP');
  document.setSubject('Relatório operacional de vendas');
  document.setKeywords(['Bentevi', 'vendas', 'Mercado Livre', 'fulfillment']);
  document.setCreationDate(new Date());
  return document.save({ useObjectStreams: false });
}

function mapProducts(row: Record<string, any>): ExportProduct[] {
  const items = Array.isArray(row.pedido_itens) ? row.pedido_itens : [];
  if (items.length) return items.map((item: Record<string, any>) => ({
    title: String(item.titulo || '').trim() || 'Produto não informado',
    quantity: Number(item.quantidade || 0), sku: displaySku(item.seller_sku),
    mlItemId: String(item.ml_item_id || '').trim() || '—',
  }));
  if (String(row.compra_produto_descricao || '').trim()) return [{
    title: String(row.compra_produto_descricao), quantity: Number(row.compra_quantidade || 1),
    sku: displaySku(row.compra_produto_sku), mlItemId: '—',
  }];
  return [];
}

function formatLabelRelease(row: Record<string, any>): string {
  const raw = String(row.ml_fiscal_release_at || '').trim();
  if (!raw || String(row.situacao || '') === 'etiqueta_impressa') return '—';
  const releaseAt = getMlReleaseComparableDate(raw);
  return releaseAt && releaseAt.getTime() > Date.now() ? `libera em ${formatMlReleaseWindow(raw).when}` : '—';
}

function mapExportRow(row: Record<string, any>, delayedAfterMinutes: number): ExportRow {
  const dateParts = formatDateParts(row.data_venda || row.data);
  const statusRaw = String(row.situacao || 'aberto');
  const rawProfit = row.lucro === null || row.lucro === undefined ? null : Number(row.lucro);
  const dsliteIds = Array.isArray(row.operational_dslite_ids) ? row.operational_dslite_ids.map(String).filter(Boolean) : String(row.dslite_id || '').trim() ? [String(row.dslite_id)] : [];
  const invoiceNumbers = Array.isArray(row.operational_invoice_numbers) ? row.operational_invoice_numbers.map(String).filter(Boolean) : String(row.nota_fiscal_numero || '').trim() ? [String(row.nota_fiscal_numero)] : [];
  const internal = row.fulfillment_source === 'internal' || Boolean(row.envio_interno_at);
  return {
    date: dateParts.date, time: dateParts.time, saleId: String(row.ml_order_id || row.numero || '—'),
    packId: String(row.ml_pack_id || '').trim() || '—',
    bundleKind: [row.is_virtual_kit ? 'Kit virtual' : '', row.is_cart ? 'Carrinho' : ''].filter(Boolean).join(' · '),
    status: statusLabels[statusRaw] || statusRaw.replaceAll('_', ' '), statusRaw,
    client: sanitizeMlTechnicalSuffix(row.contato_nome), fiscalClient: String(row.billing_nome || '').trim(),
    total: Number(row.total || 0), profit: rawProfit !== null && Number.isFinite(rawProfit) ? rawProfit : null,
    profitPending: Boolean(row.operational_profit_pending), products: mapProducts(row),
    source: internal ? 'Estoque interno' : String(row.fornecedor_nome || 'Fornecedor a definir'),
    dsliteIds, splitFulfillment: Boolean(row.has_split_fulfillment), progress: getOrderSalesProgress(row),
    invoiceNumbers, shipmentId: String(row.ml_shipment_id || '').trim() || '—',
    tracking: String(row.rastreio || '').trim() || '—', labelRelease: formatLabelRelease(row),
    claimId: String(row.ml_claim_id || '').trim() || '—', urgencyReasons: getOperationalUrgencyReasons(row, delayedAfterMinutes),
  };
}

function parseNumber(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function buildFilterDescription(sourceUrl: URL, supplierOptions: Array<{ id: string; label: string }>): string {
  const status = sourceUrl.searchParams.get('status') || '';
  const view = sourceUrl.searchParams.get('operationalView') || 'all';
  const priceMin = parseNumber(sourceUrl.searchParams, 'priceMin');
  const priceMax = parseNumber(sourceUrl.searchParams, 'priceMax');
  const supplierIds = sourceUrl.searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
  const suppliers = supplierOptions.filter((option) => supplierIds.includes(String(option.id))).map((option) => option.label);
  return [
    `Fila: ${operationalViewLabels[view] || view}`,
    sourceUrl.searchParams.get('search') ? `Busca: ${sourceUrl.searchParams.get('search')}` : null,
    status ? `Status: ${statusLabels[status] || status}` : null,
    suppliers.length ? `Origem: ${suppliers.join(', ')}` : null,
    sourceUrl.searchParams.get('dateFrom') ? `Data inicial: ${sourceUrl.searchParams.get('dateFrom')}` : null,
    sourceUrl.searchParams.get('dateTo') ? `Data final: ${sourceUrl.searchParams.get('dateTo')}` : null,
    priceMin !== null ? `Valor mínimo: ${formatCurrency(priceMin)}` : null,
    priceMax !== null ? `Valor máximo: ${formatCurrency(priceMax)}` : null,
  ].filter(Boolean).join(' · ');
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;
  try {
    const operationConfiguration = await loadOperationRuntimeConfiguration(createServiceClient());
    const sourceUrl = new URL(request.url);
    const listUrl = new URL('/api/pedidos', request.url);
    for (const key of ['search', 'status', 'dateFrom', 'dateTo', 'priceMin', 'priceMax', 'fornecedores', 'operationalView', 'sortBy', 'sortOrder']) {
      const value = sourceUrl.searchParams.get(key);
      if (value) listUrl.searchParams.set(key, value);
    }
    listUrl.searchParams.set('pageSize', '1000');
    const headers = new Headers(request.headers);
    headers.set('x-vortek-read-only', '1');
    const rows: Record<string, any>[] = [];
    let page = 1;
    let total = 0;
    let supplierOptions: Array<{ id: string; label: string }> = [];
    do {
      listUrl.searchParams.set('page', String(page));
      const response = await getOrders(new Request(listUrl, { headers }));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return NextResponse.json({ erro: payload?.error?.message || payload?.erro || 'Falha ao consultar vendas' }, { status: response.status });
      const pageRows = Array.isArray(payload?.data) ? payload.data : [];
      if (!supplierOptions.length && Array.isArray(payload?.fornecedores)) supplierOptions = payload.fornecedores;
      rows.push(...pageRows);
      total = Number(payload?.total || 0);
      page += 1;
      if (!pageRows.length) break;
    } while (rows.length < total);
    const exportRows = rows.map((row) => mapExportRow(row, operationConfiguration.delayedAfterMinutes));
    const pdf = await buildPdf(exportRows, buildFilterDescription(sourceUrl, supplierOptions));
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="vendas-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[api/pedidos/exportar-pdf] Falha:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao gerar PDF das vendas' }, { status: 500 });
  }
}
