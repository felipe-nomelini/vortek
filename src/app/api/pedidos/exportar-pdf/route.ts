import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { NextResponse } from 'next/server';
import { GET as getOrders } from '@/app/api/pedidos/route';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { formatMlReleaseWindow, getMlReleaseComparableDate } from '@/lib/ml/release-window-display';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ExportRow = {
  numero: string;
  data: string;
  cliente: string;
  total: number;
  status: string;
  nota_fiscal: string;
  fornecedor: string;
  compra_dslite: string;
  liberacao_etiqueta: string;
  proxima_acao: string;
  lucro: number | null;
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
  { key: 'numero', label: 'Venda', width: 70 },
  { key: 'data', label: 'Data', width: 70 },
  { key: 'cliente', label: 'Cliente', width: 103 },
  { key: 'total', label: 'Total', width: 60, align: 'right', format: (row) => formatCurrency(row.total) },
  { key: 'status', label: 'Status', width: 64 },
  { key: 'nota_fiscal', label: 'NF', width: 45 },
  { key: 'fornecedor', label: 'Fornecedor', width: 91 },
  { key: 'compra_dslite', label: 'Compra', width: 55 },
  { key: 'liberacao_etiqueta', label: 'Liberação etiqueta', width: 70 },
  { key: 'proxima_acao', label: 'Próxima ação', width: 95 },
  { key: 'lucro', label: 'Lucro', width: 58, align: 'right', format: (row) => row.lucro === null ? '—' : formatCurrency(row.lucro) },
];

const statusLabels: Record<string, string> = {
  aberto: 'Aberto',
  pendente: 'Pendente',
  preparando: 'Preparando',
  pronto_envio: 'Pronto p/ envio',
  etiqueta_impressa: 'Etiqueta impressa',
  coletado: 'Coletado',
  em_transito: 'Em trânsito',
  saiu_entrega: 'Saiu p/ entrega',
  dest_ausente: 'Dest. ausente',
  atendido: 'Atendido',
  faturado: 'Faturado',
  entregue: 'Entregue',
  recusado: 'Recusado',
  devolvido: 'Devolvido',
  cancelado: 'Cancelado',
};

const operationalViewLabels: Record<string, string> = {
  urgent: 'Urgentes',
  preparation: 'Preparação',
  shipping: 'Em transporte',
  delivered: 'Entregues',
  all: 'Todos',
};

const nextActionLabels: Record<string, string> = {
  create_dslite_order: 'Criar compra',
  confirm_supplier_payment: 'Confirmar PIX',
  send_supplier_receipt: 'Anexar comprovante',
  resume_dslite_flow: 'Retomar fluxo',
  wait_ml_label: 'Aguardando ML',
  complete_dslite_label: 'Completar etiqueta',
  done: 'OK',
  blocked: 'Bloqueado',
  internal_shipping: 'Envio interno',
};

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

function sanitizeMlTechnicalSuffix(value: unknown): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*)\s+\(([^)]+)\)\s*$/);
  if (!match) return raw || '—';
  const base = match[1].trim();
  const suffix = match[2].trim();
  if (base && (/\d/.test(suffix) || /^[A-Z0-9_.-]+$/i.test(suffix))) return base;
  return raw || '—';
}

