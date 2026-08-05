import { Redirect } from "expo-router";
import { LoadingScreen } from "@/components/loading-screen";
import { useAuth } from "@/providers/auth-provider";

export default function IndexScreen() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen message="Validando sessão" />;
  return <Redirect href={session ? "/(tabs)/tv" : "/login"} />;
}
