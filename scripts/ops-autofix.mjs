import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const repo = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';
const action = process.env.OPS_ACTION || '';
const issueNumber = Number(process.env.OPS_ISSUE_NUMBER || 0);
const source = process.env.OPS_SOURCE || 'whatsapp';
const runId = process.env.OPS_RUN_ID || String(Date.now());
const chainDepth = Math.max(0, Number(process.env.OPS_CHAIN_DEPTH || 0) || 0);
const maxChainDepth = Math.max(0, Number(process.env.OPS_MAX_CHAIN_DEPTH || 2) || 2);

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

async function closeIssue(reason = 'completed') {
  await github(`/repos/${owner}/${repoName}/issues/${issueNumber}`, {
    method: 'PATCH',
    body: {
      state: 'closed',
      state_reason: reason,
    },
  });
}

function truncate(value, max = 6000) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

function readIfExists(file, max = 6000) {
  if (!existsSync(file)) return '';
  return truncate(readFileSync(file, 'utf8'), max);
}

function normalizeWhatsappChatId(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `${withCountry}@c.us`;
}

async function notifyOps(message) {
  const baseUrl = String(process.env.WAHA_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.WAHA_API_KEY || '').trim();
  const session = String(process.env.WAHA_SESSION || 'default').trim() || 'default';
  const phones = String(process.env.OPS_NOTIFY_PHONES || '21981172939,21970066090')
    .split(',')
    .map((phone) => phone.trim())
    .filter(Boolean);

  if (!baseUrl || !apiKey || phones.length === 0) {
    console.log('WAHA notification skipped: missing config');
    return;
  }

  for (const phone of phones) {
    const chatId = normalizeWhatsappChatId(phone);
    if (!chatId) continue;
    const res = await fetch(`${baseUrl}/api/sendText`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ session, chatId, text: message }),
    });
    if (!res.ok) {
      console.warn(`WAHA notification failed for ${phone.slice(-4)}: HTTP ${res.status}`);
    }
  }
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

function inferRelevantFiles(issue, comments) {
  const text = [
    issue?.title || '',
    issue?.body || '',
    ...(comments || []).map((comment) => comment?.body || ''),
  ].join('\n').toLowerCase();

  const files = new Set([
    'scripts/ops-autofix.mjs',
    'src/services/github-ops.ts',
    'src/services/whatsapp-alerts.ts',
  ]);

  if (text.includes('sync_ml_listings_publish') || text.includes('/api/sync/anuncios/publish')) {
    [
      'src/app/api/sync/anuncios/publish/route.ts',
      'src/services/sync-ml-job.ts',
      'src/lib/sync/stale-jobs.ts',
      'src/lib/sync/registry.ts',
      'src/app/api/sync/cron-dispatch/route.ts',
      'src/app/api/sync/run/route.ts',
      'src/app/api/sync/disparar/route.ts',
      'src/services/mercadolibre.ts',
      'src/services/integration.ts',
      'src/lib/sync/domain-lock.ts',
    ].forEach((file) => files.add(file));
  }

  if (text.includes('sync_dslite_pedidos_compra') || text.includes('/api/sync/dslite-pedidos')) {
    [
      'src/app/api/sync/dslite-pedidos/route.ts',
      'src/services/sync-ml-job.ts',
      'src/lib/sync/stale-jobs.ts',
      'src/lib/sync/registry.ts',
      'src/app/api/sync/cron-dispatch/route.ts',
      'src/app/api/sync/run/route.ts',
      'src/app/api/sync/disparar/route.ts',
      'src/services/dslite.ts',
      'src/lib/sync/domain-lock.ts',
    ].forEach((file) => files.add(file));
  }

  if (text.includes('sync_dslite_preco_estoque') || text.includes('/api/sync/preco-estoque')) {
    [
      'src/app/api/sync/preco-estoque/route.ts',
      'src/services/sync-ml-job.ts',
      'src/lib/sync/stale-jobs.ts',
      'src/lib/sync/registry.ts',
      'src/app/api/sync/cron-dispatch/route.ts',
      'src/services/dslite.ts',
      'src/lib/sync/ml-publish-outbox.ts',
    ].forEach((file) => files.add(file));
  }

  if (text.includes('sync_ml_orders_ingest') || text.includes('/api/sync/pedidos')) {
    [
      'src/app/api/sync/pedidos/route.ts',
      'src/app/api/sync/pedidos/job/route.ts',
      'src/app/api/sync/pedidos/status/route.ts',
      'src/services/sync-ml-job.ts',
      'src/lib/sync/stale-jobs.ts',
      'src/lib/sync/registry.ts',
      'src/app/api/sync/cron-dispatch/route.ts',
      'src/app/api/sync/run/route.ts',
      'src/app/api/sync/disparar/route.ts',
      'src/services/integration.ts',
      'src/services/mercadolibre.ts',
      'src/lib/sync/domain-lock.ts',
    ].forEach((file) => files.add(file));
  }

  if (text.includes('mercado livre') || text.includes('ml_') || text.includes('shipment') || text.includes('sync_ml')) {
    [
      'src/services/integration.ts',
      'src/services/mercadolibre.ts',
    ].forEach((file) => files.add(file));
  }

  return Array.from(files).filter((file) => existsSync(file));
}

