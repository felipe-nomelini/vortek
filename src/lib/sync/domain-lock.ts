import { randomUUID } from 'crypto';
import { createServiceClient } from '@/lib/supabase';

export interface DomainLockAcquireInput {
  domain: string;
  ownerTask: string;
  ownerJobId?: string | null;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface DomainLockAcquireResult {
  acquired: boolean;
  ownerToken: string;
}

export async function acquireDomainLock(input: DomainLockAcquireInput): Promise<DomainLockAcquireResult> {
  const client = createServiceClient();
  const ownerToken = `${input.ownerTask}:${input.ownerJobId || 'no_job'}:${randomUUID()}`;

  const { data, error } = await (client as any).rpc('acquire_sync_domain_lock', {
    p_domain: input.domain,
    p_owner_task: input.ownerTask,
    p_owner_token: ownerToken,
    p_owner_job_id: input.ownerJobId || null,
    p_ttl_seconds: Math.max(30, Math.trunc(input.ttlSeconds || 900)),
    p_metadata: input.metadata || {},
  } as any);

  if (error) {
    throw new Error(`Falha ao adquirir lock de domínio (${input.domain}): ${error.message}`);
  }

  return {
    acquired: Boolean(data),
    ownerToken,
  };
}

export async function releaseDomainLock(params: {
  domain: string;
  ownerToken: string;
  force?: boolean;
}): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await (client as any).rpc('release_sync_domain_lock', {
    p_domain: params.domain,
    p_owner_token: params.ownerToken,
    p_force: Boolean(params.force),
  } as any);

  if (error) {
    throw new Error(`Falha ao liberar lock de domínio (${params.domain}): ${error.message}`);
  }

  return Boolean(data);
}
