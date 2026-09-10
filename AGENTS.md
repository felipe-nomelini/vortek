# Vortek / Bentevi — Instruções do projeto DEV

Última revisão: 2026-09-09.

Este repositório é exclusivo de desenvolvimento e homologação. Estas regras se aplicam a análises, planos, implementação, validação, Git e operações de infraestrutura.

## 1. Autoridade e escopo

Restrições de plataforma, segurança e execução prevalecem. Dentro desses limites, siga o pedido explícito atual do usuário, este `AGENTS.md` e a documentação específica da tarefa, nessa ordem. Skills e instruções complementares não ampliam autorizações nem substituem as restrições deste projeto.

O código, schema, configuração e testes atuais demonstram o comportamento implementado; documentos vigentes definem o comportamento pretendido. Havendo divergência, investigue e relate, sem assumir que uma implementação incorreta substitui o contrato. Auditorias e evidências históricas não comprovam o estado atual.

- Diferencie análise, planejamento e implementação. Um pedido de diagnóstico não autoriza corrigir; quando implementar foi solicitado, execute o trabalho seguro dentro do escopo.
- Trabalhe somente na branch `dev`. Confira a branch e o estado do Git antes de editar; se estiver em outra branch, pare e informe, sem trocar automaticamente.
- `main` é o sistema legado preservado, retirado do tráfego na virada de 2026-09-09; `dev` é a linha de desenvolvimento da nova versão Bentevi. A divergência entre as branches é intencional e sua contagem de commits não mede prontidão.
- Não misture os históricos: nenhum merge, rebase ou cherry-pick em massa entre `main` e `dev`. Use `main` somente como evidência de leitura para identificar comportamentos produtivos essenciais; quando um deles ainda for necessário, implemente-o nativamente na arquitetura de `dev`, em ação própria e com testes.
- Não altere produção, não use `app.bentevi.shop` nem `app.vortek.shop` para testes e não leve mudanças de `dev` ao sistema legado durante o desenvolvimento.
- Uma solicitação de mudança não autoriza automaticamente commit, push, deploy ou operações externas de outro escopo.
- Preserve alterações preexistentes do usuário. Não acrescente correções, refatorações ou mudanças de regra de negócio fora da tarefa.
- Uma ação técnica do Item 17 por tarefa; não avance para outra etapa sem validação e sem respeitar os gates e aceites vigentes.

## 2. Ambientes e Supabase — proteção obrigatória

O Supabase do projeto é **self-hosted**, não Supabase Cloud. Não exija project refs, tokens pessoais, dashboard ou autenticação MCP do Supabase Cloud para operar este ambiente.

| Recurso | Destino | Permissão neste projeto |
|---|---|---|
| Supabase de produção Bentevi | `supabase.bentevi.shop` → `192.168.1.162` | Exclusivamente leitura neste repositório DEV; foi reclassificado no corte de 2026-09-09 |
| Supabase DEV local | `127.0.0.1`, projeto `bentevi-dev-local` | Escritas locais autorizadas somente com dados sintéticos e `VORTEK_RUNTIME_ENVIRONMENT=local_dev` |
| Supabase legado | `192.168.1.160` | Exclusivamente leitura para consultas e diagnósticos necessários |
| Web de homologação anterior | `dev.bentevi.shop`, serviço `local/vortek-erp-dev` no Easypanel `.160` | Serviço desabilitado após a virada; não reativar nem publicar sem recriar um destino DEV independente |
| App produtivo Bentevi | `app.bentevi.shop`, serviço `local/bentevi-prod` no Easypanel `.160` | Produção ativa na branch `bentevi-prod`; `app.vortek.shop` redireciona permanentemente para este domínio; não alterar nem usar para testes a partir deste repositório DEV |

A hospedagem da aplicação DEV em `.160` **não** torna o Supabase desse servidor um banco de desenvolvimento. Nomes de containers, diretórios, labels, URLs ou variáveis contendo `dev` não mudam essa classificação.

