# Vortek / Bentevi — Instruções do sistema em produção

Última revisão: 2026-09-11.

Este repositório é a fonte de desenvolvimento do Bentevi atualmente em produção. Não existe homologação remota ativa: as mudanças são preparadas e validadas na branch `dev` e, quando a implementação é solicitada, promovidas de forma controlada para o sistema produtivo Bentevi. Estas regras se aplicam a análises, planos, implementação, validação, Git, banco e infraestrutura.

## 1. Autoridade e escopo

Restrições de plataforma, segurança e execução prevalecem. Dentro desses limites, siga o pedido explícito atual do usuário, este `AGENTS.md` e a documentação específica da tarefa, nessa ordem. Skills e instruções complementares não ampliam autorizações nem substituem as restrições deste projeto.

O código, schema, configuração e testes atuais demonstram o comportamento implementado; documentos vigentes definem o comportamento pretendido. Havendo divergência, investigue e relate, sem assumir que uma implementação incorreta substitui o contrato. Auditorias e evidências históricas não comprovam o estado atual.

- Diferencie análise, planejamento e implementação. Um pedido de diagnóstico não autoriza corrigir; quando implementar foi solicitado, execute o trabalho seguro dentro do escopo.
- Trabalhe somente na branch `dev`. Confira a branch e o estado do Git antes de editar; se estiver em outra branch, pare e informe, sem trocar automaticamente.
- `main` é o sistema legado preservado, retirado do tráfego na virada de 2026-09-09; `dev` é a linha de desenvolvimento da nova versão Bentevi. A divergência entre as branches é intencional e sua contagem de commits não mede prontidão.
- Não misture os históricos: nenhum merge, rebase ou cherry-pick em massa entre `main` e `dev`. Use `main` somente como evidência de leitura para identificar comportamentos produtivos essenciais; quando um deles ainda for necessário, implemente-o nativamente na arquitetura de `dev`, em ação própria e com testes.
- `app.bentevi.shop` e o Supabase `.162` são os destinos operacionais das mudanças do Bentevi; `app.vortek.shop` é apenas o redirecionamento legado. Não leve mudanças ao sistema legado.
- Pedidos explícitos de **implementar, corrigir, ajustar ou atualizar** autorizam o ciclo completo necessário para colocar a mudança solicitada em produção: editar e validar em `dev`, commit/push dos arquivos da tarefa, promover o mesmo SHA para `bentevi-prod`, aplicar no Supabase `.162` as mudanças de schema/dados estritamente necessárias, publicar no serviço produtivo e executar smoke/read-back. Não solicite nova autorização para cada uma dessas etapas, salvo se o usuário limitar o pedido.
- Pedidos de análise, diagnóstico, revisão ou planejamento continuam somente leitura e não autorizam implementação nem mutação externa. Operações destrutivas ou efeitos externos materialmente diferentes do pedido exigem decisão específica quando não estiverem claramente incluídos no escopo aprovado.
- Preserve alterações preexistentes do usuário. Não acrescente correções, refatorações ou mudanças de regra de negócio fora da tarefa.
- Uma ação técnica do Item 17 por tarefa; não avance para outra etapa sem validação e sem respeitar os gates e aceites vigentes.

## 2. Ambientes e Supabase — proteção obrigatória

O Supabase do projeto é **self-hosted**, não Supabase Cloud. Não exija project refs, tokens pessoais, dashboard ou autenticação MCP do Supabase Cloud para operar este ambiente.

| Recurso | Destino | Permissão neste projeto |
|---|---|---|
| Supabase de produção Bentevi | `supabase.bentevi.shop` → `192.168.1.162` | Destino produtivo gravável nas implementações solicitadas, após o preflight obrigatório |
| Supabase DEV local | `127.0.0.1`, projeto `bentevi-dev-local` | Ensaio opcional, somente com dados sintéticos e `VORTEK_RUNTIME_ENVIRONMENT=local_dev`; não substitui a aplicação produtiva |
| Supabase legado | `192.168.1.160` | Exclusivamente leitura para consultas e diagnósticos necessários |
| Web de homologação anterior | `dev.bentevi.shop`, serviço `local/vortek-erp-dev` no Easypanel `.160` | Serviço desabilitado após a virada; não reativar nem publicar sem recriar um destino DEV independente |
| App produtivo Bentevi | `app.bentevi.shop`, serviço `local/bentevi-prod` no Easypanel `.160` | Produção ativa na branch `bentevi-prod`; destino de deploy e smoke das implementações solicitadas |

