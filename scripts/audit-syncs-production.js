#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = process.env.AUDIT_SYNC_BASE_URL || 'https://app.vortek.shop';
const WINDOW_DAYS = Number.isFinite(Number(process.env.AUDIT_SYNC_WINDOW_DAYS))
  ? Math.max(1, Math.min(30, Math.trunc(Number(process.env.AUDIT_SYNC_WINDOW_DAYS))))
  : 7;
const REQUEST_TIMEOUT_MS = Number.isFinite(Number(process.env.AUDIT_SYNC_TIMEOUT_MS))
  ? Math.max(5000, Math.trunc(Number(process.env.AUDIT_SYNC_TIMEOUT_MS)))
  : 240000;
const ALLOW_LEGACY_ORCHESTRATION = String(process.env.AUDIT_SYNC_ALLOW_LEGACY || '').toLowerCase() === 'true';
const REPORT_DIR = path.join(process.cwd(), 'reports');

function nowIso() {
  return new Date().toISOString();
}

function agoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    const json = safeJsonParse(text);
    return {
      ok: res.ok,
      status: res.status,
      duration_ms: Date.now() - startedAt,
      body: json,
      raw: json ? null : text.slice(0, 1200),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      duration_ms: Date.now() - startedAt,
      body: null,
      raw: String(err?.message || err || 'unknown_error'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getApiKey(supabase) {
  if (String(process.env.API_SECRET_KEY || '').trim()) {
    return String(process.env.API_SECRET_KEY).trim();
  }
  const { data, error } = await supabase
    .from('sync_runtime_config')
    .select('value')
    .eq('key', 'api_secret_key')
    .maybeSingle();
  if (error || !data?.value) {
    throw new Error(`Não foi possível obter API key para sync: ${error?.message || 'api_secret_key ausente'}`);
  }
  return String(data.value);
}

async function tableCount(supabase, table, filterCb) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (typeof filterCb === 'function') query = filterCb(query);
  const { count, error } = await query;
  return { count: count || 0, error: error?.message || null };
}

async function tableMaxTs(supabase, table, field, filterCb) {
  let query = supabase.from(table).select(field).order(field, { ascending: false }).limit(1);
  if (typeof filterCb === 'function') query = filterCb(query);
  const { data, error } = await query;
  return {
    max: error ? null : (data?.[0]?.[field] || null),
    error: error?.message || null,
  };
}

function pickSyncSummary(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    success: body.success ?? body.ok ?? null,
    domain: body.domain || null,
    job: body.job || null,
    cursor: body.cursor ?? body.next_cursor ?? null,
    records: body.records || null,
    errors: Array.isArray(body.errors) ? body.errors : null,
    message: body.message || body.error || body.erro || null,
  };
}

function classifyFailure(syncKey, response, orchestration) {
  const text = JSON.stringify(response?.body || response?.raw || '').toLowerCase();
  if (orchestration?.legacy_detected) return 'infra/deploy';
  if (response.status === 404) return 'infra/deploy';
  if (response.status === 401 || response.status === 403 || text.includes('auth')) return 'auth_externo';
  if (text.includes('domain_lock_conflict')) return 'regra_domínio';
  if (text.includes('erro ao buscar') || text.includes('falha') || text.includes('dslite')) return 'dados_origem';
  return 'infra/deploy';
}

