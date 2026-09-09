# BNT-PRICING-V2-15 operacional — Configurações iniciais

**Data:** 08/09/2026. **Ambiente:** worktree `vortek-dev`, branch `dev`.
**Estado vigente:** implementação validada e publicada em DEV pelo candidato `982be7b2`, conforme autorização posterior do usuário. Aceite visual inicial de BNT-D20 concedido em 08/09/2026; marco 2 encerrado no recorte inicial, V2-15/D20 integrais permanecem abertos. O aceite está registrado ao final; referências anteriores à pendência descrevem a situação antes dessa decisão.

## Escopo e decisão

Faixas por preço final e piso/alvo/limite permanecem fixos, somente para consulta, conforme escolha explícita do usuário. A UI recebe a política e sua versão da API; não cria outra política ou fórmula.

Editáveis apenas taxa fallback ML, frete fallback `not_specified` e limite de custo da oferta. Radar, experimentos, zero tráfego, agenda noturna, edição das faixas e níveis futuros de autonomia não fazem parte do recorte.

## AS_IS → TO_BE

| Antes | Entrega |
|---|---|
| Política constante importada na tela, DTO local incompleto | Política versionada retornada pela API, DTO compartilhado com o servidor |
| Fiscal pouco visível | Fonte, competência e alíquota de consulta; atalho para Empresa e fiscal sem duplicar edição |
| Salvamento sem distinguir estado salvo/formulário | Alterações pendentes explícitas, confirmação antes/depois, atualização com confirmação de descarte |
| Erro HTTP resolvia a Promise da confirmação | Erro mantém modal aberto e é informado; modo await do `useModal` evita rejeição global não tratada |
| Persistência parcial não tratada na UI; releitura pós-RPC podia ocultar persistência | `persisted: true` explícito em falha após o RPC; aviso durável, releitura somente GET e repetição de PUT bloqueada nessa confirmação |
| Custo inicial arbitrário e campo vazio virava zero | Custo começa vazio; zero explícito é válido, ausência bloqueia simulação |
| Simulador sem preço avaliado nem escolha de parâmetros | Valores salvos ou formulário; preço opcional; taxa/frete do cenário explícitos |
| Resultado reduzido a alvo/lucro e risco de resposta obsoleta | Memórias de preço avaliado, alvo, piso e equilíbrio; custo/taxa/frete/tributo/resultado/margem; invalidação e cancelamento das respostas antigas |

## Fontes e consumidores preservados

| Parâmetro | Persistência existente | Consumidor / limite |
|---|---|---|
| Taxa estimada ML | `configuracoes.pricing_ml_fee_fallback_rate` | contexto econômico e cotação; taxa viva/observada válida, inclusive zero, prevalece |
| Frete estimado | `configuracoes.pricing_unspecified_shipping_cost` | cotação/contexto; fallback apenas para `not_specified`, não substitui fonte viva |
| Limite de custo | `configuracoes.product_inactive_cost_threshold` | catálogo/sync/elegibilidade; não entra no simulador, não muda `produtos.ativo` nem margem |

GET/PUT continuam em `/api/configuracoes/comercial`; POST de simulação em `/api/configuracoes/comercial/simular`. Administrador obrigatório antes do cliente privilegiado. Schema estrito rejeita legado e campos fora do contrato. Reutilizados `save_commercial_pricing_configuration`, `recordConfigurationAudit`, `loadPricingTaxContext`, `simulateProductPricing` e `PricingQuoteSummary`.

Nenhuma conta econômica foi adicionada à interface. O apresentador identifica explicitamente entradas hipotéticas; a apresentação padrão das cotações ML permanece preservada. Salvar parâmetros afeta avaliações futuras dos consumidores existentes, sem criar publicação, reprecificação, outbox ou alteração de produto na rota administrativa.

## Validação executada

