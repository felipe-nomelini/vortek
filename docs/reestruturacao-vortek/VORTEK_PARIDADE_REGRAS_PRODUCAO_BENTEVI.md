# Vortek/Bentevi — Paridade de regras entre produção e nova versão

**Ação:** `BNT-PARITY-00 — Fotografia e catálogo de regras`

**Fotografia:** 04/09/2026

**Produção auditada:** `origin/main` e serviço `vortek-erp` no SHA `95941f1924efa42e890fba592fe400f9e25ae706`

**Bentevi auditada:** `origin/dev` no SHA `0d415b59711ef15d686953fb87d5ef6d814870aa`

**Ancestral comum:** `08b6237428c406b55a876578b63dbc553e8c9584`

**Resultado:** fotografia concluída; aplicação das divergências permanece bloqueada para ações `BNT-PARITY-N` separadas.

---

## 1. Conclusão executiva

A Bentevi preserva a maior parte das regras estruturais do Vortek e já substituiu conscientemente vários modelos antigos por fontes tipadas, estoque próprio estruturado, pricing dinâmico, segurança de banco e configuração administrativa.

Foram encontrados **13 commits exclusivos em produção**, envolvendo 83 arquivos e quatro migrations. A análise funcional identificou:

- **14 regras produtivas que devem ser incorporadas**, organizadas em 13 ações controladas;
- **1 decisão operacional pendente**, sobre destinatário adicional de etiqueta da Evolusom;
- comportamentos intermediários ou históricos que não devem ser copiados;
- uma colisão real de versão de migration que bloqueia promoção automática do histórico;
- ausência, na Bentevi, do estado produtivo `concretizada_ml` e da deduplicação de alerta de nova venda por inserção;
- divergência crítica na propriedade de `produtos.ativo`, hoje ainda alterada por sincronizadores da Bentevi, apesar da correção produtiva torná-la decisão manual.

Nenhuma regra foi aplicada nesta ação. Não houve alteração funcional, migration, escrita em banco, chamada mutável a integração, deploy ou acesso a PII.

---

## 2. Método e limites da fotografia

1. `origin/main` e `origin/dev` foram atualizados e comparados pelo ancestral comum.
2. O SHA efetivamente implantado em produção foi confrontado com `origin/main`.
3. Os 13 commits exclusivos de produção foram lidos individualmente, incluindo código, migrations e testes.
4. Regras anteriores ao ancestral comum foram rastreadas pelas fontes atuais de código, schema, testes e consumidores web/mobile.
5. Os bancos foram fotografados com o coletor `scripts/capture-db-03-snapshot.js` e sessão PostgreSQL `READ ONLY`:
   - `192.168.1.160`: produção, somente leitura;
   - `192.168.1.162`: `supabase-dev`, também somente leitura durante esta ação.
6. Consultas de negócio usaram somente configuração, agregados e presença de runtime; nenhum nome de cliente, telefone, documento, payload bruto ou secret foi extraído.
7. O worktree local `vortek-prod` estava com alterações do usuário e não foi usado como fonte. A referência produtiva foi o objeto Git imutável do SHA implantado.

O uso de transação `READ ONLY` segue o contrato do PostgreSQL, que bloqueia DML/DDL sobre tabelas não temporárias. A semântica externa foi confrontada com documentação oficial atual listada na seção 10.

---

## 3. Watermarks e fotografia estrutural

| Evidência | Produção `.160` | Bentevi DEV `.162` |
| --- | --- | --- |
| PostgreSQL | 15.8 | 17.6 |
| Horário UTC da captura | 2026-09-04 21:58:47 | 2026-09-04 21:58:55 |
| Fingerprint estrutural | `2d701acd81b25ed38c18f07ba1e27463fd2ba689b9eee2728d17deb45670e4ca` | `2337d46c87c84a996a8cd9b3977cd710e7fb67798c48728df66d681275033e21` |
| Migrations registradas | 87 | 108, iguais ao repositório DEV |
| Tabelas públicas | 39 | 51 |
| Tabelas públicas sem RLS | 3 | 0 |
| Policies | 9 | 5 |
| Constraints | 134 | 230 |
| Índices | 159 | 197 |
| Funções `SECURITY DEFINER` | 13 | 16 |

Não existe relação presente somente em produção. As 13 relações exclusivas da Bentevi são evoluções do Item 17: recebimento e posição de estoque próprio, manifestação de NF-e, devoluções fiscais, auditoria administrativa, pricing configurável, observação durável de anúncios e configuração de Push.

