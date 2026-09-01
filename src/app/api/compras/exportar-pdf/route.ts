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
import { GET as getPurchases } from '@/app/api/compras/route';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  resolvePurchaseProgress,
  type PurchaseProgress,
  type PurchaseStepStatus,
} from '@/lib/purchase-progress';
import { benteviColors } from '@/theme/bentevi';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ExportRow = {
  date: string;
  time: string;
  compraDslite: string;
  status: string;
  statusDslite: string;
  packMl: string;
  vendaMl: string;
  fornecedor: string;
  produto: string;
  quantidade: number;
  skuBentevi: string;
  skuFornecedor: string;
  valorFornecedor: number | null;
  valorVenda: number;
  valorFrete: number;
  supplierPaymentMode: string;
  supplierPaymentStatus: string;
  nfDslite: string;
  rastreio: string;
  progress: PurchaseProgress;
};

type ColumnKey = 'date' | 'purchase' | 'sale' | 'product' | 'supplier' | 'values' | 'progress' | 'fiscal';

type TableColumn = {
  key: ColumnKey;
  label: string;
  width: number;
};

type PreparedLine = {
  text: string;
  font: PDFFont;
  size: number;
  color: RGB;
  lineHeight: number;
};

type PreparedCell = {
  lines: PreparedLine[];
};

type PreparedRow = {
  cells: Record<Exclude<ColumnKey, 'progress'>, PreparedCell>;
  progress: PurchaseProgress;
  progressNextLines: string[];
  height: number;
};

