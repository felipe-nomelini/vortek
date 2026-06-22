import {
  approveOpsIssue,
  getOpsIssue,
  getGitHubIssueUrl,
  listOpsIssues,
  rejectOpsIssue,
  requestOpsIssueDetails,
} from '@/services/github-ops';

type OpsIntent =
  | 'list_errors'
  | 'details'
  | 'approve'
  | 'reject'
  | 'request_details'
  | 'help'
  | 'unknown';

type ParsedCommand = {
  intent: OpsIntent;
  issueNumber?: number | null;
  reply?: string | null;
};

type ProcessInput = {
  text: string;
  phone?: string | null;
};

function normalize(input: unknown) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractIssueNumber(text: string) {
  const match = text.match(/#?\b(\d{1,7})\b/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseCommandFallback(text: string): ParsedCommand {
  const raw = String(text || '').trim();
  const normalized = normalize(raw);
  const issueNumber = extractIssueNumber(raw);

  if (!raw || normalized === 'ajuda' || normalized === 'help' || normalized === 'menu') {
    return { intent: 'help' };
  }

  if (
    normalized.includes('listar')
    || normalized.includes('abertos')
    || normalized.includes('erros')
    || normalized.includes('criticos')
  ) {
    return { intent: 'list_errors' };
  }

  if (normalized.includes('aprovar') || normalized.startsWith('ok ') || normalized.startsWith('sim ')) {
    return { intent: 'approve', issueNumber };
  }

  if (
    normalized.includes('reprovar')
    || normalized.includes('rejeitar')
    || normalized.startsWith('nao ')
    || normalized.includes('falso positivo')
  ) {
    return { intent: 'reject', issueNumber };
  }

  if (
    normalized.includes('mais detalhes')
    || normalized.includes('pedir detalhes')
    || normalized.includes('detalhar melhor')
    || normalized.includes('investigar mais')
  ) {
    return { intent: 'request_details', issueNumber };
  }

  if (
    normalized.includes('detalhes')
    || normalized.includes('detalhe')
    || normalized.includes('mostrar')
    || normalized.includes('ver issue')
  ) {
    return { intent: 'details', issueNumber };
  }

  return { intent: 'unknown', issueNumber };
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function parseCommandWithAi(text: string): Promise<ParsedCommand | null> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = String(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
    .trim()
    .replace(/\/+$/, '');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop',
      'X-Title': 'Vortek Ops WhatsApp Bot',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_OPS_WHATSAPP_MODEL
        || process.env.OPENROUTER_MODEL
        || 'openai/gpt-5.4-mini',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Você é a IA operacional da Vortek no WhatsApp.',
            'Converse de forma curta, direta e natural em português do Brasil.',
            'Retorne apenas JSON válido no formato {"intent":"...","issueNumber":123|null,"reply":"..."}',
            'Intenções permitidas: list_errors, details, approve, reject, request_details, help, unknown.',
            'Extraia issueNumber quando houver número de issue.',
            'Não invente número de issue.',
            'Use help para saudação, pedido de ajuda ou conversa geral sobre o que você consegue fazer.',
            'Use unknown quando a mensagem não tiver relação operacional com Vortek.',
            'Em reply, explique o que você entendeu e o próximo passo. Máximo 500 caracteres.',
            'Não diga que executou algo se a intent não for uma ação operacional clara.',
          ].join('\n'),
        },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const outputText = data?.choices?.[0]?.message?.content || '';
  const parsed = safeJsonParse(String(outputText || ''));
  if (!parsed?.intent) return null;
  return {
    intent: parsed.intent,
    issueNumber: Number.isFinite(Number(parsed.issueNumber)) ? Number(parsed.issueNumber) : null,
    reply: typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim().slice(0, 800)
      : null,
  };
}

function formatHelp() {
  return [
    '*Vortek Ops*',
    '',
    'Comandos:',
    'LISTAR ERROS',
    'DETALHES 123',
    'APROVAR 123',
    'REPROVAR 123',
    'MAIS DETALHES 123',
    '',
    'Ações sensíveis só funcionam para números autorizados.',
  ].join('\n');
}

