import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  configurationValidationMessage,
  notificationChannelTestSchema,
  notificationConfigurationSchema,
  type NotificationConfigurationInput,
} from "@/lib/configuracoes/contracts";
import {
  PUSH_NOTIFICATION_EVENTS,
  WHATSAPP_NOTIFICATION_EVENTS,
  maskWhatsappNumber,
  normalizeWhatsappNumber,
  type NotificationUserRole,
  type WhatsappNotificationEvent,
} from "@/lib/configuracoes/notifications";
import { createClient, createServiceClient } from "@/lib/supabase";
import { getEmailChannelStatus, verifyEmailTransport } from "@/services/email";
import { dispatchPushNotifications, enqueuePushNotification } from "@/services/push-notifications";
import { recordConfigurationAudit } from "@/services/configuration-audit";
import { getWahaDiagnostics, normalizeWhatsappChatId, sendWahaText } from "@/services/waha";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isActiveUser(bannedUntil: string | undefined): boolean {
  if (!bannedUntil) return true;
  const timestamp = Date.parse(bannedUntil);
  return Number.isNaN(timestamp) || timestamp <= Date.now();
}

function pushSnapshot(policies: NotificationConfigurationInput["pushPolicies"]) {
  return policies.map((policy) => ({
    eventType: policy.eventType,
    enabled: policy.enabled,
    recipientRoles: [...policy.recipientRoles].sort(),
    userIds: [...policy.userIds].sort(),
  })).sort((left, right) => left.eventType.localeCompare(right.eventType));
}

function whatsappAuditSnapshot(recipients: NotificationConfigurationInput["whatsappRecipients"]) {
  return recipients.map((recipient) => ({
    id: recipient.id || null,
    recipientName: recipient.recipientName,
    phone: maskWhatsappNumber(recipient.phone),
    enabled: recipient.enabled,
    eventTypes: [...recipient.eventTypes].sort(),
  })).sort((left, right) => left.recipientName.localeCompare(right.recipientName));
}