A virada de 2026-09-09 reaproveitou `.162` como produção Bentevi e desabilitou os serviços web legado e DEV. O novo DEV remoto no `PCBAO` ainda não foi ativado; até que isso ocorra em tarefa própria, o único destino gravável deste repositório é `bentevi-dev-local`, estritamente em loopback e com dados sintéticos. O hostname canônico da API produtiva é `supabase.bentevi.shop`; o hostname histórico `supabase-dev.vortek.shop` ainda pode resolver para `.162` apenas por compatibilidade, mas o nome não muda sua classificação produtiva nem autoriza escrita.

### Produção é somente leitura

Nunca execute no Supabase de produção alterações de dados, migrations, DDL, funções/RPC com efeitos de escrita, triggers, grants, RLS, Auth, Storage, secrets, configurações ou operações administrativas mutantes. Ensaiar uma alteração com `ROLLBACK` também não é permitido em produção.

Para consultas e diagnósticos, confirme o destino e use acesso somente leitura quando disponível. Não presuma que uma RPC ou chamada HTTP seja inofensiva pelo nome ou método: confira seus efeitos antes de executá-la.

Se uma solicitação exigir alteração em produção, interrompa essa parte e informe que deve ser tratada em tarefa própria no ambiente dedicado de produção. Isso não autoriza este agente a abrir outro workspace ou executar a alteração por outro caminho.

### Antes de qualquer escrita no DEV

1. Confirme que a escrita é necessária e está no escopo autorizado.
2. Resolva e confira o destino real da conexão, inclusive quando houver proxy ou túnel; registre apenas host/identidade, sem credenciais.
3. Comprove que o destino é o projeto local `bentevi-dev-local`, resolvido exclusivamente para loopback, com `VORTEK_RUNTIME_ENVIRONMENT=local_dev`. Não use `.162` como DEV: ele é produção Bentevi.
4. Inspecione o histórico de migrations e o schema afetado nesse mesmo destino; confira dados, consumidores, RLS, grants, funções, triggers e constraints pertinentes.
5. Para mudanças destrutivas, defina backup, recuperação, compatibilidade e efeitos externos; ensaie com rollback quando aplicável, somente no DEV.
6. Interrompa se o destino for `.160` ou `.162`, se o ambiente local não estiver restrito a loopback ou se a identidade não puder ser comprovada.

Antes de solicitar credenciais ausentes, confira a configuração local ou do servidor já autorizada, sem imprimir seus valores. Não adote caminhos de configuração de produção como padrão do DEV.

Confira o chamador e suas permissões em mudanças de segurança. Nunca desabilite RLS globalmente para contornar erros nem exponha credenciais privilegiadas ao cliente. Consulte a documentação oficial da funcionalidade Supabase/PostgreSQL envolvida, respeitando as diferenças do self-hosted.

## 3. Fontes e roteiro de desenvolvimento

Para tarefas da nova versão ou do Item 17, consulte primeiro o [checklist de execução](docs/reestruturacao-vortek/VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md), especialmente o recorte **Bentevi em operação**, os gates, dependências e aceites aplicáveis. Não copie status transitórios para este arquivo nem confunda implementação, publicação DEV e aceite de produção.

Leia somente as referências pertinentes:

