import type { Database } from "@/types/database";

export const PUSH_NOTIFICATION_EVENTS = [
  "new_sale",
  "new_question",
  "claim_opened",
] as const;

export const WHATSAPP_NOTIFICATION_EVENTS = [
  "new_sale",
  "new_question",
  "claim_opened",
  "ml_label_released",
  "critical_error",
  "integration_status",
  "weekly_sales_report",
  "monthly_sales_report",
] as const;

export type PushNotificationEvent = (typeof PUSH_NOTIFICATION_EVENTS)[number];
export type WhatsappNotificationEvent = (typeof WHATSAPP_NOTIFICATION_EVENTS)[number];
export type NotificationUserRole = Database["public"]["Enums"]["user_role"];

export const NOTIFICATION_EVENT_LABELS: Record<WhatsappNotificationEvent, string> = {
  new_sale: "Venda aprovada",
  new_question: "Nova pergunta",
  claim_opened: "Reclamação aberta",
  ml_label_released: "Etiqueta liberada",
  critical_error: "Erro crítico",
  integration_status: "Estado das integrações",
  weekly_sales_report: "Resumo semanal",
  monthly_sales_report: "Resumo mensal",
};

export const NOTIFICATION_ROLE_LABELS: Record<NotificationUserRole, string> = {
  admin: "Administradores",
  gerente: "Gerentes",
  operador: "Operadores",
  visualizador: "Visualizadores",
};

export function normalizeWhatsappNumber(value: string): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return /^55\d{10,11}$/.test(withCountry) ? withCountry : null;
}

export function maskWhatsappNumber(value: string): string {
  const normalized = normalizeWhatsappNumber(value);
  if (!normalized) return "Número inválido";
  return `+55 •• •••••-${normalized.slice(-4)}`;
}

export function getNotificationAppUrl(): URL | null {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function notificationAppLink(path: string): string | null {
  const base = getNotificationAppUrl();
  return base ? new URL(path, base).toString() : null;
}

export function isProductionNotificationEnvironment(): boolean {
  return getNotificationAppUrl()?.hostname === "app.bentevi.shop";
}

export function selectWhatsappRecipientsForEnvironment(
  configuredPhones: string[],
  testRecipient: string | undefined,
): string[] {
  const configured = Array.from(new Set(
    configuredPhones.map(normalizeWhatsappNumber).filter((phone): phone is string => Boolean(phone)),
  ));
  if (isProductionNotificationEnvironment()) return configured;
  const testPhone = normalizeWhatsappNumber(testRecipient || "");
  return testPhone && configured.includes(testPhone) ? [testPhone] : [];
}
