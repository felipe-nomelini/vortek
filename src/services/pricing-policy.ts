/** Política comercial M2M. Taxas são frações; limites de preço são centavos. */
export interface PriceBand {
    id: 'BELOW_200' | 'FROM_200_TO_1000' | 'ABOVE_1000';
    maxCents: number | null;
    floor: number;
    target: number;
    limit: number;
}
export interface PricingPolicy {
    version: string;
    bands: PriceBand[];
    maxIterations: number;
    feeFallbackRate: number | null;
    evidenceMaxAgeHours: number;
    autonomy: 'REQUIRES_CONFIRMATION';
    radar: {
        mode: 'AUTO_OBSERVE';
        hour: number;
        batchSize: number;
        concurrency: number;
    };
}
export const PRICING_POLICY: PricingPolicy = {
    version: 'M2M-PRC-01-v1',
    bands: [
        { id: 'BELOW_200', maxCents: 20000, floor: 0.05, target: 0.07, limit: 0.10 },
        { id: 'FROM_200_TO_1000', maxCents: 100000, floor: 0.07, target: 0.10, limit: 0.15 },
        { id: 'ABOVE_1000', maxCents: null, floor: 0.10, target: 0.15, limit: 0.20 },
    ],
    maxIterations: 12,
    feeFallbackRate: 0.15,
    evidenceMaxAgeHours: 24,
    autonomy: 'REQUIRES_CONFIRMATION',
    radar: { mode: 'AUTO_OBSERVE', hour: 2, batchSize: 50, concurrency: 4 },
};
export function priceBand(price: number, policy: PricingPolicy = PRICING_POLICY): PriceBand | null {
    if (!Number.isFinite(price) || price <= 0)
        return null;
    const cents = Math.round(price * 100);
    if (cents <= 0)
        return null;
    return policy.bands.find(band => band.maxCents === null || cents <= band.maxCents) ?? null;
}
export function validatePricingPolicy(value: unknown): PricingPolicy {
    const p = value as PricingPolicy;
    if (!p || !p.version || !Array.isArray(p.bands) || p.bands.length !== 3
        || p.autonomy !== 'REQUIRES_CONFIRMATION' || p.radar?.mode !== 'AUTO_OBSERVE'
        || !Number.isInteger(p.maxIterations) || p.maxIterations < 1 || p.maxIterations > 12
        || !Number.isFinite(p.evidenceMaxAgeHours) || p.evidenceMaxAgeHours <= 0 || p.evidenceMaxAgeHours > 24
        || !Number.isInteger(p.radar.hour) || p.radar.hour < 0 || p.radar.hour > 23
        || !Number.isInteger(p.radar.batchSize) || p.radar.batchSize < 1 || p.radar.batchSize > 50
        || !Number.isInteger(p.radar.concurrency) || p.radar.concurrency < 1 || p.radar.concurrency > 4
        || (p.feeFallbackRate !== null && (!Number.isFinite(p.feeFallbackRate) || p.feeFallbackRate < 0 || p.feeFallbackRate >= 1))
        || p.bands.some((b, i) => b.id !== PRICING_POLICY.bands[i].id || b.maxCents !== PRICING_POLICY.bands[i].maxCents
            || ![b.floor, b.target, b.limit].every(n => Number.isFinite(n) && n >= 0 && n < 1)
            || b.floor > b.target || b.target > b.limit)) {
        throw new Error('CONFIGURACAO_PRICING_INVALIDA');
    }
    return p;
}
