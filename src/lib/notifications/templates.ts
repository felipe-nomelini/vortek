export type NotificationAudience = "internal" | "supplier" | "customer";
export type NotificationChannel = "whatsapp" | "push" | "email";
export type NotificationSeverity = "info" | "warning" | "critical";

export type MessageField = {
  label: string;
  value: unknown;
};

export type MessageLink = {
  label: string;
  url: string;
};

export type NotificationTemplatePreview = {
  id: string;
  channel: NotificationChannel;
  audience: NotificationAudience;
  label: string;
  trigger: string;
  preview: {
    title?: string;
    body?: string;
    text?: string;
    subject?: string;
    html?: string;
  };
};

const EMAIL_COLORS = {
  background: "#09090b",
  surface: "#171717",
  surfaceStrong: "#202020",
  border: "#343434",
  text: "#f5f5f5",
  muted: "#a3a3a3",
  yellow: "#f7c600",
  yellowText: "#171000",
};

function cleanSingleLine(value: unknown, fallback = "—"): string {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function cleanParagraph(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .trim();
}

function cleanUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function formatDateTime(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Horário não informado";
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value: unknown): string {
  const number = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(number) ? number : 0);
}

function meaningfulFields(fields: MessageField[]): MessageField[] {
  return fields.filter((field) => field.value !== null && field.value !== undefined && String(field.value).trim() !== "");
}

export function buildInternalWhatsappMessage(input: {
  title: string;
  summary: string;
  severity?: NotificationSeverity;
  fields?: MessageField[];
  action?: string | null;
  link?: MessageLink | null;
  reference?: string | null;
  sentAt?: Date | string;
}): string {
  const fields = meaningfulFields(input.fields || []);
  const url = input.link ? cleanUrl(input.link.url) : null;
  const lines = [
    `*Bentevi | ${cleanSingleLine(input.title)}*`,
    "",
    cleanParagraph(input.summary),
    fields.length ? "" : null,
    fields.length ? "*Informações*" : null,
    ...fields.map((field) => `*${cleanSingleLine(field.label)}:* ${cleanSingleLine(field.value)}`),
    input.action ? "" : null,
    input.action ? "*Próxima ação*" : null,
    input.action ? cleanParagraph(input.action) : null,
    url ? "" : null,
    url ? `*${cleanSingleLine(input.link?.label || "Abrir no Bentevi")}*` : null,
    url,
    input.reference ? "" : null,
    input.reference ? `Referência: ${cleanSingleLine(input.reference)}` : null,
    "",
    `Enviado em ${formatDateTime(input.sentAt)}.`,
  ];
  return lines.filter((line): line is string => line !== null && line !== undefined).join("\n");
}

export function buildSupplierPaymentWhatsapp(input: {
  dsliteId: unknown;
  mlOrderId?: unknown;
  saleId?: unknown;
  product?: unknown;
  quantity?: unknown;
  amount?: unknown;
  pixReference?: unknown;
  labelStatus: unknown;
  receiptUrl: unknown;
  notes?: unknown;
}): string {
  const receiptUrl = cleanUrl(input.receiptUrl);
  return [
    "*Bentevi | Pagamento confirmado*",
    "",
    `Olá! O pagamento do pedido *#${cleanSingleLine(input.dsliteId)}* foi confirmado.`,
    "",
    "*Pedido*",
    `*DSLite:* #${cleanSingleLine(input.dsliteId)}`,
    input.mlOrderId ? `*Venda Mercado Livre:* #${cleanSingleLine(input.mlOrderId)}` : null,
    input.saleId ? `*Venda Bentevi:* #${cleanSingleLine(input.saleId)}` : null,
    input.product ? `*Produto:* ${cleanSingleLine(input.product)}` : null,
    `*Quantidade:* ${cleanSingleLine(input.quantity || 1)}`,
    `*Valor pago:* ${formatMoney(input.amount)}`,
    input.pixReference ? `*Referência PIX:* ${cleanSingleLine(input.pixReference)}` : null,
    "",
    "*Próxima etapa*",
    "Aguarde a etiqueta correta antes de despachar o pedido.",
    `Situação da etiqueta: ${cleanSingleLine(input.labelStatus)}`,
    receiptUrl ? "" : null,
    receiptUrl ? "*Ver comprovante*" : null,
    receiptUrl,
    input.notes ? "" : null,
    input.notes ? `*Observações:* ${cleanParagraph(input.notes)}` : null,
  ].filter((line): line is string => line !== null && line !== undefined).join("\n");
}

