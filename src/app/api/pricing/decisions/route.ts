import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { hasPermission } from '@/lib/permissions';
import { createServiceClient } from '@/lib/supabase';
import { loadPricingDetail } from '@/services/pricing-detail';
import { decisionCommandSchema } from '@/services/pricing-decisions';
import { configuredPricingExecutionCapability } from '@/services/pricing-execution-access';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const filters = z
  .object({
    alertId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    view: z.enum(['alerts', 'decisions']).default('alerts'),
    state: z.enum(['open', 'resolved', 'all']).default('open'),
    severity: z.enum(['P0', 'P1', 'P2', 'INFO']).optional(),
    decision: z.enum(['pending', 'deferred', 'approved', 'rejected', 'expired', 'invalidated']).optional(),
    search: z.string().trim().max(100).default(''),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
const prepare = z
  .object({
    action: z.literal('prepare'),
    commandId: z.string().uuid(),
    evaluationId: z.string().uuid(),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
const decide = z.object({ decisionId: z.string().uuid(), command: decisionCommandSchema }).strict();
const decisionRelation = 'decisions:pricing_decisions!pricing_alerts_latest_decision_id_fkey';
const alertColumns = `id,produto_id,item_id,group_id,rule_id,severity,state,title,reason,evaluation_id,created_at,updated_at,merged_into,product:produtos!inner(nome,sku),${decisionRelation}(id,evaluation_id,state,expires_at,deferred_until,created_at,context,reason,operation_id)`;
const normalize = (row: any) => {
  const d = row.decisions;
  // Expiry is derived at read time; the immutable approval remains in history.
  const expired =
    d &&
    !d.operation_id &&
    ['pending', 'deferred', 'approved'].includes(d.state) &&
    Date.parse(d.expires_at) <= Date.now();
  return { ...row, title: row.rule_id === 'manual_proposal'
    ? (d?.context?.operationKind === 'listing_create' ? 'Preparação de novo anúncio' : 'Proposta de preço') : row.title,
    decisions: d ? [{ ...d, state: expired ? 'expired' : d.state }] : [] };
};

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.read');
  if (!auth.ok) return auth.response;
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return json({ error: 'Filtros inválidos' }, 422);
  const f = parsed.data;
  try {
    const execution = configuredPricingExecutionCapability();
    const client = createServiceClient();
    const profile = await client.from('profiles').select('cargo').eq('id', auth.userId).single();
    if (profile.error) return json({ error: 'Permissões indisponíveis' }, 403);
    const canManage = hasPermission(profile.data.cargo, 'pricing.decisions.manage');
    if (f.alertId || f.productId) {
      let detailQuery = client
        .from('pricing_alerts' as any)
        .select(alertColumns)
        .is('merged_into', null);
      detailQuery = f.alertId ? detailQuery.eq('id', f.alertId) : detailQuery.eq('produto_id', f.productId!);
      const found = await detailQuery.order('severity_order', { ascending: true }).order('created_at', { ascending: true });
      if (found.error) throw new Error('read_failed');
      if (!found.data?.length) return json({ error: 'Produto sem alertas' }, 404);
      const alerts = found.data.map(normalize);
      const latestDecisions = alerts.flatMap((row: any) => row.decisions || [])
        .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at));
      const alert = { ...alerts[0], decisions: latestDecisions.slice(0, 1) };
      const alertIds = alerts.map((row: any) => row.id);
      const [evaluation, history] = await Promise.all([
        client
          .from('pricing_evaluations')
          .select('id,result,created_at')
          .eq('id', latestDecisions[0]?.evaluation_id || alert.evaluation_id)
          .single(),
        client
          .from('pricing_events')
          .select('id,created_at,kind,actor_id,reason,evidence,decision_id')
          .in('alert_id' as any, alertIds)
          .order('id', { ascending: false })
          .range((f.page - 1) * 30, f.page * 30 - 1),
      ]);
      if (evaluation.error || history.error) throw new Error('read_failed');
      const ids = [...new Set((history.data || []).flatMap((e) => (e.actor_id ? [e.actor_id] : [])))];
      const profiles = ids.length
        ? await client.from('profiles').select('id,nome').in('id', ids)
        : { data: [], error: null };
      if (profiles.error) throw new Error('read_failed');
      return json({
        alert,
        alerts,
        evaluation: evaluation.data,
        history: (history.data || []).map((e) => ({
          ...e,
          actorName: profiles.data?.find((p) => p.id === e.actor_id)?.nome ?? null,
        })),
        hasMore: history.data?.length === 30,
        canManage,
        execution,
        executionBlocked: !execution.enabled
          || execution.allowedOperations?.includes(latestDecisions[0]?.context?.operationKind || 'price_change') !== true,
      });
    }
    const term = f.search.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim();
    const index = await client.rpc('search_pricing_decision_product_ids', {
      p_view: f.view, p_state: f.state, p_severity: f.severity ?? null,
      p_decision: f.decision ?? null, p_search: term, p_page: f.page, p_page_size: 30,
    });
    if (index.error) throw new Error('read_failed');
    const summary = index.data as any;
    const productIds = Array.isArray(summary?.productIds) ? summary.productIds : [];
    const result = productIds.length ? await client.from('pricing_alerts' as any)
      .select(alertColumns).in('produto_id', productIds).is('merged_into', null)
      .order('severity_order', { ascending: true }).order('created_at', { ascending: true })
      : { data: [], error: null };
    if (result.error) throw new Error('read_failed');
    const byProduct = new Map<string, any[]>();
    for (const raw of result.data || []) {
      const row = normalize(raw);
      byProduct.set(row.produto_id, [...(byProduct.get(row.produto_id) || []), row]);
    }
    const data = productIds.flatMap((productId: string) => {
      const issues = byProduct.get(productId) || [];
      if (!issues.length) return [];
      const decisions = issues.flatMap(row => row.decisions || [])
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return [{ ...issues[0], issues, decisions: decisions.slice(0, 1) }];
    });
    return json({
      data,
      total: Number(summary?.total || 0),
      pendingCount: Number(summary?.affectedProductCount || 0),
      openAlertCount: Number(summary?.openAlertCount || 0),
      pendingDecisionCount: Number(summary?.pendingDecisionCount || 0),
      canManage,
      execution,
      executionBlocked: !execution.enabled,
    });
  } catch {
    return json({ error: 'Central de decisões indisponível' }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, 'pricing.decisions.manage');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const p = prepare.safeParse(body);
  const d = decide.safeParse(body);
  if (!p.success && !d.success) return json({ error: 'Comando inválido' }, 422);
  try {
    const client = createServiceClient();
    if (p.success) {
      const { data, error } = await client.rpc('prepare_pricing_decision' as any, {
        p_command_id: p.data.commandId,
        p_evaluation_id: p.data.evaluationId,
        p_actor_id: auth.userId,
        p_reason: p.data.reason,
      });
      if (error) throw new Error(error.message);
      return json({ decisionId: data, executionBlocked: true });
    }
    if (!d.success) return json({ error: 'Comando inválido' }, 422);
    const { decisionId, command: c } = d.data;
    const found = await client
      .from('pricing_decisions' as any)
      .select('id,state,context,alert:pricing_alerts!pricing_decisions_alert_id_fkey(produto_id)')
      .eq('id', decisionId)
      .maybeSingle();
    if (found.error) throw new Error('read_failed');
    if (!found.data) return json({ error: 'Decisão não encontrada' }, 404);
    const row = found.data as any;
    const replay = await client
      .from('pricing_events')
      .select('id')
      .eq('command_id', c.commandId)
      .maybeSingle();
    if (replay.error) throw new Error('read_failed');
    let freshId: string | undefined;
    if (c.action === 'approve' && !replay.data && ['pending', 'deferred'].includes(row.state)) {
      if (row.context.operationKind === 'listing_create') {
        const { preparePublication } = await import('@/services/publication-preparation');
        freshId = (await preparePublication(row.context.preparation.input, auth.userId)).evaluationId;
      } else {
      const response = await loadPricingDetail({
        produtoId: row.alert.produto_id,
        mlItemId: row.context.itemId,
        priceCents: row.context.priceCents,
        ...(row.context.clearance ? { clearance: row.context.clearance } : {}),
      });
      if (!response.ok) return response;
      freshId = (await response.json()).evaluationId;
      }
    }
    const { data, error } = await client.rpc('manage_pricing_decision' as any, {
      p_id: decisionId,
      p_command_id: c.commandId,
      p_actor_id: auth.userId,
      p_action: c.action,
      p_reason: c.reason,
      p_fresh_evaluation_id: freshId,
      p_deferred_until: c.deferredUntil,
    });
    if (error) throw new Error(error.message);
    return json(data);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'decision_invalid_deferral')
      return json({ code, error: 'Escolha uma data futura para rever a decisão.' }, 422);
    if (/^decision_[a-z_]+$/.test(code))
      return json(
        {
          code,
          error: 'A decisão ou suas evidências mudaram. Consulte o estado atualizado antes de continuar.',
        },
        code === 'decision_permission_denied' ? 403 : 409,
      );
    return json(
      { error: 'Não foi possível confirmar o registro. Consulte o histórico antes de tentar novamente.' },
      503,
    );
  }
}