function repoContext(issue, comments) {
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
  const relevantFiles = inferRelevantFiles(issue, comments);
  const relevantContents = relevantFiles
    .map((file) => [
      `FILE: ${file}`,
      '```',
      readIfExists(file, 22000),
      '```',
    ].join('\n'))
    .join('\n\n');

  return [
    'AGENTS.md:',
    readIfExists('AGENTS.md', 9000),
    '',
    'RTK.md:',
    readIfExists('RTK.md', 2000),
    '',
    'docs/ops-memory.md:',
    readIfExists('docs/ops-memory.md', 12000),
    '',
    'docs/ops-whatsapp-bot.md:',
    readIfExists('docs/ops-whatsapp-bot.md', 7000),
    '',
    'docs/runtime-unblock-playbook.md:',
    readIfExists('docs/runtime-unblock-playbook.md', 5000),
    '',
    'package.json:',
    truncate(readFileSync('package.json', 'utf8'), 3000),
    '',
    'Arquivos relevantes com conteudo:',
    relevantContents || 'Nenhum arquivo relevante inferido.',
    '',
    'Arquivos relevantes do repositório:',
    files.join('\n'),
  ].join('\n');
}

function normalizeMemoryUpdate(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'none') return '';
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-+\s*/, '- '))
    .join('\n')
    .slice(0, 3000);
}

function normalizeDiscoveredIssues(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      title: String(item?.title || '').trim().slice(0, 180),
      summary: String(item?.summary || item?.message || '').trim().slice(0, 4000),
      evidence: String(item?.evidence || '').trim().slice(0, 4000),
      severity: String(item?.severity || 'warning').trim().toLowerCase() === 'critical' ? 'critical' : 'warning',
      dedupe_key: String(item?.dedupe_key || item?.dedupeKey || item?.title || '').trim().slice(0, 240),
      can_autofix: item?.can_autofix === true || item?.canAutofix === true,
    }))
    .filter((item) => item.title && item.summary && item.dedupe_key)
    .slice(0, 5);
}

