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

const SUPABASE_IN_CHUNK_SIZE = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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

function normalizeTextKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeHayamaxStatementFileKey(fileName: string): string {
  return String(fileName || '')
    .replace(/\.(xlsx|xls)$/i, '')
    .replace(/\s*\(\d+\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

function extractDsliteOrderNumber(value: unknown): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(/DSL-(\d+)/i);
  return match?.[1] ? String(match[1]).trim() : null;
}

function buildOccurrenceKey(parts: string[]) {
  return parts.join(':');
}

type ParsedHayamaxMovement = {
  rowIndex: number;
  amount: number;
  description: string;
  reference: string | null;
  purchaseNumber: string | null;
  movementType: 'topup' | 'purchase_debit' | 'adjustment';
  movementKey: string;
  dateKey: string | null;
  notes: string;
  compraDsid: string | null;
};

function extractHayamaxMovementsFromWorkbook(fileName: string, buffer: Buffer): ParsedHayamaxMovement[] {
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

  const notes = `Importado do extrato Hayamax (${fileName})`;
  const occurrenceCounter = new Map<string, number>();
  const items: ParsedHayamaxMovement[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const dateKey = normalizeDateKey(row[0]);
    const description = String(row[1] || '').trim();
    const referenceCell = String(row[2] || '').trim();
    const purchaseCell = String(row[3] || '').trim();
    const amount = normalizeMoneyAmount(parseBrazilMoney(row[4]));

    if (!description) continue;
    if (normalizeTextKey(description) === 'saldo') continue;
    if (!amount) continue;

    const descriptionKey = normalizeTextKey(description);
    const referenceKey = normalizeTextKey(referenceCell);
    const purchaseNumber = extractDsliteOrderNumber(purchaseCell);

    let movementType: ParsedHayamaxMovement['movementType'] = 'adjustment';
    let movementKeyBase = '';

    if (purchaseNumber && amount < 0) {
      movementType = 'purchase_debit';
      movementKeyBase = `purchase:${purchaseNumber}`;
    } else if (descriptionKey.includes('creddropship')) {
      movementType = 'topup';
      movementKeyBase = buildOccurrenceKey([
        'hayamax_xlsx_stmt',
        dateKey || 'sem-data',
        descriptionKey || 'sem-descricao',
        referenceKey || 'sem-referencia',
        purchaseNumber || 'sem-pedido',
        amount.toFixed(2),
      ]);
    } else {
      movementType = 'adjustment';
      movementKeyBase = buildOccurrenceKey([
        'hayamax_xlsx_stmt',
        dateKey || 'sem-data',
        descriptionKey || 'sem-descricao',
        referenceKey || 'sem-referencia',
        purchaseNumber || 'sem-pedido',
        amount.toFixed(2),
      ]);
    }

    const occurrence = (occurrenceCounter.get(movementKeyBase) || 0) + 1;
    occurrenceCounter.set(movementKeyBase, occurrence);
    const movementKey = movementType === 'purchase_debit'
      ? movementKeyBase
      : `${movementKeyBase}:#${occurrence}`;

    items.push({
      rowIndex: index,
      amount,
      description,
      reference: referenceCell || description || null,
      purchaseNumber: purchaseCell || null,
      movementType,
      movementKey,
      dateKey,
      notes,
      compraDsid: purchaseNumber,
    });
  }

  if (!items.length) {
    throw new Error('Nenhum movimento válido encontrado no extrato Hayamax.');
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
    let parsedItems: ParsedHayamaxMovement[];
    try {
      parsedItems = extractHayamaxMovementsFromWorkbook(fileName, buffer);
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Falha ao ler extrato Hayamax.' }, { status: 422 });
    }

    const statementFileKey = normalizeHayamaxStatementFileKey(fileName);
    const { data: existingImportedRows, error: existingImportedError } = await service
      .from('supplier_balance_movements')
      .select('id')
      .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID)
      .like('created_by', 'hayamax_xlsx:%')
      .ilike('notes', `%${statementFileKey}%`);
    if (existingImportedError) {
      return NextResponse.json({ error: existingImportedError.message }, { status: 500 });
    }

    const existingImportedIds = (existingImportedRows || [])
      .map((row: any) => String(row.id || '').trim())
      .filter(Boolean);

    if (existingImportedIds.length > 0) {
      for (const existingImportedIdsChunk of chunkArray(existingImportedIds, SUPABASE_IN_CHUNK_SIZE)) {
        const { error: deleteError } = await service
          .from('supplier_balance_movements')
          .delete()
          .in('id', existingImportedIdsChunk);
        if (deleteError) {
          return NextResponse.json({ error: deleteError.message }, { status: 500 });
        }
      }
    }

    const movementKeys = parsedItems.map((item) => item.movementKey);
    const existingRows: any[] = [];
    for (const movementKeysChunk of chunkArray(movementKeys, SUPABASE_IN_CHUNK_SIZE)) {
      const { data, error: existingError } = await service
        .from('supplier_balance_movements')
        .select('id,movement_key,amount,compra_id')
        .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID)
        .in('movement_key', movementKeysChunk);
      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 });
      }
      existingRows.push(...(data || []));
    }

    const purchaseDsids = Array.from(new Set(parsedItems.map((item) => item.compraDsid).filter(Boolean))) as string[];
    const compraByDsid = new Map<string, any>();
    if (purchaseDsids.length > 0) {
      for (const purchaseDsidsChunk of chunkArray(purchaseDsids, SUPABASE_IN_CHUNK_SIZE)) {
        const { data: comprasRows, error: comprasError } = await service
          .from('compras')
          .select('id,dsid')
          .eq('fornecedor_id', HAYAMAX_FORNECEDOR_ID)
          .in('dsid', purchaseDsidsChunk);
        if (comprasError) {
          return NextResponse.json({ error: comprasError.message }, { status: 500 });
        }
        for (const compra of comprasRows || []) {
          compraByDsid.set(String(compra.dsid || '').trim(), compra);
        }
      }
    }

    const existingByKey = new Map<string, any>();
    for (const row of existingRows || []) {
      existingByKey.set(String(row.movement_key || ''), row);
    }

    const toInsert: any[] = [];
    const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];
    let skipped = 0;

    for (const item of parsedItems) {
      const compra = item.compraDsid ? compraByDsid.get(item.compraDsid) : null;
      const isPurchaseDebit = item.movementType === 'purchase_debit';
      const existingRow = existingByKey.get(item.movementKey);

      if (existingRow && !isPurchaseDebit) {
        skipped += 1;
        continue;
      }

      if (existingRow && isPurchaseDebit) {
        const currentAmount = normalizeMoneyAmount(Number(existingRow.amount || 0));
        const nextCompraId = existingRow.compra_id || compra?.id || null;
        if (currentAmount === item.amount && nextCompraId === (existingRow.compra_id || null)) {
          skipped += 1;
          continue;
        }
        toUpdate.push({
          id: String(existingRow.id),
          payload: {
            amount: item.amount,
            compra_id: nextCompraId,
            reference: `Compra DSLite ${item.compraDsid}`,
            notes: `${item.notes} · Débito conciliado do pedido ${item.purchaseNumber || item.compraDsid || 'sem-pedido'} · ${item.description}`,
          },
        });
        continue;
      }

      toInsert.push({
        fornecedor_id: HAYAMAX_FORNECEDOR_ID,
        fornecedor_nome: 'HAYAMAX',
        movement_type: item.movementType,
        amount: item.amount,
        reference: isPurchaseDebit
          ? `Compra DSLite ${item.compraDsid}`
          : item.reference,
        compra_id: compra?.id || null,
        notes: isPurchaseDebit
          ? `${item.notes} · Débito conciliado do pedido ${item.purchaseNumber || item.compraDsid || 'sem-pedido'} · ${item.description}`
          : `${item.notes} · ${item.description}`,
        movement_key: item.movementKey,
        created_by: `hayamax_xlsx:${user.email || user.id}`,
      });
    }

    for (const update of toUpdate) {
      const { error } = await service
        .from('supplier_balance_movements')
        .update(update.payload as any)
        .eq('id', update.id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

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
        replaced: existingImportedIds.length,
        inserted: toInsert.length,
        updated: toUpdate.length,
        skipped,
        debitsFound: parsedItems.filter((item) => item.movementType === 'purchase_debit').length,
        topupsFound: parsedItems.filter((item) => item.movementType === 'topup').length,
        adjustmentsFound: parsedItems.filter((item) => item.movementType === 'adjustment').length,
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
