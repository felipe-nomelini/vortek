import { NextResponse } from 'next/server';
/** Tombstone para clientes antigos: nenhuma escrita ou enfileiramento. */
export async function POST() {
  return NextResponse.json({ error: 'Desconto por quantidade removido pelo Cânon Comercial.', code: 'POLITICA_REMOVIDA' }, { status: 410 });
}
