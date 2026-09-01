import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { extractNfeAccessKey } from '@/lib/estoque-nfe';
import { requestIncomingNfeManifestation } from '@/lib/fiscal/incoming-nfe';

const schema = z.object({
  chave: z.string().max(500),
  confirmar: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Confirme explicitamente a manifestação.' }, { status: 400 });
  const chave = extractNfeAccessKey(parsed.data.chave);
  if (!chave) return NextResponse.json({ error: 'Chave de NF-e inválida.' }, { status: 400 });

  try {
    const result = await requestIncomingNfeManifestation({
      chave,
      type: 2,
      idempotencyKey: parsed.data.idempotencyKey || `stock-science:${chave}`,
      userId: auth.userId,
    });
    if (result.manifestation?.status === 'falha') {
      return NextResponse.json({ error: result.manifestation.motivo || 'A manifestação foi rejeitada.' }, { status: 422 });
    }
    const pending = result.manifestation?.status === 'aguardando_processamento';
    return NextResponse.json({
      success: true,
      pending,
      message: pending
        ? 'Ciência enviada e aguardando processamento. Tente obter o XML novamente depois.'
        : 'Ciência da operação registrada. Tente obter o XML novamente.',
    });
  } catch (error: any) {
    const message = error?.message === 'homologation_fixture_read_only'
      ? 'Amostras de homologação não permitem eventos fiscais.'
      : error?.message || 'Falha ao manifestar ciência da NF-e.';
    return NextResponse.json({ error: message }, { status: error?.message === 'homologation_fixture_read_only' ? 409 : 502 });
  }
}
