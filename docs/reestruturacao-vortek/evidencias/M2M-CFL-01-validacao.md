# M2M-CFL-01 — Contrato canônico de conflitos

**Data:** 07/09/2026. **Base:** `d057dc6`, branch `dev`, working tree inicialmente limpa.
**Resultado:** contrato puro implementado e testado; **não ativado nos consumidores**.

## Autoridade e fotografia AS_IS → TO_BE

Fontes: [Cânon Comercial 1.0, §§23–24](../VORTEK_CANON_COMERCIAL_V1.md), [ordem M2M, §8](../VORTEK_M2M_ORDEM_CANONICA_PRICING_RADAR.md), fila reconciliada do [plano](../VORTEK_BENTEVI_PRICING_V2_PLANO.md) e seção 18 do [dossiê](../VORTEK_BENTEVI_PRICING_V2_DOSSIE.md). A precedência abaixo implementa o plano explicitamente aprovado, não cria política de publicação.

| Fonte/consumidor atual | Evidência local | Tratamento / dono |
|---|---|---|
| `src/lib/ml-listing-identity.ts` | `compare` ignora ausência; `assessMlListingIdentity` permite reconciliação de marca por SKU/GTIN e retorna lista de bloqueios vazia nesse caso | Não interpretar lista vazia como avaliação completa. Adequação material em CFL-02 |
| `src/lib/ml-critical-attributes.ts` | Resolve fatos/ofertas e encaminha para a avaliação de identidade existente | Reutilizar/consolidar na CFL-02, sem segundo comparador nesta entrega |
| `src/app/api/sync/anuncios/route.ts` | Reconcilia marca e bloqueio a partir de `canonicalBrand`/`blockingConflicts` | Intacto. Migração precisa de avaliação material validada; nenhuma ativação implícita aqui |
| `src/lib/ml/identity-block.ts` | Persistência/lifecycle dos bloqueios automáticos | Intacto; classificar não é bloquear/desbloquear |
| Vínculos e grupos | Contrato C09 separa vínculo de identidade e demanda | Avaliador na CFL-03, sem inferência por SKU/GTIN nesta entrega |
| `src/services/pricing-economy.ts` | Dono da memória econômica já existente | CFL-04 entregará avaliação econômica usando essa memória, sem fórmulas no classificador |
| `src/lib/ml/pricing-execution.js` | `pricing_execution_not_ready` impede criação/reprecificação | Intacto e coberto por regressões; SEM_CONFLITO não é autorização |

Antes da entrega, busca dos estados canônicos no código não encontrou classificador compartilhado. Após a entrega, as únicas referências ao módulo são seu contrato, implementação e teste; nenhum consumidor de runtime foi conectado.

## Interface e semântica

- Tipos: `src/types/commercial-conflicts.ts`.
- Entrada `CommercialConflictInput`: mapa parcial das quatro dimensões fixas `identity`, `packaging_quantity`, `listing_link`, `economy`. Cada avaliação declara `status`, `coverage` (`complete`/`partial`), motivos com `code`/`ruleId` e referências de evidência. Não aceita score/demanda/ranking no tipo.
- Evidência: `source`, `reference`, `collectedAt` e `condition`. Apenas referências sanitizadas, nunca payload/credencial/URL autenticada. O chamador continua responsável pelo conteúdo dessas referências e pela validade material da avaliação.
- `collectedAt`: instante UTC normalizado, com zero a três casas de milissegundos; data inválida fica inconclusiva. O classificador não consulta relógio nem atribui TTL. Quem resolve a fonte determina `valid`, `stale`, `invalid`, `unavailable` ou `inconsistent`.
- Implementação: `classifyCommercialConflicts` em `src/services/commercial-conflicts.ts`.
- Saída `CommercialConflictResult`: versão `M2M-CFL-01-v1`, estado global, dimensões na ordem fixa e todos os motivos com a dimensão de origem. `reportedStatus` distingue alegação recebida de classificação efetiva.