| Assunto | Referência |
|---|---|
| Contexto de engenharia | [Instruções complementares](docs/reestruturacao-vortek/INSTRUCOES_AGENTE_VORTEK.md), subordinadas a este arquivo |
| Etapas e achados do Item 17 | [Plano de execução e homologação](docs/reestruturacao-vortek/VORTEK_ITEM_17_PLANO_COMPLETO_EXECUCAO_HOMOLOGACAO.md), [consolidação do Item 16](docs/reestruturacao-vortek/VORTEK_AUDITORIA_ITEM_16_CONSOLIDACAO.md) e auditoria do domínio identificado |
| Redesign e páginas Bentevi | [Plano de redesign](docs/reestruturacao-vortek/VORTEK_BENTEVI_PLANO_REDESIGN_COMPLETO.md) |
| Configurações Bentevi | [Dossiê de configurações](docs/reestruturacao-vortek/VORTEK_BENTEVI_CONFIGURACOES_DOSSIE.md) |
| Regras comerciais e Pricing/M2M | [Cânon comercial](docs/reestruturacao-vortek/VORTEK_CANON_COMERCIAL_V1.md), [ordem canônica](docs/reestruturacao-vortek/VORTEK_M2M_ORDEM_CANONICA_PRICING_RADAR.md), [plano Pricing V2](docs/reestruturacao-vortek/VORTEK_BENTEVI_PRICING_V2_PLANO.md) e [dossiê Pricing V2](docs/reestruturacao-vortek/VORTEK_BENTEVI_PRICING_V2_DOSSIE.md) |
| Assistente Bentevi | [Contrato do Assistente](docs/reestruturacao-vortek/VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md) e evidências da ação no checklist |
| Anúncios Mercado Livre | [Publicação operacional](docs/mercado-livre-publicacao-operacional.md), obrigatória antes de criar, alterar, reparar, validar ou diagnosticar anúncios |
| Deploy DEV | [Procedimento Easypanel](docs/easypanel-deploys.md) |

Atualize o checklist somente com evidência real e quando pertinente à tarefa. Não marque como concluído algo apenas planejado, parcialmente testado ou sem o aceite necessário; risco aceito não é risco eliminado.

## 4. Investigar e implementar

1. Inspecione os arquivos e consumidores relacionados; confirme versões e configuração quando influírem na decisão.
2. Para comportamento dependente de tecnologia externa, leia a documentação oficial atual da funcionalidade e versão pertinentes. Não basta a página inicial. Se insuficiente, consulte código/SDK, changelog ou schema oficial; só então fontes secundárias, distinguindo inferência de fato.
3. Em bugs, identifique comportamento esperado, observado, ponto de divergência e causa com evidências. Se a causa não puder ser confirmada, explicite a limitação.
4. Escolha a menor solução correta: corrigir, remover, reutilizar ou consolidar antes de acrescentar mecanismos.
5. Implemente apenas o necessário e valide o comportamento afetado.

Não esconda erros, duplique fontes de verdade ou introduza fallbacks, fluxos paralelos, wrappers, dependências, caches, retries ou jobs sem necessidade demonstrada. Mitigações temporárias precisam de motivo explícito quando a causa não puder ser corrigida com segurança; não as apresente como solução definitiva.

Nas integrações, confira autenticação, contratos, estados, paginação, limites e efeitos externos relevantes. Não invente atributos ou especificações de produtos. Use contas/ambientes de teste ou mantenha integrações desabilitadas; credenciais produtivas não devem alimentar a aplicação de homologação. Leituras diagnósticas de produção seguem exclusivamente a seção 2, sem copiar credenciais para o DEV.

Em jobs, webhooks e sincronizações, verifique idempotência, duplicação, concorrência, falhas parciais, reprocessamento e eventos fora de ordem. Não use atrasos arbitrários ou reparos periódicos para encobrir uma transição determinística incorreta. Otimize somente com evidência de custo ou latência.

## 5. Arquitetura e validação

A aplicação web está na raiz: Next.js App Router, React, TypeScript, Ant Design, Supabase e Zod. `mobile/` é uma aplicação separada Expo/React Native, com dependências próprias, incluindo TanStack Query. Não transporte padrões ou dependências entre web e mobile sem verificar os manifests e o código.

- Confirme runtime e versões em `package.json`, lockfiles e configuração; o requisito atual de Node da raiz é `>=22 <23`.
- Preserve a consistência dos manifests e lockfiles; não atualize dependências incidentalmente.
- Em mudanças de Next.js, leia o guia pertinente em `node_modules/next/dist/docs/`; se indisponível, consulte a documentação oficial da versão instalada. Confira mudanças de contrato e avisos de depreciação.
- `@openai/codex` também é dependência de runtime do Assistente, não apenas ferramenta do editor. Não remova dependências pela aparência ou pelo nome.
- O login web autentica pela rota same-origin `POST /api/auth/login`; não volte a acoplar a página de login ao cliente Supabase do navegador. A aplicação produtiva deve resolver o Supabase server-side por `SUPABASE_SERVICE_URL`, mantendo chaves privilegiadas fora do bundle público.

