import { NextResponse } from 'next/server';
import { fetchMLResult, getMLConnectionStatus } from '@/services/integration';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const desconectado = {
  reclamacoes: null, atrasos: null, cancelamentos: null, positivas: null,
  nivel: 'Desconectado', nivelCor: '#888', nivelKey: '',
};

export async function GET() {
  try {
    const connection = await getMLConnectionStatus();
    if (!connection.conectado) {
      return NextResponse.json({ ...desconectado, conectado: false, precisaReconectar: true });
    }

    const meResult = await fetchMLResult<any>('/users/me');
    const me = meResult.ok ? meResult.data : null;
    if (!me) {
      return NextResponse.json({ ...desconectado, conectado: true, precisaReconectar: false, indisponivel: true });
    }

    const meSellerReputation = me?.seller_reputation;
    const userResult = meSellerReputation
      ? { ok: true, data: me }
      : await fetchMLResult<any>(`/users/${me.id}`);
    const user = userResult.ok ? userResult.data : null;
    if (!user?.seller_reputation) {
      return NextResponse.json({ ...desconectado, conectado: true, precisaReconectar: false, indisponivel: true });
    }

    const sr = user.seller_reputation;
    const metrics = sr.metrics || {};
    const transactions = sr.transactions || {};

    const reclamacoes = metrics.claims?.rate !== undefined ? metrics.claims.rate * 100 : null;
    const atrasos = metrics.delayed_handling_time?.rate !== undefined ? metrics.delayed_handling_time.rate * 100 : null;
    const cancelamentos = metrics.cancellations?.rate !== undefined ? metrics.cancellations.rate * 100 : null;
    const positivas = transactions.ratings?.positive !== undefined ? transactions.ratings.positive * 100 : null;

    const levelId = sr.level_id || '';
    const colorPart = levelId.split('_').pop() || '';

    const levelMap: Record<string, { color: string; label: string }> = {
      green: { color: '#52c41a', label: 'Mercado Líder' },
      light_green: { color: '#52c41a', label: 'Mercado Líder' },
      yellow: { color: '#faad14', label: 'MercadoLíder' },
      orange: { color: '#fa8c16', label: 'Padrão' },
      red: { color: '#ff4d4f', label: 'Pendente' },
    };

    const powerStatus = sr.power_seller_status;
    let label = levelMap[colorPart]?.label || 'Sem reputação';
    if (powerStatus) {
      const medal = powerStatus.charAt(0).toUpperCase() + powerStatus.slice(1);
      label = `Mercado Líder ${medal}`;
    }

    return NextResponse.json({
      reclamacoes,
      atrasos,
      cancelamentos,
      positivas,
      nivel: label,
      nivelCor: levelMap[colorPart]?.color || '#888',
      nivelKey: colorPart,
      conectado: true,
      precisaReconectar: false,
    });
  } catch {
    return NextResponse.json(desconectado);
  }
}
