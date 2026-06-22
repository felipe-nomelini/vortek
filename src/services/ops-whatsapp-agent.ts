import {
  approveOpsIssue,
  commentOpsIssue,
  createOrUpdateOpsIssue,
  getOpsIssue,
  getGitHubIssueUrl,
  listOpsIssues,
  rejectOpsIssue,
  requestOpsIssueDetails,
} from '@/services/github-ops';

type OpsIntent =
  | 'list_errors'
  | 'pending_approval'
  | 'details'
  | 'approve'
  | 'reject'
  | 'request_details'
  | 'add_error'
  | 'help'
  | 'unknown';

type ParsedCommand = {
  intent: OpsIntent;
  issueNumber?: number | null;
  issueNumbers?: number[] | null;
  reply?: string | null;
};

type OpenOpsIssue = Awaited<ReturnType<typeof listOpsIssues>>[number];

const ALLOWED_INTENTS = new Set<OpsIntent>([
  'list_errors',
  'pending_approval',
  'details',
  'approve',
  'reject',
  'request_details',
  'add_error',
  'help',
  'unknown',
]);

type ProcessInput = {
  text: string;
  phone?: string | null;
  history?: Array<{
    direction?: 'in' | 'out' | string | null;
    command?: string | null;
    message?: string | null;
    action?: string | null;
    issueNumber?: number | null;
  }>;
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

function extractIssueNumbers(text: string) {
  const matches = Array.from(String(text || '').matchAll(/#?\b(\d{1,7})\b/g));
  return Array.from(new Set(matches
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0)));
}

function parseCommandFallback(text: string): ParsedCommand {
  const raw = String(text || '').trim();
  const normalized = normalize(raw);
  const issueNumber = extractIssueNumber(raw);

  if (!raw || normalized === 'ajuda' || normalized === 'help' || normalized === 'menu') {
    return { intent: 'help' };
  }

  if (
    normalized.includes('inclua')
    || normalized.includes('incluir')
    || normalized.includes('adicione')
    || normalized.includes('adicionar')
    || normalized.includes('registra')
    || normalized.includes('registrar')
  ) {
    return { intent: 'add_error', issueNumber };
  }

  if (
    normalized.includes('preciso aprovar')
    || normalized.includes('tenho que aprovar')
    || normalized.includes('tem algo para aprovar')
    || normalized.includes('correcao pendente')
    || normalized.includes('correcoes pendentes')
    || normalized.includes('aprovacao pendente')
  ) {
    return { intent: 'pending_approval', issueNumber };
  }

  if (
    normalized.includes('listar')
    || normalized.includes('abertos')
    || normalized.includes('erros')
    || normalized.includes('criticos')
  ) {
    return { intent: 'list_errors' };
  }

  if (
    normalized.includes('aprovar')
    || normalized.startsWith('ok ')
    || normalized.startsWith('sim ')
    || normalized.includes('resolver')
    || normalized.includes('resolva')
    || normalized.includes('corrigir')
    || normalized.includes('corrija')
    || normalized.includes('consertar')
    || normalized.includes('conserte')
    || normalized.includes('arrumar')
    || normalized.includes('arrume')
    || normalized.includes('autofix')
  ) {
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

function isAffirmative(text: string) {
  const normalized = normalize(text);
  return ['sim', 's', 'pode', 'isso', 'ok', 'confirma', 'confirmo'].includes(normalized)
    || normalized.startsWith('sim ')
    || normalized.startsWith('pode ');
}

function getLastOutgoing(history: ProcessInput['history']) {
  return (history || []).find((item) => item.direction === 'out') || null;
}

function extractIssueFromText(text: string | null | undefined) {
  const match = String(text || '').match(/issue\s*#?(\d{1,7})|#(\d{1,7})/i);
  if (!match) return null;
  const value = Number(match[1] || match[2]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function inferApprovalFromHistory(text: string, history: ProcessInput['history']): ParsedCommand | null {
  if (!isAffirmative(text)) return null;
  const lastOutgoing = getLastOutgoing(history);
  if (!lastOutgoing) return null;

  const outgoingText = `${lastOutgoing.message || ''}\n${lastOutgoing.command || ''}`;
  const issueNumber = lastOutgoing.issueNumber
    || extractIssueFromText(outgoingText);
  const canApprove = normalize(outgoingText).includes('aprovar')
    || normalize(outgoingText).includes('pendente');

  if (!issueNumber || !canApprove) return null;
  return { intent: 'approve', issueNumber };
}

function wantsCommandList(text: string) {
  const normalized = normalize(text);
  return normalized === 'ajuda'
    || normalized === 'help'
    || normalized === 'menu'
    || normalized.includes('comandos')
    || normalized.includes('o que voce consegue')
    || normalized.includes('o que voce faz');
}

function looksLikeOperationalAlert(text: string) {
  const normalized = normalize(text);
  return normalized.includes('vortek - critico')
    || normalized.includes('job critico falhou')
    || normalized.includes('status: erro')
    || normalized.includes('job:');
}

function parseOperationalAlert(text: string) {
  const job = text.match(/Job:\s*([^\n\r]+)/i)?.[1]?.trim();
  const status = text.match(/Status:\s*([^\n\r]+)/i)?.[1]?.trim();
  const finished = text.match(/Finalizado:\s*([^\n\r]+)/i)?.[1]?.trim();
  const title = job ? `Job crítico falhou: ${job}` : 'Erro operacional reportado via WhatsApp';
  const dedupeKey = job ? `whatsapp_job:${job}` : `whatsapp_alert:${Buffer.from(text).toString('base64').slice(0, 80)}`;

  return {
    type: 'critical_error',
    severity: 'critical',
    title,
    message: [
      'Erro incluído via WhatsApp operacional.',
      '',
      job ? `Job: ${job}` : null,
      status ? `Status: ${status}` : null,
      finished ? `Finalizado: ${finished}` : null,
      '',
      'Mensagem original:',
      text.slice(0, 3000),
    ].filter(Boolean).join('\n'),
    dedupeKey,
    payload: {
      source: 'whatsapp_ops',
      job: job || null,
      status: status || null,
      finished: finished || null,
    },
  };
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

async function parseCommandWithAiContext(input: {
  text: string;
  history?: ProcessInput['history'];
  openIssues?: OpenOpsIssue[];
}): Promise<ParsedCommand | null> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) return null;
  const baseUrl = String(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
    .trim()
    .replace(/\/+$/, '');
  const historyText = (input.history || [])
    .slice()
    .reverse()
    .map((item) => [
      item.direction === 'out' ? 'Assistente' : 'Usuario',
      item.action ? `acao=${item.action}` : null,
      item.issueNumber ? `issue=${item.issueNumber}` : null,
      item.message || item.command || '',
    ].filter(Boolean).join(' | '))
    .join('\n') || 'Sem historico.';
  const openIssuesText = (input.openIssues || [])
    .map((issue) => `#${issue.number} - ${issue.title} | labels=${issue.labels.join(', ') || '-'} | ${issue.url}`)
    .join('\n') || 'Nenhuma issue operacional aberta.';

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
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Voce e a IA operacional da Vortek no WhatsApp. Aja como assistente conversacional, nao como menu de comandos.',
            'Entenda linguagem natural, contexto recente e referencias como "essa", "a ultima", "as 3", "todas", "pode seguir".',
            'Retorne apenas JSON valido no formato {"intent":"...","issueNumber":123|null,"issueNumbers":[123],"reply":"..."}',
            'Intenções permitidas: list_errors, pending_approval, details, approve, reject, request_details, add_error, help, unknown.',
            'Use issueNumbers quando o usuario pedir acao em varias issues.',
            'Se ele disser "as 3" apos voce listar 3 issues abertas, isso significa todas as 3 issues. Se disser "#3" ou "issue 3", significa issue numero 3.',
            'Se o usuario disser "todas", use todas as issues abertas informadas.',
            'Nao invente numero de issue. Use apenas issues abertas informadas ou numero explicito do usuario.',
            'Se a intencao for clara, retorne a acao. Se faltar dado, retorne unknown ou reply perguntando objetivamente.',
            'Use add_error quando o usuário pedir para incluir, registrar ou adicionar um erro/alerta em uma issue.',
            'Use help somente quando o usuario pedir ajuda, menu, comandos ou perguntar o que voce consegue fazer.',
            'Use unknown quando a mensagem não tiver relação operacional com Vortek.',
            'Em reply, explique o que você entendeu e o próximo passo. Máximo 500 caracteres.',
            'Nao liste comandos, exceto quando o usuario perguntar explicitamente por comandos, ajuda ou menu.',
            'Não diga que executou algo se a intent não for uma ação operacional clara.',
            'Para "preciso aprovar alguma correcao?", "tem algo pendente?", use pending_approval.',
            'Para "quais issues/erros estao abertos?", use list_errors.',
            'Para "pode seguir", "aprova", "manda rodar", use approve se o alvo estiver claro pelo texto ou historico.',
            'Para "resolver a issue 4", "resolva a 4", "corrija a issue 4", "conserte a 4", use approve. No Vortek, resolver issue operacional significa aprovar o workflow de autofix.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            'Mensagem atual:',
            input.text,
            '',
            'Historico recente do chat:',
            historyText,
            '',
            'Issues operacionais abertas agora:',
            openIssuesText,
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const outputText = data?.choices?.[0]?.message?.content || '';
  const parsed = safeJsonParse(String(outputText || ''));
  if (!parsed?.intent) return null;
  const intent = String(parsed.intent || '') as OpsIntent;
  if (!ALLOWED_INTENTS.has(intent)) return null;
  return {
    intent,
    issueNumber: Number.isFinite(Number(parsed.issueNumber)) ? Number(parsed.issueNumber) : null,
    issueNumbers: Array.isArray(parsed.issueNumbers)
      ? Array.from(new Set(parsed.issueNumbers
        .map((value: unknown) => Number(value))
        .filter((number: number) => Number.isFinite(number) && number > 0)))
      : null,
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

function getCommandIssueNumbers(command: ParsedCommand) {
  const numbers = command.issueNumbers?.length
    ? command.issueNumbers
    : command.issueNumber
      ? [command.issueNumber]
      : [];
  return Array.from(new Set(numbers.filter((number) => Number.isFinite(number) && number > 0)));
}

function hydrateIssueReferences(command: ParsedCommand, text: string, openIssues: OpenOpsIssue[]) {
  const normalized = normalize(text);
  const explicitNumbers = extractIssueNumbers(text);
  const openNumbers = new Set(openIssues.map((issue) => issue.number));
  const quantityReference = normalized.match(/\b(?:as|os|todas as|todos os)\s+(\d{1,2})\b/);

  if (!command.issueNumbers?.length && explicitNumbers.length > 1) {
    command.issueNumbers = explicitNumbers.filter((number) => openNumbers.size === 0 || openNumbers.has(number));
  }

  if (!command.issueNumber && !command.issueNumbers?.length && explicitNumbers.length === 1) {
    command.issueNumber = explicitNumbers[0];
  }

  if (
    (command.intent === 'approve' || command.intent === 'reject' || command.intent === 'request_details')
    && (
      normalized.includes('todas')
      || normalized.includes('todos')
      || (quantityReference && Number(quantityReference[1]) === openIssues.length)
    )
    && openIssues.length
  ) {
    command.issueNumbers = openIssues.map((issue) => issue.number);
    command.issueNumber = null;
  }

  return command;
}

function wantsAutofix(text: string) {
  const normalized = normalize(text);
  return normalized.includes('resolver')
    || normalized.includes('resolva')
    || normalized.includes('corrigir')
    || normalized.includes('corrija')
    || normalized.includes('consertar')
    || normalized.includes('conserte')
    || normalized.includes('arrumar')
    || normalized.includes('arrume')
    || normalized.includes('autofix');
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
  const fallbackCommand = parseCommandFallback(input.text);
  const openIssues = await listOpsIssues(10).catch(() => []);
  const contextualCommand = inferApprovalFromHistory(input.text, input.history);
  const aiCommand = await parseCommandWithAiContext({
    text: input.text,
    history: input.history,
    openIssues,
  }).catch(() => null);
  const commandSource = aiCommand?.intent && aiCommand.intent !== 'unknown'
    ? aiCommand
    : contextualCommand || fallbackCommand;
  const command = hydrateIssueReferences(
    commandSource,
    input.text,
    openIssues,
  );
  if (wantsAutofix(input.text) && command.issueNumber && command.intent === 'details') {
    command.intent = 'approve';
  }

  if (command.intent === 'help') {
    if (!wantsCommandList(input.text) && command.reply) {
      return { command, text: command.reply, status: 'ok' as const };
    }
    return {
      command,
      text: command.reply ? `${command.reply}\n\n${formatHelp()}` : formatHelp(),
      status: 'ok' as const,
    };
  }

  if (command.intent === 'add_error') {
    const alert = parseOperationalAlert(input.text);
    if (command.issueNumber) {
      await commentOpsIssue(command.issueNumber, alert.message);
      return {
        command,
        status: 'ok' as const,
        text: `Incluí esse erro como comentário na issue #${command.issueNumber}.\n${getGitHubIssueUrl(command.issueNumber)}`,
      };
    }

    if (!looksLikeOperationalAlert(input.text)) {
      return {
        command,
        status: 'needs_input' as const,
        text: 'Pode me enviar o alerta completo ou informar o número da issue onde devo incluir?',
      };
    }

    const issue = await createOrUpdateOpsIssue(alert);
    return {
      command: { ...command, issueNumber: issue.number },
      status: 'ok' as const,
      text: issue.created
        ? `Criei a issue #${issue.number} para esse erro.\n${issue.url}`
        : `Incluí esse erro na issue já aberta #${issue.number}.\n${issue.url}`,
    };
  }

  if (command.intent === 'list_errors') {
    const issues = openIssues.slice(0, 8);
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

  if (command.intent === 'pending_approval') {
    const issues = openIssues.slice(0, 8);
    if (issues.length === 0) {
      return {
        command,
        text: 'Não encontrei nenhuma issue operacional aberta para aprovação agora.',
        status: 'ok' as const,
      };
    }

    const [first] = issues;
    const text = [
      issues.length === 1
        ? `Sim. Existe 1 issue operacional aberta: #${first.number} - ${first.title}`
        : `Sim. Existem ${issues.length} issues operacionais abertas:`,
      '',
      ...issues.map((issue) => `#${issue.number} - ${issue.title}\n${issue.url}`),
      '',
      issues.length === 1
        ? `Se quiser aprovar, responda "sim" ou "aprovar issue ${first.number}".`
        : 'Para aprovar, responda com o número. Ex.: "aprovar issue 1".',
    ].join('\n');
    return {
      command: { ...command, issueNumber: issues.length === 1 ? first.number : command.issueNumber },
      text,
      status: 'ok' as const,
    };
  }

  if (command.intent === 'details') {
    const missing = requireIssueNumber(command);
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const issue = await getOpsIssue(command.issueNumber!);
    return { command, text: formatIssueSummary(issue), status: 'ok' as const };
  }

  if (command.intent === 'approve') {
    const issueNumbers = getCommandIssueNumbers(command);
    const missing = issueNumbers.length === 0 ? requireIssueNumber(command) : null;
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const results = [];
    for (const issueNumber of issueNumbers) {
      const result = await approveOpsIssue(issueNumber, input.phone || undefined);
      results.push(`#${issueNumber}: ${formatDispatchResult(result.dispatch)}`);
    }
    return {
      command,
      status: 'ok' as const,
      text: [
        issueNumbers.length === 1
          ? `Issue #${issueNumbers[0]} aprovada via WhatsApp.`
          : `Aprovei ${issueNumbers.length} issues via WhatsApp.`,
        ...results,
        ...issueNumbers.map((issueNumber) => getGitHubIssueUrl(issueNumber)),
      ].join('\n'),
    };
  }

  if (command.intent === 'reject') {
    const issueNumbers = getCommandIssueNumbers(command);
    const missing = issueNumbers.length === 0 ? requireIssueNumber(command) : null;
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const results = [];
    for (const issueNumber of issueNumbers) {
      const result = await rejectOpsIssue(issueNumber, input.phone || undefined);
      results.push(`#${issueNumber}: ${formatDispatchResult(result.dispatch)}`);
    }
    return {
      command,
      status: 'ok' as const,
      text: [
        issueNumbers.length === 1
          ? `Issue #${issueNumbers[0]} reprovada via WhatsApp.`
          : `Reprovei ${issueNumbers.length} issues via WhatsApp.`,
        ...results,
        ...issueNumbers.map((issueNumber) => getGitHubIssueUrl(issueNumber)),
      ].join('\n'),
    };
  }

  if (command.intent === 'request_details') {
    const issueNumbers = getCommandIssueNumbers(command);
    const missing = issueNumbers.length === 0 ? requireIssueNumber(command) : null;
    if (missing) return { command, text: missing, status: 'needs_input' as const };
    const results = [];
    for (const issueNumber of issueNumbers) {
      const result = await requestOpsIssueDetails(issueNumber, input.phone || undefined);
      results.push(`#${issueNumber}: ${formatDispatchResult(result.dispatch)}`);
    }
    return {
      command,
      status: 'ok' as const,
      text: [
        issueNumbers.length === 1
          ? `Mais detalhes solicitados na issue #${issueNumbers[0]}.`
          : `Solicitei mais detalhes em ${issueNumbers.length} issues.`,
        ...results,
        ...issueNumbers.map((issueNumber) => getGitHubIssueUrl(issueNumber)),
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
