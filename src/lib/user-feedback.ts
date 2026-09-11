export type UserFeedbackTone = 'info' | 'success' | 'warning' | 'error';

export type UserFeedback = {
  tone: UserFeedbackTone;
  title: string;
  description: string;
  actionLabel?: string;
};

const TECHNICAL_MESSAGE_PATTERNS = [
  /\b(?:api|endpoint|http|https|payload|runtime|outbox|snapshot|stack|trace|sql|postgres|supabase|service_role|schema|refresh|job)\b/i,
  /\b(?:status_code|refresh_job_id|item_fetch_failed|price_to_win|failed_auth|completo_parcial|on_hold|contexto_alterado)\b/i,
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/,
  /(?:TypeError|ReferenceError|SyntaxError|ECONN|ENOTFOUND|ETIMEDOUT|SQLSTATE)/i,
  /(?:duplicate key|violates|constraint|column .* does not exist|relation .* does not exist|permission denied|não autenticado)/i,
  /(?:^|\s)(?:4\d\d|5\d\d)(?:\s|$)/,
  /[{}\[\]]|(?:at\s+[\w$.<>]+\s*\()/,
];

export function isTechnicalUserMessage(value: unknown): boolean {
  const message = String(value || '').trim();
  if (!message) return false;
  return TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Limite único entre falhas técnicas e textos apresentados na interface.
 * Mensagens conhecidas e simples podem ser preservadas; códigos, infraestrutura
 * e detalhes de implementação são substituídos por uma orientação operacional.
 */
export function userSafeMessage(value: unknown, fallback: string): string {
  const message = String(value || '').replace(/\s+/g, ' ').trim();
  if (!message || message.length > 280 || isTechnicalUserMessage(message)) return fallback;
  return message;
}

export function errorFeedback(title: string, description: string, actionLabel = 'Tentar novamente'): UserFeedback {
  return { tone: 'error', title, description, actionLabel };
}
