import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

const INTEGRATION_TYPES = new Set(['mercadolivre', 'dslite', 'brasilnfe', 'mercadopago']);

const ALLOWED_UPDATE_FIELDS = new Set([
  'client_id',
  'client_secret',
  'url',
  'access_token',
  'refresh_token',
  'conectado',
]);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const serviceClient = createServiceClient();
  const { data, error } = await serviceClient
    .from('integracoes')
    .select('tipo,client_id,client_secret,redirect_uri,url,access_token,refresh_token,conectado,last_refresh_error,last_refresh_error_code,token_expires_at,updated_at')
    .order('tipo');

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ integracoes: data || [] });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const tipo = String(body?.tipo || '').trim();
  const values = body?.values && typeof body.values === 'object' ? body.values : {};
  if (!tipo) return NextResponse.json({ erro: 'Tipo de integração ausente' }, { status: 400 });
  if (!INTEGRATION_TYPES.has(tipo)) return NextResponse.json({ erro: 'Tipo de integração inválido' }, { status: 400 });

  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (ALLOWED_UPDATE_FIELDS.has(key)) payload[key] = value;
  }
  if (!Object.keys(payload).length) {
    return NextResponse.json({ erro: 'Nenhum campo permitido informado' }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  const { data, error } = await (serviceClient as any)
    .from('integracoes')
    .update(payload)
    .eq('tipo', tipo)
    .select('tipo,client_id,client_secret,redirect_uri,url,access_token,refresh_token,conectado,last_refresh_error,last_refresh_error_code,token_expires_at,updated_at')
    .single();

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ integracao: data });
}