function discoveredFingerprint(issue, item) {
  const raw = `${issue.number}:${item.dedupe_key}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9:_./-]/g, '').slice(0, 180);
  return `vortek-discovered:${raw}`;
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

  const model = process.env.OPENROUTER_OPS_AUTOFIX_MODEL || 'openai/gpt-5.5';
  const reasoningEffort = process.env.OPENROUTER_OPS_AUTOFIX_REASONING_EFFORT || 'medium';
  const prompt = [
    'Você é um agente de engenharia do projeto Vortek, operando com memória versionada do repositório.',
    'Analise a issue operacional e, se houver uma correção pequena e segura, gere um patch unified diff.',
    'Responda somente JSON válido:',
    '{"status":"patch|needs_human|no_change","summary":"...","root_cause":"...","validation":"...","patch":"...","memory_update":"...","secondary_issues":[{"title":"...","summary":"...","evidence":"...","severity":"warning|critical","dedupe_key":"...","can_autofix":true}]}',
    '',
    'Regras:',
    '- Não invente contexto.',
    '- Use AGENTS.md, docs/ops-memory.md, docs e arquivos do repositório como memória obrigatória.',
    '- Respeite regras do Vortek: investigação antes de implementação, menor correção possível, sem chute.',
    '- Use os arquivos relevantes com conteudo incluídos abaixo antes de concluir que falta contexto.',
    '- Só gere patch se o erro apontar causa provável no código/contexto fornecido.',
    '- Patch precisa ser unified diff aplicável por git apply.',
    '- Mudança deve ser mínima.',
    '- Se precisar de logs, credenciais, acesso externo ou decisão humana, use needs_human e explique exatamente a ação necessária.',
    '- Se a issue tiver informação insuficiente, use needs_human.',
    '- Em memory_update, sugira aprendizado persistente apenas se houver regra/erro/decisao nova que ajude execucoes futuras.',
    '- Se nao houver aprendizado novo, use memory_update vazio.',
    '- Se encontrar outro problema real separado da issue principal, inclua em secondary_issues com evidência objetiva.',
    '- secondary_issues deve conter apenas problemas acionáveis e diferentes da causa principal; não inclua ideias genéricas.',
    '- Use can_autofix=true somente quando houver contexto de código suficiente para tentar correção automática sem decisão humana.',
    '',
    'Issue:',
    `#${issue.number} ${issue.title}`,
    truncate(issue.body, 8000),
    '',
    'Comentários recentes:',
    truncate(comments.map((comment) => `- ${comment.user?.login}: ${comment.body}`).join('\n\n'), 8000),
    '',
    repoContext(issue, comments),
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
      reasoning: {
        effort: reasoningEffort,
        exclude: true,
      },
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

function appendMemoryUpdate(issue, analysis) {
  const memoryUpdate = normalizeMemoryUpdate(analysis.memory_update);
  if (!memoryUpdate) return false;

  const file = 'docs/ops-memory.md';
  const current = readIfExists(file, 30000);
  const entry = [
    '',
    `### Issue #${issue.number} - ${new Date().toISOString()}`,
    '',
    memoryUpdate,
    '',
    `Referencia: https://github.com/${owner}/${repoName}/issues/${issue.number}`,
    '',
  ].join('\n');

  writeFileSync(file, `${current.trimEnd()}\n${entry}`);
  return true;
}

function tryApplyPatch(patch) {
  const cleanPatch = String(patch || '').trim();
  if (!cleanPatch) return { changed: false, error: null };
  writeFileSync('.ops-autofix.patch', `${cleanPatch}\n`);
  try {
    run('git', ['apply', '--check', '.ops-autofix.patch']);
    run('git', ['apply', '.ops-autofix.patch']);
  } catch (err) {
    return {
      changed: false,
      error: err?.message || String(err),
    };
  }
  return {
    changed: run('git', ['status', '--porcelain']).trim().length > 0,
    error: null,
  };
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

async function pushDirectFix(issue, analysis) {
  run('git', ['config', 'user.name', 'vortek-ops-bot']);
  run('git', ['config', 'user.email', 'actions@github.com']);
  run('git', ['add', '.']);
  run('git', ['commit', '-m', `fix: ops issue ${issue.number}`]);
  run('git', ['push', 'origin', 'HEAD:main']);

  return run('git', ['rev-parse', '--short', 'HEAD']).trim();
}

async function triggerDeployIfConfigured(commit) {
  const webhookUrl = String(process.env.EASYPANEL_DEPLOY_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return { triggered: false, reason: 'EASYPANEL_DEPLOY_WEBHOOK_URL não configurado' };
  }

  const method = String(process.env.EASYPANEL_DEPLOY_HTTP_METHOD || 'POST').trim().toUpperCase();
  const res = await fetch(webhookUrl, { method: method === 'GET' ? 'GET' : 'POST' });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return {
      triggered: false,
      reason: `Deploy webhook HTTP ${res.status}: ${text.slice(0, 300)}`,
    };
  }

  return { triggered: true, commit, status: res.status };
}

async function dispatchAutofix(issueToRun, parentIssueNumber) {
  const workflow = process.env.GITHUB_OPS_WORKFLOW || 'ops-autofix.yml';
  await github(`/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    body: {
      ref: 'main',
      inputs: {
        action: 'approved',
        issue_number: String(issueToRun.number),
        source: `autofix-chain:${parentIssueNumber}`,
        chain_depth: String(chainDepth + 1),
      },
    },
  });
}

async function createOrUpdateDiscoveredIssue(parentIssue, item) {
  const fingerprint = discoveredFingerprint(parentIssue, item);
  const searchQuery = encodeURIComponent(`repo:${owner}/${repoName} is:issue is:open "${fingerprint}"`);
  const search = await github(`/search/issues?q=${searchQuery}&per_page=1`);
  const existing = search.items?.[0] || null;
  const body = [
    `## ${item.title}`,
    '',
    item.summary,
    '',
    '## Evidência',
    '',
    item.evidence || 'Sem evidência adicional informada.',
    '',
    '## Origem',
    '',
    `- Descoberta durante autofix da issue #${parentIssue.number}`,
    `- Severidade: ${item.severity}`,
    `- Pode tentar autofix: ${item.can_autofix ? 'sim' : 'não'}`,
    `- Fingerprint: ${fingerprint}`,
    `- Criado em: ${new Date().toISOString()}`,
  ].join('\n');

  if (existing?.number) {
    await github(`/repos/${owner}/${repoName}/issues/${existing.number}/comments`, {
      method: 'POST',
      body: {
        body: [
          `Problema secundário reencontrado durante autofix da issue #${parentIssue.number}.`,
          '',
          item.summary,
          '',
          `Fingerprint: ${fingerprint}`,
        ].join('\n'),
      },
    });
    return { created: false, number: existing.number, url: existing.html_url };
  }

  const created = await github(`/repos/${owner}/${repoName}/issues`, {
    method: 'POST',
    body: {
      title: `[${item.severity.toUpperCase()}] ${item.title}`,
      body,
      labels: [
        'ops:error',
        `severity:${item.severity}`,
        'auto-triage',
      ],
    },
  });
  return { created: true, number: created.number, url: created.html_url };
}

async function processDiscoveredIssues(parentIssue, analysis) {
  const discovered = normalizeDiscoveredIssues(analysis.secondary_issues);
  if (discovered.length === 0) return [];

  const results = [];
  for (const item of discovered) {
    const issue = await createOrUpdateDiscoveredIssue(parentIssue, item);
    let dispatched = false;
    let dispatchError = null;
    if (item.can_autofix && chainDepth < maxChainDepth) {
      try {
        await dispatchAutofix(issue, parentIssue.number);
        dispatched = true;
      } catch (err) {
        dispatchError = err?.message || String(err);
      }
    }
    results.push({
      ...issue,
      title: item.title,
      severity: item.severity,
      can_autofix: item.can_autofix,
      dispatched,
      dispatchError,
    });
  }
  return results;
}

function formatDiscoveredResults(results) {
  if (!results.length) return '';
  return [
    '## Problemas secundários detectados',
    '',
    ...results.map((item) => [
      `- Issue #${item.number}: ${item.title}`,
      `  URL: ${item.url}`,
      `  Autofix: ${item.dispatched ? 'disparado' : item.can_autofix ? `não disparado (${item.dispatchError || 'limite de encadeamento atingido'})` : 'não aplicável'}`,
    ].join('\n')),
  ].join('\n');
}

async function createMemoryPullRequest(issue, analysis) {
  const changed = appendMemoryUpdate(issue, analysis);
  if (!changed) return null;

  const branch = `ops/memory-issue-${issue.number}-${runId}`;
  run('git', ['config', 'user.name', 'vortek-ops-bot']);
  run('git', ['config', 'user.email', 'actions@github.com']);
  run('git', ['checkout', '-b', branch]);
  run('git', ['add', 'docs/ops-memory.md']);
  run('git', ['commit', '-m', `docs: update ops memory for issue ${issue.number}`]);
  run('git', ['push', 'origin', `HEAD:${branch}`]);

  return github(`/repos/${owner}/${repoName}/pulls`, {
    method: 'POST',
    body: {
      title: `docs: update ops memory for issue #${issue.number}`,
      head: branch,
      base: 'main',
      body: [
        'Atualizacao automatica de memoria operacional sugerida pelo Ops Autofix.',
        '',
        `Issue: #${issue.number}`,
        '',
        'Resumo:',
        analysis.summary || 'Sem resumo.',
        '',
        'Ação necessária: revisar se o aprendizado é correto antes de mergear.',
      ].join('\n'),
    },
  });
}

async function main() {
  const issue = await github(`/repos/${owner}/${repoName}/issues/${issueNumber}`);
  const comments = await github(`/repos/${owner}/${repoName}/issues/${issueNumber}/comments?per_page=20`);

  if (action === 'rejected') {
    await commentIssue(`Workflow Ops Autofix não executado: issue rejeitada via ${source}.`);
    await notifyOps(`Vortek Ops\n\nIssue #${issueNumber} rejeitada. Nenhuma ação automática executada.`);
    return;
  }

  if (action === 'details_requested') {
    await commentIssue([
      'Mais detalhes solicitados pelo WhatsApp.',
      '',
      'Para permitir correção automática, inclua logs completos, rota/job afetado, erro exato e comportamento esperado.',
    ].join('\n'));
    await notifyOps(`Vortek Ops\n\nIssue #${issueNumber}: mais detalhes foram solicitados. Ação sua necessária: incluir logs/erro/contexto na issue.\nhttps://github.com/${owner}/${repoName}/issues/${issueNumber}`);
    return;
  }

  if (action !== 'approved') {
    await commentIssue(`Ação não suportada pelo workflow: ${action}`);
    await notifyOps(`Vortek Ops\n\nIssue #${issueNumber}: ação não suportada pelo workflow: ${action}`);
    return;
  }

  const analysis = await askOpenRouter(issue, comments);
  if (analysis.status !== 'patch') {
    const discoveredResults = await processDiscoveredIssues(issue, analysis).catch(async (err) => {
      await commentIssue(`Ops Autofix tentou registrar problemas secundários, mas falhou: ${err?.message || err}`);
      return [];
    });
    const memoryPr = await createMemoryPullRequest(issue, analysis).catch(async (err) => {
      await commentIssue(`Ops Autofix tentou criar PR de memoria, mas falhou: ${err?.message || err}`);
      return null;
    });
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
      '',
      formatDiscoveredResults(discoveredResults),
      '',
      memoryPr ? `PR de memoria sugerida: ${memoryPr.html_url}` : 'Sem atualização de memoria sugerida.',
    ].filter(Boolean).join('\n'));
    await notifyOps([
      'Vortek Ops',
      '',
      `Issue #${issueNumber}: análise concluída sem PR automático.`,
      `Status: ${analysis.status}`,
      `Resumo: ${analysis.summary || 'Sem resumo.'}`,
      '',
      discoveredResults.length ? `Problemas secundários: ${discoveredResults.length}` : null,
      ...discoveredResults.map((item) => `#${item.number}: ${item.dispatched ? 'autofix disparado' : 'registrada'} - ${item.url}`),
      discoveredResults.length ? '' : null,
      'Sem patch seguro. A issue foi comentada com o motivo; se for falta de contexto do workflow, corrija a automação antes de reenviar.',
      memoryPr ? `PR de memoria sugerida: ${memoryPr.html_url}` : null,
      `https://github.com/${owner}/${repoName}/issues/${issueNumber}`,
    ].filter(Boolean).join('\n'));
    return;
  }

  try {
    const patchResult = tryApplyPatch(analysis.patch);
    if (patchResult.error) {
      await commentIssue([
        'Ops Autofix recebeu um patch inválido da IA.',
        '',
        `Erro ao validar patch: ${patchResult.error}`,
        '',
        'Nenhuma alteração foi aplicada. A issue continua aberta para nova tentativa.',
      ].join('\n'));
      await notifyOps([
        'Vortek Ops',
        '',
        `Issue #${issueNumber}: IA gerou patch inválido.`,
        `Erro: ${patchResult.error}`,
        '',
        `https://github.com/${owner}/${repoName}/issues/${issueNumber}`,
      ].join('\n'));
      return;
    }
    if (!patchResult.changed) {
      await commentIssue('Ops Autofix recebeu patch, mas ele não gerou alterações.');
      await notifyOps(`Vortek Ops\n\nIssue #${issueNumber}: IA gerou patch sem alterações. Ação sua necessária: revisar a issue.`);
      return;
    }
    appendMemoryUpdate(issue, analysis);
    run('npm', ['run', 'typecheck'], { stdio: 'inherit' });
    const commit = await pushDirectFix(issue, analysis);
    const deploy = await triggerDeployIfConfigured(commit);
    const discoveredResults = await processDiscoveredIssues(issue, analysis).catch(async (err) => {
      await commentIssue(`Ops Autofix aplicou a correção principal, mas falhou ao registrar problemas secundários: ${err?.message || err}`);
      return [];
    });
    await commentIssue([
      `Ops Autofix aplicou correção direto na main: ${commit}`,
      '',
      deploy.triggered
        ? `Deploy Easypanel disparado: HTTP ${deploy.status}`
        : `Deploy não disparado: ${deploy.reason}`,
      '',
      formatDiscoveredResults(discoveredResults),
    ].filter(Boolean).join('\n'));
    await closeIssue('completed');
    await notifyOps([
      'Vortek Ops',
      '',
      `Issue #${issueNumber}: correção automática aplicada na main.`,
      `Commit: ${commit}`,
      'Issue fechada automaticamente.',
      '',
      deploy.triggered
        ? `Deploy Easypanel disparado: HTTP ${deploy.status}`
        : `Deploy não disparado: ${deploy.reason}`,
      discoveredResults.length ? '' : null,
      discoveredResults.length ? `Problemas secundários: ${discoveredResults.length}` : null,
      ...discoveredResults.map((item) => `#${item.number}: ${item.dispatched ? 'autofix disparado' : 'registrada'} - ${item.url}`),
    ].filter(Boolean).join('\n'));
  } catch (err) {
    await commentIssue([
      'Ops Autofix tentou aplicar correção, mas falhou.',
      '',
      `Erro: ${err?.message || err}`,
      '',
      'Nenhum PR foi criado.',
    ].join('\n'));
    await notifyOps([
      'Vortek Ops',
      '',
      `Issue #${issueNumber}: autofix falhou.`,
      `Erro: ${err?.message || err}`,
      '',
      'Ação sua necessária: revisar logs do GitHub Actions ou pedir correção manual.',
      `https://github.com/${owner}/${repoName}/issues/${issueNumber}`,
    ].join('\n'));
    throw err;
  }
}

main().catch(async (err) => {
  try {
    await commentIssue(`Ops Autofix falhou: ${err?.message || err}`);
    await notifyOps(`Vortek Ops\n\nOps Autofix falhou na issue #${issueNumber}: ${err?.message || err}`);
  } catch {
    // ignore secondary failure
  }
  console.error(err);
  process.exit(1);
});
