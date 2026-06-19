import { NextResponse } from 'next/server';
import { getMLConnectionStatus } from '@/services/integration';

export async function GET() {
  try {
    const status = await getMLConnectionStatus();
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({
      conectado: false,
      precisaReconectar: true,
      reason: 'auth_fatal',
      erro: 'Falha ao validar integração Mercado Livre',
    });
  }
}