### Validação proporcional

| Mudança | Verificação |
|---|---|
| Código web | Testes direcionados existentes e `npm run validate` na raiz; acrescentar regressão quando necessário |
| Build, framework ou configuração sensível | Acrescentar `npm run build` e verificações de secrets pertinentes |
| Mobile | `npm run typecheck` dentro de `mobile/`; `npm run doctor` quando dependências/configuração exigirem |
| Banco ou integração | Contrato e comportamento afetado, com mocks ou ambiente autorizado e preflight antes de qualquer escrita |
| Instruções ou documentação sem consumo em runtime | Revisar referências, consistência e `git diff --check`; não executar build ou banco sem necessidade |
| Documento consumido em runtime | Conferir consumidores e executar testes correspondentes |

`npm run validate` executa lint e typecheck. A configuração atual do Next.js usa `typescript.ignoreBuildErrors: true`: **build aprovado não substitui checagem de tipos**.

Confira os scripts antes de executá-los: fixtures, reparos, backfills, smoke tests e testes de integração podem escrever no banco ou afetar serviços externos. `--dry-run` no nome não dispensa inspeção de efeitos. Não habilite `RUN_VORTEK_DEV_DB_TESTS=1` sem que o teste com escrita esteja no escopo e o destino DEV esteja comprovado. Não execute comandos de aplicação de dados como validação automática.

Compare resultados anteriores e posteriores quando houver falhas preexistentes. Relate falhas, testes ignorados e verificações não executadas; não suprima testes, aceite regressões silenciosamente ou declare toda a suíte aprovada por terem passado apenas os testes direcionados. Registre evidências na documentação da tarefa, sem congelar contagens de falhas neste arquivo.

## 6. Limpeza, segurança e preservação

- Antes de remover ou mover arquivos, procure imports, scripts, configuração, links, consumidores de runtime e testes. Ausência de import não prova que um arquivo é inútil.
- Documentos em `docs/` podem ser entradas da aplicação: `src/services/assistant-documents.ts` depende de caminhos e títulos exatos. Alterar essas referências exige verificar o contrato e os testes; não renomeie nem remova seções como simples limpeza.
- Preserve migrations, código web/mobile, documentação operacional e evidências necessárias aos gates e à recuperação. Não remova histórico apenas por ser antigo.
- Artefatos regeneráveis de build, caches, logs e relatórios descartáveis devem ficar fora do Git, respeitando as exceções atuais de `.gitignore`. Remoções materiais precisam estar no escopo; informe o que foi removido e como recuperar, quando possível.
- Nunca exponha ou versione passwords, tokens, cookies, chaves privadas, service-role, webhooks completos ou valores sensíveis de ambiente. Inspecione somente a configuração autorizada e necessária, sem reproduzir secrets em saída, código ou relatório.
- Se encontrar um secret versionado, não o reproduza; informe a exposição e a necessidade de rotação. Remova-o da fonte ativa quando autorizado e pertinente; não reescreva histórico nem altere secrets de produção por conta própria.

## 7. Git, homologação e release

Use o repositório local existente. Não crie clones auxiliares, worktrees ou checkouts paralelos sem pedido explícito ou sem demonstrar que o diretório atual é inutilizável.

- Não descarte nem sobrescreva alterações alheias. Stage e commit somente quando solicitados e somente dos arquivos da tarefa; push exige solicitação própria ou inclusão explícita no pedido.
- Não use reset/checkout destrutivo, reescrita de histórico ou force push sem necessidade e autorização explícita.
- Não publique trabalho alheio apenas para obter uma árvore limpa.
- `npm run sync:main` não é o fluxo deste ambiente DEV; não troque para `main` para satisfazer o script.

### Modelo de branches — decisão permanente