function formatLabelRelease(row: Record<string, any>): string {
  const rawReleaseAt = String(row.ml_fiscal_release_at || '').trim();
  if (!rawReleaseAt || String(row.situacao || '') === 'etiqueta_impressa') return '—';

  const releaseAt = getMlReleaseComparableDate(rawReleaseAt);
  if (!releaseAt || releaseAt.getTime() <= Date.now()) return '—';

  return formatMlReleaseWindow(rawReleaseAt).when;
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
    page.drawText('Lista de vendas', {
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
    page.drawText(`Total: ${rows.length} venda(s)`, {
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
      const label = fitText(column.label, boldFont, 6.2, column.width - 6, supportedCharacters);
      page.drawText(label, {
        x: headerX + 3,
        y: TABLE_TOP - 12,
        size: 6.2,
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
        const cellText = fitText(rawValue, regularFont, 5.6, column.width - 6, supportedCharacters);
        drawCellText(page, cellText, cellX, rowBottom + 5.8, column.width, regularFont, 5.6, column.align);
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

  document.setTitle('Lista de vendas');
  document.setProducer('Vortek');
  return document.save({ useObjectStreams: false });
}

function mapExportRow(row: Record<string, any>): ExportRow {
  const dsliteIds = Array.isArray(row.operational_dslite_ids)
    ? row.operational_dslite_ids.map(String).filter(Boolean)
    : String(row.dslite_id || '').trim() ? [String(row.dslite_id)] : [];
  const invoiceNumbers = Array.isArray(row.operational_invoice_numbers)
    ? row.operational_invoice_numbers.map(String).filter(Boolean)
    : String(row.nota_fiscal_numero || '').trim() ? [String(row.nota_fiscal_numero)] : [];
  const groupedNumber = (row.is_virtual_kit || row.is_cart) && row.ml_pack_id
    ? String(row.ml_pack_id)
    : String(row.numero || '—');
  const lucro = row.lucro === null || row.lucro === undefined ? null : Number(row.lucro);

  return {
    numero: `#${groupedNumber}`,
    data: formatDate(row.data_venda || row.data),
    cliente: sanitizeMlTechnicalSuffix(row.contato_nome),
    total: Number(row.total || 0),
    status: statusLabels[String(row.situacao || '')] || String(row.situacao || '—'),
    nota_fiscal: invoiceNumbers.length > 0 ? invoiceNumbers.join(', ') : '—',
    fornecedor: String(row.fornecedor_nome || (row.envio_interno_at ? 'Estoque Interno' : '—')),
    compra_dslite: dsliteIds.length > 0 ? dsliteIds.map((id: string) => `#${id}`).join(', ') : '—',
    liberacao_etiqueta: formatLabelRelease(row),
    proxima_acao: String(
      row.dslite_next_action_label
      || nextActionLabels[String(row.dslite_next_action || '')]
      || '—',
    ),
    lucro: Number.isFinite(lucro) ? lucro : null,
  };
}

function parseNumber(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;

  try {
    const sourceUrl = new URL(request.url);
    const listUrl = new URL('/api/pedidos', request.url);
    const forwardedParams = [
      'search',
      'status',
      'dateFrom',
      'dateTo',
      'priceMin',
      'priceMax',
      'fornecedores',
      'operationalView',
      'sortBy',
      'sortOrder',
    ];
    for (const key of forwardedParams) {
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
      if (!response.ok) {
        return NextResponse.json(
          { erro: payload?.error?.message || payload?.erro || 'Falha ao consultar vendas' },
          { status: response.status },
        );
      }

      const pageRows = Array.isArray(payload?.data) ? payload.data : [];
      if (supplierOptions.length === 0 && Array.isArray(payload?.fornecedores)) {
        supplierOptions = payload.fornecedores;
      }
      rows.push(...pageRows);
      total = Number(payload?.total || 0);
      page += 1;
      if (pageRows.length === 0) break;
    } while (rows.length < total);

    const exportRows = rows.map(mapExportRow);
    const status = sourceUrl.searchParams.get('status') || '';
    const operationalView = sourceUrl.searchParams.get('operationalView') || 'all';
    const priceMin = parseNumber(sourceUrl.searchParams, 'priceMin');
    const priceMax = parseNumber(sourceUrl.searchParams, 'priceMax');
    const supplierFilterIds = sourceUrl.searchParams.get('fornecedores')?.split(',').filter(Boolean) || [];
    const selectedSuppliers = supplierOptions
      .filter((option) => supplierFilterIds.includes(String(option.id)))
      .map((option) => option.label);
    const activeFilters = [
      `Visão: ${operationalViewLabels[operationalView] || operationalView}`,
      sourceUrl.searchParams.get('search') ? `Busca: ${sourceUrl.searchParams.get('search')}` : null,
      status ? `Status: ${statusLabels[status] || status}` : null,
      selectedSuppliers.length > 0 ? `Fornecedor: ${selectedSuppliers.join(', ')}` : null,
      sourceUrl.searchParams.get('dateFrom') ? `Data inicial: ${sourceUrl.searchParams.get('dateFrom')}` : null,
      sourceUrl.searchParams.get('dateTo') ? `Data final: ${sourceUrl.searchParams.get('dateTo')}` : null,
      priceMin !== null ? `Valor mínimo: ${formatCurrency(priceMin)}` : null,
      priceMax !== null ? `Valor máximo: ${formatCurrency(priceMax)}` : null,
    ].filter(Boolean);
    const pdf = await buildPdf(exportRows, `Filtros: ${activeFilters.join(' | ')}`);
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