### Divergências do registro de migrations

- Produção possui, sem equivalente de versão no repositório DEV, `20260903183000_reactivate_products_with_eligible_active_supplier` e `20260904041000_add_concretizada_ml_order_status`.
- A versão **`20260830143000` colide**:
  - produção: `internal_purchase_stock_origin`;
  - Bentevi: `atomic_internal_stock_reservation`.
- Produção também registra nomes históricos diferentes em `00008`, `20260709120000` e `20260709121500`.
- A correção deve usar uma nova migration. É proibido renomear, reescrever ou reaplicar silenciosamente qualquer migration já registrada.

---

## 4. Inventário dos commits exclusivos de produção

| Commit | Efeito produtivo confirmado | Regras do catálogo | Destino |
| --- | --- | --- | --- |
| `8ee94fe` | retoma worker de catálogo e preserva estágio real em falha | `ML-05`, `ML-06` | rota equivalente; incorporar estágio de falha |
| `9794116` | índices operacionais de jobs | `JOB-01` | equivalente |
| `ce96e0d` | URL interna no servidor sem alterar identidade pública do cookie | `SEC-06` | equivalente |
| `420cd64` | inativação de fornecedor preserva produto com estoque interno e pausa anúncio | `SUP-05`, `SUP-06` | incorporar |
| `b1f9e58` | regenera tipos do schema produtivo | `DB-02` | não copiar arquivo gerado |
| `f3e9199` | reprocessamento explícito e idempotente da inativação | `SUP-07` | incorporar |
| `649aa4f` | bloqueio de identidade inserido inicialmente no fluxo de venda | `ML-03` | não copiar; supersedido por `4bdca2c` |
| `dc60a2b` | fallback seguro de retomada e envio idempotente por destinatário | `ORD-09`, `NTF-04`, `NTF-05` | incorporar; contato adicional exige decisão |
| `4bdca2c` | move identidade para criação/ativação de anúncio e limpa bloqueio automático resolvido | `ML-03`, `ML-04` | gate equivalente; incorporar limpeza |
| `9302353` | POST de deploy com JSON explícito | `OPS-01` | incorporar |
| `2ac64cc` | torna atividade do produto decisão manual e rejeita oferta inativa | `PRD-02`, `SUP-02` | incorporar |
| `b95ba98` | cria lifecycle `concretizada_ml` sob evidências financeiras/operacionais | `ORD-10` | incorporar |
| `95941f1` | alerta WhatsApp somente para venda paga recém-inserida | `NTF-03` | incorporar |

---

## 5. Catálogo canônico de regras

Cada linha representa uma decisão de negócio ou contrato operacional. A coluna **Entrada → decisão** inclui cálculo e unidade; **Precedência/fallback** declara qual fonte vence e o comportamento quando a evidência falta.

