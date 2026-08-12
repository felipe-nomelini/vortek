export const ML_ALLOWED_USER_IDS: readonly string[] = ['3294514937'];

export type MercadoLivreWebhookUserValidation =
  | { allowed: true; userId: string; reason: 'allowed' }
  | { allowed: false; userId: null; reason: 'user_id_missing' }
  | { allowed: false; userId: string; reason: 'user_id_not_allowed' };

export function validateMercadoLivreWebhookUser(userId: unknown): MercadoLivreWebhookUserValidation {
  const normalizedUserId = String(userId ?? '').trim();
  if (!normalizedUserId) {
    return { allowed: false, userId: null, reason: 'user_id_missing' };
  }
  if (!ML_ALLOWED_USER_IDS.includes(normalizedUserId)) {
    return { allowed: false, userId: normalizedUserId, reason: 'user_id_not_allowed' };
  }
  return { allowed: true, userId: normalizedUserId, reason: 'allowed' };
}

export type MercadoLivreAccountValidation = {
  ok: boolean;
  userId: string | null;
  nickname: string | null;
  error: string | null;
  reason:
    | 'allowed'
    | 'token_missing'
    | 'token_invalid'
    | 'provider_error'
    | 'account_not_allowed';
};

export async function validateMercadoLivreTokenOwner(accessToken: string): Promise<MercadoLivreAccountValidation> {
  if (!accessToken) {
    return {
      ok: false,
      userId: null,
      nickname: null,
      error: 'access_token_empty',
      reason: 'token_missing',
    };
  }

  let res: Response;
  try {
    res = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error: any) {
    return {
      ok: false,
      userId: null,
      nickname: null,
      error: error?.message || 'users_me_network_error',
      reason: 'provider_error',
    };
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = data?.error || data?.message || `users_me_http_${res.status}`;
    const normalizedError = String(error).trim().toLowerCase();
    return {
      ok: false,
      userId: data?.id ? String(data.id) : null,
      nickname: data?.nickname ? String(data.nickname) : null,
      error,
      reason:
        res.status === 401 || normalizedError.includes('invalid access token')
          ? 'token_invalid'
          : 'provider_error',
    };
  }

  const userId = data?.id ? String(data.id) : null;
  const nickname = data?.nickname ? String(data.nickname) : null;
  const allowedById = Boolean(userId && ML_ALLOWED_USER_IDS.includes(userId));

  if (!allowedById) {
    return {
      ok: false,
      userId,
      nickname,
      error: `ml_account_not_allowed:${nickname || userId || 'unknown'}`,
      reason: 'account_not_allowed',
    };
  }

  return { ok: true, userId, nickname, error: null, reason: 'allowed' };
}
