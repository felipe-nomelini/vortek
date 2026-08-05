import { Text } from "react-native";
import { Screen } from "@/components/screen";
import { Placeholder } from "@/components/placeholder";
import { colors } from "@/theme/colors";

export default function PurchasesScreen() {
  return (
    <Screen>
      <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>
        Compras
      </Text>
      <Placeholder text="Lista e pendências entram após contratos da API de compras." />
    </Screen>
  );
}
