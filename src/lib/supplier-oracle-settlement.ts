import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';

export type SupplierOracleTransition = {
  id: string;
  status: 'prepared' | 'confirmed' | 'cancelled';
  version: number;
  replayed: boolean;
};

export function supplierOracleWritesEnabled(): boolean {
  if (process.env.ORACULO_SETTLEMENT_WRITES_ENABLED === 'false') return false;
  return process.env.NODE_ENV === 'production'
    || process.env.ORACULO_SETTLEMENT_WRITES_ENABLED === 'true';
}

export function supplierOracleBatchMode(): 'disabled' | 'canary' | 'enabled' {
  if (!supplierOracleWritesEnabled()) return 'disabled';
  const mode = process.env.ORACULO_SETTLEMENT_BATCH_MODE;
  if (mode === 'disabled' || mode === 'canary' || mode === 'enabled') return mode;
  return process.env.NODE_ENV === 'production' ? 'enabled' : 'disabled';
}

export function supplierOracleBatchAllowed(supplierId: string): boolean {
  const mode = supplierOracleBatchMode();
  if (mode === 'enabled') return true;
  return mode === 'canary' && /^[0-9]{1,20}$/.test(process.env.ORACULO_SETTLEMENT_CANARY_SUPPLIER_ID || '')
    && supplierId === process.env.ORACULO_SETTLEMENT_CANARY_SUPPLIER_ID;
}

export function supplierOracleDisabledResponse() {
  return NextResponse.json({ error: 'Liquidação consolidada ainda não ativada' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

export function supplierOracleFingerprint(input: {
  supplierId: string;
  purchaseIds: string[];
  creditCents: number;
}): string {
  return createHash('sha256').update(JSON.stringify({
    supplierId: input.supplierId,
    purchaseIds: [...input.purchaseIds].sort(),
    creditCents: input.creditCents,
  })).digest('hex');
}

export function supplierOracleRpcError(error: { code?: string; message?: string }) {
  const status = error.code === 'P0002' ? 404
    : error.code === '22023' ? 422
      : ['P0001', '23505', '23514'].includes(error.code || '') ? 409 : 500;
  return NextResponse.json({ error: status === 500 ? 'Falha na operação da liquidação'
    : error.message || 'Liquidação não pôde ser alterada' },
  { status, headers: { 'Cache-Control': 'no-store' } });
}

export function maskSupplierFinancialValue(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}
