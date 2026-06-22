import { NextRequest, NextResponse } from 'next/server';
import { fetchMLResult, getMLConnectionStatus } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type MlQuestion = {
  id: number;
  item_id: string;
  seller_id: number;
  status: string;
  text: string;
  date_created: string;
  answer?: { text?: string; status?: string; date_created?: string } | null;
  from?: { id?: number; answered_questions?: number } | null;
  hold?: boolean;
  deleted_from_listing?: boolean;
  tags?: string[] | null;
  ai_categories?: string[] | null;
};

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value || '');
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function mapStatus(status: string | null) {
  if (status === 'pendente') return 'UNANSWERED';
  if (status === 'respondida') return 'ANSWERED';
  return '';
}

function normalizeQuestionStatus(status: string) {
  if (status === 'ANSWERED') return 'respondida';
  if (status === 'UNANSWERED') return 'pendente';
  return status.toLowerCase();
}

async function fetchItemMap(itemIds: string[]) {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
  const map = new Map<string, { title: string; permalink: string | null; thumbnail: string | null; status: string | null }>();

  for (let i = 0; i < uniqueIds.length; i += 20) {
    const ids = uniqueIds.slice(i, i + 20);
    const result = await fetchMLResult<Array<{ code: number; body?: any }>>(
      `/items?ids=${ids.map(encodeURIComponent).join(',')}&attributes=id,title,permalink,thumbnail,status`,
    );
    if (!result.ok || !Array.isArray(result.data)) continue;
    for (const item of result.data) {
      if (item.code !== 200 || !item.body?.id) continue;
      map.set(String(item.body.id), {
        title: String(item.body.title || item.body.id),
        permalink: item.body.permalink || null,
        thumbnail: item.body.thumbnail || null,
        status: item.body.status || null,
      });
    }
  }

  return map;
}

export async function GET(req: NextRequest) {
  try {
    const connection = await getMLConnectionStatus();
    if (!connection.conectado) {
      return NextResponse.json({
        error: connection.erro || 'Mercado Livre desconectado',
        precisaReconectar: true,
        items: [],
        total: 0,
      }, { status: 401 });
    }

    const meResult = await fetchMLResult<{ id: number }>('/users/me?attributes=id');
    if (!meResult.ok || !meResult.data?.id) {
      return NextResponse.json({ error: meResult.error?.message || 'Falha ao identificar vendedor ML' }, { status: 502 });
    }

    const search = req.nextUrl.searchParams;
    const limit = toPositiveInt(search.get('limit'), 50, 100);
    const offset = toPositiveInt(search.get('offset'), 0, 10000);
    const status = mapStatus(search.get('status'));

    const params = new URLSearchParams({
      seller_id: String(meResult.data.id),
      limit: String(limit),
      offset: String(offset),
      api_version: '4',
      sort_fields: 'date_created',
      sort_types: 'DESC',
    });
    if (status) params.set('status', status);

    const questionsResult = await fetchMLResult<{
      total?: number;
      limit?: number;
      questions?: MlQuestion[];
    }>(`/questions/search?${params.toString()}`);

    if (!questionsResult.ok) {
      return NextResponse.json({
        error: questionsResult.error?.message || 'Falha ao buscar perguntas no Mercado Livre',
        status: questionsResult.status,
      }, { status: questionsResult.status || 502 });
    }

    const questions = questionsResult.data?.questions || [];
    const items = await fetchItemMap(questions.map((question) => question.item_id));

    return NextResponse.json({
      total: questionsResult.data?.total || questions.length,
      limit,
      offset,
      items: questions.map((question) => {
        const item = items.get(question.item_id);
        return {
          id: question.id,
          itemId: question.item_id,
          anuncio: item?.title || question.item_id,
          anuncioUrl: item?.permalink || null,
          anuncioStatus: item?.status || null,
          cliente: question.from?.id ? `Usuário ${question.from.id}` : 'Cliente ML',
          clienteId: question.from?.id || null,
          pergunta: question.text,
          resposta: question.answer?.text || null,
          dataPergunta: question.date_created,
          dataResposta: question.answer?.date_created || null,
          status: normalizeQuestionStatus(question.status),
          mlStatus: question.status,
          respostaStatus: question.answer?.status || null,
          hold: Boolean(question.hold),
          removidaDoAnuncio: Boolean(question.deleted_from_listing),
          tags: question.tags || [],
          categoriasIa: question.ai_categories || [],
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Erro ao carregar perguntas' }, { status: 500 });
  }
}
