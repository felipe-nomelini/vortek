# Marco 7 — conferência da operação inicial

Data da conferência: 17/09/2026, aproximadamente 11h45 BRT. Escopo: leituras no Bentevi produtivo `.162`, no Mercado Livre e no repositório. Nenhuma escrita em banco, compra, anúncio, pagamento ou sincronização foi iniciada por esta conferência.

## Ciclo real comprovado

A venda ML `2000018462600932` entrou em 14/09/2026 às 20h34 BRT. O pedido no Bentevi tem origem `ml_live`, situação `entregue`, nota fiscal autorizada (número 1429), compra DSLite `409278`, rastreio e etiqueta persistida. A auditoria do pedido registra recebimento e processamento do webhook, envio dos dados fiscais ao ML, criação e vínculo da compra DSLite, confirmação manual do pagamento do fornecedor, armazenamento e envio da etiqueta.

Consultas diretas e somente de leitura ao Mercado Livre retornaram HTTP 200 para o pedido, o envio associado e a remessa `48016175102`. A remessa estava `delivered`; seu histórico registra envio em 15/09/2026 às 23h56 BRT e entrega em 16/09/2026 às 12h29 BRT. A venda é real e posterior ao corte. Esta prova fecha **somente** o requisito de um ciclo completo; o status `entregue` isolado não foi usado como aceite.

## Primeiros dias de operação

Leitura retrospectiva em `.162`, agrupada por dia civil BRT (`03:00 UTC` até `03:00 UTC` do dia seguinte):

| Dia | Pedidos criados | Eventos de auditoria | Jobs criados | Registro contemporâneo localizado |
|---|---:|---:|---:|---|
| 09/09 | 20 | 1 | 0 | Corte e smoke no [runbook](../../bentevi-prod-cutover.md) |
| 10/09 | 17 | 14.305 | 1.606 | Ativação de fornecedores, jobs e canário de estoque/status no checklist |
| 11/09 | 14 | 27.175 | 5.190 | Correções e validações de preço, catálogo e etiquetas no checklist |
| 12/09 | 7 | 27.901 | 4.497 | Nenhum registro de acompanhamento operacional diário localizado |
| 13/09 | 11 | 25.803 | 3.557 | Validação de preço manual registrada no checklist |
| 14/09 | 12 | 39.369 | 7.840 | Correção e validação de catálogo registradas no checklist |
| 15/09 | 13 | 41.435 | 8.473 | Correções e validações de kit e DSLite registradas no checklist |
| 16/09 | 9 | 34.506 | 8.062 | Validações e publicações do Oráculo registradas no checklist dedicado |

As contagens mostram atividade preservada no banco, **não** provam que saúde, falhas, filas e efeitos externos foram observados diariamente. Os registros encontrados para os demais dias tratam ações específicas e não compõem, por si, uma série diária de monitoramento. A data e a hora exatas do primeiro corte também não foram recuperadas nesta conferência; a tabela inclui 09–16/09 para cobrir conservadoramente os sete dias posteriores à entrada em operação.

## Versão, executor e pendências

Na conferência, `origin/dev` e `origin/bentevi-prod` apontavam para `a4ed206629458b5dffd9b1396e7ad2c8911486b4`; `GET /api/ops/health` e `/login` responderam HTTP 200 em `app.bentevi.shop`. Essas leituras não revelam o SHA da imagem ativa. O registro de 10/09 no checklist comprova a transferência dos dispatchers central e de estoque/status ao runtime produtivo e a desativação dos crons concorrentes naquele momento, mas não comprova sozinho que existe apenas um executor **agora**. O canário real de quantidade `4 → 5`, com preço preservado, já consta daquela ação; os gates comerciais posteriores continuam próprios.

### Conferência complementar — 17/09/2026, 15h13 BRT

A API de leitura do Easypanel confirmou `local/bentevi-prod` habilitado, fonte `bentevi-prod`, commit `e2626d97482410f8b19b2eeafaa7e38fb95f7322` e uma réplica. A ação de deploy `cmu5n8r74006n07ov699wgwgw` terminou `done` às 14h49 UTC; seu manifesto de imagem `sha256:56b7856703220246e245482393dd9a7770841e86bb68e1d2c019eade45dd576f` corresponde exatamente à única imagem do contêiner ativo. `local/vortek-erp` e `local/vortek-erp-dev` estão desabilitados. O smoke posterior respondeu `200` em health e login, `401` na API de Compras sem sessão e `307` na página de Compras sem sessão.

Consulta SQL em transação somente leitura no PostgreSQL produtivo da `.162` confirmou os três agendadores `pg_cron` existentes inativos: dispatch central (job 2), publicação ML (job 3) e atualização de preço (job 4). Junto com a única réplica ativa e os serviços web antigos desabilitados, isso comprova um executor atual para os fluxos do núcleo Bentevi. A release documental acima fica registrada; nenhum banco ou serviço foi alterado nesta conferência.

### Aceite do acompanhamento — 17/09/2026, aproximadamente 15h20 BRT

O responsável respondeu **“Sim”** à pergunta explícita sobre ter acompanhado diariamente a operação Bentevi de 09 a 16/09, inclusive 12/09, e pediu o fechamento das tarefas para avançar no checklist. Esta é a fonte do aceite operacional do acompanhamento. Ele não indicou onde estão os registros de saúde, ocorrências e revalidações de cada dia. A tabela retrospectiva acima continua sendo apenas prova de atividade preservada; não foi convertida em supostos registros contemporâneos. A ausência desses registros segue como limitação de rastreabilidade, sem apagar ocorrências e correções já documentadas nas ações específicas.

Com a confirmação expressa do responsável, o ciclo real comprovado e as validações técnicas de versão, release e executor, o marco 7 do **núcleo operacional** fica concluído em 17/09/2026. Este aceite não declara concluídas as capacidades adiadas nem os demais gates do Item 17.
