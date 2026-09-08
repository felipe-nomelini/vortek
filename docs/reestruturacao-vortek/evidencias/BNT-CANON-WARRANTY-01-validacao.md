# BNT-CANON-WARRANTY-01 — Garantia por evidência

## Fechamento DEV — 08/09/2026

**Concluída no escopo DEV/homologação. Próxima ação: planejar BNT-PRICING-V2-08 / M2M-CFL-04 — Buy Box econômica.** Os registros de pendências abaixo são fotografias anteriores, superadas por este fechamento somente onde explicitado.

- Conciliação: mantém-se o contrato V2 aprovado; fallback vendedor 30 dias de main NÃO INCORPORADO, conforme comparação abaixo. Nenhuma nova decisão de prazo ou nova fórmula de garantia.
- Lote `e036397bb2df1e2c0758b3e7020208ec0652563c` commitado e enviado a `origin/dev`; `npm run deploy:easypanel` executado pelo webhook existente, reconfirmado por comparação privada com o token do serviço `local/vortek-erp-dev`, origem GitHub ref `dev`, auto deploy desabilitado.
- Easypanel: ação `cmts65gr7000107o91ulwat0i`, build concluído e serviço DEV atualizado em `2026-09-08T04:30:35.253Z`, versão 9578, `UpdateStatus=completed`; `GIT_SHA` corresponde a `e036397`.
- Chromium autenticado em `http://localhost:3001` e `https://dev.bentevi.shop`: detalhe `VTK000002`, aba Comercial e estoque sem painel/botões de garantia; configurações Mercado Livre sem card nem links de revisão, com regras protegidas preservadas. GET de configurações retornou 200; zero erros JS e zero mutações de aplicação durante o ensaio.
- GET autenticado `/api/produtos/55f0d5e5-1aeb-4553-8247-5f80d158528f/warranty` retornou 200, mesma avaliação e fingerprint do snapshot lido diretamente do `.162`, fabricante 4 anos e histórico intacto. Snapshots completos da garantia e estado do produto comparados antes/depois: sem alteração.
- Autenticação de teste somente na conta existente, via `generateLink`/`verifyOtp`, sem envio de email, criação de usuário ou alteração de senha. Antes de cada ação Auth, preflight TCP `.162`, hostname `supabase-dev`, histórico de migration `20260907213000` e schema afetado; sessão encerrada com `scope: local`. Nenhuma escrita de dados de negócio ou migration.
- 428 regressões aprovadas, um LIVE opt-in omitido (429 testes); `npm run validate`, `npm run build` (120 páginas) e `git diff --check` aprovados. Inclui garantia/Codex, M2M, pricing, permissões, capacidade, interface/configurações e 13 testes de deploy.
- Produção: serviço `local_vortek-erp` permaneceu na versão 9540 e timestamp `2026-09-08T02:32:28.030966423Z`, mesmos valores do preflight; nenhuma alteração de serviço, banco, conta ou anúncio produtivo.
- Evidências visuais locais: `/tmp/bentevi-warranty-close-Mgs3gq/dev-produto.png` e `/tmp/bentevi-warranty-close-Mgs3gq/dev-configuracoes.png`; roteiro de leitura autenticada em `verify.cjs` no mesmo diretório, sem secrets gravados. São artefatos temporários, não fixtures nem arquivos publicados.

**Limites preservados:** a tela de integração exibe conta ML desconectada e último erro de allowlist da conta de teste; não houve reconexão nem edição de permissões nesta tarefa. Retomar acesso autorizado no PUB-GATE antes de prova ML. Frete ME2 real, publicação/read-back e autonomia permanecem pendentes nas ações próprias, sem reabrir o escopo visual da garantia. Pesquisa remota indisponível continua explícita e não cria prazo; o piloto ChatGPT/Codex segue exclusivamente individual/local. Não se certifica produção nem uso compartilhado.

Rollback: reverter seletivamente o lote visual pelo Git e novo deploy exclusivamente DEV se necessário; preservar regras, tabelas e histórico. O fechamento documental posterior não exige outro build: não modifica a aplicação implantada.

## Conciliação de política — 08/09/2026

O pedido de resolver as pendências mantém o escopo aprovado: retirar a gestão visual sem alterar as regras atuais. Reconfirmados por `git ls-remote` e leitura local do ref: `origin/main` em `3ed7f1273d50229f1c17aee744dfc90ad9e7d66f`; nenhum commit de garantia nos arquivos de resolução/preparação/criação entre `dd34980` e esse SHA. Não se trata de certificação da revisão implantada em produção nem de auditoria dos outros domínios.

