import { useQuery } from "@tanstack/react-query";
import { getCurrentSession } from "@/api/session";
import { useAuth } from "@/providers/auth-provider";

export function useCurrentUser() {
  const { session } = useAuth();

  return useQuery({
    queryKey: ["mobile-session", session?.user.id],
    queryFn: getCurrentSession,
    enabled: Boolean(session),
    retry: 1,
    staleTime: 60_000,
  });
}
