import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { isHomologationFixtureSource } from '@/lib/homologation-fixture';
import { createServiceClient } from '@/lib/supabase';
import type {
  ClienteContactUpdate,
  ClienteDetailItem,
  ClienteDetailOrder,
  ClienteDetailResponse,
} from '@/types/clientes';
import type { OrderStatus } from '@/types/order';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const PAGE_SIZE = 20;
const clientIdSchema = z.string().uuid();
const contactSchema = z.object({
  email: z.string().trim().max(254).email('E-mail inválido').or(z.literal('')),
  phone: z.string().trim().max(32).regex(/^[+\d\s().-]*$/, 'Telefone inválido'),
}).strict();

const clientFields = 'id,nome,tipo_pessoa,documento,endereco,email,telefone,ml_id,ml_nickname,created_at,updated_at';
const orderFields = 'id,numero,ml_order_id,ml_pack_id,data_venda,data,total,situacao,ml_shipment_id,rastreio,snapshot_source';

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mapClient(row: Record<string, any>): ClienteDetailItem {
  return {
    id: String(row.id),
    name: String(row.nome || ''),
    personType: String(row.tipo_pessoa || ''),
    document: String(row.documento || ''),
    address: String(row.endereco || ''),
    email: String(row.email || ''),
    phone: String(row.telefone || ''),
    mlId: row.ml_id ? String(row.ml_id) : null,
    mlNickname: row.ml_nickname ? String(row.ml_nickname) : null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function mapOrder(row: Record<string, any>): ClienteDetailOrder {
  return {
    id: String(row.id),
    saleId: String(row.ml_order_id || row.numero || ''),
    packId: row.ml_pack_id ? String(row.ml_pack_id) : null,
    date: row.data_venda || row.data || null,
    total: Number(row.total || 0),
    status: String(row.situacao || 'aberto') as OrderStatus,
    shipmentId: row.ml_shipment_id ? String(row.ml_shipment_id) : null,
    tracking: row.rastreio ? String(row.rastreio) : null,
    isHomologationFixture: isHomologationFixtureSource(row.snapshot_source),
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const clientId = clientIdSchema.safeParse(rawId);
  if (!clientId.success) {
    return NextResponse.json(
      { error: 'Identificador do cliente inválido' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const page = positiveInteger(new URL(request.url).searchParams.get('page'), 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const supabase = createServiceClient();
  const { data: clientRow, error: clientError } = await supabase
    .from('clientes')
    .select(clientFields)
    .eq('id', clientId.data)
    .maybeSingle();

  if (clientError) {
    console.error('[client-detail] Falha ao carregar cliente', { clientId: clientId.data, code: clientError.code });
    return NextResponse.json(
      { error: 'Não foi possível carregar o cliente' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!clientRow) {
    return NextResponse.json(
      { error: 'Cliente não encontrado' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const client = mapClient(clientRow as Record<string, any>);
  if (!client.mlId) {
    const payload: ClienteDetailResponse = {
      data: { client, summary: { orderCount: 0, lastOrderAt: null }, orders: [] },
      page,
      pageSize: PAGE_SIZE,
      total: 0,
    };
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  }

  const [ordersResult, latestOrderResult] = await Promise.all([
    supabase
      .from('pedidos')
      .select(orderFields, { count: 'exact' })
      .eq('buyer_ml_id', client.mlId)
      .order('data_venda', { ascending: false, nullsFirst: false })
      .order('data', { ascending: false })
      .range(from, to),
    supabase
      .from('pedidos')
      .select('data_venda,data')
      .eq('buyer_ml_id', client.mlId)
      .order('data_venda', { ascending: false, nullsFirst: false })
      .order('data', { ascending: false })
      .limit(1),
  ]);

  if (ordersResult.error || latestOrderResult.error) {
    const error = ordersResult.error || latestOrderResult.error;
    console.error('[client-detail] Falha ao carregar histórico', { clientId: client.id, code: error?.code });
    return NextResponse.json(
      { error: 'Não foi possível carregar o histórico do cliente' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const latestOrder = latestOrderResult.data?.[0] as Record<string, any> | undefined;
  const total = Number(ordersResult.count || 0);
  const payload: ClienteDetailResponse = {
    data: {
      client,
      summary: {
        orderCount: total,
        lastOrderAt: latestOrder?.data_venda || latestOrder?.data || null,
      },
      orders: (ordersResult.data || []).map((row) => mapOrder(row as Record<string, any>)),
    },
    page,
    pageSize: PAGE_SIZE,
    total,
  };

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'customers.manage');
  if (!auth.ok) return auth.response;

  const { id: rawId } = await context.params;
  const clientId = clientIdSchema.safeParse(rawId);
  if (!clientId.success) {
    return NextResponse.json(
      { error: 'Identificador do cliente inválido' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const body = await request.json().catch(() => null);
  const contact = contactSchema.safeParse(body);
  if (!contact.success) {
    return NextResponse.json(
      { error: contact.error.issues[0]?.message || 'Contato inválido' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const update: ClienteContactUpdate = {
    email: contact.data.email.toLowerCase(),
    phone: contact.data.phone,
  };
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('clientes')
    .update({ email: update.email, telefone: update.phone })
    .eq('id', clientId.data)
    .select(clientFields)
    .maybeSingle();

  if (error) {
    console.error('[client-detail] Falha ao atualizar contato', { clientId: clientId.data, code: error.code });
    return NextResponse.json(
      { error: 'Não foi possível atualizar o contato' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: 'Cliente não encontrado' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { data: mapClient(data as Record<string, any>) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
