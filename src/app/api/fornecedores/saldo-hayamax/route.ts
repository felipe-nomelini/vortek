import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { createClient, createServiceClient } from '@/lib/supabase';
import {
  HAYAMAX_FORNECEDOR_ID,
  HAYAMAX_MIN_TOPUP_AMOUNT,
  getSupplierBalance,
  normalizeMoneyAmount,
} from '@/lib/supplier-balance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseBrazilMoney(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9+\-.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function normalizeDateKey(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function extractHayamaxTopupsFromWorkbook(fileName: string, buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('Planilha sem abas.');
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  if (!rows.length) throw new Error('Planilha vazia.');
  const header = rows[0].map((cell) => String(cell || '').trim().toLowerCase());
  const expectedHeader = ['data', 'descrição', 'referência', 'número pedido', 'valor r$', 'saldo r$'];
  const headerLooksValid = expectedHeader.every((column, idx) => header[idx] === column);
  if (!headerLooksValid) {
    throw new Error('Cabeçalho do extrato Hayamax não reconhecido.');
  }

  const items: Array<{ amount: number; reference: string; notes: string; movementKey: string; dateKey: string | null }> = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const dateCell = row[0];
    const description = String(row[1] || '').trim();
    const valueCell = row[4];
    if (!description || !/creddropship/i.test(description)) continue;
    const amount = normalizeMoneyAmount(parseBrazilMoney(valueCell));
    if (amount < HAYAMAX_MIN_TOPUP_AMOUNT) continue;
    const dateKey = normalizeDateKey(dateCell);
    const reference = description;
    const notes = `Importado do extrato Hayamax (${fileName})`;
    const movementKey = `hayamax_xlsx_topup:${dateKey || 'sem-data'}:${amount.toFixed(2)}:${reference.toLowerCase()}`;
    items.push({ amount, reference, notes, movementKey, dateKey });
  }

  if (!items.length) {
    throw new Error('Nenhum crédito CREDDROPSHIP válido encontrado no arquivo.');
  }

  return items;
}

export async function GET() {
  const service = createServiceClient();

  const [{ data: movements, error }, balance, { data: pendingReview }, { data: lastMpMovement }] = await Promise.all([
    service
      .from('supplier_balance_movements')
      .select('*')
      .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID)
      .order('created_at', { ascending: false })
      .limit(50),
    getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID),
    service
      .from('mercadopago_account_movements')
      .select('id,external_id,movement_date,description,reference,amount,movement_type,matched_supplier')
      .eq('matched_supplier', 'REVIEW_REQUIRED')
      .is('supplier_balance_movement_id', null)
      .order('movement_date', { ascending: false, nullsFirst: false })
      .limit(5),
    service
      .from('mercadopago_account_movements')
      .select('movement_date,updated_at')
      .order('movement_date', { ascending: false, nullsFirst: false })
      .limit(1),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    fornecedorId: HAYAMAX_FORNECEDOR_ID,
    fornecedorNome: 'HAYAMAX',
    balance,
    lowBalance: balance < HAYAMAX_MIN_TOPUP_AMOUNT,
    movements: movements || [],
    mercadoPago: {
      lastMovementDate: lastMpMovement?.[0]?.movement_date || null,
      pendingReview: pendingReview || [],
      pendingReviewCount: pendingReview?.length || 0,
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const service = createServiceClient();
  const contentType = request.headers.get('content-type') || '';

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo XLS/XLSX não enviado.' }, { status: 400 });
    }
    const fileName = String(file.name || 'extrato-hayamax').trim();
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      return NextResponse.json({ error: 'Envie um arquivo .xlsx ou .xls.' }, { status: 422 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let parsedItems;
    try {
      parsedItems = extractHayamaxTopupsFromWorkbook(fileName, buffer);
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Falha ao ler extrato Hayamax.' }, { status: 422 });
    }

    const movementKeys = parsedItems.map((item) => item.movementKey);
    const { data: existingRows, error: existingError } = await service
      .from('supplier_balance_movements')
      .select('movement_key')
      .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID)
      .in('movement_key', movementKeys);
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    const existing = new Set((existingRows || []).map((row: any) => String(row.movement_key || '')));
    const toInsert = parsedItems
      .filter((item) => !existing.has(item.movementKey))
      .map((item) => ({
        fornecedor_id: HAYAMAX_FORNECEDOR_ID,
        fornecedor_nome: 'HAYAMAX',
        movement_type: 'topup',
        amount: item.amount,
        reference: item.reference,
        notes: item.notes,
        movement_key: item.movementKey,
        created_by: `hayamax_xlsx:${user.email || user.id}`,
      }));

    if (toInsert.length > 0) {
      const { error } = await service
        .from('supplier_balance_movements')
        .insert(toInsert);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const balance = await getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID);
    return NextResponse.json({
      success: true,
      balance,
      importSummary: {
        fileName,
        found: parsedItems.length,
        inserted: toInsert.length,
        skipped: parsedItems.length - toInsert.length,
      },
    });
  }

  const body = await request.json().catch(() => ({}));
  const amount = normalizeMoneyAmount(body?.amount);
  const reference = String(body?.reference || '').trim() || null;
  const notes = String(body?.notes || '').trim() || null;

  if (amount < HAYAMAX_MIN_TOPUP_AMOUNT) {
    return NextResponse.json({ error: `Boleto Hayamax deve ser de no mínimo R$ ${HAYAMAX_MIN_TOPUP_AMOUNT}.` }, { status: 422 });
  }

  const { error } = await service
    .from('supplier_balance_movements')
    .insert({
      fornecedor_id: HAYAMAX_FORNECEDOR_ID,
      fornecedor_nome: 'HAYAMAX',
      movement_type: 'topup',
      amount,
      reference,
      notes,
      created_by: user.email || user.id,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const balance = await getSupplierBalance(service, HAYAMAX_FORNECEDOR_ID);
  return NextResponse.json({ success: true, balance });
}