A hospedagem da aplicação DEV em `.160` **não** torna o Supabase desse servidor um banco de desenvolvimento. Nomes de containers, diretórios, labels, URLs ou variáveis contendo `dev` não mudam essa classificação.

A virada de 2026-09-09 reaproveitou `.162` como produção Bentevi e desabilitou os serviços web legado e DEV. O hostname canônico da API produtiva é `supabase.bentevi.shop`; o hostname histórico `supabase-dev.vortek.shop` ainda pode resolver para `.162` apenas por compatibilidade e deve ser tratado como produção. O DEV local pode ser usado para ensaio seguro, mas uma implementação só está concluída quando a mudança solicitada estiver aplicada e conferida na produção Bentevi.

### Produção Bentevi é o destino operacional

O Supabase `.162` pode receber migrations, DDL, correções de dados, funções/RPC, triggers, grants, RLS, Auth, Storage e configurações quando essas alterações forem necessárias para uma implementação explicitamente solicitada. Execute somente o delta da tarefa, com alvo comprovado, backup/recuperação proporcionais, transações curtas e read-back. Não use produção para experimentos, fixtures ou ensaios descartáveis.

Consultas e diagnósticos permanecem somente leitura. Não presuma que uma RPC ou chamada HTTP seja inofensiva pelo nome ou método: confira seus efeitos antes de executá-la. O Supabase legado `.160` continua absolutamente somente leitura, inclusive para ensaios com `ROLLBACK`.

Não interrompa uma implementação apenas porque ela exige escrita no Bentevi produtivo: este é o fluxo normal atual. Interrompa somente se o destino não puder ser comprovado, se resolver para `.160`, se faltar uma decisão destrutiva não coberta pelo pedido ou se não houver recuperação segura para uma mudança material.

### Antes de qualquer escrita na produção Bentevi

1. Confirme que a escrita é necessária e está no escopo autorizado.
2. Resolva e confira o destino real da conexão, inclusive quando houver proxy ou túnel; registre apenas host/identidade, sem credenciais.
3. Comprove que o destino gravável é `supabase.bentevi.shop`/`192.168.1.162` e que o runtime é o Bentevi produtivo. Interrompa se resolver para `.160` ou se a identidade não puder ser comprovada.
4. Inspecione o histórico de migrations e o schema atual de `.162`; confira dados, consumidores, RLS, grants, funções, triggers, constraints, jobs e integrações pertinentes.
5. Faça backup verificável antes de mudanças destrutivas, cargas amplas ou alterações de compatibilidade; ensaie no DEV local quando isso reduzir risco sem transportar dados ou secrets produtivos.
6. Prefira migrations versionadas e compatíveis, lotes idempotentes, ordem determinística, transações curtas e read-back. Não aplique o diretório inteiro de migrations para fabricar igualdade de schema.
7. Suspenda ou serialize writers concorrentes quando a mudança puder disputar dados; preserve eventos recebidos durante manutenção e defina retomada.
8. Registre o que foi aplicado, versão/SHA, validações, efeitos observados e recuperação disponível, sem expor credenciais.

Antes de solicitar credenciais ausentes, confira a configuração privada local ou do servidor já autorizada, sem imprimir seus valores. Secrets produtivos permanecem somente no runtime/armazenamento privado e nunca devem ser copiados para código, documentos ou cliente.

Confira o chamador e suas permissões em mudanças de segurança. Nunca desabilite RLS globalmente para contornar erros nem exponha credenciais privilegiadas ao cliente. Consulte a documentação oficial da funcionalidade Supabase/PostgreSQL envolvida, respeitando as diferenças do self-hosted.

## 3. Fontes e roteiro de desenvolvimento

Para tarefas da nova versão ou do Item 17, consulte primeiro o [checklist de execução](docs/reestruturacao-vortek/VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md), especialmente o recorte **Bentevi em operação**, os gates, dependências e aceites aplicáveis. Não copie status transitórios para este arquivo nem confunda implementação local, publicação produtiva e aceite operacional.

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
| Deploy e operação Easypanel | [Procedimento Easypanel](docs/easypanel-deploys.md) |

Atualize o checklist somente com evidência real e quando pertinente à tarefa. Não marque como concluído algo apenas planejado, parcialmente testado ou sem o aceite necessário; risco aceito não é risco eliminado.

## 4. Investigar e implementar

