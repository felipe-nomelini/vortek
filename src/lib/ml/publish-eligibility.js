const NON_MODIFIABLE_ML_STATUSES = new Set(['under_review', 'closed', 'inactive']);
const NON_MODIFIABLE_BLOCK_PREFIX = 'non_modifiable_status:';

/**
 * @typedef {{
 *   eligible: boolean;
 *   kind: 'modifiable' | 'temporarily_blocked' | 'terminally_blocked' | 'unknown';
 *   reason: string | null;
 *   observedStatus: string | null;
 *   retryAt: string | null;
 * }} MlPublishEligibility
 */

/** @param {unknown} status */
export function isModifiableMlListingStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'paused';
}

/** @param {unknown} status */
export function mlNonModifiableBlockReason(status) {
  const normalized = String(status || 'unknown').trim().toLowerCase() || 'unknown';
  return `${NON_MODIFIABLE_BLOCK_PREFIX}${normalized}`;
}

/**
 * @param {{
 *   observedStatus?: unknown;
 *   blockReason?: unknown;
 *   blockedUntil?: unknown;
 *   deleteListing?: boolean;
 *   now?: Date;
 * }} params
 * @returns {MlPublishEligibility}
 */
export function classifyMlPublishEligibility(params) {
  const observedStatus = String(params.observedStatus || '').trim().toLowerCase() || null;
  const blockReason = String(params.blockReason || '').trim() || null;
  const blockedUntil = String(params.blockedUntil || '').trim() || null;

  if (params.deleteListing === true) {
    return {
      eligible: true,
      kind: 'modifiable',
      reason: 'delete_listing',
      observedStatus,
      retryAt: null,
    };
  }

  if (observedStatus && NON_MODIFIABLE_ML_STATUSES.has(observedStatus)) {
    return {
      eligible: false,
      kind: 'terminally_blocked',
      reason: mlNonModifiableBlockReason(observedStatus),
      observedStatus,
      retryAt: null,
    };
  }

  if (blockReason?.toLowerCase().startsWith(NON_MODIFIABLE_BLOCK_PREFIX)) {
    return {
      eligible: false,
      kind: 'terminally_blocked',
      reason: blockReason,
      observedStatus,
      retryAt: null,
    };
  }

  const blockedUntilMs = blockedUntil ? new Date(blockedUntil).getTime() : Number.NaN;
  if (Number.isFinite(blockedUntilMs) && blockedUntilMs > (params.now || new Date()).getTime()) {
    return {
      eligible: false,
      kind: 'temporarily_blocked',
      reason: blockReason || 'ml_sync_cooldown',
      observedStatus,
      retryAt: new Date(blockedUntilMs).toISOString(),
    };
  }

  if (observedStatus && isModifiableMlListingStatus(observedStatus)) {
    return {
      eligible: true,
      kind: 'modifiable',
      reason: null,
      observedStatus,
      retryAt: null,
    };
  }

  return {
    eligible: true,
    kind: 'unknown',
    reason: null,
    observedStatus,
    retryAt: null,
  };
}

/**
 * @param {unknown} observedStatus
 * @param {{
 *   ml_sync_block_reason?: string | null;
 *   ml_sync_blocked_until?: string | null;
 *   ml_sync_last_error?: string | null;
 * }} current
 * @returns {{
 *   ml_sync_block_reason?: string | null;
 *   ml_sync_blocked_until?: string | null;
 *   ml_sync_last_error?: string | null;
 * }}
 */
export function resolveMlPublishBlockPatch(observedStatus, current) {
  const normalizedStatus = String(observedStatus || '').trim().toLowerCase();
  const eligibility = classifyMlPublishEligibility({ observedStatus: normalizedStatus });
  const patch = {};

  if (eligibility.kind === 'terminally_blocked') {
    const blockReason = mlNonModifiableBlockReason(normalizedStatus);
    const lastError = `Estado observado no Mercado Livre não aceita publicação comum: ${normalizedStatus}`;
    if (current.ml_sync_block_reason !== blockReason) patch.ml_sync_block_reason = blockReason;
    if (current.ml_sync_blocked_until !== null) patch.ml_sync_blocked_until = null;
    if (current.ml_sync_last_error !== lastError) patch.ml_sync_last_error = lastError;
  } else if (eligibility.kind === 'modifiable') {
    if (current.ml_sync_block_reason !== null) patch.ml_sync_block_reason = null;
    if (current.ml_sync_blocked_until !== null) patch.ml_sync_blocked_until = null;
    if (current.ml_sync_last_error !== null) patch.ml_sync_last_error = null;
  }

  return patch;
}

/**
 * @param {{
 *   status?: number | null;
 *   code?: string | null;
 *   category?: 'expected_operational' | 'retryable' | 'auth_fatal' | 'error' | null;
 *   error?: string;
 * }} operation
 * @returns {{
 *   kind: 'retryable' | 'non_modifiable' | 'auth_terminal' | 'terminal' | 'unknown';
 *   retryConflict: boolean;
 * }}
 */
export function classifyMlPublishFailure(operation) {
  const status = Number(operation.status || 0) || null;
  const raw = `${operation.code || ''} ${operation.error || ''}`.toLowerCase();
  const mentionsNonModifiableState = raw.includes('status:closed')
    || raw.includes('status:under_review')
    || raw.includes('status:inactive')
    || raw.includes('deleted')
    || raw.includes('forbidden');
  const nonModifiable = mentionsNonModifiableState
    && (raw.includes('field_not_updatable') || raw.includes('cannot update item'));
  if (nonModifiable) return { kind: 'non_modifiable', retryConflict: false };

  const retryConflict = status === 409 || raw.includes('optimistic') || raw.includes('conflict');
  if (
    operation.category === 'retryable'
    || [408, 409, 424, 429, 500, 502, 503, 504].includes(status || 0)
    || raw.includes('network')
    || raw.includes('timeout')
  ) {
    return { kind: 'retryable', retryConflict };
  }

  if (
    operation.category === 'auth_fatal'
    || status === 401
    || raw.includes('not authorized')
    || raw.includes('unauthorized')
    || raw.includes('caller is not authorized')
    || raw.includes('access this resource')
  ) {
    return { kind: 'auth_terminal', retryConflict: false };
  }

  const deterministicLocalFailure = raw.includes('mapping_required')
    || raw.includes('version_missing')
    || raw.includes('reconcile_mismatch')
    || raw.includes('inválido')
    || raw.includes('ausente no outbox');
  if (deterministicLocalFailure || [400, 403, 404, 405, 412, 415, 422].includes(status || 0)) {
    return { kind: 'terminal', retryConflict: false };
  }

  return { kind: 'unknown', retryConflict: false };
}