- **87 testes Node, zero falhas:** 15 novos testes operacionais mais regressões de contratos administrativos, consumidores, política final, fronteiras, apresentação e Buy Box.
- **13 cenários de navegador isolado, zero erros JavaScript e zero acessos externos:** carregamento; política/fiscal de consulta; zero versus ausência; preço opcional; memória econômica; salvo versus formulário; cancelar confirmação; descarte/releitura; erro e sucesso de gravação; bloqueio durante PUT; persistência parcial sem repetição; resposta de simulação obsoleta; contexto fiscal indisponível; resposta GET inválida; largura 768px sem overflow global. Os 13 checkpoints agrupam essas verificações.
- `npm run validate`: lint e TypeScript aprovados.
- `npm run build`: aprovado; tipos verificados separadamente por validate, pois o build do projeto pula essa checagem.
- `git diff --check`: aprovado.

Os testes de rotas usam cliente de banco isolado e o motor econômico real. A conferência de navegador monta o componente e o Provider reais com respostas controladas, sem servidor remoto, sessão, banco ou ML. Foram simulados 3 PUTs e 9 cenários econômicos; **não houve alteração de configuração em ambiente real**. Não confundir essa prova com homologação autenticada ou aceite D20.

```bash
node --test tests/bnt-pricing-v2-15-operational.test.js tests/bnt-cfg-03-commercial-pricing.test.js tests/config-admin-core.test.js tests/configuracoes-ui-responsibilities.test.js tests/m2m-prc-01-final-price-policy.test.js tests/m2m-prc-03-consumers.test.js tests/m2m-cfl-04-competition.test.js
npm run validate
npm run build
```

Navegador: `tests/browser/bnt-pricing-v2-15-smoke.cjs`, usando Playwright 1.62.1 e esbuild 0.28.1 já instalados no cache local, informados por `BNT_PLAYWRIGHT_PATH` e `BNT_ESBUILD_PATH`. Sem instalar ou adicionar dependência ao projeto. O script gera screenshots em diretório temporário próprio; nesta execução: `/tmp/bnt-v2-15-ui-9LRRwA/commercial-desktop.png` e `commercial-768.png`, ambos inspecionados. A imagem estreita também registra a falha administrativa deliberadamente simulada.

## Contratos oficiais consultados

