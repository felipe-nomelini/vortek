# BNT-PRICING-V2-08 / M2M-CFL-04 — Buy Box econômica

Data: 08/09/2026. Escopo: implementação e validação local em `dev`; sem liberação comercial.

## Publicação DEV — solicitação posterior de 08/09/2026

Push `dev` de `0bd31f6` para `a71873d299de676fa142a84fdad0f6cca7a63293`, seguido do script `npm run deploy:easypanel`. Preflight confirmou correspondência do webhook ao serviço `local/vortek-erp-dev`, origem `dev` e autoDeploy desabilitado, sem expor token.

Ação Easypanel `cmts82kt0000307o90yjk8v2y`: build concluído. Serviço DEV versão `9606`, atualização concluída às `2026-09-08T05:24:09Z`, GIT_SHA `a71873d299de676fa142a84fdad0f6cca7a63293`, tarefa em execução. Login HTTPS respondeu 200 e consulta econômica sem sessão respondeu 401 antes de consultar produto/ML.

Produção permaneceu versão `9592`, GIT_SHA `8ef8e7b7fe65f6aad049ca646bb1d8152309f9b1`, UpdatedAt `2026-09-08T05:18:09.29887291Z`, iguais ao preflight. Nenhuma operação de banco, configuração ou preço foi executada nesta publicação.

O registro documental posterior não muda o bundle publicado. Publicação DEV deixa de ser pendência; conferência autenticada dos drawers/aceite visual e frete ME2 continuam pendentes. Os registros abaixo descrevem a implementação anterior ao pedido de deploy.

## AS_IS → TO_BE

| Antes | Entrega |
| --- | --- |
| Análise de catálogo classificava apenas ajustar/não viável | Avaliador único distingue alvo, piso, positivo abaixo do piso, equilíbrio, prejuízo projetado e inconclusivo |
| Normalização aceitava preço vencedor/atual e convertia ausência em zero | Apenas `price_to_win` numérico positivo; item, moeda, catálogo, preço atual e consistência confrontados |
| Referência competitiva preenchia o editor antecipadamente | Editor começa no preço atual; botão explícito consulta/simula, nunca aplica |
| Snapshot parecia recomendação operacional | Triagem identificada como preliminar, sem preço recomendado e sem esconder inconclusivos |
| Detalhe não cotava a referência competitiva | PRC-04 consulta preço atual, competitivo e projeções, compartilhando cotações por preço dentro da requisição |

## Contratos e consumidores

- `pricing-competition.ts`: adaptador puro da memória canônica ECON-2. Não soma custos, não cria preço e não consulta serviços. A dimensão econômica alimenta CFL-01; dimensões não avaliadas continuam pendentes.
- `loadLiveProductPricing`: comparações `actual`/`competitive`, com tarifa/frete próprios e grupo identificado. Falha/revalidação material elimina as comparações, sem confirmar prejuízo por fonte duvidosa.
- `preco-detalhe`: `competitiveAssessment` versão `M2M-CFL-04-v1`, `commercialConflicts`, grupo/versão, override, evidência e memórias. `catalog` e os demais campos existentes permanecem. Consulta pontual também reconfirma competição, grupo e preço dos pares sincronizados; não reconcilia nem grava grupos.
- `analise-preco`: utiliza o mesmo avaliador, mas snapshot não vira evidência viva. Retorno `preliminary: true`, classificação `INCONCLUSIVO`, referências históricas identificadas como triagem. A contagem é de anúncios analisados, não soma econômica nem total de oportunidades/grupos aprovados.
- Anúncios/Catálogo: resumo comparativo compartilhado, sem recuperação silenciosa do preço competitivo antigo quando a consulta falha. Respostas atrasadas não substituem os dados do próximo drawer.
- Auditoria: aproveita `pricing_evaluations.result`, adicionando a avaliação competitiva tipada. Não cria tabela, migration, outbox ou operação de preço. O fingerprint inclui a nova avaliação; relógios de coleta continuam fora da assinatura material.

## Política e proteções

Piso normal é o da faixa do preço final. Alvo/piso são comparados pela memória não arredondada para apresentação. Resultado positivo abaixo do piso e equilíbrio requerem revisão; prejuízo projetado gera conflito econômico, não afirma prejuízo realizado. Margem premium e posição vencedora não comandam desconto.

Override fica separado da economia. Uma liquidação não é aplicada só porque existe: POST pode informar `clearance: {id, quantity, fulfillmentSource: "internal"}` como cenário explícito de consulta. Autoridade, grupo/versão, estado, término, capacidade interna, quantidade disponível e limite vêm dos serviços existentes, com revalidação. Sem cenário interno válido, aplica-se o piso normal. Exceção não modifica a memória negativa nem autoriza execução. A tela de Buy Box não ativa, revoga ou consome liquidações.

`AUTO_OBSERVE`, `executionBlocked: true` e `pricing_execution_not_ready` preservados. Nenhum desconto universal, fonte de custo nova, piso fixo de 10%, alteração de atividade ou publicação foi introduzido.

## Validação

- Regressões: arquivos `m2m-*`, `pricing-*`, `catalog-*`, garantia, Anúncios, Catálogo e PDF de Catálogo. 408 testes passaram, sem falhas ou skips na rodada registrada.
- Novos cenários: R$200/R$200,01/R$1.000/R$1.000,01; 7,3% abaixo de R$200; igualdade ao piso/alvo; zero/prejuízo; premium; referência ausente/inválida; cotação por preço sem chamadas duplicadas; contexto/competição/grupo alterados; par dessincronizado/divergente; override e liquidação.
- Renderização real React/Ant Design: avaliação favorável, revisão, prejuízo e ausência, com memórias por cenário.
- Conferência visual em Chromium isolado, com cenário sintético explicitamente identificado e rede bloqueada. Não equivale a navegador autenticado no ambiente implantado.
- `npm run validate` e `npm run build` executados; build gerou 120 páginas.

## Limites, pendências e rollback

- Sem acesso a banco/ML real nesta implementação, sem migrations, push ou deploy. Produção não tocada.
- Pendente publicar em DEV mediante solicitação e conferir os drawers autenticados. Não declarar aceite visual do usuário antecipadamente.
- Frete vivo ME2 permanece no gate já registrado para conexão autorizada da conta. Fixtures não substituem essa evidência.
- Alertas/confirmações, desempenho, Radar, rotina noturna e PUB-GATE não foram antecipados. Próximo trabalho da fila: V2-13, após o aceite correspondente.
- Rollback: reverter apenas o commit desta entrega. Não existe alteração de schema ou escrita comercial a desfazer; avaliações JSON prospectivas podem permanecer históricas.

## Fontes consultadas

- [Competição de catálogo ML](https://developers.mercadolivre.com.br/en_us/catalog-competition): contrato de referência competitiva, estados, moeda, item e ausência de preço. Conteúdo oficial consultado via índice; abertura direta retornou 403.
- [Supabase insert](https://supabase.com/docs/reference/javascript/insert): persistência no contrato existente e retorno com select.
- [Ant Design Alert](https://5x.ant.design/components/alert/) e [tokens de tema](https://5x.ant.design/docs/react/customize-theme/): apresentação de estados e cores do tema vigente.
- Guia de Route Handlers da instalação local Next.js 16.3.3, cânon comercial, auditoria Item 4, plano/dossiê e procedimento operacional ML.