function requireIssueNumber(command: ParsedCommand) {
  if (!command.issueNumber) {
    return 'Informe o número da issue. Exemplo: APROVAR 123';
  }
  return null;
}

function formatIssueSummary(issue: Awaited<ReturnType<typeof getOpsIssue>>) {
  return [
    `*Issue #${issue.number}*`,
    issue.title,
    '',
    `Status: ${issue.state}`,
    issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : 'Labels: —',
    issue.updated_at ? `Atualizada: ${new Date(issue.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : null,
    '',
    issue.body ? issue.body.slice(0, 1800) : 'Sem descrição.',
    '',
    issue.url,
  ].filter(Boolean).join('\n');
}

function formatDispatchResult(dispatch: unknown) {
  const value = dispatch as { dispatched?: boolean; workflow?: string; reason?: string; error?: string } | null;
  if (value?.dispatched) return `Workflow disparado: ${value.workflow || 'configurado'}`;
  return `Workflow não disparado: ${value?.reason || value?.error || 'não configurado'}`;
}

export async function processOpsWhatsappCommand(input: ProcessInput) {
  const aiCommand = await parseCommandWithAi(input.text).catch(() => null);
  const command = aiCommand || parseCommandFallback(input.text);

  if (command.intent === 'help') {
    return {
      command,
      text: command.reply ? `${command.reply}\n\n${formatHelp()}` : formatHelp(),
      status: 'ok' as const,
    };
  }

  if (command.intent === 'list_errors') {
    const issues = await listOpsIssues(8);
    if (issues.length === 0) {
      return { command, text: 'Nenhuma issue operacional aberta encontrada.', status: 'ok' as const };
    }
    const text = [
      '*Erros operacionais abertos*',
      '',
      ...issues.map((issue) => `#${issue.number} - ${issue.title}\n${issue.url}`),
    ].join('\n\n');
    return { command, text, status: 'ok' as const };
  }

  if (command.intent === 'details') {
    const missing = requireIssueNumber(command);
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const issue = await getOpsIssue(command.issueNumber!);
    return { command, text: formatIssueSummary(issue), status: 'ok' as const };
  }

  if (command.intent === 'approve') {
    const missing = requireIssueNumber(command);
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const result = await approveOpsIssue(command.issueNumber!, input.phone || undefined);
    const dispatchText = formatDispatchResult(result.dispatch);
    return {
      command,
      status: 'ok' as const,
      text: [
        `Issue #${command.issueNumber} aprovada via WhatsApp.`,
        dispatchText,
        getGitHubIssueUrl(command.issueNumber!),
      ].join('\n'),
    };
  }

  if (command.intent === 'reject') {
    const missing = requireIssueNumber(command);
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const result = await rejectOpsIssue(command.issueNumber!, input.phone || undefined);
    const dispatchText = formatDispatchResult(result.dispatch);
    return {
      command,
      status: 'ok' as const,
      text: [
        `Issue #${command.issueNumber} reprovada via WhatsApp.`,
        dispatchText,
        getGitHubIssueUrl(command.issueNumber!),
      ].join('\n'),
    };
  }

  if (command.intent === 'request_details') {
    const missing = requireIssueNumber(command);
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const result = await requestOpsIssueDetails(command.issueNumber!, input.phone || undefined);
    const dispatchText = formatDispatchResult(result.dispatch);
    return {
      command,
      status: 'ok' as const,
      text: [
        `Mais detalhes solicitados na issue #${command.issueNumber}.`,
        dispatchText,
        getGitHubIssueUrl(command.issueNumber!),
      ].join('\n'),
    };
  }

  return {
    command,
    status: 'unknown' as const,
    text: command.reply || [
      'Não entendi o que você quer fazer.',
      '',
      formatHelp(),
    ].join('\n'),
  };
}