async function captureBaseline(supabase) {
  const windowFrom = agoIso(WINDOW_DAYS);
  const out = {
    captured_at: nowIso(),
    window_days: WINDOW_DAYS,
    window_from: windowFrom,
    tables: {},
  };

  const checks = [
    {
      name: 'fornecedores',
      table: 'fornecedores',
      tsField: 'dslite_ultima_sync',
      filter: (q) => q.gte('dslite_ultima_sync', windowFrom),
      sample: async () => supabase.from('fornecedores').select('id,dslite_id,nome,ativo,dslite_ultima_sync').order('dslite_ultima_sync', { ascending: false }).limit(10),
    },
    {
      name: 'produtos_dslite',
      table: 'produtos',
      tsField: 'dslite_ultima_sync',
      filter: (q) => q.not('dslite_fornecedor_id', 'is', null).gte('dslite_ultima_sync', windowFrom),
      sample: async () => supabase.from('produtos').select('id,sku,dslite_fornecedor_id,dslite_produto_id,dslite_ultima_sync,ml_item_id,ml_status,custom_price,estoque').not('dslite_fornecedor_id', 'is', null).order('dslite_ultima_sync', { ascending: false }).limit(20),
    },
    {
      name: 'compras',
      table: 'compras',
      tsField: 'updated_at',
      filter: (q) => q.gte('updated_at', windowFrom),
      sample: async () => supabase.from('compras').select('id,dsid,nf_chave,status,updated_at').order('updated_at', { ascending: false }).limit(20),
    },
    {
      name: 'pedidos',
      table: 'pedidos',
      tsField: 'updated_at',
      filter: (q) => q.gte('updated_at', windowFrom),
      sample: async () => supabase.from('pedidos').select('id,ml_order_id,ml_pack_id,dslite_id,dslite_status,snapshot_incompleto,snapshot_pendencias,updated_at,sincronizado_em').order('updated_at', { ascending: false }).limit(20),
    },
    {
      name: 'pedido_itens',
      table: 'pedido_itens',
      tsField: 'updated_at',
      filter: (q) => q.gte('updated_at', windowFrom),
      sample: async () => supabase.from('pedido_itens').select('id,pedido_id,ml_order_id,ml_item_id,seller_sku,updated_at').order('updated_at', { ascending: false }).limit(20),
    },
    {
      name: 'catalogo_ml_snapshot',
      table: 'catalogo_ml_snapshot',
      tsField: 'synced_at',
      filter: (q) => q.gte('synced_at', windowFrom),
      sample: async () => supabase.from('catalogo_ml_snapshot').select('id,ml_item_id,seller_id,sku_local,status,synced_at,updated_at').order('synced_at', { ascending: false }).limit(20),
    },
    {
      name: 'anuncios_ml_outbox',
      table: 'anuncios_ml_outbox',
      tsField: 'created_at',
      filter: (q) => q.gte('created_at', windowFrom),
      sample: async () => supabase.from('anuncios_ml_outbox').select('id,produto_id,ml_item_id,status,attempts,last_error,created_at,processed_at,source').order('created_at', { ascending: false }).limit(30),
    },
    {
      name: 'jobs',
      table: 'jobs',
      tsField: 'created_at',
      filter: (q) => q.gte('created_at', windowFrom),
      sample: async () => supabase.from('jobs').select('id,tipo,status,created_at,finished_at').order('created_at', { ascending: false }).limit(50),
    },
    {
      name: 'sync_domain_locks',
      table: 'sync_domain_locks',
      tsField: 'updated_at',
      filter: (q) => q.gte('updated_at', windowFrom),
      sample: async () => supabase.from('sync_domain_locks').select('domain,owner_task,owner_job_id,acquired_at,expires_at,updated_at').order('updated_at', { ascending: false }).limit(20),
    },
  ];

  for (const check of checks) {
    const count = await tableCount(supabase, check.table, check.filter);
    const maxTs = await tableMaxTs(supabase, check.table, check.tsField, check.filter);
    const sampleRes = await check.sample();
    out.tables[check.name] = {
      count: count.count,
      count_error: count.error,
      max_ts: maxTs.max,
      max_ts_error: maxTs.error,
      sample_error: sampleRes.error?.message || null,
      sample: sampleRes.data || [],
    };
  }

  return out;
}

