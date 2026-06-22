type GitHubIssue = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  body?: string | null;
  labels?: Array<string | { name?: string }>;
  pull_request?: unknown;
  created_at?: string;
  updated_at?: string;
};

type GitHubRequestOptions = {
  method?: string;
  body?: unknown;
};

function getGitHubConfig() {
  const token = String(process.env.GITHUB_OPS_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
  const owner = String(process.env.GITHUB_OWNER || repository.split('/')[0] || '').trim();
  const repo = String(process.env.GITHUB_REPO || repository.split('/')[1] || '').trim();

  if (!token) throw new Error('GITHUB_OPS_TOKEN não configurado');
  if (!owner || !repo) throw new Error('GITHUB_OWNER/GITHUB_REPO não configurados');

  return { token, owner, repo };
}

function safeText(input: unknown, max = 4000) {
  return String(input ?? '').slice(0, max);
}

function labelName(label: string | { name?: string }) {
  return typeof label === 'string' ? label : String(label?.name || '');
}

async function githubRequest<T>(path: string, options: GitHubRequestOptions = {}): Promise<T> {
  const { token } = getGitHubConfig();
  const res = await fetch(`https://api.github.com${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = parsed?.message || text || `GitHub HTTP ${res.status}`;
    throw new Error(`GitHub: ${message}`);
  }
  return parsed as T;
}

export function getGitHubIssueUrl(issueNumber: number) {
  const { owner, repo } = getGitHubConfig();
  return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
}

export async function listOpsIssues(limit = 8) {
  const { owner, repo } = getGitHubConfig();
  const labels = encodeURIComponent(String(process.env.GITHUB_OPS_ERROR_LABELS || 'ops:error').trim());
  const issues = await githubRequest<GitHubIssue[]>(
    `/repos/${owner}/${repo}/issues?state=open&labels=${labels}&per_page=${Math.max(1, Math.min(limit, 20))}`,
  );

  return issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      labels: (issue.labels || []).map(labelName).filter(Boolean),
      updated_at: issue.updated_at || null,
    }));
}

function buildIssueFingerprint(input: { type: string; dedupeKey: string }) {
  return `vortek-fingerprint:${input.type}:${input.dedupeKey}`;
}

export async function createOrUpdateOpsIssue(input: {
  type: string;
  severity: string;
  title: string;
  message: string;
  dedupeKey: string;
  payload?: Record<string, any>;
}) {
  const { owner, repo } = getGitHubConfig();
  const fingerprint = buildIssueFingerprint({ type: input.type, dedupeKey: input.dedupeKey });
  const labels = Array.from(new Set([
    'ops:error',
    `severity:${input.severity}`,
    `alert:${input.type}`,
    'auto-triage',
  ]));
  const searchQuery = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open "${fingerprint}"`);
  const search = await githubRequest<{ items?: GitHubIssue[] }>(`/search/issues?q=${searchQuery}&per_page=1`);
  const existing = search.items?.[0] || null;

  const body = [
    `## ${input.title}`,
    '',
    input.message,
    '',
    '## Contexto',
    '',
    `- Tipo: ${input.type}`,
    `- Severidade: ${input.severity}`,
    `- Dedupe: ${input.dedupeKey}`,
    `- Fingerprint: ${fingerprint}`,
    `- Criado em: ${new Date().toISOString()}`,
    '',
    input.payload ? '## Payload sanitizado' : null,
    input.payload ? '```json' : null,
    input.payload ? JSON.stringify(input.payload, null, 2).slice(0, 6000) : null,
    input.payload ? '```' : null,
  ].filter(Boolean).join('\n');

  if (existing) {
    const comment = [
      'Novo evento com mesmo fingerprint.',
      '',
      input.message,
      '',
      `Data: ${new Date().toISOString()}`,
    ].join('\n');
    await commentOpsIssue(existing.number, comment);
    return {
      created: false,
      number: existing.number,
      url: existing.html_url,
      fingerprint,
    };
  }

  const created = await githubRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: {
      title: `[${input.severity.toUpperCase()}] ${input.title}`,
      body,
      labels,
    },
  });

  return {
    created: true,
    number: created.number,
    url: created.html_url,
    fingerprint,
  };
}

