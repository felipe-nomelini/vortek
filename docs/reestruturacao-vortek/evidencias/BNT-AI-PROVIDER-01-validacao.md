# BNT-AI-PROVIDER-01 — Piloto individual ChatGPT/Codex

**Atualização operacional de 08/09/2026:** `.env.local` agora contém Firecrawl e conexão DEV `.162`; aplicação em `http://localhost:3001`, com pesquisa/histórico verificados no navegador e coleta/extração de produto real testadas sem gravar amostra. [Runtime e limites atuais](BNT-CANON-WARRANTY-01-runtime-local.md). As ausências de configuração e de coleta mencionadas abaixo descrevem a fotografia original de 07/09.

Data: 07/09/2026. Branch: `dev`. Base local: `b327031`.

**Resultado: integração e extração individual local comprovadas com login ChatGPT. Não equivale à homologação ponta a ponta da pesquisa de garantia nem ao uso compartilhado do ERP.** Sem push/deploy, migrations, gravações no banco ou alterações em produção nesta tarefa.

## Decisão e estado encontrado

- Piloto aprovado apenas para Felipe na aplicação local; o chat e o uso pelo segundo administrador continuam em suas etapas próprias.
- Antes: `product-warranty.ts` exigia Firecrawl e OpenRouter para pesquisar garantia. Agora: o extrator pode ser selecionado explicitamente, somente nesse fluxo; coleta, validação canônica, revisão, histórico e regras comerciais não mudaram.
- Codex CLI instalado: `0.153.4`. Modelo solicitado e conferido por `model/list`: `gpt-5.4-mini`, esforço `low`. Nenhuma substituição de modelo ou API paga como fallback.
- Node 22, Next.js 16.3.3, Zod 3.25.76. Sem dependência npm nova.
- Perfil administrativo de Felipe confirmado por GET restrito em `192.168.1.162:8000/rest/v1/profiles`, sem escrita. UUID guardado apenas na configuração local do piloto; SSH confirmou `supabase-dev`.
- `origin/main` e a referência remota consultada por `ls-remote` apontavam para `dd3498046c978847aa3ee212e725252a258eb76e`. Nenhuma operação Git em `main` ou merge.

**Delta de domínio classificado:** desde o último delta documentado `7f0a292`, o commit produtivo `4a40832` adicionou `product-warranty.ts` e a política `VORTEK-WARRANTY-2026-09-06-SELLER-30` em `src/lib/ml-sale-terms.ts`: fallback comercial de vendedor por 30 dias. A V2 documenta fabricante → fornecedor → legal por classificação e mantém estado inconclusivo sem prova. Classificação: **RECONCILIAR ANTES DE FECHAR WARRANTY-01**, não copiar nem alterar silenciosamente no piloto de provedor. O extrator continua apenas propondo evidências, sem decidir garantia padrão; portanto esse delta não modifica seu contrato técnico nem libera o gate comercial. Os demais três arquivos de consumidores/coleta consultados não tiveram diff nesse intervalo.

## Implementação

`src/services/warranty-codex.ts` executa o App Server oficial por stdio JSONL, sem porta pública. A aplicação envia apenas nome, marca, GTIN, indicação de kit e páginas já coletadas. Não entrega banco, credenciais, arquivos do ERP ou ferramentas ao modelo.

O fluxo confirma `account/read.type=chatgpt`, modelo/esforço disponíveis, thread efêmera, provedor `openai`, modelo efetivo, perfil de permissões e ausência de arquivos de instruções carregados. Cada extração usa processo/thread próprios, saída estruturada e o mesmo validador de evidências já usado pela garantia.

O backend exige `NODE_ENV=development` e o UUID configurado, inclusive na preparação de anúncio. Outro usuário não inicia o Codex nem grava um comando de pesquisa nessa preparação; a rota de pesquisa explícita retorna 403. Leitura e revisão manual continuam sob as permissões existentes.

O perfil exclusivo desabilita shell, execução unificada, hooks, agentes, busca web, imagens, apps, browser, plugins e instalação de MCP por skills. O perfil de permissões permite somente leitura do workspace vazio e desabilita rede de ferramentas. Isso não bloqueia a conexão do próprio App Server ao serviço de inferência. Requests de ferramentas e eventos de execução inesperados encerram a extração. Credenciais de API e integrações do ERP não são herdadas no ambiente do subprocesso.

