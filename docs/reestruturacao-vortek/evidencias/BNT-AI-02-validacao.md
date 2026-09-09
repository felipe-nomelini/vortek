# BNT-AI-02 — Interface e histórico

**Data:** 08/09/2026. **Branch:** `dev`. **Estado vigente:** código publicado em DEV no candidato `32a1685d`, com Codex confirmado na imagem. Ativação administrativa, perfil/login e homologação do chat com modelo real pendentes. A fotografia local abaixo antecede os deploys registrados ao final.

## Mudança e evidência

AI-01 entregara consultas tipadas, mas não havia chat, histórico ou transporte do Assistente. Agora `/assistente` reutiliza shell/Ant Design Bentevi, com histórico privado lateral, nova conversa, busca, renomeação, exclusão, fases de progresso, cancelamento e fontes em Drawer. O menu aparece após Dashboard somente para o piloto autorizado.

O backend usa exclusivamente consultas AI-01 e o modelo escolhido `gpt-6-astra/low` por assinatura ChatGPT. Planejador limitado a três consultas, até duas inferências por pergunta, contexto de oito pares/24 mil caracteres e deadline de 120 segundos. Valores numéricos e referências são validados/resolvidos no servidor. Nenhuma operação comercial foi criada; regras de pricing, estoque, fiscal e publicação não foram modificadas.

O protocolo Codex foi extraído do piloto de garantia para transporte compartilhado, mantendo perfis/contextos e validação de domínio separados. Regressões do extrator passaram. Os consumidores OpenRouter existentes não foram alterados.

Persistência em duas tabelas, RLS de propriedade/admin, escrita somente pelo servidor e claim atômico com lease por usuário. Reenvio idêntico não repete inferência; cancelamento/timeout impedem persistência tardia. Exclusão ativa é recusada até interrupção/encerramento. Histórico mantido até exclusão pelo usuário, sem job de expurgo e sem promessa de exclusão do provedor/backups.

## Validações executadas

| Prova | Resultado |
|---|---|
| `node --test tests/assistant-chat.test.js tests/assistant-knowledge.test.js tests/warranty-codex.test.js tests/product-warranty.test.js` | 138 aprovados, zero falhas, 2 LIVE de garantia ignorados explicitamente |
| `npm run validate` | Lint e typecheck aprovados |
| `npm run build` | Aprovado; 127 páginas estáticas, rotas do Assistente incluídas; não é deploy |
| `tests/assistant-history.sql` no DEV | Ensaio com rollback e reconferência após aplicação aprovados |
| Smoke HTTP com build local e Auth/Supabase DEV reais | Status, criar, renomear, listar/buscar, abrir e excluir aprovados; anônimo 401; ausência do login Codex recusa inferência sem gravar mensagem |
| Chromium local 1440×1000, respostas de chat sintéticas/interceptadas | Bloqueio sem login, sugestão, envio NDJSON, fontes, renomear, reabrir, recolher histórico e excluir aprovados; zero `pageerror` |

A suíte cobre entrada estrita, fontes/valores inventados, metadados, documentos vigentes no limite de payload, conteúdo privado identificável, destino `.160` recusado, piloto/admin atuais, acesso cruzado, contexto limitado, duas abas, cancelamento, revogação, timeout com provedor não cooperativo, dedupe e erros/cotas do transporte. Interceptações de modelo/rede são sintéticas: não comprovam a qualidade semântica de respostas reais.

Durante o smoke local, o primeiro POST evidenciou divergência entre Origin público e URL interna reconstruída pelo Next. A checagem foi corrigida para aceitar a origem canônica DEV e loopback local com Host correspondente; origem externa e produção continuam recusadas. Regressão incluída. O empacotamento documental passou a manter caminho-raiz estático e verificação de `realpath`, eliminando os avisos de tracing amplo no build final.

## Banco e configuração

- Preflight confirmou destino TCP **192.168.1.162**, hostname **supabase-dev**, PostgreSQL 17.6 e histórico/schema da mesma conexão antes das escritas.
- Migration nova `20260908190000_assistant_history.sql` ensaiada com rollback, aplicada e registrada em `supabase_migrations.schema_migrations`. Migration histórica não foi reescrita.
- SQL testou RLS do dono, outro administrador, papel revogado, anon, escrita/RPC diretas recusadas, reenvio, concorrência, cancelamento, timeout, exclusão em cascata e resultado tardio após exclusão. Fixtures sintéticas ficaram em transação desfeita.
- Tipos das duas tabelas atualizados pelas colunas efetivas consultadas no DEV, preservando os demais tipos; assinaturas das três RPCs alinhadas à migration. Não foi executada regeneração completa do schema.
- Smoke usou sessão Auth DEV por OTP oficial, sem alterar senha ou enviar e-mail. Sessão local encerrada e conversa sintética criada pelo teste removida via API. Nenhum histórico real removido.
- `.env.local` permanece ignorado. Guard individual configurado localmente. Perfil `/home/felipe/.config/vortek-dev/assistant-codex` criado com diretórios `700` e `config.toml` `600`, workspace vazio, sem copiar credenciais. Não há login ChatGPT neste novo perfil.
- `BENTEVI_ASSISTANT_DATA_APPROVED=0` preservado. Nenhum dado operacional foi enviado à OpenAI nesta tarefa. Codex local reconfirmado como `0.153.4`; instalação versionada preparada no Nixpacks, não executada no Easypanel.
- **Produção `.160` não foi acessada.** Nenhum endpoint ML, fiscal, fornecedor ou serviço de operação foi executado.