async function captureOrchestration(baseUrl) {
  const prodCronStatus = await fetchJson(`${baseUrl}/api/sync/cron-status`);
  const localCronStatus = await fetchJson('http://localhost:3000/api/sync/cron-status');
  const prodTasks = Array.isArray(prodCronStatus.body?.tasks) ? prodCronStatus.body.tasks : [];
  const legacyDetected = prodTasks.some((task) => {
    const key = String(task.task || task.tipo || '').toLowerCase();
    return key.includes('dslite_stock')
      || key.includes('dslite_catalog')
      || key.includes('dslite_pedidos')
      || key.includes('ml_anuncios')
      || key.includes('ml_pedidos')
      || key.includes('sync_dslite_stock')
      || key.includes('sync_anuncios_ml')
      || key.includes('sync_pedidos_ml');
  });

  return {
    captured_at: nowIso(),
    prod_cron_status: {
      status: prodCronStatus.status,
      ok: prodCronStatus.ok,
      duration_ms: prodCronStatus.duration_ms,
      body: prodCronStatus.body,
    },
    local_cron_status: {
      status: localCronStatus.status,
      ok: localCronStatus.ok,
      duration_ms: localCronStatus.duration_ms,
      body: localCronStatus.body,
    },
    legacy_detected: legacyDetected,
  };
}

function buildSyncRuns(windowDays) {
  return [
    { key: 'sync_dslite_fornecedores', body: {} },
    { key: 'sync_dslite_catalogo', body: { pageSize: 20, maxPagesPerRun: 1 } },
    { key: 'sync_dslite_preco_estoque', body: { pageSize: 20, maxPagesPerRun: 1, withMlSync: false } },
    { key: 'sync_dslite_pedidos_compra', body: { windowDays: Math.max(2, windowDays) } },
    { key: 'sync_ml_orders_ingest', body: { limit: 20, offset: 0, safetyWindowMinutes: 15 } },
    { key: 'sync_ml_listings_observed', body: { offset: 0, limit: 20 } },
    { key: 'sync_ml_listings_publish', body: { limit: 20 } },
    { key: 'sync_reconcile_fiscal', body: { limit: 100 } },
    { key: 'sync_pack_id_backfill', body: { limit: 50 } },
    { key: 'sync_municipios_seed', body: {} },
  ];
}

async function waitForJobCompletion(supabase, jobId, timeoutMs = 8 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { data, error } = await supabase
      .from('jobs')
      .select('id,tipo,status,created_at,finished_at,log,processados,total')
      .eq('id', jobId)
      .maybeSingle();
    if (error) {
      return { done: false, timeout: false, error: error.message, job: null };
    }
    if (data?.finished_at || (data?.status && !['pendente', 'rodando'].includes(String(data.status)))) {
      return { done: true, timeout: false, error: null, job: data };
    }
    await sleep(2500);
  }
  const { data: lastKnown } = await supabase
    .from('jobs')
    .select('id,tipo,status,created_at,finished_at,log,processados,total')
    .eq('id', jobId)
    .maybeSingle();
  return { done: false, timeout: true, error: null, job: lastKnown || null };
}

function pickTaskResultRow(body, taskKey) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.results)) return null;
  return body.results.find((row) => String(row?.task || '') === String(taskKey)) || null;
}

