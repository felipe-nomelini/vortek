# Auditoria — VTK002156

Gerada em 22/07/2026. Horários em UTC.

## Escopo

- Produto: `VTK002156` — Suporte Estante ASK PMD3.
- Anúncio Mercado Livre: `MLB7095390302`.
- Venda investigada: pack `2000014150201823`, pedido `2000017545533292`.
- Venda anterior cancelada: pedido `2000017521486928`, pack `2000014125813213`.

## Resultado

O cancelamento anterior **não inseriu 1 unidade no estoque interno** e não foi a origem da reativação do anúncio.

- A tabela `estoque_interno_movimentacoes` não possui nenhum movimento para o produto.
- Não existe entrada de devolução, saldo liberado nem evento `internal_stock_automation` para este SKU.
- O pedido cancelado não gerou pedido DSLite (`dslite_id: null`).

## Linha do tempo do anúncio

| Quando | Origem | Ação |
|---|---|---|
| 21/07 04:20–11:24 | `dslite_stock_automation` | Anúncio ativo com quantidade 5; origem fornecedor, estoque interno 0. |
| 21/07 15:07 | `fornecedor_inativo` | Pausou, quantidade 0. |
| 21/07 15:16 | `fornecedor_inativo_recuperacao` | Reativou com quantidade 5. Não é fluxo de cancelamento nem de estoque interno. |
| 21/07 15:24 | `fornecedor_inativo_recuperacao_sem_estoque` | Pausou com quantidade 0; processado com sucesso às 15:25. |
| 22/07 20:22 | Mercado Livre | Venda `2000017545533292` realizada. |

## Regra verificada no sistema

Uma devolução entra em `revisao`, com `disponivel_venda: false`. Somente após conferência física e liberação manual (`liberado`) o sistema enfileira atualização de estoque no Mercado Livre. O fluxo está em `src/lib/estoque-interno.ts` e `src/app/api/estoque/[movimentoId]/situacao/route.ts`.

## Conclusão atualizada

O cancelamento anterior não criou estoque interno no Vortek. Conforme confirmado operacionalmente depois da auditoria inicial, o próprio Mercado Livre devolveu a unidade ao anúncio e o reativou após o cancelamento. Essa alteração externa não aparecia nos movimentos locais.

Correção adotada: Vortek passa a tratar notificações `items` como gatilho de conferência. Quando quantidade ou status do anúncio divergir do estoque autoritativo local, o sistema enfileira imediatamente a quantidade correta e pausa o anúncio quando o saldo for zero. A sincronização periódica funciona como segunda proteção caso uma notificação seja perdida.
