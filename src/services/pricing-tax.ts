export interface PricingTaxContext {
    rate: number | null;
    status: 'estimated' | 'confirmed' | 'unavailable';
    referenceMonth: string;
    source: string;
    observedAt: string;
    evidence: string | null;
    rbt12: number | null;
    missingMonths: string[];
}
const BRACKETS = [
    [180000, 0.04, 0], [360000, 0.073, 5940], [720000, 0.095, 13860],
    [1800000, 0.107, 22500], [3600000, 0.143, 87300],
];
export function estimateTaxForRbt12(rbt12: number): number | null {
    if (!Number.isFinite(rbt12) || rbt12 < 0)
        return null;
    const bracket = BRACKETS.find(([ceiling]) => rbt12 <= ceiling);
    return bracket ? rbt12 === 0 ? bracket[1] : (rbt12 * bracket[1] - bracket[2]) / rbt12 : null;
}
/** Anexo I até o sublimite suportado; acima exige contexto fiscal confirmado. */
export function buildPricingTaxContext(input: {
    activityStartDate: string;
    referenceMonth: string;
    monthlyRevenue: Array<{
        month: string;
        revenue: number;
    }>;
    observedAt: string;
    confirmed?: {
        month: string;
        rate: number;
        evidence: string;
    } | null;
}): PricingTaxContext {
    const base: PricingTaxContext = {
        rate: null, status: 'unavailable', referenceMonth: input.referenceMonth,
        source: 'RBT12_PEDIDOS_OPERACIONAIS', observedAt: input.observedAt,
        evidence: null, rbt12: null, missingMonths: [],
    };
    const confirmed = input.confirmed;
    if (confirmed?.month === input.referenceMonth && confirmed.evidence.trim()
        && Number.isFinite(confirmed.rate) && confirmed.rate >= 0 && confirmed.rate < 1) {
        return { ...base, rate: confirmed.rate, status: 'confirmed', source: 'APURACAO_HOMOLOGADA', evidence: confirmed.evidence };
    }
    if (!/^\d{4}-\d{2}$/.test(input.referenceMonth) || !/^\d{4}-\d{2}-\d{2}$/.test(input.activityStartDate))
        return base;
    const start = new Date(`${input.activityStartDate}T00:00:00Z`);
    const reference = new Date(`${input.referenceMonth}-01T00:00:00Z`);
    const age = (reference.getUTCFullYear() - start.getUTCFullYear()) * 12 + reference.getUTCMonth() - start.getUTCMonth();
    if (!Number.isFinite(age) || age < 0)
        return base;
    const months = age === 0 ? 1 : Math.min(age, 12);
    let revenue = 0;
    for (let index = 0; index < months; index++) {
        const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - (age === 0 ? 0 : index + 1), 1));
        const month = date.toISOString().slice(0, 7);
        const rows = input.monthlyRevenue.filter(row => row.month === month);
        if (rows.length !== 1 || !Number.isFinite(rows[0].revenue) || rows[0].revenue < 0)
            base.missingMonths.push(month);
        else
            revenue += rows[0].revenue;
    }
    // Ausência de mês não é receita zero. Não inventar uma alíquota.
    if (base.missingMonths.length)
        return base;
    const rbt12 = age < 12 ? revenue / months * 12 : revenue;
    const rate = estimateTaxForRbt12(rbt12);
    return { ...base, rbt12, rate, status: rate === null ? 'unavailable' : 'estimated' };
}
