import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/providers/auth-provider";
import { LoadingScreen } from "@/components/loading-screen";
import { useCurrentUser } from "@/hooks/use-current-user";
import { colors } from "@/theme/colors";

export default function TabsLayout() {
  const { loading, session, signOut } = useAuth();
  const currentUser = useCurrentUser();

  if (loading) return <LoadingScreen message="Carregando" />;
  if (!session) return <Redirect href="/login" />;
  if (currentUser.isPending) return <LoadingScreen message="Validando acesso" />;
  if (currentUser.isError) {
    return (
      <View style={styles.accessError}>
        <Text style={styles.accessTitle}>Acesso não validado</Text>
        <Text style={styles.accessText}>
          Confira a conexão ou solicite liberação do perfil no ERP.
        </Text>
        <Pressable onPress={() => currentUser.refetch()} style={styles.retryButton}>
          <Text style={styles.retryText}>Tentar novamente</Text>
        </Pressable>
        <Pressable onPress={signOut} style={styles.exitButton}>
          <Text style={styles.exitText}>Sair</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="tv"
        options={{
          title: "TV",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="stats-chart" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="vendas"
        options={{
          title: "Vendas",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="receipt" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="compras"
        options={{
          title: "Compras",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="cart" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="perfil"
        options={{
          title: "Perfil",
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="person" size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  accessError: {
    backgroundColor: colors.background,
    flex: 1,
    gap: 14,
    justifyContent: "center",
    padding: 24,
  },
  accessTitle: { color: colors.danger, fontSize: 22, fontWeight: "800" },
  accessText: { color: colors.textMuted, lineHeight: 22 },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 13,
  },
  retryText: { color: colors.textOnPrimary, fontWeight: "700" },
  exitButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 13,
  },
  exitText: { color: colors.textMuted, fontWeight: "700" },
});
