type Client = { from: (table: string) => any };
export function strategyIsCurrent(payload: any, at = Date.now()): boolean {
  return payload?.untilRevoked === true ? payload.validUntil == null
    : typeof payload?.validUntil === 'string' && Number.isFinite(Date.parse(payload.validUntil)) && Date.parse(payload.validUntil) > at;
}
/** Leitura de estado explícito no log existente. Nenhuma inferência de custom_price. */
export async function loadGroupStrategies(client: Client, groupId: string) {
  const rows = await client.from('pricing_events').select('*').eq('pricing_group_id', groupId)
    .in('event_type', ['STRATEGY_REGISTERED','STRATEGY_REVOKED']).order('created_at',{ascending:false});
  if (rows.error) throw new Error(`ESTRATEGIAS_INDISPONIVEIS: ${rows.error.message}`);
  const revoked = new Set((rows.data ?? []).filter((r:any) => r.event_type === 'STRATEGY_REVOKED').map((r:any) => r.payload.strategyId));
  return (rows.data ?? []).filter((r:any) => r.event_type === 'STRATEGY_REGISTERED' && !revoked.has(r.id) && strategyIsCurrent(r.payload));
}