| Divergência | Classificação para a V2 | Evidência/resultado |
| --- | --- | --- |
| Main `VORTEK-WARRANTY-2026-09-06-SELLER-30`: ausência de fonte gera 30 dias pelo vendedor | **NÃO INCORPORAR — comportamento substituído pelo contrato V2 aprovado** | Cânon Comercial §22 e tabela de decisões: prazo por produto; ausência de classificação documentada não fabrica 30/90 dias. V2 sem evidência continua inconclusiva. Não ampliar compromisso comercial da Bentevi por cópia de fallback. |
| Fabricante/fornecedor comprovados, equivalência anos/meses e conflitos | **PRESERVADO/ADAPTADO** | Resolvedor V2 existente e regressões de precedência, conflito e categoria; fabricante não é confundido com fornecedor. |
| Garantias já declaradas em anúncios existentes | **PRESERVAR** | Nenhuma escrita ML, migração retroativa ou alteração de compromisso existente autorizada nesta conciliação. |

Não foi necessário mudar o motor. `src/lib/product-warranty.ts` tem o mesmo SHA-256 da base `4c6864f`: `b42c51c435e24aa9b822b3737bb6ed714236b089d04bb3388b7b19213ae560b3`. A conciliação encerra a divergência documental, sem introduzir garantia universal de 12 meses ou fallback vendedor 30 dias. A pesquisa no servidor continua sujeita à disponibilidade do provedor existente; o piloto Codex permanece individual/local, não uma exigência nova de compartilhamento nesta etapa.

Homologação da retirada em andamento; registrar abaixo somente após deploy e conferência autenticada reais. PUB-GATE, frete ME2 e autonomia continuam em suas etapas próprias.

## Atualização — retirada dos controles da interface (08/09/2026)

**Encerramento do ajuste visual:** o usuário solicitou fechar a etapa em 08/09/2026. Aprovação registrada para a retirada implementada; não houve nova decisão de prazo, concessão ou comprovação de garantia. A alteração de interface está encerrada; publicação/conferência remota e conciliação comercial da WARRANTY-01 continuam pendentes. Este registro não declara um teste de navegador que não ocorreu.

Por decisão explícita do usuário, foram retirados o painel de garantia do detalhe do produto e o card de garantia nas configurações Mercado Livre. Na criação do anúncio, tipo/prazo aparecem somente como texto; os avisos de incompatibilidade permanecem, sem links para revisão em um painel que deixou de existir. Os demais termos continuam editáveis como antes.

Alteração exclusivamente visual: APIs, resolvedor, pesquisa de preparação, evidências, histórico e bloqueios comerciais preservados. Nenhum prazo universal introduzido, nenhuma migration, escrita de banco, alteração ML, push ou deploy. O componente visual removido pode ser recuperado pelo histórico Git; os registros não foram apagados. O fluxo de gestão visual descrito na fotografia abaixo é histórico, não uma instrução atual de uso.

Validação local: 85 testes aprovados e um LIVE opt-in omitido, incluindo renderização do bloco real de termos com Ant Design, prazo de 4 anos preservado, ausência de opções de garantia, ausência de prazo explícita, impedimento de categoria e manutenção dos outros termos. `npm run validate`, `npm run build` (120 páginas) e `git diff --check` aprovados. Não houve conferência autenticada em navegador ou homologação remota desta mudança. A conciliação comercial continua pendente; retirar a interface não fecha WARRANTY-01.

---

**Atualização operacional de 08/09/2026:** Firecrawl/runtime local configurados; pesquisa pelo navegador e histórico persistido validados, além de coleta/extração real sem gravação da amostra. [Links para teste, evidências e pendências atuais](BNT-CANON-WARRANTY-01-runtime-local.md). O relato abaixo preserva a fotografia de 07/09; garantia ainda não homologada.

Data: 07/09/2026. Base: `562ffa339cbd2cc65e22b609f2cbd64535fef7af`, branch `dev` inicialmente limpa.

**Estado: implementação local e banco DEV validados; pesquisa externa real e aceite visual pendentes. Não marcar o gate de garantia como homologado.** Nenhum push/deploy desta entrega, acesso à produção ou escrita no Mercado Livre.

## AS_IS → TO_BE

