# Mercado Pago no Vortek — estudo de uso após a saída da Hayamax

**Data da análise:** 30/08/2026

**Ambiente analisado:** `dev` / homologação

**Decisão:** manter somente a base genérica de conciliação financeira; retirar os efeitos exclusivos da Hayamax.

---

## 1. Resposta executiva

O Mercado Pago ainda pode trazer informação relevante ao Vortek, mesmo sem a Hayamax, mas o uso correto neste momento é limitado a **conciliação financeira de leitura**:

- movimentos que afetaram a conta;
- valores líquidos e brutos;
- pagamentos aprovados;
- devoluções, disputas e contestações;
- retiradas e transferências registradas;
- composição histórica do saldo;
- vínculo futuro entre movimentos financeiros e os IDs de pagamento já capturados nos pedidos do Mercado Livre.

Não há necessidade comprovada para o Vortek criar um checkout próprio agora. O sistema atual opera vendas originadas no Mercado Livre e não possui um fluxo de venda direta que precise cobrar clientes.

Também não foi localizado, na referência pública atual do Mercado Pago consultada, um endpoint para o Vortek iniciar Pix de saída e pagar fornecedores. Os relatórios identificam retiradas/Pix de saída como movimentos `PAYOUT`, mas isso não equivale a uma API pública para ordenar a transferência.

Consequentemente:

1. o lifecycle e o parser do relatório devem ser preservados;
2. matching, aportes e revisões da Hayamax devem ser removidos;
3. o webhook atual deve ser aposentado, pois sua única consequência de negócio é criar aporte Hayamax;
4. pagamentos por Pix para clientes permanecem adiados até existir um canal de venda direta aprovado;
5. nenhuma nova tabela ou arquitetura financeira deve ser criada antecipadamente.

---

## 2. Estado atual confirmado no Vortek

O fluxo atual está dividido assim:

- `src/services/mercadopago.ts`: autenticação, consulta de pagamento e API do relatório Dinheiro em conta;
- `src/app/api/sync/mercadopago-account-money/route.ts`: lifecycle do relatório, importação e criação de aporte Hayamax;
- `src/lib/mercadopago-account-money.ts`: parser e identidade idempotente dos movimentos;
- `src/app/api/webhooks/mercadopago/route.ts`: consulta notificações `payment` e tenta gerar aporte Hayamax;
- `mercadopago_account_movements`: evidência bruta importada do Mercado Pago;
- `supplier_balance_movements`: ledger interno de fornecedores, usado pela Hayamax e também por créditos de outros fornecedores.

`FIN-01/FIN-02` já corrigiu e validou:

- retomada da mesma tarefa assíncrona;
- estados `requested → processing → processed → download → import → complete`;
- uso de `SETTLEMENT_NET_AMOUNT`;
- tipo e moeda oficiais;
- preservação de movimentos diferentes com o mesmo `SOURCE_ID`;
- importação idempotente.

Essa parte não depende conceitualmente da Hayamax e deve continuar como única implementação do relatório.

As partes específicas da Hayamax são:

- matchers por nome, CNPJ e identificadores;
- valor mínimo para reconhecer aporte;
- criação automática de `topup` no ledger do fornecedor;
- revisão e aprovação manual de movimentos para a Hayamax;
- webhook `payment` e estado `payment_lookup_failed`;
- visualização Mercado Pago dentro da conta-saldo Hayamax.

O pacote `mercadopago` é usado somente para construir um cliente que não possui consumidor atual. As chamadas efetivamente utilizadas pelo relatório usam `fetch`; portanto, após retirar o webhook, a dependência deve ser removida se continuar sem uso.

---

## 3. Capacidades oficiais e decisão para o Vortek

| Capacidade | Contrato oficial confirmado | Decisão no Vortek |
|---|---|---|
| Receber Pix | Checkout Transparente pode gerar link, QR Code e Pix Copia e Cola | Adiar até existir venda direta fora do Mercado Livre |
| Consultar pagamentos | APIs de pagamentos e orders permitem consulta por identificador | Usar somente quando houver um pagamento do próprio app que justifique o webhook |
| Conciliar a conta | Relatório Dinheiro em conta lista movimentos aprovados, líquido/bruto, disputas e devoluções | Manter e tornar genérico |
| Acompanhar saldo | O relatório permite compreender o histórico e o impacto das transações no saldo | Exibir futuramente apenas como **último saldo observado**, nunca como saldo instantâneo |
| Enviar Pix | Nenhum endpoint público correspondente foi localizado na referência consultada | Não implementar nem prometer pagamento automático a fornecedores |
| Webhooks | Notificações confirmam eventos e exigem processamento idempotente | Remover o webhook Hayamax; criar outro apenas junto de um caso de pagamento real aprovado |
| MCP Server | Ajuda a pesquisar documentação, gerenciar apps, configurar webhooks, criar usuários de teste e medir qualidade | Ferramenta local opcional de desenvolvimento; não faz parte do runtime |

