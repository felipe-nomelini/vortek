import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';
const action = process.env.OPS_ACTION || '';
const issueNumber = Number(process.env.OPS_ISSUE_NUMBER || 0);
const source = process.env.OPS_SOURCE || 'whatsapp';
const runId = process.env.OPS_RUN_ID || String(Date.now());

if (!repo.includes('/')) throw new Error('GITHUB_REPOSITORY inválido');
if (!token) throw new Error('GITHUB_TOKEN ausente');
if (!issueNumber) throw new Error('OPS_ISSUE_NUMBER inválido');

const [owner, repoName] = repo.split('/');

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    ...options,
  });
}

async function github(path, options = {}) {
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
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${data?.message || text}`);
  }
  return data;
}

async function commentIssue(body) {
  await github(`/repos/${owner}/${repoName}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

function truncate(value, max = 6000) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function repoContext() {
  const files = run('git', ['ls-files'])
    .split('\n')
    .filter(Boolean)
    .filter((file) => (
      file === 'package.json'
      || file === 'tsconfig.json'
      || file.startsWith('src/')
      || file.startsWith('scripts/')
      || file.startsWith('docs/')
      || file.startsWith('.github/')
    ))
    .slice(0, 500);

  return [
    'package.json:',
    truncate(readFileSync('package.json', 'utf8'), 3000),
    '',
    'Arquivos relevantes do repositório:',
    files.join('\n'),
  ].join('\n');
}

async function askOpenRouter(issue, comments) {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    return {
      status: 'needs_human',
      summary: 'OPENROUTER_API_KEY não configurada nos GitHub Actions secrets.',
      root_cause: 'O workflow foi disparado, mas não consegue chamar IA para analisar/corrigir.',
      validation: 'Configure o secret OPENROUTER_API_KEY no repositório.',
      patch: '',
    };
  }

  const model = process.env.OPENROUTER_OPS_AUTOFIX_MODEL || 'openai/gpt-5.4-mini';
  const prompt = [
    'Você é um agente de engenharia do projeto Vortek.',
    'Analise a issue operacional e, se houver uma correção pequena e segura, gere um patch unified diff.',
    'Responda somente JSON válido:',
    '{"status":"patch|needs_human|no_change","summary":"...","root_cause":"...","validation":"...","patch":"..."}',
    '',
    'Regras:',
    '- Não invente contexto.',
    '- Só gere patch se o erro apontar causa provável no código listado.',
    '- Patch precisa ser unified diff aplicável por git apply.',
    '- Mudança deve ser mínima.',
    '- Se precisar de logs, credenciais ou decisão humana, use needs_human.',
    '',
    'Issue:',
    `#${issue.number} ${issue.title}`,
    truncate(issue.body, 8000),
    '',
    'Comentários recentes:',
    truncate(comments.map((comment) => `- ${comment.user?.login}: ${comment.body}`).join('\n\n'), 8000),
    '',
    repoContext(),
  ].join('\n');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://app.vortek.shop',
      'X-Title': 'Vortek Ops Autofix',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Responda somente JSON válido.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  const parsed = safeJsonParse(payload?.choices?.[0]?.message?.content || '');
  if (!parsed?.status) throw new Error('Resposta IA inválida');
  return parsed;
}

function applyPatch(patch) {
  const cleanPatch = String(patch || '').trim();
  if (!cleanPatch) return false;
  writeFileSync('.ops-autofix.patch', `${cleanPatch}\n`);
  run('git', ['apply', '--check', '.ops-autofix.patch']);
  run('git', ['apply', '.ops-autofix.patch']);
  return run('git', ['status', '--porcelain']).trim().length > 0;
}

async function createPullRequest(issue, analysis) {
  const branch = `ops/autofix-issue-${issue.number}-${runId}`;
  run('git', ['config', 'user.name', 'vortek-ops-bot']);
  run('git', ['config', 'user.email', 'actions@github.com']);
  run('git', ['checkout', '-b', branch]);
  run('git', ['add', '.']);
  run('git', ['commit', '-m', `fix: ops issue ${issue.number}`]);
  run('git', ['push', 'origin', `HEAD:${branch}`]);

  const pr = await github(`/repos/${owner}/${repoName}/pulls`, {
    method: 'POST',
    body: {
      title: `fix: ops issue #${issue.number}`,
      head: branch,
      base: 'main',
      body: [
        `Correção automática aprovada via ${source}.`,
        '',
        `Issue: #${issue.number}`,
        '',
        'Resumo:',
        analysis.summary || 'Sem resumo.',
        '',
        'Causa provável:',
        analysis.root_cause || 'Não informada.',
        '',
        'Validação:',
        analysis.validation || 'npm run typecheck',
      ].join('\n'),
    },
  });

  return pr;
}

async function main() {
  const issue = await github(`/repos/${owner}/${repoName}/issues/${issueNumber}`);
  const comments = await github(`/repos/${owner}/${repoName}/issues/${issueNumber}/comments?per_page=20`);

  if (action === 'rejected') {
    await commentIssue(`Workflow Ops Autofix não executado: issue rejeitada via ${source}.`);
    return;
  }

  if (action === 'details_requested') {
    await commentIssue([
      'Mais detalhes solicitados pelo WhatsApp.',
      '',
      'Para permitir correção automática, inclua logs completos, rota/job afetado, erro exato e comportamento esperado.',
    ].join('\n'));
    return;
  }

  if (action !== 'approved') {
    await commentIssue(`Ação não suportada pelo workflow: ${action}`);
    return;
  }

  const analysis = await askOpenRouter(issue, comments);
  if (analysis.status !== 'patch') {
    await commentIssue([
      'Ops Autofix analisou a issue, mas não criou PR.',
      '',
      `Status: ${analysis.status}`,
      '',
      `Resumo: ${analysis.summary || 'Sem resumo.'}`,
      '',
      `Causa provável: ${analysis.root_cause || 'Não informada.'}`,
      '',
      `Validação sugerida: ${analysis.validation || 'Não informada.'}`,
    ].join('\n'));
    return;
  }

  try {
    const changed = applyPatch(analysis.patch);
    if (!changed) {
      await commentIssue('Ops Autofix recebeu patch, mas ele não gerou alterações.');
      return;
    }
    run('npm', ['run', 'typecheck'], { stdio: 'inherit' });
    const pr = await createPullRequest(issue, analysis);
    await commentIssue(`Ops Autofix criou PR: ${pr.html_url}`);
  } catch (err) {
    await commentIssue([
      'Ops Autofix tentou aplicar correção, mas falhou.',
      '',
      `Erro: ${err?.message || err}`,
      '',
      'Nenhum PR foi criado.',
    ].join('\n'));
    throw err;
  }
}

main().catch(async (err) => {
  try {
    await commentIssue(`Ops Autofix falhou: ${err?.message || err}`);
  } catch {
    // ignore secondary failure
  }
  console.error(err);
  process.exit(1);
});
