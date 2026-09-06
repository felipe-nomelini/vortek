import { resolveWarranty, type WarrantyEvidence, type DurabilityEvidence } from '../lib/ml-sale-terms.ts';
/** Evidências explícitas no registro de auditoria existente, sem prazo inferido da marca. */
export async function loadProductWarranty(client: {from: (table: string) => any}, product: any, offer: any) {
  const result = await client.from('pricing_events').select('payload,created_at').eq('produto_id', product.id)
    .eq('event_type', 'WARRANTY_EVIDENCE_REGISTERED').order('created_at', {ascending:false}).limit(1).maybeSingle();
  if (result.error) throw new Error(`GARANTIA_EVIDENCIA_INDISPONIVEL: ${result.error.message}`);
  const payload = result.data?.payload ?? {};
  const evidence: WarrantyEvidence[] = [...(payload.evidence ?? [])];
  // Apenas declaração explícita de prazo na oferta vigente; jamais prazo genérico.
  const match = String(offer?.descricao ?? '').match(/garantia\s*(?:de\s*)?[:\-]?\s*(\d+)\s*(dias?|m[eê]s(?:es)?|anos?)/i);
  if (match && offer?.updated_at && !evidence.some(e => e.origin === 'GARANTIA_FORNECEDOR' && e.offerId === offer.id)) {
    const unit = /^dia/i.test(match[2]) ? 'dias' : /^ano/i.test(match[2]) ? 'anos' : 'meses';
    evidence.push({origin:'GARANTIA_FORNECEDOR',productId:product.id,gtin:product.gtin || null,offerId:offer.id,duration:Number(match[1]),unit,source:`produto_fornecedor_ofertas:${offer.id}:descricao`,observedAt:offer.updated_at});
  }
  return { resolution: resolveWarranty({productId:product.id,gtin:product.gtin || null,offerId:offer?.id ?? null,evidence,durability:payload.durability as DurabilityEvidence | undefined}), evidence, durability:payload.durability ?? null };
}