| Consumidor | Antes | Agora |
| --- | --- | --- |
| Configurações / Mercado Livre | Prazo/tipo global editável | Política por evidência; PATCH global retorna 410; colunas e auditoria históricas preservadas |
| Preparação do anúncio | Garantia global quando aceita pela categoria | Pesquisa pontual na primeira preparação, avaliação por produto, revisão e compatibilidade explícitas |
| Sugestão de atributos | Valores globais; possibilidade de cair no preenchimento genérico | WARRANTY_TYPE/TIME exclusivamente do resolvedor canônico, sem fallback de IA |
| Descrição | Texto podia repetir promessa sem comprovação | Texto específico do anúncio normalizado com garantia comprovada, sem alterar cadastro mestre |
| Criação | Termos globais/combinados com edição | Revisão atual obrigatória, termos coerentes e descrição sem promessa contraditória; bloqueio comercial mantido |
| Detalhe do produto | Sem comprovação administrável | Garantia em Comercial/estoque: fonte, trecho, prazo, revisão, domínio oficial e histórico |

## Contrato e decisões

- Fabricante comprovado → fornecedor comprovado → legal conforme classificação documentada: durável 90 dias; não durável 30 dias. Sem 12 meses universais e sem somar prazo contratual/legal.
- Fonte da informação não se confunde com concedente. Descrição da oferta ativa pode gerar candidato do fornecedor, nunca promessa do fabricante. `tempo_garantia` sem unidade documentada não gera duração. Referência interna `vortek:offer:<id>` vincula o candidato à oferta efetiva e requer revisão.
- Comprovação automática exige domínio previamente aprovado para aquela marca/fornecedor, trecho literal da página coletada, identidade do produto, duração e aplicação explícita no Brasil. Aprovar domínio não aprova prazo para todos os SKUs. Kits exigem comprovação do conjunto.
- Ausência/ambiguidade permanece inconclusiva ou pendente; fontes contraditórias não são arbitrariamente escolhidas. Todas as durações do trecho são confrontadas. 12 meses e 1 ano equivalem; dias não são aproximados em meses.
- Estados: `comprovada`, `legal`, `pendente_validacao`, `conflito`, `inconclusiva`. Revisão manual exige motivo, produto compatível, país e prazo coerentes; substitui a avaliação vigente, preservando histórico.
- Admin e gerente gerenciam; operador/visualizador apenas consultam. Amostras protegidas não são alvos graváveis. Exemplos visuais são identificados como demonstração, não evidências.
- Categorias ML são consultadas por `/categories/{id}/sale_terms`: tipo e unidade/enumeração precisam representar o prazo. Conversão exata de anos/meses permitida; não usar primeiro valor aceito nem inventar duração.
- Descrição sugerida continua usando o mecanismo existente, mas a cláusula de garantia é normalizada pela política canônica. Texto contraditório enviado à criação é recusado. Descrição específica de anúncio não é salva automaticamente no produto pelo botão de sugestão.

## Pesquisa e persistência

- Reutilização de Firecrawl e OpenRouter existentes: uma busca com até três páginas e, no máximo, um PDF vinculado à mesma origem; limite total de 45 segundos, sem retries. Não há varredura do catálogo, cron, fila ou dependência nova.
- Pesquisa ocorre na primeira preparação sem avaliação aplicável ou por ação explícita. GET apenas lê. Falha registrada não é repetida automaticamente a cada abertura. Nova pesquisa indisponível preserva avaliação anterior aplicável e exibe aviso.
- `warranty_sources`: decisões históricas sobre domínio/identidade; revogação invalida o uso automático da fonte. `product_warranty_assessments`: comando, autor, contexto, resultado, início/fim e deadline. RLS habilitada; browser sem acesso direto e service role sem DML direto.
- Comandos UUID idempotentes, lock por produto e finalização restrita ao mesmo autor com alçada. Resultado depois de 50 segundos ou com contexto alterado é descartado como inconclusivo. Produto, oferta, fornecedor operacional e composição participam do fingerprint.
- Leitura de contexto, fingerprint, avaliação e fontes ocorre num único snapshot SQL. Histórico da interface mostra as últimas 50 decisões com responsável; registros completos permanecem no banco. Fontes são deduplicadas no banco, sem buscar toda a tabela histórica no browser.
- Não há alteração de preço, atividade, anúncio, estoque, tributo, override ou liquidação nesta entrega. `pricing_execution_not_ready` continua bloqueando escritores comerciais na rota e no transporte.

## Validações

