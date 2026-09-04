const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const contracts = require("../src/lib/configuracoes/contracts.ts");
const notifications = require("../src/lib/configuracoes/notifications.ts");

const validPush = notifications.PUSH_NOTIFICATION_EVENTS.map((eventType) => ({
  eventType,
  enabled: true,
  recipientRoles: ["admin"],
  userIds: [],
}));

test("contrato exige política completa e destinatário para evento push ativo", () => {
  assert.deepEqual(
    validPush.map((policy) => policy.eventType),
    ["new_sale", "new_question", "claim_opened"],
  );
  assert.equal(contracts.notificationConfigurationSchema.safeParse({
    pushPolicies: validPush,
    whatsappRecipients: [],
  }).success, true);
  assert.equal(contracts.notificationConfigurationSchema.safeParse({
    pushPolicies: validPush.map((policy, index) => index === 0
      ? { ...policy, recipientRoles: [], userIds: [] }
      : policy),
    whatsappRecipients: [],
  }).success, false);
  assert.equal(contracts.notificationConfigurationSchema.safeParse({
    pushPolicies: validPush,
    whatsappRecipients: [{
      recipientName: "Operação",
      phone: "número inválido",
      enabled: true,
      eventTypes: ["new_sale"],
    }],
  }).success, false);
});

test("telefone é normalizado e a auditoria pode trabalhar somente com máscara", () => {
  assert.equal(notifications.normalizeWhatsappNumber("(21) 98765-4321"), "5521987654321");
  assert.equal(notifications.maskWhatsappNumber("5521987654321"), "+55 •• •••••-4321");
  assert.equal(notifications.normalizeWhatsappNumber("123"), null);
});

test("homologação limita alertas automáticos ao destinatário de teste já autorizado", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://dev.bentevi.shop";
  assert.deepEqual(
    notifications.selectWhatsappRecipientsForEnvironment(
      ["5521987654321", "5511999999999"],
      "21987654321",
    ),
    ["5521987654321"],
  );
  assert.deepEqual(
    notifications.selectWhatsappRecipientsForEnvironment(["5521987654321"], "11999999999"),
    [],
  );
  if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = previous;
});

test("runtime usa as fontes tipadas e não contém destinatários ou domínio legados", () => {
  const push = read("src/services/push-notifications.ts");
  const whatsapp = read("src/services/whatsapp-alerts.ts");
  assert.match(push, /push_alert_settings/);
  assert.match(push, /push_alert_recipients/);
  assert.doesNotMatch(push, /notificacoes_push|app\.vortek\.shop/);
  assert.match(whatsapp, /whatsapp_alert_settings/);
  assert.doesNotMatch(whatsapp, /DEFAULT_ALERT_PHONES|WHATSAPP_ALERT_PHONES|app\.vortek\.shop/);
});

test("migration centraliza políticas, protege tabelas e mantém escrita transacional", () => {
  const migration = read("supabase/migrations/20260905023000_bnt_cfg_06_notifications.sql");
  assert.match(migration, /create table if not exists public\.push_alert_settings/);
  assert.match(migration, /create table if not exists public\.push_alert_recipients/);
  assert.match(migration, /num_nonnulls\(recipient_role, user_id\) = 1/);
  assert.match(migration, /create or replace function public\.save_notification_configuration/);
  assert.match(migration, /alter table public\.push_alert_settings enable row level security/);
  assert.match(migration, /revoke all on table public\.whatsapp_alert_settings from public, anon, authenticated, service_role/);
  assert.match(migration, /notificacoes\.push\.policy/);
  assert.match(migration, /notificacoes\.whatsapp\.recipients/);
});

test("API é administrativa, no-store, sanitiza auditoria e restringe testes externos", () => {
  const route = read("src/app/api/configuracoes/notificacoes/route.ts");
  assert.match(route, /requireAdminUser/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /maskWhatsappNumber/);
  assert.match(route, /WAHA_TEST_RECIPIENT_PHONE/);
  assert.match(route, /verifyEmailTransport/);
  assert.doesNotMatch(route, /WAHA_API_KEY[^\n]*:/);
});
