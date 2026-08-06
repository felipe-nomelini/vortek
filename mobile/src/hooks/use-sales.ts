import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getSales,
  getSaleDetail,
  getSaleTracking,
  type SalesFilters,
  getSalesSummary,
  type SalesView,
} from "@/api/sales";

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
    staleTime: 10_000,
  });
}

export function useSalesSummary(search: string, filters: SalesFilters) {
  return useQuery({
    queryKey: ["sales-summary", search, filters],
    queryFn: () => getSalesSummary(search, filters),
    staleTime: 10_000,
  });
}
