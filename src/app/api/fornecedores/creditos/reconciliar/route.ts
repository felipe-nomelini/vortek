import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { reconcileSupplierCancellationCredits } from '@/lib/supplier-credits';

export async function POST() {
  const supabase = await createClient();
  const auth = await requireAdminUser(supabase);
  if (!auth.ok) return auth.response;

  try {
    const result = await reconcileSupplierCancellationCredits(createServiceClient());
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao reanalisar cancelamentos.' }, { status: 500 });
  }
}
