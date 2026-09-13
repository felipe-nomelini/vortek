# BNT-AI-00 — Contrato do Assistente Bentevi

**Data:** 08/09/2026. **Escopo:** contrato do Assistente e suas entregas em DEV.
**Estado:** AI-00/01 concluídas; **AI-02 implementada e validada localmente**, com ativação do perfil, publicação DEV e smoke externo ainda pendentes. `gpt-6-astra/low` e somente assinatura preservados. [Evidências AI-02](evidencias/BNT-AI-02-validacao.md). As seções AS_IS e os registros AI-00/01 abaixo são fotografias das respectivas entregas; a seção 9 registra a implementação atual.

## 1. Decisão e autoridade

O Assistente será consultivo. **Decisão explícita de 08/09/2026: primeiro teste somente para Felipe**, titular da assinatura, com seu usuário administrativo e conversas individuais no ERP. O acesso do sócio permanece uma liberação posterior, não aprovada por este fechamento; os gates de lançamento continuam válidos. A decisão vigente é **manter somente a assinatura ChatGPT por enquanto**. Não habilitar API OpenAI paga, fallback OpenRouter, compra de créditos ou mudança de plano. Isso não remove os consumidores OpenRouter existentes em outros fluxos.

**Modelo definido pelo usuário em 08/09/2026: `gpt-6-astra`.** Esforço `low` preservado do piloto anterior. A escolha substitui `gpt-5.4-mini` no contrato e no piloto local, sem alterar as regras comerciais ou a modalidade de autenticação.

