import { NextResponse } from 'next/server';
import { consultarPedido } from '@/services/dslite';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dsid = searchParams.get('dsid');

  if (!dsid) {
    return NextResponse.json({ error: 'dsid é obrigatório' }, { status: 400 });
  }

  const result = await consultarPedido(dsid);
  return NextResponse.json({ success: !!result, data: result });
}
