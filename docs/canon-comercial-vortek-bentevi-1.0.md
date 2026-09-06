# CÂNON OPERACIONAL VORTEK/BENTEVI

## Pricing, custos, margens, publicação e governança comercial

**Versão:** 1.0 — 05/09/2026  
**Autoridade:** Diretoria de Operações  
**Status:** HOMOLOGADO — FONTE DE VERDADE

## 1. Autoridade

Este Cânon prevalece, para novas implementações, sobre documentação, constantes, configurações e comportamentos legados. Nenhuma política com impacto em preço, margem, custo, desconto, publicação, pausa ou elegibilidade pode nascer por inferência. Lacuna = `POLITICA_NAO_DEFINIDA`.

## 2. Política de margem por PREÇO FINAL

| Preço final | Piso | Alvo | Limite de busca |
|---|---:|---:|---:|
| Até R$ 200,00 | 5% | 7% | 10% |
| R$ 200,01 a R$ 1.000,00 | 7% | 10% | 15% |
| Acima de R$ 1.000,00 | 10% | 15% | 20% |

Piso gera diagnóstico, não ação cega. Alvo é referência para preço novo/simulação/experimento. Limite é teto de busca automática, não margem máxima. Margem premium aceita pelo mercado deve ser preservada.

Faixas antigas baseadas em custo não fazem parte do pricing. O cálculo deve estabilizar a faixa pelo preço final, inclusive nas fronteiras R$200/R$200,01/R$1.000/R$1.000,01.

## 3. Economia unitária canônica

`Resultado Unitário = Receita - CMV - Tarifa ML - Frete Vortek - Tributo`

`Margem Operacional = Resultado Unitário / Receita`

Não adicionar componente econômico não homologado.

## 4. CMV

Todo custo diretamente atribuível à aquisição do SKU pertence ao CMV/custo de aquisição. A fonte deve ser oferta válida, ativa e operacional, respeitando preferência manual válida quando houver. Oferta inativa não é fonte operacional válida.

## 5. Custo variável por SKU — REMOVIDO

A Vortek não possui política de custo variável adicional por SKU. `custo_variavel` não integra o motor, a interface ou a economia canônica. Dependência técnica temporária deve ser marcada como legado/depreciado até remoção segura.

## 6. Despesas operacionais

SaaS, infraestrutura, contabilidade, telefonia, ferramentas, serviços e despesas administrativas pertencem à DRE/análise global da empresa. Não devem ser rateadas arbitrariamente por SKU.

## 7. Tarifa ML e frete

Tarifa/comissão ML e frete suportado pela Vortek integram a economia unitária.

Precedência: dado vivo/observado confiável > fallback configurado.

**Fallback de tarifa ML: PRESERVADO.**  
**Fallback de frete: PRESERVADO.**

Antes de ação destrutiva motivada por tarifa/frete, consultar ML vivo quando materialmente necessário. Se falhar e houver dúvida: `INCONCLUSIVO_FONTE_ML_INDISPONIVEL`; não executar ação destrutiva automática.

## 8. Tributação

Tributo integra a economia. Preservar RBT12, Simples Nacional, alíquota efetiva, estimativa conservadora, confirmação e PGDAS quando aplicável. Sempre distinguir `estimated` de `confirmed`.

## 9. Lucro mínimo nominal — REMOVIDO

Não existe lucro mínimo fixo por SKU/faixa. Remover R$20/R$60/R$150 do motor. Não podem definir preço, prevalecer sobre margem ou bloquear publicação. Estruturas históricas ficam sem autoridade.

## 10. Limite de custo — PRESERVADO FORA DA MARGEM

O limite de custo existente pode permanecer para finalidades operacionais próprias da Vortek, incluindo giro/elegibilidade. Não participa da política de margem, não seleciona faixa, não calcula preço e não altera automaticamente `produtos.ativo`.

## 11. Produto ativo

`produtos.ativo` é decisão operacional/manual. Pricing, custo, margem e sync não devem alterá-lo silenciosamente.

## 12. Desconto/faixas por quantidade — REMOVIDOS

A Vortek não oferecerá desconto automático por quantidade no ML. Remover 3un/3%, 5un/4%, 10un/5% e qualquer equivalente (`ml_quantity_pricing_tiers`). Compras múltiplas seguem o carrinho normal, preservando preço unitário.

## 13. Margem global legada — REMOVIDA

`margem_lucro`, 10%, 30% ou qualquer percentual global histórico não governa a V2. A única política é a tabela por preço final. Remover consumidores/configuração operacional e retirar da V2 quando seguro.

## 14. custom_price

`custom_price` não prova preço manual, override, preço congelado ou decisão da Diretoria. Não usar como prova de autoria.

## 15. Origem e override

