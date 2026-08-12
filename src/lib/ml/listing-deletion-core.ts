export type MlItemState = {
  id?: string | null;
  status?: string | null;
  sub_status?: unknown;
};

function normalizeSubStatus(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function isDeleted(item: MlItemState | null | undefined): boolean {
  return normalizeSubStatus(item?.sub_status).includes('deleted');
}

function isUnderReviewForbidden(item: MlItemState): boolean {
  return String(item.status || '').trim().toLowerCase() === 'under_review'
    && normalizeSubStatus(item.sub_status).includes('forbidden');
}

export type MlRequestResult<T> = {
  ok: boolean;
  status: number | null;
  data: T | null;
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
};

export type MlRequest = <T>(
  path: string,
  options?: RequestInit,
) => Promise<MlRequestResult<T>>;

export type DeleteMlListingResult =
  | { ok: true; alreadyDeleted: boolean; item: MlItemState }
  | { ok: false; code: string; error: string; status: number | null };

async function defaultWait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Núcleo injetável usado pela aplicação e por rotinas operacionais. */
export async function deleteMlListingPermanentlyWith(
  request: MlRequest,
  itemId: string,
  wait: (ms: number) => Promise<void> = defaultWait,
): Promise<DeleteMlListingResult> {
  const normalizedItemId = String(itemId || '').trim();
  if (!normalizedItemId) {
    return { ok: false, code: 'ml_item_id_missing', error: 'ml_item_id ausente', status: null };
  }

  const path = `/items/${encodeURIComponent(normalizedItemId)}`;
  const current = await request<MlItemState>(path);
  if (!current.ok || !current.data) {
    return {
      ok: false,
      code: current.error?.code || 'ml_listing_read_failed',
      error: current.error?.message || 'Falha ao consultar anúncio antes da exclusão',
      status: current.status,
    };
  }

  if (isDeleted(current.data)) {
    return { ok: true, alreadyDeleted: true, item: current.data };
  }

  const status = String(current.data.status || '').trim().toLowerCase();
  if (status !== 'closed' && !isUnderReviewForbidden(current.data)) {
    const close = await request<MlItemState>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'closed' }),
    });
    if (!close.ok) {
      // Itens `inactive/under_review` podem rejeitar o fechamento, mas ainda
      // aceitam exclusão direta. A confirmação final continua obrigatória.
      if (!['inactive', 'under_review'].includes(status)) {
        return {
          ok: false,
          code: close.error?.code || 'ml_listing_close_failed',
          error: close.error?.message || 'Falha ao encerrar anúncio antes da exclusão',
          status: close.status,
        };
      }
    } else {
      await wait(900);
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const deletion = await request<MlItemState>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleted: true }),
    });
    if (deletion.ok) break;

    const lastDeleteError: DeleteMlListingResult = {
      ok: false,
      code: deletion.error?.code || 'ml_listing_delete_failed',
      error: deletion.error?.message || 'Falha ao excluir anúncio',
      status: deletion.status,
    };
    if (deletion.status !== 409 || attempt === 3) return lastDeleteError;
    await wait(attempt * 900);
  }

  const verified = await request<MlItemState>(path);
  if (!verified.ok || !verified.data) {
    return {
      ok: false,
      code: verified.error?.code || 'ml_listing_delete_verify_failed',
      error: verified.error?.message || 'Falha ao confirmar exclusão do anúncio',
      status: verified.status,
    };
  }
  if (!isDeleted(verified.data)) {
    return {
      ok: false,
      code: 'ml_listing_delete_not_effective',
      error: 'Mercado Livre não confirmou sub_status=deleted',
      status: verified.status,
    };
  }

  return { ok: true, alreadyDeleted: false, item: verified.data };
}
