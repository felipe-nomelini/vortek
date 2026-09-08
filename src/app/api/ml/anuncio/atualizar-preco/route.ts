import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { getPricingExecutionBlock } from '@/lib/ml/pricing-execution';

/** Retired raw-price contract. Approved commands use /api/pricing/decisions/execute. */
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  return NextResponse.json(getPricingExecutionBlock(), { status: 409 });
}
