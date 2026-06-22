import { createHash } from 'node:crypto';
import {
  approveOpsIssue,
  commentOpsIssue,
  createOrUpdateOpsIssue,
  getOpsIssue,
  listOpsIssues,
  rejectOpsIssue,
  requestOpsIssueDetails,
} from '@/services/github-ops';

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

type AgentToolName =
  | 'list_open_issues'
  | 'get_issues'
  | 'create_issue'
  | 'comment_issue'
  | 'approve_issues'
  | 'reject_issues'
  | 'request_more_details';

type AgentToolCall = {
  tool: AgentToolName;
  args?: Record<string, unknown> | null;
};

type AgentResponse = {
  reply?: string | null;
  tool_calls?: AgentToolCall[] | null;
};

type ToolResult = {
  tool: AgentToolName;
  ok: boolean;
  args?: Record<string, unknown> | null;
  data?: unknown;
  error?: string;
};

const TOOL_NAMES = new Set<AgentToolName>([
  'list_open_issues',
  'get_issues',
  'create_issue',
  'comment_issue',
  'approve_issues',
  'reject_issues',
  'request_more_details',
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
  return rows.join('\n') || 'Sem historico.';
}

function buildOpenIssuesText(openIssues: OpenOpsIssue[]) {
  return openIssues
    .map((issue) => `#${issue.number} - ${issue.title} | labels=${issue.labels.join(', ') || '-'} | atualizado=${issue.updated_at || '-'} | ${issue.url}`)
    .join('\n') || 'Nenhuma issue operacional aberta.';
}

function getRecentUserMessages(history: ProcessInput['history']) {
  return (history || [])
    .filter((item) => item.direction === 'in')
    .map((item) => String(item.message || item.command || '').trim())
    .filter(Boolean);
}

function inferBodyFromHistory(input: ProcessInput, explicitBody?: unknown) {
  const body = String(explicitBody || '').trim();
  if (body) return body.slice(0, 6000);

  const current = String(input.text || '').trim();
  const previous = getRecentUserMessages(input.history)
    .find((message) => message !== current && message.length > 12);
  return (previous || current).slice(0, 6000);
}

function titleFromText(text: string) {
  const clean = String(text || '')
    .replace(/^(inclua|incluir|crie|criar|registre|registrar)\s+(a\s+)?(issue|erro|alerta)?\s*:?\s*/i, '')
    .trim();
  return clean.slice(0, 90) || 'Solicitacao operacional via WhatsApp';
}

function dedupeKeyForIssue(input: { title: string; body: string }) {
  const hash = createHash('sha256')
    .update(`${input.title}\n${input.body}`)
    .digest('hex')
    .slice(0, 24);
  return `whatsapp_ops_manual:${hash}`;
}

function dispatchSummary(dispatch: unknown) {
  const value = dispatch as { dispatched?: boolean; workflow?: string; reason?: string; error?: string } | null;
  if (value?.dispatched) return `workflow disparado (${value.workflow || 'configurado'})`;
  return `workflow nao disparado: ${value?.reason || value?.error || 'nao configurado'}`;
}

function resolveIssueNumbers(args: Record<string, unknown> | null | undefined, input: ProcessInput, openIssues: OpenOpsIssue[]) {
  const explicit = issueNumbersFromText(input.text);
  const fromArgs = Array.isArray(args?.issue_numbers)
    ? args.issue_numbers
    : Array.isArray(args?.issues)
      ? args.issues
      : Number.isFinite(Number(args?.issue_number))
        ? [Number(args?.issue_number)]
        : [];

  let numbers = fromArgs
    .map((value) => Number(value))
    .filter((number) => Number.isFinite(number) && number > 0);

  if (numbers.length === 0 && explicit.length > 0) numbers = explicit;

  const normalized = normalize(input.text);
  const openNumbers = openIssues.map((issue) => issue.number);
  const quantityReference = normalized.match(/\b(?:as|os|essas|esses|ultimas|ultimos)\s+(\d{1,2})\b/);
  const wantsAllOpen = normalized.includes('todas')
    || normalized.includes('todos')
    || Boolean(quantityReference && Number(quantityReference[1]) === openNumbers.length);

  if (numbers.length === 0 && wantsAllOpen) numbers = openNumbers;

  return Array.from(new Set(numbers));
}

async function callOpenRouter(input: {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY nao configurada');
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
        || 'openai/gpt-5.5',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: input.messages,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenRouter HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }

  const parsed = safeJsonParse(String(payload?.choices?.[0]?.message?.content || ''));
  if (!parsed) throw new Error('Resposta da IA invalida');
  return parsed as AgentResponse;
}

function systemPrompt() {
  return [
    'Voce e uma IA operacional real da Vortek no WhatsApp.',
    'Objetivo: conversar naturalmente com Felipe e conduzir resolucao de problemas operacionais.',
    'Nao aja como menu. Nao mostre comandos. Nao use resposta robotica. Nao pergunte o que ja esta claro pelo contexto.',
    'Voce pode usar ferramentas internas. Use quantas forem necessarias antes de responder.',
    'Se usuario pedir "as 3", "todas", "processa de novo", "segue", use contexto recente e issues abertas.',
    'Se usuario pedir resultado de varias issues, busque todas e resuma cada uma.',
    'Se usuario pedir resolver/processar/aprovar, aprove/dispare workflow das issues alvo.',
    'Se usuario descrever problema e pedir incluir/criar, crie issue nova com descricao completa.',
    'Se faltar alvo real para acao destrutiva/sensivel, peca so a informacao faltante, em linguagem natural.',
    '',
    'Ferramentas disponiveis:',
    '- list_open_issues: lista issues operacionais abertas.',
    '- get_issues: detalhes de uma ou varias issues. args: {"issue_numbers":[9,10]}',
    '- create_issue: cria issue operacional. args: {"title":"...","body":"...","severity":"info|warning|critical"}',
    '- comment_issue: comenta em issue. args: {"issue_number":9,"body":"..."}',
    '- approve_issues: aprova e dispara autofix. args: {"issue_numbers":[9,10]}',
    '- reject_issues: reprova issues. args: {"issue_numbers":[9]}',
    '- request_more_details: pede mais detalhes em issues. args: {"issue_numbers":[9]}',
    '',
    'Sempre responda JSON valido:',
    '{"reply":"resposta natural ao usuario ou null","tool_calls":[{"tool":"list_open_issues","args":{}}]}',
    'Quando precisar agir, preencha tool_calls e deixe reply null ou curto.',
    'Quando ja tiver resultado suficiente, tool_calls deve ser [] e reply deve ser natural, objetiva e util.',
  ].join('\n');
}

function initialUserPrompt(input: ProcessInput, openIssues: OpenOpsIssue[]) {
  return [
    'Mensagem atual do usuario:',
    input.text,
    '',
    'Historico recente da conversa:',
    buildHistoryText(input.history),
    '',
    'Issues abertas conhecidas agora:',
    buildOpenIssuesText(openIssues),
  ].join('\n');
}

async function executeTool(call: AgentToolCall, input: ProcessInput, openIssues: OpenOpsIssue[]): Promise<ToolResult> {
  const tool = call.tool;
  const args = call.args || {};

  try {
    if (tool === 'list_open_issues') {
      const issues = await listOpsIssues(10);
      return { tool, ok: true, args, data: { issues } };
    }

    if (tool === 'get_issues') {
      const numbers = resolveIssueNumbers(args, input, openIssues);
      if (numbers.length === 0) {
        return { tool, ok: false, args, error: 'Nenhuma issue alvo identificada.' };
      }
      const issues = [];
      for (const issueNumber of numbers.slice(0, 8)) {
        issues.push(await getOpsIssue(issueNumber));
      }
      return { tool, ok: true, args: { ...args, issue_numbers: numbers }, data: { issues } };
    }

    if (tool === 'create_issue') {
      const body = inferBodyFromHistory(input, args.body);
      const title = String(args.title || titleFromText(body)).trim().slice(0, 120);
      const severity = ['info', 'warning', 'critical'].includes(String(args.severity || ''))
        ? String(args.severity)
        : 'warning';
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
      return { tool, ok: true, args: { ...args, title, severity }, data: { issue } };
    }

    if (tool === 'comment_issue') {
      const issueNumber = resolveIssueNumbers(args, input, openIssues)[0];
      if (!issueNumber) return { tool, ok: false, args, error: 'Nenhuma issue alvo identificada.' };
      const body = inferBodyFromHistory(input, args.body);
      const comment = await commentOpsIssue(issueNumber, [
        'Comentario incluido pela IA operacional via WhatsApp.',
        '',
        body,
      ].join('\n'));
      return { tool, ok: true, args: { ...args, issue_number: issueNumber }, data: { issueNumber, comment } };
    }

    if (tool === 'approve_issues') {
      const numbers = resolveIssueNumbers(args, input, openIssues);
      if (numbers.length === 0) return { tool, ok: false, args, error: 'Nenhuma issue alvo identificada.' };
      const results = [];
      for (const issueNumber of numbers.slice(0, 8)) {
        const result = await approveOpsIssue(issueNumber, input.phone || undefined);
        results.push({
          issueNumber,
          status: result.status,
          dispatch: result.dispatch,
          dispatchSummary: dispatchSummary(result.dispatch),
        });
      }
      return { tool, ok: true, args: { ...args, issue_numbers: numbers }, data: { results } };
    }

    if (tool === 'reject_issues') {
      const numbers = resolveIssueNumbers(args, input, openIssues);
      if (numbers.length === 0) return { tool, ok: false, args, error: 'Nenhuma issue alvo identificada.' };
      const results = [];
      for (const issueNumber of numbers.slice(0, 8)) {
        const result = await rejectOpsIssue(issueNumber, input.phone || undefined);
        results.push({
          issueNumber,
          status: result.status,
          dispatch: result.dispatch,
          dispatchSummary: dispatchSummary(result.dispatch),
        });
      }
      return { tool, ok: true, args: { ...args, issue_numbers: numbers }, data: { results } };
    }

    if (tool === 'request_more_details') {
      const numbers = resolveIssueNumbers(args, input, openIssues);
      if (numbers.length === 0) return { tool, ok: false, args, error: 'Nenhuma issue alvo identificada.' };
      const results = [];
      for (const issueNumber of numbers.slice(0, 8)) {
        const result = await requestOpsIssueDetails(issueNumber, input.phone || undefined);
        results.push({
          issueNumber,
          status: result.status,
          dispatch: result.dispatch,
          dispatchSummary: dispatchSummary(result.dispatch),
        });
      }
      return { tool, ok: true, args: { ...args, issue_numbers: numbers }, data: { results } };
    }

    return { tool, ok: false, args, error: 'Ferramenta desconhecida.' };
  } catch (err: any) {
    return { tool, ok: false, args, error: err?.message || 'Erro ao executar ferramenta.' };
  }
}

function normalizeToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      tool: String((item as any)?.tool || '') as AgentToolName,
      args: ((item as any)?.args && typeof (item as any).args === 'object') ? (item as any).args : {},
    }))
    .filter((item) => TOOL_NAMES.has(item.tool))
    .slice(0, 5);
}

