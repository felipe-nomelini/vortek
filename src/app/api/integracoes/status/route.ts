import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';

function buildMercadoLivreStatus(i: any) {
  if (!i) return { label: 'Mercado Livre', status: 'Desconectado', on: false };
  if (i.last_refresh_error_code) {
    return { label: 'Mercado Livre', status: `Refresh com erro: ${i.last_refresh_error_code}`, on: false };
  }
  const expiresAt = i.token_expires_at ? new Date(i.token_expires_at).getTime() : null;
  if (expiresAt && expiresAt - Date.now() < 15 * 60 * 1000) {
    return { label: 'Mercado Livre', status: 'Token expirando', on: Boolean(i.conectado) };
  }
  return { label: 'Mercado Livre', status: i.conectado ? 'Conectado' : 'Desconectado', on: !!i.conectado };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });
  const serviceClient = createServiceClient();

  const { data: integracoes, error } = await serviceClient
    .from('integracoes')
    .select('tipo, conectado, token_expires_at, last_refresh_error, last_refresh_error_code')
    .in('tipo', ['mercadolivre', 'dslite', 'brasilnfe', 'mercadopago']);

  if (error) {
    console.error(JSON.stringify({
      event: 'integracoes_status_read_failed',
      timestamp_utc: new Date().toISOString(),
      code: error.code || null,
      message: error.message,
    }));
    return NextResponse.json({
      integracoes: [
        { label: 'Mercado Livre', status: 'Erro lendo integração', on: false },
        { label: 'DSLite', status: 'Erro lendo integração', on: false },
        { label: 'Brasil NFe', status: 'Erro lendo integração', on: false },
        { label: 'Mercado Pago', status: 'Erro lendo integração', on: false },
      ],
    }, { status: 200 });
  }

  const labelMap: Record<string, string> = {
    mercadolivre: 'Mercado Livre',
    dslite: 'DSLite',
    brasilnfe: 'Brasil NFe',
    mercadopago: 'Mercado Pago',
  };

  const status = (integracoes || []).map((i: any) => (
    i.tipo === 'mercadolivre'
      ? buildMercadoLivreStatus(i)
      : {
          label: labelMap[i.tipo] || i.tipo,
          status: i.conectado ? 'Conectado' : 'Desconectado',
          on: !!i.conectado,
        }
  ));

  const allLabels = ['Mercado Livre', 'DSLite', 'Brasil NFe', 'Mercado Pago'];
  for (const label of allLabels) {
    if (!status.find(s => s.label === label)) {
      status.push({ label, status: 'Desconectado', on: false });
    }
  }

  return NextResponse.json({ integracoes: status });
}
