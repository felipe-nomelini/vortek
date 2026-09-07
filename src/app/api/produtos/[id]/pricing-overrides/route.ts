import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { hasPermission } from '@/lib/permissions';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { loadPricingOverrides, managePricingOverride, pricingOverrideCommandSchema } from '@/services/pricing-overrides';

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
    if (profile.error || !profile.data) return json({ error: 'Não foi possível validar as permissões' }, 403);
    const service = createServiceClient();
    const product = await service.from('produtos').select('id').eq('id', id).maybeSingle();
    if (product.error) throw new Error('product_read_failed');
    if (!product.data) return json({ error: 'Produto não encontrado' }, 404);
    return json({ ...await loadPricingOverrides(service, id), canManage: hasPermission(profile.data.cargo, 'pricing.override.manage') });
  } catch { return json({ error: 'Proteção de preço indisponível', status: 'unavailable' }, 503); }
}

export async function POST(request: Request, context: Context) {
  const auth = await authorizeApiRequest(request, 'pricing.override.manage');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'Produto inválido' }, 422);
  const command = pricingOverrideCommandSchema.safeParse(await request.json().catch(() => null));
  if (!command.success) return json({ error: 'Comando de proteção inválido' }, 422);
  try {
    const service = createServiceClient();
    const review = await loadBntD07VisualReview();
    const protection = await loadPricingOverrides(service, id);
    const group = protection.groups.find(row => row.id === command.data.groupId);
    // Um grupo arquivado some da leitura após revogação, mas o retry do comando deve continuar idempotente.
    if (!group) {
      const archived = await service.from('ml_pricing_groups').select('id').eq('id', command.data.groupId).eq('produto_id', id).maybeSingle();
      if (archived.error) throw new Error('pricing_override_read_failed');
      if (!archived.data) return json({ error: 'Grupo não pertence ao produto', code: 'override_group_mismatch' }, 409);
    }
    if (review?.items.some(row => String(row.product.id) === id || row.mlListings?.some(item => group?.members.some(member => member.itemId === item.itemId)))) {
      return json({ error: 'Amostra protegida de homologação', code: 'homologation_fixture_read_only' }, 409);
    }
    const overrideId = await managePricingOverride(service, id, auth.userId, command.data);
    return json({ overrideId });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code.startsWith('override_')) return json({ error: 'Proteção ou grupo mudou. Atualize os dados antes de tentar novamente.', code }, code === 'override_permission_denied' ? 403 : 409);
    return json({ error: 'Não foi possível registrar a proteção. Consulte o estado antes de tentar novamente.', code: 'pricing_override_write_failed' }, 503);
  }
}
