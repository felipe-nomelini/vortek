import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { fetchMLResult } from '@/services/integration';
import { loadPricingDetail } from '@/services/pricing-detail';
import { persistProductMlGroups, resolveProductMlLinks } from '@/services/ml-listing-links';

const input = z.object({ productId: z.string().uuid(), commandId: z.string().uuid() }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

/** Reconsulta vínculo e economia de um produto. Não prepara decisão nem escreve no ML. */
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Informe somente o produto e o identificador do comando.' }, 422);
  const { productId, commandId } = parsed.data;
  const client = createServiceClient();
  const claimed = await client.from('jobs').insert({
    id: commandId,
    tipo: 'pricing_product_reanalysis',
    status: 'rodando',
    progresso: 0,
    total: 1,
    processados: 0,
    created_by: auth.userId,
    dedupe_key: `product:${productId}:command:${commandId}`,
    log: [{ productId, event: 'started', at: new Date().toISOString() }],
  }).select('id,status,created_by,log').single();
  if (claimed.error) {
    const prior = await client.from('jobs').select('id,status,created_by,log')
      .eq('id', commandId).maybeSingle();
    if (prior.error || !prior.data || prior.data.created_by !== auth.userId
      || (prior.data.log as any[])?.[0]?.productId !== productId)
      return json({ error: 'Não foi possível registrar a reanálise.' }, 409);
    return json({ success: prior.data.status === 'concluido', state: prior.data.status, replayed: true },
      prior.data.status === 'rodando' ? 202 : 200);
  }
  try {
    const [product, account] = await Promise.all([
      client.from('produtos').select('*').eq('id', productId).maybeSingle(),
      fetchMLResult<any>('/users/me'),
    ]);
    if (product.error || !product.data) throw new Error('product_unavailable');
    if (!account.ok || !account.data?.id || account.data.site_id !== 'MLB') throw new Error('ml_account_unavailable');
    const observedAt = new Date().toISOString();
    const links = await resolveProductMlLinks(client, product.data, Number(account.data.id));
    const stored = await persistProductMlGroups(client, productId, Number(account.data.id), links, observedAt);
    if (stored?.applied !== true) throw new Error('group_observation_not_applied');
    const candidate = links.candidates
      .filter(row => row.status === 'active' && row.identity === 'complete' && !row.variationId)
      .sort((a, b) => Number(a.catalog) - Number(b.catalog) || a.itemId.localeCompare(b.itemId))[0];
    if (!candidate) throw new Error('listing_identity_pending');
    const detailResponse = await loadPricingDetail({ produtoId: productId, mlItemId: candidate.itemId }, { actorId: auth.userId });
    const detail = await detailResponse.json();
    if (!detailResponse.ok) throw new Error(detail.code || 'pricing_reanalysis_unavailable');
    const finishedAt = new Date().toISOString();
    const saved = await client.from('jobs').update({
      status: 'concluido', progresso: 100, processados: 1, finished_at: finishedAt,
      log: [
        { productId, event: 'started', at: observedAt },
        { event: 'completed', at: finishedAt, evaluationId: detail.evaluationId,
          groupCoverage: links.coverage, groups: links.groups.length },
      ],
    }).eq('id', commandId).eq('status', 'rodando');
    if (saved.error) throw new Error('reanalysis_persistence_failed');
    return json({ success: true, state: 'concluido', evaluationId: detail.evaluationId,
      productId, itemId: candidate.itemId, replayed: false });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await client.from('jobs').update({ status: 'erro', finished_at: finishedAt,
      log: [{ productId, event: 'failed', at: finishedAt,
        code: error instanceof Error ? error.message : 'pricing_reanalysis_unavailable' }],
    }).eq('id', commandId).eq('status', 'rodando');
    return json({ error: 'A reanálise não foi concluída. Nenhuma alteração foi enviada ao Mercado Livre.' }, 503);
  }
}
