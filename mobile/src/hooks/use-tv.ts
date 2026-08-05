import { useQuery } from "@tanstack/react-query";
import { getTvLive, getTvMetrics } from "@/api/tv";

export function useTvLive() {
  return useQuery({
    queryKey: ["tv", "live"],
    queryFn: getTvLive,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
  });
}

export function useTvMetrics() {
  return useQuery({
    queryKey: ["tv", "metrics"],
    queryFn: getTvMetrics,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
}