Toda alteração futura deve registrar, quando aplicável: `pricing_source`, instante, autor/job, motivo, preço anterior/novo, rule_id, job_id e pricing_group_id.

`manual_change != manual_pricing_override`

Somente override explícito bloqueia automação futura.

## 16. Liquidação interna

Usar `internal_stock_clearance` ou equivalente. Liquidação autorizada pode operar abaixo do piso, em margem zero ou prejuízo controlado. Exibir impacto sem desfazer automaticamente a decisão válida.

## 17. Margem abaixo do piso

Classificações: `PREJUIZO_REAL`, `MARGEM_BAIXA_ESTRATEGICAMENTE_FUNCIONAL`, `MARGEM_BAIXA_SEM_RETORNO_COMERCIAL`, `MARGEM_BAIXA_SEM_EVIDENCIA_COMERCIAL`, `LIQUIDACAO_AUTORIZADA`.

Quando houver recuperação, o primeiro degrau é normalmente o piso, não automaticamente o alvo.

## 18. Margem premium

Margem acima do limite não é defeito. Com vendas/recorrência: `MARGEM_PREMIUM_VALIDADA_PELO_MERCADO` → manter preço.

## 19. Performance e zero tráfego

Performance é separada da economia. Janelas: 30/90/150 dias. Sem amostra: `SEM_AMOSTRA`.

`ALERTA_AMARELO_SEM_TRAFEGO`: D+7 observação; D+15 amarelo; D+30 auditoria de exposição/qualidade.

## 20. Buy Box

`price_to_win` é evidência, não comando. Se estiver abaixo do preço economicamente permitido: `CONFLITO_ECONOMICO_DE_BUY_BOX`. Não perseguir Buy Box com prejuízo não autorizado.

## 21. Pricing groups

`pricing_group_id` é a unidade econômica. Anúncio próprio e catálogo sincronizados representam uma decisão, um estoque e uma exposição; sem dupla contagem, preços conflitantes ou pausa por "duplicidade".

## 22. Garantia — política canônica

Não existe garantia universal de 12 meses.

A política é **GARANTIA DO FABRICANTE**, produto a produto.

Precedência: fabricante oficial > documentação/oferta oficial > informação confiável da oferta > regra legal > fallback técnico permitido.

Nunca afirmar "12 meses de garantia do fabricante" sem suporte. Quando o ML exigir duração, usar prazo comprovado; não inventar.

## 23. Publicação

Antes do POST: identidade coerente; `SEM_CONFLITO`; checar ativo/reativação; oferta/estoque/custo; tarifa/frete vivos; economia >= piso; atributos, GTIN, marca, modelo, imagens e garantia reais. Após POST, readback obrigatório.

## 24. Conflitos e demanda

Identidade, economia e demanda são dimensões separadas.

Estados: `SEM_CONFLITO`, `CONFLITO_CONFIRMADO`, `PENDENCIA_VALIDACAO`, `INCONCLUSIVO`.

GTIN sozinho não substitui marca, modelo, embalagem, quantidade, kit, dimensão, voltagem, variante e atributos materiais.

Ausência de ranking/demanda não prova inviabilidade.

## 25. Experimentos

Devem possuir baseline, preço/margem anterior, preço experimental, início, checkpoints, resultado, reversibilidade e safety stop. Evitar alterações concorrentes durante a janela sem justificativa.

## 26. Automação e Dashboard

Automação noturna pode observar/calcular/diagnosticar/Radar/alertas/experimentos. Níveis: `AUTO_OBSERVE`, `AUTO_SAFE`, `REQUIRES_CONFIRMATION`, `MANUAL_ONLY`. Nenhuma escrita nova nasce `AUTO_SAFE` sem homologação.

Dashboard deve explicar motivo, evidência, impacto, regra e ação.

## 27. Políticas expressamente REMOVIDAS

1. custo variável adicional por SKU;
2. lucro mínimo R$20/R$60/R$150;
3. faixas de margem baseadas em custo;
4. desconto automático por quantidade;
5. faixas de preço por quantidade;
6. margem global legada;
7. `custom_price` como prova de override;
8. garantia universal de 12 meses.

Não reintroduzir sob outro nome sem homologação.

## 28. Políticas expressamente PRESERVADAS

1. 5/7/10 — 7/10/15 — 10/15/20 por preço final;
2. CMV como custo de aquisição do SKU;
3. tarifa ML, frete Vortek e tributo na economia;
4. fallbacks técnicos de tarifa/fretes;
5. autoridade superior do ML vivo;
6. limite de custo como regra operacional separada;
7. atividade manual do produto;
8. oferta ativa/preferencial válida;
9. liquidação autorizada;
10. override explícito;
11. pricing groups;
12. Buy Box econômica;
13. performance 30/90/150 e zero tráfego;
14. Radar/filtro de conflitos;
15. experimentos;
16. níveis de autonomia;
17. garantia real do fabricante.