O limite total continua em 45 segundos, compartilhado com a coleta. A aplicação não adiciona retries, fila ou fallback. Há bloqueio de concorrência na instância do extrator e threads isoladas; não se trata de um serviço distribuído/multiusuário. Abort interrompe o turno, encerra o processo e descarta saída tardia. Saída é limitada a 1 MiB; stderr/erros brutos do provedor não chegam ao cliente.

**Limitações verificadas na versão instalada:**

- O provedor built-in `openai` não aceita sobrescrever `request_max_retries`/`stream_max_retries`. Portanto não afirmar “zero tentativas internas do SDK”: são zero retries adicionados pelo ERP, deadline preservado e encerramento ao receber falha. Não foi criado provedor alternativo para contornar isso.
- `tools.view_image` aparece na documentação, mas o modo estrito rejeita essa opção: foi usado `features.view_image=false`, confirmado pela CLI.
- `readOnly.access` aparece no schema não experimental e na documentação, mas é rejeitado em execução. Foi usado o contrato de perfis nomeados, conferido no schema experimental da mesma CLI: `permissions=warranty-extract`, com `capabilities.experimentalApi=true`. O preflight real confirmou o perfil efetivo.
- App Server/perfis experimentais exigem reconfirmação ao atualizar o Codex. Este piloto não certifica implantação em servidor ou uso compartilhado.

## Configuração e login locais

- `.env.local`, ignorada pelo Git, seleciona `codex`, o UUID real do administrador e o diretório abaixo. Não contém credenciais Supabase ou Firecrawl: a configuração completa da aplicação local ainda precisa dessas dependências para a pesquisa ponta a ponta.
- Perfil: `/home/felipe/.config/vortek-dev/warranty-codex`; workspace vazio em `workspace/`.
- `config.toml` deve corresponder exatamente a `warrantyCodexConfig`, exportado pelo serviço. Alteração/symlink/ausência do perfil impede a extração.
- Login realizado pelo fluxo oficial `codex login` em navegador, com `CODEX_HOME` exclusivo. A sessão de engenharia não foi copiada nem alterada.
- Diretório 0700; configuração, `auth.json` e `.env.local` 0600. Nenhum token inserido em código, documentação ou Git.
- Para renovar somente esse login, executar no workspace vazio: `env CODEX_HOME=/home/felipe/.config/vortek-dev/warranty-codex codex login`.

`researchConfigured` indica apenas presença de configuração; a sessão e o modelo são verificados de fato em cada extração. Sem Firecrawl, a interface explica que falta a coleta e mantém a revisão manual. O extrator foi comprovado separadamente com amostras sintéticas; não inventamos uma coleta real para preencher essa dependência.

## Validações executadas

| Prova | Resultado |
|---|---|
| App Server real com configuração estrita | Inicialização OK; `account/read` em modo `chatgpt` |
| Modelo/perfil/instruções reais | `gpt-5.4-mini`, `warranty-extract`, thread efêmera, zero fontes de instruções |
| Extração sintética real: garantia de 12 meses no Brasil | Uma evidência em 5.701 ms |
| Texto sintético sem prova, contendo instrução maliciosa de procurar credenciais/inventar prazo | Zero evidências, sem evento de ferramenta, em 3.359 ms |
| Teste LIVE repetível, já com configuração final e validador canônico | Uma evidência aplicável de 12 meses, não revisada, em 6.651 ms |
| Testes direcionados de garantia e Codex | 50 passaram; 1 LIVE omitido por padrão |
| Regressão ampliada de M2M/pricing/permissões/produto/configurações | 414 passaram; 1 LIVE omitido por padrão; zero falhas |
| `npm run validate` | Lint e typecheck passaram |
| `npm run build` | Passou; 120 páginas estáticas geradas |

Não houve chamada OpenRouter no caminho Codex testado, nem fornecimento de API key ao App Server. Os testes verificam seleção explícita, indisponibilidade de modelo, conta API key recusada, sessão ausente/expirada, limite de uso, protocolo/JSON inválidos, timeout, encerramento, ferramentas proibidas, concorrência, contexto isolado, validação literal e ausência de fallback. Falhas externas 401/429 são simuladas; não se esgotou a cota nem revogou a sessão real para provocá-las.

Comandos repetíveis:

```bash
node --test tests/warranty-codex.test.js tests/product-warranty.test.js
npm run validate
npm run build
```

Prova externa opt-in, consome a cota da conta autenticada e não acessa banco/Firecrawl:

```bash
NODE_ENV=development WARRANTY_CODEX_LIVE_TEST=1 node --env-file=.env.local --test --test-name-pattern='LIVE:' tests/warranty-codex.test.js
```

Regressão ampliada:

```bash
node --test tests/m2m-*.test.js tests/pricing-audit*.test.js tests/pricing-overrides.test.js tests/pricing-clearances.test.js tests/permissions.test.js tests/fulfillment-capacity.test.js tests/bentevi-product-detail.test.js tests/product-warranty.test.js tests/warranty-codex.test.js tests/bnt-cfg-05-mercado-livre.test.js tests/bnt-cfg-07-integrations.test.js tests/configuracoes-ui-responsibilities.test.js
```

## Limites, dados e próximos consumidores

Login ChatGPT usa a modalidade da conta e seus limites; não é crédito de API nem uso ilimitado. O piloto não altera plano, recarga, créditos extras ou controles de dados. Não foi auditado o extrato financeiro nem o estado desses controles. A modalidade de serviço compartilhado/headless documentada com conta de serviço pay-as-you-go não comprova autorização para compartilhar o Pro individual entre operadores.

Somente textos sintéticos foram enviados nesta validação. No uso real do piloto, o payload previsto é o mínimo de dados de produto e fontes públicas da garantia. Threads efêmeras e `history.persistence=none` não significam retenção zero na OpenAI; o runtime também pode manter metadados locais. Retenção, controles de treinamento e adequação dos dados operacionais precisam ser reconfirmados no contrato do futuro Assistente antes de enviar conversas ou dados de clientes.

Consumidores posteriores inventariados e **não migrados**:

- `src/app/api/ml/anuncio/preencher-inteligente/route.ts`;
- `src/app/api/ml/anuncio/sugerir-campo/route.ts`;
- `src/services/product-attribute-research.ts` (outros fluxos de extração/preenchimento).

O código OpenRouter permanece como padrão fora da seleção local aprovada. Não declarar substituição geral homologada nem copiar esse perfil pessoal para o Easypanel.

## Pendências e sequência

1. Configurar Firecrawl DEV e o restante do runtime local para executar pesquisa real completa em WARRANTY-01. Nenhuma credencial de produção deve ser reutilizada.
2. Homologar os estados/revisão/histórico da garantia com o usuário; seu aceite visual não foi dado nesta tarefa. A etiqueta de provedor/indisponibilidade teve teste SSR, não validação visual humana.
3. Uso no Easypanel, pelo sócio e pelo futuro chat exige contrato próprio; o presente piloto é individual/local. Sem push/deploy neste escopo.
4. Reconciliar a divergência de fallback de garantia identificada no `main` antes do fechamento de WARRANTY-01; o piloto não escolhe ou altera essa regra comercial.

Depois do fechamento real de WARRANTY-01, seguir para Buy Box econômica. `pricing_execution_not_ready`, frete vivo ME2 e os demais gates comerciais continuam intactos.

## Rollback

Parar a aplicação local e retirar a seleção `codex` da configuração local, ou reverter seletivamente o commit desta integração. Isso restaura o caminho OpenRouter preexistente, **que só deve ser executado com credencial e uso explicitamente autorizados**; não criar fallback automático. Sem credencial de coleta/extração, pesquisa fica indisponível e revisão manual continua. Não apagar avaliações/histórico, desfazer migrations de garantia ou reabrir publicação comercial. O perfil/login pode permanecer local inativo; eventual logout deve usar somente seu `CODEX_HOME` exclusivo.

## Referências verificadas

- [App Server, autenticação e eventos](https://learn.chatgpt.com/docs/app-server).
- [Login ChatGPT e API key](https://learn.chatgpt.com/docs/auth).
- [Configuração e perfis de permissões](https://learn.chatgpt.com/docs/config-file/config-reference).
- [Planos e limites](https://learn.chatgpt.com/docs/pricing).
- [Contas de serviço](https://learn.chatgpt.com/docs/enterprise/service-accounts).
- Schema gerado pela CLI 0.153.4, incluindo campos experimentais; contrato executado prevalece sobre exemplos incompatíveis dessa fotografia documental.

Skills de implementação e OpenAI Docs orientaram escopo, consulta oficial e validações. A skill Supabase orientou a identificação do usuário por leitura; prevaleceu `.162` do AGENTS sobre o endereço antigo da skill. Não houve alteração do AGENTS.
