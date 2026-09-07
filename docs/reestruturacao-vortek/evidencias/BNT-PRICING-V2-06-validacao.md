# BNT-PRICING-V2-06 — Liquidação interna

Data: 07/09/2026. Base: `2eaf020`, branch `dev` inicialmente limpa.

**Entrega:** autorização administrativa de liquidação interna, recorte de estoque, limite de perda unitária, transferência entre grupos, auditoria e interface no detalhe do produto. Implementação/validação local e SQL DEV concluídas; sem push, deploy, escrita ML ou acesso à produção. Aceite visual no domínio permanece para o deploy conjunto solicitado pelo usuário.

**Atualização posterior — 07/09/2026:** o lote até `562ffa3` foi publicado em DEV a pedido do usuário; override e liquidação foram aprovados visualmente na conversa. As menções a ausência de deploy neste relatório descrevem a entrega inicial. A aprovação não autoriza escritas ML, conta real ou promoção em produção.

## AS_IS → TO_BE

| Área | Antes | Agora |
| --- | --- | --- |
| Exceção interna | Não existia entidade operacional | Autorização explícita, motivo, autor, quantidade, perda máxima, vigência e encerramento |
| Estoque | Ledger de entradas, reservas, baixas e estornos | Recorte de unidades das entradas existentes, sem outro saldo físico |
| Grupos | Override propagado por grupo | Liquidação mantém o mesmo ID/orçamento nos grupos resultantes; conflito de autorizações bloqueia aplicação |
| Economia | Oferta ativa e memória ECON-2 | Mesma fonte/fórmula; perda permitida é governança separada da economia |
| Interface | Apenas override no detalhe | Bloco de liquidação, confirmação explícita e histórico integrado |

Decisões expressas: admin e gerente podem gerenciar; demais perfis consultam; prejuízo máximo por unidade; transferência sem ampliar limites; custo canônico da oferta ativa, não CMV histórico das unidades.

## Contratos implementados

- `internal_stock_clearance`, entradas abrangidas e vínculos com grupos são tabelas tipadas. Sem key/value administrativo, scheduler, outbox, dependência nova ou nova fórmula econômica.
- Estado persistido `active/revoked/completed`; `expired` é leitura derivada do relógio do servidor. GET não atualiza estado nem dispara jobs. Encerramento é explícito; reserva temporária não equivale a liquidação concluída.
- Ativação recorta unidades liberadas, operacionais e sem compromisso no FIFO do ledger. Novas entradas não participam da autorização. Reservas/saídas diminuem o recorte; estorno restaura somente unidades do recorte original, nunca reabre autorização encerrada.
- Conservadoramente, uma entrada já abrangida por autorização vigente não participa de outra autorização, mesmo se tiver unidades excedentes. As unidades excedentes continuam no estoque normal; não são reservadas fisicamente pela liquidação.
- Kit usa unidades dos componentes e proporção por venda. Composição alterada/inativa impede aplicação, mas consulta e encerramento continuam disponíveis.
- Reconciliação completa transfere vínculos pela continuidade comprovada dos membros. A mesma autorização mantém quantidade, perda e prazo; não soma orçamento por anúncio. Reconciliação incompleta não expande alcance. Duas autorizações convergentes não são fundidas: aplicação fica em conflito.
- Comandos possuem UUID idempotente, motivo obrigatório e autor obtido no backend. A autorização e seu evento/evidência econômica são gravados na mesma transação. Reenvio idêntico retorna o registro original; comando adulterado é conflito.
- RLS habilitada, sem DML direto para browser ou service role nas tabelas de autorização; funções restritas ao backend. Permissão `pricing.clearance.manage` verificada também na RPC.
- Preparação e transição `requested` chamam a verificação de governança: liquidação explícita exige origem interna, quantidade disponível, fonte manual autorizada, economia dentro da perda máxima e revalidação. Autorização não contorna grupo inválido, fonte ausente/vencida ou custo alterado. Sem liquidação, permanece o contrato do override.
- Uma operação ativa por autorização impede concorrência entre grupos compartilhados. Encerramento/revogação não cancela operação já enviada ou inconclusiva; read-back continua reconciliável.
- GET/POST `/api/produtos/[id]/pricing-clearances`; histórico existente aceita `clearanceId`. Campos monetários em centavos, quantidade inteira, vigência explícita sem teto arbitrário. Amostras visuais e entradas mockadas não são operacionalizadas.

