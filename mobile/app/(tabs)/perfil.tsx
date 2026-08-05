import { Pressable, StyleSheet, Text, View } from "react-native";
import Constants from "expo-constants";
import { Screen } from "@/components/screen";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useAuth } from "@/providers/auth-provider";
import { colors } from "@/theme/colors";

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const currentUser = useCurrentUser();

  return (
    <Screen>
      <Text style={styles.title}>Perfil</Text>
      <View style={styles.card}>
        <Text style={styles.name}>
          {currentUser.data?.user.name || "Usuário"}
        </Text>
        <Text style={styles.muted}>{currentUser.data?.user.email}</Text>
        <Text style={styles.muted}>
          Cargo: {currentUser.data?.user.role || "—"}
        </Text>
        <Text style={styles.muted}>
          Versão: {Constants.expoConfig?.version || "desenvolvimento"}
        </Text>
      </View>
      <Pressable onPress={signOut} style={styles.button}>
        <Text style={styles.buttonText}>Sair</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 26, fontWeight: "800" },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  name: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.textMuted },
  button: {
    alignItems: "center",
    borderColor: colors.danger,
    borderRadius: 8,
    borderWidth: 1,
    padding: 13,
  },
  buttonText: { color: colors.danger, fontWeight: "700" },
});