O formulário exige atualização explícita do resultado após `setFieldsValue`, que não dispara `onValuesChange`; confirmação mantém-se aberta quando o salvamento rejeita, e o hook oferece modo await. Conferidos [Form Ant Design 5.29.3](https://raw.githubusercontent.com/ant-design/ant-design/5.29.3/components/form/index.en-US.md) e [Modal Ant Design 5.29.3](https://raw.githubusercontent.com/ant-design/ant-design/5.29.3/components/modal/index.en-US.md), além da implementação instalada de `ActionButton`/`useModal` para rejeições tratadas.

Respostas fora de ordem são invalidadas conforme o [React — carregamento em Effects](https://react.dev/reference/react/useEffect#fetching-data-with-effects). RPC existente conferido na [documentação Supabase JS](https://supabase.com/docs/reference/javascript/rpc). Guia de Route Handlers lido em `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, Next 16.3.3. Interceptação sem chamada à API conforme [Playwright](https://playwright.dev/docs/mock#mock-api-requests); bundle temporário em memória conforme [esbuild](https://esbuild.github.io/api/#write).

## Limites, rollback e próxima ação

- Sem novas tabelas, migrations, variáveis de runtime ou dependências. Nenhum acesso ou escrita em Supabase, Easypanel ou produção nesta tarefa. `.160` continua produção/read-only para banco; `.162` é o único DEV gravável.
- Mantidas as seis alterações documentais pré-existentes. AGENTS, `.rules`, `.gitignore`, política econômica e migrations históricas intactos.
- A auditoria administrativa continua separada da persistência. Sua falha agora é explícita; este recorte não torna as duas operações uma transação nem reconstrói histórico perdido.
- Rollback de código: reverter seletivamente esta entrega, preservando trabalho anterior. Não requer rollback de banco. Se um administrador mudar valores futuramente, restaurar pelos mesmos controles auditados; reverter UI não restaura parâmetros automaticamente.
- `origin/main` local observado em `518bcd40`; não foi feito fetch/auditoria de delta produtivo nesta tarefa. Paridade final permanece no marco próprio de transição.
- Próxima ação técnica: **aceite inicial de BNT-D20**, depois de disponibilizar o candidato mediante solicitação de push/deploy. Sem antecipar marco 2 integral, Assistente ou capacidades futuras.
- Aceite autenticado/prova externa PUB-GATE e frete ME2 permanecem no marco 6; capacidade produtiva no marco 5. Nenhum controle comercial foi habilitado por esta entrega.

## Publicação DEV autorizada — 08/09/2026

- Implementação/testes no commit `1076f849`; documentação e sequência aprovada no candidato `982be7b201359ae64a867a3ff7f804b1fae20611`. Push normal somente de `dev`, confirmado no remoto antes do deploy.
- Preflight conferiu webhook com o token do serviço `local/vortek-erp-dev`, origem `felipe-nomelini/vortek`, ref `dev`, autoDeploy desabilitado e host Easypanel `192.168.1.160`. Nenhum token foi reproduzido. Usados `npm run deploy:easypanel -- --dry-run` e um único disparo de `npm run deploy:easypanel`, conforme [contrato oficial de deployments](https://easypanel.io/docs/services/app#deployments).
- Validação repetida antes da publicação: **100 testes Node aprovados** (87 do lote e 13 do contrato de deploy), **13 checkpoints de navegador isolado**, `npm run validate`, `npm run build` e `git diff --check`. Sem novas dependências. Screenshots desta repetição: `/tmp/bnt-v2-15-ui-AnHaho/`.
- Ação Easypanel `cmtt1aeq9000907o99o0791ga`: `done`; criada às **18:59:42 UTC**, concluída às **19:02:17 UTC (16:02:17 BRT)**. Build remoto compilado e 122 páginas geradas.
- Serviço DEV: versão Docker `9692`, atualização `completed`, réplica em execução e `GIT_SHA` igual ao candidato. Apenas `GIT_SHA` e `DEPLOY_TIMESTAMP` mudaram no ambiente do serviço. Endpoint Supabase preservado; `ML_PRICING_EXECUTION_MODE` continua ausente/desabilitado.
- Smoke via `https://dev.bentevi.shop`: `/login` HTTP 200; `/configuracoes?tab=comercial` redireciona ao login sem sessão (307); GET/PUT `/api/configuracoes/comercial` e POST `/api/configuracoes/comercial/simular` retornam 401 sem sessão. O novo asset comercial retorna HTTP 200 e contém os três blocos: política de consulta, parâmetros e simulador. Não houve salvamento de parâmetros nem simulação autenticada no ambiente remoto.
- Produção comparada apenas por metadados do serviço: `local_vortek-erp` permaneceu na versão `9677`, `UpdatedAt=2026-09-08T16:48:05.797525575Z`, SHA `518bcd40bd092a6f04abc0bf1abd261cfa44b517`. Sem acesso ao PostgreSQL, migration, alteração de configuração, execução comercial ou deploy produtivo.
- `AGENTS.md`, `.gitignore`, dependências e migrations preservados. Regras e skills locais continuam ignoradas. Registro pós-deploy enviado em commit documental; autoDeploy desligado, sem necessidade de outra imagem.
- **Próximo passo:** usuário conferir Configurações → Comercial e conceder o aceite inicial BNT-D20. O smoke não equivale a esse aceite nem encerra o marco 2 automaticamente.

<a id="aceite-inicial-do-usuario--08092026"></a>

## Aceite inicial do usuário — 08/09/2026

Após o deploy, o usuário concedeu o aceite inicial de Configurações e solicitou o planejamento de BNT-AI-00. **Marco 2 encerrado somente no recorte inicial**: controles existentes, faixas fixas de consulta, parâmetros e simulador já publicados. D20/V2-15 integrais e capacidades adiadas continuam abertos.

É um aceite humano explícito, separado dos testes e smoke acima; não foi produzida nova prova funcional autenticada, publicação comercial ou validação ME2 nesta confirmação. Nenhum controle comercial foi habilitado. Continuação em [BNT-AI-00](BNT-AI-00-validacao.md), com assinatura ChatGPT como única modalidade escolhida; o gate dessa ação depende de suas próprias evidências.
