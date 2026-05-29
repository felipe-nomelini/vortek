import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'Não autenticado' }, { status: 401 });

  const { data: integracoes } = await supabase
    .from('integracoes')
    .select('tipo, conectado')
    .in('tipo', ['mercadolivre', 'dslite', 'brasilnfe']);

  const labelMap: Record<string, string> = {
    mercadolivre: 'Mercado Livre',
    dslite: 'DSLite',
    brasilnfe: 'Brasil NFe',
  };

  const status = (integracoes || []).map((i: any) => ({
    label: labelMap[i.tipo] || i.tipo,
    status: i.conectado ? 'Conectado' : 'Desconectado',
    on: !!i.conectado,
  }));

  const allLabels = ['Mercado Livre', 'DSLite', 'Brasil NFe'];
  for (const label of allLabels) {
    if (!status.find(s => s.label === label)) {
      status.push({ label, status: 'Desconectado', on: false });
    }
  }

  return NextResponse.json({ integracoes: status });
}
