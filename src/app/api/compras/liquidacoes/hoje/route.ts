import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { isValidCnpj, normalizeCnpj } from '@/lib/fiscal/cnpj.js';
import { canUseHomologationFixtures, isHomologationFixtureId, isHomologationFixtureSource } from '@/lib/homologation-fixture';
import { evaluateSupplierOracleEligibility, oracleExclusionLabels } from '@/lib/supplier-oracle-eligibility';
import { maskSupplierFinancialValue, supplierOracleBatchAllowed, supplierOracleBatchMode, supplierOracleWritesEnabled } from '@/lib/supplier-oracle-settlement';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const writerAllowed = supplierOracleWritesEnabled()
    && (await authorizeApiRequest(request, 'purchases.payment.confirm')).ok;
  const client = createServiceClient();
  const { data: suppliers, error: supplierError } = await client.from('fornecedores')
    .select('id,dslite_id,apelido,nome,cnpj,supplier_pix_key,ativo');
  if (supplierError) return NextResponse.json({ error: 'Falha ao consultar fornecedores' }, { status: 500 });
  const purchases: Array<{ id: string; dsid: string; data_criacao: string; fornecedor_id: string | null;
    supplier_payment_mode: string | null; supplier_payment_status: string | null;
    supplier_payment_amount: number | null; status: string; status_dslite: string;
    supplier_settlement_id: string | null }> = [];
  let lastId = '';
  while (true) {
    let query = client.from('compras')
      .select('id,dsid,data_criacao,fornecedor_id,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,status,status_dslite,supplier_settlement_id')
      .eq('supplier_payment_mode', 'prepaid_pix').eq('supplier_payment_status', 'pending')
      .order('id', { ascending: true }).limit(100);
    if (lastId) query = query.gt('id', lastId);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: 'Falha ao consultar compras pendentes' }, { status: 500 });
    purchases.push(...(data || []));
    if (!data?.length || data.length < 100) break;
    lastId = data[data.length - 1].id;
  }
  const visible = canUseHomologationFixtures() ? purchases : purchases.filter((row) => !isHomologationFixtureId(row.id));
  const sales = new Map<string, Array<{ id: string; numero: number; dslite_id: string | null; situacao: string | null;
    snapshot_source: string | null }>>();
  const allocated = new Set<string>();
  const openDivergences = new Set<string>();
  for (let index = 0; index < visible.length; index += 100) {
    const chunk = visible.slice(index, index + 100);
    const chunkDsids = [...new Set(chunk.map((row) => row.dsid).filter(Boolean))];
    const [saleResult, allocationResult, divergenceResult] = await Promise.all([
      chunkDsids.length ? client.from('pedidos')
        .select('id,numero,dslite_id,situacao,snapshot_source')
        .in('dslite_id', chunkDsids).or('ml_bundle_primary.eq.true,ml_bundle_primary.is.null')
        : Promise.resolve({ data: [], error: null }),
      client.from('supplier_settlement_items').select('compra_id').in('compra_id', chunk.map((row) => row.id)).is('released_at', null),
      client.from('supplier_cancellation_cases').select('compra_id').in('compra_id', chunk.map((row) => row.id)).eq('status', 'open'),
    ]);
    if (saleResult.error || allocationResult.error || divergenceResult.error) return NextResponse.json({ error: 'Falha ao consultar elegibilidade' }, { status: 500 });
    for (const sale of saleResult.data || []) {
      if (!canUseHomologationFixtures() && isHomologationFixtureSource(sale.snapshot_source)) continue;
      const key = String(sale.dslite_id || '');
      sales.set(key, [...(sales.get(key) || []), sale]);
    }
    for (const allocation of allocationResult.data || []) allocated.add(allocation.compra_id);
    for (const divergence of divergenceResult.data || []) openDivergences.add(divergence.compra_id);
  }
  const accounts = [];
  for (const supplier of suppliers || []) {
    const supplierId = String(supplier.dslite_id || '');
    const own = visible.filter((row) => row.fornecedor_id === supplierId);
    if (!own.length) continue;
    const cnpj = normalizeCnpj(supplier.cnpj);
    const pix = String(supplier.supplier_pix_key || '').trim();
    const accountValid = Boolean(supplier.ativo && isValidCnpj(cnpj) && pix &&
      (suppliers || []).filter((row) => normalizeCnpj(row.cnpj) === cnpj && String(row.supplier_pix_key || '').trim() === pix).length === 1);
    const rows = own.map((purchase) => {
      const linked = sales.get(String(purchase.dsid)) || [];
      const codes = evaluateSupplierOracleEligibility({ purchase, sales: linked,
        selectedSupplierDsliteId: supplierId, accountValid, hasActiveAllocation: allocated.has(purchase.id),
        hasOpenDivergence: openDivergences.has(purchase.id) });
      const labels = oracleExclusionLabels(codes);
      return { compraId: purchase.id, dsid: purchase.dsid, dataCriacao: purchase.data_criacao,
        pedidoNumero: linked.length === 1 ? linked[0].numero : null,
        valor: purchase.supplier_payment_amount,
        reasons: codes.map((code, i) => ({ code, label: labels[i] })) };
    }).sort((a, b) => a.dataCriacao.localeCompare(b.dataCriacao) || a.compraId.localeCompare(b.compraId));
    const included = rows.filter((row) => row.reasons.length === 0);
    const excluded = rows.filter((row) => row.reasons.length > 0);
    const totalBruto = Math.round(included.reduce((sum, row) => sum + Number(row.valor || 0), 0) * 100) / 100;
    const { data: available, error } = accountValid
      ? await client.rpc('supplier_oracle_credit_preview', { p_supplier_id: supplierId })
      : { data: 0, error: null };
    if (error) return NextResponse.json({ error: 'Falha ao consultar crédito' }, { status: 500 });
    const creditoDisponivel = Math.max(0, Math.round(Number(available || 0) * 100) / 100);
    accounts.push({ fornecedorId: supplierId, fornecedor: supplier.apelido || supplier.nome,
      cnpjMasked: maskSupplierFinancialValue(cnpj), pixKeyMasked: maskSupplierFinancialValue(pix),
      ...(writerAllowed ? { cnpj, pixKey: pix } : {}),
      valid: accountValid, canPrepare: writerAllowed && supplierOracleBatchAllowed(supplierId), included, excluded, totalBruto, creditoDisponivel,
      creditoSugerido: Math.min(creditoDisponivel, totalBruto) });
  }
  const knownSupplierIds = new Set((suppliers || []).map((supplier) => String(supplier.dslite_id || '')));
  const unassigned = visible.filter((row) => !knownSupplierIds.has(String(row.fornecedor_id || '')))
    .map((row) => ({ compraId: row.id, dsid: row.dsid,
      reasons: [{ code: 'supplier_not_found', label: 'Fornecedor não encontrado ou não identificado' }] }));
  return NextResponse.json({ data: accounts, unassigned, asOf: new Date().toISOString(), pendingCount: visible.length,
    writesEnabled: supplierOracleWritesEnabled(), batchMode: supplierOracleBatchMode() },
    { headers: { 'Cache-Control': 'no-store' } });
}
