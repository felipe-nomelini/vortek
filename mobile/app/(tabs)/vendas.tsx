import { Text } from "react-native";
import { Screen } from "@/components/screen";
import { Placeholder } from "@/components/placeholder";
import { colors } from "@/theme/colors";

export default function SalesScreen() {
  return (
    <Screen>
      <Text style={{ color: colors.text, fontSize: 26, fontWeight: "800" }}>
        Vendas
      </Text>
      <Placeholder text="Lista e urgências entram após contratos da API de vendas." />
    </Screen>
  );
}
