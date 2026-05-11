import { NextResponse } from 'next/server';
import { statusSEFAZ } from '@/services/nfe';

export async function GET() {
  const result = await statusSEFAZ();
  return NextResponse.json(result);
}
