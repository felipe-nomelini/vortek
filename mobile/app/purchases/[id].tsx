import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { LoadingScreen } from "@/components/loading-screen";
import { Screen } from "@/components/screen";
import { useConfirmPurchasePayment, usePurchaseDetail } from "@/hooks/use-purchases";
import { colors } from "@/theme/colors";

function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}
function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}
function Field({ label, value }: { label: string; value: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>;
}

export default function PurchaseDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] || "" : params.id || "";
  const detail = usePurchaseDetail(id);
  const confirmPayment = useConfirmPurchasePayment();
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (detail.isPending) return <LoadingScreen message="Carregando compra" />;
  if (!detail.data) return <Screen><View style={styles.errorCard}><Text style={styles.error}>Não foi possível carregar a compra.</Text><Pressable onPress={() => detail.refetch()} style={styles.primaryButton}><Text style={styles.primaryText}>Tentar novamente</Text></Pressable></View></Screen>;
  const purchase = detail.data;

  async function pickReceipt() {
    const selected = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true, multiple: false,
    });
    if (!selected.canceled && selected.assets[0]) {
      const asset = selected.assets[0];
      if (asset.size && asset.size > 10 * 1024 * 1024) { setError("Comprovante maior que 10 MB."); return; }
      setReceipt({ uri: asset.uri, name: asset.name || "comprovante", mimeType: asset.mimeType || "application/octet-stream" });
      setError(null);
    }
  }

  async function submitPayment() {
    if (!receipt && !purchase.hasPaymentReceipt) { setError("Anexe o comprovante do PIX."); return; }
    setError(null); setMessage(null);
    try {
      const response = await confirmPayment.mutateAsync({ id: purchase.id, receipt: receipt || undefined, reference, notes });
      const whatsapp = (response as any)?.whatsapp;
      setMessage(whatsapp?.sent ? "Comprovante processado e enviado por WhatsApp." : "Comprovante processado. WhatsApp não enviado.");
      setReceipt(null);
      await detail.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao confirmar pagamento");
    }
  }

  function confirmSubmit() {
    Alert.alert(
      purchase.paymentStatus === "paid" ? "Reenviar comprovante?" : "Confirmar PIX?",
      `Fornecedor: ${purchase.supplierName || "—"}\nValor: ${purchase.paymentAmount == null ? "—" : currency(purchase.paymentAmount)}`,
      [{ text: "Cancelar", style: "cancel" }, { text: "Confirmar", onPress: () => void submitPayment() }],
    );
  }

  return (
    <Screen onRefresh={() => detail.refetch()} refreshing={detail.isRefetching}>
      <View style={styles.hero}>
        <View style={styles.rowBetween}><Text style={styles.id}>DSLite #{purchase.dsliteId}</Text><Text style={styles.total}>{currency(purchase.total)}</Text></View>
        <Text style={styles.title}>{purchase.productDescription || "Produto não informado"}</Text>
        <Text style={styles.muted}>{dateTime(purchase.createdAt)} · {purchase.status}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Produto e destinatário</Text>
        <Field label="Produto" value={purchase.productDescription || "—"} />
        <Field label="SKU" value={purchase.productSku || "—"} />
        <Field label="Quantidade" value={String(purchase.quantity)} />
        <Field label="Destinatário" value={purchase.recipientName || "—"} />
        <Field label="Documento" value={purchase.recipientDocument || "—"} />
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>Fornecedor e pagamento</Text>
        <Field label="Fornecedor" value={purchase.supplierName || "—"} />
        <Field label="Valor da compra" value={currency(purchase.total)} />
        <Field label="Frete" value={currency(purchase.freight)} />
        <Field label="Valor esperado do PIX" value={purchase.paymentAmount == null ? "—" : currency(purchase.paymentAmount)} />
        <Field label="Chave PIX" value={purchase.supplierPixKey || "Não cadastrada"} />
        <Field label="Pagamento" value={purchase.paymentDeferred ? "Aguardando etiqueta real do ML" : purchase.paymentStatus || purchase.paymentMode || "—"} />
        {purchase.canConfirmPayment ? <View style={styles.form}>
          <TextInput onChangeText={setReference} placeholder="Referência do PIX (opcional)" placeholderTextColor={colors.textMuted} style={styles.input} value={reference} />
          <TextInput multiline onChangeText={setNotes} placeholder="Observações (opcional)" placeholderTextColor={colors.textMuted} style={[styles.input, styles.notes]} value={notes} />
          <Pressable onPress={() => void pickReceipt()} style={styles.secondaryButton}><Text style={styles.secondaryText}>{receipt?.name || (purchase.hasPaymentReceipt ? "Substituir comprovante" : "Anexar comprovante")}</Text></Pressable>
          <Pressable disabled={confirmPayment.isPending} onPress={confirmSubmit} style={styles.primaryButton}><Text style={styles.primaryText}>{purchase.paymentStatus === "paid" ? "Reenviar comprovante" : "Confirmar PIX"}</Text></Pressable>
          {confirmPayment.isPending ? <ActivityIndicator color={colors.primary} /> : null}
        </View> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.section}>DSLite, fiscal e entrega</Text>
        <Field label="Status DSLite" value={purchase.dsliteStatus || "—"} />
        <Field label="Venda ML" value={purchase.saleNumber ? `#${purchase.saleNumber}` : "—"} />
        <Field label="Status da venda" value={purchase.saleStatus || "—"} />
        <Field label="Envio ML" value={purchase.shipmentId || "—"} />
        <Field label="Rastreio" value={purchase.tracking || "—"} />
        <Field label="NF-e" value={purchase.invoiceNumber || "—"} />
        <Field label="Chave NF-e" value={purchase.invoiceKey || "—"} />
        {purchase.saleUrl ? <Pressable onPress={() => Linking.openURL(purchase.saleUrl!)} style={styles.primaryButton}><Text style={styles.primaryText}>Abrir venda no Mercado Livre</Text></Pressable> : null}
        {purchase.trackingUrl ? <Pressable onPress={() => Linking.openURL(purchase.trackingUrl!)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Rastrear entrega</Text></Pressable> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, gap: 8, padding: 16 }, rowBetween: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" }, id: { color: colors.primary, fontSize: 17, fontWeight: "800" }, total: { color: colors.text, fontSize: 18, fontWeight: "800" }, title: { color: colors.text, fontSize: 16, fontWeight: "700" }, muted: { color: colors.textMuted, fontSize: 11 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, gap: 12, padding: 16 }, section: { color: colors.text, fontSize: 17, fontWeight: "800" }, field: { gap: 3 }, label: { color: colors.textMuted, fontSize: 11 }, value: { color: colors.text, lineHeight: 20 }, form: { borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingTop: 12 },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.text, paddingHorizontal: 12, paddingVertical: 11 }, notes: { minHeight: 72, textAlignVertical: "top" }, primaryButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 8, padding: 12 }, primaryText: { color: colors.textOnPrimary, fontWeight: "700" }, secondaryButton: { alignItems: "center", borderColor: colors.primary, borderRadius: 8, borderWidth: 1, padding: 11 }, secondaryText: { color: "#8fc2ff", fontWeight: "700" }, success: { color: colors.success, fontSize: 12, textAlign: "center" }, error: { color: colors.danger, fontSize: 12, textAlign: "center" }, errorCard: { backgroundColor: colors.surface, borderColor: colors.danger, borderRadius: 12, borderWidth: 1, gap: 12, padding: 16 },
});
