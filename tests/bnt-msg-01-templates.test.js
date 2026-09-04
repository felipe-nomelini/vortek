const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const templates = require("../src/lib/notifications/templates.ts");

test("catálogo cobre os canais e públicos ativos sem dados reais", () => {
  const previews = templates.getNotificationTemplatePreviews();
  assert.equal(previews.length, 20);
  assert.deepEqual([...new Set(previews.map((item) => item.channel))].sort(), ["email", "push", "whatsapp"]);
  assert.deepEqual([...new Set(previews.map((item) => item.audience))].sort(), ["customer", "internal", "supplier"]);
  assert.equal(new Set(previews.map((item) => item.id)).size, previews.length);
  assert.ok(previews.every((item) => item.label && item.trigger));

  const content = JSON.stringify(previews);
  assert.match(content, /Bentevi/);
  assert.doesNotMatch(content, /Vortek|VORTEK|api[_ -]?key|access[_ -]?token|service[_ -]?role|payload bruto/i);
});

test("mensagens internas mantêm hierarquia, ação e horário sem despejar erro bruto", () => {
  const message = templates.buildInternalWhatsappMessage({
    title: "Falha em rotina automática",
    summary: "A sincronização de pedidos não foi concluída.",
    fields: [{ label: "Rotina", value: "Sincronizar pedidos" }],
    action: "Abra o painel e verifique a rotina.",
    link: { label: "Abrir painel", url: "https://dev.bentevi.shop/dashboard" },
    reference: "SYNC-503",
    sentAt: "2026-09-04T15:30:00-03:00",
  });

  assert.match(message, /^\*Bentevi \| Falha em rotina automática\*/);
  assert.match(message, /\*Informações\*[\s\S]*\*Próxima ação\*/);
  assert.match(message, /https:\/\/dev\.bentevi\.shop\/dashboard/);
  assert.match(message, /Referência: SYNC-503/);
  assert.match(message, /Enviado em 04\/09\/2026, 15:30\./);
  assert.doesNotMatch(message, /stack|payload|token|secret/i);
});

test("mensagens ao fornecedor deixam a instrução operacional inequívoca", () => {
  const payment = templates.buildSupplierPaymentWhatsapp({
    dsliteId: "918542",
    mlOrderId: "2000018210665568",
    amount: 1940,
    labelStatus: "ainda não liberada",
    receiptUrl: "https://dev.bentevi.shop/s/comprovante",
  });
  const label = templates.buildSupplierLabelWhatsapp({
    dsliteId: "918542",
    labelUrl: "https://dev.bentevi.shop/s/etiqueta",
    invoiceNumber: "1256",
    nfeKey: "35260900000000000123550020000012561000012560",
    labelSource: "Mercado Livre",
  });
  const cancellation = templates.buildSupplierCancellationWhatsapp({
    dsliteId: "918542",
    mlOrderId: "2000018210665568",
    invoiceNumber: "1256",
  });

  assert.match(payment, /Aguarde a etiqueta correta antes de despachar/);
  assert.match(payment, /Valor pago:\* R\$\s1\.940,00/);
  assert.match(label, /Use somente esta etiqueta para despachar/);
  assert.match(label, /\*Documentos fiscais\*/);
  assert.match(cancellation, /\*Não despache este pedido\.\*/);
  assert.doesNotMatch(`${payment}\n${label}\n${cancellation}`, /Vortek|VORTEK/);
});

test("push é curto e usa o mesmo construtor no runtime e no teste administrativo", () => {
  assert.deepEqual(
    templates.buildPushTemplate({ title: "Nova venda", primary: "Venda #123", secondary: "R$ 99,90" }),
    { title: "Nova venda", body: "Venda #123 · R$ 99,90" },
  );
  const pushRuntime = read("src/services/push-notifications.ts");
  const adminRoute = read("src/app/api/configuracoes/notificacoes/route.ts");
  assert.match(pushRuntime, /buildPushTemplate/);
  assert.match(adminRoute, /buildPushTemplate/);
  assert.match(read("public/sw.js"), /bentevi-notification/);
});

test("e-mail fiscal possui versão texto, visual dark e logo embutido", () => {
  const email = templates.buildFiscalEmailTemplate({
    kind: "invoice",
    invoiceNumber: "1256",
    orderNumber: "8210665568",
    customerName: "Cliente <script>alert(1)</script>",
    customMessage: "Documento <script>alert(2)</script>",
    actionUrl: "https://dev.bentevi.shop/s/danfe",
  });

  assert.match(email.subject, /^\[Bentevi\] NF-e 1256/);
  assert.match(email.text, /Mensagem automática\. Não responda/);
  assert.match(email.html, /<!doctype html>/i);
  assert.match(email.html, /background:#09090b/);
  assert.match(email.html, /cid:bentevi-logo/);
  assert.match(email.html, /Abrir DANFE/);
  assert.doesNotMatch(email.html, /<script>/i);

  const emailService = read("src/services/email.ts");
  assert.match(emailService, /input\.html\?\.includes\('cid:bentevi-logo'\)/);
  assert.match(emailService, /bentevi-wordmark\.png/);
  assert.match(emailService, /text: input\.text/);
  assert.match(emailService, /html: input\.html/);
});

test("todos os emissores ativos usam a fonte central sem mudar o transporte", () => {
  const expectedBuilders = new Map([
    ["src/services/whatsapp-alerts.ts", "buildInternalWhatsappMessage"],
    ["src/services/whatsapp-label-job.ts", "buildSupplierLabelWhatsapp"],
    ["src/app/api/compras/[id]/confirmar-pagamento/route.ts", "buildSupplierPaymentWhatsapp"],
    ["src/app/api/compras/[id]/enviar-etiqueta-whatsapp/route.ts", "buildSupplierLabelWhatsapp"],
    ["src/app/api/sync/pedidos/cancelamentos-pos-nfe/route.ts", "buildSupplierCancellationWhatsapp"],
    ["src/app/api/notas-fiscais/[id]/enviar-email/route.ts", "buildFiscalEmailTemplate"],
    ["src/app/api/notas-fiscais/retornos/[id]/enviar-email/route.ts", "buildFiscalEmailTemplate"],
  ]);
  for (const [file, builder] of expectedBuilders) assert.match(read(file), new RegExp(builder));
});

test("galeria é administrativa, somente leitura e renderiza os três canais", () => {
  const route = read("src/app/api/configuracoes/notificacoes/modelos/route.ts");
  const gallery = read("src/components/configuracoes/NotificationTemplateGallery.tsx");
  const tab = read("src/components/configuracoes/NotificacoesTab.tsx");

  assert.match(route, /requireAdminUser/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /getNotificationTemplatePreviews/);
  assert.doesNotMatch(route, /export async function (POST|PUT|DELETE)/);
  assert.match(gallery, /sandbox=""/);
  assert.match(gallery, /WhatsApp/);
  assert.match(gallery, /Push/);
  assert.match(gallery, /E-mail/);
  assert.match(tab, /Visualizar modelos/);
  assert.match(tab, /NotificationTemplateGallery/);
});
