export const ML_ALLOWED_USER_IDS = (process.env.ML_ALLOWED_USER_IDS || '3294514937')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

export const ML_ALLOWED_NICKNAMES = (process.env.ML_ALLOWED_NICKNAMES || 'VORTEK')
  .split(',')
  .map((nickname) => nickname.trim().toUpperCase())
  .filter(Boolean);

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
  const nicknameUpper = nickname ? nickname.toUpperCase() : null;
  const allowedById = Boolean(userId && ML_ALLOWED_USER_IDS.includes(userId));
  const allowedByNickname = Boolean(nicknameUpper && ML_ALLOWED_NICKNAMES.includes(nicknameUpper));

  if (!allowedById && !allowedByNickname) {
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