async function runSyncRound(baseUrl, apiKey, windowDays, orchestration, supabase) {
  const runDefs = buildSyncRuns(windowDays);
  const results = [];

  for (const def of runDefs) {
    const startedAt = Date.now();
    const response = await fetchJson(`${baseUrl}/api/sync/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        taskKey: def.key,
        ...(def.body || {}),
      }),
    });
    const taskRow = pickTaskResultRow(response.body, def.key);

    let jobAudit = null;
    let summary = pickSyncSummary(response.body);
    let ok = response.ok && (summary?.success === null || summary?.success === true);

    if (taskRow?.jobId) {
      const waitResult = await waitForJobCompletion(supabase, String(taskRow.jobId));
      jobAudit = waitResult;
      if (waitResult.done && waitResult.job) {
        const jobStatus = String(waitResult.job.status || '').toLowerCase();
        ok = ok && (jobStatus === 'completo');
        summary = {
          ...(summary || {}),
          job: { id: waitResult.job.id, status: waitResult.job.status, tipo: waitResult.job.tipo },
          records: {
            processados: waitResult.job.processados ?? null,
            total: waitResult.job.total ?? null,
          },
          message: waitResult.timeout
            ? 'timeout aguardando finalização do job'
            : `job finalizado com status ${waitResult.job.status}`,
        };
      } else if (waitResult.timeout) {
        ok = false;
        summary = {
          ...(summary || {}),
          message: 'timeout aguardando conclusão do job',
        };
      } else if (waitResult.error) {
        ok = false;
        summary = {
          ...(summary || {}),
          message: `falha ao consultar job: ${waitResult.error}`,
        };
      }
    } else if (taskRow?.error) {
      ok = false;
      summary = {
        ...(summary || {}),
        message: String(taskRow.error),
      };
    }

    results.push({
      sync: def.key,
      request: {
        url: `${baseUrl}/api/sync/run`,
        body: {
          taskKey: def.key,
          ...(def.body || {}),
        },
      },
      response: {
        status: response.status,
        ok: response.ok,
        duration_ms: response.duration_ms,
        summary,
        run_result_row: taskRow,
        job_audit: jobAudit,
        raw: response.raw,
      },
      classification: ok ? null : classifyFailure(def.key, response, orchestration),
      pass: ok,
      started_at: new Date(startedAt).toISOString(),
      finished_at: nowIso(),
    });
  }

  return results;
}

async function runConcurrencyChecks(baseUrl, apiKey) {
  const first = fetchJson(`${baseUrl}/api/sync/preco-estoque`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ pageSize: 20, maxPagesPerRun: 2, withMlSync: false }),
  });
  await new Promise((r) => setTimeout(r, 300));
  const second = fetchJson(`${baseUrl}/api/sync/preco-estoque`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ pageSize: 20, maxPagesPerRun: 2, withMlSync: false }),
  });
  const [same1, same2] = await Promise.all([first, second]);

  const cross1 = fetchJson(`${baseUrl}/api/sync/preco-estoque`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ pageSize: 10, maxPagesPerRun: 1, withMlSync: false }),
  });
  await new Promise((r) => setTimeout(r, 250));
  const cross2 = fetchJson(`${baseUrl}/api/sync/anuncios?offset=0&limit=10`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({}),
  });
  const [different1, different2] = await Promise.all([cross1, cross2]);

  const sameDomainHasLock = [same1, same2].some((r) => r.status === 409);
  const crossDomainParallelOk = [different1, different2].every((r) => r.status !== 409);

  return {
    same_domain: {
      runs: [same1, same2].map((r) => ({
        status: r.status,
        ok: r.ok,
        duration_ms: r.duration_ms,
        summary: pickSyncSummary(r.body),
      })),
      pass: sameDomainHasLock,
    },
    different_domain: {
      runs: [different1, different2].map((r) => ({
        status: r.status,
        ok: r.ok,
        duration_ms: r.duration_ms,
        summary: pickSyncSummary(r.body),
      })),
      pass: crossDomainParallelOk,
    },
  };
}

async function runDataIntegrityChecks(supabase, windowDays) {
  const windowFrom = agoIso(windowDays);
  const checks = {
    unique: {},
    domain: {},
    outbox: {},
  };

  const { data: compras } = await supabase
    .from('compras')
    .select('id,dsid,nf_chave,updated_at')
    .gte('updated_at', windowFrom)
    .order('updated_at', { ascending: false })
    .limit(2000);
  const dsidMap = new Map();
  for (const row of compras || []) {
    const key = String(row.dsid || '').trim();
    if (!key) continue;
    dsidMap.set(key, (dsidMap.get(key) || 0) + 1);
  }
  const duplicatedDsid = Array.from(dsidMap.entries()).filter(([, n]) => n > 1).map(([k, n]) => ({ dsid: k, count: n }));

  const { data: pedidos } = await supabase
    .from('pedidos')
    .select('id,ml_order_id,dslite_id,dslite_status,nfe_chave,updated_at,snapshot_incompleto')
    .gte('updated_at', windowFrom)
    .order('updated_at', { ascending: false })
    .limit(2000);
  const orderMap = new Map();
  for (const row of pedidos || []) {
    const key = String(row.ml_order_id || '').trim();
    if (!key) continue;
    orderMap.set(key, (orderMap.get(key) || 0) + 1);
  }
  const duplicatedMlOrderId = Array.from(orderMap.entries()).filter(([, n]) => n > 1).map(([k, n]) => ({ ml_order_id: k, count: n }));

  const { data: links } = await supabase
    .from('compras')
    .select('dsid,nf_chave')
    .not('nf_chave', 'is', null)
    .gte('updated_at', windowFrom)
    .limit(1000);
  let linksMatched = 0;
  let linksMissing = 0;
  if (Array.isArray(links) && links.length > 0) {
    const chaves = Array.from(new Set(links.map((l) => String(l.nf_chave || '').trim()).filter(Boolean)));
    const { data: pedidosByNf } = await supabase
      .from('pedidos')
      .select('id,nfe_chave,dslite_id')
      .in('nfe_chave', chaves);
    const byNf = new Map((pedidosByNf || []).map((row) => [String(row.nfe_chave || ''), row]));
    for (const item of links) {
      const nf = String(item.nf_chave || '').trim();
      if (!nf) continue;
      const pedido = byNf.get(nf);
      if (pedido && String(pedido.dslite_id || '').trim()) linksMatched += 1;
      else linksMissing += 1;
    }
  }

  const { data: outbox } = await supabase
    .from('anuncios_ml_outbox')
    .select('status,attempts,last_error,created_at,processed_at')
    .gte('created_at', windowFrom)
    .order('created_at', { ascending: false })
    .limit(2000);
  const statusCount = {};
  for (const row of outbox || []) {
    const s = String(row.status || 'unknown');
    statusCount[s] = (statusCount[s] || 0) + 1;
  }

  checks.unique = {
    compras_dsid_duplicado: duplicatedDsid,
    pedidos_ml_order_id_duplicado: duplicatedMlOrderId,
    pass: duplicatedDsid.length === 0 && duplicatedMlOrderId.length === 0,
  };

  checks.domain = {
    vinculo_nf: {
      matched: linksMatched,
      missing: linksMissing,
    },
    pass: linksMissing === 0,
  };

  checks.outbox = {
    status_count: statusCount,
    failed_samples: (outbox || [])
      .filter((row) => String(row.status) === 'failed')
      .slice(0, 10),
    pass: true,
  };

  return checks;
}

function buildMatrix(syncRuns, orchestration, concurrency, integrity) {
  const matrix = {};
  for (const run of syncRuns) {
    matrix[run.sync] = {
      pass: run.pass,
      status: run.response.status,
      duration_ms: run.response.duration_ms,
      classification: run.classification,
      evidence: run.response.summary || run.response.raw,
      corrective_action: run.pass
        ? null
        : (run.classification === 'infra/deploy'
            ? 'Alinhar deploy de produção com a registry nova de syncs.'
            : run.classification === 'auth_externo'
              ? 'Revalidar autenticação da integração externa e token refresh.'
              : run.classification === 'dados_origem'
                ? 'Investigar disponibilidade/contrato da origem (DSLite/ML).'
                : 'Revisar regra de domínio/idempotência para este sync.'),
    };
  }

  matrix._orchestration = {
    pass: !orchestration.legacy_detected,
    status: orchestration.prod_cron_status.status,
    classification: orchestration.legacy_detected ? 'infra/deploy' : null,
    evidence: {
      legacy_detected: orchestration.legacy_detected,
      prod_tasks: orchestration.prod_cron_status.body?.tasks || null,
    },
    corrective_action: orchestration.legacy_detected
      ? 'Publicar versão nova da API (cron-dispatch/cron-status com taxonomy nova) no host de produção.'
      : null,
  };

  matrix._concurrency_same_domain = {
    pass: concurrency.same_domain.pass,
    classification: concurrency.same_domain.pass ? null : 'regra_domínio',
    evidence: concurrency.same_domain.runs,
    corrective_action: concurrency.same_domain.pass ? null : 'Garantir lock por domínio ativo em produção para sync concorrente.',
  };

  matrix._concurrency_cross_domain = {
    pass: concurrency.different_domain.pass,
    classification: concurrency.different_domain.pass ? null : 'infra/deploy',
    evidence: concurrency.different_domain.runs,
    corrective_action: concurrency.different_domain.pass ? null : 'Revisar filas/locks para permitir execução paralela entre domínios distintos.',
  };

  matrix._integrity_unique = {
    pass: integrity.unique.pass,
    classification: integrity.unique.pass ? null : 'idempotência',
    evidence: integrity.unique,
    corrective_action: integrity.unique.pass ? null : 'Corrigir idempotência para evitar duplicidade em compras.dsid e pedidos.ml_order_id.',
  };

  matrix._integrity_nf_link = {
    pass: integrity.domain.pass,
    classification: integrity.domain.pass ? null : 'regra_domínio',
    evidence: integrity.domain,
    corrective_action: integrity.domain.pass ? null : 'Reparar vínculo por NF entre compras e pedidos (dslite_id/dslite_status).',
  };

  return matrix;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const apiKey = await getApiKey(supabase);
  const baselineBefore = await captureBaseline(supabase);
  const orchestration = await captureOrchestration(BASE_URL);
  let syncRuns = [];
  if (orchestration.legacy_detected && !ALLOW_LEGACY_ORCHESTRATION) {
    syncRuns = [{
      sync: 'all',
      request: { url: `${BASE_URL}/api/sync/run`, body: { taskKey: 'sync_dslite_fornecedores' } },
      response: {
        status: orchestration.prod_cron_status.status,
        ok: false,
        duration_ms: 0,
        summary: {
          success: false,
          message: 'Execução ativa bloqueada: produção ainda em taxonomy legada. Faça deploy da registry nova ou use AUDIT_SYNC_ALLOW_LEGACY=true para forçar.',
        },
        raw: null,
      },
      classification: 'infra/deploy',
      pass: false,
      started_at: nowIso(),
      finished_at: nowIso(),
    }];
  } else {
    syncRuns = await runSyncRound(BASE_URL, apiKey, WINDOW_DAYS, orchestration, supabase);
  }
  const concurrency = await runConcurrencyChecks(BASE_URL, apiKey);
  const integrity = await runDataIntegrityChecks(supabase, WINDOW_DAYS);
  const baselineAfter = await captureBaseline(supabase);
  const matrix = buildMatrix(syncRuns, orchestration, concurrency, integrity);

  const passCount = Object.values(matrix).filter((row) => row && row.pass === true).length;
  const failCount = Object.values(matrix).filter((row) => row && row.pass === false).length;

  const report = {
    metadata: {
      generated_at: nowIso(),
      base_url: BASE_URL,
      window_days: WINDOW_DAYS,
    },
    summary: {
      pass_count: passCount,
      fail_count: failCount,
      overall_pass: failCount === 0,
    },
    baseline_before: baselineBefore,
    orchestration,
    sync_runs: syncRuns,
    concurrency,
    integrity,
    baseline_after: baselineAfter,
    matrix,
  };

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `sync-audit-production-${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(JSON.stringify({
    ok: true,
    report_path: reportPath,
    summary: report.summary,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    error: err?.message || String(err),
  }, null, 2));
  process.exit(1);
});
