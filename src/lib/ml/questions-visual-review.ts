import { getSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';

const ENABLED_KEY = 'bnt_d06_visual_review_enabled';
const QUESTIONS_KEY = 'bnt_d06_visual_review_questions';
const EXPECTED_SOURCE = 'production-read-only';
const EXPECTED_VERSION = 1;

export type QuestionVisualReviewItem = {
  id: number;
  itemId: string;
  anuncio: string;
  anuncioUrl: null;
  anuncioStatus: string | null;
  thumbnail: string | null;
  cliente: string;
  clienteId: null;
  pergunta: string;
  resposta: string | null;
  dataPergunta: string;
  dataResposta: string | null;
  status: string;
  mlStatus: string;
  respostaStatus: string | null;
  hold: boolean;
  removidaDoAnuncio: boolean;
  tags: string[];
  categoriasIa: string[];
  isHomologationFixture: true;
};

type QuestionVisualReviewPayload = {
  version: number;
  source: string;
  capturedAt: string;
  expiresAt: string;
  items: QuestionVisualReviewItem[];
};

export type QuestionVisualReview = {
  metadata: {
    enabled: true;
    source: 'production-read-only';
    capturedAt: string;
    expiresAt: string;
    itemCount: number;
    defaultStatus: 'respondida';
  };
  items: QuestionVisualReviewItem[];
};

function isEnabled(raw: string | null) {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === '"true"';
}

function isValidIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSafeItem(value: unknown): value is QuestionVisualReviewItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as QuestionVisualReviewItem;
  return item.isHomologationFixture === true
    && Number.isInteger(item.id)
    && item.id < 0
    && typeof item.itemId === 'string'
    && Boolean(item.itemId.trim())
    && typeof item.anuncio === 'string'
    && Boolean(item.anuncio.trim())
    && item.anuncioUrl === null
    && (item.anuncioStatus === null || typeof item.anuncioStatus === 'string')
    && (item.thumbnail === null || typeof item.thumbnail === 'string')
    && typeof item.cliente === 'string'
    && item.clienteId === null
    && isValidIsoDate(item.dataPergunta)
    && (item.dataResposta === null || isValidIsoDate(item.dataResposta))
    && typeof item.pergunta === 'string'
    && (item.resposta === null || typeof item.resposta === 'string')
    && typeof item.status === 'string'
    && typeof item.mlStatus === 'string'
    && typeof item.hold === 'boolean'
    && typeof item.removidaDoAnuncio === 'boolean'
    && Array.isArray(item.tags)
    && Array.isArray(item.categoriasIa);
}

export async function loadQuestionVisualReview(): Promise<QuestionVisualReview | null> {
  const enabled = await getSyncRuntimeConfigValue(ENABLED_KEY);
  if (!isEnabled(enabled)) return null;

  const raw = await getSyncRuntimeConfigValue(QUESTIONS_KEY);
  if (!raw) return null;

  let payload: QuestionVisualReviewPayload;
  try {
    payload = JSON.parse(raw) as QuestionVisualReviewPayload;
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;

  const ids = Array.isArray(payload.items) ? payload.items.map((item) => item.id) : [];
  if (
    payload.version !== EXPECTED_VERSION
    || payload.source !== EXPECTED_SOURCE
    || !isValidIsoDate(payload.capturedAt)
    || !isValidIsoDate(payload.expiresAt)
    || Date.parse(payload.expiresAt) <= Date.now()
    || !Array.isArray(payload.items)
    || payload.items.length === 0
    || payload.items.length > 100
    || !payload.items.every(isSafeItem)
    || new Set(ids).size !== ids.length
  ) {
    return null;
  }

  return {
    metadata: {
      enabled: true,
      source: EXPECTED_SOURCE,
      capturedAt: payload.capturedAt,
      expiresAt: payload.expiresAt,
      itemCount: payload.items.length,
      defaultStatus: 'respondida',
    },
    items: payload.items,
  };
}

export function listQuestionVisualReview(params: {
  review: QuestionVisualReview;
  requestedStatus: string;
  initialRequest: boolean;
  limit: number;
  offset: number;
}) {
  const effectiveStatus = params.initialRequest && params.requestedStatus === 'pendente'
    ? params.review.metadata.defaultStatus
    : params.requestedStatus;
  const filtered = effectiveStatus
    ? params.review.items.filter((item) => item.status === effectiveStatus)
    : params.review.items;
  const direction = effectiveStatus === 'pendente' ? 1 : -1;
  const sorted = [...filtered].sort((left, right) => (
    (Date.parse(left.dataPergunta) - Date.parse(right.dataPergunta)) * direction
  ));

  return {
    items: sorted.slice(params.offset, params.offset + params.limit),
    total: sorted.length,
    effectiveStatus,
  };
}