export function buildSupplierLabelWhatsapp(input: {
  dsliteId: unknown;
  labelUrl: unknown;
  invoiceNumber?: unknown;
  nfeKey?: unknown;
  danfeUrl?: unknown;
  xmlUrl?: unknown;
  mlOrderId?: unknown;
  shipmentId?: unknown;
  product?: unknown;
  quantity?: unknown;
  purchaseAmount?: unknown;
  labelSource?: unknown;
}): string {
  const labelUrl = cleanUrl(input.labelUrl);
  const danfeUrl = cleanUrl(input.danfeUrl);
  const xmlUrl = cleanUrl(input.xmlUrl);
  return [
    "*Bentevi | Etiqueta disponível*",
    "",
    `A etiqueta do pedido *#${cleanSingleLine(input.dsliteId)}* está pronta.`,
    "",
    "*Próxima etapa*",
    "Use somente esta etiqueta para despachar o pedido.",
    labelUrl ? "" : null,
    labelUrl ? "*Abrir etiqueta*" : null,
    labelUrl,
    "",
    "*Pedido*",
    `*DSLite:* #${cleanSingleLine(input.dsliteId)}`,
    input.mlOrderId ? `*Venda Mercado Livre:* #${cleanSingleLine(input.mlOrderId)}` : null,
    input.shipmentId ? `*Envio Mercado Livre:* ${cleanSingleLine(input.shipmentId)}` : null,
    input.product ? `*Produto:* ${cleanSingleLine(input.product)}` : null,
    input.quantity ? `*Quantidade:* ${cleanSingleLine(input.quantity)}` : null,
    input.purchaseAmount ? `*Valor do pedido:* ${cleanSingleLine(input.purchaseAmount)}` : null,
    input.invoiceNumber || input.nfeKey || danfeUrl || xmlUrl ? "" : null,
    input.invoiceNumber || input.nfeKey || danfeUrl || xmlUrl ? "*Documentos fiscais*" : null,
    input.invoiceNumber ? `*NF-e:* ${cleanSingleLine(input.invoiceNumber)}` : null,
    input.nfeKey ? `*Chave:* ${cleanSingleLine(input.nfeKey)}` : null,
    danfeUrl ? `*DANFE:* ${danfeUrl}` : null,
    xmlUrl ? `*XML:* ${xmlUrl}` : null,
    input.labelSource ? "" : null,
    input.labelSource ? `Origem da etiqueta: ${cleanSingleLine(input.labelSource)}.` : null,
  ].filter((line): line is string => line !== null && line !== undefined).join("\n");
}

export function buildSupplierCancellationWhatsapp(input: {
  dsliteId: unknown;
  mlOrderId?: unknown;
  saleId?: unknown;
  invoiceNumber?: unknown;
  nfeKey?: unknown;
}): string {
  return [
    "*Bentevi | Pedido cancelado*",
    "",
    `O pedido *#${cleanSingleLine(input.dsliteId)}* foi cancelado pelo cliente.`,
    "",
    "*Não despache este pedido.*",
    "",
    "*Referências*",
    `*DSLite:* #${cleanSingleLine(input.dsliteId)}`,
    input.mlOrderId ? `*Venda Mercado Livre:* #${cleanSingleLine(input.mlOrderId)}` : null,
    input.saleId ? `*Venda Bentevi:* #${cleanSingleLine(input.saleId)}` : null,
    input.invoiceNumber ? `*NF-e cancelada:* ${cleanSingleLine(input.invoiceNumber)}` : null,
    !input.invoiceNumber && input.nfeKey ? `*Chave da NF-e cancelada:* ${cleanSingleLine(input.nfeKey)}` : null,
    "",
    "A situação fiscal já foi atualizada no Bentevi.",
  ].filter((line): line is string => line !== null && line !== undefined).join("\n");
}