export async function getOpsIssue(issueNumber: number) {
  const { owner, repo } = getGitHubConfig();
  const issue = await githubRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`);
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    state: issue.state,
    body: safeText(issue.body, 3500),
    labels: (issue.labels || []).map(labelName).filter(Boolean),
    updated_at: issue.updated_at || null,
  };
}

export async function commentOpsIssue(issueNumber: number, body: string) {
  const { owner, repo } = getGitHubConfig();
  return githubRequest<{ html_url: string }>(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export async function addOpsIssueLabels(issueNumber: number, labels: string[]) {
  const { owner, repo } = getGitHubConfig();
  return githubRequest<Array<{ name: string }>>(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    body: { labels },
  });
}

export async function dispatchOpsWorkflow(action: 'approved' | 'rejected' | 'details_requested', issueNumber: number) {
  const workflow = String(process.env.GITHUB_OPS_WORKFLOW || '').trim();
  if (!workflow) return { dispatched: false, reason: 'GITHUB_OPS_WORKFLOW não configurado' };

  const { owner, repo } = getGitHubConfig();
  const ref = String(process.env.GITHUB_OPS_WORKFLOW_REF || 'main').trim() || 'main';
  await githubRequest(`/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    body: {
      ref,
      inputs: {
        action,
        issue_number: String(issueNumber),
        source: 'whatsapp',
      },
    },
  });
  return { dispatched: true, workflow, ref };
}

export async function approveOpsIssue(issueNumber: number, actorPhone?: string) {
  const comment = [
    'Aprovado via WhatsApp operacional.',
    '',
    `Issue: #${issueNumber}`,
    actorPhone ? `Aprovador: telefone final ${actorPhone.slice(-4)}` : null,
    `Data: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  await addOpsIssueLabels(issueNumber, ['approved-by-whatsapp', 'ops:approved']);
  await commentOpsIssue(issueNumber, comment);
  const dispatch = await dispatchOpsWorkflow('approved', issueNumber).catch((err: any) => ({
    dispatched: false,
    error: err?.message || 'Falha ao disparar workflow',
  }));
  return { issueNumber, status: 'approved', dispatch };
}

export async function rejectOpsIssue(issueNumber: number, actorPhone?: string) {
  const comment = [
    'Reprovado via WhatsApp operacional.',
    '',
    `Issue: #${issueNumber}`,
    actorPhone ? `Reprovador: telefone final ${actorPhone.slice(-4)}` : null,
    `Data: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  await addOpsIssueLabels(issueNumber, ['rejected-by-whatsapp', 'ops:rejected']);
  await commentOpsIssue(issueNumber, comment);
  const dispatch = await dispatchOpsWorkflow('rejected', issueNumber).catch((err: any) => ({
    dispatched: false,
    error: err?.message || 'Falha ao disparar workflow',
  }));
  return { issueNumber, status: 'rejected', dispatch };
}

export async function requestOpsIssueDetails(issueNumber: number, actorPhone?: string) {
  const comment = [
    'Mais detalhes solicitados via WhatsApp operacional.',
    '',
    `Issue: #${issueNumber}`,
    actorPhone ? `Solicitante: telefone final ${actorPhone.slice(-4)}` : null,
    `Data: ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n');

  await addOpsIssueLabels(issueNumber, ['needs-more-details']);
  await commentOpsIssue(issueNumber, comment);
  const dispatch = await dispatchOpsWorkflow('details_requested', issueNumber).catch((err: any) => ({
    dispatched: false,
    error: err?.message || 'Falha ao disparar workflow',
  }));
  return { issueNumber, status: 'details_requested', dispatch };
}
