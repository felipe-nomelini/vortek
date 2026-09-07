import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { hasPermission } from '@/lib/permissions';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { warrantyCommandSchema } from '@/lib/product-warranty';
import { loadProductWarranty, manageProductWarranty } from '@/services/product-warranty';
type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(_request: Request, context: Context) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'Produto inválido' }, 422);
  try {
    const profile = await auth.from('profiles').select('cargo').eq('id', user.id).maybeSingle();
    if (!profile.data || profile.error) return json({ error: 'Permissões indisponíveis' }, 403);
    const { context: _context, ...data } = await loadProductWarranty(createServiceClient(), id);
    return json({ ...data, canManage: hasPermission(profile.data.cargo, 'products.warranty.manage') });
  } catch { return json({ error: 'Não foi possível consultar a garantia' }, 503); }
}
export async function POST(request: Request, context: Context) {
  const auth = await authorizeApiRequest(request, 'products.warranty.manage');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const command = warrantyCommandSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !command.success) return json({ error: 'Informe uma evidência válida e o motivo' }, 422);
  try {
    const review = await loadBntD07VisualReview();
    if (review?.items.some(row => String(row.product.id) === id)) return json({ error: 'Amostra protegida de homologação', code: 'homologation_fixture_read_only' }, 409);
    const { context: _context, ...data } = await manageProductWarranty(createServiceClient(), id, auth.userId, command.data);
    return json({ ...data, canManage: true, externalListingChanged: false });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('warranty_') ? error.message : 'warranty_write_failed';
    if (code === 'warranty_review_invalid') return json({ error: 'A revisão precisa comprovar este produto, a aplicação no Brasil e um prazo sem divergências. Kits exigem cobertura do conjunto.', code }, 422);
    return json({ error: 'Não foi possível concluir. Consulte o estado antes de reenviar.', code }, /conflict|changed|progress/.test(code) ? 409 : 503);
  }
}
