import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme/colors";

export function Placeholder({ text }: { text: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
  },
  text: { color: colors.textMuted, lineHeight: 21 },
});