- Migration nova `20260907213000_bnt_canon_warranty.sql` ensaiada com rollback e aplicada somente em **192.168.1.162 / supabase-dev**, com conferência de destino TCP, hostname, histórico e schema. Conteúdo aplicado igual ao arquivo versionável; nenhuma migration anterior reescrita.
- Tipos das duas tabelas e cinco RPCs gerados pelo metadata desse mesmo DEV; contratos não relacionados preservados.
- `tests/product-warranty.sql`: idempotência, comandos concorrentes, finalização repetida, preservação após pesquisa indisponível, fonte, contexto alterado, prazo expirado, alçada, RLS e privilégios. Ensaio e execução pós-migration aprovados, ambos revertidos.
- Duas conexões reais ao `.162`: segunda transação bloqueada pelo advisory lock da primeira, comprovada por `lock_timeout`; ambas revertidas. Zero avaliações de garantia persistidas pelos testes.
- RPC de snapshot respondeu HTTP 200 no PostgREST `.162`; payload real aceito pelo contrato tipado, sem imprimir dados dos produtos.
- **386 testes Node aprovados**: domínio, pesquisa HTTP simulada, limite de fontes/tempo, extração, API/permissões, retirada do endpoint global e SSR com Ant Design real, além das regressões M2M, pricing, capacidade e detalhe do produto. SSR não substitui aprovação visual em navegador.
- `npm run validate` e `npm run build` aprovados, sem warnings de lint; build mantém configuração existente que pula typecheck, executado separadamente no validate. `git diff --check` aprovado; AGENTS.md e .gitignore não alterados.

Comando de regressão:

```bash
node --test tests/m2m-*.test.js tests/pricing-audit*.test.js tests/pricing-overrides.test.js tests/pricing-clearances.test.js tests/permissions.test.js tests/fulfillment-capacity.test.js tests/bentevi-product-detail.test.js tests/product-warranty.test.js tests/bnt-cfg-05-mercado-livre.test.js tests/bnt-cfg-07-integrations.test.js tests/configuracoes-ui-responsibilities.test.js
```

## Pendências e próxima ação

1. **Piloto concluído em 07/09/2026:** `BNT-AI-PROVIDER-01` comprovou extração real com login ChatGPT no escopo individual/local de Felipe; [evidência própria](BNT-AI-PROVIDER-01-validacao.md). OpenRouter não é exigido nesse caminho. Demais consumidores, modalidade compartilhada e Easypanel não foram migrados/homologados.
   **Pendência vigente:** configurar `FIRECRAWL_API_KEY` **de desenvolvimento** e o runtime local completo; executar pesquisa real limitada com domínio oficial aprovado e evidência do produto. O extrator passou com amostras sintéticas, sem coleta Firecrawl real nem gravação desses exemplos no banco. Não reutilizar credenciais de produção.
2. Push/deploy desta entrega somente quando solicitado e aceite visual em `dev.bentevi.shop`: fabricante, fornecedor, legal, pendência, conflito e indisponibilidade; revisão e histórico. Nenhuma aprovação visual desta etapa foi presumida.
3. Contrato de representação real de garantia no ML permanece sob o gate de publicação, sem POST/PUT externo nesta etapa.
4. **Paridade identificada em BNT-AI-PROVIDER-01:** reconciliar o fallback comercial `VORTEK-WARRANTY-2026-09-06-SELLER-30` de `main` (commit `4a40832`, presente no ref `dd34980`) com o contrato de evidência/classificação legal da V2. Não concluir a garantia ou copiar os 30 dias silenciosamente; [classificação e fontes de código](BNT-AI-PROVIDER-01-validacao.md#decisão-e-estado-encontrado).

Depois de validar a etapa, a fila segue para **BNT-PRICING-V2-08 / M2M-CFL-04 — Buy Box econômica**. Frete vivo ME2 na conexão autorizada da conta real e os demais gates comerciais continuam pendentes; esta entrega não os substitui.

## Rollback

Reverter seletivamente a aplicação mantendo a migration, as avaliações e a trilha. Preservar o bloqueio comercial: rollback não pode reabilitar publicação com garantia global. Não apagar histórico nem reescrever a migration aplicada. Ajustes posteriores de banco exigem nova migration e preflight `.162`.

## Referências

Skills locais de implementação/Supabase orientaram preflight, schema incremental e validações, sempre sob o mapa do AGENTS (`.162` DEV).

- [Firecrawl Search](https://docs.firecrawl.dev/api-reference/endpoint/search) e [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape).
- [OpenRouter Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request).
- [Mercado Livre — publicação e termos de venda](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos).
- [CDC atualizado, arts. 24, 26 e 50](https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html).
- [PostgreSQL 17 — locks](https://www.postgresql.org/docs/17/explicit-locking.html) e [Supabase — funções e privilégios](https://supabase.com/docs/guides/database/functions).
- Guias instalados de Route Handlers do Next.js 16.3.3; [Ant Design 5 — Form](https://5x.ant.design/components/form/).