### 5.1 Pricing, impostos e comercial

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PRC-01` | `src/services/pricing.ts` | RBT12 mensal → alíquota efetiva do Simples; mínimo 4% | confirmada só protege quando maior que estimada | pricing, produtos, anúncios | mesma fonte central | `EQUIVALENTE` | testes de pricing; manter |
| `PRC-02` | `src/services/pricing.ts` | RBT12 acima de R$ 3,6 mi → exige alíquota PGDAS confirmada | sem confirmada, cálculo bloqueado | pricing automático | igual | `EQUIVALENTE` | `requirePricingTaxRate`; manter |
| `PRC-03` | pricing produtivo legado | custo + frete + taxa ML + margem → preço sugerido em BRL | configuração persistida vence constante | produtos/anúncios | Bentevi usa três faixas tipadas, mais recentes | `SUBSTITUÍDA` | `pricing_cost_tiers`; não restaurar margem global |
| `PRC-04` | `src/services/pricing.ts` | custo em BRL → primeira faixa cujo teto atende | exatamente 3 faixas; última ilimitada | pricing | fonte configurável Bentevi | `SUBSTITUÍDA` | migration `BNT-CFG-03`; manter |
| `PRC-05` | `calculateSuggestedPrice` | preço = maior entre margem por faixa e lucro mínimo por faixa | piso nominal prevalece | pricing/anúncios | igual na Bentevi | `EQUIVALENTE` | testes de limites; manter |
| `PRC-06` | produto/anúncio ML | taxa observada válida [0,1) → usar; ausente → fallback | taxa real do anúncio vence fallback | pricing | fallback Bentevi 15% | `EQUIVALENTE` | `resolveMlFee`; manter configurável |
| `PRC-07` | pricing ML | frete observado em BRL → usar; indisponível → valor configurado | frete real vence fallback | criação e recálculo de anúncio | fallback Bentevi R$ 30 | `EQUIVALENTE` | `resolveCurrentMlPricing`; manter |
| `PRC-08` | produto/anúncio | `custom_price` válido → não sobrescrever automaticamente | decisão manual vence automação | sync/preço/anúncio | preservado | `EQUIVALENTE` | testes `RULE-02`/`INV-05`; manter |
| `PRC-09` | atacado ML | quantidade mínima 1–100 → desconto crescente 0–100% | preço líquido retornado pelo ML vence fallback percentual | oferta/anúncio | 1–5 faixas tipadas; defaults 3/3%, 5/4%, 10/5% | `SUBSTITUÍDA` | `ml_quantity_pricing_tiers`; manter |
| `PRC-10` | `configuracoes.margem_lucro` | percentual global legado | fonte antiga somente histórica | telas antigas | produção 10%, DEV 30%, ambos obsoletos pelo pricing por faixa | `NÃO COPIAR` | não usar para preço novo |
| `PRC-11` | regra de custo | custo acima do limite → oferta inelegível/inativa | limite configurado; não decide atividade manual do produto | sync, elegibilidade | limite Bentevi R$ 2.000; alguns syncs ainda alteram `produtos.ativo` | `INCORPORAR` | ação `BNT-PARITY-01` |

### 5.2 Produtos, ofertas, fornecedores e kits

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PRD-01` | `produto_fornecedor_ofertas` + `produto-fornecedor.ts` | ofertas → snapshot de custo, estoque e fornecedor em `produtos` | oferta é fonte; produto é projeção | catálogo, anúncios, pedidos | igual | `EQUIVALENTE` | manter fonte única |
| `PRD-02` | commit `2ac64cc` | ação do usuário → `produtos.ativo` | decisão manual exclusiva | produto, publicação, sync | syncs DEV ainda escrevem atividade por custo | `INCORPORAR` | ação `BNT-PARITY-01`; regressão de sync |
| `SUP-01` | `preferred-offer.ts` | ofertas válidas → menor custo; prioridade, estoque e ID desempatem | preferência manual válida vence | catálogo, pricing, fulfillment | centralizado | `EQUIVALENTE` | testes de oferta preferencial |
| `SUP-02` | commit `2ac64cc` | nenhuma oferta ativa → nenhuma preferencial automática | oferta inativa nunca é fallback | produto/anúncio | DEV ainda volta a oferta inativa com custo | `INCORPORAR` | ação `BNT-PARITY-02` |
| `SUP-03` | `supplier-policy.ts` | fornecedor ativo e sem aposentadoria → operacional | aposentadoria vence flag ativa | sync, DSLite, capacidade | igual | `EQUIVALENTE` | testes HAYA |
| `SUP-04` | decisões HAYA | Hayamax → somente histórico; sem dropshipping ou conta-saldo operacional | decisão Item 17 vence produção histórica | compras/financeiro | aposentada | `SUBSTITUÍDA` | não reativar integrações exclusivas |
| `SUP-05` | commit `420cd64` | fornecedor inativado + estoque interno disponível → produto continua ativo | capacidade interna válida preserva operação | fornecedor/produto/anúncio | classificação DEV ignora estoque interno nesse ponto | `INCORPORAR` | ação `BNT-PARITY-03` |
| `SUP-06` | commit `420cd64` | produto sem alternativa → anúncio pausado com quantidade 0 | pausar é reversível; não fechar/excluir | inativação de fornecedor | DEV ainda enfileira exclusão | `INCORPORAR` | ação `BNT-PARITY-04` |
| `SUP-07` | commit `f3e9199` | `reprocess=true` → reexecuta inativação sem duplicar job concluído/ativo | chave da operação preserva idempotência | API fornecedor/jobs | ausente | `INCORPORAR` | ação `BNT-PARITY-05` |
| `KIT-01` | `produto-kits.ts` | componentes e quantidades → custo/saldo do kit | kit não possui estoque físico independente | catálogo/estoque/fulfillment | igual | `EQUIVALENTE` | testes de kits |
| `KIT-02` | capacidade de fulfillment | capacidade do kit = mínimo inteiro por componente | componente limitante vence | estoque/anúncio | igual | `EQUIVALENTE` | `fulfillment-capacity.ts` |