function inferCommandFromResults(results: ToolResult[]) {
  const last = results[results.length - 1];
  const data: any = last?.data;
  const issueNumber = data?.issue?.number
    || data?.issueNumber
    || data?.results?.[0]?.issueNumber
    || data?.issues?.[0]?.number
    || null;
  return {
    intent: last?.tool || 'answer',
    issueNumber: Number.isFinite(Number(issueNumber)) ? Number(issueNumber) : null,
  };
}

export async function processOpsWhatsappCommand(input: ProcessInput) {
  const openIssues = await listOpsIssues(10).catch(() => []);
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: initialUserPrompt(input, openIssues) },
  ];
  const toolResults: ToolResult[] = [];

  for (let turn = 0; turn < 4; turn += 1) {
    const ai = await callOpenRouter({ messages });
    const calls = normalizeToolCalls(ai.tool_calls);

    if (calls.length === 0) {
      const reply = String(ai.reply || '').trim();
      return {
        command: inferCommandFromResults(toolResults),
        text: reply || 'Consegui analisar, mas a resposta veio vazia. Me mande de novo em uma frase e eu continuo do contexto.',
        status: 'ok' as const,
      };
    }

    const currentResults: ToolResult[] = [];
    for (const call of calls) {
      currentResults.push(await executeTool(call, input, openIssues));
    }
    toolResults.push(...currentResults);

    messages.push({
      role: 'assistant',
      content: JSON.stringify({ tool_calls: calls }),
    });
    messages.push({
      role: 'user',
      content: [
        'Resultado das ferramentas executadas:',
        JSON.stringify(currentResults, null, 2).slice(0, 12000),
        '',
        'Agora continue como IA operacional. Se precisar de outra ferramenta, chame. Se ja tiver resolvido, responda naturalmente ao usuario com resumo claro e proximo passo.',
      ].join('\n'),
    });
  }

  const final = await callOpenRouter({
    messages: [
      ...messages,
      {
        role: 'user',
        content: [
          'Limite de ferramentas atingido.',
          'Responda agora naturalmente ao usuario com o que foi feito, o que faltou e proximo passo. Nao chame mais ferramentas.',
          JSON.stringify(toolResults, null, 2).slice(0, 12000),
        ].join('\n'),
      },
    ],
  });

  return {
    command: inferCommandFromResults(toolResults),
    text: String(final.reply || '').trim() || 'Executei as verificacoes disponiveis, mas nao consegui montar resposta final clara. Vou precisar revisar manualmente.',
    status: 'ok' as const,
  };
}