## Evidência visual local

As capturas abaixo usam conteúdo claramente sintético, não respostas de um modelo real e não dados financeiros da empresa. Comprovam renderização/interações locais, não publicação ou aceite do usuário.

- [Conversa e histórico](BNT-AI-02-conversa.png).
- [Fontes, cobertura e período](BNT-AI-02-fontes.png).

<a id="pendencias-para-o-teste-de-felipe"></a>

## Pendências para o teste de Felipe

1. Com acesso administrativo válido ao Easypanel, configurar **somente `local/vortek-erp-dev`** conforme o registro de publicação abaixo e provisionar diretório persistente privado. Conectar o titular pelo login oficial no **perfil exclusivo do Assistente**, sem copiar a sessão de engenharia ou assumir a autenticação do perfil de garantia; nunca no Supabase de produção.
2. Confirmar os controles de dados aplicáveis à conta descritos na [seção 3 do contrato](../VORTEK_BENTEVI_ASSISTENTE_CONTRATO.md#3-provedor-e-limites) antes de habilitar `BENTEVI_ASSISTANT_DATA_APPROVED`. A existência da assinatura não comprova esses controles. Primeiro executar uma pergunta sintética com o perfil real, validando conta/modelo/cota.
3. O código já recebeu commit/push/deploy autorizados; Codex/documentos e publicação foram conferidos. Após configurar perfil/variáveis e reaplicar o serviço, repetir smoke autenticado em `https://dev.bentevi.shop/assistente`, incluindo consulta canônica real sem mutações. O smoke atual confirmou o bloqueio por configuração, não a inferência. Só então fornecer roteiro de teste visual e avançar ao AI-GATE.

Não foi executado LIVE de inferência do chat. A prova anterior de `gpt-6-astra` no extrator de garantia permanece histórica; não equivale à validação deste perfil/hospedagem. Precisão semântica, uso efetivo de cota, reconexão/renovação e comportamento multi-instância em hospedagem ainda exigem homologação. A UI classifica limite atingido, mas ainda não apresenta uma data específica de renovação da cota. A retenção pessoal é limitada pelo contrato do provedor; exclusão no ERP não a redefine.

## Referências e decisões

Foram usados o guia local do Next 16.3.3 para Route Handlers/NextRequest e a implementação instalada para confirmar URL interna; componentes de [Ant Design 5](https://5x.ant.design/components/drawer/) e [Typography](https://5x.ant.design/components/typography/); [App Server](https://learn.chatgpt.com/docs/app-server) e [autenticação Codex](https://learn.chatgpt.com/docs/auth); [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security) e [locks transacionais PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS); [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) e [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp) para o smoke Auth; [Playwright — network](https://playwright.dev/docs/network) para a separação explícita da prova sintética; e [Nixpacks — configuração](https://nixpacks.com/docs/configuration/file) para preparar o runtime.

As skills de implementação DEV, Supabase/Postgres e documentação OpenAI orientaram o isolamento, os testes de propriedade e o reaproveitamento do transporte oficial. O mapa vigente do AGENTS prevaleceu sobre o endereço antigo da skill Supabase: somente `.162` recebeu escritas.

## Git e rollback

HEAD preservado em `5c7f28a1a6132618c724078b040e6b1b6877ebf9`. Sem commit, push, deploy ou alteração de `AGENTS.md`. Mudanças preexistentes AI-00/AI-01 e de outras tarefas preservadas, sem staging.

Rollback inicial: desabilitar `BENTEVI_ASSISTANT_ENABLED` e manter inferência bloqueada; reverter apenas alterações desta ação, preservando AI-01 e extrator de garantia. Não apagar tabelas com histórico real automaticamente. Se for necessário desfazer schema, usar nova migration autorizada somente no `.162`, após exportar/avaliar o histórico e ensaiar rollback. Credencial do perfil exclusivo deve ser desconectada pelo fluxo oficial; nunca removida junto à sessão de engenharia. Produção permanece fora do escopo.

## Publicação autorizada — 08/09/2026

O usuário autorizou push/deploy para teste. Commits `c788f538` (conhecimento), `a30e2600` (interface/histórico) e `68f4ebab` (contrato/evidências) enviados somente a `origin/dev`. O primeiro deploy terminou `done` no Easypanel, ação `cmttd489b000b07o9g3ya5ij7`, às 21:33:34 BRT.

**Divergência de empacotamento confirmada:** o serviço usa Railpack 0.35.0; a fase Codex preparada no Nixpacks não foi executada. A primeira imagem contém os documentos, mas não o binário. Corrigido no repositório com `@openai/codex=0.153.4` como dependência de runtime e lockfile, removendo a fase global duplicada do Nixpacks. Regressão reproduziu a ausência antes da correção. Depois passaram **162 testes**, com dois LIVE pulados, `npm run validate`, `npm run build` e `node_modules/.bin/codex --version`. A publicação da correção será registrada abaixo quando confirmada.

**Ativação ainda pendente:** o serviço DEV não tem variáveis `BENTEVI_ASSISTANT_*`, perfil persistente nem login exclusivo; `SUPABASE_SERVICE_URL` usa endereço indireto recusado pelo guard do Assistente. O webhook foi comparado com o token do serviço exato `local/vortek-erp-dev`, branch `dev`, autoDeploy desligado. O acesso de deploy não equivale a acesso administrativo: a configuração local do painel não contém API token e a sessão encontrada estava expirada. Nenhuma credencial foi criada, nenhuma sessão foi forjada/renovada diretamente e nenhuma configuração do painel foi alterada. Solicitado ao usuário login no Easypanel para prosseguir pela interface/API oficial.

Para ativar **somente o serviço web DEV**, preservar as demais variáveis e configurar `SUPABASE_SERVICE_URL=http://192.168.1.162:8000`, `BENTEVI_ASSISTANT_ENABLED=1`, UUID do titular DEV em `BENTEVI_ASSISTANT_PILOT_USER_ID`, caminho privado persistente terminado em `assistant-codex` em `BENTEVI_ASSISTANT_CODEX_HOME` e `BENTEVI_ASSISTANT_DATA_APPROVED=0`. O último permanece bloqueado até confirmar os controles da conta; habilitar interface não autoriza inferência. Não mudar URL pública de Auth/cookies nem credenciais Supabase. Reaplicar o serviço pelo deploy oficial depois de configurar o perfil/mount.

Esta subseção complementa a fotografia local acima; não encerra AI-02, AI-GATE ou marco 3. Publicação de código não é teste conversacional da assinatura.

### Resultado da publicação corrigida

- Commit `32a1685d` publicado somente em `origin/dev`; segundo acionamento pelo script oficial, com dry-run anterior, sem deploy paralelo. Ação `cmttdbkyj000c07o92hkbf4qx`: `done` às **21:39:29 BRT**. Serviço DEV: atualização `completed` às **21:39:36 BRT**, uma réplica, versão Docker `9734`.
- Container novo `79a78eae9dd4`: `npm exec --offline -- codex --version` retornou `codex-cli 0.153.4`. SHA-256 de `package.json`, lockfile, autorização/histórico e configuração do modelo coincidem com o candidato local. Documento canônico incluído na imagem. Nenhum perfil, cookie ou credencial de engenharia foi copiado.
- Smoke remoto sem mocks: `/api/auth/me` e `/assistente` HTTP 200 com sessão temporária DEV; `/api/assistente/status` HTTP 403 `ambiente_bloqueado` por configuração ausente; acesso anônimo HTTP 401. Nenhum histórico criado/excluído e nenhuma pergunta enviada. Sessão temporária encerrada com escopo local, sem mudar senha ou invalidar outras sessões. O harness usou o nome de cookie da URL pública da hospedagem, separado do transporte literal `.162`.
- Preflight confirmou TCP `.162`, hostname `supabase-dev`, migration `20260908190000` já registrada e tabelas existentes; nenhuma migration reaplicada, DDL ou escrita operacional. Auth de smoke somente no `.162`.
- Serviço de produção `local_vortek-erp` permaneceu na versão `9706`, `UpdatedAt=2026-09-08T20:01:30.596084878Z`, iguais à fotografia inicial. Inspeção limitada a metadados do Docker; nenhum acesso ao Supabase/PostgreSQL de produção.
- `AGENTS.md`/`.gitignore` preservados; regras, skills e credenciais locais continuam ignoradas. Evidência/checklist pós-deploy enviados em commit documental, com autoDeploy desligado; não exigem outra imagem.

**Resultado para o usuário:** push/deploy concluídos, mas o teste conversacional continua bloqueado pelas pendências administrativas e pelo login do perfil exclusivo. Não solicitar aceite de um chat indisponível.
