import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  confirmPurchasePayment,
  getPurchaseDetail,
  getPurchases,
  getPurchasesSummary,
  type PurchaseFilters,
} from "@/api/purchases";

const PAGE_SIZE = 20;

export function usePurchases(search: string, filters: PurchaseFilters) {
  return useInfiniteQuery({
    queryKey: ["purchases", search, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getPurchases({ page: pageParam, pageSize: PAGE_SIZE, search, filters }),
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.meta.page * lastPage.meta.pageSize;
      return loaded < lastPage.meta.total ? lastPage.meta.page + 1 : undefined;
    },
    staleTime: 10_000,
  });
}

export function usePurchasesSummary(search: string, filters: PurchaseFilters) {
  return useQuery({
    queryKey: ["purchases-summary", search, filters],
    queryFn: () => getPurchasesSummary(search, filters),
    staleTime: 10_000,
  });
}

export function usePurchaseDetail(id: string) {
  return useQuery({
    queryKey: ["purchase", id],
    queryFn: () => getPurchaseDetail(id),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

export function useConfirmPurchasePayment() {
  return useMutation({ mutationFn: confirmPurchasePayment, retry: false });
}
