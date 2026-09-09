import { z } from 'zod';

const identifier = z.discriminatedUnion('by', [
  z.object({ by: z.literal('id'), value: z.string().uuid() }).strict(),
  z.object({ by: z.literal('sale'), value: z.string().regex(/^\d{1,22}$/) }).strict(),
  z.object({ by: z.literal('pack'), value: z.string().regex(/^\d{1,22}$/) }).strict(),
]);
const product = z.discriminatedUnion('by', [
  z.object({ by: z.literal('id'), value: z.string().uuid() }).strict(),
  z.object({ by: z.literal('sku'), value: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} ._/-]+$/u) }).strict(),
]);
export const assistantQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sales'), period: z.enum(['today', '7d', '30d']).default('7d') }).strict(),
  z.object({ kind: z.literal('order'), record: identifier }).strict(),
  z.object({ kind: z.literal('purchase'), dsliteId: z.string().regex(/^\d{1,22}$/) }).strict(),
  z.object({ kind: z.literal('product'), record: product }).strict(),
  z.object({ kind: z.literal('inventory'), record: product }).strict(),
  z.object({ kind: z.literal('pricing'), record: product }).strict(),
  z.object({ kind: z.literal('invoice'), record: identifier }).strict(),
  z.object({ kind: z.literal('tax') }).strict(),
  z.object({ kind: z.literal('documentation'), topic: z.enum(['pricing', 'orders', 'inventory', 'settings', 'assistant', 'pricing_history']) }).strict(),
]);
export type AssistantQuery = z.infer<typeof assistantQuerySchema>;
export type AssistantState = 'concluido' | 'sem_dados' | 'fonte_indisponivel' | 'acesso_negado'
  | 'entrada_invalida' | 'esclarecimento_necessario' | 'cancelado' | 'tempo_esgotado' | 'ambiente_bloqueado';
export type AssistantCoverage = 'completa' | 'parcial' | 'sem_dados' | 'desatualizada';
export type AssistantReference = { id: string; label: string; path: string; updatedAt: string | null };
