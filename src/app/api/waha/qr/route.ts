import { NextResponse } from 'next/server';
import { getWahaQrPng } from '@/services/waha';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const png = await getWahaQrPng();
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, max-age=0',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao gerar QR Code WAHA' }, { status: 500 });
  }
}