## Limitação comercial explícita

A interface registra **autorização administrativa**, não aprovação de preço. A leitura local reutiliza a economia canônica e pode ser inconclusiva por ausência de frete/cotação. Isso é exibido, não substituído por zero ou marcado como prejuízo real. Um registro administrativo pode existir sem economia aplicável; nenhuma escrita comercial decorre dele.

O executor comercial continua incondicionalmente bloqueado por `pricing_execution_not_ready`. Esta etapa não comprova exposição/estoque publicado no ML nem habilita a venda interna por preço excepcional. A conexão real autorizada, frete ME2, revalidação completa imediatamente antes do efeito, confirmação humana e publicação/read-back permanecem nos gates comerciais existentes.

## Validação executada

- Migration nova `20260907203000_bnt_pricing_v2_06_clearance.sql` ensaiada com rollback e aplicada exclusivamente a **192.168.1.162 / supabase-dev**; peer TCP, hostname, histórico e schema conferidos. Conteúdo registrado comparado ao arquivo: idêntico. Migrations anteriores não alteradas.
- Tipos das estruturas/RPCs afetadas gerados pelo metadata do mesmo DEV; tipos não relacionados preservados.
- `tests/pricing-clearances.sql`, `tests/pricing-overrides.sql`, `tests/pricing-audit.sql`: aprovados no ensaio e novamente após aplicação, sob rollback. Cobrem permissões, idempotência, recortes/estoque, reservas, despacho, estorno, reposição, kits, composição, grupos, conflito, expiração, revogação, prejuízo no limite/um centavo além, custo alterado, fonte stale e operação em andamento.
- Concorrência real com duas conexões: autorizações de sellers diferentes competindo pelo mesmo produto. Segunda transação aguardou o lock do estoque, confirmado em `pg_locks`; após rollback da primeira, a segunda concluiu e também foi revertida. Somente fixtures dedicadas de produto/entrada/grupos foram removidas ao final; nenhum dado do usuário foi excluído.
- **338 testes Node aprovados**, incluindo contratos/API/renderização SSR com Ant Design real e regressões de economia, grupos, override, auditoria, capacidade e detalhe do produto. SSR com estado injetado não substitui inspeção visual em navegador.
- `npm run validate`: aprovado, sem warnings de lint. `npm run build`: aprovado. O build pula typecheck por configuração existente; o typecheck foi executado separadamente dentro de validate.
- Conferência após testes: zero autorizações e zero produtos `TEST-CLEARANCE%` persistidos. Sem alterações em produção, preços ML ou AGENTS.md.
- RPCs de leitura de estoque/liquidações e SELECT do campo `clearance_id` no histórico responderam HTTP 200 no PostgREST do `.162`, sem imprimir registros. Zero grupos das fixtures após limpeza.

Comando direcionado:

```bash
node --test tests/m2m-*.test.js tests/pricing-audit*.test.js tests/pricing-overrides.test.js tests/pricing-clearances.test.js tests/permissions.test.js tests/fulfillment-capacity.test.js tests/bentevi-product-detail.test.js
```

## Rollback e continuidade

Rollback seletivo da aplicação mantendo o schema, autorizações e trilha. Remover a interface não revoga decisões existentes. Não apagar histórico nem reescrever migration aplicada; ajustes de banco exigem migration posterior e novo preflight DEV. Guard comercial permanece bloqueado.

Pendências externas já previstas: deploy/aceite visual conjunto, frete vivo ME2 e gates de execução comercial. Próxima ação da fila: **BNT-CANON-WARRANTY-01 — Garantia por evidência**.

## Referências

Skills locais de implementação e Supabase orientaram preflight DEV, migration incremental, testes e validação. O mapa do AGENTS prevalece sobre o endereço antigo contido na skill Supabase.

- [PostgreSQL 17: concorrência e locks](https://www.postgresql.org/docs/17/explicit-locking.html).
- [Supabase: funções e privilégios](https://supabase.com/docs/guides/database/functions).
- [Ant Design 5: Modal](https://5x.ant.design/components/modal/).
- Guia instalado de Route Handlers do Next.js 16.3.3, em `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
