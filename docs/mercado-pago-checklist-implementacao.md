# Mercado Pago no Vortek — checklist específico de implementação

**Ambiente:** desenvolvimento/homologação

**Branch:** `dev`

**Banco:** `supabase-dev`

**Documento de decisão:** [`mercado-pago-estudo-vortek.md`](./mercado-pago-estudo-vortek.md)

---

## 1. Regras de execução

- Executar somente uma ação deste checklist por tarefa.
- Não avançar enquanto a ação atual não estiver validada.
- Usar apenas credenciais e contas de teste neste worktree.
- Nunca executar migration ou validação destrutiva em produção.
- Não criar tabela, fila, cron, webhook ou parser paralelo sem necessidade comprovada.
- Preservar movimentos históricos e migrations antigas.
- O relatório Mercado Pago e o ledger de fornecedores permanecem fontes separadas.
- Pagamento automático de fornecedor via Pix está fora de escopo.
- Checkout/Pix para clientes permanece suspenso até existir venda direta aprovada.

---

## 2. Situação geral

| Ordem | Ação | Situação | Resultado esperado |
|---:|---|---|---|
| 1 | `MP-RET-01` — Desacoplar Hayamax | Concluída em `HAYA-03` | Relatório sem efeito em fornecedor |
| 2 | `MP-FIN-01` — Conciliação genérica | Pendente | Movimentos oficiais importados como evidência financeira |
| 3 | `MP-FIN-02` — Vínculo com pagamentos ML | Pendente | Venda e movimentos relacionados consultáveis |
| 4 | `MP-FIN-03` — Visão financeira | Pendente | Saldo observado e exceções visíveis |
| 5 | `MP-MCP-01` — Ferramenta local | Opcional | Apoio a desenvolvimento sem secret versionado |
| 6 | `MP-PAY-01` — Pix para clientes | Suspensa | Reabrir somente com venda direta aprovada |

---

## 3. Gate obrigatório de cada ação

- [ ] confirmar branch `dev` e inspecionar working tree;
- [ ] ler `AGENTS.md`, Item 17, auditoria aplicável e este checklist;
- [ ] investigar somente os consumidores da ação;
- [ ] reconfirmar o contrato oficial atual envolvido;
- [ ] registrar estado atual e causa/necessidade;
- [ ] implementar a menor mudança correta;
- [ ] adicionar teste direcionado quando houver comportamento;
- [ ] executar teste direcionado;
- [ ] executar `npm run validate`;
- [ ] executar build somente quando aplicável;
- [ ] validar somente em homologação/teste;
- [ ] registrar mudança, validação, resultado e pendência;
- [ ] confirmar que produção permaneceu intocada.

---

## 4. MP-RET-01 — Desacoplar Hayamax

**Situação:** concluída e validada em homologação na `HAYA-03`.

### Implementar

- remover matchers, valor mínimo e classificação automática da Hayamax;
- impedir criação e aprovação de `topup` Hayamax pelo relatório;
- remover o webhook `payment` e `payment_lookup_failed`, pois não restará consumidor;
- remover `MERCADOPAGO_HAYAMAX_MATCHERS` e `MERCADOPAGO_WEBHOOK_SECRET` do contrato ativo;
- remover o SDK `mercadopago` se continuar sem consumidor após a alteração;
- manter autenticação, lifecycle, download, parser e importação genérica;
- manter `mercadopago_account_movements` e seus registros históricos;
- manter `supplier_balance_movements` para os créditos dos demais fornecedores.

### Validar

- [x] relatório válido continua sendo solicitado, retomado e importado;
- [x] nenhum movimento Mercado Pago cria movimento de fornecedor;
- [x] reimportação permanece idempotente;
- [x] nenhum webhook Mercado Pago permanece configurado para uma rota removida;
- [x] nenhum secret Hayamax/Mercado Pago desnecessário permanece no ambiente de homologação;
- [x] dados e migrations históricas foram preservados.

### Resultado

- commit funcional `6888b1b`, publicado somente em `dev` e no serviço `vortek-erp-dev`;
- matching, `topup`, revisão Hayamax, webhook `payment`, `payment_lookup_failed` e SDK removidos;
- lifecycle, parser, importação genérica, autenticação, tabelas e histórico preservados;
- 14 testes direcionados, `npm run validate` e build aprovados;
- reimportação manteve 238 movimentos, seis classificações históricas e zero movimento de fornecedor;
- webhook removido respondeu `404`, secrets aposentados não existem no ambiente e a remoção da configuração externa no aplicativo **Vortek MP Dev** foi confirmada pelo usuário em 30/08/2026;
- migration e exclusão de dados: **N/A**; produção permaneceu intocada.

---

## 5. MP-FIN-01 — Conciliação genérica

