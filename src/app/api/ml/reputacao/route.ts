import { NextResponse } from 'next/server';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import {
  getReputationThresholds,
  isReputationLevelId,
  normalizeReputationMetric,
  type SellerReputationResponse,
} from '@/lib/ml/seller-reputation';
import { loadReputationVisualReview } from '@/lib/ml/reputation-visual-review';
import { fetchMLResult, getMLConnectionStatus } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function json(payload: SellerReputationResponse, status = 200) {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function disconnectedResponse(): SellerReputationResponse {
  return {
    conectado: false,
    precisaReconectar: true,
    updated_at: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, 'sales.read');
  if (!auth.ok) return auth.response;

  try {
    const visualReview = await loadReputationVisualReview();
    if (visualReview) return json(visualReview);

    const connection = await getMLConnectionStatus();
    if (!connection.conectado) return json(disconnectedResponse());

    const meResult = await fetchMLResult<Record<string, any>>('/users/me');
    if (!meResult.ok) {
      return json({
        conectado: true,
        precisaReconectar: meResult.error?.category === 'auth_fatal',
        erro: 'Não foi possível consultar a reputação no Mercado Livre.',
        updated_at: new Date().toISOString(),
      }, 502);
    }

    const me = meResult.data;
    if (!me?.id) {
      return json({
        conectado: true,
        precisaReconectar: false,
        indisponivel: true,
        updated_at: new Date().toISOString(),
      });
    }

    const userResult = me.seller_reputation
      ? meResult
      : await fetchMLResult<Record<string, any>>(`/users/${encodeURIComponent(String(me.id))}`);

    if (!userResult.ok) {
      return json({
        conectado: true,
        precisaReconectar: userResult.error?.category === 'auth_fatal',
        erro: 'Não foi possível consultar os dados do vendedor no Mercado Livre.',
        updated_at: new Date().toISOString(),
      }, 502);
    }

    const user = userResult.data;
    if (!user?.seller_reputation) {
      return json({
        conectado: true,
        precisaReconectar: false,
        indisponivel: true,
        updated_at: new Date().toISOString(),
      });
    }

    const reputation = user.seller_reputation as Record<string, any>;
    const metrics = reputation.metrics || {};
    const transactions = reputation.transactions || {};
    const ratings = transactions.ratings || {};
    const claims = normalizeReputationMetric(metrics.claims);
    const delayedHandling = normalizeReputationMetric(metrics.delayed_handling_time);
    const cancellations = normalizeReputationMetric(metrics.cancellations);
    const salesCompleted = toNumber(metrics.sales?.completed ?? metrics.sales_completed);
    const salesPeriod = typeof metrics.sales?.period === 'string'
      ? metrics.sales.period
      : claims.period || delayedHandling.period || cancellations.period || null;
    const siteId = typeof user.site_id === 'string' ? user.site_id : null;

    return json({
      conectado: true,
      precisaReconectar: false,
      indisponivel: false,
      updated_at: new Date().toISOString(),
      user: {
        id: user.id,
        nickname: typeof user.nickname === 'string' ? user.nickname : null,
        permalink: typeof user.permalink === 'string' ? user.permalink : null,
        registration_date: typeof user.registration_date === 'string' ? user.registration_date : null,
        site_id: siteId,
      },
      seller_reputation: {
        level_id: isReputationLevelId(reputation.level_id) ? reputation.level_id : null,
        power_seller_status: typeof reputation.power_seller_status === 'string'
          ? reputation.power_seller_status
          : null,
        real_level: isReputationLevelId(reputation.real_level) ? reputation.real_level : null,
        protection_end_date: typeof reputation.protection_end_date === 'string'
          ? reputation.protection_end_date
          : null,
      },
      transactions: {
        total: toNumber(transactions.total) || 0,
        completed: toNumber(transactions.completed) || 0,
        canceled: toNumber(transactions.canceled) || 0,
        period: typeof transactions.period === 'string' ? transactions.period : null,
        ratings: {
          positive: toNumber(ratings.positive),
          neutral: toNumber(ratings.neutral),
          negative: toNumber(ratings.negative),
        },
      },
      metrics: {
        claims,
        delayed_handling_time: delayedHandling,
        cancellations,
        sales_completed: salesCompleted,
        period: salesPeriod,
      },
      thresholds: getReputationThresholds(siteId),
    });
  } catch (error) {
    console.error('[ml-reputacao] Falha ao carregar reputação:', error);
    return json({
      conectado: false,
      precisaReconectar: false,
      erro: 'Falha ao carregar reputação do Mercado Livre.',
      updated_at: new Date().toISOString(),
    }, 500);
  }
}
