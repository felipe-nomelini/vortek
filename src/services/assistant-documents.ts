import 'server-only';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { AssistantQuery } from '@/lib/assistant-contract';

type Topic = Extract<AssistantQuery, { kind: 'documentation' }>['topic'];
type Source = { file: string; headings: string[]; authority: 'vigente' | 'historica' | 'mista'; implementation: 'implementada' | 'parcial' | 'historica' };
const canon = 'VORTEK_CANON_COMERCIAL_V1.md';
const checklist = 'VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md';

/** Índice, não cópia das regras. Trechos mantêm autoridade e situação explícitas. */
const SOURCES: Record<Topic, Source> = {
  pricing: { file: canon, headings: ['## 2. Política de margem por PREÇO FINAL', '## 3. Economia unitária canônica',
    '## 7. Tarifa ML e frete', '## 8. Tributação', '## 9. Lucro mínimo nominal — REMOVIDO',
    '## 12. Desconto/faixas por quantidade — REMOVIDOS', '## 15. Origem e override', '## 16. Liquidação interna'], authority: 'vigente', implementation: 'implementada' },
  orders: { file: checklist, headings: ['### UI-01 — Pedidos', '### UI-04 — DTO Pedidos'], authority: 'mista', implementation: 'implementada' },
  inventory: { file: checklist, headings: ['#### Resultado técnico de `BNT-D05 — Estoque`'], authority: 'mista', implementation: 'implementada' },
  settings: { file: 'VORTEK_BENTEVI_CONFIGURACOES_DOSSIE.md', headings: ['## 3. Classificação obrigatória', '## 4. Arquitetura de informação final'], authority: 'mista', implementation: 'parcial' },
  assistant: { file: 'VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md', headings: ['## 1. Decisão e autoridade', '## 6. Critérios por ação'], authority: 'vigente', implementation: 'parcial' },
  pricing_history: { file: 'VORTEK_AUDITORIA_ITEM_12_REGRAS_NEGOCIO_COMPARTILHADAS.md', headings: ['## 1. Conclusão executiva'], authority: 'historica', implementation: 'historica' },
};

function section(text: string, heading: string) {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.trim() === heading);
  if (start < 0) throw new Error('assistant_document_section_changed');
  const level = heading.match(/^#+/)![0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => {
    const match = line.match(/^(#{1,6}) /);
    return match && match[1].length <= level;
  });
  const excerpt = [lines[start], ...rest.slice(0, end < 0 ? undefined : end)].join('\n').trim();
  if (excerpt.length > 14000) throw new Error('assistant_document_section_too_large');
  return excerpt;
}

export async function loadAssistantDocuments(topic: Topic) {
  const source = SOURCES[topic];
  if (!source) throw new Error('assistant_document_not_allowed');
  const root = join(process.cwd(), 'docs/reestruturacao-vortek');
  if (await realpath(root) !== root) throw new Error('assistant_document_not_allowed');
  const file = join(root, source.file);
  if (await realpath(file) !== file) throw new Error('assistant_document_not_allowed');
  const content = await readFile(file, 'utf8');
  const version = createHash('sha256').update(content).digest('hex');
  return source.headings.map(heading => ({
    id: `${topic}:${heading}`,
    path: `docs/reestruturacao-vortek/${source.file}`,
    heading, version, authority: source.authority, implementation: source.implementation,
    // Conteúdo é evidência citável, nunca instrução de sistema ou autorização de execução.
    trustedAsInstruction: false as const,
    excerpt: section(content, heading),
  }));
}