### 5.3 Estoque, reserva e fulfillment

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `INV-01` | `estoque-interno-saldo.ts` | entradas liberadas − saídas não estornadas → unidades disponíveis | movimentos persistidos são fonte | produtos, anúncios, pedidos | preservado e ampliado | `EQUIVALENTE` | testes de saldo |
| `INV-02` | RPC `select_order_fulfillment` | pedido + itens + origem interna → reserva atômica | lock/conflito impede dupla reserva | pedidos/estoque | Bentevi é mais forte que produção | `SUBSTITUÍDA` | migration atômica DEV; manter |
| `INV-03` | seleção de fulfillment | primeira origem `internal/supplier` → imutável para fluxo concorrente | mesma origem é idempotente; diferente conflita | API web/mobile/DSLite | igual | `EQUIVALENTE` | testes de conflito |
| `INV-04` | `fulfillment-capacity.ts` | `Q_segura = max(Q_internal, Q_supplier)` em unidades | origens incompatíveis não somam | produto, kit, anúncio | centralizado | `EQUIVALENTE` | testes `RULE-01` |
| `INV-05` | capacidade por fornecedor | cesta inteira deve caber em um único fornecedor | estoques de fornecedores distintos não somam | fulfillment | igual | `EQUIVALENTE` | testes de capacidade |
| `INV-06` | cancelamento ML | reserva interna ativa de pedido cancelado → estorno único | movimento já estornado não repete | webhook/sync pedidos | igual | `EQUIVALENTE` | evento fiscal de auditoria |
| `INV-07` | origem de estoque produtiva | compra interna registra origem/custo simples | produção antiga | estoque | Bentevi substituiu por recebimento, itens, mapping e idempotency key | `SUBSTITUÍDA` | não copiar migration produtiva colidente |
| `INV-08` | BNT-D05 | NF-e de entrada + manifestação + itens → recebimento rastreável | documento/itens persistidos vencem campo solto | estoque/fiscal | exclusiva e validada em DEV | `SUBSTITUÍDA` | manter arquitetura atual |