1. Inspecione os arquivos e consumidores relacionados; confirme versões e configuração quando influírem na decisão.
2. Para comportamento dependente de tecnologia externa, leia a documentação oficial atual da funcionalidade e versão pertinentes. Não basta a página inicial. Se insuficiente, consulte código/SDK, changelog ou schema oficial; só então fontes secundárias, distinguindo inferência de fato.
3. Em bugs, identifique comportamento esperado, observado, ponto de divergência e causa com evidências. Se a causa não puder ser confirmada, explicite a limitação.
4. Escolha a menor solução correta: corrigir, remover, reutilizar ou consolidar antes de acrescentar mecanismos.
5. Implemente apenas o necessário e valide o comportamento afetado.

Não esconda erros, duplique fontes de verdade ou introduza fallbacks, fluxos paralelos, wrappers, dependências, caches, retries ou jobs sem necessidade demonstrada. Mitigações temporárias precisam de motivo explícito quando a causa não puder ser corrigida com segurança; não as apresente como solução definitiva.

Nas integrações, confira autenticação, contratos, estados, paginação, limites e efeitos externos relevantes. Não invente atributos ou especificações de produtos. Use a conta produtiva somente quando a implementação exigir seu comportamento real e mantenha writers ainda não liberados desabilitados. Nunca copie credenciais produtivas para fixtures, documentos ou bundle do cliente.

Em jobs, webhooks e sincronizações, verifique idempotência, duplicação, concorrência, falhas parciais, reprocessamento e eventos fora de ordem. Não use atrasos arbitrários ou reparos periódicos para encobrir uma transição determinística incorreta. Otimize somente com evidência de custo ou latência.

## 5. Arquitetura e validação

A aplicação web está na raiz: Next.js App Router, React, TypeScript, Ant Design, Supabase e Zod. `mobile/` é uma aplicação separada Expo/React Native, com dependências próprias, incluindo TanStack Query. Não transporte padrões ou dependências entre web e mobile sem verificar os manifests e o código.

- O escopo padrão das tarefas é exclusivamente a aplicação web. Não altere arquivos em `mobile/` nem trate paridade mobile como parte implícita de uma tarefa web; a aplicação móvel somente pode ser modificada mediante pedido explícito do usuário. Serviços Next.js compartilhados podem ser corrigidos quando necessários ao comportamento web solicitado.

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

Confira os scripts antes de executá-los: fixtures, reparos, backfills, smoke tests e testes de integração podem escrever no banco ou afetar serviços externos. `--dry-run` no nome não dispensa inspeção de efeitos. `RUN_VORTEK_DEV_DB_TESTS=1` continua exclusivo do projeto local `bentevi-dev-local` e nunca deve apontar para `.162`. Testes produtivos com escrita só podem ocorrer quando forem a própria validação necessária da implementação, com dados reais identificáveis, idempotência, cleanup quando aplicável e efeitos externos controlados.

Compare resultados anteriores e posteriores quando houver falhas preexistentes. Relate falhas, testes ignorados e verificações não executadas; não suprima testes, aceite regressões silenciosamente ou declare toda a suíte aprovada por terem passado apenas os testes direcionados. Registre evidências na documentação da tarefa, sem congelar contagens de falhas neste arquivo.

## 6. Limpeza, segurança e preservação

- Antes de remover ou mover arquivos, procure imports, scripts, configuração, links, consumidores de runtime e testes. Ausência de import não prova que um arquivo é inútil.
- Documentos em `docs/` podem ser entradas da aplicação: `src/services/assistant-documents.ts` depende de caminhos e títulos exatos. Alterar essas referências exige verificar o contrato e os testes; não renomeie nem remova seções como simples limpeza.
- Preserve migrations, código web/mobile, documentação operacional e evidências necessárias aos gates e à recuperação. Não remova histórico apenas por ser antigo.
- Artefatos regeneráveis de build, caches, logs e relatórios descartáveis devem ficar fora do Git, respeitando as exceções atuais de `.gitignore`. Remoções materiais precisam estar no escopo; informe o que foi removido e como recuperar, quando possível.
- Nunca exponha ou versione passwords, tokens, cookies, chaves privadas, service-role, webhooks completos ou valores sensíveis de ambiente. Inspecione somente a configuração autorizada e necessária, sem reproduzir secrets em saída, código ou relatório.
- Se encontrar um secret versionado, não o reproduza; informe a exposição e a necessidade de rotação. Remova-o da fonte ativa quando autorizado e pertinente; não reescreva histórico nem altere secrets de produção por conta própria.

## 7. Git, produção e release

Use o repositório local existente. Não crie clones auxiliares, worktrees ou checkouts paralelos sem pedido explícito ou sem demonstrar que o diretório atual é inutilizável.

