import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { supplierOracleDisabledResponse, supplierOracleRpcError, supplierOracleWritesEnabled } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';
const BUCKET = 'supplier-payment-receipts';
const MAX_BYTES = 10 * 1024 * 1024;

function sniffReceipt(bytes: Buffer): { mime: string; extension: string } | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.payment.confirm');
  if (!auth.ok) return auth.response;
  if (!supplierOracleWritesEnabled()) return supplierOracleDisabledResponse();
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Liquidação inválida' }, { status: 422 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('receipt');
  const version = Number(form?.get('versaoEsperada'));
  if (!(file instanceof File) || !Number.isInteger(version) || version < 1 || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Comprovante ou versão inválidos' }, { status: 422 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniffReceipt(bytes);
  if (!kind) return NextResponse.json({ error: 'Use PDF, JPG, PNG ou WEBP' }, { status: 422 });
  const client = createServiceClient();
  const { data: settlement, error: readError } = await client.from('supplier_settlements')
    .select('status,version,receipt_path').eq('id', id).maybeSingle();
  if (readError) return NextResponse.json({ error: 'Falha ao consultar liquidação' }, { status: 500 });
  if (!settlement) return NextResponse.json({ error: 'Liquidação não encontrada' }, { status: 404 });
  if (settlement.status !== 'prepared' || settlement.receipt_path || settlement.version !== version) {
    return NextResponse.json({ error: 'Liquidação ou versão mudou; atualize antes de anexar' }, { status: 409 });
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const path = `liquidacoes/${id}/${hash}.${kind.extension}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(path, bytes,
    { contentType: kind.mime, upsert: false });
  if (uploadError) {
    if (String(uploadError.statusCode) !== '409') return NextResponse.json({ error: 'Falha ao salvar comprovante' }, { status: 500 });
    const { data: existing, error: downloadError } = await client.storage.from(BUCKET).download(path);
    if (downloadError || !existing || createHash('sha256').update(Buffer.from(await existing.arrayBuffer())).digest('hex') !== hash) {
      return NextResponse.json({ error: 'Comprovante existente não pôde ser conferido' }, { status: 409 });
    }
  }
  const { data, error } = await client.rpc('supplier_oracle_attach_receipt', {
    p_settlement_id: id, p_expected_version: version, p_path: path, p_actor: auth.userId,
  });
  if (error) return supplierOracleRpcError(error);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Liquidação inválida' }, { status: 422 });
  const client = createServiceClient();
  const { data, error } = await client.from('supplier_settlements').select('receipt_path').eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Falha ao consultar comprovante' }, { status: 500 });
  if (!data?.receipt_path) return NextResponse.json({ error: 'Comprovante não encontrado' }, { status: 404 });
  const { data: signed, error: signedError } = await client.storage.from(BUCKET).createSignedUrl(data.receipt_path, 60);
  if (signedError || !signed?.signedUrl) return NextResponse.json({ error: 'Comprovante indisponível' }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl, 302);
}
