import { type PropsWithChildren, useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { AuthProvider } from "@/providers/auth-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: { retry: false },
  },
});

function QueryFocusBridge() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    function onAppStateChange(status: AppStateStatus) {
      focusManager.setFocused(status === "active");
    }

    onAppStateChange(AppState.currentState);
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, []);

  return null;
}

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <QueryFocusBridge />
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