### Limite do ambiente de teste

A documentação oficial alerta que relatórios de contas de teste podem ser gerados sem movimentos, embora criação, consulta e listagem funcionem. A validação já registrada no checklist encontrou dados no ambiente TEST usado pelo Vortek, mas isso não deve ser tratado como garantia de cobertura para todas as contas de teste.

---

## 4. Uso recomendado

### 4.1 Conciliação financeira do Mercado Livre

O snapshot fiscal do pedido já preserva `pagamentos[].id`. O relatório Mercado Pago possui `SOURCE_ID`, que pode representar o ID da operação/pagamento. Uma etapa futura pode comparar esses identificadores para responder:

- o pagamento da venda apareceu no relatório financeiro?
- qual foi o impacto líquido observado?
- houve devolução, disputa ou contestação posterior?
- a retirada do valor apareceu na conta?
- quais movimentos permanecem sem pedido correspondente?

Esse vínculo deve ser criado somente depois de validar exemplos reais e a cardinalidade dos eventos. Um mesmo `SOURCE_ID` pode ter vários lançamentos financeiros e não pode ser transformado em relação um-para-um.

### 4.2 Visão financeira de leitura

Uma interface futura pode apresentar:

- último saldo observado e horário do relatório;
- entradas e saídas por período;
- total líquido recebido;
- devoluções, disputas, contestações e retiradas;
- movimentos sem conciliação;
- estado e falhas do último relatório.

Essa tela deve consumir a tabela atual. Só será adicionada coluna à tabela se um campo oficial necessário não puder ser preservado no modelo existente.

### 4.3 Cobrança direta

O Mercado Pago suporta cobrança Pix. Isso somente deve entrar no Vortek quando houver um fluxo de venda direta com requisitos definidos para:

- origem e propriedade do pedido;
- cliente e valor da cobrança;
- expiração;
- confirmação, cancelamento e reembolso;
- idempotência;
- nota fiscal e estoque;
- conciliação contábil.

Sem esse fluxo, adicionar checkout seria arquitetura sem consumidor.

---

## 5. Retirada da Hayamax

### Remover do funcionamento ativo

- criação e ativação de oferta da Hayamax;
- conta-saldo e débito automático Hayamax;
- importação de extrato, aporte manual e revisão Mercado Pago da Hayamax;
- matching e geração automática de `topup`;
- webhook de pagamento criado para essa finalidade;
- guardas de categoria, textos, eventos e scripts exclusivamente Hayamax;
- opção ativa `balance_account` nas telas e regras de criação.

### Preservar

- produtos que possuam outra oferta operacional;
- ledger genérico de créditos dos fornecedores;
- registros históricos de compras e movimentos;
- migrations antigas;
- tabela de movimentos Mercado Pago;
- lifecycle, parser e idempotência do relatório;
- regras de etiqueta que também atendam outros fornecedores, após remover apenas o nome Hayamax.

Nenhuma exclusão destrutiva de histórico ou schema deve ocorrer antes de inventário, backup e autorização no worktree de produção.

---

## 6. MCP Server do Mercado Pago

O MCP oficial facilita o desenvolvimento, mas não amplia o contrato financeiro da API. Ele pode:

- consultar a documentação oficial;
- listar e gerenciar aplicações via OAuth;
- configurar e simular webhooks;
- criar usuários de teste e administrar saldo de teste;
- consultar o checklist e a avaliação de qualidade do Mercado Pago.

Regras para uso no Vortek:

- configuração apenas local;
- token somente em armazenamento local autorizado;
- nunca versionar token, header de autorização ou arquivo local de conexão;
- usar credenciais de teste em `vortek-dev`;
- não permitir que o MCP altere produção a partir deste worktree;
- continuar confrontando qualquer sugestão do MCP com o código e o `AGENTS.md`.

---

## 7. Fontes oficiais consultadas

- [Relatório Dinheiro em conta — introdução](https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/introduction)
- [Relatório Dinheiro em conta — usos e campos financeiros](https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/how-to-use)
- [Relatório Dinheiro em conta — geração via API](https://www.mercadopago.com.br/developers/pt/docs/reports/account-money/api)
- [Referência pública da API Mercado Pago](https://www.mercadopago.com.br/developers/pt/reference)
- [Pix no Checkout Transparente via Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix)
- [MCP Server — visão geral](https://www.mercadopago.com.br/developers/pt/docs/mcp-server/overview)
- [MCP Server — tools disponíveis](https://www.mercadopago.com.br/developers/pt/docs/mcp-server/tools)
