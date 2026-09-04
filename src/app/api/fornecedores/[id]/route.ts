import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import {
  evaluateScheduledTaskHealth,
  getIntervalMinutesForTask,
  getSaoPauloHour,
  getSyncTaskByKey,
} from '@/lib/sync/registry';
import type { Database } from '@/types/database';
import type {
  FornecedorDetailItem,
  FornecedorDetailResponse,
  FornecedorLocalUpdateResponse,
  SupplierSyncHealth,
} from '@/types/fornecedores';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const supplierIdSchema = z.string().uuid();
const localUpdateSchema = z.object({
  email: z.string().trim().max(254).email('E-mail inválido').or(z.literal('')).optional(),
  phone: z.string().trim().max(32).regex(/^[+\d\s().-]*$/, 'Telefone inválido').optional(),
  address: z.string().trim().max(1000, 'Endereço muito extenso').optional(),
  pixKey: z.string().trim().max(180, 'Chave PIX muito extensa').optional(),
}).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  'Informe ao menos um campo para atualizar',
);

const supplierFields = 'id,dslite_id,apelido,nome,cnpj,email,telefone,endereco,supplier_pix_key,status_dslite,crossdocking,dropshipping,ativo,dropshipping_retired_at,dslite_ultima_sync,created_at,updated_at';

type SupplierRow = Database['public']['Tables']['fornecedores']['Row'];

function syncHealth(lastSyncAt: string | null, intervalMinutes: number): SupplierSyncHealth {
  const health = evaluateScheduledTaskHealth({ intervalMinutes, lastRunAt: lastSyncAt });
  if (health.state === 'healthy') return 'healthy';
  if (health.state === 'stale') return 'attention';
  return 'unknown';
}

function mapSupplier(row: SupplierRow, intervalMinutes: number): FornecedorDetailItem {
  return {
    id: row.id,
    dsliteId: row.dslite_id,
    nickname: row.apelido,
    legalName: row.nome,
    document: row.cnpj,
    email: row.email,
    phone: row.telefone,
    address: row.endereco,
    pixKey: row.supplier_pix_key,
    dsliteStatus: row.status_dslite,
    crossdocking: row.crossdocking,
    dropshipping: row.dropshipping,
    active: row.ativo !== false,
    activationBlocked: Boolean(row.dropshipping_retired_at),
    syncHealth: syncHealth(row.dslite_ultima_sync, intervalMinutes),
    lastSyncAt: row.dslite_ultima_sync,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function syncPolicy() {
  const task = getSyncTaskByKey('sync_dslite_fornecedores');
  const intervalMinutes = task ? getIntervalMinutesForTask(task, getSaoPauloHour()) : null;
  const effectiveIntervalMinutes = intervalMinutes || 120;
  const staleThresholdMinutes = evaluateScheduledTaskHealth({
    intervalMinutes: effectiveIntervalMinutes,
    lastRunAt: null,
  }).staleThresholdMinutes;
  return { intervalMinutes: effectiveIntervalMinutes, staleThresholdMinutes };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const supplierId = supplierIdSchema.safeParse(rawId);
  if (!supplierId.success) return noStoreJson({ error: 'Identificador do fornecedor inválido' }, 400);

  const client = createServiceClient();
  const { data: row, error } = await client
    .from('fornecedores')
    .select(supplierFields)
    .eq('id', supplierId.data)
    .maybeSingle();

  if (error) {
    console.error('[supplier-detail] Falha ao carregar fornecedor', { supplierId: supplierId.data, code: error.code });
    return noStoreJson({ error: 'Não foi possível carregar o fornecedor' }, 500);
  }
  if (!row) return noStoreJson({ error: 'Fornecedor não encontrado' }, 404);

  const policy = syncPolicy();
  const supplier = mapSupplier(row as SupplierRow, policy.intervalMinutes);
  let purchaseCount = 0;
  let offerCount = 0;
  let activeOfferCount = 0;

  if (supplier.dsliteId) {
    const [purchases, offers, activeOffers] = await Promise.all([
      client.from('compras').select('id', { count: 'exact', head: true }).eq('fornecedor_id', supplier.dsliteId),
      client.from('produto_fornecedor_ofertas').select('id', { count: 'exact', head: true }).eq('dslite_fornecedor_id', supplier.dsliteId),
      client.from('produto_fornecedor_ofertas').select('id', { count: 'exact', head: true }).eq('dslite_fornecedor_id', supplier.dsliteId).eq('ativo', true),
    ]);
    const summaryError = purchases.error || offers.error || activeOffers.error;
    if (summaryError) {
      console.error('[supplier-detail] Falha ao carregar resumo', { supplierId: supplier.id, code: summaryError.code });
      return noStoreJson({ error: 'Não foi possível carregar o resumo do fornecedor' }, 500);
    }
    purchaseCount = purchases.count || 0;
    offerCount = offers.count || 0;
    activeOfferCount = activeOffers.count || 0;
  }

  const payload: FornecedorDetailResponse = {
    data: { supplier, summary: { purchaseCount, offerCount, activeOfferCount } },
    syncPolicy: policy,
  };
  return noStoreJson(payload);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'suppliers.manage');
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const supplierId = supplierIdSchema.safeParse(rawId);
  if (!supplierId.success) return noStoreJson({ error: 'Identificador do fornecedor inválido' }, 400);

  const body = await request.json().catch(() => null);
  const parsed = localUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: parsed.error.issues[0]?.message || 'Dados locais inválidos' }, 400);
  }

  const update: Database['public']['Tables']['fornecedores']['Update'] = {};
  if (parsed.data.email !== undefined) update.email = parsed.data.email.toLowerCase();
  if (parsed.data.phone !== undefined) update.telefone = parsed.data.phone;
  if (parsed.data.address !== undefined) update.endereco = parsed.data.address;
  if (parsed.data.pixKey !== undefined) update.supplier_pix_key = parsed.data.pixKey;

  const client = createServiceClient();
  const { data, error } = await client
    .from('fornecedores')
    .update(update)
    .eq('id', supplierId.data)
    .select('email,telefone,endereco,supplier_pix_key,updated_at')
    .maybeSingle();

  if (error) {
    console.error('[supplier-detail] Falha ao atualizar dados locais', { supplierId: supplierId.data, code: error.code });
    return noStoreJson({ error: 'Não foi possível atualizar os dados locais' }, 500);
  }
  if (!data) return noStoreJson({ error: 'Fornecedor não encontrado' }, 404);

  const payload: FornecedorLocalUpdateResponse = {
    data: {
      email: data.email,
      phone: data.telefone,
      address: data.endereco,
      pixKey: data.supplier_pix_key,
      updatedAt: data.updated_at,
    },
  };
  return noStoreJson(payload);
}