### 5.4 Vendas, compras, pagamentos e devoluções

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ORD-01` | API Orders ML | `order.status=paid` → pagamento aprovado no marketplace | recurso consultado vence payload resumido do webhook | pedidos/alertas | igual | `EQUIVALENTE` | contrato oficial Orders |
| `ORD-02` | bundle ML | pack → grupo cart; kit virtual → mesmo parent | grupo explícito vence coincidência de NF-e | pedidos/DSLite/fiscal | igual | `EQUIVALENTE` | `purchase-link.ts` |
| `ORD-03` | vínculo DSLite | NF-e só liga pedido único ou grupo cart/kit explícito | ambiguidade bloqueia mutação | compra/pedido | igual | `EQUIVALENTE` | testes de cardinalidade |
| `ORD-04` | desvínculo manual | DSLite removido manualmente → sincronizador não religa o mesmo ID | ação manual vence sync | pedidos | igual | `EQUIVALENTE` | `isDsliteRelinkBlockedByManualUnlink` |
| `ORD-05` | retomada reativada | status, DSID, NF-e, fornecedor e itens exatos → reutilização segura | qualquer divergência bloqueia | criação/retomada DSLite | Bentevi é mais restritiva e tipada | `SUBSTITUÍDA` | testes `purchase-link` |
| `ORD-06` | `oferta.payment_mode` | `postpaid/prepaid_pix/balance_account` → lifecycle de pagamento | modo persistido da oferta vence inferência por fornecedor | compras/pedidos | centralizado; conta-saldo apenas histórica | `EQUIVALENTE` | testes `RULE-03` |
| `ORD-07` | confirmação de compra | `prepaid_pix` + comprovante → paid; então retomada opcional | sem comprovante bloqueia, salvo retomada já paga | compras/DSLite | igual | `EQUIVALENTE` | rota confirmar pagamento |
| `ORD-08` | créditos de fornecedor | venda cancelada após PIX pago → candidato idempotente de crédito | movement key impede duplicata | compras/financeiro | preservado para fornecedores operacionais | `EQUIVALENTE` | testes supplier credits |
| `ORD-09` | commit `dc60a2b` | URLs interna/pública → tentar próxima somente se houve exceção de rede | uma resposta HTTP, inclusive erro, encerra fallback | retomada DSLite | DEV tenta a segunda URL após erro HTTP | `INCORPORAR` | ação `BNT-PARITY-06` |
| `ORD-10` | commit `b95ba98` | pago + shipment `shipped/stale` + sem claim/return + pagamentos aprovados/liberados → `concretizada_ml` | consulta incompleta bloqueia; não inferir em erro | pedidos/financeiro/UI | enum, helper e auditoria ausentes | `INCORPORAR` | ação `BNT-PARITY-07`; validar inferência com casos reais |

### 5.5 Fiscal

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `FIS-01` | `configuracoes.nfe_provider` | provider `brasilnfe` → fluxo fiscal ativo | configuração persistida; sem provider, bloquear | emissão/etiqueta | igual; ambiente DEV tipo 2 | `EQUIVALENTE` | testes fiscais; secret só como configurado |
| `FIS-02` | XML autorizado | XML com chave, número e valor → upload ao shipment ML | vínculo fiscal existente evita duplicação | etiqueta/ML | igual | `EQUIVALENTE` | FIS-01 e parser XML |
| `FIS-03` | gate do shipment | sem XML/vínculo fiscal quando obrigatório → etiqueta não avança | fiscal precede logística | DSLite/etiqueta | igual | `EQUIVALENTE` | testes FIS-02 |
| `FIS-04` | reconciliação Brasil NFe | busca inequivocamente ausente → `not_found` terminal | não repetir reconciliação automática | notas/jobs | igual | `EQUIVALENTE` | `nfe-status.ts`; FIS-03 |
| `FIS-05` | cancelamento | prazo externo rejeitado → `cancel_rejected_deadline`, nota continua tecnicamente autorizada | estado específico não regride para `authorized/other` | fiscal/UI | igual | `EQUIVALENTE` | normalizador central |
| `FIS-06` | BNT-D04 | venda elegível → nota de devolução separada e auditável | devolução não altera NF-e de venda | fiscal | evolução exclusiva DEV | `SUBSTITUÍDA` | manter |
| `FIS-07` | BNT-D05 | XML/NF-e de entrada → aba e recebimento controlado | fixture de homologação é inerte | fiscal/estoque | evolução exclusiva DEV | `SUBSTITUÍDA` | manter |

### 5.6 Mercado Livre, catálogo, perguntas e reclamações

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ML-01` | `stock-publish.ts`/outbox | quantidade desejada igual à observada → não publicar | estado observado vence envio redundante | anúncios/jobs | igual | `EQUIVALENTE` | testes ML-03 |
| `ML-02` | scan observado | um scan → manifesto persistido; lotes de 100, até 3 falhas | só marcador completo permite retomar sem novo scan | anúncios/jobs | igual | `EQUIVALENTE` | `ml-listings-observed-job` |
| `ML-03` | commits `649aa4f`/`4bdca2c` | identidade remota divergente de produto/ofertas → bloquear item na criação/ativação | evidência material vence SKU coincidente | anúncio/sync | gate por item já existe; bloqueio em venda foi supersedido | `EQUIVALENTE` | manter no lifecycle de anúncio |
| `ML-04` | commit `4bdca2c` | identidade novamente correta → desativar somente bloqueio automático `ml_identity_gate` | bloqueio manual do usuário permanece | sync/anúncio | DEV cria bloqueio, mas não limpa o automático resolvido | `INCORPORAR` | ação `BNT-PARITY-08` |
| `ML-05` | refresh de catálogo | scan/detalhes/price-to-win → job em lotes de 100 e retomável | `on_hold` é estado ativo retomável | catálogo/job | rota interna e retomada já equivalentes | `EQUIVALENTE` | testes `JOB-01` |
| `ML-06` | commit `8ee94fe` | falha → registrar estágio corrente real | estágio conhecido vence constante | observabilidade catálogo | DEV grava `fetch_price_to_win` em falhas genéricas | `INCORPORAR` | ação `BNT-PARITY-09` |
| `ML-07` | API Items | `paused` é reversível; `closed` encerra anúncio | pausar para indisponibilidade recuperável | inativação/publicação | regra geral existe, mas SUP-06 ainda exclui | `EQUIVALENTE` | contrato oficial; correção em `BNT-PARITY-04` |
| `ML-08` | Questions API | pergunta sem resposta → ação Responder; respondida → leitura | recurso ML consultado vence cache | perguntas/UI/alerta | igual | `EQUIVALENTE` | UI-05/BNT-D16 |
| `ML-09` | Claims/post-purchase | claim aberto → persistir estado, alertar e reidratar pedido | recurso consultado vence evento resumido | reclamações/pedidos | igual | `EQUIVALENTE` | webhook + BNT-D17 |

