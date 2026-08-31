const { buildPricingTaxContext } = require('../../src/services/pricing.ts');

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

async function loadPricingTaxRate(supabase, referenceDate = new Date()) {
  const { data: config, error: configError } = await supabase
    .from('configuracoes')
    .select('simples_inicio_atividade,simples_aliquota_confirmada')
    .maybeSingle();
  if (configError) throw new Error(`Falha ao carregar configuração tributária: ${configError.message}`);

  const activityStartDate = String(config?.simples_inicio_atividade || '2026-03-23');
  const periodStart = monthStart(new Date(`${activityStartDate}T00:00:00.000Z`));
  const periodEnd = addMonths(monthStart(referenceDate), 1);
  const { data, error } = await supabase.rpc('get_pricing_monthly_revenue', {
    p_period_start: periodStart.toISOString().slice(0, 10),
    p_period_end: periodEnd.toISOString().slice(0, 10),
  });
  if (error) throw new Error(`Falha ao estimar faturamento da precificação: ${error.message}`);

  const context = buildPricingTaxContext({
    activityStartDate,
    referenceDate,
    monthlyRevenue: (data || []).map((row) => ({
      month: String(row.revenue_month),
      revenue: Number(row.gross_revenue || 0),
    })),
    confirmedRate: config?.simples_aliquota_confirmada ?? null,
  });
  if (context.appliedRate === null) throw new Error(context.warning || 'Alíquota tributária indisponível');
  return { context, taxRate: context.appliedRate };
}

module.exports = { loadPricingTaxRate };
