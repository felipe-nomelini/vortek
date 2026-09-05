# Pricing e Radar canônicos — contrato M2M

Vigência: M2M-PRC-01-v1. Configuração tipada em `src/services/pricing-policy.ts`, persistida em `configuracoes.pricing_policy`. Mudanças são versionadas, auditadas e invalidam simulações anteriores; não escrevem preços no ML. A margem global antiga fica sem consumidores operacionais.

| Preço final | Piso | Alvo | Limite de busca |
|---|---:|---:|---:|
| Até R$ 200,00 | 5% | 7% | 10% |
| R$ 200,01–1.000,00 | 7% | 10% | 15% |
| Acima de R$ 1.000,00 | 10% | 15% | 20% |

`src/services/pricing.ts` é o único motor: resultado = receita − CMV − tarifa total ML − frete Vortek − custos variáveis − tributo. Margem = resultado / receita. A tarifa `sale_fee_amount` já inclui componente fixo. Alvos são resolvidos na faixa resultante, com arredondamento para centavos, recotação no preço final e falha explícita por não convergência. Limite não é teto permitido: margem premium com vendas deve ser mantida.

`pricing-context.ts` resolve oferta ativa e fornecedor ativo, tributo central RBT12/Simples, contexto logístico e cotação. Tributo `confirmed` exige competência e evidência; a estimativa não substitui confirmação. Meses ausentes não são receita zero. Custos variáveis ausentes geram cenário estimado e reconhecimento explícito antes da aprovação; resultado realizado fica pendente quando faltam componentes.

Fonte ML viva vence observação válida; observação válida do mesmo contexto/preço vence fallback. Antes de ação econômica é obrigatória recotação viva. Falha retorna `INCONCLUSIVO_FONTE_ML_INDISPONIVEL`. Prejuízo estimado não comanda pausa. O monitor do experimento anterior conserva seu escopo autorizado e só pausa com prejuízo confirmado pela economia canônica.

## Aprovação e trilha

`POST /api/pricing/simulate` gera memória imutável; `POST /api/pricing/approve` registra razão, autor e reconhecimento das estimativas. `POST /api/ml/anuncio/atualizar-preco` exige essa aprovação, recota, verifica as mesmas entradas e o preço anterior, bloqueia promoções/atacado e verifica o grupo sincronizado. Edição manual não equivale a override. Aprovação já utilizada não autoriza outra alteração.

Estratégias abaixo do piso usam `/api/pricing/strategy`, com anúncio existente, razão, autor, validade até 30 dias, preço e margem mínimos; ainda requerem simulação/aprovação. Novo anúncio com prejuízo não é permitido. Custos alterados geram propostas. O worker de estoque registra solicitações de preço como propostas e continua somente operações autorizadas de estoque/status.

`pricing_evaluations` guarda as entradas e os resultados; `pricing_events` guarda propostas, aprovações, aplicações e configurações. `current_pricing_evaluations` só projeta memória compatível com oferta ativa, custo, competência, versão, preço observado e validade. SQL, telas e PDFs não recalculam margem. Ausência aparece como pendência, sem preço inventado.

## Conflitos e Radar

`opportunity-conflicts.ts` classifica identidade, embalagem/quantidade, vínculo e economia separadamente da demanda. Mesmo GTIN não supera marca/modelo divergentes. Variação legítima exige evidência. Quantidade e apresentação incompatíveis bloqueiam automação. `SEM_CONFLITO`, `CONFLITO_CONFIRMADO`, `PENDENCIA_VALIDACAO` e `INCONCLUSIVO` são independentes do score.

Anúncio ativo sai da fila de novos; pausado segue para reativação. Relações de catálogo só compartilham `pricing_group_id` quando `/public/buybox/sync/{itemId}` comprova `SYNC`. Falha ou anúncio próprio sem vínculo deixam busca inconclusiva. Demanda ausente/404 nunca prova ausência de vendas.

A prioridade mostra seis dimensões: identidade, economia, demanda, competitividade, estoque e preparação. O dashboard `/radar` explica cada fila, contribuição, piso, alvo, evidências e validade. Registro com fonte incompleta não é homologado para publicação.

O job `sync_ml_radar` usa o agendador existente, após rotinas de oferta, com início configurável em Brasília, lotes, concorrência limitada, lock e checkpoint transacional. Retoma trabalho interrompido; entrada material igual e evidência válida evitam novo cálculo. Ofertas sem evidência atual permanecem estimadas. Não inicia pesquisa externa pesada de novos produtos: aproveita os catálogos/vínculos e evidências existentes.

Autonomia: `AUTO_OBSERVE`. Publicação permanece `REQUIRES_CONFIRMATION`, individual, com revisão de identidade, atributos, imagens reais e economia. Homologação específica é necessária para ampliar autonomia.

## Fontes verificadas

- [Tarifas ML](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender): total da tarifa e contexto logístico.
- [Custos de envio](https://developers.mercadolivre.com.br/pt_br/pt_br/custos-de-envio): cotação por item/dimensões e preço.
- [Catálogo e sincronização](https://developers.mercadolivre.com.br/devcenter/publicacao-no-catalogo).
- [Buy Box](https://developers.mercadolivre.com.br/concorrencia-em-catalogo).
- [Manual PGDAS-D](https://www8.receita.fazenda.gov.br/SimplesNacional/Arquivos/manual/MANUAL_PGDAS-D_2018_V4.pdf).
- [PostgreSQL 15: views e privilégios](https://www.postgresql.org/docs/15/sql-createview.html), [locks](https://www.postgresql.org/docs/15/explicit-locking.html).