async function loadConfiguration() {
  const serviceClient = createServiceClient();
  const [settingsResult, targetsResult, whatsappResult, subscriptionsResult, profilesResult, usersResult] = await Promise.all([
    serviceClient.from("push_alert_settings").select("alert_type,enabled").order("alert_type"),
    serviceClient.from("push_alert_recipients").select("alert_type,recipient_role,user_id"),
    serviceClient.from("whatsapp_alert_settings").select("id,recipient_name,phone,enabled,event_types").order("recipient_name"),
    serviceClient.from("push_subscriptions").select("user_id", { count: "exact", head: false }),
    serviceClient.from("profiles").select("id,nome,cargo"),
    serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const firstError = settingsResult.error || targetsResult.error || whatsappResult.error
    || subscriptionsResult.error || profilesResult.error || usersResult.error;
  if (firstError) throw new Error(firstError.message);

  const authUsers = new Map(usersResult.data.users.map((user) => [user.id, user]));
  const users = (profilesResult.data || [])
    .filter((profile) => {
      const authUser = authUsers.get(profile.id);
      return Boolean(authUser && isActiveUser(authUser.banned_until));
    })
    .map((profile) => ({ id: profile.id, name: profile.nome, role: profile.cargo }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const pushPolicies = PUSH_NOTIFICATION_EVENTS.map((eventType) => {
    const setting = (settingsResult.data || []).find((row) => row.alert_type === eventType);
    const targets = (targetsResult.data || []).filter((row) => row.alert_type === eventType);
    return {
      eventType,
      enabled: Boolean(setting?.enabled),
      recipientRoles: targets.map((target) => target.recipient_role)
        .filter((role): role is NotificationUserRole => role !== null),
      userIds: targets.map((target) => target.user_id)
        .filter((userId): userId is string => userId !== null),
    };
  });

  const wahaConfigured = Boolean(
    String(process.env.WAHA_BASE_URL || process.env.WAHA_URL || "").trim()
    && String(process.env.WAHA_API_KEY || "").trim(),
  );
  const wahaDiagnostics = wahaConfigured
    ? await getWahaDiagnostics().then((diagnostics) => ({
        available: true,
        status: diagnostics.status,
        engine: diagnostics.engine,
      })).catch((error) => ({
        available: false,
        status: error instanceof Error ? error.message : "Diagnóstico indisponível",
        engine: null,
      }))
    : { available: false, status: "Não configurado", engine: null };

  return {
    pushPolicies,
    whatsappRecipients: (whatsappResult.data || []).map((recipient) => ({
      id: recipient.id,
      recipientName: recipient.recipient_name,
      phone: recipient.phone,
      phoneMasked: maskWhatsappNumber(recipient.phone),
      enabled: recipient.enabled,
      eventTypes: recipient.event_types.filter(
        (eventType): eventType is WhatsappNotificationEvent => (
          WHATSAPP_NOTIFICATION_EVENTS.includes(eventType as WhatsappNotificationEvent)
        ),
      ),
    })),
    users,
    channels: {
      push: {
        configured: Boolean(
          String(process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim()
          && String(process.env.VAPID_PRIVATE_KEY || "").trim()
          && String(process.env.VAPID_SUBJECT || "").trim(),
        ),
        subscriptions: subscriptionsResult.count || 0,
        subscribedUsers: new Set((subscriptionsResult.data || []).map((row) => row.user_id)).size,
      },
      whatsapp: {
        configured: wahaConfigured,
        testRecipientConfigured: Boolean(normalizeWhatsappNumber(process.env.WAHA_TEST_RECIPIENT_PHONE || "")),
        ...wahaDiagnostics,
      },
      email: getEmailChannelStatus(),
    },
  };
}

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  try {
    return noStore({ ...(await loadConfiguration()), currentUserId: admin.user.id });
  } catch (error) {
    return noStore({ erro: error instanceof Error ? error.message : "Falha ao carregar notificações" }, 500);
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const parsed = notificationConfigurationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return noStore({ erro: configurationValidationMessage(parsed.error, "Configuração de notificações inválida") }, 422);
  }

  const serviceClient = createServiceClient();
  try {
    const previous = await loadConfiguration();
    const activeUserIds = new Set(previous.users.map((user) => user.id));
    const invalidUser = parsed.data.pushPolicies
      .flatMap((policy) => policy.userIds)
      .find((userId) => !activeUserIds.has(userId));
    if (invalidUser) return noStore({ erro: "Selecione somente usuários ativos" }, 422);

    const { error } = await serviceClient.rpc("save_notification_configuration", {
      p_push: parsed.data.pushPolicies.map((policy) => ({
        event_type: policy.eventType,
        enabled: policy.enabled,
        recipient_roles: policy.recipientRoles,
        user_ids: policy.userIds,
      })),
      p_whatsapp: parsed.data.whatsappRecipients.map((recipient) => ({
        id: recipient.id || null,
        recipient_name: recipient.recipientName,
        phone: recipient.phone,
        enabled: recipient.enabled,
        event_types: recipient.eventTypes,
      })),
    });
    if (error) throw new Error(error.message);

    try {
      await recordConfigurationAudit(serviceClient, { id: admin.user.id, name: admin.nome }, [
        {
          key: "notificacoes.push.policy",
          before: pushSnapshot(previous.pushPolicies),
          after: pushSnapshot(parsed.data.pushPolicies),
        },
        {
          key: "notificacoes.whatsapp.recipients",
          before: whatsappAuditSnapshot(previous.whatsappRecipients),
          after: whatsappAuditSnapshot(parsed.data.whatsappRecipients),
        },
      ]);
    } catch {
      return noStore({ erro: "Notificações salvas, mas o histórico administrativo não pôde ser registrado", persisted: true }, 500);
    }
    return noStore({ ...(await loadConfiguration()), currentUserId: admin.user.id });
  } catch (error) {
    return noStore({ erro: error instanceof Error ? error.message : "Falha ao salvar notificações" }, 500);
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;
  const parsed = notificationChannelTestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return noStore({ erro: configurationValidationMessage(parsed.error, "Canal inválido") }, 422);
  }

  try {
    if (parsed.data.channel === "push") {
      const queued = await enqueuePushNotification({
        userId: admin.user.id,
        eventType: "test",
        title: "Notificações Bentevi funcionando",
        body: "Este navegador está pronto para receber alertas operacionais.",
        url: "/configuracoes?tab=notificacoes",
        dedupeKey: `push_test:${admin.user.id}:${Date.now()}`,
      });
      if (queued.skipped) return noStore({ erro: "Ative as notificações neste navegador antes do teste" }, 409);
      return noStore({ ok: true, result: await dispatchPushNotifications(10) });
    }

    if (parsed.data.channel === "whatsapp") {
      const testPhone = normalizeWhatsappNumber(process.env.WAHA_TEST_RECIPIENT_PHONE || "");
      if (!testPhone) return noStore({ erro: "Destinatário de teste do WhatsApp não configurado" }, 409);
      await sendWahaText({
        chatId: normalizeWhatsappChatId(testPhone),
        text: "Bentevi DEV — teste manual do canal de notificações.",
      });
      return noStore({ ok: true });
    }

    await verifyEmailTransport();
    return noStore({ ok: true });
  } catch (error) {
    return noStore({ erro: error instanceof Error ? error.message : "Falha ao testar canal" }, 502);
  }
}
