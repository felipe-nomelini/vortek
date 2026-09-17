import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { getPricingExecutionBlock } from '@/lib/ml/pricing-execution';
import { preparePublication, publicationInputSchema } from '@/services/publication-preparation';
import { configuredPricingExecutionCapability } from '@/services/pricing-execution-access';
import { fetchMLResult } from '@/services/integration';
import { enqueueManualMlCommand, findManualMlCommand } from '@/services/pricing-dispatch';

export const maxDuration = 300;

const relistInputSchema = z.object({
  action: z.literal('relist'), produtoId: z.string().uuid(), sourceItemId: z.string().regex(/^MLB\d+$/),
  priceCents: z.number().int().positive().safe(),
}).strict();

async function resolvePublicationInput(raw: unknown) {
  const shortcut = relistInputSchema.safeParse(raw);
  if (!shortcut.success) return publicationInputSchema.safeParse(raw);
  const source = await fetchMLResult<any>('/items/' + encodeURIComponent(shortcut.data.sourceItemId) + '?include_attributes=all');
  const item = source.data;
  if (!source.ok || item?.id !== shortcut.data.sourceItemId || item.status !== 'closed')
    throw new Error('publication_relist_source_invalid');
  const values = (rows: unknown) => Array.isArray(rows) ? rows.map(row => ({
    id: row?.id, ...(row?.value_id ? { value_id: String(row.value_id) } : {}),
    ...(row?.value_name ? { value_name: String(row.value_name) } : {}),
  })) : [];
  return publicationInputSchema.safeParse({ ...shortcut.data,
    categoriaId: item.category_id, listingType: item.listing_type_id,
    attributes: values(item.attributes), sale_terms: values(item.sale_terms),
    shipping: { mode: item.shipping?.mode, logisticType: item.shipping?.logistic_type,
      freeShipping: item.shipping?.free_shipping },
  });
}

// A confirmação cria uma única operação auditada. O worker envia e confere o anúncio.
export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  if (!configuredPricingExecutionCapability().allowedOperations.includes('listing_create'))
    return NextResponse.json(getPricingExecutionBlock(), { status: 409 });
  try {
    const body = await request.json().catch(() => null);
    const operationId = z.string().uuid().safeParse(body?.operationId);
    if (!operationId.success) return NextResponse.json({ error: 'Confirmação inválida. Atualize a página e tente novamente.' }, { status: 422 });
    if (z.string().uuid().safeParse(body?.produtoId).success && Number.isSafeInteger(body?.priceCents) && body.priceCents > 0) {
      const previous = await findManualMlCommand({ operationId: operationId.data, actorId: auth.userId,
        productId: body.produtoId, kind: 'listing_create', priceCents: body.priceCents,
        action: body.action === 'relist' ? 'relist' : 'new', sourceItemId: body.sourceItemId || null });
      if (previous) return NextResponse.json({ success: true, ...previous }, { status: 202 });
    }
    const { operationId: _operationId, ...publication } = body;
    const input = await resolvePublicationInput(publication);
    if (!input.success) return NextResponse.json({ error: 'Preencha o preço, a categoria e os dados exigidos pelo Mercado Livre.' }, { status: 422 });
    const prepared = await preparePublication(input.data, auth.userId);
    const queued = await enqueueManualMlCommand(prepared.evaluationId, operationId.data, auth.userId);
    return NextResponse.json({ success: true, ...queued, pricing: prepared.pricing,
      priceCents: prepared.decisionContext.priceCents, quantity: prepared.preparation.capacity },
      { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'publication_failed';
    const messages: Record<string, string> = {
      publication_identity_requires_validation: 'A identidade do produto ainda está divergente. Confira marca, GTIN e vínculo.',
      publication_relist_identity_requires_validation: 'O anúncio encerrado não corresponde com segurança ao produto.',
      publication_conditional_attributes_required: 'Preencha os atributos obrigatórios da categoria.',
      publication_price_required: 'Informe o preço de venda para publicar.',
      publication_stock_unavailable: 'Não há estoque disponível para publicar.',
      publication_relist_source_invalid: 'O anúncio de origem mudou. Atualize a página e confira o estado no ML.',
    };
    return NextResponse.json({ code, error: messages[code] || 'Não foi possível confirmar a publicação. Confira o anúncio antes de tentar novamente.' }, { status: 409 });
  }
}
