export const SUPPLIER_RECEIPT_BUCKET = 'supplier-payment-receipts';
export const MAX_SUPPLIER_RECEIPT_BYTES = 10 * 1024 * 1024;

export function sniffSupplierReceipt(bytes: Buffer): { mime: string; extension: string } | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}
