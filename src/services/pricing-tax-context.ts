import { createServiceClient } from '@/lib/supabase';
import {
  buildPricingTaxContext,
  type PricingTaxContext,
} from '@/services/pricing';

const DEFAULT_ACTIVITY_START_DATE = '2026-03-23';

type ServiceClientLike = ReturnType<typeof createServiceClient>;

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthsBetween(start: Date, end: Date): number {
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12
    + end.getUTCMonth() - start.getUTCMonth();
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}


export async function loadPricingTaxContext(
  client: ServiceClientLike = createServiceClient(),
  referenceDate = new Date(),
): Promise<PricingTaxContext> {
  const { data: config, error: configError } = await client
    .from('configuracoes')
    .select('simples_inicio_atividade,simples_aliquota_confirmada,simples_aliquota_confirmada_em')
    .maybeSingle();
  if (configError) throw new Error(`Falha ao carregar configuração tributária: ${configError.message}`);

  const activityStartDate = String((config as any)?.simples_inicio_atividade || DEFAULT_ACTIVITY_START_DATE);
  const referenceMonth = monthStart(referenceDate);
  const activityStart = monthStart(new Date(`${activityStartDate}T00:00:00.000Z`));
  const activityMonthIndex = monthsBetween(activityStart, referenceMonth);
  const periodStart = activityMonthIndex <= 11 ? activityStart : addMonths(referenceMonth, -12);
  const periodEnd = addMonths(referenceMonth, 1);
  const { data, error } = await client.rpc('get_pricing_monthly_revenue' as any, {
    p_period_start: dateOnly(periodStart),
    p_period_end: dateOnly(periodEnd),
  } as any);
  if (error) throw new Error(`Falha ao estimar faturamento da precificação: ${error.message}`);

  return buildPricingTaxContext({
    activityStartDate,
    referenceDate,
    monthlyRevenue: ((data || []) as any[]).map((row) => ({
      month: String(row.revenue_month),
      revenue: Number(row.gross_revenue || 0),
    })),
    confirmedRate: (config as any)?.simples_aliquota_confirmada ?? null,
  });
}

export function requirePricingTaxRate(context: PricingTaxContext): number {
  if (context.appliedRate === null) {
    throw new Error(context.warning || 'Alíquota tributária indisponível para precificação');
  }
  return context.appliedRate;
}

export type { PricingTaxContext } from '@/services/pricing';
