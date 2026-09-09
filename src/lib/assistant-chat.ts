import { z } from 'zod';
import type { AssistantCoverage, AssistantQuery, AssistantReference } from './assistant-contract';

export const CHAT_MODEL = 'gpt-6-astra';
export const CHAT_TIMEOUT_MS = 120_000;
export const chatInputSchema = z.object({
  conversationId: z.string().uuid(), requestId: z.string().uuid(),
  question: z.string().trim().min(1).max(4000),
}).strict();
export const conversationTitleSchema = z.object({ title: z.string().trim().min(1).max(100) }).strict();
export type ChatState = 'running' | 'cancel_requested' | 'concluido' | 'sem_dados' | 'esclarecimento_necessario'
  | 'fonte_indisponivel' | 'autenticacao_necessaria' | 'acesso_negado' | 'modelo_indisponivel'
  | 'limite_atingido' | 'ocupado' | 'tempo_esgotado' | 'cancelado' | 'provedor_indisponivel'
  | 'resposta_invalida' | 'ambiente_bloqueado' | 'entrada_invalida';
export const chatStateLabels: Record<ChatState, string> = {
  running: 'Preparando resposta', cancel_requested: 'Interrompendo resposta', concluido: 'Concluído',
  sem_dados: 'Não encontrei dados para esta consulta.', esclarecimento_necessario: 'Preciso de mais informações para consultar.',
  fonte_indisponivel: 'Não foi possível consultar a fonte agora.', autenticacao_necessaria: 'O login ChatGPT do Assistente precisa ser conectado.',
  acesso_negado: 'O Assistente está disponível somente ao titular autorizado.', modelo_indisponivel: 'O modelo escolhido não está disponível na assinatura.',
  limite_atingido: 'O limite da assinatura foi atingido. Nenhum provedor pago será utilizado.', ocupado: 'Já existe uma resposta em andamento. Aguarde ou interrompa essa resposta.',
  tempo_esgotado: 'A consulta excedeu o tempo permitido.', cancelado: 'Resposta interrompida.',
  provedor_indisponivel: 'O provedor não está disponível agora.', resposta_invalida: 'A resposta não pôde ser validada e foi descartada.',
  ambiente_bloqueado: 'O Assistente não está habilitado neste ambiente DEV.', entrada_invalida: 'Revise a pergunta ou os identificadores informados.',
};
export interface ChatSource extends AssistantReference {
  excerpt?: string; version?: string; authority?: string;
}
export interface ChatEvidence {
  query: AssistantQuery | null; coverage: AssistantCoverage; queriedAt: string; sourceUpdatedAt: string | null;
  period: { start: string; end: string; timezone: string } | null; warnings: string[]; includesFixtures: boolean;
}
export interface ChatAnswer {
  text: string; sources: ChatSource[]; evidence: ChatEvidence[]; model: typeof CHAT_MODEL;
}
export interface ChatConversation { id: string; title: string; created_at: string; updated_at: string }
export interface ChatMessage {
  id: string; conversation_id: string; request_id: string; role: 'user' | 'assistant';
  content: string; state: ChatState; answer: ChatAnswer | null; created_at: string; deadline_at: string | null;
}
export type ChatEvent = { type: 'phase'; phase: string } | { type: 'message'; message: ChatMessage }
  | { type: 'error'; state: ChatState };

// Literal user content never becomes HTML or an arbitrary hyperlink.
export function safeAssistantLink(path: string): string | null {
  const allowed = /^\/(dashboard|pedidos|compras|produtos|estoque|notas-fiscais|configuracoes)(\/|\?|$)/;
  if (!allowed.test(path)) return null;
  if (/[\\\r\n]/.test(path)) return null;
  const url = new URL(path, 'https://dev.bentevi.shop');
  return url.origin === 'https://dev.bentevi.shop' && allowed.test(url.pathname) ? url.pathname + url.search : null;
}
