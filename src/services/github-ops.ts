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
  return sanitizeOpsText(input, max);
}

const SENSITIVE_KEY = /(?:^|_)(?:access_?token|refresh_?token|token|secret|password|authorization|cookie|api_?key|private_?key|cpf|cnpj|documento|phone|telefone|email|chave_?acesso)(?:$|_)/i;
const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g,
  /\b(?:cfat_|APP_USR-|TEST-)[A-Za-z0-9_-]{12,}\b/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
  /(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?!\d)/g,
  /(?<!\d)\d{11,14}(?!\d)/g,
];

export function sanitizeOpsText(input: unknown, max = 4000) {
  let value = String(input ?? '');
  for (const pattern of SENSITIVE_VALUE_PATTERNS) value = value.replace(pattern, '[dado protegido]');
  return value.slice(0, max);
}

export function sanitizeOpsPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[conteúdo resumido]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return sanitizeOpsText(value, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeOpsPayload(item, depth + 1));
  if (typeof value !== 'object') return sanitizeOpsText(value, 500);
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[dado protegido]' : sanitizeOpsPayload(nested, depth + 1);
  }
  return result;
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
  const search = await githubRequest<{ items?: GitHubIssue[] }>(`/search/issues?q=${searchQuery}&per_page=10`);
  let existing: GitHubIssue | null = null;
  for (const item of search.items || []) {
    if (item.pull_request) continue;
    const issue = await githubRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues/${item.number}`);
    if (issue.body?.includes(fingerprint)) {
      existing = issue;
      break;
    }
  }

  const safeTitle = sanitizeOpsText(input.title, 180);
  const safeMessage = sanitizeOpsText(input.message, 3000);
  const safePayload = input.payload ? sanitizeOpsPayload(input.payload) : null;
  const body = [
    `## ${safeTitle}`,
    '',
    safeMessage,
    '',
    '## Contexto',
    '',
    `- Tipo: ${input.type}`,
    `- Severidade: ${input.severity}`,
    `- Dedupe: ${input.dedupeKey}`,
    `- Fingerprint: ${fingerprint}`,
    `- Criado em: ${new Date().toISOString()}`,
    '',
    safePayload ? '## Informações operacionais' : null,
    safePayload ? '```json' : null,
    safePayload ? JSON.stringify(safePayload, null, 2).slice(0, 6000) : null,
    safePayload ? '```' : null,
  ].filter(Boolean).join('\n');

  if (existing) {
    const comment = [
      'Novo evento com mesmo fingerprint.',
      '',
      safeMessage,
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
      title: `[${input.severity.toUpperCase()}] ${safeTitle}`,
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

export async function findOpenOpsIssueByFingerprint(fingerprint: string) {
  const { owner, repo } = getGitHubConfig();
  const cleanFingerprint = String(fingerprint || '').trim();
  if (!cleanFingerprint) return null;
  const searchQuery = encodeURIComponent(`repo:${owner}/${repo} is:issue is:open "${cleanFingerprint}"`);
  const search = await githubRequest<{ items?: GitHubIssue[] }>(`/search/issues?q=${searchQuery}&per_page=10`);
  let issue: GitHubIssue | null = null;
  for (const item of search.items || []) {
    if (item.pull_request) continue;
    const candidate = await githubRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues/${item.number}`);
    if (candidate.body?.includes(cleanFingerprint)) {
      issue = candidate;
      break;
    }
  }
  if (!issue) return null;
  return {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    labels: (issue.labels || []).map(labelName).filter(Boolean),
  };
}

export async function commentOpsIssue(issueNumber: number, body: string) {
  const { owner, repo } = getGitHubConfig();
  return githubRequest<{ html_url: string }>(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body: sanitizeOpsText(body, 4000) },
  });
}

export async function resolveRecoveredCriticalJobOpsIssues(
  fingerprints: string[],
  message: string,
) {
  const requested = Array.from(new Set(fingerprints.map((value) => String(value).trim()).filter(Boolean)));
  if (!requested.length) return { resolved: 0 };
  const { owner, repo } = getGitHubConfig();
  const labels = encodeURIComponent('ops:error,alert:critical_error');
  const issues = await githubRequest<GitHubIssue[]>(
    `/repos/${owner}/${repo}/issues?state=open&labels=${labels}&per_page=100`,
  );
  let resolved = 0;
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const fingerprint = requested.find((value) => String(issue.body || '').includes(value));
    if (!fingerprint) continue;
    await commentOpsIssue(issue.number, `${message}\n- Ocorrência: ${fingerprint}`);
    await githubRequest<GitHubIssue>(`/repos/${owner}/${repo}/issues/${issue.number}`, {
      method: 'PATCH',
      body: { state: 'closed', state_reason: 'completed' },
    });
    resolved += 1;
  }
  return { resolved };
}

export async function resolveOpenIntegrationOpsIssues(message: string) {
  const { owner, repo } = getGitHubConfig();
  const labels = encodeURIComponent('ops:error,alert:integration_status');
  const issues = await githubRequest<GitHubIssue[]>(
    `/repos/${owner}/${repo}/issues?state=open&labels=${labels}&per_page=100`,
  );
  let resolved = 0;

  for (const issue of issues) {
    if (
      issue.pull_request ||
      !String(issue.body || '').includes(
        'vortek-fingerprint:integration_status:',
      )
    ) {
      continue;
    }

    await commentOpsIssue(issue.number, message);
    await githubRequest<GitHubIssue>(
      `/repos/${owner}/${repo}/issues/${issue.number}`,
      {
        method: 'PATCH',
        body: { state: 'closed', state_reason: 'completed' },
      },
    );
    resolved += 1;
  }

  return { resolved };
}

export async function resolveRecoveredScheduledTaskOpsIssues(
  taskKeys: string[],
  message: string,
) {
  const cleanTaskKeys = Array.from(new Set(taskKeys.map((key) => String(key).trim()).filter(Boolean)));
  if (!cleanTaskKeys.length) return { resolved: 0 };

  const { owner, repo } = getGitHubConfig();
  const labels = encodeURIComponent('ops:error,alert:critical_error');
  const issues = await githubRequest<GitHubIssue[]>(
    `/repos/${owner}/${repo}/issues?state=open&labels=${labels}&per_page=100`,
  );
  let resolved = 0;

  for (const issue of issues) {
    if (issue.pull_request) continue;
    const taskKey = cleanTaskKeys.find((key) =>
      String(issue.body || '').includes(
        `vortek-fingerprint:critical_error:sync_schedule_stale:${key}`,
      ),
    );
    if (!taskKey) continue;

    await commentOpsIssue(issue.number, `${message}\n- Task: ${taskKey}`);
    await githubRequest<GitHubIssue>(
      `/repos/${owner}/${repo}/issues/${issue.number}`,
      {
        method: 'PATCH',
        body: { state: 'closed', state_reason: 'completed' },
      },
    );
    resolved += 1;
  }

  return { resolved };
}
