import { NextResponse } from 'next/server';
import { consultarNFe } from '@/services/nfe';

export async function POST(req: Request) {
  try {
    const { chave } = await req.json();
    if (!chave) {
      return NextResponse.json({ error: 'chave é obrigatória' }, { status: 400 });
    }

    const result = await consultarNFe({ chave });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