**Dependência:** `MP-RET-01`.

### Implementar

- tratar a tabela atual como evidência financeira bruta do Mercado Pago;
- importar apenas linhas com identidade, tipo, moeda e líquido oficiais válidos;
- preservar vários lançamentos para o mesmo `SOURCE_ID`;
- não criar saldo, crédito, compra ou pagamento interno automaticamente;
- registrar falhas no job existente, sem novo cron ou fila;
- revisar a frequência do sync com evidência de custo e utilidade.

### Validar

- [ ] `SETTLEMENT`, `REFUND`, `CHARGEBACK`, `DISPUTE`, `PAYOUT` e demais tipos observados não se sobrescrevem;
- [ ] líquido é priorizado sobre bruto;
- [ ] moeda inválida ou campo obrigatório ausente é rejeitado;
- [ ] retry/reimportação não duplica movimentos;
- [ ] relatório `202` permanece em `on_hold` até finalizar;
- [ ] falha terminal fica observável.

---

## 6. MP-FIN-02 — Vínculo com pagamentos Mercado Livre

**Dependência:** `MP-FIN-01`.

### Implementar

- usar os IDs já preservados em `pagamento_resumo` dos pedidos;
- comparar esses IDs com o `SOURCE_ID` dos movimentos Mercado Pago;
- tratar a relação como um pagamento para vários lançamentos financeiros;
- não copiar dados financeiros para `pedidos` se puderem ser consultados da fonte atual;
- classificar como exceção movimentos sem pedido e pedidos sem movimento esperado;
- não alterar automaticamente estado logístico, fiscal ou de estoque.

### Validar

- [ ] pagamento com vários movimentos mantém todos os eventos;
- [ ] devolução/disputa posterior permanece ligada à venda correta;
- [ ] movimento sem pedido não é descartado;
- [ ] pedido sem movimento não é marcado falsamente como conciliado;
- [ ] valores divergentes ficam visíveis e não são corrigidos automaticamente.

---

## 7. MP-FIN-03 — Visão financeira

**Dependência:** `MP-FIN-02`.

### Implementar

- criar uma única visão de leitura para movimentos e exceções;
- mostrar período e horário do último relatório concluído;
- mostrar entradas, saídas, líquido, devoluções, disputas e retiradas;
- mostrar o último saldo observado somente quando sustentado por campo oficial importado;
- rotular explicitamente esse valor como não instantâneo;
- reutilizar a tabela atual; adicionar campo somente se o contrato oficial exigir persistência ausente.

### Validar

- [ ] filtros não disparam novamente indicadores independentes;
- [ ] totais conferem com o conjunto importado;
- [ ] saldo observado informa data/hora de referência;
- [ ] exceções podem ser localizadas sem alterar o movimento bruto;
- [ ] usuário sem permissão financeira não acessa a visão.

---

## 8. MP-MCP-01 — Ferramenta local opcional

### Executar somente quando necessário

- configurar o endpoint oficial em arquivo local ignorado pelo Git;
- preferir OAuth quando a tool exigir gerenciamento da aplicação;
- usar credencial de teste quando o acesso por token for necessário;
- usar as tools para documentação, usuários de teste, webhooks de teste e avaliação de qualidade;
- remover configurações temporárias que apontem para rotas aposentadas.

### Validar

- [ ] arquivo local não aparece no `git status`;
- [ ] nenhum token está em arquivo versionado, log ou documentação;
- [ ] MCP não possui autorização produtiva neste worktree;
- [ ] recomendações do MCP foram conferidas contra o código e documentação oficial.

---

## 9. MP-PAY-01 — Pix para clientes

**Situação:** suspensa, não executar.

Reabrir somente quando houver decisão de produto para venda direta fora do Mercado Livre e estiverem definidos:

- pedido e cliente proprietários da cobrança;
- valor, expiração e referência idempotente;
- confirmação, cancelamento e reembolso;
- reserva de estoque e emissão fiscal;
- autenticação, webhook e reconciliação;
- ambiente de teste e critérios de promoção.

Não usar esse fluxo para pagar fornecedores. A referência pública consultada não confirmou API para iniciar Pix de saída.

---

## 10. Encerramento

O roadmap Mercado Pago estará concluído no escopo atual quando:

- [ ] Hayamax não tiver efeitos ativos no relatório;
- [ ] movimentos continuarem sendo importados idempotentemente;
- [ ] conciliação com pagamentos ML estiver comprovada com dados válidos;
- [ ] divergências e saldo observado estiverem visíveis sem criar fonte duplicada;
- [ ] nenhum checkout ou pagamento a fornecedor tiver sido criado sem requisito aprovado;
- [ ] histórico, secrets e isolamento entre ambientes estiverem preservados.
