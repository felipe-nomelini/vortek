import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';

function normalizeBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

export async function POST() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  const serviceClient = createServiceClient();
  const { data: integracao, error } = await serviceClient
    .from('integracoes')
    .select('url,access_token')
    .eq('tipo', 'dslite')
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { erro: 'Falha ao carregar configuração da DSLite' },
      { status: 500 },
    );
  }
  const url = normalizeBaseUrl(integracao?.url);
  const token = String(integracao?.access_token || '').trim();

  if (!url || !token) {
    return NextResponse.json(
      { erro: 'URL e token da DSLite são obrigatórios' },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`${url}/v1/CrossDocking/Categoria`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Token: token,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          erro: `DSLite retornou HTTP ${response.status}`,
          status: response.status,
        },
        { status: 422 },
      );
    }

    const payload = await response.json().catch(() => null);
    const categorias = Array.isArray(payload) ? payload.length : null;

    return NextResponse.json({
      ok: true,
      categorias,
      message: 'Conexão DSLite validada',
    });
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? 'Timeout ao consultar DSLite' : error?.message || 'Falha ao consultar DSLite';
    return NextResponse.json({ ok: false, erro: message }, { status: 422 });
  } finally {
    clearTimeout(timeout);
  }
}
