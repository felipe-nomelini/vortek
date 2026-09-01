import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { loadStockReceipt } from '@/lib/estoque-recebimento';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'inventory.read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ receipt: await loadStockReceipt((await props.params).id) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Recebimento não encontrado.' }, { status: 404 });
  }
}