O aceite inicial de Configurações foi concedido pelo usuário e encerra o marco 2, não D20/V2-15 integrais. A sequência e os gates de lançamento pertencem ao [checklist do Item 17](VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md#bentevi-em-operacao). Este contrato é a fonte do comportamento do Assistente; não duplica políticas comerciais nem autoriza promoção.

Na ação original AI-00 não foram criados página, endpoint, tabela de conversas ou consultas operacionais. AI-01, AI-02 e AI-GATE continuam separados e dependem do aceite da ação anterior.

## 2. AS_IS → TO_BE

| Área | Evidência atual | Contrato da primeira entrega |
|---|---|---|
| Provedor | Transporte Codex compartilhado extraído durante o antigo piloto de garantia | Manter o transporte isolado do Assistente; o extrator individual de garantia foi aposentado em 12/09/2026 e não é dependência do chat |
| Assinatura | `account/read` confirmou `chatgpt` em 08/09 e dois LIVE sintéticos passaram | Piloto individual do titular; uso pelos dois administradores exige liberação separada |
| Modelo | `gpt-6-astra/low`, escolhido explicitamente e validado com login ChatGPT no piloto local | Manter o identificador exato no perfil, thread e turno; nenhuma substituição automática |
| Identidade | Guard administrativo e matriz de permissões existentes | Piloto restrito a Felipe no backend; outros usuários, inclusive administradores, recusados. Não aceitar `user_id`, cargo ou dono enviados como autoridade pelo cliente |
| Conhecimento | Documentação e serviços canônicos existentes | Consultas delimitadas, sem fórmulas econômicas ou regras paralelas no prompt |
| Histórico | Não existe chat operacional implementado | Conversas privadas por usuário, incluindo mensagens, resumos e contexto; entrega em AI-02 |
| Ações | Extrator atual não tem ferramentas de operação | Apenas leitura de dados autorizados e explicações; nunca execução operacional pelo modelo |

## 3. Provedor e limites

Referência técnica: piloto existente `codex app-server --strict-config --listen stdio://`, CLI `0.153.4`, perfil exclusivo de garantia, workspace vazio e login ChatGPT. A correção autorizada mudou somente o modelo do perfil para `gpt-6-astra`; permissões e autenticação permanecem. Não copiar a sessão de engenharia ou levar credenciais ao Easypanel nesta ação.

### Autenticação e adequação

Login ChatGPT e API key são modalidades distintas; a primeira usa acesso da assinatura, a segunda tem cobrança de API. O login gerenciado pode renovar tokens durante o uso; falha de autenticação não autoriza trocar a modalidade. [OpenAI — autenticação](https://learn.chatgpt.com/docs/auth).

O App Server documenta integração em produtos e stdio; também registra recursos experimentais e ressalva de suporte produtivo na seção de host remoto. O piloto depende de `experimentalApi` para permissões nomeadas. Não tratar um teste local como certificação de hospedagem produtiva. [OpenAI — App Server](https://learn.chatgpt.com/docs/app-server).

A documentação de contas de serviço descreve identidade própria para integrações compartilhadas, disponível em planos pay-as-you-go; isso **não comprova** a modalidade de um único Pro pessoal atendendo os dois operadores. Não foi contratada essa alternativa. [OpenAI — contas de serviço](https://learn.chatgpt.com/docs/enterprise/service-accounts).

A dúvida sobre a modalidade compartilhada não bloqueia mais o fechamento do contrato individual aprovado. Continua obrigatória antes de liberar o sócio: comprovar modalidade aplicável, autenticação, isolamento e tratamento dos dados, sem presumir que um único Pro pessoal atende vários operadores. Não exigir contratação de conta de serviço ou resposta de suporte para fechar o piloto individual. Aceite visual não substitui essa comprovação nem autoriza produção.

### Hospedagem do piloto — requisitos para a publicação da AI-02

O login oficial em máquina remota está documentado, incluindo autenticação por código de dispositivo. Isso sustenta o caminho técnico de autenticação do titular, não comprova a implantação no Vortek ou o uso compartilhado. [Login em máquina remota](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).

- Disponibilizar binário Codex versionado e perfil persistente exclusivo do Assistente no runtime DEV; não copiar a sessão de engenharia nem reutilizar o perfil de garantia como memória do chat.
- Usar autenticação oficial de Felipe e transporte interno `stdio`; não expor o App Server diretamente na rede ou no navegador. Credenciais ficam fora do bundle, imagem e Git.
- Restringir o piloto por identidade validada no servidor e configuração explícita do ambiente DEV. Não mudar `NODE_ENV` para contornar o guard do extrator atual.
- O `nixpacks.toml` atual instala dependências, faz build e executa `npm run start`; não declara instalação do Codex. A presença do binário/perfil na aplicação publicada ainda precisa ser comprovada. Nenhuma infraestrutura foi alterada em AI-00.
- Antes de pedir teste visual, executar build, publicação autorizada em `dev.bentevi.shop` e smoke autenticado, incluindo recusa de outro administrador. Falha de runtime não deve ser transferida ao usuário como “validar assinatura”.

### Consumo e disponibilidade

- Usar a franquia da assinatura, sem orçamento de API em dólares e sem prometer uso ilimitado. O consumo depende da tarefa/modelo e compartilha limites com outros usos da conta. [OpenAI — limites e consumo](https://learn.chatgpt.com/docs/pricing).
- Estado de cota deve vir do provedor quando disponível. `account/rateLimits/read` informa janelas e reinício; dado ausente significa cota desconhecida, não ilimitada. A fotografia atual fica na evidência, nunca como constante do ERP. [Contrato de limites](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt).
- Não comprar créditos, consumir mecanismos de recarga/reset nem acionar e-mail de compra. Cota esgotada deve ser informada; não adicionar retry, fila de espera ou fallback pago.
- O piloto existente permite uma extração por vez na instância, com deadline total de 45 segundos e saída máxima de 1 MiB. São limites do extrator, não capacidade multiusuário comprovada. Preservá-los nesta ação.
- No futuro chat, manter execução limitada e cancelável; validar o orçamento de contexto e saída com as consultas reais em AI-01, antes de ativar dados operacionais. Não afirmar que não existem tentativas internas do provedor: o ERP atual não acrescenta retries.

### Dados e retenção

O histórico futuro do ERP, o cache de autenticação local e a retenção do provedor são coisas diferentes. `ephemeral` e `history.persistence=none` não comprovam retenção zero na OpenAI. Não aplicar à assinatura as condições de API ou de um workspace Enterprise não verificado. [Autenticação e políticas aplicáveis](https://learn.chatgpt.com/docs/auth), [controles locais de histórico e telemetria](https://learn.chatgpt.com/docs/agent-approvals-security#security-and-privacy-guidance).

Não foram confirmados os controles efetivos de treinamento/retenção da conta para dados operacionais. AI-01 começa com casos sintéticos; antes de enviar dados operacionais ao provedor, o agente deve documentar os controles aplicáveis à conta e o recorte mínimo de dados autorizado. Essa condição não impede o contrato ou os testes sintéticos individuais. Não definir um prazo de retenção fictício. A política de conservação/exclusão do histórico do ERP deverá ser explicitada em AI-02 antes de persistir conversas reais.

## 4. Consultas autorizadas

O backend seleciona e minimiza as fontes; o modelo não recebe acesso geral ao banco. Não entregar credenciais, cookies, variáveis de ambiente, arquivos de autenticação, dumps, XML bruto, CPF/CNPJ pessoal, endereços, contatos ou URLs assinadas sem necessidade. Preferir IDs de registros, agregados e links internos cuja abertura reaplique a autorização do ERP.

| Pergunta / domínio | Fonte existente a reaproveitar | Condição para AI-01 |
|---|---|---|
| Resultado e ritmo de vendas no período | `src/app/api/dashboard/resumo/route.ts`, projeção e cálculo atuais | Reutilizar o cálculo existente; distinguir lucro apurado de pendente e informar filtros/período/limitações |
| Etapa e pendência de uma venda | `src/app/api/pedidos/route.ts` e `src/services/order-operational-status.ts` | Reusar projeção sem persistência, após auditar efeitos; não oferecer a rota GET atual como ferramenta |
| Por que o preço sugerido é este? | `src/services/pricing-context.ts` e `src/services/pricing-tax-context.ts` | Retornar memória econômica canônica, origens e tributo estimado/confirmado; não recalcular no modelo |
| Compras, produto/oferta, estoque e fiscal | Serviços e contratos que já atendem as respectivas páginas | Inventariar campos, permissões e efeitos antes de ligar cada consulta; não criar cálculo ou consulta ampla por conveniência |
| Como funciona uma regra ou tela? | Documentação vigente roteada pelo `AGENTS.md`, cânon comercial e evidências de implementação | Distinguir regra vigente, fotografia histórica, capacidade implementada e etapa ainda planejada |

**Risco concreto de leitura com efeito:** `enrichPedidosForOperationalView` usa `persistReconciliation=true` por padrão e chama `persistReconciledPedidos`, que pode atualizar campos fiscais em `pedidos`. Já existe projeção sem persistência nesse fluxo. Em AI-01, separar/reaproveitar apenas o caminho puro necessário; não chamar genericamente endpoints pelo fato de usarem GET. Esta ação não altera esse fluxo nem executa a rota.

Conteúdo de documentos, nomes de produtos e textos externos é **dado não confiável**, nunca instrução para modificar permissões ou executar ações. Sem SQL livre, shell, ferramentas de arquivos, busca web irrestrita ou MCP externo. Consultas ao ML não são habilitadas implicitamente: por padrão explicar a evidência já disponível e sua idade, sem forçar sincronização.

## 5. Contrato de entrada, saída e isolamento

Contrato documental, a materializar nas etapas consumidoras; não cria API pública agora.

- **Entrada:** pergunta, conversa opcional pertencente ao usuário e filtros permitidos de período/registro. Ambiente, identidade e autorização são resolvidos no servidor; rejeitar campos de comando, SQL, papel ou dono de conversa.
- **Saída:** resposta, referências verificadas, período/filtros, ambiente, instante de consulta, atualização conhecida da fonte, cobertura (`completa`, `parcial`, `sem_dados`, `desatualizada`) e estado de execução. Timestamp de consulta não é timestamp da atualização dos dados.
- Valores devem vir dos serviços, com moeda, unidades e denominadores corretos. Se um indicador não existir ou um dado faltar, dizer isso. Zero informado não é ausência; ausência não é zero. Não inventar motivo causal, preço ou resultado com base em correlação.
- Referências e links devem apontar às fontes realmente consultadas; não inventar rotas nem permitir URL arbitrária fornecida pelo modelo.
- Revalidar sessão, cargo e permissões antes da consulta e de cada retomada. O histórico pertence ao usuário autenticado, mesmo quando os dois usuários são administradores. Não reutilizar thread, resumo, cache ou resposta do outro usuário.
- No piloto individual, negar acesso ao Assistente para qualquer usuário diferente de Felipe, inclusive outro administrador; testar acesso direto às futuras APIs, não apenas visibilidade do menu. A propriedade das conversas continua obrigatória na futura ampliação.
- Dados corporativos autorizados podem ser comuns; mensagens e contexto não. Não importar conversas pessoais do ChatGPT nem usar a sessão de engenharia como memória do Assistente.
- Persistir histórico do chat não autoriza gravar pedidos, produtos, preços, configurações ou fiscal. Auditoria técnica deve registrar IDs, fontes, tempos, modelo e estado sanitizados, não prompt completo, resultado bruto ou raciocínio interno do modelo.

### Estados a materializar

| Estado | Comportamento esperado |
|---|---|
| `concluido` | Resposta com fontes e cobertura, sem afirmar execução operacional |
| `sem_dados` / `fonte_indisponivel` | Explicar o que faltou; não preencher com números presumidos |
| `autenticacao_necessaria` | Não inferir; orientar reconexão do titular sem expor credenciais |
| `acesso_negado` | Não consultar nem revelar existência/conteúdo de conversa alheia |
| `modelo_indisponivel` | Interromper sem troca automática de modelo |
| `limite_atingido` | Mostrar indisponibilidade e reinício informado, quando existir; sem compra/fallback |
| `ocupado` | Recusar nova execução concorrente acima da capacidade; sem misturar contexto |
| `tempo_esgotado` / `cancelado` | Encerrar execução e descartar saída tardia |
| `provedor_indisponivel` / `resposta_invalida` | Erro sanitizado; não transformar saída parcial/inválida em resposta confirmada |

O extrator atual não expõe todos esses estados individualmente: por exemplo, erro 429 é sanitizado como indisponibilidade. Esta tabela é requisito do futuro Assistente, não alegação de implementação já existente.

## 6. Critérios por ação

| Ação | Prova necessária |
|---|---|
| AI-00 | Contrato individual aprovado, login e modelo comprovados, limites e condições para dados/hospedagem explícitos; não exige chat pronto ou validação multiusuário |
| AI-01 | Consultas canônicas e perguntas de referência, primeiro sintéticas; controles da conta documentados antes de enviar dados operacionais; sem escritas operacionais, SQL livre ou fórmulas paralelas |
| AI-02 | Chat e histórico de Felipe; recusa dos demais usuários, acesso direto indevido, simultaneidade da mesma conta e revogação cobertos; runtime e smoke DEV comprovados antes de solicitar teste visual |
| AI-GATE — piloto | Precisão, permissões, quota/falhas/cancelamento, histórico individual e aprovação visual de Felipe após publicação; não encerra automaticamente o gate integral de lançamento |
| Liberação do sócio | Modalidade para os dois comprovada, acesso explicitamente autorizado, isolamento/contexto e simultaneidade testados e aceite de ambos; requisito separado preservado antes dessa liberação e do gate integral de lançamento |

Referências mínimas para a suíte futura: resultado de período vazio/com lucro pendente; venda com impedimento comprovado; preço estimado versus confirmado; documento antigo versus cânon atual; registro ausente; fonte stale; instrução maliciosa para revelar secrets; usuário revogado; acesso cruzado; duas solicitações concorrentes; cota esgotada; timeout com resposta tardia. Os oráculos são serviços/contratos existentes, não respostas previamente inventadas pela IA.

## 7. Registro do fechamento da AI-00 (histórico)

Entregues contrato individual, evidências e sequência de teste; a correção anterior para `gpt-6-astra/low` foi preservada. **AI-00 concluída para o piloto individual. Próxima ação: planejar AI-01 — Conhecimento e consultas.** AI-01/02/GATE não foram implementados, e o marco 3 continua aberto. A assinatura continua sendo a única modalidade escolhida; nenhuma pendência autoriza cobrança ou substituição de provedor. [Evidências deste fechamento](evidencias/BNT-AI-00-validacao.md#fechamento-individual).

Responsabilidades: o agente implementa e valida autenticação, hospedagem, consultas e isolamento; Felipe participa apenas quando necessário no login oficial/configuração da conta e avalia experiência e respostas depois da publicação. Não solicitar aceite de uma tela inexistente.

Sequência: **AI-00 individual → AI-01 → AI-02 → publicação DEV autorizada + smoke → teste de Felipe/AI-GATE do piloto**. A liberação do sócio permanece separada, sem eliminar os gates de produção. Uma ação validada por tarefa; não criar interface provisória nesta etapa nem avançar automaticamente para AI-01.

Rollback documental preserva a evidência histórica e o aceite humano já concedido. Se for necessário reverter o modelo do piloto, código e linha `model` do perfil local precisam continuar coerentes; o modelo anterior não constou do catálogo e sua restauração pode devolver a indisponibilidade. Não reverter automaticamente nem trocar o provedor. Sem migration ou efeito comercial a desfazer.

## 8. AI-01 — Conhecimento e consultas implementados

Entrega de 08/09/2026: `queryAssistantKnowledge(request, input)` é a única entrada de backend, ainda sem endpoint público. A AI-02 será responsável por traduzir perguntas em consultas permitidas e conectar os fatos à conversa; esta entrega não é um chat por linguagem natural.

Entrada validada por `assistantQuerySchema`, sem propriedades extras:

- `sales`: `period` = `today`, `7d` (padrão) ou `30d`, mesmos períodos do Dashboard;
- `order` / `invoice`: `record` com `by` = `id`, `sale` ou `pack`, e `value`;
- `purchase`: `dsliteId`;
- `product` / `inventory` / `pricing`: `record` com `by` = `id` ou `sku`, e `value`;
- `tax`: projeção da competência atual pelo serviço central;
- `documentation`: `topic` = `pricing`, `orders`, `inventory`, `settings`, `assistant` ou `pricing_history`.

Registros ambíguos retornam candidatos, não seleção automática. O ID da venda componente resolve sua unidade operacional consolidada; fiscal mostra as notas dos componentes, sem assumir uma única NF por Pack. As referências documentais são caminhos/seções verificadas, não novos endpoints web.

A saída acrescenta fatos tipados, referências, filtros, período, `queriedAt`, `sourceUpdatedAt` quando conhecido, ambiente, cobertura, avisos e marcador de amostra. `contentIsUntrusted=true` proíbe tratar conteúdo como instrução. Estados materiais desta etapa: `concluido`, `sem_dados`, `fonte_indisponivel`, `acesso_negado`, `entrada_invalida`, `esclarecimento_necessario`, `cancelado`, `tempo_esgotado`, `ambiente_bloqueado`. Os estados de provedor da seção 5 continuam para AI-02.

Guard: `BENTEVI_ASSISTANT_PILOT_USER_ID` deve conter o UUID do usuário administrativo Felipe. É configuração server-side, sem valor padrão e sem reaproveitar a variável da pesquisa de garantia. Sua ausência nega acesso. Sessão/permissão e cargo administrativo são revalidados antes de entregar a resposta. Configurar essa variável no runtime pertence à AI-02; nenhum arquivo de ambiente foi alterado aqui.

O endereço de serviço precisa usar o IP literal `192.168.1.162`; hostname indireto, `.160` ou destino externo são recusados antes das consultas. O cliente mantém service-role fora das saídas e aplica transporte restrito a tabelas do catálogo/GET e às três RPCs auditadas de leitura: faturamento mensal, estoque de liquidação e liquidações do produto. Qualquer falha fica registrada internamente para impedir que serviços tolerantes a erro devolvam sucesso incompleto. Bloqueios abortam a tentativa, sem retry do SDK.

Limites técnicos iniciais: 15 segundos, até 20 candidatos, 80 requests e 4 MiB de respostas por consulta. Paginação do resumo continua com 500 linhas, agora com desempate por ID. Truncamento inesperado de serviços legados não vira total completo. Logs contêm apenas tipo, estado, cobertura, duração e quantidade de fontes.

Pricing reutiliza a projeção do Detalhe do Produto, não inventa frete ou cotação ML. Pode retornar preço sugerido indisponível por ausência de evidência. Override/liquidação permanecem separados da economia e não autorizam execução. Projeção fiscal não é PGDAS apurado. Estoque usa saldo/capacidade canônicos: movimentos visuais estornados não são somados ao estoque real.

Consulta documental retorna trechos originais com SHA-256 do documento, seção, autoridade e situação. Auditorias antigas são históricas; documentos com planejamento/fotografia são mistos. Divergências de disponibilidade ou memória incompleta ficam explícitas; não se corrige regra comercial automaticamente. Sem vetor, embeddings, busca externa, leitura geral de arquivos ou modelo.

Validação local sintética concluída; banco DEV/produção não acessados. Não enviamos dados à OpenAI. Controles aplicáveis à conta, perfil/login exclusivos, empacotamento dos documentos e smoke autenticado permanecem requisitos da AI-02 antes do uso operacional. [Testes, riscos e rollback](evidencias/BNT-AI-01-validacao.md).

## 9. AI-02 — Interface e histórico implementados

Entrega local de 08/09/2026. `/assistente` usa o shell desktop Bentevi e Ant Design existentes. Menu após Dashboard; acesso exclusivo ao titular piloto no backend. Histórico lateral recolhível, busca por título, nova conversa, renomeação e exclusão; perguntas com Enter/Shift+Enter, fases de progresso e botão Parar. Respostas são texto simples, sem HTML executável. Fontes abrem em Drawer com cobertura, período, data consultada, atualização quando comprovada e indicação de amostras. Documentos exibem trecho/versionamento/autoridade, sem endpoint de arquivo arbitrário.

**Retenção escolhida:** manter o histórico até o usuário excluir. Exclusão remove conversa e mensagens do ERP; não promete apagar backups ou retenções do provedor. Não há cron de expurgo, busca vetorial, memória compartilhada ou resumo automático.

### Persistência e ciclo de uma pergunta

- Duas tabelas: `assistant_conversations` e `assistant_messages`, com chaves compostas de propriedade, RLS, índices e escrita somente pelo servidor. Migration `20260908190000_assistant_history` aplicada e registrada no Supabase DEV `.162` após ensaio com rollback. Tipos das tabelas atualizados a partir das colunas efetivas do DEV; não houve regeneração completa do schema.
- Identidade obtida da sessão/permissão, piloto server-side e cargo atual. Outro administrador não ganha acesso. Não aceitar autoridade, SQL, caminho, modelo ou provedor enviados pelo cliente/modelo.
- Claim atômico por usuário/request; reenvio igual retorna o estado existente, corpo diferente conflita. Apenas uma execução ativa por usuário, mesmo entre processos, com lease de 120 segundos. Nova conversa não contorna a exclusão mútua.
- Cancelamento sinaliza a mensagem e interrompe o processo quando local; entre instâncias é observado nos checkpoints e no deadline. Persistência final condicional descarta saída tardia/cancelada e não recria registros excluídos. Exclusão de conversa ativa exige interromper/encerrar primeiro.
- Histórico enviado ao planejador: até oito pares concluídos e 24 mil caracteres, nunca o histórico completo. Cada modelo usa thread efêmera própria; dados anteriores ajudam a interpretar o pedido, não substituem consulta atual.
- No máximo duas chamadas estruturadas por pergunta: planejar até três consultas AI-01 e redigir resposta fundamentada. Esclarecimento ou resultado inteiramente sem dados dispensam a segunda chamada. Sem retry, provider fallback, operações comerciais, ferramentas, web search ou acesso arbitrário a arquivos.
- Fatos numéricos entram por placeholders resolvidos/formatados no servidor; a resposta não pode inventar número ou fonte. Cada consulta usada exige referência correspondente. Isso não prova precisão semântica integral: conferir respostas reais no AI-GATE.
- Logs registram request, modelo, estado e falha de persistência, sem conteúdo, credencial ou raciocínio. Identificadores conhecidos de secrets/dados pessoais são recusados antes da persistência/inferência; não é uma promessa de DLP universal.

### Runtime e disponibilidade real

O transporte App Server foi consolidado em `codex-json-transport.ts`. O extrator individual de garantia que originou o aprendizado técnico foi aposentado em 12/09/2026 e não participa mais do runtime. Não foi introduzido outro provedor. O chat exige conta `chatgpt`, modelo exato e esforço `low`, verifica limites publicados e recusa ações/ferramentas. Cota ausente não é tratada como ilimitada; erro de uso continua explícito, sem compra de créditos.

`nixpacks.toml` prepara instalação do Codex `0.153.4`. O perfil persistente do Assistente deve ser separado do perfil de engenharia e do perfil de garantia, com workspace vazio, configuração canônica e login oficial do titular. Não copiar `auth.json` de engenharia. A imagem não contém credenciais.

Configuração somente server-side:

- `BENTEVI_ASSISTANT_ENABLED`: habilitação explícita do piloto;
- `BENTEVI_ASSISTANT_PILOT_USER_ID`: identidade autorizada;
- `BENTEVI_ASSISTANT_CODEX_HOME`: diretório absoluto terminado em `assistant-codex`, fora do Git, com `config.toml` canônico e `workspace/`;
- `BENTEVI_ASSISTANT_DATA_APPROVED`: manter `0` até confirmar os controles da conta exigidos na seção 3. Não inferir essa confirmação a partir da existência de uma assinatura.

Perfil local preparado com diretórios `700`/config `600`, sem login copiado. Histórico/API autenticados testados localmente; inferência real do chat e instalação/persistência no Easypanel não comprovadas. Login oficial, controles da conta, publicação autorizada e smoke DEV continuam pendentes; **AI-GATE não foi iniciado**. [Evidências, roteiro de ativação e rollback](evidencias/BNT-AI-02-validacao.md).
