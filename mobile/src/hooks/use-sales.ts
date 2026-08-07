import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  getSaleActionJob,
  getSales,
  getSaleDetail,
  getSaleTracking,
  startSaleAction,
  type SaleActionKind,
  type SalesFilters,
  getSalesSummary,
  confirmSupplierPayment,
  runSaleOperation,
  type SaleOperation,
  type SalesView,
} from "@/api/sales";

export function useSaleOperation() {
  return useMutation({
    mutationFn: (input: { id: string; operation: SaleOperation }) => (
      runSaleOperation(input.id, input.operation)
    ),
    retry: false,
  });
}

export function useConfirmSupplierPayment() {
  return useMutation({ mutationFn: confirmSupplierPayment, retry: false });
}

export function useStartSaleAction() {
  return useMutation({
    mutationFn: (input: {
      id: string;
      action: SaleActionKind;
      idempotencyKey: string;
    }) => startSaleAction(input.id, input.action, input.idempotencyKey),
    retry: false,
  });
}

export function useSaleActionJob(
  id: string,
  action: SaleActionKind | null,
  jobId: string | null,
) {
  return useQuery({
    queryKey: ["sale-action-job", id, action, jobId],
    queryFn: () => getSaleActionJob(id, action!, jobId!),
    enabled: Boolean(id && action && jobId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "running") return 2_000;
      if (state === "on_hold") return 10_000;
      return false;
    },
  });
}

export function useSaleDetail(id: string) {
  return useQuery({
    queryKey: ["sale", id],
    queryFn: () => getSaleDetail(id),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useSaleTracking(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["sale-tracking", id],
    queryFn: () => getSaleTracking(id),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  });
}

const PAGE_SIZE = 20;

export function useSales(view: SalesView, search: string, filters: SalesFilters) {
  return useInfiniteQuery({
    queryKey: ["sales", view, search, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getSales({
      view,
      search,
      page: pageParam,
      pageSize: PAGE_SIZE,
      filters,
    }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.meta.page * lastPage.meta.pageSize;
      return loaded < lastPage.meta.total ? lastPage.meta.page + 1 : undefined;
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

export function useSalesSummary(search: string, filters: SalesFilters) {
  return useQuery({
    queryKey: ["sales-summary", search, filters],
    queryFn: () => getSalesSummary(search, filters),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}