### 5.7 Jobs, webhooks, notificações e operação

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `JOB-01` | tabela/jobs + contratos | status e unidade de progresso por tipo de job | constraint e registry vencem texto livre | dashboard/cron/jobs | DEV possui constraints, índice e unidade central | `EQUIVALENTE` | commits `9794116`, JOB-04 |
| `JOB-02` | stale jobs | job sem atividade por 10 min → elegível a recuperação; hidratação ML 3 min | regra específica do domínio vence default | cron/jobs | igual | `EQUIVALENTE` | `stale-jobs.ts` |
| `JOB-03` | alertas críticos | timeout técnico + 15 min de graça → alerta | job retomado/concluído antes disso não alerta | observabilidade | igual | `EQUIVALENTE` | `critical-job-alert.ts` |
| `JOB-04` | Push outbox | falha → até 5 tentativas; disponibilidade adiada por tentativa em minutos | entregue não repete | notificações | igual e configurável por canal | `EQUIVALENTE` | `push-notifications.ts` |
| `NTF-01` | webhook ML | responder rapidamente e consultar recurso indicado | recurso atual vence payload da notificação | pedidos/perguntas/claims | fluxo assíncrono/hidratação preservado | `EQUIVALENTE` | contrato oficial Notifications |
| `NTF-02` | BNT-MSG-01 | evento → template tipado Bentevi; dados essenciais e ação | template central vence mensagem local | WhatsApp/Push/e-mail | exclusiva DEV | `SUBSTITUÍDA` | manter identidade Bentevi |
| `NTF-03` | commit `95941f1` | alerta de nova venda somente se persistência=`inserted` e order=`paid` | update/notificação duplicada não alerta | WhatsApp | Push já deduplica; WhatsApp DEV alerta todo update pago | `INCORPORAR` | ação `BNT-PARITY-10` |
| `NTF-04` | commit `dc60a2b` | etiqueta por destinatário → message ID e confirmação persistidos por chave | destinatário já confirmado não reenvia no retry | WhatsApp etiqueta | DEV voltou a idempotência única, não por destinatário | `INCORPORAR` | ação `BNT-PARITY-11` |
| `NTF-05` | commit `dc60a2b` | Evolusom oficial → destinatário principal + contato adicional, sem duplicar número | contato operacional vigente deve ser confirmado | WhatsApp etiqueta | regra e valor não existem em DEV | `DECISÃO NECESSÁRIA` | confirmar contato sem registrá-lo neste documento; então ação própria |
| `NTF-06` | etiqueta WhatsApp | download aguarda até 60 s, consulta a cada 5 s; fila retenta em 1/5/15/30 min | erro não-retryable encerra | WhatsApp/jobs | igual | `EQUIVALENTE` | `whatsapp-label-job.ts` |
| `OPS-01` | commit `9302353` | webhook Easypanel POST → `Content-Type: application/json` e corpo `{}` | método configurado; erro HTTP falha comando | deploy homologação | script DEV faz POST vazio sem media type | `INCORPORAR` | ação `BNT-PARITY-12`; sem deploy nessa ação |

### 5.8 Autenticação, permissões, runtime, API e mobile