## 29. Regra anti-"jabuticaba"

Nenhum campo, constante, custo, desconto, margem, piso, teto, prazo ou automação com impacto comercial pode existir apenas para "completar o modelo".

Antes de entrar no domínio deve possuir: definição, problema que resolve, fonte, unidade, escopo, precedência, consumidores, comportamento quando ausente, nível de autonomia e homologação.

Sem isso: `POLITICA_NAO_HOMOLOGADA`, sem participação em decisão automática.

## 30. Auditoria de políticas órfãs

Qualquer regra ativa que afete preço, margem, custo, desconto, publicação, pausa, estoque publicado, elegibilidade, garantia ou atividade sem correspondência neste Cânon deve gerar `POLITICA_ORFA_DETECTADA`.

Não corrigir silenciosamente quando houver risco de regressão.

## 31. Governança do Cânon

Mudança futura exige decisão explícita da Diretoria e registro de versão, data, seção, regra anterior, nova regra, motivo e impacto.

O Oráculo não altera a semântica deste Cânon por interpretação própria.

## 32. Ordem ao Oráculo

- manter este documento na base canônica de conhecimento;
- confrontar código/configurações com ele;
- sinalizar consumidores legados divergentes;
- não reintroduzir políticas removidas;
- usar estas regras em novas implementações;
- ambiguidade = perguntar ou `POLITICA_NAO_DEFINIDA`;
- preservar rastreabilidade de adequações.

## REGRA FINAL

> Se a política não foi definida, ela não existe.
>
> Custo diretamente atribuível à aquisição do SKU é CMV.
>
> Despesa operacional corporativa pertence à análise global da empresa.
>
> Margem que funciona comercialmente não deve ser destruída para satisfazer fórmula.
>
> Automação com potencial de dano exige evidência, autoridade e trilha.

Este documento permanece canônico até nova versão homologada pela Diretoria.

## Complementos expressamente aprovados na revisão executiva

Registro: conversa de aprovação do plano, 05–06/09/2026. Autoridade: Diretoria. Modelo econômico implementado: `VORTEK-CANON-1.0-ECON-2`.

| Seção | Regra anterior / lacuna | Decisão expressa | Motivo e impacto |
|---|---|---|---|
| 15 | Sem duração definida de override | Proteção explícita até revogação manual, por grupo; edição manual permitida | Separar autoria de impedimento da automação |
| 16 | Teto técnico de 30 dias não homologado | Remover teto; validade expressa com término ou até revogação | Preservar liquidação autorizada sem nova cadência |
| 22 | Hierarquia sem duração legal definida; revisão propunha 30 dias universais | Fabricante comprovado → fornecedor comprovado → legal: 30 dias não duráveis / 90 dias duráveis, conforme classificação documentada | Correção confirmada pelo usuário após consulta ao CDC; fornecedor não é rotulado como fabricante |
| 19/25/26 | Cânon descreve acompanhamento comercial | Nesta entrega não criar acompanhamento, alertas ou diagnósticos periódicos; preservar existentes | Escopo restrito a políticas de criação/correção e auditoria pontual |
| 23 | Preparação e publicação conforme autorização específica | Auditar existentes somente em leitura; filas de correção remota exigem autorização posterior | Nenhuma publicação ou alteração remota é teste desta entrega |

Garantia contratual e garantia legal permanecem distintas; não somar durações por inferência. Prazo de outro SKU, primeiro valor da categoria e duração genérica de marca não são fontes. Classificação duvidosa do produto exige validação específica, sem fabricar 30 ou 90 dias.

Fonte legal lida: [CDC atualizado, arts. 24, 26 e 50](https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html).


## Emenda homologada — garantia do vendedor — 06/09/2026

Autoridade: Diretoria, decisão expressa na aprovação do plano CATALOG_EXPANSION_BATCH_01.
Regra vigente: `VORTEK-WARRANTY-2026-09-06-SELLER-30`. Substitui as referências anteriores a fallback legal 30/90 dias; o registro anterior permanece histórico, sem autoridade decisória.

Fabricante comprovado para o produto → fornecedor comprovado da oferta utilizada → **garantia do vendedor de 30 dias**.
O fallback possui `warranty_source=seller_fallback`, `warranty_type=seller`, `warranty_duration=30`, `warranty_unit=days`.
Não classificar duráveis/não duráveis. Não nomear o fallback como garantia legal. A oferta contratual não elimina direitos legais aplicáveis.
Ausência contratual não bloqueia publicação. Evidência conflitante ou indisponibilidade de leitura da fonte não equivale a ausência comprovada.
Impacto: resolvedor, API de evidências, interface, novas preparações e publicações. Histórico, anúncios ativos e modelo econômico `VORTEK-CANON-1.0-ECON-2` preservados.
