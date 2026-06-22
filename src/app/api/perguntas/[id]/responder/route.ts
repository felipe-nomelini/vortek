import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchMLResult, getMLConnectionStatus } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const answerSchema = z.object({
  text: z.string().trim().min(1, 'Resposta obrigatória').max(2000, 'Resposta muito longa'),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const questionId = Number(params.id);
    if (!Number.isFinite(questionId) || questionId <= 0) {
      return NextResponse.json({ error: 'ID da pergunta inválido' }, { status: 400 });
    }

    const connection = await getMLConnectionStatus();
    if (!connection.conectado) {
      return NextResponse.json({
        error: connection.erro || 'Mercado Livre desconectado',
        precisaReconectar: true,
      }, { status: 401 });
    }

    const parsed = answerSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Resposta inválida' }, { status: 400 });
    }

    const current = await fetchMLResult<any>(`/questions/${questionId}`);
    if (!current.ok) {
      return NextResponse.json({
        error: current.error?.message || 'Pergunta não encontrada no Mercado Livre',
      }, { status: current.status || 502 });
    }

    if (current.data?.status === 'ANSWERED') {
      return NextResponse.json({ error: 'Pergunta já respondida no Mercado Livre' }, { status: 409 });
    }

    const answerResult = await fetchMLResult<any>('/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: questionId,
        text: parsed.data.text,
      }),
    });

    if (!answerResult.ok) {
      return NextResponse.json({
        error: answerResult.error?.message || 'Falha ao enviar resposta ao Mercado Livre',
        status: answerResult.status,
      }, { status: answerResult.status || 502 });
    }

    const updated = await fetchMLResult<any>(`/questions/${questionId}`);
    return NextResponse.json({
      ok: true,
      question: updated.ok ? updated.data : answerResult.data,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao responder pergunta' }, { status: 500 });
  }
}
