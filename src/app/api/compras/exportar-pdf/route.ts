import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { NextResponse } from 'next/server';
import { GET as getPurchases } from '@/app/api/compras/route';
import { authorizeApiRequest } from '@/lib/api-request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ExportRow = {
  compra: string;
  venda: string;
  data: string;
  destinatario: string;
  fornecedor: string;
  produto: string;
  quantidade: number;
  total: number;
  pagamento: string;
  status: string;
  nota_fiscal: string;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const PAGE_MARGIN = 28;
const HEADER_HEIGHT = 18;
const ROW_HEIGHT = 18;
const TABLE_TOP = PAGE_HEIGHT - 86;
const TABLE_BOTTOM = 34;

const columns: Array<{
  key: keyof ExportRow;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  format?: (row: ExportRow) => string;
}> = [
  { key: 'compra', label: 'Compra', width: 58 },
  { key: 'venda', label: 'Venda', width: 60 },
  { key: 'data', label: 'Data', width: 68 },
  { key: 'destinatario', label: 'Destinatário', width: 90 },
  { key: 'fornecedor', label: 'Fornecedor', width: 80 },
  { key: 'produto', label: 'Produto / SKU', width: 145 },
  { key: 'quantidade', label: 'Qtd', width: 28, align: 'right' },
  { key: 'total', label: 'Total', width: 58, align: 'right', format: (row) => formatCurrency(row.total) },
  { key: 'pagamento', label: 'Pagto. fornecedor', width: 78 },
  { key: 'status', label: 'Status', width: 70 },
  { key: 'nota_fiscal', label: 'NF', width: 48 },
];

function formatCurrency(value: number): string {
  const fixed = Number(value || 0).toFixed(2);
  const [integer, decimals] = fixed.split('.');
  return `R$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals}`;
}

function formatDate(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSupplierPayment(row: Record<string, any>): string {
  if (row.supplier_payment_mode === 'balance_account') return 'Saldo Hayamax';
  if (row.supplier_payment_mode !== 'prepaid_pix') return '—';
  if (row.bkr1_pix_deferred) return 'PIX após etiqueta';
  if (row.supplier_payment_status === 'paid') return 'PIX pago';
  if (row.supplier_payment_status === 'failed') return 'PIX falhou';
  if (row.supplier_payment_status === 'cancelled') return 'PIX cancelado';
  return 'PIX pendente';
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
    page.drawText('Lista de compras DSLite', {
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
    page.drawText(`Total: ${rows.length} compra(s)`, {
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
      const label = fitText(column.label, boldFont, 6, column.width - 6, supportedCharacters);
      page.drawText(label, {
        x: headerX + 3,
        y: TABLE_TOP - 12,
        size: 6,
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
        const cellText = fitText(rawValue, regularFont, 5.4, column.width - 6, supportedCharacters);
        drawCellText(page, cellText, cellX, rowBottom + 5.8, column.width, regularFont, 5.4, column.align);
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

  document.setTitle('Lista de compras DSLite');
  document.setProducer('Vortek');
  return document.save({ useObjectStreams: false });
}

function mapExportRow(row: Record<string, any>): ExportRow {
  const description = String(row.produto_descricao || '').trim();
  const sku = String(row.produto_sku || '').trim();
  const produto = [description, sku ? `SKU ${sku}` : null].filter(Boolean).join(' | ') || '—';

  return {
    compra: row.dsid ? `#${String(row.dsid).padStart(6, '0')}` : '—',
    venda: row.pedido_vendas_numero ? `#${String(row.pedido_vendas_numero).padStart(6, '0')}` : '—',
    data: formatDate(row.data_criacao),
    destinatario: String(row.destinatario_nome || '—'),
    fornecedor: String(row.fornecedor_nome || '—'),
    produto,
    quantidade: Number(row.quantidade || 1),
    total: Number(row.valor_total || 0),
    pagamento: formatSupplierPayment(row),
    status: String(row.status || '—'),
    nota_fiscal: String(row.nf_numero || '—'),
  };
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
    const activeFilters = [
      sourceUrl.searchParams.get('search') ? `Busca: ${sourceUrl.searchParams.get('search')}` : null,
      sourceUrl.searchParams.get('status') ? `Status: ${sourceUrl.searchParams.get('status')}` : null,
      sourceUrl.searchParams.get('fornecedorId') ? `Fornecedor: ${sourceUrl.searchParams.get('fornecedorId')}` : null,
      sourceUrl.searchParams.get('dateFrom') ? `Data inicial: ${sourceUrl.searchParams.get('dateFrom')}` : null,
      sourceUrl.searchParams.get('dateTo') ? `Data final: ${sourceUrl.searchParams.get('dateTo')}` : null,
    ].filter(Boolean);
    const filterDescription = activeFilters.length > 0
      ? `Filtros: ${activeFilters.join(' | ')}`
      : 'Filtros: nenhum (todas as compras)';
    const pdf = await buildPdf(rows, filterDescription);
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
