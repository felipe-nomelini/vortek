import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  listActiveSupplierOptions,
  mapSupplierFilterIdsToDsliteIds,
  type SupplierFilterOption,
} from '@/lib/produto-filtering';
import { calculateSuggestedPrice } from '@/services/pricing';

type ExportRow = {
  sku: string;
  nome: string;
  fornecedor: string;
  produto_status: string;
  estoque: number;
  custo: number;
  ml_fee: number;
  ml_shipping: number;
  suggested_price: number;
  profit: number | null;
  ml_status: string;
};

type RpcPage = {
  data: Array<{
    product?: Record<string, any>;
    preferredOffer?: Record<string, any> | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const HEADER_HEIGHT = 18;
const ROW_HEIGHT = 15;
const TABLE_TOP = PAGE_HEIGHT - 86;
const TABLE_BOTTOM = 34;
const RPC_CONCURRENCY = 8;

const columns: Array<{
  key: keyof ExportRow;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  format?: (row: ExportRow) => string;
}> = [
  { key: 'sku', label: 'SKU', width: 60 },
  { key: 'nome', label: 'Produto', width: 205 },
  { key: 'fornecedor', label: 'Fornecedor', width: 88 },
  { key: 'produto_status', label: 'Situação', width: 42, align: 'center' },
  { key: 'estoque', label: 'Estoque', width: 42, align: 'right' },
  { key: 'custo', label: 'Custo', width: 58, align: 'right', format: (row) => formatCurrency(row.custo) },
  { key: 'ml_fee', label: 'Taxa ML', width: 42, align: 'right', format: (row) => formatPercent(row.ml_fee) },
  { key: 'ml_shipping', label: 'Frete ML', width: 58, align: 'right', format: (row) => formatCurrency(row.ml_shipping) },
  { key: 'suggested_price', label: 'Sugerido', width: 62, align: 'right', format: (row) => formatCurrency(row.suggested_price) },
  { key: 'profit', label: 'Lucro', width: 58, align: 'right', format: (row) => row.profit === null ? '-' : formatCurrency(row.profit) },
  { key: 'ml_status', label: 'Status ML', width: 70 },
];

function formatCurrency(value: number): string {
  const fixed = Number(value || 0).toFixed(2);
  const [integer, decimals] = fixed.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function formatPercent(value: number): string {
  return `${(Number(value || 0) * 100).toFixed(1).replace('.', ',')}%`;
}

function normalizeMlStatus(value: unknown): string {
  const status = String(value || '');
  if (status === 'ativo') return 'Ativo';
  if (status === 'pausado') return 'Pausado';
  return 'Sem anúncio';
}

function computeDerived(product: Record<string, any>, preferredOffer: Record<string, any> | null): {
  suggestedPrice: number;
  profit: number | null;
} {
  const cost = Number(preferredOffer?.custo ?? product.custo ?? 0);
  const shipping = Number(product.ml_shipping ?? 0);
  const mlFee = Number(product.ml_fee ?? 0.15);

  try {
    const calculated = calculateSuggestedPrice({ cost, shipping, mlFee });
    const suggestedPrice = Math.round(Number(product.custom_price ?? calculated.suggestedPrice) * 100) / 100;
    if (String(product.ml_status || '') === 'sem_anuncio') {
      return { suggestedPrice, profit: null };
    }
    const profit = suggestedPrice - cost - shipping - (suggestedPrice * 0.04) - (suggestedPrice * mlFee);
    return { suggestedPrice, profit: Math.round(profit * 100) / 100 };
  } catch {
    return {
      suggestedPrice: Math.round(Number(product.custom_price ?? cost) * 100) / 100,
      profit: null,
    };
  }
}

function mapRpcRow(item: RpcPage['data'][number]): ExportRow {
  const product = item.product || {};
  const preferredOffer = item.preferredOffer || null;
  const derived = computeDerived(product, preferredOffer);
  return {
    sku: String(product.sku || ''),
    nome: String(product.nome || ''),
    fornecedor: String(product.fornecedor || preferredOffer?.fornecedor_nome || ''),
    produto_status: product.ativo === false ? 'Inativo' : 'Ativo',
    estoque: Number(product.estoque || 0),
    custo: Number(product.custo || 0),
    ml_fee: Number(product.ml_fee ?? 0.15),
    ml_shipping: Number(product.ml_shipping || 0),
    suggested_price: derived.suggestedPrice,
    profit: derived.profit,
    ml_status: normalizeMlStatus(product.ml_status),
  };
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
  const padding = 3;
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
  const tableWidth = columns.reduce((total, column) => total + column.width, 0);
  const rowsPerPage = Math.max(1, Math.floor((TABLE_TOP - TABLE_BOTTOM - HEADER_HEIGHT) / ROW_HEIGHT));
  const pageCount = Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const generatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText('Lista de produtos', {
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
    page.drawText(`Total: ${rows.length} produto(s)`, {
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
      const label = fitText(column.label, boldFont, 6.5, column.width - 6, supportedCharacters);
      page.drawText(label, {
        x: headerX + 3,
        y: TABLE_TOP - 12,
        size: 6.5,
        font: boldFont,
        color: rgb(1, 1, 1),
      });
      headerX += column.width;
    }

    const pageRows = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
    pageRows.forEach((row, rowIndex) => {
      const rowBottom = TABLE_TOP - HEADER_HEIGHT - ((rowIndex + 1) * ROW_HEIGHT);
      if (rowIndex % 2 === 1) {
        page.drawRectangle({
          x: PAGE_MARGIN,
          y: rowBottom,
          width: tableWidth,
          height: ROW_HEIGHT,
          color: rgb(0.95, 0.96, 0.98),
        });
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
        drawCellText(page, text, cellX, rowBottom + 5, column.width, regularFont, 5.5, column.align);
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

  document.setTitle('Lista de produtos');
  document.setProducer('Vortek');
  return document.save({ useObjectStreams: false });
}

function parsePrice(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function fetchRpcPage(
  serviceClient: ReturnType<typeof createServiceClient>,
  args: Record<string, unknown>,
  page: number,
): Promise<RpcPage> {
  const { data, error } = await serviceClient.rpc('search_produtos_paginated', {
    ...args,
    p_page: page,
    p_page_size: 100,
  } as any);
  if (error) throw new Error(error.message || 'Falha ao consultar produtos');

  const result = (data || {}) as Record<string, any>;
  return {
    data: Array.isArray(result.data) ? result.data : [],
    total: Number(result.total || 0),
    page: Number(result.page || page),
    pageSize: Math.max(1, Number(result.pageSize || 100)),
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const supplierFilterIds = searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
    const productActiveStatus = ['ativo', 'inativo', 'todos'].includes(searchParams.get('ativo') || '')
      ? String(searchParams.get('ativo'))
      : 'todos';
    const mlStatus = searchParams.get('ml_status') || '';
    const estoque = searchParams.get('estoque') || '';
    const priceField = ['cost', 'suggestedPrice', 'profit'].includes(searchParams.get('priceField') || '')
      ? String(searchParams.get('priceField'))
      : 'cost';
    const priceMin = parsePrice(searchParams, 'priceMin');
    const priceMax = parsePrice(searchParams, 'priceMax');
    const allowedSort = new Set([
      'sku',
      'nome',
      'fornecedor',
      'estoque',
      'custo',
      'ml_fee',
      'ml_shipping',
      'suggested_price',
      'profit',
      'ml_status',
    ]);
    const rawSortBy = searchParams.get('sortBy') || 'sku';
    const sortBy = allowedSort.has(rawSortBy) ? rawSortBy : 'sku';
    const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';
    const serviceClient = createServiceClient();

    let supplierOptions: SupplierFilterOption[] = [];
    try {
      supplierOptions = await listActiveSupplierOptions(serviceClient);
    } catch (error: any) {
      return NextResponse.json({ erro: error?.message || 'Falha ao carregar fornecedores' }, { status: 500 });
    }

    const supplierDsliteIds = mapSupplierFilterIdsToDsliteIds(supplierFilterIds, supplierOptions);
    const rpcArgs = {
      p_search: search || null,
      p_supplier_dslite_ids: supplierDsliteIds,
      p_product_active_status: productActiveStatus,
      p_ml_status: mlStatus || null,
      p_estoque: estoque || null,
      p_price_min: priceMin,
      p_price_max: priceMax,
      p_price_field: priceField,
      p_sort_by: sortBy,
      p_sort_order: sortOrder,
    };

    const firstPage = await fetchRpcPage(serviceClient, rpcArgs, 1);
    const totalPages = Math.max(1, Math.ceil(firstPage.total / firstPage.pageSize));
    const rows = firstPage.data.map(mapRpcRow);

    for (let pageStart = 2; pageStart <= totalPages; pageStart += RPC_CONCURRENCY) {
      const pageNumbers = Array.from(
        { length: Math.min(RPC_CONCURRENCY, totalPages - pageStart + 1) },
        (_, index) => pageStart + index,
      );
      const pages = await Promise.all(
        pageNumbers.map((pageNumber) => fetchRpcPage(serviceClient, rpcArgs, pageNumber)),
      );
      for (const page of pages) rows.push(...page.data.map(mapRpcRow));
    }

    const selectedSuppliers = supplierOptions
      .filter((option) => supplierFilterIds.includes(option.id))
      .map((option) => option.label);
    const priceFieldLabel = priceField === 'suggestedPrice'
      ? 'preço sugerido'
      : priceField === 'profit'
        ? 'lucro'
        : 'custo';
    const activeFilters = [
      search ? `Busca: ${search}` : null,
      selectedSuppliers.length > 0 ? `Fornecedor: ${selectedSuppliers.join(', ')}` : null,
      productActiveStatus !== 'todos' ? `Status do produto: ${productActiveStatus}` : null,
      mlStatus ? `Status ML: ${normalizeMlStatus(mlStatus)}` : null,
      estoque ? `Estoque: ${estoque === 'com_estoque' ? 'com estoque' : 'sem estoque'}` : null,
      priceMin !== null ? `${priceFieldLabel} mínimo: ${formatCurrency(priceMin)}` : null,
      priceMax !== null ? `${priceFieldLabel} máximo: ${formatCurrency(priceMax)}` : null,
    ].filter(Boolean);
    const filterDescription = activeFilters.length > 0
      ? `Filtros: ${activeFilters.join(' | ')}`
      : 'Filtros: nenhum (todos os produtos)';
    const pdf = await buildPdf(rows, filterDescription);
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
