export interface EvolusomCycleCompletionInput {
  directSync: boolean;
  supplierId: string;
  hasMore: boolean;
  isLastSupplier: boolean;
  startedFromPageOne: boolean;
  totalStable: boolean;
  expectedTotal: number;
  observedTotal: number;
  errorCount: number;
}

export function shouldFinalizeEvolusomCycle(input: EvolusomCycleCompletionInput): boolean {
  return input.directSync
    && input.supplierId === '133'
    && !input.hasMore
    && input.isLastSupplier
    && input.startedFromPageOne
    && input.totalStable
    && input.expectedTotal > 0
    && input.expectedTotal === input.observedTotal
    && input.errorCount === 0;
}
