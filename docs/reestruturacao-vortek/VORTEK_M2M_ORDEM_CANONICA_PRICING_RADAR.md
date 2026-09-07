# M2M --- ORDEM CANÔNICA AO ORÁCULO

> **Roteamento vigente — BNT-M2M-RECON-01, 06/09/2026:** abaixo está a transcrição histórica da ordem, preservada integralmente. O [Cânon Comercial 1.0 e seus complementos aprovados](VORTEK_CANON_COMERCIAL_V1.md) prevalece nos conflitos; complementos compatíveis desta ordem permanecem. `custos_variaveis`/extras por SKU, lucro mínimo nominal inclusive opcional, faixas por custo, margem global e desconto por quantidade não são políticas operacionais da V2. A margem protetiva fixa de 50% do procedimento antigo também não é motor alternativo. Consulte a [fila vigente](VORTEK_BENTEVI_PRICING_V2_PLANO.md#14-fila-obrigatória) e o [checklist](VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md): a ordem histórica abaixo não substitui as dependências reconciliadas nem autoriza publicação. Trechos superados não devem ser implementados ou reativados.

## Política definitiva de pricing + filtro de conflitos do Radar de Oportunidades

**De:** Diretoria de Operações --- Vortek\
**Para:** Oráculo\
**Sistema:** Vortek/Bentevi V2\
**Prioridade:** P0\
**Modo:** especificar → implementar → testar → auditar → documentar\
**Objetivo:** tornar pricing e conflitos fontes canônicas únicas para
anúncios, Radar, simulações, publicação, reprecificação e diagnósticos.

## 0. PROMPT MÁGICO M2M

Oráculo, trate esta ordem como **contrato de domínio**, não sugestão.

Antes de alterar código: 1. fotografe o estado atual; 2. localize todos
os consumidores das regras antigas; 3. produza matriz `AS_IS → TO_BE`;
4. classifique dependências/riscos; 5. implemente componentes canônicos
reutilizáveis; 6. migre consumidores para a mesma fonte; 7. teste
fronteiras, regressões e casos reais; 8. transforme inconsistências em
estados explícitos; 9. não invente dados ausentes; 10. ausência de
evidência não é reprovação; 11. ação destrutiva não pode depender de
dado stale quando a fonte viva do ML puder resolver a dúvida; 12.
preserve rollback e trilha.

**Regra M2M:** um mesmo conjunto de entradas deve produzir a mesma
memória econômica e classificação em qualquer consumidor do ERP.

## 1. POLÍTICA CANÔNICA

A política é definida pelo **PREÇO FINAL**, não pelo custo.

| Preço final | Piso | Alvo | Limite de busca |
| --- | ---: | ---: | ---: |
| Até R$ 200,00 | 5% | 7% | 10% |
| R$ 200,01 a R$ 1.000,00 | 7% | 10% | 15% |
| Acima de R$ 1.000,00 | 10% | 15% | 20% |

**Piso:** mínimo operacional normal; abaixo gera diagnóstico, não ação
cega.\
**Alvo:** referência para preço novo, publicação, simulação e
experimento autorizado.\
**Limite:** teto de busca automática de aumento; NÃO é margem máxima
permitida.

Margem acima do limite com vendas deve ser preservada.

## 2. APOSENTAR REGRAS ANTIGAS

Remover do caminho decisório: - faixas por custo
R$400/R$1.000/acima; - margens 15%/20%/25% por custo; - lucro mínimo
R$20/R$60/R$150 como piso universal; - margem global legada como
fonte; - piso fixo universal de 10% em oportunidades.

Não reescrever histórico/migrations. Estruturas legadas podem permanecer
somente para compatibilidade, sem novos consumidores.

## 3. ECONOMIA UNITÁRIA ÚNICA

Centralizar:

`resultado_unitario = receita - CMV - taxa_ml - frete_vortek - custos_variaveis - tributo`

`margem_operacional = resultado_unitario / receita`

Memória mínima: preço, custo, oferta/fornecedor, taxa e origem, frete e
origem, tributo e status, resultado, margem, faixa, piso, alvo, limite e
timestamps.

Nenhuma tela/job/Radar implementa fórmula própria.

## 4. PRECEDÊNCIA DE FONTES

- taxa ML observada/viva válida vence fallback;
- frete/cotação ML viva vence local/fallback;
- oferta elegível/preferencial ativa é fonte de custo;
- oferta inativa nunca vira preferencial;
- tributação usa serviço central RBT12/Simples, distinguindo
  `estimated` e `confirmed`.

### Aprendizado obrigatório do experimento D0

Antes de pausar, bloquear publicação ou confirmar prejuízo por
frete/tarifa: 1. consultar ML vivo; 2. recalcular; 3. só então decidir.

Se ML vivo falhar e dado local for duvidoso:
`INCONCLUSIVO_FONTE_ML_INDISPONIVEL`. Não pausar automaticamente.

## 5. ESTABILIZAÇÃO DA FAIXA

Como a faixa depende do preço final: 1. calcular preço na faixa
candidata; 2. verificar faixa resultante; 3. recalcular se cruzar
fronteira; 4. repetir até estabilizar; 5. limitar iterações e falhar
explicitamente se não convergir.

Testar R$200,00; R$200,01; R$1.000,00; R$1.000,01.

## 6. CONTEXTO COMERCIAL

Economia define sustentabilidade. Performance define motivo para
alteração.

Separar: - economia/pricing; - visitas; - vendas; - conversão; -
recorrência; - demanda/ranking; - qualidade; - exposição.

`MARGEM_ABAIXO_DO_PISO` e `MARGEM_SUPERIOR_AO_LIMITE` são diagnósticos,
não comandos.

Margem baixa deve distinguir: `PREJUIZO_REAL`,
`MARGEM_BAIXA_ESTRATEGICAMENTE_FUNCIONAL`,
`MARGEM_BAIXA_SEM_RETORNO_COMERCIAL`,
`MARGEM_BAIXA_SEM_EVIDENCIA_COMERCIAL`, `LIQUIDACAO_AUTORIZADA`.

Margem alta com vendas: `MARGEM_PREMIUM_VALIDADA_PELO_MERCADO` → manter.

## 7. NOVAS OPORTUNIDADES

O Radar usa exatamente a mesma política.

Fluxo: 1. validar identidade; 2. resolver custo elegível; 3. obter dados
ML; 4. calcular preço no alvo; 5. calcular piso/break-even; 6.
confrontar concorrência/Buy Box; 7. classificar viabilidade; 8. nunca
rejeitar por piso fixo de 10%.

Produto <R$200 com margem competitiva de 7,3%, por exemplo, está
dentro da política.

## 8. FILTRO CANÔNICO DE CONFLITOS

Executar filtro independente do score.

Estados: - `SEM_CONFLITO` - `CONFLITO_CONFIRMADO` -
`PENDENCIA_VALIDACAO` - `INCONCLUSIVO`

Somente `SEM_CONFLITO` poderá, no futuro, seguir para publicação
autônoma.

### Identidade

Confrontar quando disponível: - GTIN; - marca; - modelo; - part
number; - descrição; - embalagem; - quantidade; - variação/cor; -
dimensões críticas; - atributos técnicos; - catálogo ML; - oferta do
fornecedor.

Estados: `IDENTIDADE_COHERENTE`, `IDENTIDADE_DIVERGENTE`,
`IDENTIDADE_INCONCLUSIVA`.

GTIN sozinho não decide quando outros atributos materiais contradizem.

### Embalagem/kit

Bloquear automação em unidade vs kit, quantidade divergente,
apresentação/tamanho incompatível ou atributo material contraditório.

Estado: `CONFLITO_EMBALAGEM_QUANTIDADE`.

## 9. CONFLITO COM ANÚNCIO EXISTENTE

Antes de nova oportunidade procurar anúncio ativo, pausado, próprio,
catálogo, pares sincronizados e histórico.

Estados: - `JA_ANUNCIADO_ATIVO` - `REATIVACAO_CANDIDATA` -
`NOVO_ANUNCIO_CANDIDATO` - `VINCULO_INCONCLUSIVO`

Reativação e novo anúncio são filas distintas.

Usar `pricing_group_id`; `catalog_synchronized_pair=true` representa uma
unidade econômica, sem dupla contagem ou preços conflitantes.

## 10. CONFLITO ECONÔMICO

No preço competitivo calcular resultado, margem, piso, alvo e
break-even.

Estados: - `VIAVEL_NO_ALVO` - `VIAVEL_ACIMA_DO_PISO` -
`ABAIXO_DO_PISO_MAS_POSITIVO` - `PREJUIZO_NO_PRECO_COMPETITIVO` -
`CONFLITO_ECONOMICO_DE_BUY_BOX`

Novo anúncio: - viável no alvo → forte candidato; - acima do piso →
candidato válido; - abaixo do piso → revisão/estratégia; - prejuízo →
bloquear; - Buy Box destrutiva → não perseguir.

## 11. DEMANDA NÃO É CONFLITO

`SEM_EVIDENCIA_DE_DEMANDA`, `SINAL_INDIRETO`, `RANKING_ML`,
`HISTORICO_PROPRIO` alimentam priorização, não identidade/viabilidade.

Ausência/404 em ranking não significa "não vende".

## 12. SCORE EXPLICÁVEL

Separar dimensões: 1. identidade; 2. economia; 3. demanda; 4.
competitividade; 5. estoque; 6. completude/qualidade para publicação.

Não criar score opaco sem decomposição.

## 13. FUNIL DO RADAR

`DESCOBERTO` → `IDENTIDADE_VALIDADA` → `ECONOMIA_VALIDADA` →
`SEM_CONFLITOS` → `PRONTO_PARA_PREPARACAO` → `AGUARDANDO_APROVACAO` →
`PUBLICADO_EXPERIMENTO` → `VALIDADO` / `REJEITADO` / `REVISAR`

Paralelos: `REATIVACAO_CANDIDATA`, `PENDENCIA_VALIDACAO`,
`CONFLITO_CONFIRMADO`, `INCONCLUSIVO`.

## 14. AUTONOMIA

Esta entrega NÃO autoriza publicação automática em massa.

Radar pode operar como `AUTO_OBSERVE`. Publicação permanece
`REQUIRES_CONFIRMATION` até homologação específica.

## 15. RADAR NOTURNO

Integrar à rotina autônoma: 1. atualizar ofertas; 2. eliminar itens já
anunciados; 3. reconstruir vínculos/grupos; 4. validar identidade
possível; 5. aplicar conflitos; 6. calcular economia canônica; 7.
coletar sinais de demanda disponíveis; 8. classificar; 9. atualizar
filas/alertas; 10. evitar reprocessamento sem mudança material.

Usar dedupe, checkpoint, batching, lock e idempotência.

## 16. DASHBOARD

Filas mínimas: - `PRONTOS_PARA_ANALISE` - `ALTA_PRIORIDADE` -
`REATIVACOES` - `PENDENCIAS_IDENTIDADE` - `CONFLITOS` -
`ECONOMICAMENTE_INVIAVEIS` - `EXPLORATORIOS`

Mostrar SKU, produto, fornecedor, custo, estoque, preço competitivo,
piso, alvo, margem competitiva, contribuição, demanda, identidade,
conflitos e recomendação.

## 17. CONFIGURAÇÕES E AUDITORIA

Na área Comercial/Precificação, usar fonte tipada para faixas, piso,
alvo, limite, fallbacks e parâmetros homologados do Radar.

Mudança de configuração não deve publicar/reprecificar silenciosamente;
deve gerar impacto/simulação conforme nível de autonomia.

Toda alteração futura de preço registra `pricing_source`, instante,
autor/job, razão, preço anterior/novo, rule_id, job_id e
pricing_group_id.

Alteração manual ≠ override.

## 18. TESTES OBRIGATÓRIOS

Pricing: - fronteiras; - estabilização; - taxa viva/fallback; - frete
vivo/fallback; - tributo estimated/confirmed; - piso/alvo; - margem
premium; - prejuízo.

Conflitos: - GTIN coerente; - GTIN divergente porém variação legítima; -
marca/modelo divergentes; - unidade vs kit; - quantidade divergente; -
anúncio existente; - catálogo sincronizado; - reativação; - vínculo
inconclusivo.

Integração: - Radar e anúncio existente produzem a mesma memória
econômica; - simulador e Radar produzem o mesmo preço; - fonte ML viva
impede falso prejuízo por dado stale.

## 19. REPROCESSAR `oportunidades-ml.xlsx`

Após implantação, reprocessar o universo já levantado, sem nova pesquisa
externa pesada.

Objetivos: - medir impacto da nova política; - reclassificar rejeitados
pelo piso fixo de 10%; - revalidar os 65 candidatos revisados; - separar
reativações; - produzir nova fila priorizada.

A Diretoria fará pesquisa complementar separadamente para poupar
processamento do Oráculo.

## 20. ENTREGÁVEIS

- `00_RESUMO_EXECUTIVO.md`
- `01_AS_IS_TO_BE.md`
- `02_POLITICA_PRICING_CANONICA.md`
- `03_CONTRATO_FILTRO_CONFLITOS.md`
- `04_MATRIZ_CONSUMIDORES_PRICING.md`
- `05_TESTES_E_EVIDENCIAS.md`
- `06_REPROCESSAMENTO_OPORTUNIDADES.xlsx` ou CSVs equivalentes
- `07_PENDENCIAS_VALIDACAO.md`
- `08_RISCOS_RESIDUAIS.md`
- `manifest.json`

Atualizar documentação canônica e catálogo de regras.

## 21. FILA M2M

1. `M2M-PRC-01` --- política por preço final;
2. `M2M-PRC-02` --- economia unitária única;
3. `M2M-PRC-03` --- aposentar consumidores legados;
4. `M2M-PRC-04` --- precedência ML viva/fallback;
5. `M2M-CFL-01` --- contrato de conflitos;
6. `M2M-CFL-02` --- identidade/embalagem;
7. `M2M-CFL-03` --- anúncio existente/pricing group;
8. `M2M-CFL-04` --- conflito econômico/Buy Box;
9. `M2M-RAD-01` --- funil/score explicável;
10. `M2M-RAD-02` --- job noturno;
11. `M2M-RAD-03` --- Dashboard;
12. `M2M-RAD-04` --- reprocessamento da planilha;
13. `M2M-GATE` --- regressão, evidências e homologação.

Uma mudança coerente por tarefa/commit quando houver independência real.
Não criar "megacommit" que impeça auditoria.

## 22. CRITÉRIOS DE ACEITE

Aceitar somente quando: 1. nenhuma decisão nova usar faixa por custo
antiga; 2. nenhum candidato for rejeitado por piso universal 10%; 3.
consumidores usarem a mesma economia; 4. tarifa/frete vivos vencerem
dado stale; 5. identidade, economia e demanda forem separadas; 6.
conflito kit/quantidade bloquear automação; 7. ausência de demanda não
virar conflito; 8. reativação não for confundida com novo anúncio; 9.
catálogo sincronizado não for duplicado; 10. Buy Box não induzir
prejuízo; 11. Dashboard explicar cada fila; 12. regressões passarem; 13.
nenhuma publicação automática em massa tiver sido criada.

## 23. ORDEM FINAL

O Radar não deve responder "o que podemos anunciar?" apenas porque
existe estoque.

Deve responder:

> **Qual produto é realmente o mesmo produto, possui oferta válida, é
> economicamente sustentável pela política atual, não conflita com
> anúncio existente e merece investimento operacional para entrar no
> catálogo?**

O pricing não deve ser uma coleção de fórmulas espalhadas.

> **Uma política. Uma memória econômica. Uma classificação. Todos os
> consumidores.**

A Diretoria assumirá parte das pesquisas externas e validações
comerciais para reduzir processamento do Oráculo.

O Oráculo deve concentrar processamento onde possui vantagem exclusiva:
**código, banco, integrações, estado operacional, automação,
consistência e execução auditável.**

**FOTOGRAFAR → CENTRALIZAR → VALIDAR → FILTRAR → CLASSIFICAR → TESTAR →
AUDITAR → HOMOLOGAR.**

---

## Registro de incorporação — não integra a transcrição acima

Recebido da Diretoria nesta conversa e incorporado em 05/09/2026. Conteúdo integral preservado; tabela e listas normalizadas para Markdown. Confirmado pelo responsável: M2M prevalece nos conflitos e mantém complementos anteriores compatíveis (override, liquidação, experimentos, zero tráfego e auditoria).

Execução, correspondência de identificadores e estado atual: [plano Pricing V2](VORTEK_BENTEVI_PRICING_V2_PLANO.md) e [checklist Item 17](VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md). Esta ordem não comprova que as funcionalidades já estejam implementadas e não autoriza escrita em produção.
