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
};

export async function validateMercadoLivreTokenOwner(accessToken: string): Promise<MercadoLivreAccountValidation> {
  if (!accessToken) {
    return { ok: false, userId: null, nickname: null, error: 'access_token_empty' };
  }

  const res = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    return {
      ok: false,
      userId: data?.id ? String(data.id) : null,
      nickname: data?.nickname ? String(data.nickname) : null,
      error: data?.error || data?.message || `users_me_http_${res.status}`,
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
    };
  }

  return { ok: true, userId, nickname, error: null };
}
