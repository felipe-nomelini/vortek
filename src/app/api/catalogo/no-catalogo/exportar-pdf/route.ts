import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  applyNoCatalogFilters,
  isWinningBuyBoxStatus,
  parseNoCatalogFilters,
  resolveCatalogDisplaySku,
} from '@/lib/catalogo/no-catalogo';

type ExportRow = {
  sku: string;
  anuncio: string;
  relacionado: string;
  titulo: string;
  status: string;
  buyBox: string;
  preco: number;
  precoGanhar: number | null;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const TABLE_TOP = PAGE_HEIGHT - 86;
const TABLE_BOTTOM = 34;
const HEADER_HEIGHT = 18;
const ROW_HEIGHT = 15;

const columns: Array<{
  key: keyof ExportRow;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  format?: (row: ExportRow) => string;
}> = [
  { key: 'sku', label: 'SKU', width: 58 },
  { key: 'anuncio', label: 'Anúncio', width: 86 },
  { key: 'relacionado', label: 'Relacionado', width: 86 },
  { key: 'titulo', label: 'Título', width: 225 },
  { key: 'status', label: 'Status', width: 64 },
  { key: 'buyBox', label: 'Buy Box', width: 62, align: 'center' },
  { key: 'preco', label: 'Preço', width: 82, align: 'right', format: (row) => formatCurrency(row.preco) },
  { key: 'precoGanhar', label: 'Preço p/ ganhar', width: 96, align: 'right', format: (row) => row.precoGanhar === null ? '—' : formatCurrency(row.precoGanhar) },
];

function formatCurrency(value: number): string {
  const fixed = Number(value || 0).toFixed(2);
  const [integer, decimals] = fixed.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function statusLabel(value: unknown): string {
  const status = String(value || '').toLowerCase();
  if (status === 'active') return 'Ativo';
  if (status === 'paused') return 'Pausado';
  if (status === 'closed') return 'Encerrado';
  if (status === 'under_review') return 'Em revisão';
  return String(value || '—');
}

function buyBoxLabel(value: unknown): string {
  const status = String(value || '').toLowerCase();
  if (isWinningBuyBoxStatus(status)) return 'Ganhando';
  return status ? 'Perdendo' : '—';
}

function sanitizeText(value: unknown, supportedCharacters: Set<number>): string {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ').trim())
    .map((character) => supportedCharacters.has(character.codePointAt(0) || 0) ? character : '?')
    .join('');
}

function fitText(value: unknown, font: PDFFont, size: number, maxWidth: number, supportedCharacters: Set<number>): string {
  const text = sanitizeText(value, supportedCharacters);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let fitted = text;
  while (fitted && font.widthOfTextAtSize(`${fitted}...`, size) > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted}...`;
}

function drawCellText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
  align: 'left' | 'right' | 'center' = 'left',
) {
  const size = 5.5;
  const textWidth = font.widthOfTextAtSize(text, size);
  const textX = align === 'right'
    ? x + width - textWidth - 3
    : align === 'center'
      ? x + ((width - textWidth) / 2)
      : x + 3;
  page.drawText(text, { x: textX, y, size, font, color: rgb(0.12, 0.12, 0.12) });
}

async function buildPdf(rows: ExportRow[], filterDescription: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const supportedCharacters = new Set(regularFont.getCharacterSet());
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const rowsPerPage = Math.max(1, Math.floor((TABLE_TOP - TABLE_BOTTOM - HEADER_HEIGHT) / ROW_HEIGHT));
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText('Anúncios no catálogo', {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - 35,
      size: 16,
      font: boldFont,
      color: rgb(0.05, 0.27, 0.58),
    });
    page.drawText(fitText(filterDescription, regularFont, 8, PAGE_WIDTH - (PAGE_MARGIN * 2), supportedCharacters), {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - 51,
      size: 8,
      font: regularFont,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(`Total: ${rows.length} anúncio(s)`, {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - 64,
      size: 8,
      font: regularFont,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: TABLE_TOP - HEADER_HEIGHT,
      width: tableWidth,
      height: HEADER_HEIGHT,
      color: rgb(0.08, 0.35, 0.68),
    });

    let headerX = PAGE_MARGIN;
    for (const column of columns) {
      page.drawText(fitText(column.label, boldFont, 6.5, column.width - 6, supportedCharacters), {
        x: headerX + 3,
        y: TABLE_TOP - 12,
        size: 6.5,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
      headerX += column.width;
    }

    rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage).forEach((row, rowIndex) => {
      const rowBottom = TABLE_TOP - HEADER_HEIGHT - ((rowIndex + 1) * ROW_HEIGHT);
      if (rowIndex % 2 === 1) {
        page.drawRectangle({ x: PAGE_MARGIN, y: rowBottom, width: tableWidth, height: ROW_HEIGHT, color: rgb(0.95, 0.96, 0.98) });
      }
      page.drawLine({
        start: { x: PAGE_MARGIN, y: rowBottom },
        end: { x: PAGE_MARGIN + tableWidth, y: rowBottom },
        thickness: 0.35,
        color: rgb(0.78, 0.8, 0.83),
      });
      let cellX = PAGE_MARGIN;
      for (const column of columns) {
        const rawValue = column.format ? column.format(row) : row[column.key];
        const text = fitText(rawValue, regularFont, 5.5, column.width - 6, supportedCharacters);
        drawCellText(page, text, cellX, rowBottom + 5, column.width, regularFont, column.align);
        cellX += column.width;
      }
    });

    page.drawText(sanitizeText(`Página ${pageIndex + 1} de ${pageCount} | Gerado em ${generatedAt}`, supportedCharacters), {
      x: PAGE_MARGIN,
      y: 17,
      size: 7,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  document.setTitle('Anúncios no catálogo');
  document.setProducer('Vortek');
  return document.save({ useObjectStreams: false });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  try {
    const service = createServiceClient();
    const { searchParams } = new URL(request.url);
    const filters = parseNoCatalogFilters(searchParams);
    const sellerIdParam = searchParams.get('sellerId');
    const sellerId = sellerIdParam !== null ? Number(sellerIdParam) : null;
    const rows: ExportRow[] = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      let query: any = service
        .from('catalogo_ml_snapshot')
        .select('ml_item_id,related_item_id,title,seller_sku,sku_local,status,buy_box_status,price,price_to_win')
        .eq('catalog_listing', true);
      if (sellerId !== null && Number.isFinite(sellerId)) query = query.eq('seller_id', sellerId);
      query = applyNoCatalogFilters(query, filters);
      const { data, error } = await query
        .order('ml_item_id', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);

      const chunk = (data || []).map((row: any): ExportRow => ({
        sku: resolveCatalogDisplaySku({ skuLocal: row.sku_local, sellerSku: row.seller_sku }) || '—',
        anuncio: String(row.ml_item_id || '—'),
        relacionado: String(row.related_item_id || '—'),
        titulo: String(row.title || ''),
        status: statusLabel(row.status),
        buyBox: buyBoxLabel(row.buy_box_status),
        preco: Number(row.price || 0),
        precoGanhar: row.price_to_win === null ? null : Number(row.price_to_win),
      }));
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }

    const filterParts = [
      filters.search ? `Busca: ${filters.search}` : null,
      filters.statusMl !== 'all' ? `Status ML: ${statusLabel(filters.statusMl)}` : null,
      filters.buyBox !== 'all' ? `Buy Box: ${filters.buyBox === 'ganhando' ? 'Ganhando' : 'Perdendo'}` : null,
      filters.priceMin !== null ? `Preço mínimo: ${formatCurrency(filters.priceMin)}` : null,
      filters.priceMax !== null ? `Preço máximo: ${formatCurrency(filters.priceMax)}` : null,
    ].filter(Boolean);
    const pdf = await buildPdf(rows, filterParts.length > 0 ? `Filtros: ${filterParts.join(' | ')}` : 'Filtros: nenhum');
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="catalogo-no-catalogo-${date}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('[api/catalogo/no-catalogo/exportar-pdf] Falha:', error?.message || error);
    return NextResponse.json({ erro: error?.message || 'Falha ao gerar PDF do catálogo' }, { status: 500 });
  }
}
