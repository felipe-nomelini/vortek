import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { requestIncomingNfeManifestation } from '@/lib/fiscal/incoming-nfe';

const schema = z.object({
  tipo: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  justificativa: z.string().trim().max(255).optional(),
  confirmar: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
}).superRefine((value, context) => {
  if (value.tipo === 4 && (!value.justificativa || value.justificativa.length < 15)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['justificativa'], message: 'Informe uma justificativa entre 15 e 255 caracteres.' });
  }
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'fiscal.manage');
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Manifestação inválida.' }, { status: 400 });
  try {
    const result = await requestIncomingNfeManifestation({
      receiptId: (await props.params).id,
      type: parsed.data.tipo,
      justification: parsed.data.justificativa,
      idempotencyKey: parsed.data.idempotencyKey,
      userId: auth.userId,
    });
    if (result.manifestation?.status === 'falha') {
      return NextResponse.json({ error: result.manifestation.motivo || 'A manifestação foi rejeitada.' }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    const message = error?.message === 'homologation_fixture_read_only'
      ? 'Amostras de homologação não permitem eventos fiscais.'
      : error?.message || 'Falha ao enviar manifestação.';
    return NextResponse.json({ error: message }, { status: error?.message === 'homologation_fixture_read_only' ? 409 : 502 });
  }
}
