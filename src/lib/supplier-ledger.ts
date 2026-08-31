export const SUPPLIER_LEDGER_MOVEMENT_TYPES = [
  'topup',
  'purchase_debit',
  'adjustment',
  'manual_credit',
  'cancellation_credit',
  'credit_usage',
] as const;

export type SupplierLedgerMovementType = (typeof SUPPLIER_LEDGER_MOVEMENT_TYPES)[number];

export const MANUAL_SUPPLIER_LEDGER_ACTIONS = [
  'manual_credit',
  'credit_usage',
  'adjustment_credit',
  'adjustment_debit',
] as const;

export type ManualSupplierLedgerAction = (typeof MANUAL_SUPPLIER_LEDGER_ACTIONS)[number];

const SUPPLIER_LEDGER_MOVEMENT_TYPE_SET = new Set<string>(SUPPLIER_LEDGER_MOVEMENT_TYPES);

export function isSupplierLedgerMovementType(value: unknown): value is SupplierLedgerMovementType {
  return typeof value === 'string' && SUPPLIER_LEDGER_MOVEMENT_TYPE_SET.has(value);
}

export function requireSupplierLedgerMovementType(value: unknown): SupplierLedgerMovementType {
  if (isSupplierLedgerMovementType(value)) return value;
  throw new Error('Tipo de movimentação inválido no ledger de fornecedores.');
}

export function resolveManualSupplierLedgerAction(action: ManualSupplierLedgerAction): {
  movementType: SupplierLedgerMovementType;
  amountSign: 1 | -1;
} {
  switch (action) {
    case 'manual_credit':
      return { movementType: 'manual_credit', amountSign: 1 };
    case 'credit_usage':
      return { movementType: 'credit_usage', amountSign: -1 };
    case 'adjustment_credit':
      return { movementType: 'adjustment', amountSign: 1 };
    case 'adjustment_debit':
      return { movementType: 'adjustment', amountSign: -1 };
    default: {
      const unsupportedAction: never = action;
      throw new Error(`Ação manual inválida: ${String(unsupportedAction)}`);
    }
  }
}
