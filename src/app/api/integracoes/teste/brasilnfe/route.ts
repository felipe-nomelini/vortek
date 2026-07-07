import { NextResponse } from 'next/server';
import { BrasilNFe } from 'brasilnfe';
import { createClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';

function normalizeBaseUrl(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!normalized) return 'https://api.brasilnfe.com.br/services/';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const token = String(body?.token || '').trim();
  const userToken = String(body?.userToken || '').trim() || undefined;
  const url = normalizeBaseUrl(body?.url);

  if (!token) {
    return NextResponse.json(
      { erro: 'Token da Brasil NFe é obrigatório' },
      { status: 400 },
    );
  }

  try {
    const client = new BrasilNFe(token, userToken, url);
    const response: any = await client.consultas.statusSefaz({
      ModeloDocumento: 55,
      TipoAmbiente: 2,
    } as any);

    const statusText =
      response?.StatusSefaz?.DsStatusRespostaSefaz ||
      response?.StatusSefaz?.Mensagem ||
      response?.Mensagem ||
      response?.Message ||
      null;

    return NextResponse.json({
      ok: true,
      status: statusText,
      message: 'Conexão Brasil NFe validada',
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, erro: error?.message || 'Falha ao consultar Brasil NFe' },
      { status: 422 },
    );
  }
}
