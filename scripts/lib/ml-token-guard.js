const DEFAULT_ALLOWED_USER_IDS = '3294514937';
const DEFAULT_ALLOWED_NICKNAMES = 'VORTEK';

function allowedUserIds() {
  return String(process.env.ML_ALLOWED_USER_IDS || DEFAULT_ALLOWED_USER_IDS)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function allowedNicknames() {
  return String(process.env.ML_ALLOWED_NICKNAMES || DEFAULT_ALLOWED_NICKNAMES)
    .split(',')
    .map((nickname) => nickname.trim().toUpperCase())
    .filter(Boolean);
}

async function validateMercadoLivreTokenOwner(accessToken) {
  if (!accessToken) return { ok: false, userId: null, nickname: null, error: 'access_token_empty' };

  const res = await fetch('https://api.mercadolibre.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => null);
  const userId = data?.id ? String(data.id) : null;
  const nickname = data?.nickname ? String(data.nickname) : null;
  const nicknameUpper = nickname ? nickname.toUpperCase() : null;

  if (!res.ok) {
    return { ok: false, userId, nickname, error: data?.error || data?.message || `users_me_http_${res.status}` };
  }

  const ok = Boolean(
    (userId && allowedUserIds().includes(userId)) ||
    (nicknameUpper && allowedNicknames().includes(nicknameUpper))
  );

  return {
    ok,
    userId,
    nickname,
    error: ok ? null : `ml_account_not_allowed:${nickname || userId || 'unknown'}`,
  };
}

async function assertAllowedMercadoLivreToken(accessToken, source = 'script') {
  const account = await validateMercadoLivreTokenOwner(accessToken);
  if (account.ok) return account;

  const identity = account.nickname || account.userId || account.error || 'desconhecida';
  console.error(JSON.stringify({
    event: 'ml_account_not_allowed',
    source,
    user_id: account.userId,
    nickname: account.nickname,
    error: account.error,
    timestamp_utc: new Date().toISOString(),
  }));
  throw new Error(`Conta Mercado Livre não permitida: ${identity}`);
}

module.exports = {
  assertAllowedMercadoLivreToken,
  validateMercadoLivreTokenOwner,
};