type ReportFonts = {
  regular: PDFFont;
  bold: PDFFont;
  supportedCharacters: Set<number>;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const TABLE_BOTTOM = 35;
const TABLE_HEADER_HEIGHT = 21;
const FIRST_PAGE_TABLE_TOP = 410;
const CONTINUATION_TABLE_TOP = PAGE_HEIGHT - 76;
const CELL_PADDING = 5;
const MIN_ROW_HEIGHT = 44;

const columns: TableColumn[] = [
  { key: 'date', label: 'Data', width: 62 },
  { key: 'purchase', label: 'Compra DSLite', width: 78 },
  { key: 'sale', label: 'Venda ML', width: 92 },
  { key: 'product', label: 'Produto e SKUs', width: 190 },
  { key: 'supplier', label: 'Fornecedor', width: 72 },
  { key: 'values', label: 'Valores', width: 82 },
  { key: 'progress', label: 'Andamento', width: 126 },
  { key: 'fiscal', label: 'Fiscal e envio', width: 83 },
];

function hexToRgb(value: string): RGB {
  const normalized = value.replace('#', '');
  const parsed = Number.parseInt(normalized, 16);
  return rgb(
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  );
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
  const fixed = Number(value || 0).toFixed(2);
  const [integer, decimals] = fixed.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function formatDateParts(value: unknown): { date: string; time: string } {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
  return {
    date: date.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }),
    time: date.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function normalizeStatus(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function statusColor(value: string): RGB {
  const normalized = normalizeStatus(value);
  if (normalized.includes('cancel') || normalized.includes('falha')) return colors.error;
  if (normalized.includes('fatur')) return colors.success;
  if (normalized.includes('revis') || normalized.includes('aguard')) return colors.primary;
  return colors.textSecondary;
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
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(
  value: unknown,
  font: PDFFont,
  size: number,
  maxWidth: number,
  supportedCharacters: Set<number>,
): string[] {
  const text = sanitizeText(value, supportedCharacters);
  if (!text) return ['—'];

  const tokens = text.split(' ').flatMap((word) => (
    font.widthOfTextAtSize(word, size) > maxWidth
      ? splitLongWord(word, font, size, maxWidth)
      : [word]
  ));
  const lines: string[] = [];
  let current = '';

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ['—'];
}

function fitText(
  value: unknown,
  font: PDFFont,
  size: number,
  maxWidth: number,
  supportedCharacters: Set<number>,
): string {
  const text = sanitizeText(value, supportedCharacters);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const suffix = '...';
  let fitted = text;
  while (fitted && font.widthOfTextAtSize(`${fitted}${suffix}`, size) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}${suffix}`;
}

function makeLines(
  value: unknown,
  width: number,
  fonts: ReportFonts,
  options: {
    bold?: boolean;
    size?: number;
    color?: RGB;
    lineHeight?: number;
  } = {},
): PreparedLine[] {
  const font = options.bold ? fonts.bold : fonts.regular;
  const size = options.size || 6.2;
  const lineHeight = options.lineHeight || size + 1.7;
  return wrapText(value, font, size, width, fonts.supportedCharacters).map((text) => ({
    text,
    font,
    size,
    color: options.color || colors.text,
    lineHeight,
  }));
}

function prepareRow(row: ExportRow, fonts: ReportFonts): PreparedRow {
  const widths = Object.fromEntries(columns.map((column) => [column.key, column.width - (CELL_PADDING * 2)])) as Record<ColumnKey, number>;
  const purchaseLines = [
    ...makeLines(row.compraDslite, widths.purchase, fonts, { bold: true, size: 6.5 }),
    ...makeLines(row.status || 'Sem status', widths.purchase, fonts, { size: 5.7, color: statusColor(row.status) }),
  ];
  if (row.statusDslite && normalizeStatus(row.statusDslite) !== normalizeStatus(row.status)) {
    purchaseLines.push(...makeLines(`DSLite: ${row.statusDslite}`, widths.purchase, fonts, { size: 5.4, color: colors.textSecondary }));
  }

  const saleLines = row.packMl === '—' && row.vendaMl === '—'
    ? makeLines('Não vinculada', widths.sale, fonts, { size: 5.8, color: colors.textSecondary })
    : [
        ...(row.packMl !== '—' ? makeLines(`Pack ${row.packMl}`, widths.sale, fonts, { bold: true, size: 5.9 }) : []),
        ...(row.vendaMl !== '—' ? makeLines(`Venda ${row.vendaMl}`, widths.sale, fonts, { size: 5.8, color: colors.textSecondary }) : []),
      ];

  const productLines = [
    ...makeLines(row.produto, widths.product, fonts, { bold: true, size: 6.3, lineHeight: 8 }),
    ...makeLines(`Qtd. ${row.quantidade}`, widths.product, fonts, { size: 5.6, color: colors.textSecondary }),
    ...makeLines(`SKU Bentevi: ${row.skuBentevi}`, widths.product, fonts, { size: 5.5, color: colors.textSecondary }),
    ...makeLines(`SKU fornecedor: ${row.skuFornecedor}`, widths.product, fonts, { size: 5.5, color: colors.textSecondary }),
  ];

  const cells: PreparedRow['cells'] = {
    date: {
      lines: [
        ...makeLines(row.date, widths.date, fonts, { bold: true, size: 6.3 }),
        ...(row.time ? makeLines(row.time, widths.date, fonts, { size: 5.7, color: colors.textSecondary }) : []),
      ],
    },
    purchase: { lines: purchaseLines },
    sale: { lines: saleLines },
    product: { lines: productLines },
    supplier: { lines: makeLines(row.fornecedor, widths.supplier, fonts, { bold: true, size: 6.1 }) },
    values: {
      lines: [
        ...makeLines(
          row.valorFornecedor == null ? 'Custo: a definir' : `Custo ${formatCurrency(row.valorFornecedor)}`,
          widths.values,
          fonts,
          { bold: true, size: 5.9, color: row.valorFornecedor == null ? colors.primary : colors.text },
        ),
        ...makeLines(`Venda ${formatCurrency(row.valorVenda)}`, widths.values, fonts, { size: 5.6, color: colors.textSecondary }),
        ...makeLines(`Frete ${formatCurrency(row.valorFrete)}`, widths.values, fonts, { size: 5.6, color: colors.textSecondary }),
      ],
    },
    fiscal: {
      lines: [
        ...makeLines(`NF: ${row.nfDslite}`, widths.fiscal, fonts, { bold: row.nfDslite !== '—', size: 5.8 }),
        ...makeLines(`Rastreio: ${row.rastreio}`, widths.fiscal, fonts, { size: 5.5, color: colors.textSecondary }),
      ],
    },
  };

  const progressNextLines = wrapText(
    `Próximo: ${row.progress.nextLabel}`,
    fonts.regular,
    5.5,
    widths.progress,
    fonts.supportedCharacters,
  );
  const standardCellHeight = Math.max(...Object.values(cells).map((cell) => (
    (CELL_PADDING * 2) + cell.lines.reduce((total, line) => total + line.lineHeight, 0)
  )));
  const progressHeight = (CELL_PADDING * 2) + 5 + 8 + (progressNextLines.length * 7.2);

  return {
    cells,
    progress: row.progress,
    progressNextLines,
    height: Math.max(MIN_ROW_HEIGHT, standardCellHeight, progressHeight),
  };
}

function drawRightText(
  page: PDFPage,
  value: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
  color: RGB,
  supportedCharacters: Set<number>,
): void {
  const text = sanitizeText(value, supportedCharacters);
  page.drawText(text, {
    x: rightX - font.widthOfTextAtSize(text, size),
    y,
    size,
    font,
    color,
  });
}

function drawPageHeader(
  page: PDFPage,
  logo: PDFImage,
  fonts: ReportFonts,
  generatedAt: string,
): void {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: colors.background });
  const logoSize = logo.scaleToFit(119, 27);
  page.drawImage(logo, {
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 49,
    width: logoSize.width,
    height: logoSize.height,
  });
  page.drawText('Relatório de compras', {
    x: PAGE_MARGIN + 143,
    y: PAGE_HEIGHT - 31,
    size: 17,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText('Operação de compras, pagamentos, fiscal e entrega', {
    x: PAGE_MARGIN + 143,
    y: PAGE_HEIGHT - 47,
    size: 7.2,
    font: fonts.regular,
    color: colors.textSecondary,
  });
  drawRightText(
    page,
    `Gerado em ${generatedAt}`,
    PAGE_WIDTH - PAGE_MARGIN,
    PAGE_HEIGHT - 39,
    fonts.regular,
    6.4,
    colors.textSecondary,
    fonts.supportedCharacters,
  );
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: PAGE_HEIGHT - 62,
    width: PAGE_WIDTH - (PAGE_MARGIN * 2),
    height: 1.4,
    color: colors.primary,
  });
}

function drawFilters(page: PDFPage, description: string, fonts: ReportFonts): void {
  const x = PAGE_MARGIN;
  const y = PAGE_HEIGHT - 112;
  const width = PAGE_WIDTH - (PAGE_MARGIN * 2);
  const height = 37;
  page.drawRectangle({ x, y, width, height, color: colors.surface, borderColor: colors.border, borderWidth: 0.6 });
  page.drawText('FILTROS APLICADOS', {
    x: x + 9,
    y: y + height - 12,
    size: 5.4,
    font: fonts.bold,
    color: colors.primary,
  });
  const lines = wrapText(description, fonts.regular, 6.3, width - 18, fonts.supportedCharacters).slice(0, 2);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: x + 9,
      y: y + height - 24 - (index * 7.4),
      size: 6.3,
      font: fonts.regular,
      color: colors.text,
    });
  });
}

function buildSummaryMetrics(rows: ExportRow[]): Array<{ label: string; value: string; detail: string; color: RGB }> {
  const pendingPix = rows.filter((row) => row.supplierPaymentMode === 'prepaid_pix' && row.supplierPaymentStatus === 'pending');
  const pendingKnownTotal = pendingPix.reduce((total, row) => total + Number(row.valorFornecedor || 0), 0);
  const pendingMissingAmount = pendingPix.filter((row) => row.valorFornecedor == null).length;
  const reviewCount = rows.filter((row) => normalizeStatus(row.status) === 'revisao').length;
  const invoicedCount = rows.filter((row) => normalizeStatus(row.status) === 'faturado').length;

  return [
    { label: 'COMPRAS', value: String(rows.length), detail: 'Nos filtros atuais', color: colors.text },
    { label: 'PIX A CONFIRMAR', value: String(pendingPix.length), detail: 'Pendentes no Vortek', color: colors.primary },
    { label: 'EM REVISÃO', value: String(reviewCount), detail: 'Precisam de conferência', color: colors.error },
    { label: 'FATURADAS', value: String(invoicedCount), detail: 'Com faturamento concluído', color: colors.success },
    {
      label: 'VALOR PIX PENDENTE',
      value: formatCurrency(pendingKnownTotal),
      detail: pendingMissingAmount > 0 ? `${pendingMissingAmount} sem valor informado` : 'Somente valores conhecidos',
      color: colors.primary,
    },
  ];
}

function drawSummary(page: PDFPage, rows: ExportRow[], fonts: ReportFonts): void {
  const metrics = buildSummaryMetrics(rows);
  const gap = 6;
  const totalWidth = PAGE_WIDTH - (PAGE_MARGIN * 2);
  const width = (totalWidth - (gap * (metrics.length - 1))) / metrics.length;
  const y = PAGE_HEIGHT - 164;
  const height = 40;

  metrics.forEach((metric, index) => {
    const x = PAGE_MARGIN + (index * (width + gap));
    page.drawRectangle({ x, y, width, height, color: colors.surfaceElevated, borderColor: colors.border, borderWidth: 0.6 });
    page.drawRectangle({ x, y, width: 2.2, height, color: metric.color });
    page.drawText(metric.label, {
      x: x + 8,
      y: y + 28,
      size: 5.1,
      font: fonts.bold,
      color: colors.textSecondary,
    });
    page.drawText(fitText(metric.value, fonts.bold, 10, width - 16, fonts.supportedCharacters), {
      x: x + 8,
      y: y + 15,
      size: 10,
      font: fonts.bold,
      color: metric.color,
    });
    page.drawText(fitText(metric.detail, fonts.regular, 5.1, width - 16, fonts.supportedCharacters), {
      x: x + 8,
      y: y + 6,
      size: 5.1,
      font: fonts.regular,
      color: colors.textSecondary,
    });
  });
}

function drawTableHeader(page: PDFPage, tableTop: number, fonts: ReportFonts): number {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const y = tableTop - TABLE_HEADER_HEIGHT;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y,
    width: tableWidth,
    height: TABLE_HEADER_HEIGHT,
    color: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 0.6,
  });
  page.drawRectangle({ x: PAGE_MARGIN, y, width: tableWidth, height: 1.2, color: colors.primary });

  let x = PAGE_MARGIN;
  columns.forEach((column, index) => {
    page.drawText(fitText(column.label, fonts.bold, 6, column.width - 10, fonts.supportedCharacters), {
      x: x + CELL_PADDING,
      y: y + 7.2,
      size: 6,
      font: fonts.bold,
      color: colors.text,
    });
    x += column.width;
    if (index < columns.length - 1) {
      page.drawLine({
        start: { x, y },
        end: { x, y: tableTop },
        thickness: 0.35,
        color: colors.border,
      });
    }
  });
  return y;
}

function drawPreparedCell(page: PDFPage, cell: PreparedCell, x: number, top: number): void {
  let cursor = top - CELL_PADDING;
  for (const line of cell.lines) {
    cursor -= line.size;
    page.drawText(line.text, { x: x + CELL_PADDING, y: cursor, size: line.size, font: line.font, color: line.color });
    cursor -= line.lineHeight - line.size;
  }
}

function progressColor(status: PurchaseStepStatus): RGB {
  if (status === 'finish') return colors.success;
  if (status === 'process') return colors.primary;
  if (status === 'error') return colors.error;
  return colors.border;
}

function drawProgressCell(
  page: PDFPage,
  prepared: PreparedRow,
  x: number,
  top: number,
  width: number,
  fonts: ReportFonts,
): void {
  const innerWidth = width - (CELL_PADDING * 2);
  const gap = 2;
  const segmentWidth = (innerWidth - (gap * 3)) / 4;
  const segmentY = top - CELL_PADDING - 5;

  prepared.progress.items.forEach((item, index) => {
    const segmentX = x + CELL_PADDING + (index * (segmentWidth + gap));
    page.drawRectangle({ x: segmentX, y: segmentY, width: segmentWidth, height: 4, color: progressColor(item.status) });
    const label = sanitizeText(item.title, fonts.supportedCharacters);
    const labelWidth = fonts.regular.widthOfTextAtSize(label, 4.8);
    page.drawText(label, {
      x: segmentX + Math.max(0, (segmentWidth - labelWidth) / 2),
      y: segmentY - 6.5,
      size: 4.8,
      font: fonts.regular,
      color: item.status === 'wait' ? colors.textSecondary : colors.text,
    });
  });

  let nextY = segmentY - 16;
  prepared.progressNextLines.forEach((line) => {
    page.drawText(line, { x: x + CELL_PADDING, y: nextY, size: 5.5, font: fonts.regular, color: colors.textSecondary });
    nextY -= 7.2;
  });
}

function drawTableRow(
  page: PDFPage,
  row: PreparedRow,
  top: number,
  rowIndex: number,
  fonts: ReportFonts,
): number {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const bottom = top - row.height;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: bottom,
    width: tableWidth,
    height: row.height,
    color: rowIndex % 2 === 0 ? colors.surface : colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 0.35,
  });

  let x = PAGE_MARGIN;
  columns.forEach((column, index) => {
    if (column.key === 'progress') {
      drawProgressCell(page, row, x, top, column.width, fonts);
    } else {
      drawPreparedCell(page, row.cells[column.key], x, top);
    }
    x += column.width;
    if (index < columns.length - 1) {
      page.drawLine({
        start: { x, y: bottom },
        end: { x, y: top },
        thickness: 0.3,
        color: colors.border,
      });
    }
  });
  return bottom;
}

function drawEmptyState(page: PDFPage, top: number, fonts: ReportFonts): void {
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const height = 72;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: top - height,
    width: tableWidth,
    height,
    color: colors.surface,
    borderColor: colors.border,
    borderWidth: 0.6,
  });
  const title = 'Nenhuma compra encontrada';
  const detail = 'Altere os filtros da página de Compras e gere o relatório novamente.';
  page.drawText(title, {
    x: PAGE_MARGIN + ((tableWidth - fonts.bold.widthOfTextAtSize(title, 10)) / 2),
    y: top - 31,
    size: 10,
    font: fonts.bold,
    color: colors.text,
  });
  page.drawText(detail, {
    x: PAGE_MARGIN + ((tableWidth - fonts.regular.widthOfTextAtSize(detail, 6.3)) / 2),
    y: top - 46,
    size: 6.3,
    font: fonts.regular,
    color: colors.textSecondary,
  });
}

function drawFooters(document: PDFDocument, fonts: ReportFonts, generatedAt: string): void {
  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: PAGE_MARGIN, y: 27 },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 27 },
      thickness: 0.45,
      color: colors.border,
    });
    page.drawText('Bentevi · Documento operacional interno', {
      x: PAGE_MARGIN,
      y: 16,
      size: 5.8,
      font: fonts.regular,
      color: colors.textSecondary,
    });
    drawRightText(
      page,
      `Página ${index + 1} de ${pages.length} · ${generatedAt}`,
      PAGE_WIDTH - PAGE_MARGIN,
      16,
      fonts.regular,
      5.8,
      colors.textSecondary,
      fonts.supportedCharacters,
    );
  });
}

async function buildPdf(rows: ExportRow[], filterDescription: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const fonts: ReportFonts = {
    regular: regularFont,
    bold: boldFont,
    supportedCharacters: new Set(regularFont.getCharacterSet()),
  };
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
    const tableTop = first ? FIRST_PAGE_TABLE_TOP : CONTINUATION_TABLE_TOP;
    return { page, cursor: drawTableHeader(page, tableTop, fonts) };
  };

  let current = addPage(true);
  if (rows.length === 0) {
    drawEmptyState(current.page, current.cursor, fonts);
  } else {
    rows.forEach((row, rowIndex) => {
      const prepared = prepareRow(row, fonts);
      if (current.cursor - prepared.height < TABLE_BOTTOM) {
        current = addPage(false);
      }
      current.cursor = drawTableRow(current.page, prepared, current.cursor, rowIndex, fonts);
    });
  }

  drawFooters(document, fonts, generatedAt);
  document.setTitle('Bentevi — Relatório de compras');
  document.setAuthor('Bentevi');
  document.setCreator('Bentevi ERP');
  document.setProducer('Bentevi ERP');
  document.setSubject('Relatório operacional de compras');
  document.setKeywords(['Bentevi', 'compras', 'DSLite', 'Mercado Livre']);
  document.setCreationDate(new Date());
  return document.save({ useObjectStreams: false });
}

function mapExportRow(row: Record<string, any>): ExportRow {
  const dateParts = formatDateParts(row.data_criacao);
  const productDescription = String(row.produto_descricao || '').trim() || 'Produto não informado';
  const progress = resolvePurchaseProgress(row);

  return {
    date: dateParts.date,
    time: dateParts.time,
    compraDslite: row.dsid ? `#${String(row.dsid)}` : '—',
    status: String(row.status || 'Sem status'),
    statusDslite: String(row.status_dslite || ''),
    packMl: row.pedido_ml_pack_id ? `#${String(row.pedido_ml_pack_id)}` : '—',
    vendaMl: row.pedido_ml_order_id ? `#${String(row.pedido_ml_order_id)}` : '—',
    fornecedor: String(row.fornecedor_apelido || row.fornecedor_nome || 'Não informado'),
    produto: productDescription,
    quantidade: Number(row.quantidade || 1),
    skuBentevi: String(row.produto_sku_bentevi || 'Não vinculado'),
    skuFornecedor: String(row.produto_sku_fornecedor || 'Não vinculado'),
    valorFornecedor: row.supplier_payment_amount == null ? null : Number(row.supplier_payment_amount),
    valorVenda: Number(row.valor_total || 0),
    valorFrete: Number(row.valor_frete || 0),
    supplierPaymentMode: String(row.supplier_payment_mode || ''),
    supplierPaymentStatus: String(row.supplier_payment_status || ''),
    nfDslite: String(row.nf_numero || '—'),
    rastreio: String(row.rastreio || '—'),
    progress,
  };
}

function buildFilterDescription(sourceUrl: URL, rows: ExportRow[]): string {
  const supplierId = sourceUrl.searchParams.get('fornecedorId');
  const supplierLabel = supplierId
    ? rows.find((row) => row.fornecedor !== 'Não informado')?.fornecedor || `DSLite #${supplierId}`
    : null;
  const activeFilters = [
    sourceUrl.searchParams.get('search') ? `Busca: ${sourceUrl.searchParams.get('search')}` : null,
    sourceUrl.searchParams.get('status') ? `Status: ${sourceUrl.searchParams.get('status')}` : null,
    supplierLabel ? `Fornecedor: ${supplierLabel}` : null,
    sourceUrl.searchParams.get('dateFrom') ? `Data inicial: ${sourceUrl.searchParams.get('dateFrom')}` : null,
    sourceUrl.searchParams.get('dateTo') ? `Data final: ${sourceUrl.searchParams.get('dateTo')}` : null,
  ].filter(Boolean);
  return activeFilters.length > 0 ? activeFilters.join(' · ') : 'Nenhum filtro — todas as compras';
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;

  try {
    const sourceUrl = new URL(request.url);
    const listUrl = new URL('/api/compras', request.url);
    for (const key of ['search', 'status', 'fornecedorId', 'dateFrom', 'dateTo', 'sortBy', 'sortOrder']) {
      const value = sourceUrl.searchParams.get(key);
      if (value) listUrl.searchParams.set(key, value);
    }
    listUrl.searchParams.set('page', '1');
    listUrl.searchParams.set('limit', String(2_147_483_647));

    const response = await getPurchases(new Request(listUrl, { headers: request.headers }));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { erro: payload?.error?.message || payload?.error || 'Falha ao consultar compras' },
        { status: response.status },
      );
    }

    const rows = (Array.isArray(payload?.data) ? payload.data : []).map(mapExportRow);
    const pdf = await buildPdf(rows, buildFilterDescription(sourceUrl, rows));
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="compras-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[api/compras/exportar-pdf] Falha:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao gerar PDF das compras' }, { status: 500 });
  }
}
