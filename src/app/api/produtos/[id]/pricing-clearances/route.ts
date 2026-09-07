import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { hasPermission } from '@/lib/permissions';
import { loadBntD07VisualReview } from '@/lib/products/bnt-d07-visual-review';
import { loadPricingClearances, managePricingClearance, pricingClearanceCommandSchema } from '@/services/pricing-clearances';

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
    if (profile.error || !profile.data) return json({ error: 'Permissões indisponíveis' }, 403);
    const client = createServiceClient();
    const product = await client.from('produtos').select('id,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id,custom_price').eq('id', id).maybeSingle();
    if (product.error) throw new Error('product_read_failed');
    if (!product.data) return json({ error: 'Produto não encontrado' }, 404);
    return json({ ...await loadPricingClearances(client, product.data), canManage: hasPermission(profile.data.cargo, 'pricing.clearance.manage') });
  } catch { return json({ error: 'Liquidação indisponível. Nenhuma execução está autorizada.' }, 503); }
}
export async function POST(request: Request, context: Context) {
  const auth = await authorizeApiRequest(request, 'pricing.clearance.manage');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const command = pricingClearanceCommandSchema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !command.success) return json({ error: 'Comando de liquidação inválido' }, 422);
  try {
    const client = createServiceClient();
    const review = await loadBntD07VisualReview();
    const members = await client.from('ml_pricing_group_members').select('ml_item_id').eq('group_id', command.data.groupId).eq('is_current', true);
    if (members.error) throw new Error('group_read_failed');
    if (review?.items.some(row => String(row.product.id) === id || row.mlListings?.some(item => members.data?.some(member => member.ml_item_id === item.itemId)))) {
      return json({ error: 'Amostra protegida de homologação', code: 'homologation_fixture_read_only' }, 409);
    }
    const product = await client.from('produtos').select('id,ativo,oferta_preferencial_id,fornecedor_preferencial_manual,ml_item_id,custom_price').eq('id', id).maybeSingle();
    if (product.error) throw new Error('product_read_failed');
    if (!product.data) return json({ error: 'Produto não encontrado' }, 404);
    return json({ clearanceId: await managePricingClearance(client, product.data, auth.userId, command.data), priceChanged: false });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code.startsWith('clearance_') && !['clearance_read_failed', 'clearance_write_failed'].includes(code)) {
      return json({ error: 'Estoque, grupo ou autorização mudou. Consulte o estado antes de continuar.', code }, code === 'clearance_permission_denied' ? 403 : 409);
    }
    return json({ error: 'Não foi possível registrar. Consulte o estado; nenhum reenvio automático foi feito.' }, 503);
  }
}