export function buildPushTemplate(input: {
  title: string;
  primary: unknown;
  secondary?: unknown;
}): { title: string; body: string } {
  const primary = cleanSingleLine(input.primary);
  const secondary = input.secondary ? cleanSingleLine(input.secondary, "") : "";
  return {
    title: cleanSingleLine(input.title),
    body: [primary, secondary].filter(Boolean).join(" · "),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function paragraphsHtml(value: unknown): string {
  const text = cleanParagraph(value);
  if (!text) return "";
  return text.split(/\n{2,}/).map((paragraph) => (
    `<p style="margin:0 0 14px;color:${EMAIL_COLORS.text};font-size:15px;line-height:1.6">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
  )).join("");
}

export function buildFiscalEmailTemplate(input: {
  kind: "invoice" | "return_invoice";
  invoiceNumber: unknown;
  orderNumber?: unknown;
  customerName?: unknown;
  customSubject?: unknown;
  customMessage?: unknown;
  actionUrl?: unknown;
  logoSrc?: string;
}): { subject: string; text: string; html: string } {
  const invoiceNumber = cleanSingleLine(input.invoiceNumber);
  const orderNumber = input.orderNumber ? cleanSingleLine(input.orderNumber) : null;
  const customerName = cleanSingleLine(input.customerName, "");
  const isReturn = input.kind === "return_invoice";
  const documentLabel = isReturn ? "NF-e de devolução" : "NF-e";
  const defaultSubject = orderNumber
    ? `[Bentevi] ${documentLabel} ${invoiceNumber} do pedido #${orderNumber}`
    : `[Bentevi] ${documentLabel} ${invoiceNumber}`;
  const subject = cleanSingleLine(input.customSubject, defaultSubject);
  const defaultMessage = isReturn
    ? "A nota fiscal de devolução foi emitida e está anexada a este e-mail."
    : "Sua nota fiscal foi emitida e está anexada a este e-mail.";
  const message = cleanParagraph(input.customMessage) || defaultMessage;
  const greeting = customerName ? `Olá, ${customerName}.` : "Olá!";
  const actionUrl = cleanUrl(input.actionUrl);
  const logoSrc = escapeHtml(input.logoSrc || "cid:bentevi-logo");
  const orderText = orderNumber ? `Pedido #${orderNumber}` : "Pedido não informado";
  const text = [
    greeting,
    "",
    message,
    "",
    `${documentLabel}: ${invoiceNumber}`,
    orderNumber ? `Pedido: #${orderNumber}` : null,
    actionUrl ? `Abrir DANFE: ${actionUrl}` : null,
    "",
    "O documento também segue anexado.",
    "",
    "Bentevi",
    "Mensagem automática. Não responda a este e-mail.",
  ].filter((line): line is string => line !== null).join("\n");

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.background};color:${EMAIL_COLORS.text};font-family:Arial,Helvetica,sans-serif;color-scheme:dark">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${EMAIL_COLORS.background}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-radius:14px;overflow:hidden">
        <tr><td style="padding:24px 28px;background:${EMAIL_COLORS.surfaceStrong};border-bottom:3px solid ${EMAIL_COLORS.yellow}">
          <img src="${logoSrc}" width="190" alt="Bentevi" style="display:block;width:190px;max-width:100%;height:auto;border:0">
        </td></tr>
        <tr><td style="padding:32px 28px 14px">
          <p style="margin:0 0 12px;color:${EMAIL_COLORS.muted};font-size:13px;letter-spacing:.08em;text-transform:uppercase">Documento fiscal</p>
          <h1 style="margin:0 0 22px;color:${EMAIL_COLORS.text};font-size:26px;line-height:1.25">${escapeHtml(documentLabel)} ${escapeHtml(invoiceNumber)}</h1>
          <p style="margin:0 0 14px;color:${EMAIL_COLORS.text};font-size:15px;line-height:1.6">${escapeHtml(greeting)}</p>
          ${paragraphsHtml(message)}
        </td></tr>
        <tr><td style="padding:0 28px 24px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${EMAIL_COLORS.background};border:1px solid ${EMAIL_COLORS.border};border-radius:10px">
            <tr><td style="padding:18px 20px">
              <p style="margin:0 0 8px;color:${EMAIL_COLORS.muted};font-size:12px;text-transform:uppercase;letter-spacing:.06em">Documento</p>
              <p style="margin:0 0 4px;color:${EMAIL_COLORS.text};font-size:16px;font-weight:700">${escapeHtml(documentLabel)} ${escapeHtml(invoiceNumber)}</p>
              <p style="margin:0;color:${EMAIL_COLORS.muted};font-size:14px">${escapeHtml(orderText)}</p>
            </td></tr>
          </table>
        </td></tr>
        ${actionUrl ? `<tr><td style="padding:0 28px 24px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:${EMAIL_COLORS.yellow};color:${EMAIL_COLORS.yellowText};font-size:15px;font-weight:700;text-decoration:none;padding:13px 20px;border-radius:8px">Abrir DANFE</a></td></tr>` : ""}
        <tr><td style="padding:0 28px 32px">
          <p style="margin:0;color:${EMAIL_COLORS.muted};font-size:13px;line-height:1.5">O documento também segue anexado a este e-mail.</p>
        </td></tr>
        <tr><td style="padding:20px 28px;background:${EMAIL_COLORS.background};border-top:1px solid ${EMAIL_COLORS.border}">
          <p style="margin:0;color:${EMAIL_COLORS.muted};font-size:12px;line-height:1.5">Bentevi · Mensagem automática. Não responda a este e-mail.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

export function getNotificationTemplatePreviews(): NotificationTemplatePreview[] {
  const sentAt = "2026-09-04T15:30:00-03:00";
  const appUrl = "https://dev.bentevi.shop";
  const internal = (input: Omit<Parameters<typeof buildInternalWhatsappMessage>[0], "sentAt">) => (
    buildInternalWhatsappMessage({ ...input, sentAt })
  );
  const whatsappPreviews: NotificationTemplatePreview[] = [
    {
      id: "whatsapp-new-sale", channel: "whatsapp", audience: "internal", label: "Nova venda", trigger: "Venda paga recebida",
      preview: { text: internal({ title: "Nova venda", summary: "Uma nova venda paga entrou na operação.", fields: [{ label: "Venda", value: "#2000018213839604" }, { label: "Pack", value: "#2000014800206189" }, { label: "Cliente", value: "Douglas Cavalcante" }, { label: "Valor", value: "R$ 153,00" }], action: "Abra a venda e confira a próxima etapa.", link: { label: "Ver venda", url: `${appUrl}/pedidos?search=2000018213839604` } }) },
    },
    {
      id: "whatsapp-new-question", channel: "whatsapp", audience: "internal", label: "Nova pergunta", trigger: "Pergunta aguardando resposta",
      preview: { text: internal({ title: "Nova pergunta", summary: "Um cliente perguntou: Este produto acompanha fonte?", fields: [{ label: "Anúncio", value: "Caixa de som portátil" }, { label: "Recebida em", value: "04/09/2026 às 15:28" }], action: "Responda a pergunta no Bentevi.", link: { label: "Responder pergunta", url: `${appUrl}/perguntas` } }) },
    },
    {
      id: "whatsapp-claim", channel: "whatsapp", audience: "internal", label: "Reclamação aberta", trigger: "Nova reclamação no Mercado Livre",
      preview: { text: internal({ title: "Reclamação aberta", summary: "Uma venda precisa de atenção.", severity: "critical", fields: [{ label: "Venda", value: "#2000018210665568" }, { label: "Reclamação", value: "#5246801934" }, { label: "Cliente", value: "José Adolfo" }], action: "Abra o caso e confira o prazo de resposta.", link: { label: "Ver reclamação", url: `${appUrl}/reclamacoes` } }) },
    },
    {
      id: "whatsapp-label-released", channel: "whatsapp", audience: "internal", label: "Etiqueta liberada", trigger: "Etiqueta real disponível no Mercado Livre",
      preview: { text: internal({ title: "Etiqueta liberada", summary: "A etiqueta da venda já pode ser enviada ao fornecedor.", severity: "warning", fields: [{ label: "Venda", value: "#2000018210665568" }, { label: "Pedido DSLite", value: "#918542" }, { label: "Cliente", value: "José Adolfo" }], action: "Envie a etiqueta correta ao fornecedor.", link: { label: "Abrir venda", url: `${appUrl}/pedidos?search=2000018210665568` } }) },
    },
    {
      id: "whatsapp-integration-problem", channel: "whatsapp", audience: "internal", label: "Integração com problema", trigger: "Canal essencial indisponível",
      preview: { text: internal({ title: "Integração com problema", summary: "O Mercado Livre precisa de atenção.", severity: "critical", fields: [{ label: "Mercado Livre", value: "Conexão interrompida" }, { label: "WhatsApp", value: "Funcionando" }], action: "Abra o painel e verifique a conexão.", link: { label: "Abrir painel", url: `${appUrl}/configuracoes?tab=integracoes` }, reference: "INC-1042" }) },
    },
    {
      id: "whatsapp-integration-ok", channel: "whatsapp", audience: "internal", label: "Integrações recuperadas", trigger: "Recuperação dos canais",
      preview: { text: internal({ title: "Integrações normalizadas", summary: "Mercado Livre e WhatsApp voltaram a funcionar normalmente.", fields: [{ label: "Mercado Livre", value: "Conectado" }, { label: "WhatsApp", value: "Conectado" }] }) },
    },
    {
      id: "whatsapp-critical-job", channel: "whatsapp", audience: "internal", label: "Falha em rotina automática", trigger: "Falha persistente de processamento",
      preview: { text: internal({ title: "Rotina automática com falha", summary: "A sincronização de pedidos não foi concluída.", severity: "critical", fields: [{ label: "Rotina", value: "Sincronizar pedidos" }, { label: "Ocorrências", value: "3 tentativas" }, { label: "Última falha", value: "04/09/2026 às 15:22" }], action: "Abra o painel e verifique a rotina.", link: { label: "Abrir painel", url: `${appUrl}/dashboard` }, reference: "SYNC-PEDIDOS-503" }) },
    },
    {
      id: "whatsapp-stale-task", channel: "whatsapp", audience: "internal", label: "Rotina sem execução", trigger: "Agendamento atrasado ou ausente",
      preview: { text: internal({ title: "Rotina sem execução", summary: "A atualização de preços e estoque não roda há mais tempo que o esperado.", severity: "critical", fields: [{ label: "Rotina", value: "Atualizar preços e estoque" }, { label: "Frequência", value: "A cada 30 minutos" }, { label: "Última execução", value: "Há 96 minutos" }], action: "Abra o painel e confira o agendamento.", link: { label: "Abrir painel", url: `${appUrl}/dashboard` } }) },
    },
    {
      id: "whatsapp-weekly-report", channel: "whatsapp", audience: "internal", label: "Resumo semanal", trigger: "Fechamento dos últimos sete dias",
      preview: { text: internal({ title: "Resumo semanal", summary: "A operação encerrou a semana com resultado positivo.", fields: [{ label: "Período", value: "28/08/2026 a 04/09/2026" }, { label: "Vendas", value: "84" }, { label: "Faturamento", value: "R$ 28.740,90" }, { label: "Lucro", value: "R$ 3.186,42" }, { label: "Reclamações", value: "2" }], link: { label: "Ver dashboard", url: `${appUrl}/dashboard` } }) },
    },
    {
      id: "whatsapp-monthly-report", channel: "whatsapp", audience: "internal", label: "Resumo mensal", trigger: "Fechamento dos últimos 30 dias",
      preview: { text: internal({ title: "Resumo mensal", summary: "Confira o resultado consolidado dos últimos 30 dias.", fields: [{ label: "Período", value: "05/08/2026 a 04/09/2026" }, { label: "Vendas", value: "347" }, { label: "Faturamento", value: "R$ 118.420,60" }, { label: "Lucro", value: "R$ 13.904,15" }, { label: "Reclamações", value: "6" }], link: { label: "Ver dashboard", url: `${appUrl}/dashboard` } }) },
    },
    {
      id: "whatsapp-supplier-payment", channel: "whatsapp", audience: "supplier", label: "Pagamento ao fornecedor", trigger: "Comprovante PIX confirmado",
      preview: { text: buildSupplierPaymentWhatsapp({ dsliteId: "918542", mlOrderId: "2000018210665568", saleId: "8210665568", product: "Caixa de som portátil", quantity: 1, amount: 1940, pixReference: "PIX-918542", labelStatus: "prevista para 05/09/2026 às 09:00", receiptUrl: `${appUrl}/s/comprovante-exemplo` }) },
    },
    {
      id: "whatsapp-supplier-label", channel: "whatsapp", audience: "supplier", label: "Etiqueta ao fornecedor", trigger: "Etiqueta pronta para despacho",
      preview: { text: buildSupplierLabelWhatsapp({ dsliteId: "918542", labelUrl: `${appUrl}/s/etiqueta-exemplo`, invoiceNumber: "1256", nfeKey: "35260900000000000123550020000012561000012560", danfeUrl: `${appUrl}/s/danfe-exemplo`, xmlUrl: `${appUrl}/s/xml-exemplo`, mlOrderId: "2000018210665568", shipmentId: "44629850311", product: "Caixa de som portátil", quantity: 1, purchaseAmount: "R$ 1.690,00", labelSource: "Mercado Livre" }) },
    },
    {
      id: "whatsapp-supplier-cancel", channel: "whatsapp", audience: "supplier", label: "Cancelamento ao fornecedor", trigger: "Venda cancelada após emissão fiscal",
      preview: { text: buildSupplierCancellationWhatsapp({ dsliteId: "918542", mlOrderId: "2000018210665568", saleId: "8210665568", invoiceNumber: "1256" }) },
    },
    {
      id: "whatsapp-test", channel: "whatsapp", audience: "internal", label: "Teste do canal", trigger: "Teste administrativo explícito",
      preview: { text: internal({ title: "Teste de WhatsApp", summary: "O canal de notificações está funcionando.", fields: [{ label: "Ambiente", value: "Homologação" }] }) },
    },
  ];

  const push = (id: string, label: string, trigger: string, title: string, primary: string, secondary?: string): NotificationTemplatePreview => ({
    id, channel: "push", audience: "internal", label, trigger, preview: buildPushTemplate({ title, primary, secondary }),
  });
  const pushPreviews = [
    push("push-new-sale", "Nova venda", "Venda paga recebida", "Nova venda", "Venda #2000018213839604", "R$ 153,00"),
    push("push-new-question", "Nova pergunta", "Pergunta aguardando resposta", "Nova pergunta", "Caixa de som portátil", "Responder no Bentevi"),
    push("push-claim", "Reclamação aberta", "Nova reclamação no Mercado Livre", "Reclamação aberta", "Venda #2000018210665568", "Confira o prazo de resposta"),
    push("push-test", "Teste do canal", "Teste administrativo explícito", "Teste de Push", "Este navegador está pronto para receber alertas"),
  ];

  const invoice = buildFiscalEmailTemplate({ kind: "invoice", invoiceNumber: "1256", orderNumber: "8210665568", customerName: "José Adolfo", actionUrl: `${appUrl}/s/danfe-exemplo`, logoSrc: "/branding/bentevi/bentevi-wordmark.png" });
  const returnInvoice = buildFiscalEmailTemplate({ kind: "return_invoice", invoiceNumber: "48", orderNumber: "8210665568", customerName: "José Adolfo", logoSrc: "/branding/bentevi/bentevi-wordmark.png" });
  const emailPreviews: NotificationTemplatePreview[] = [
    { id: "email-invoice", channel: "email", audience: "customer", label: "NF-e da venda", trigger: "Envio fiscal solicitado", preview: invoice },
    { id: "email-return-invoice", channel: "email", audience: "customer", label: "NF-e de devolução", trigger: "Envio fiscal solicitado", preview: returnInvoice },
  ];

  return [...whatsappPreviews, ...pushPreviews, ...emailPreviews];
}
