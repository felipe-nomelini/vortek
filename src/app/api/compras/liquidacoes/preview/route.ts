import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { createServiceClient } from '@/lib/supabase';
import { isValidCnpj, normalizeCnpj } from '@/lib/fiscal/cnpj.js';
import { canUseHomologationFixtures, isHomologationFixtureId, isHomologationFixtureSource } from '@/lib/homologation-fixture';
import { evaluateSupplierOracleEligibility, oracleExclusionLabels } from '@/lib/supplier-oracle-eligibility';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BATCH_SIZE = 100;

function mask(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'purchases.read');
  if (!auth.ok) return auth.response;
  const supplierDsliteId = new URL(request.url).searchParams.get('fornecedorId')?.trim() || '';
  if (!/^[0-9]{1,20}$/.test(supplierDsliteId)) {
    return NextResponse.json({ error: 'Selecione um fornecedor válido' }, { status: 422 });
  }
  const client = createServiceClient();
  const { data: suppliers, error: suppliersError } = await client.from('fornecedores')
    .select('id,dslite_id,apelido,nome,cnpj,supplier_pix_key,ativo');
  if (suppliersError) return NextResponse.json({ error: 'Falha ao consultar fornecedor' }, { status: 500 });
  const supplier = suppliers?.find((row) => String(row.dslite_id || '') === supplierDsliteId);
  if (!supplier) return NextResponse.json({ error: 'Fornecedor não encontrado' }, { status: 404 });
  const cnpj = normalizeCnpj(supplier.cnpj);
  const pixKey = String(supplier.supplier_pix_key || '').trim();
  const sameAccount = (suppliers || []).filter((row) => (
    normalizeCnpj(row.cnpj) === cnpj && String(row.supplier_pix_key || '').trim() === pixKey
  ));
  const accountValid = Boolean(supplier.ativo && /^[0-9]{14}$/.test(cnpj) && isValidCnpj(cnpj)
    && pixKey && sameAccount.length === 1);

  const purchases: Array<{
    id: string; dsid: string; data_criacao: string; fornecedor_id: string | null;
    supplier_payment_mode: string | null; supplier_payment_status: string | null;
    supplier_payment_amount: number | null; status: string; status_dslite: string;
    supplier_settlement_id: string | null;
  }> = [];
  let lastId = '';
  while (true) {
    let query = client.from('compras')
      .select('id,dsid,data_criacao,fornecedor_id,supplier_payment_mode,supplier_payment_status,supplier_payment_amount,status,status_dslite,supplier_settlement_id')
      .eq('fornecedor_id', supplierDsliteId).eq('supplier_payment_mode', 'prepaid_pix')
      .eq('supplier_payment_status', 'pending').order('id', { ascending: true }).limit(BATCH_SIZE);
    if (lastId) query = query.gt('id', lastId);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: 'Falha ao consultar compras pendentes' }, { status: 500 });
    purchases.push(...(data || []).filter((row): row is typeof row & { dsid: string } => Boolean(row.dsid)));
    if (!data?.length || data.length < BATCH_SIZE) break;
    lastId = data[data.length - 1].id;
  }

  const visible = canUseHomologationFixtures()
    ? purchases : purchases.filter((row) => !isHomologationFixtureId(row.id));
  const salesByDsliteId = new Map<string, Array<{
    id: string; numero: number; dslite_id: string | null; situacao: string | null; snapshot_source: string | null;
  }>>();
  const allocated = new Set<string>();
  const openDivergences = new Set<string>();
  for (let index = 0; index < visible.length; index += BATCH_SIZE) {
    const chunk = visible.slice(index, index + BATCH_SIZE);
    const dsids = [...new Set(chunk.map((row) => row.dsid).filter(Boolean))];
    const ids = chunk.map((row) => row.id);
    const [salesResult, allocationsResult, divergenceResult] = await Promise.all([
      dsids.length ? client.from('pedidos')
        .select('id,numero,dslite_id,situacao,snapshot_source')
        .in('dslite_id', dsids).or('ml_bundle_primary.eq.true,ml_bundle_primary.is.null') : Promise.resolve({ data: [], error: null }),
      client.from('supplier_settlement_items').select('compra_id').in('compra_id', ids).is('released_at', null),
      client.from('supplier_cancellation_cases').select('compra_id').in('compra_id', ids).eq('status', 'open'),
    ]);
    if (salesResult.error || allocationsResult.error || divergenceResult.error) {
      return NextResponse.json({ error: 'Falha ao consultar vínculos da elegibilidade' }, { status: 500 });
    }
    for (const sale of salesResult.data || []) {
      if (!canUseHomologationFixtures() && isHomologationFixtureSource(sale.snapshot_source)) continue;
      const key = String(sale.dslite_id || '');
      salesByDsliteId.set(key, [...(salesByDsliteId.get(key) || []), sale]);
    }
    for (const row of allocationsResult.data || []) allocated.add(row.compra_id);
    for (const row of divergenceResult.data || []) openDivergences.add(row.compra_id);
  }

  const rows = visible.map((purchase) => {
    const sales = salesByDsliteId.get(String(purchase.dsid)) || [];
    const codes = evaluateSupplierOracleEligibility({
      purchase,
      sales,
      selectedSupplierDsliteId: supplierDsliteId,
      accountValid,
      hasActiveAllocation: allocated.has(purchase.id),
      hasOpenDivergence: openDivergences.has(purchase.id),
    });
    const labels = oracleExclusionLabels(codes);
    return {
      compraId: purchase.id,
      dsid: purchase.dsid,
      dataCriacao: purchase.data_criacao,
      pedidoNumero: sales.length === 1 ? sales[0].numero : null,
      valor: purchase.supplier_payment_amount,
      reasons: codes.map((code, index) => ({ code, label: labels[index] })),
    };
  }).sort((a, b) => a.dataCriacao.localeCompare(b.dataCriacao) || a.compraId.localeCompare(b.compraId));
  const included = rows.filter((row) => row.reasons.length === 0);
  const excluded = rows.filter((row) => row.reasons.length > 0);
  const totalBruto = Math.round(included.reduce((sum, row) => sum + Number(row.valor || 0), 0) * 100) / 100;
  const { data: available, error: creditError } = accountValid
    ? await client.rpc('supplier_oracle_credit_preview', { p_supplier_id: supplierDsliteId })
    : { data: 0, error: null };
  if (creditError) return NextResponse.json({ error: 'Falha ao consultar crédito disponível' }, { status: 500 });
  const creditoDisponivel = Math.max(0, Math.round(Number(available || 0) * 100) / 100);
  return NextResponse.json({
    account: { fornecedorId: supplier.id, fornecedorDsliteId: supplierDsliteId,
      fornecedor: supplier.apelido || supplier.nome, cnpjMasked: mask(cnpj), pixKeyMasked: mask(pixKey), valid: accountValid },
    included, excluded, totalBruto, creditoDisponivel,
    creditoSugerido: Math.min(creditoDisponivel, totalBruto),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
