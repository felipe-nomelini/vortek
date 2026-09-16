import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/auth/admin';
import { brandKey } from '@/lib/ml/brand-equivalences';

export const dynamic = 'force-dynamic';

const pairSchema = z.object({ brandA: z.string().trim().min(2).max(80), brandB: z.string().trim().min(2).max(80) }).strict();
const toggleSchema = z.object({ id: z.string().uuid(), active: z.boolean() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function adminContext() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  return admin.ok ? { ok: true as const, admin, client: createServiceClient() } : { ok: false as const, response: admin.response };
}

export async function GET() {
  const context = await adminContext();
  if (!context.ok) return context.response;
  const { data, error } = await (context.client as any).from('ml_brand_equivalences')
    .select('id,brand_a,brand_b,active,created_at,updated_at')
    .order('brand_a_key').order('brand_b_key');
  return error ? json({ erro: 'Não foi possível consultar as equivalências de marca.' }, 500)
    : json({ items: data || [] });
}

export async function POST(request: Request) {
  const context = await adminContext();
  if (!context.ok) return context.response;
  const parsed = pairSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ erro: 'Informe duas marcas válidas.' }, 422);
  const first = { name: parsed.data.brandA, key: brandKey(parsed.data.brandA) };
  const second = { name: parsed.data.brandB, key: brandKey(parsed.data.brandB) };
  if (!first.key || !second.key || first.key === second.key) return json({ erro: 'As marcas já são iguais após normalização.' }, 422);
  const [a, b] = first.key < second.key ? [first, second] : [second, first];
  const table = (context.client as any).from('ml_brand_equivalences');
  const { data: existing, error: lookupError } = await table.select('id,active')
    .eq('brand_a_key', a.key).eq('brand_b_key', b.key).maybeSingle();
  if (lookupError) return json({ erro: 'Não foi possível verificar a equivalência.' }, 500);
  if (existing?.active) return json({ erro: 'Equivalência já cadastrada.' }, 409);
  const now = new Date().toISOString();
  const { error } = existing
    ? await table.update({ active: true, brand_a: a.name, brand_b: b.name,
        updated_by: context.admin.user.id, updated_at: now }).eq('id', existing.id)
    : await table.insert({ brand_a: a.name, brand_b: b.name, brand_a_key: a.key, brand_b_key: b.key,
        created_by: context.admin.user.id, updated_by: context.admin.user.id });
  if (error) return json({ erro: error.code === '23505' ? 'Equivalência já cadastrada.' : 'Não foi possível salvar a equivalência.' }, error.code === '23505' ? 409 : 500);
  return json({ ok: true });
}

export async function PATCH(request: Request) {
  const context = await adminContext();
  if (!context.ok) return context.response;
  const parsed = toggleSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ erro: 'Alteração inválida.' }, 422);
  const { data, error } = await (context.client as any).from('ml_brand_equivalences')
    .update({ active: parsed.data.active, updated_by: context.admin.user.id,
      updated_at: new Date().toISOString() })
    .eq('id', parsed.data.id).select('id').maybeSingle();
  if (error) return json({ erro: 'Não foi possível alterar a equivalência.' }, 500);
  if (!data) return json({ erro: 'Equivalência não encontrada.' }, 404);
  return json({ ok: true });
}