- `main`: código legado do Vortek, preservado e independente após ter sido retirado do tráfego na virada do Bentevi.
- `dev`: fonte integrada da nova versão Bentevi e do ambiente de homologação.
- `bentevi-prod`: branch produtiva do Bentevi, criada diretamente no SHA aprovado de `dev` e sem integração com `main`. Na primeira virada, `dev` e `bentevi-prod` apontavam para `f4fb50c6081cae461857e1ddee514a15b5bc87f9`; promoções posteriores exigem nova autorização e snapshot validado.

`bentevi-prod` não nasceu de merge com `main`, não recebe o diff entre as duas branches e não inclui código legado por ancestralidade. Comparações com `main` servem somente para auditoria comportamental e de schema. Cada promoção deve revisar o snapshot de `dev` por si mesmo e comprovar que regras produtivas essenciais receberam um destino explícito no Bentevi.

Fluxo de publicação deste projeto: **código validado em `dev` → commit/push autorizados → deploy no serviço de homologação → conferência do resultado**.

Para deploy DEV solicitado, siga o procedimento Easypanel somente depois que existir novamente um serviço e banco DEV independentes. Confirme branch `dev`, commits pretendidos disponíveis no remoto e o destino expressamente autorizado. A configuração anterior de `vortek-erp-dev` está desabilitada e não deve ser tratada como homologação disponível. O script assume `main` na ausência de configuração explícita; esse padrão não autoriza produção. Não use `--skip-git-check` para contornar verificações.

O webhook vem da configuração privada, nunca de documentação ou código versionado. Não edite arquivos dentro do container nem use deploy direto por Docker como procedimento normal. Aceite HTTP do webhook não comprova build, implantação ou validação funcional; confira o resultado no nível aplicável.

O App Service `local/bentevi-prod` está ativo em produção, associado exclusivamente à branch `bentevi-prod` e ao domínio canônico `app.bentevi.shop`. Na Cloudflare, `app.vortek.shop` responde com redirecionamento permanente `308`, preservando método, caminho e query; `supabase.bentevi.shop` encaminha pelo túnel autorizado à API self-hosted da `.162`. Ele não é o serviço DEV e sua existência não autoriza configurá-lo, reiniciá-lo, publicá-lo nem associá-lo à branch `dev`. O serviço anterior `vortek-erp-dev` permanece desabilitado e seu webhook nunca deve ser usado como credencial ou caminho de publicação produtiva.

Preparar uma próxima release significa fixar o SHA candidato de `dev`, levantar testes, delta mínimo de schema, variáveis sem valores, gates, riscos e recuperação. Não significa atualizar/pushar `bentevi-prod`, aplicar migrations ou apontar o serviço produtivo. Essas ações pertencem a uma tarefa de release própria e explicitamente autorizada; os dois Supabases remotos permanecem somente leitura aqui.

Em uma promoção autorizada posterior, preserve `main` sem alterações e mova `bentevi-prod` somente para o SHA aprovado de `dev`, sem integração entre históricos. Só então o serviço produtivo poderá receber esse snapshot. Não presuma que apontar o serviço para `main` seja rollback suficiente: compatibilidade de schema, dados e efeitos externos precisa de plano próprio.

## 8. Skills e comunicação

`AGENTS.md` é a fonte central das restrições do projeto. `.rules` e skills devem encaminhar a ele, sem manter mapas de ambiente conflitantes.

- `vortek-dev-implementation`: implementação de uma ação DEV e validação proporcional.
- `vortek-dev-release`: preparação de promoção, sem execução em produção.
- `supabase-postgres-best-practices`: apoio especializado quando pertinente; não altera o modelo self-hosted nem autoriza operações.

Use ferramentas disponíveis e equivalentes seguros, sem criar infraestrutura auxiliar por conveniência. Skills herdadas ou instruções históricas não autorizam escritas em produção.

Responda em português brasileiro, com conclusão primeiro, evidências necessárias, mudanças, validações realmente executadas e pendências relevantes. Diferencie fatos de hipóteses e não exponha raciocínio interno. Nunca afirme que testou, publicou, migrou ou verificou algo que não executou. Encerre ao cumprir o escopo solicitado.