Ordem de consolidação: **CONFLITO_CONFIRMADO → INCONCLUSIVO → PENDENCIA_VALIDACAO → SEM_CONFLITO**. A precedência não apaga os estados/evidências das demais dimensões e não executa ação alguma.

- Dimensão omitida ou cobertura parcial sem conflito: pendência, nunca aprovação implícita.
- Alegação de ausência de conflito sem evidência: pendência. Alegação de conflito sem evidência: inconclusivo, não divergência comprovada.
- Evidência duvidosa/stale/indisponível/inconsistente ou malformada invalida a conclusão da dimensão. Evidências malformadas não são copiadas para a saída; motivo explícito registra o problema. As válidas e os motivos recebidos são preservados.
- Avaliação estruturalmente inválida vira `AVALIACAO_INVALIDA`, sem reproduzir objeto bruto. Entradas não objeto viram `ENTRADA_INVALIDA`.
- Contradição comprovada numa dimensão prevalece no resumo mesmo com outras pendentes; cobertura parcial continua visível. Uma evidência inválida na própria avaliação impede tratar sua alegação como comprovada.
- Todos os critérios da dimensão devem ser verificados pelo avaliador antes de declarar cobertura completa. Este módulo não prova atributos, vínculos, sincronismo ou economia a partir de dados brutos.
- GTIN coincidente não apaga motivo informado de marca/embalagem; ausência de ranking não reprova. Não há comparador, fórmula, score ou lógica de Buy Box novos aqui.

## Validação executada

Ambiente local: Node `v22.23.1`, TypeScript `5.9.3`. Tipagem discriminada conforme [documentação oficial do TypeScript](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions), consultada nesta tarefa. Não há contrato externo ML novo ou alterado.

Comando:

```sh
node --test --test-reporter=dot tests/m2m-cfl-01-conflicts.test.js tests/ml-critical-attributes.test.js tests/ml-identity-block-lifecycle.test.js tests/m2m-prc-03-execution.test.js
npm run validate
git diff --check
```

**52 testes aprovados**, sem falhas: 18 novos e 34 regressões existentes. Um teste novo percorre as 256 combinações possíveis dos quatro estados nas quatro dimensões. Cobertura: ausência, parcialidade, metadados inválidos, fonte indisponível/stale, preservação de motivos, GTIN versus conflito material informado, score/demanda sem efeito, entradas congeladas, repetibilidade, ordem das dimensões e não propagação de campos extras. Um teste com o helper real demonstra que `blockingConflicts=[]` não equivale ao contrato canônico completo.

As regressões de execução usam módulos/rotas com dependências isoladas e clientes simulados; não fazem escrita real. `npm run validate` (ESLint + TypeScript) e `git diff --check` aprovados.

## Limites, pendências e rollback

- Sem build ou deploy: núcleo sem importação por consumidores de runtime. Não houve alteração visual ou homologação pelo navegador.
- Sem acesso a banco, migration, conta real, publicação, pausa ou reprecificação. Nenhuma infraestrutura ou produção acessada.
- Cânon, AGENTS e guards intactos. Sem novas dependências, configuração, job, API ou tabela.
- CFL-02/03/04 permanecem pendentes: estes testes não certificam avaliação real de identidade, catálogo, Buy Box ou integração completa de publicação.
- [Frete vivo ME2](M2M-PRC-04-validacao.md#decisão-do-usuário--frete-na-conexão-da-conta-real) permanece para a conexão autorizada da conta real e bloqueia os gates comerciais, não o próximo desenvolvimento.
- Rollback: reverter seletivamente o commit desta entrega (contrato, função, teste e documentação), preservando outros trabalhos. Sem rollback de dados ou runtime porque nenhum foi alterado.

**Próximo passo:** planejar M2M-CFL-02, sem executá-la automaticamente. A skill local de implementação manteve a entrega em uma única ação DEV.