- Não descarte nem sobrescreva alterações alheias. Em pedidos explícitos de implementação, stage, commit e push dos arquivos da tarefa fazem parte do fluxo autorizado; pedidos somente de análise ou planejamento não os autorizam.
- Não use reset/checkout destrutivo, reescrita de histórico ou force push sem necessidade e autorização explícita.
- Não publique trabalho alheio apenas para obter uma árvore limpa.
- `npm run sync:main` não é o fluxo deste ambiente DEV; não troque para `main` para satisfazer o script.

### Modelo de branches — decisão permanente

- `main`: código legado do Vortek, preservado e independente após ter sido retirado do tráfego na virada do Bentevi.
- `dev`: fonte integrada e branch de edição/validação do Bentevi.
- `bentevi-prod`: branch efetivamente publicada, sempre apontando para um SHA validado de `dev` e sem integração com `main`. Na primeira virada, ambas apontavam para `f4fb50c6081cae461857e1ddee514a15b5bc87f9`.

`bentevi-prod` não nasceu de merge com `main`, não recebe o diff entre as duas branches e não inclui código legado por ancestralidade. Comparações com `main` servem somente para auditoria comportamental e de schema. Cada promoção deve revisar o snapshot de `dev` por si mesmo e comprovar que regras produtivas essenciais receberam um destino explícito no Bentevi.

Fluxo normal de uma implementação: **editar e validar em `dev` → commit/push de `dev` → promover o SHA exato para `bentevi-prod` → aplicar o delta necessário em `.162` na ordem segura → deploy em `local/bentevi-prod` → smoke/read-back em `app.bentevi.shop` → registrar o resultado**.

Promova somente um SHA de `dev` já enviado ao remoto. Atualize `bentevi-prod` por fast-forward desse SHA, sem checkout separado, merge com `main`, force push ou reescrita. Se a branch produtiva tiver divergido, interrompa e investigue; não force a convergência. Confirme o SHA remoto após o push e o SHA efetivamente executado após o deploy.

O webhook vem da configuração privada, nunca de documentação ou código versionado. Não edite arquivos dentro do container nem use deploy direto por Docker como procedimento normal. Aceite HTTP do webhook não comprova build, implantação ou validação funcional; confira o resultado no nível aplicável.

O App Service `local/bentevi-prod` está ativo em produção, associado exclusivamente à branch `bentevi-prod` e ao domínio canônico `app.bentevi.shop`. Na Cloudflare, `app.vortek.shop` responde com redirecionamento permanente `308`, preservando método, caminho e query; `supabase.bentevi.shop` encaminha pelo túnel autorizado à API self-hosted da `.162`. Use apenas o serviço, webhook/API e domínio produtivos autorizados; nunca associe o serviço diretamente à branch `dev`. O serviço anterior `vortek-erp-dev` permanece desabilitado.

Uma implementação solicitada não termina na preparação local. Depois dos gates, promova `bentevi-prod`, aplique as mudanças necessárias em `.162`, publique e valide produção. Se o usuário pedir apenas preparação, revisão ou plano, encerre antes dessas mutações e deixe o próximo passo explícito.

Preserve `main` sem alterações e mova `bentevi-prod` somente para o SHA aprovado de `dev`, sem integração entre históricos. Não presuma que apontar o serviço para `main` seja rollback: compatibilidade de schema, dados e efeitos externos precisa de plano próprio. Depois que produção receber novas gravações, restauração cega de backup também não é rollback seguro; prefira correção progressiva quando necessário.

## 8. Skills e comunicação

`AGENTS.md` é a fonte central das restrições do projeto. `.rules` e skills devem encaminhar a ele, sem manter mapas de ambiente conflitantes.

- `vortek-dev-implementation`: implementação de uma ação do Bentevi desde `dev` até a produção, salvo limitação explícita do pedido.
- `vortek-dev-release`: promoção controlada do SHA validado para `bentevi-prod`, mudanças necessárias em `.162`, deploy e verificação.
- `supabase-postgres-best-practices`: apoio especializado quando pertinente; não altera o modelo self-hosted nem autoriza operações.

Use ferramentas disponíveis e equivalentes seguros, sem criar infraestrutura auxiliar por conveniência. Skills herdadas ou instruções históricas não substituem a autorização definida neste arquivo nem dispensam o preflight produtivo.

Responda em português brasileiro, com conclusão primeiro, evidências necessárias, mudanças, validações realmente executadas e pendências relevantes. Diferencie fatos de hipóteses e não exponha raciocínio interno. Nunca afirme que testou, publicou, migrou ou verificou algo que não executou. Encerre ao cumprir o escopo solicitado.
