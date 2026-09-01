import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { extractNfeAccessKey } from '@/lib/estoque-nfe';
import {
  findStockReceiptByKey,
  saveStockReceiptFromXml,
} from '@/lib/estoque-recebimento';
import {
  buscarNotaEntradaBrasilNfe,
  obterXmlEntradaBrasilNfe,
} from '@/services/fiscal-provider';

const bodySchema = z.object({
  chave: z.string().max(500),
  xml: z.string().max(3_000_000).optional(),
});

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'inventory.manage');
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Informe a chave ou o XML da NF-e.' }, { status: 400 });
  const chave = extractNfeAccessKey(parsed.data.chave);
  if (!chave) return NextResponse.json({ error: 'Chave de NF-e inválida.' }, { status: 400 });

  try {
    const existing = await findStockReceiptByKey(chave);
    if (existing) return NextResponse.json({ receipt: existing, existing: true });

    let xml = parsed.data.xml?.trim() || null;
    let source: 'brasilnfe' | 'upload' = 'upload';
    if (!xml) {
      const note = await buscarNotaEntradaBrasilNfe(chave);
      if (!note) {
        return NextResponse.json({
          error: 'A NF-e ainda não está disponível na Brasil NFe.',
          code: 'incoming_nfe_not_found',
          canManifest: true,
        }, { status: 409 });
      }
      if (note.status !== 1) {
        return NextResponse.json({ error: 'A NF-e de entrada não está autorizada para recebimento.' }, { status: 409 });
      }
      try {
        xml = await obterXmlEntradaBrasilNfe(chave);
      } catch (error: any) {
        console.error('[stock_receipt_xml_lookup_failed]', { chaveSuffix: chave.slice(-6), error: error?.message || error });
      }
      if (!xml) {
        return NextResponse.json({
          error: 'O XML ainda não foi liberado pela Brasil NFe.',
          code: 'incoming_nfe_xml_unavailable',
          canManifest: true,
        }, { status: 409 });
      }
      source = 'brasilnfe';
    }

    const receipt = await saveStockReceiptFromXml({ xml, chave, source, userId: auth.userId });
    return NextResponse.json({ receipt, existing: false }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Falha ao importar a NF-e.' }, { status: 422 });
  }
}
