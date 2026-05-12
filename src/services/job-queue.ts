/**
 * Sistema de fila de jobs em memória com persistência no Supabase.
 * Gerencia execução assíncrona de tarefas longas com suporte a:
 * - Barra de progresso (0-100%)
 * - Logs em tempo real
 * - Cancelamento via AbortController
 * - Persistência na tabela `jobs` do Supabase
 */
import { createServiceClient } from '@/lib/supabase';

export type JobStatus = 'pendente' | 'rodando' | 'completo' | 'erro' | 'cancelado';

export interface JobLogEntry {
  type: 'success' | 'error' | 'info';
  message: string;
  timestamp: string;
}

export interface JobData {
  id: string;
  tipo: string;
  status: JobStatus;
  progresso: number;
  total: number;
  processados: number;
  log: JobLogEntry[];
  cancelado: boolean;
  created_at: string;
  finished_at: string | null;
}

type JobHandler = (jobId: string, update: UpdateFn) => Promise<void>;
export type UpdateFn = (data: Partial<JobData>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const abortControllers = new Map<string, boolean>();

function now(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return crypto.randomUUID();
}

export function registerJobHandler(tipo: string, handler: JobHandler) {
  handlers.set(tipo, handler);
}

export async function createJob(tipo: string, total: number): Promise<JobData> {
  const id = makeId();
  const job: JobData = {
    id, tipo, status: 'pendente', progresso: 0,
    total, processados: 0, log: [], cancelado: false,
    created_at: now(), finished_at: null,
  };

  const serviceClient = createServiceClient();
  await serviceClient.from('jobs').insert({
    id, tipo, status: 'pendente', progresso: 0, total,
    log: [], cancelado: false, created_by: null,
  });

  runJob(id, tipo, total);
  return job;
}

async function runJob(jobId: string, tipo: string, total: number) {
  const handler = handlers.get(tipo);
  if (!handler) return;

  abortControllers.set(jobId, false);

  const update: UpdateFn = async (data) => {
    const serviceClient = createServiceClient();
    const updates: any = { ...data };
    if (updates.log) updates.log = JSON.stringify(updates.log);
    await serviceClient.from('jobs').update(updates).eq('id', jobId);
  };

  await update({ status: 'rodando' });

  try {
    await handler(jobId, update);
    const wasCancelled = abortControllers.get(jobId);
    if (!wasCancelled) {
      await update({ status: 'completo', progresso: 100, finished_at: now() });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    const serviceClient = createServiceClient();
    const current = await serviceClient.from('jobs').select('log').eq('id', jobId).single();
    const log: any[] = (current.data?.log || []) as any[];
    log.push({ type: 'error', message: msg, timestamp: now() });
    await serviceClient.from('jobs').update({ status: 'erro', log: JSON.stringify(log), finished_at: now() }).eq('id', jobId);
  }

  abortControllers.delete(jobId);
}

export async function getJob(jobId: string): Promise<JobData | null> {
  const serviceClient = createServiceClient();
  const { data } = await serviceClient.from('jobs').select('*').eq('id', jobId).single();
  if (!data) return null;
  return {
    id: data.id, tipo: data.tipo, status: data.status as JobStatus,
    progresso: data.progresso, total: data.total, processados: data.processados || 0,
    log: typeof data.log === 'string' ? JSON.parse(data.log) : (data.log || []),
    cancelado: data.cancelado, created_at: data.created_at, finished_at: data.finished_at,
  };
}

export async function cancelJob(jobId: string): Promise<boolean> {
  abortControllers.set(jobId, true);
  const serviceClient = createServiceClient();
  await serviceClient.from('jobs').update({ status: 'cancelado', finished_at: now() }).eq('id', jobId);
  return true;
}

export async function listJobs(): Promise<JobData[]> {
  const serviceClient = createServiceClient();
  const { data } = await serviceClient.from('jobs').select('*').order('created_at', { ascending: false }).limit(50);
  return (data || []).map((d: any) => ({
    id: d.id, tipo: d.tipo, status: d.status,
    progresso: d.progresso, total: d.total, processados: d.processados || 0,
    log: typeof d.log === 'string' ? JSON.parse(d.log) : (d.log || []),
    cancelado: d.cancelado, created_at: d.created_at, finished_at: d.finished_at,
  }));
}

export function isCancelled(jobId: string): boolean {
  return abortControllers.get(jobId) === true;
}
