# BNT-AI-00 — Evidências do contrato e avaliação do provedor

**Data:** 08/09/2026. **Base inspecionada:** `5c7f28a1a6132618c724078b040e6b1b6877ebf9`.
**Ambiente:** worktree `vortek-dev`, branch `dev`. A avaliação original começou com árvore limpa; o fechamento posterior preservou as alterações locais acumuladas.
**Resultado vigente:** **AI-00 concluída para o piloto individual de Felipe**. Somente assinatura ChatGPT e `gpt-6-astra/low`. Próxima ação: planejar AI-01. Chat, hospedagem e liberação do sócio não foram entregues. [Fechamento aprovado e validação](#fechamento-individual).

**Histórico — modelo definido pelo usuário:** `gpt-6-astra/low` aplicado ao piloto e validado com inferência real em 08/09. A adequação compartilhada ficou pendente nessa avaliação e depois foi separada do contrato individual por decisão explícita. A fotografia inicial abaixo preserva a falha anterior de `gpt-5.4-mini`; [mudança e provas do modelo](#gpt-6-astra).

## Entrega documental inicial

- Criado o [contrato canônico do Assistente](../VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md), com limites, consultas, fontes, isolamento, estados e aceites por ação.
- Registrado o aceite inicial de Configurações concedido pelo usuário: marco 2 encerrado no recorte inicial; D20/V2-15 integrais continuam abertos.
- Atualizadas referências e próxima ação do checklist, sem implementar AI-01/02/GATE, chat, schema, API, dependência ou infraestrutura.

## Inspeção inicial e causa do impedimento anterior

Inspecionados `warranty-codex.ts`, fluxo/testes de garantia, guard administrativo, contexto de pricing, Dashboard e projeção de pedidos. O piloto exige um usuário local autorizado e `NODE_ENV=development`; não é um backend compartilhado já pronto. A rota de pedidos contém reconciliação com persistência; não foi invocada como leitura do Assistente.

Versões executadas: Node `22.23.1`, Codex CLI `0.153.4`; Next instalado `16.3.3`. Perfil estrito existente preservado; nenhum arquivo de autenticação foi exibido ou copiado.

**Esperado:** reconfirmar a extração individual com `gpt-5.4-mini/low`, validada em 07/09.
**Na avaliação inicial:** o teste LIVE terminou com `warranty_codex_model_unavailable` no preflight de `model/list`, antes de `thread/start` e `turn/start`.
**Causa comprovada:** o catálogo retornado ao perfil autenticado não contém o modelo fixado. Não é ausência de login nem falha na validação do JSON gerado; não houve geração nesta tentativa. Não foi determinada a causa da mudança do catálogo no provedor, nem inferida retirada global do modelo.

Diagnóstico complementar sanitizado, via mesmo App Server/perfil, somente métodos de conta/modelos/limites:

- `account/read`, sem refresh forçado: `account.type=chatgpt`.
- `model/list`, `limit=100`, `includeHidden=false`: uma página completa, sem cursor; `gpt-5.4-mini` ausente.
- `model/list`, `includeHidden=true`: uma página completa, sem cursor; modelo também ausente. Não é omissão por paginação ou modelo oculto.
- O catálogo visível retornou `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-daybreak-blue-latest`, `gpt-5.5` e `gpt-5.3-codex-spark`. Nenhum foi selecionado ou usado como substituto.
- `account/rateLimits/read`: janela primária de `10080` minutos, `usedPercent=31`, `resetsAt=1789435338`; janela secundária ausente e nenhum limite atingido informado. É fotografia transitória, não franquia garantida nem capacidade do futuro chat. Nenhum identificador pessoal, saldo financeiro ou token foi registrado.

Uma primeira tentativa do diagnóstico auxiliar encerrou localmente por dependência não informada ao carregador de testes; foi corrigida antes de iniciar o App Server. Não gerou chamada ao modelo nem alteração no projeto.

## Validação inicial — anterior à escolha do Astra

| Verificação | Resultado desta ação |
|---|---|
| Testes direcionados existentes | 52 casos: **51 aprovados**, 1 LIVE omitido por padrão, zero falhas |
| LIVE individual com conteúdo sintético | **Falhou** no preflight por modelo indisponível; uma tentativa, sem inferência ou fallback |
| Diagnóstico de conta/modelos/limites | Autenticação ChatGPT confirmada; catálogo completo sem modelo solicitado; consulta de quota respondeu |
| `npm run validate` | Lint e typecheck aprovados |
| Documentação e Git | Links locais novos/alterados e respectivos anchors conferidos; `git diff --check` e whitespace dos arquivos novos aprovados; nenhuma etapa futura marcada como concluída |
| Build/homologação visual | Não executados nesta ação documental; não houve mudança executável nem nova tela |

```bash
node --test tests/warranty-codex.test.js tests/product-warranty.test.js
NODE_ENV=development WARRANTY_CODEX_LIVE_TEST=1 node --env-file=.env.local --test --test-name-pattern='LIVE:' tests/warranty-codex.test.js
npm run validate
```

As regressões cobrem recusa de API key, usuário indevido, ambiente production, ferramentas proibidas, timeout/cancelamento, concorrência, isolamento de extrações, protocolo e saída inválidos, além de validação canônica de garantia. 401/429 são simulados; não foi revogada sessão nem esgotada cota real. Esses testes não comprovam duas sessões reais de chat, histórico no ERP ou respostas sobre a operação.

Não foi criado teste redundante para documentação nem alterada a expectativa do teste LIVE para esconder a indisponibilidade. Evidência de 07/09 permanece histórica e não é reapresentada como sucesso de hoje.

## Contratos externos conferidos

Consultados em 08/09/2026:

- [Autenticação](https://learn.chatgpt.com/docs/auth): assinatura versus API, cache/renovação e políticas aplicáveis à modalidade.
- [App Server](https://learn.chatgpt.com/docs/app-server): stdio, autenticação, modelos, limites e permissões experimentais. A ressalva sobre suporte produtivo aparece na seção de host remoto; não foi usada para inventar uma proibição universal do stdio.
- [Planos e limites](https://learn.chatgpt.com/docs/pricing): franquia compartilhada/variável, sem equiparar assinatura a API ou a uso ilimitado.
- [Contas de serviço](https://learn.chatgpt.com/docs/enterprise/service-accounts): modalidade compartilhada documentada exige pay-as-you-go; não demonstra adequação de um Pro pessoal ao serviço para dois operadores.
- [Segurança e privacidade locais](https://learn.chatgpt.com/docs/agent-approvals-security#security-and-privacy-guidance): minimizar telemetria e distinguir histórico local de retenção externa. Não foi comprovada a configuração efetiva de retenção/treinamento desta conta para dados operacionais.

<a id="pendencias-para-fechar-ai-00"></a>

## Pendências do recorte original — encaminhamento atual

1. **Modelo do piloto — RESOLVIDO:** usuário definiu `gpt-6-astra`; código, perfil local, testes e contrato alinhados, preservando `low`. Dois cenários de inferência real passaram usando a assinatura. [Provas](#gpt-6-astra).
2. **Uso compartilhado — PENDENTE, fora do fechamento individual:** comprovar modalidade aplicável aos dois antes de liberar o sócio e encerrar o gate integral de lançamento. A decisão “Individual primeiro” não aprova esse uso. O agente é responsável por reunir evidência técnica e oficial; participação do titular só quando indispensável para acesso/configuração da conta. Nenhuma contratação ou contato externo foi efetuado.
3. **Hospedagem — ENTREGA AI-02:** preparar runtime/perfil/login e comprovar smoke DEV antes de pedir teste visual. Não considerar o piloto local como deploy.
4. **Dados operacionais — CONDIÇÃO AI-01:** começar com casos sintéticos e documentar controles aplicáveis à conta antes de enviar dados operacionais ao provedor; retenção do histórico do ERP será definida em AI-02.

Uma comprovação de login não resolve uso compartilhado ou privacidade. Pelo [recorte individual aprovado](#fechamento-individual), esses requisitos têm responsáveis e etapas próprios, sem manter AI-00 indefinidamente aberta. Mantida a decisão **somente assinatura**, sem API paga como plano alternativo. AI-01/02/GATE não foram iniciados; AI-01 está liberada para planejamento.

## Limites da entrega documental inicial

Sem consulta ou escrita em Supabase/PostgreSQL, migration, acesso ao Easypanel, alteração de produção, chamada comercial ML, configuração de cobrança, commit, push ou deploy. A única interação autenticada externa foi o preflight/diagnóstico do piloto, sem inferência. `AGENTS.md`, `.rules`, `.gitignore`, código, testes, dependências e perfil de autenticação preservados.

Na entrega inicial, o rollback era somente documental e o checklist mantinha AI-00 aberta. O fechamento posterior abaixo preserva essa fotografia, o aceite humano de Configurações e o histórico do piloto.

<a id="gpt-6-astra"></a>

## Correção autorizada — gpt-6-astra — 08/09/2026

O usuário definiu explicitamente o novo modelo. Preservadas as nove alterações documentais preexistentes, a branch `dev` e o HEAD `5c7f28a1`.

### Mudança mínima

- `src/services/warranty-codex.ts`: modelo `gpt-6-astra`; o texto do perfil passa a derivar da mesma constante, evitando divergência entre configuração, preflight, thread e turno.
- `/home/felipe/.config/vortek-dev/warranty-codex/config.toml`: somente a linha `model` alterada, arquivo mantido em 0600. Perfil conferido contra o texto exportado pelo serviço e contra a versão anterior; nenhuma outra opção mudou. Não foi necessário renovar/copiar o login.
- `tests/warranty-codex.test.js`: modelo exato conferido nos três pontos; regressões adicionais para catálogo com apenas modelo antigo, Astra sem esforço `low` e thread devolvida com outro modelo. Todos impedem inferência, sem fallback.
- Prompt, schema de saída, validação comercial de garantia, limite de 45 segundos, isolamento individual, ferramentas desabilitadas e autenticação ChatGPT preservados. Nenhum outro consumidor OpenRouter foi migrado.

### Ajuste comprovado da amostra LIVE

A primeira tentativa com Astra chegou à inferência, mas retornou zero evidências onde o teste esperava uma. A página sintética afirmava garantia de 12 meses e em seguida dizia que não era uma garantia comercial real. Diagnóstico controlado manteve produto, URL, prompt e modelo: com a ressalva, saída vazia; removendo somente a ressalva contraditória, uma evidência literal de 12 meses no Brasil.

Corrigida a amostra positiva, sem enfraquecer o validador ou forçar prazo no prompt. O texto original foi preservado como **caso negativo** e agora precisa retornar zero evidências. Ambos continuam sintéticos, sob domínio `example.com`, sem coleta externa ou uso comercial. A comparação sustenta o ajuste do teste; não pretende provar como o modelo raciocinou internamente.

### Validações da correção

| Verificação | Resultado |
|---|---|
| Regressão direcionada | 56 casos: **54 aprovados**, 2 LIVE omitidos por padrão, zero falhas |
| LIVE — declaração explícita | Uma evidência canônica de 12 meses no Brasil, não revisada, em **6.165 ms** |
| LIVE — declaração negada pela própria fonte | Zero evidências, em **4.630 ms** |
| Autenticação/modelo/perfil | Os dois LIVE atravessaram os guards reais de `chatgpt`, catálogo `gpt-6-astra/low`, modelo efetivo, thread efêmera e perfil restrito |
| `npm run validate` | Lint e typecheck aprovados |
| Build/deploy | Não executados: troca de identificador/configuração local, sem alteração de bundling, UI ou infraestrutura |

Comandos de regressão e LIVE mantidos na seção anterior. Foram cinco inferências sintéticas nesta correção: a tentativa inicial com expectativa incorreta, dois diagnósticos controlados e os dois cenários finais aprovados. Não confundir esses diagnósticos com retries automáticos ou ocultar a primeira falha.

### Fontes e limites

Conferidos [guia de migração GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model#migration-quickstart) e [modelo exato](https://developers.openai.com/api/docs/models/gpt-6-astra): esforço `low` mantido, sem introduzir parâmetros incompatíveis. O transporte continua sendo o [App Server](https://learn.chatgpt.com/docs/app-server), não uma nova chamada à API paga. Guia local Next 16.3.3 de Server/Client Components, seção de isolamento `server-only`, consultado; fronteira existente preservada.

Sem banco, migrations, chamadas comerciais, Easypanel, commit, push ou deploy. `AGENTS.md`, `.rules`, `.gitignore`, dependências e credenciais preservados. A inferência usa a cota da assinatura; não foi alterada configuração de cobrança ou contratado outro serviço.

**A troca e a validação individual do modelo estão concluídas.** Não comprovam uso compartilhado/hospedado nem resolvem automaticamente a pendência 2. Para rollback do piloto, código e linha de modelo do perfil devem ser revertidos juntos e revalidados; o identificador anterior estava indisponível, portanto não prometer recuperação apenas por restaurá-lo.

<a id="fechamento-individual"></a>

## Fechamento individual aprovado — 08/09/2026

**Decisão:** ao ser consultado sobre o primeiro teste, o usuário escolheu “Individual primeiro” e aprovou a implementação do plano. O piloto do Assistente atenderá somente Felipe; a liberação do sócio permanece separada. Não é uma homologação retroativa de modalidade compartilhada, de dados operacionais ou de produção.

**Causa da confusão:** o checklist condicionava a continuação do contrato individual à validação multiusuário e não separava comprovação técnica de teste visual. O código existente é um extrator de garantia local, restrito por usuário e `NODE_ENV=development`; não existe chat publicado. O `nixpacks.toml` não declara instalação do Codex. O usuário não tinha uma tela do Assistente para aprovar.

### Mudança documental

- Contrato e checklist agora fecham AI-00 somente no recorte individual e liberam **planejar AI-01 — Conhecimento e consultas**.
- Dados/consultas ficam em AI-01; chat, histórico, runtime e publicação DEV em AI-02; teste visual é solicitado somente após smoke da aplicação publicada.
- Modalidade e isolamento dos dois continuam pendentes antes da liberação do sócio e do gate integral. Os demais gates de lançamento, aceite inicial D20 e restrição de produção foram preservados.
- O agente responde por autenticação, tratamento de dados, hospedagem e validações técnicas. Felipe participa no login/configuração da conta quando indispensável e avalia experiência e respostas após a entrega.
- Requisitos de hospedagem registrados no [contrato](../VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md#hospedagem-do-piloto--requisitos-para-a-publicação-da-ai-02), sem instalar binário, criar serviço ou mover credenciais nesta tarefa.

### Validação deste fechamento

| Verificação | Resultado |
|---|---|
| `node --test tests/warranty-codex.test.js tests/product-warranty.test.js` | **54 aprovados**, 2 LIVE omitidos por padrão, zero falhas; 2.006 ms |
| `npm run validate` | Lint e typecheck aprovados |
| Documentação | 13 referências locais conferidas (novas e documentos do contrato/evidência), incluindo anchors; whitespace e `git diff --check` aprovados; AI-01/02/GATE continuam desmarcados |
| Preservação | Comparação SHA-256 com o início desta tarefa: código/testes anteriores, `AGENTS.md`, `nixpacks.toml`, `package.json` e perfil local de configuração sem mudança; HEAD mantido |
| Inferência real | Não repetida; duas provas anteriores com Astra preservadas, sem mudança de modelo/perfil/autenticação nesta tarefa |
| Build/deploy | Não executados; entrega documental, chat e runtime hospedado ainda não implementados |

Reconferidas a documentação de [autenticação remota](https://learn.chatgpt.com/docs/auth#login-on-headless-devices), o [transporte App Server](https://learn.chatgpt.com/docs/app-server#protocol) e a distinção de [contas de serviço](https://learn.chatgpt.com/docs/enterprise/service-accounts). Login remoto documentado não é prova de implantação, e contas de serviço não foram transformadas em exigência para o piloto individual.

**Resultado:** AI-00 concluída para o piloto individual. AI-01/02/GATE não implementados; nenhuma solicitação de aceite visual nesta etapa. Branch `dev`, HEAD `5c7f28a1`, alterações locais anteriores preservadas. Sem mudança funcional, banco, migrations, infraestrutura, autenticação, cobrança, commit, push ou deploy. Rollback desta entrega é exclusivamente documental e não desfaz a escolha de modelo nem os aceites anteriores.
