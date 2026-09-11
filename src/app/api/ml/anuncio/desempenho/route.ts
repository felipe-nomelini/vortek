import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { loadPricingPerformance } from '@/services/pricing-performance';

export const maxDuration = 60;

const inputSchema = z.object({
  produtoId: z.string().uuid(),
  mlItemId: z.string().regex(/^ML[A-Z]\d+$/),
  forceRefresh: z.boolean().optional().default(false),
}).strict();

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.read');
  if (!auth.ok) return auth.response;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Informe um anúncio válido.' }, 422);
  try {
    return json(await loadPricingPerformance(parsed.data));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'performance_product_not_found') return json({ error: 'Produto não encontrado.' }, 404);
    if (code === 'performance_listing_mismatch') return json({ error: 'Este anúncio não pertence ao produto informado.' }, 422);
    if (code === 'performance_ml_account_unavailable') {
      return json({ error: 'Não foi possível consultar a conta do Mercado Livre.' }, 503);
    }
    if (code === 'performance_listing_unavailable') {
      return json({ error: 'Não foi possível consultar este anúncio no Mercado Livre.' }, 503);
    }
    if (code === 'performance_listing_owner_mismatch') {
      return json({ error: 'Este anúncio não pertence à conta conectada.' }, 422);
    }
    console.error('[api/ml/anuncio/desempenho] Falha ao carregar desempenho:', code || error);
    return json({ error: 'Não foi possível carregar o desempenho deste anúncio.' }, 503);
  }
}
