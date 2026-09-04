import { getSyncRuntimeConfigValue } from '@/lib/sync/runtime-config';
import type { SupplierLedgerMovementType } from '@/lib/supplier-ledger';

const ENABLED_KEY = 'bnt_d17_visual_review_enabled';
const DATA_KEY = 'bnt_d17_visual_review_credits';
const EXPECTED_SOURCE = 'production-read-only';
const EXPECTED_VERSION = 1;

export const SUPPLIER_CREDITS_VISUAL_REVIEW_BLOCK = {
  error: 'Amostra protegida de homologação: nenhuma movimentação financeira foi realizada.',
  code: 'homologation_fixture_read_only',
} as const;

export type SupplierCreditsSummary = {
  available: number;
  pending: number;
  used_month: number;
  suppliers_with_pending: number;
};

export type SupplierCreditPosition = {
  fornecedor_id: string;
  fornecedor_nome: string;
  ativo: boolean;
  status_dslite: string | null;
  available: number;
  pending: number;
  used_month: number;
  last_movement_at: string | null;
  pending_count: number;
  movement_count: number;
  read_only: boolean;
  isHomologationFixture?: true;
};

export type SupplierCreditMovement = {
  id: string;
  fornecedor_id: string;
  fornecedor_nome: string | null;
  movement_type: SupplierLedgerMovementType;
  amount: number;
  reference: string | null;
  notes: string | null;
  status: string;
  source: string | null;
  ml_order_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  isHomologationFixture?: true;
};

type SupplierCreditsVisualReviewPayload = {
  version: number;
  source: string;
  capturedAt: string;
  expiresAt: string;
  summary: SupplierCreditsSummary;
  suppliers: SupplierCreditPosition[];
  movements: SupplierCreditMovement[];
};

export type SupplierCreditsVisualReview = Omit<SupplierCreditsVisualReviewPayload, 'version' | 'source'> & {
  metadata: {
    enabled: true;
    source: 'production-read-only';
    capturedAt: string;
    expiresAt: string;
    supplierCount: number;
    movementCount: number;
  };
};

function isEnabled(raw: string | null) {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === '"true"';
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDate(value: unknown, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isSummary(value: unknown): value is SupplierCreditsSummary {
  if (!value || typeof value !== 'object') return false;
  const summary = value as SupplierCreditsSummary;
  return isFiniteNumber(summary.available)
    && isFiniteNumber(summary.pending)
    && isFiniteNumber(summary.used_month)
    && Number.isInteger(summary.suppliers_with_pending)
    && summary.suppliers_with_pending >= 0;
}

function isSupplier(value: unknown): value is SupplierCreditPosition {
  if (!value || typeof value !== 'object') return false;
  const supplier = value as SupplierCreditPosition;
  return supplier.isHomologationFixture === true
    && typeof supplier.fornecedor_id === 'string'
    && supplier.fornecedor_id.startsWith('bnt-d17-')
    && typeof supplier.fornecedor_nome === 'string'
    && Boolean(supplier.fornecedor_nome.trim())
    && typeof supplier.ativo === 'boolean'
    && (supplier.status_dslite === null || typeof supplier.status_dslite === 'string')
    && isFiniteNumber(supplier.available)
    && isFiniteNumber(supplier.pending)
    && isFiniteNumber(supplier.used_month)
    && isIsoDate(supplier.last_movement_at, true)
    && Number.isInteger(supplier.pending_count)
    && supplier.pending_count >= 0
    && Number.isInteger(supplier.movement_count)
    && supplier.movement_count >= 0
    && typeof supplier.read_only === 'boolean';
}

function isMovement(value: unknown, supplierIds: Set<string>): value is SupplierCreditMovement {
  if (!value || typeof value !== 'object') return false;
  const movement = value as SupplierCreditMovement;
  return movement.isHomologationFixture === true
    && typeof movement.id === 'string'
    && movement.id.startsWith('bnt-d17-movement-')
    && supplierIds.has(movement.fornecedor_id)
    && (movement.fornecedor_nome === null || typeof movement.fornecedor_nome === 'string')
    && [
      'topup',
      'purchase_debit',
      'adjustment',
      'manual_credit',
      'cancellation_credit',
      'credit_usage',
    ].includes(movement.movement_type)
    && isFiniteNumber(movement.amount)
    && (movement.reference === null || typeof movement.reference === 'string')
    && (movement.notes === null || typeof movement.notes === 'string')
    && ['pending', 'confirmed', 'rejected', 'voided'].includes(movement.status)
    && (movement.source === null || typeof movement.source === 'string')
    && movement.ml_order_id === null
    && isIsoDate(movement.created_at)
    && isIsoDate(movement.confirmed_at, true)
    && (movement.confirmed_by === null || typeof movement.confirmed_by === 'string');
}

export async function loadSupplierCreditsVisualReview(): Promise<SupplierCreditsVisualReview | null> {
  const enabled = await getSyncRuntimeConfigValue(ENABLED_KEY);
  if (!isEnabled(enabled)) return null;

  const raw = await getSyncRuntimeConfigValue(DATA_KEY);
  if (!raw) return null;

  let payload: SupplierCreditsVisualReviewPayload;
  try {
    payload = JSON.parse(raw) as SupplierCreditsVisualReviewPayload;
  } catch {
    return null;
  }

  const supplierIds = new Set(
    Array.isArray(payload.suppliers) ? payload.suppliers.map((supplier) => supplier.fornecedor_id) : [],
  );
  const movementIds = Array.isArray(payload.movements)
    ? payload.movements.map((movement) => movement.id)
    : [];

  if (
    payload.version !== EXPECTED_VERSION
    || payload.source !== EXPECTED_SOURCE
    || !isIsoDate(payload.capturedAt)
    || !isIsoDate(payload.expiresAt)
    || Date.parse(payload.expiresAt) <= Date.now()
    || !isSummary(payload.summary)
    || !Array.isArray(payload.suppliers)
    || payload.suppliers.length === 0
    || payload.suppliers.length > 20
    || !payload.suppliers.every(isSupplier)
    || supplierIds.size !== payload.suppliers.length
    || !Array.isArray(payload.movements)
    || payload.movements.length === 0
    || payload.movements.length > 1200
    || !payload.movements.every((movement) => isMovement(movement, supplierIds))
    || new Set(movementIds).size !== movementIds.length
  ) {
    return null;
  }

  return {
    capturedAt: payload.capturedAt,
    expiresAt: payload.expiresAt,
    summary: payload.summary,
    suppliers: payload.suppliers,
    movements: payload.movements,
    metadata: {
      enabled: true,
      source: EXPECTED_SOURCE,
      capturedAt: payload.capturedAt,
      expiresAt: payload.expiresAt,
      supplierCount: payload.suppliers.length,
      movementCount: payload.movements.length,
    },
  };
}

export function listPendingSupplierCreditMovements(movements: SupplierCreditMovement[]) {
  return movements
    .filter((movement) => movement.status === 'pending' && movement.amount > 0)
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}
