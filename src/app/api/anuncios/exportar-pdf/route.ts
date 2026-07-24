import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

type AnuncioSortKey =
  | 'sku'
  | 'titulo'
  | 'preco_ml'
  | 'lucro'
  | 'vendidos'
  | 'visitas'
  | 'qualidade'
  | 'status'
  | 'catalogo';

type ExportRow = {
  ml_item_id: string;
  sku: string;
  titulo: string;
  preco_ml: number;
  lucro: number | null;
  vendidos: number;
  visitas: number;
  qualidade: number;
  status: string;
  catalogo: boolean;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const HEADER_HEIGHT = 20;
const ROW_HEIGHT = 20;
const TABLE_TOP = PAGE_HEIGHT - 86;
const TABLE_BOTTOM = 34;

const columns: Array<{
  key: keyof ExportRow;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  format?: (row: ExportRow) => string;
}> = [
  { key: 'sku', label: 'SKU', width: 66 },
  { key: 'ml_item_id', label: 'Anúncio', width: 82 },
  { key: 'titulo', label: 'Produto', width: 248 },
  { key: 'preco_ml', label: 'Preço ML', width: 67, align: 'right', format: (row) => formatCurrency(row.preco_ml) },
  { key: 'lucro', label: 'Lucro', width: 64, align: 'right', format: (row) => row.lucro === null ? '-' : formatCurrency(row.lucro) },
  { key: 'vendidos', label: 'Vendidos', width: 47, align: 'right' },
  { key: 'visitas', label: 'Visitas', width: 43, align: 'right' },
  { key: 'qualidade', label: 'Qualidade', width: 52, align: 'right', format: (row) => `${row.qualidade}%` },
  { key: 'status', label: 'Status', width: 51, format: (row) => row.status === 'ativo' ? 'Ativo' : 'Pausado' },
  { key: 'catalogo', label: 'Catálogo', width: 47, align: 'center', format: (row) => row.catalogo ? 'Sim' : 'Não' },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeListingProfit(item: any): number | null {
  const precoMl = Number(item?.preco_ml ?? 0);
  const custo = Number(item?.produtos?.custo ?? Number.NaN);
  if (!Number.isFinite(precoMl) || precoMl <= 0 || !Number.isFinite(custo)) return null;

  const mlFeeRate = Number(item?.produtos?.ml_fee ?? 0.15);
  const shipping = Number(item?.produtos?.ml_shipping ?? 0);
  return round2(
    precoMl
      - custo
      - shipping
      - (precoMl * 0.04)
      - (precoMl * (Number.isFinite(mlFeeRate) ? mlFeeRate : 0.15)),
  );
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function parseSort(searchParams: URLSearchParams): { sortBy: AnuncioSortKey; sortOrder: 'asc' | 'desc' } {
  const allowed: AnuncioSortKey[] = [
    'sku',
    'titulo',
    'preco_ml',
    'lucro',
    'vendidos',
    'visitas',
    'qualidade',
    'status',
    'catalogo',
  ];
  const rawSortBy = searchParams.get('sortBy') || 'titulo';
  return {
    sortBy: allowed.includes(rawSortBy as AnuncioSortKey) ? rawSortBy as AnuncioSortKey : 'titulo',
    sortOrder: searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc',
  };
}

function sortRows(rows: ExportRow[], sortBy: AnuncioSortKey, sortOrder: 'asc' | 'desc'): void {
  const direction = sortOrder === 'asc' ? 1 : -1;
  rows.sort((left, right) => {
    let comparison = 0;
    if (sortBy === 'sku' || sortBy === 'titulo' || sortBy === 'status') {
      comparison = String(left[sortBy] || '').localeCompare(String(right[sortBy] || ''), 'pt-BR');
    } else if (sortBy === 'catalogo') {
      comparison = Number(left.catalogo) - Number(right.catalogo);
    } else if (sortBy === 'lucro') {
      comparison = compareNullableNumber(left.lucro, right.lucro);
    } else {
      comparison = Number(left[sortBy] || 0) - Number(right[sortBy] || 0);
    }
    if (comparison !== 0) return comparison * direction;
    return left.titulo.localeCompare(right.titulo, 'pt-BR');
  });
}

function formatCurrency(value: number): string {
  const fixed = Number(value || 0).toFixed(2);
  const [integer, decimals] = fixed.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function sanitizeText(value: unknown, supportedCharacters: Set<number>): string {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ').trim())
    .map((character) => supportedCharacters.has(character.codePointAt(0) || 0) ? character : '?')
    .join('');
}

function fitText(value: unknown, font: PDFFont, size: number, maxWidth: number, supportedCharacters: Set<number>): string {
  const text = sanitizeText(value, supportedCharacters);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

  const suffix = '...';
  let fitted = text;
  while (fitted && font.widthOfTextAtSize(`${fitted}${suffix}`, size) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return `${fitted}${suffix}`;
}

function drawCellText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
  fontSize: number,
  align: 'left' | 'right' | 'center' = 'left',
): void {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const padding = 4;
  const textX = align === 'right'
    ? x + width - textWidth - padding
    : align === 'center'
      ? x + ((width - textWidth) / 2)
      : x + padding;
  page.drawText(text, { x: textX, y, size: fontSize, font, color: rgb(0.12, 0.12, 0.12) });
}

async function buildPdf(rows: ExportRow[], filterDescription: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regularFont = await document.embedFont(StandardFonts.Helvetica);
  const boldFont = await document.embedFont(StandardFonts.HelveticaBold);
  const supportedCharacters = new Set(regularFont.getCharacterSet());
  const rowsPerPage = Math.max(1, Math.floor((TABLE_TOP - TABLE_BOTTOM - HEADER_HEIGHT) / ROW_HEIGHT));
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText('Lista de anúncios - Mercado Livre', {
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

    let x = PAGE_MARGIN;
    page.drawRectangle({
      x: PAGE_MARGIN,
      y: TABLE_TOP - HEADER_HEIGHT,
      width: columns.reduce((total, column) => total + column.width, 0),
      height: HEADER_HEIGHT,
      color: rgb(0.08, 0.35, 0.68),
    });
    for (const column of columns) {
      const label = fitText(column.label, boldFont, 7, column.width - 8, supportedCharacters);
      page.drawText(label, {
        x: x + 4,
        y: TABLE_TOP - 13,
        size: 7,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
      x += column.width;
    }

    const pageRows = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    pageRows.forEach((row, rowIndex) => {
      const rowTop = TABLE_TOP - HEADER_HEIGHT - (rowIndex * ROW_HEIGHT);
      const rowBottom = rowTop - ROW_HEIGHT;
      if (rowIndex % 2 === 1) {
        page.drawRectangle({
          x: PAGE_MARGIN,
          y: rowBottom,
          width: columns.reduce((total, column) => total + column.width, 0),
          height: ROW_HEIGHT,
          color: rgb(0.95, 0.96, 0.98),
        });
      }
      page.drawLine({
        start: { x: PAGE_MARGIN, y: rowBottom },
        end: { x: PAGE_WIDTH - PAGE_MARGIN, y: rowBottom },
        thickness: 0.35,
        color: rgb(0.78, 0.8, 0.83),
      });

      let cellX = PAGE_MARGIN;
      for (const column of columns) {
        const rawValue = column.format ? column.format(row) : row[column.key];
        const text = fitText(rawValue, regularFont, 6.5, column.width - 8, supportedCharacters);
        drawCellText(page, text, cellX, rowBottom + 6.5, column.width, regularFont, 6.5, column.align);
        cellX += column.width;
      }
    });

    const footer = `Página ${pageIndex + 1} de ${pageCount} | Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    page.drawText(sanitizeText(footer, supportedCharacters), {
      x: PAGE_MARGIN,
      y: 17,
      size: 7,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  document.setTitle('Lista de anúncios - Mercado Livre');
  document.setProducer('Vortek');
  return document.save({ useObjectStreams: false });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const priceMin = searchParams.get('priceMin') ? Number(searchParams.get('priceMin')) : null;
  const priceMax = searchParams.get('priceMax') ? Number(searchParams.get('priceMax')) : null;
  const { sortBy, sortOrder } = parseSort(searchParams);
  const serviceClient = createServiceClient();

  function applyFilters(query: any) {
    if (search) query = query.or(`titulo.ilike.%${search}%,sku.ilike.%${search}%`);
    if (status) query = query.eq('status', status);
    if (priceMin !== null && Number.isFinite(priceMin)) query = query.gte('preco_ml', priceMin);
    if (priceMax !== null && Number.isFinite(priceMax)) query = query.lte('preco_ml', priceMax);
    return query;
  }

  const rows: ExportRow[] = [];
  const chunkSize = 1000;
  let offset = 0;

  while (true) {
    let query = serviceClient.from('anuncios_ml').select(`
      ml_item_id,
      sku,
      titulo,
      preco_ml,
      vendidos,
      visitas,
      qualidade,
      status,
      catalogo,
      produtos(custo, ml_fee, ml_shipping)
    `);
    query = applyFilters(query);
    const { data, error } = await query
      .order('titulo', { ascending: true })
      .range(offset, offset + chunkSize - 1);

    if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

    const chunk = (data || []).map((item: any): ExportRow => ({
      ml_item_id: String(item.ml_item_id || ''),
      sku: String(item.sku || ''),
      titulo: String(item.titulo || ''),
      preco_ml: Number(item.preco_ml || 0),
      lucro: computeListingProfit(item),
      vendidos: Number(item.vendidos || 0),
      visitas: Number(item.visitas || 0),
      qualidade: Number(item.qualidade || 0),
      status: String(item.status || ''),
      catalogo: Boolean(item.catalogo),
    }));
    rows.push(...chunk);
    if (chunk.length < chunkSize) break;
    offset += chunkSize;
  }

  sortRows(rows, sortBy, sortOrder);

  const activeFilters = [
    search ? `Busca: ${search}` : null,
    status ? `Status: ${status}` : null,
    priceMin !== null && Number.isFinite(priceMin) ? `Preço mínimo: ${formatCurrency(priceMin)}` : null,
    priceMax !== null && Number.isFinite(priceMax) ? `Preço máximo: ${formatCurrency(priceMax)}` : null,
  ].filter(Boolean);
  const filterDescription = activeFilters.length > 0
    ? `Filtros: ${activeFilters.join(' | ')}`
    : 'Filtros: nenhum (todos os anúncios)';
  const pdf = await buildPdf(rows, filterDescription);
  const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="anuncios-mercado-livre-${date}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