| ID | Fonte produtiva | Entrada → decisão (unidade) | Precedência / fallback | Consumidores | Estado Bentevi / divergência | Classificação | Evidência, teste e ação necessária |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SEC-01` | `permissions.ts` | cargo → conjunto fechado de permissões | backend autoriza; UI apenas representa | web/mobile/API | matriz central corrigida no Item 17 | `SUBSTITUÍDA` | SEC-03; manter |
| `SEC-02` | matriz de cargos | admin/gerente = total; operador = operacional; visualizador = leitura | menor privilégio por cargo | rotas e ações | igual | `EQUIVALENTE` | testes de permissão |
| `SEC-03` | service client | credencial elevada somente no servidor após autorização própria | sessão do usuário nunca recebe service role | APIs/jobs | igual e endurecido | `EQUIVALENTE` | SEC-04/SEC-07 |
| `SEC-04` | RLS/grants | tabela exposta → RLS + grants mínimos | grants e policy atuam em conjunto | Data API | DEV: 51/51 tabelas com RLS; produção: 3 sem RLS | `SUBSTITUÍDA` | fotografia DB-03; manter hardening |
| `SEC-05` | runtime | secret → somente configurado/não configurado; nunca browser/log/doc | env do ambiente vence fallback | integrações/jobs | DEV endurecido; nenhum valor catalogado | `EQUIVALENTE` | SEC-07 |
| `SEC-06` | commit `ce96e0d` | servidor usa URL interna; cookie mantém host público canônico | URL pública define identidade do cookie | Supabase SSR/proxy | implementação equivalente em `supabase-url.ts`/proxy | `EQUIVALENTE` | testes de URL/cookie |
| `SEC-07` | fixtures BNT-D01 | `snapshot_source` de homologação → operações externas e mutações bloqueadas | marcador de fixture vence ação solicitada | pedidos/fiscal/jobs/UI | exclusiva DEV | `SUBSTITUÍDA` | manter até remoção BNT-D24 |
| `SEC-08` | API mobile | JWT + cargo + permissão por operação → permitir/negar | backend é fonte; app não duplica regra | mobile | centralizado | `EQUIVALENTE` | typecheck mobile quando afetado |
| `DB-01` | históricos de migration | versão registrada identifica conteúdo imutável | registro real de cada ambiente vence nome presumido | promoção/schema | colisão `20260830143000` impede replay ingênuo | `INCORPORAR` | ação `BNT-PARITY-13`, somente reconciliação e migration nova quando necessária |
| `DB-02` | `types/database.ts` | schema aplicado → tipos gerados | schema/migration vence arquivo gerado | TypeScript | tipos DEV são mais novos, mas não incluem regras produtivas ainda ausentes | `NÃO COPIAR` | regenerar apenas após migrations de paridade |

---

## 6. Parâmetros numéricos e limites

| Parâmetro | Produção observada | Bentevi DEV | Destino |
| --- | ---: | ---: | --- |
| Margem global legada | 10% | 30% | obsoleta; não copiar |
| Faixa de custo 1 | não existe no modelo produtivo | até R$ 400; margem 15%; lucro mínimo R$ 20 | manter Bentevi |
| Faixa de custo 2 | não existe no modelo produtivo | até R$ 1.000; margem 20%; lucro mínimo R$ 60 | manter Bentevi |
| Faixa de custo 3 | não existe no modelo produtivo | ilimitada; margem 25%; lucro mínimo R$ 150 | manter Bentevi |
| Taxa ML fallback | regra legada dispersa | 15% | manter configurável |
| Frete ML não informado | regra legada dispersa | R$ 30 | manter configurável |
| Limite de custo inelegível | R$ 2.000 no fluxo produtivo corrigido | R$ 2.000 | preservar, sem alterar atividade manual |
| Alíquota mínima Simples | 4% | 4% | equivalente |
| Limite para alíquota manual | RBT12 > R$ 3.600.000 | igual | equivalente |
| Lote de catálogo | 100 itens | 100 itens | equivalente |
| Lote do scan observado | 100 itens | 100 itens | equivalente |
| Falhas máximas de item no scan/refresh | 3 | 3 | equivalente |
| Stale genérico de job | 10 min | 10 min | equivalente |
| Stale de hidratação ML | 3 min | 3 min | equivalente |
| Graça de alerta crítico | 15 min | 15 min | equivalente |
| Espera de etiqueta | 60 s, polling 5 s | igual | equivalente |
| Retry de etiqueta WhatsApp | 1/5/15/30 min | igual | equivalente |
| Tentativas Push | 5 | 5 | equivalente |
| Tentativas DSLite HTTP | 3; espera 0,75/2 s | igual | equivalente |
| Verificação após criar DSLite | 3; espera 1,5/3 s | igual | equivalente |

Parâmetros de integração e runtime foram registrados apenas como **configurado/não configurado**. Nenhum token, senha, URL assinada, webhook secreto ou credencial integra este catálogo.

---

## 7. Fila obrigatória `BNT-PARITY-N`

A fila respeita risco, dependência e uma mudança coerente por tarefa:

| Ordem | Ação | Regra | Prioridade | Aceite mínimo |
| ---: | --- | --- | --- | --- |
| 1 | `BNT-PARITY-01 — Atividade manual do produto` | `PRC-11`, `PRD-02` | P0 | sync/preço não alteram `produtos.ativo`; threshold atua só em oferta/elegibilidade |
| 2 | `BNT-PARITY-02 — Oferta preferencial somente ativa` | `SUP-02` | P0 | oferta inativa nunca vira preferencial automática |
| 3 | `BNT-PARITY-03 — Capacidade interna na inativação do fornecedor` | `SUP-05` | P1 | produto com estoque interno permanece operacional |
| 4 | `BNT-PARITY-04 — Pausar anúncio ao inativar fornecedor` | `SUP-06`, `ML-07` | P1 | quantidade 0/paused; nunca excluir/closed |
| 5 | `BNT-PARITY-05 — Reprocessamento idempotente da inativação` | `SUP-07` | P1 | reprocess explícito sem duplicar job/efeito |
| 6 | `BNT-PARITY-06 — Fallback seguro da retomada DSLite` | `ORD-09` | P1 | próxima URL apenas em exceção de rede |
| 7 | `BNT-PARITY-07 — Venda concretizada pelo ML` | `ORD-10` | P1 | migration nova, helper puro, auditoria e transições testadas |
| 8 | `BNT-PARITY-08 — Limpeza do bloqueio automático de identidade` | `ML-04` | P1 | remove só bloqueio automático resolvido; preserva manual |
| 9 | `BNT-PARITY-09 — Estágio real do refresh de catálogo` | `ML-06` | P2 | falha registra estágio corrente |
| 10 | `BNT-PARITY-10 — Deduplicação do alerta de nova venda` | `NTF-03` | P1 | WhatsApp apenas em `inserted + paid` |
| 11 | `BNT-PARITY-11 — Idempotência de etiqueta por destinatário` | `NTF-04` | P1 | retry não reenvia destinatário já confirmado |
| 12 | `BNT-PARITY-12 — Contrato do webhook Easypanel` | `OPS-01` | P1 | POST JSON `{}` validado por teste sem deploy |
| 13 | `BNT-PARITY-13 — Reconciliação do histórico de migrations` | `DB-01` | P0 release | mapa formal e migrations novas; nenhum histórico reescrito |
| — | `BNT-PARITY-DEC-01 — Destinatário adicional Evolusom` | `NTF-05` | decisão | responsável confirma se o contato adicional continua vigente |

As ações acima não autorizam agrupar várias correções num único commit. Quando uma ação exigir banco, o preflight deve confirmar o destino exato `192.168.1.162`, ensaiar com `ROLLBACK` e nunca escrever em `.160`.

---

## 8. Gate e bloqueios

- `BNT-PARITY-00` pode ser encerrada porque todos os 13 commits exclusivos foram classificados e o catálogo possui destino explícito por regra.
- `BNT-PARITY-GATE` **não está liberado**: existem divergências P0/P1 ainda não implementadas.
- `BNT-CFG-07` permanece bloqueada até o fechamento do gate.
- O release permanece bloqueado até `BNT-PARITY-FINAL`, que deve comparar novamente `origin/main` e o SHA efetivamente implantado.
- Se `origin/main` mudar antes da próxima ação, o novo delta deve ser classificado antes de continuar.

---

## 9. Validação da fotografia

Validações exigidas para esta ação documental:

- referências Git, merge-base e SHA implantado confirmados;
- inventário completo `08b6237..95941f1` confirmado;
- snapshots estruturais dos dois bancos capturados em `READ ONLY`;
- comparação de relações, constraints, índices, RLS, funções privilegiadas e migrations concluída;
- valores sensíveis omitidos;
- teste dirigido do coletor de schema: `npm run test:db-schema-snapshot`;
- validação integral do repositório: `npm run validate`;
- `git diff --check`;
- build: **N/A**, pois esta ação altera somente documentação e checklist.

Os resultados executados após a criação deste documento são registrados no checklist operacional do Item 17.

---

## 10. Referências oficiais atuais

- PostgreSQL 15 — `SET TRANSACTION`, incluindo `READ ONLY`: <https://www.postgresql.org/docs/15/sql-set-transaction.html>
- Git — `merge-base`: <https://git-scm.com/docs/git-merge-base>
- Mercado Livre — notificações e recomendação de fila/consulta do recurso: <https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/produto-receba-notificacoes>
- Mercado Livre — Orders: <https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas>
- Mercado Livre — Envios: <https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-envios>
- Mercado Livre — atualização de publicações e estados `paused/closed`: <https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes>
- Mercado Pago — Account Money: <https://www.mercadopago.com.br/developers/en/docs/reports/account-money/introduction>
- Mercado Pago — referência atual de relatórios: <https://www.mercadopago.com.br/developers/pt/reference/reports/overview>
- Supabase — RLS, grants e `service_role`: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase — segurança da Data API: <https://supabase.com/docs/guides/api/securing-your-api>

Contratos específicos de DSLite e Brasil NFe continuam vinculados às implementações e evidências já validadas nas ações `DSL-01`, `INV-01` e `FIS-01` a `FIS-03`. Antes de qualquer mudança nesses contratos, a ação `BNT-PARITY-N` correspondente deve reabrir a documentação oficial do endpoint exato; esta fotografia não autoriza inferir comportamento externo.
