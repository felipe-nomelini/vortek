# WARRANTY-01 — Runtime local para homologação

**Atualização posterior em 08/09/2026:** o usuário solicitou retirar os controles de garantia da interface. O painel, os modais e os links para revisão foram removidos do código DEV; o roteiro visual abaixo registra o ensaio anterior e não deve ser executado como instrução atual. APIs, pesquisa na preparação, evidências e histórico persistido permanecem. Esta retirada ainda não foi publicada. [Mudança e validação](BNT-CANON-WARRANTY-01-validacao.md#atualização--retirada-dos-controles-da-interface-08092026).

Data: 08/09/2026. Branch `dev`, base `c2f39a3`. Continuação operacional do piloto individual de Felipe, sem mudar o contrato de garantia.

## Entrega e limites

- Aplicação local em `http://localhost:3001`, executada com `npm run dev -- --hostname 127.0.0.1 --port 3001`. O modo development é necessário para o piloto individual Codex.
- `.env.local` ignorada e com permissão 0600: Firecrawl fornecido pelo usuário, perfil Codex existente e conexão do Supabase DEV. Nenhum segredo neste documento ou no Git.
- Destino TCP PostgreSQL confirmado como `192.168.1.162`; configuração lida do stack independente `/opt/supabase-dev`. Migration `20260907213000` e tabelas de fontes/avaliações já presentes. Nenhuma migration nova ou reaplicada.
- Porta 3000, Easypanel, produção, anúncios ML, preços e regras comerciais não alterados. Nenhum push/deploy.
- Teste autenticado usou a conta existente de Felipe pelo fluxo oficial `generateLink` + `verifyOtp` do Supabase DEV, sem envio de email, criação de usuário ou alteração de senha. Isso valida sessão/permissões, não constitui teste do formulário com a senha do usuário.

## Provas executadas

1. Navegador Chromium: detalhe do produto e aba **Comercial e estoque**, painel **Garantia**, botão **Pesquisar garantia** habilitado; modais de revisão e histórico abertos.
2. GET da garantia autenticado: HTTP 200, `researchProvider=codex`, `researchAvailable=true`, `canManage=true`.
3. Pesquisa iniciada pelo botão no produto fictício Air Fryer Digital 5 litros: HTTP 200, estado inconclusivo por ausência de evidência aplicável, `externalListingChanged=false`.
4. Avaliação `f0568168-f829-4ca6-9ab3-7e0f00d0e5e7` persistida somente no `.162`; responsável Felipe, ação pesquisa, estado done. Histórico reapresentado após recarregar a página, em 08/09/2026 00:07:31 (São Paulo).
5. Pesquisa externa real, somente leitura da amostra TS Shara, sem gravação dessa amostra: coletor e extrator reais existentes executados com deadline compartilhado de 45 segundos; duração observada 16.365 ms, três conteúdos, uma evidência proposta pela IA e zero candidatos aceitos pelo validador canônico. Identificação proposta `ESTABILIZADOR POWEREST PRO 2000VA BIV/115V 6T` não comprovou o produto exato da amostra. Resultado inconclusivo, sem relaxar o contrato nem inferir equivalência.
6. Testes direcionados: 50 aprovados; um LIVE opt-in omitido. Regressão ampliada de M2M/pricing/permissões/produtos/configurações: 414 aprovados, zero falhas e um LIVE opt-in omitido. `npm run validate` e `npm run build` aprovados; build gerou 120 páginas estáticas. Typecheck executado no validate.

Fontes coletadas no ensaio TS Shara:

- https://tsshara.com.br/produto/estabilizador-powerest-2000-bivolt-115-220v/
- https://tsshara.com.br/produto/estabilizador-powerest-home-2000-monovolt-115v/
- https://tsshara.com.br/wp-content/uploads/2019/07/catalogo-powerest-1500-2500.pdf

Esses links são resultados coletados, não declaração de aplicabilidade de garantia ao SKU da amostra.

## Roteiro histórico do ensaio anterior à retirada da interface

- [Produto real em cadastro de teste inativo — VTK000002](http://localhost:3001/produtos/55f0d5e5-1aeb-4553-8247-5f80d158528f): **Comercial e estoque → Garantia**. Fonte, pesquisa e revisão persistidas; permite consultar evidência e histórico e repetir a pesquisa. Esse cadastro não é uma venda/lote real e não tem anúncio.
- [Cadastro fictício com pesquisa/histórico habilitados](http://localhost:3001/produtos/8b61221f-ef58-49c7-9d06-fdb77ab8e0f0): entrar com a conta existente; **Comercial e estoque → Garantia**. É adequado para conferir botões, pesquisa inconclusiva e histórico. Não atribuir garantia contratual real a produto fictício.
- [Amostra real protegida TS Shara](http://localhost:3001/produtos/bnt-d07-review-001): mesma aba, exemplos visuais identificados como demonstração. Pesquisa e decisões permanecem bloqueadas nessa amostra.

## Complemento autorizado — cadastro real e prova positiva

- Em 08/09/2026 o usuário autorizou criar um cadastro inativo a partir de uma amostra real. Criado pela API existente `/api/produtos`: `55f0d5e5-1aeb-4553-8247-5f80d158528f`, SKU gerado `VTK000002`, nome/marca/GTIN/descrição/imagens da amostra `bnt-d07-review-001`. Descrição sinaliza homologação. Não copiadas ofertas, preço, estoque, identificadores DSLite ou anúncios.
- Preflight repetido antes das operações: TCP `.162`, hostname `supabase-dev`, histórico `20260907213000`, schema/constraints/triggers conferidos. Sem migration/DDL, alteração de autenticação ou mudança de código funcional.
- Pelo navegador, registrado domínio oficial `tsshara.com.br` para a marca TS SHARA, sem aprovar prazos de outros produtos. Pesquisa real limitada pelo botão completou em 10.140 ms, com resultado inconclusivo; não foi convertida em confirmação automática.
- Revisão explícita pelo formulário: quatro anos, trecho literal da página oficial específica do **PowerEst Home #9010 115/115V**, vinculada à identidade da amostra pela descrição da oferta e seu GTIN. Rejeitada variante PRO #9011 retornada na pesquisa; catálogo genérico de 2019 não foi usado como termo específico do produto atual. [Página oficial](https://tsshara.com.br/produto/estabilizador-powerest-home-2000-monovolt-115v/). O [manual vinculado](https://tsshara.com.br/wp-content/uploads/2019/07/manual-powerest-home.pdf) remete o termo à embalagem: a validação de interface não certifica cobertura de lote/venda real, que continua fora do ensaio.
- Avaliação de revisão `f4fcc64b-ba62-434b-85ec-6bb601304577`, 08/09/2026 00:20:20, responsável Felipe. HTTP 200, `comprovada`, fabricante, quatro anos, origem manual/revisada. Após reload, painel manteve a evidência e histórico exibiu fonte, pesquisa e revisão. Nenhum resultado positivo foi atribuído à extração automática.
- Leitura final: `ativo=false`, `estoque=0`, `ml_item_id=null`, `ml_status=sem_anuncio`, `custom_price=null`, `oferta_preferencial_id=null`; zero registros desse produto em `anuncios_ml`, `anuncios_ml_outbox` e `produto_fornecedor_ofertas`.
- Payload completo da amostra original inalterado, SHA-256 antes/depois `e1082cbd186b6854b6405ac370c39afda9430904ac16dc4da0f7dfc9aab4333e`. Sessão automatizada encerrada com escopo local, sem desconectar outras sessões do usuário.
- Novamente executados: 50 testes direcionados aprovados, um LIVE opt-in omitido, `npm run validate` aprovado. Build anterior segue como evidência da mesma aplicação; não repetido por não haver mudança funcional/configuração neste complemento. Produção, porta 3000 e Easypanel preservados; sem push/deploy.

## Pendências reais — não marcar homologado

- Prova técnica de **cadastro real de teste → fonte oficial → pesquisa → revisão documentada → persistência** concluída. Roteiro disponível no link acima, sem necessidade de novos dados para o aceite visual.
- Aceite visual humano pendente. Conciliação da política `VORTEK-WARRANTY-2026-09-06-SELLER-30` de main permanece separada, conforme [evidência do piloto](BNT-AI-PROVIDER-01-validacao.md). Nenhuma regra comercial foi alterada.
- Uso compartilhado, Easypanel e futura página de chat continuam fora do piloto individual.

## Operação e rollback

O servidor precisa permanecer em execução para abrir os links. Após reiniciar o computador, usar o comando local acima, preservando a porta 3000. Para parar, interromper somente esse processo DEV. Preservar avaliação/histórico e a configuração privada; não remover migration nem alterar produção. A preparação local não libera publicação comercial.

Skills de implementação/Supabase orientaram isolamento e preflight; OpenAI Docs orientou a reconfirmação do contrato do extrator. Prevaleceu `.162` do AGENTS sobre o endereço antigo da skill Supabase.

Referências oficiais consultadas: [Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [Playwright BrowserContext](https://playwright.dev/docs/api/class-browsercontext), [Firecrawl Search](https://docs.firecrawl.dev/api-reference/endpoint/search), [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape), [Codex App Server](https://learn.chatgpt.com/docs/app-server).
