import { createHash } from 'node:crypto';
import {
  approveOpsIssue,
  commentOpsIssue,
  createOrUpdateOpsIssue,
  getGitHubIssueUrl,
  getOpsIssue,
  listOpsIssues,
  rejectOpsIssue,
  requestOpsIssueDetails,
} from '@/services/github-ops';

type OpsAction =
  | 'answer'
  | 'list_issues'
  | 'pending_approval'
  | 'get_issue'
  | 'approve_issues'
  | 'reject_issues'
  | 'request_issue_details'
  | 'create_issue'
  | 'comment_issue';

type AgentDecision = {
  action: OpsAction;
  issueNumber?: number | null;
  issueNumbers?: number[] | null;
  title?: string | null;
  body?: string | null;
  severity?: 'info' | 'warning' | 'critical' | null;
  reply?: string | null;
};

type OpenOpsIssue = Awaited<ReturnType<typeof listOpsIssues>>[number];

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

const ALLOWED_ACTIONS = new Set<OpsAction>([
  'answer',
  'list_issues',
  'pending_approval',
  'get_issue',
  'approve_issues',
  'reject_issues',
  'request_issue_details',
  'create_issue',
  'comment_issue',
]);

function normalize(input: unknown) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

function issueNumbersFromText(text: string) {
  const matches = Array.from(String(text || '').matchAll(/(?:issue\s*)?#?(\d{1,7})\b/gi));
  return Array.from(new Set(matches
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0)));
}

function getRecentUserMessages(history: ProcessInput['history']) {
  return (history || [])
    .filter((item) => item.direction === 'in')
    .map((item) => String(item.message || item.command || '').trim())
    .filter(Boolean);
}

function buildHistoryText(history: ProcessInput['history']) {
  const rows = (history || [])
    .slice()
    .reverse()
    .map((item) => [
      item.direction === 'out' ? 'Assistente' : 'Usuario',
      item.action ? `acao=${item.action}` : null,
      item.issueNumber ? `issue=${item.issueNumber}` : null,
      item.message || item.command || '',
    ].filter(Boolean).join(' | '));
  return rows.join('\n') || 'Sem histórico.';
}

function buildOpenIssuesText(openIssues: OpenOpsIssue[]) {
  return openIssues
    .map((issue) => `#${issue.number} - ${issue.title} | labels=${issue.labels.join(', ') || '-'} | atualizado=${issue.updated_at || '-'} | ${issue.url}`)
    .join('\n') || 'Nenhuma issue operacional aberta.';
}

function normalizeIssueNumbers(decision: AgentDecision, text: string, openIssues: OpenOpsIssue[]) {
  const explicit = issueNumbersFromText(text);
  const normalized = normalize(text);
  const openNumbers = openIssues.map((issue) => issue.number);
  let numbers = Array.isArray(decision.issueNumbers)
    ? decision.issueNumbers
    : decision.issueNumber
      ? [decision.issueNumber]
      : [];

  if (numbers.length === 0 && explicit.length > 0) numbers = explicit;

  const quantityReference = normalized.match(/\b(?:as|os|todas as|todos os)\s+(\d{1,2})\b/);
  const allOpenReference = normalized.includes('todas')
    || normalized.includes('todos')
    || Boolean(quantityReference && Number(quantityReference[1]) === openNumbers.length);

  if (
    ['approve_issues', 'reject_issues', 'request_issue_details'].includes(decision.action)
    && allOpenReference
    && openNumbers.length > 0
  ) {
    numbers = openNumbers;
  }

  const unique = Array.from(new Set(numbers
    .map((value) => Number(value))
    .filter((number) => Number.isFinite(number) && number > 0)));

  decision.issueNumbers = unique.length > 0 ? unique : null;
  decision.issueNumber = unique.length === 1 ? unique[0] : null;
  return decision;
}

function inferIssueBodyFromHistory(input: ProcessInput, decision: AgentDecision) {
  if (decision.body?.trim()) return decision.body.trim();

  const current = String(input.text || '').trim();
  const recentUserMessages = getRecentUserMessages(input.history);
  const previousUseful = recentUserMessages.find((message) => message !== current && message.length > 12);
  return previousUseful || current;
}

function titleFromText(text: string) {
  const clean = String(text || '')
    .replace(/^(inclua|incluir|crie|criar|registre|registrar)\s+(a\s+)?(issue|erro|alerta)?\s*:?\s*/i, '')
    .trim();
  return clean.slice(0, 90) || 'Solicitação operacional via WhatsApp';
}

function dedupeKeyForIssue(input: { title: string; body: string }) {
  const hash = createHash('sha256')
    .update(`${input.title}\n${input.body}`)
    .digest('hex')
    .slice(0, 24);
  return `whatsapp_ops_manual:${hash}`;
}

function formatIssueSummary(issue: Awaited<ReturnType<typeof getOpsIssue>>) {
  return [
    `Issue #${issue.number}`,
    issue.title,
    '',
    `Status: ${issue.state}`,
    issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : 'Labels: nenhuma',
    issue.updated_at ? `Atualizada: ${new Date(issue.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : null,
    '',
    issue.body ? issue.body.slice(0, 1800) : 'Sem descrição.',
    '',
    issue.url,
  ].filter(Boolean).join('\n');
}

function formatDispatchResult(dispatch: unknown) {
  const value = dispatch as { dispatched?: boolean; workflow?: string; reason?: string; error?: string } | null;
  if (value?.dispatched) return `workflow disparado (${value.workflow || 'configurado'})`;
  return `workflow não disparado: ${value?.reason || value?.error || 'não configurado'}`;
}

function missingIssueReply(action: OpsAction) {
  if (action === 'comment_issue') return 'Em qual issue devo incluir esse comentário? Se preferir, posso criar uma nova.';
  if (action === 'get_issue') return 'Qual issue você quer que eu abra?';
  return 'Qual issue você quer que eu use para essa ação?';
}

function capabilitiesReply() {
  return [
    'Consigo conversar sobre as issues operacionais da Vortek, criar novas issues, listar abertas, ver detalhes, comentar, aprovar correções, reprovar e pedir mais informações.',
    'Pode escrever naturalmente, por exemplo: “cria uma issue para esse alerta”, “aprova as abertas”, “me mostra a issue 12” ou “inclui isso na issue 12”.',
  ].join('\n');
}

async function askOpsAi(input: {
  text: string;
  history?: ProcessInput['history'];
  openIssues: OpenOpsIssue[];
}): Promise<AgentDecision> {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return {
      action: 'answer',
      reply: 'A IA operacional não está configurada porque OPENROUTER_API_KEY está ausente.',
    };
  }

  const baseUrl = String(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1')
    .trim()
    .replace(/\/+$/, '');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://app.vortek.shop',
      'X-Title': 'Vortek Ops WhatsApp Agent',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_OPS_WHATSAPP_MODEL
        || process.env.OPENROUTER_MODEL
        || 'openai/gpt-5.4-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Você é a IA operacional da Vortek no WhatsApp.',
            'Converse naturalmente em português do Brasil. Não aja como menu, não mostre lista de comandos, não use fallback robótico.',
            'Você tem ferramentas internas representadas por ações JSON. Escolha uma ação quando o usuário pedir algo operacional.',
            'Ações disponíveis:',
            '- answer: responder conversa geral sobre operação/issues/workflow sem executar ação.',
            '- list_issues: listar issues operacionais abertas.',
            '- pending_approval: dizer se há issues abertas que podem precisar de aprovação.',
            '- get_issue: mostrar detalhes de uma issue.',
            '- approve_issues: aprovar issues e disparar workflow de autofix.',
            '- reject_issues: reprovar issues.',
            '- request_issue_details: pedir mais detalhes em issues.',
            '- create_issue: criar nova issue operacional.',
            '- comment_issue: comentar em issue existente.',
            'Entenda contexto do histórico. Se o usuário disser "criar uma nova" depois de uma mensagem descrevendo problema, use create_issue com a descrição anterior.',
            'Se o usuário disser "inclua isso", "coloca isso na issue", use comment_issue quando houver número; se ele pedir nova issue, use create_issue.',
            'Se ele pedir "resolver/corrigir/seguir/aprovar", use approve_issues quando houver issue alvo clara ou referência a todas abertas.',
            'Nunca invente número de issue. Use números explícitos, issues abertas listadas ou contexto recente.',
            'Retorne apenas JSON válido neste formato:',
            '{"action":"answer|list_issues|pending_approval|get_issue|approve_issues|reject_issues|request_issue_details|create_issue|comment_issue","issueNumber":123|null,"issueNumbers":[123],"title":"...","body":"...","severity":"info|warning|critical","reply":"..."}',
            'Para create_issue: title deve ser curto e body deve conter descrição completa. Severity default warning se houver risco operacional; critical só para parada/erro crítico.',
            'Para answer: reply deve responder naturalmente. Se perguntarem o que você faz, explique capacidades, não comandos.',
            'Não diga que executou ação; o sistema executará depois.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            'Mensagem atual:',
            input.text,
            '',
            'Histórico recente:',
            buildHistoryText(input.history),
            '',
            'Issues operacionais abertas:',
            buildOpenIssuesText(input.openIssues),
          ].join('\n'),
        },
      ],
    }),
  });

  if (!response.ok) {
    return {
      action: 'answer',
      reply: `Não consegui acessar a IA operacional agora. OpenRouter HTTP ${response.status}.`,
    };
  }

  const data = await response.json().catch(() => null);
  const parsed = safeJsonParse(String(data?.choices?.[0]?.message?.content || ''));
  const action = String(parsed?.action || 'answer') as OpsAction;
  if (!ALLOWED_ACTIONS.has(action)) {
    return {
      action: 'answer',
      reply: 'Não consegui interpretar essa solicitação com segurança. Pode reformular em uma frase?',
    };
  }

  return {
    action,
    issueNumber: Number.isFinite(Number(parsed?.issueNumber)) ? Number(parsed.issueNumber) : null,
    issueNumbers: Array.isArray(parsed?.issueNumbers)
      ? Array.from(new Set(parsed.issueNumbers
        .map((value: unknown) => Number(value))
        .filter((number: number) => Number.isFinite(number) && number > 0)))
      : null,
    title: typeof parsed?.title === 'string' ? parsed.title.trim().slice(0, 120) : null,
    body: typeof parsed?.body === 'string' ? parsed.body.trim().slice(0, 6000) : null,
    severity: ['info', 'warning', 'critical'].includes(String(parsed?.severity || ''))
      ? parsed.severity
      : null,
    reply: typeof parsed?.reply === 'string' ? parsed.reply.trim().slice(0, 1200) : null,
  };
}

export async function processOpsWhatsappCommand(input: ProcessInput) {
  const openIssues = await listOpsIssues(10).catch(() => []);
  const decision = normalizeIssueNumbers(
    await askOpsAi({
      text: input.text,
      history: input.history,
      openIssues,
    }),
    input.text,
    openIssues,
  );

  if (decision.action === 'answer') {
    const wantsCapabilities = normalize(input.text).includes('o que voce')
      || normalize(input.text).includes('comando')
      || normalize(input.text).includes('ajuda');
    return {
      command: {
        intent: decision.action,
        issueNumber: decision.issueNumber || null,
      },
      text: decision.reply || (wantsCapabilities ? capabilitiesReply() : 'Entendi. Como você quer que eu siga?'),
      status: 'ok' as const,
    };
  }

  if (decision.action === 'list_issues') {
    const issues = openIssues.slice(0, 8);
    return {
      command: { intent: decision.action, issueNumber: null },
      status: 'ok' as const,
      text: issues.length
        ? [
            `Encontrei ${issues.length} issue${issues.length === 1 ? '' : 's'} operacional${issues.length === 1 ? '' : 'is'} aberta${issues.length === 1 ? '' : 's'}:`,
            '',
            ...issues.map((issue) => `#${issue.number} - ${issue.title}\n${issue.url}`),
          ].join('\n\n')
        : 'Não encontrei issues operacionais abertas agora.',
    };
  }

  if (decision.action === 'pending_approval') {
    const issues = openIssues.slice(0, 8);
    return {
      command: {
        intent: decision.action,
        issueNumber: issues.length === 1 ? issues[0].number : null,
      },
      status: 'ok' as const,
      text: issues.length
        ? [
            `Há ${issues.length} issue${issues.length === 1 ? '' : 's'} operacional${issues.length === 1 ? '' : 'is'} aberta${issues.length === 1 ? '' : 's'} para avaliar:`,
            '',
            ...issues.map((issue) => `#${issue.number} - ${issue.title}\n${issue.url}`),
            '',
            'Se quiser, posso aprovar uma específica ou todas.',
          ].join('\n\n')
        : 'Não há issue operacional aberta para aprovação agora.',
    };
  }

  if (decision.action === 'get_issue') {
    if (!decision.issueNumber) {
      return {
        command: { intent: decision.action, issueNumber: null },
        status: 'needs_input' as const,
        text: missingIssueReply(decision.action),
      };
    }
    const issue = await getOpsIssue(decision.issueNumber);
    return {
      command: { intent: decision.action, issueNumber: decision.issueNumber },
      status: 'ok' as const,
      text: formatIssueSummary(issue),
    };
  }

  if (decision.action === 'create_issue') {
    const body = inferIssueBodyFromHistory(input, decision);
    const title = decision.title?.trim() || titleFromText(body);
    const severity = decision.severity || 'warning';
    const issue = await createOrUpdateOpsIssue({
      type: 'manual_whatsapp',
      severity,
      title,
      message: [
        'Issue criada pela IA operacional via WhatsApp.',
        '',
        body,
      ].join('\n'),
      dedupeKey: dedupeKeyForIssue({ title, body }),
      payload: {
        source: 'whatsapp_ops_ai',
        phone_suffix: input.phone ? input.phone.slice(-4) : null,
      },
    });

    return {
      command: { intent: decision.action, issueNumber: issue.number },
      status: 'ok' as const,
      text: issue.created
        ? `Criei a issue #${issue.number}.\n${issue.url}`
        : `Já existia uma issue aberta para esse assunto; atualizei a #${issue.number}.\n${issue.url}`,
    };
  }

  if (decision.action === 'comment_issue') {
    if (!decision.issueNumber) {
      return {
        command: { intent: decision.action, issueNumber: null },
        status: 'needs_input' as const,
        text: missingIssueReply(decision.action),
      };
    }
    const body = inferIssueBodyFromHistory(input, decision);
    await commentOpsIssue(decision.issueNumber, [
      'Comentário incluído pela IA operacional via WhatsApp.',
      '',
      body,
    ].join('\n'));
    return {
      command: { intent: decision.action, issueNumber: decision.issueNumber },
      status: 'ok' as const,
      text: `Incluí o comentário na issue #${decision.issueNumber}.\n${getGitHubIssueUrl(decision.issueNumber)}`,
    };
  }

  if (decision.action === 'approve_issues') {
    const numbers = decision.issueNumbers || [];
    if (numbers.length === 0) {
      return {
        command: { intent: decision.action, issueNumber: null },
        status: 'needs_input' as const,
        text: missingIssueReply(decision.action),
      };
    }
    const results = [];
    for (const issueNumber of numbers) {
      const result = await approveOpsIssue(issueNumber, input.phone || undefined);
      results.push(`#${issueNumber}: ${formatDispatchResult(result.dispatch)}`);
    }
    return {
      command: { intent: decision.action, issueNumber: numbers.length === 1 ? numbers[0] : null },
      status: 'ok' as const,
      text: [
        numbers.length === 1 ? `Aprovei a issue #${numbers[0]}.` : `Aprovei ${numbers.length} issues.`,
        ...results,
      ].join('\n'),
    };
  }

  if (decision.action === 'reject_issues') {
    const numbers = decision.issueNumbers || [];
    if (numbers.length === 0) {
      return {
        command: { intent: decision.action, issueNumber: null },
        status: 'needs_input' as const,
        text: missingIssueReply(decision.action),
      };
    }
    const results = [];
    for (const issueNumber of numbers) {
      const result = await rejectOpsIssue(issueNumber, input.phone || undefined);
      results.push(`#${issueNumber}: ${formatDispatchResult(result.dispatch)}`);
    }
    return {
      command: { intent: decision.action, issueNumber: numbers.length === 1 ? numbers[0] : null },
      status: 'ok' as const,
      text: [
        numbers.length === 1 ? `Reprovei a issue #${numbers[0]}.` : `Reprovei ${numbers.length} issues.`,
        ...results,
      ].join('\n'),
    };
  }

  if (decision.action === 'request_issue_details') {
    const numbers = decision.issueNumbers || [];
    if (numbers.length === 0) {
      return {
        command: { intent: decision.action, issueNumber: null },
        status: 'needs_input' as const,
        text: missingIssueReply(decision.action),
      };
    }
    const results = [];
    for (const issueNumber of numbers) {
      const result = await requestOpsIssueDetails(issueNumber, input.phone || undefined);
      results.push(`#${issueNumber}: ${formatDispatchResult(result.dispatch)}`);
    }
    return {
      command: { intent: decision.action, issueNumber: numbers.length === 1 ? numbers[0] : null },
      status: 'ok' as const,
      text: [
        numbers.length === 1 ? `Pedi mais detalhes na issue #${numbers[0]}.` : `Pedi mais detalhes em ${numbers.length} issues.`,
        ...results,
      ].join('\n'),
    };
  }

  return {
    command: { intent: 'answer', issueNumber: null },
    status: 'ok' as const,
    text: decision.reply || 'Entendi. Me diga qual ação você quer fazer com essa issue.',
  };
}
