# Bentevi — Dossiê completo de parametrização

**Identificador:** `BNT-CFG-00`  
**Data da fotografia:** 04/09/2026  
**Ambiente:** desenvolvimento/homologação  
**Rota final:** `/configuracoes`  
**Acesso:** somente `admin`

---

## 1. Decisão

`/configuracoes` deve se tornar o centro administrativo global do ERP, reunindo parâmetros de negócio, operação e opções técnicas avançadas. A ampliação não será feita como um formulário genérico nem como uma única entrega: cada domínio será conectado à sua fonte real e validado isoladamente antes de aparecer como configurável.

O inventário encontrou configurações em cinco formas atuais:

1. dados persistidos em `empresa`, `configuracoes` e `integracoes`;
2. preferências específicas em tabelas de domínio, como `whatsapp_alert_settings`;
3. valores internos em `sync_runtime_config`;
4. variáveis de ambiente lidas somente no servidor ou incorporadas ao build;
5. constantes espalhadas pelos serviços e contratos de domínio.

Nem toda constante é uma preferência. Contratos legais, segurança, idempotência, estados canônicos, limites impostos por APIs e identidade do ambiente continuarão fixos ou somente leitura.

---

## 2. Estado atual confirmado

### 2.1 Interface existente

A página já foi separada por `UI-03` em quatro componentes independentes:

| Área atual | Fonte principal | Capacidades atuais |
|---|---|---|
| Empresa | `empresa` | nome, nickname ML, CNPJ, contato, endereço livre, UF e município fiscal |
| Integrações | `integracoes` | Mercado Livre, DSLite e Brasil NFe; credenciais write-only, status e teste |
| Usuários | Auth + `profiles` | criar, editar, atribuir cargo e redefinir senha |
| Preferências | `configuracoes` | margem padrão, push, início de atividade, alíquota PGDAS e provedor fiscal fixo |

`Mercado Pago` existe no enum, no banco e no backend, mas não aparece na interface atual. WAHA, SMTP, Push/VAPID, GitHub operacional, OpenRouter e Firecrawl são integrações de runtime sem painel próprio.

### 2.2 Limitações comprovadas

- `margem_lucro` é editável, mas a estratégia central também possui faixas e lucros mínimos fixos; a interface não demonstra qual regra efetivamente vence em cada fluxo.
- a meta diária do Dashboard/TV vem de `TV_DAILY_PROFIT_GOAL`, fora da página;
- garantia padrão, frete estimado sem valor, descontos por quantidade e limite de custo alto são constantes de negócio;
- agendas, concorrência, retries, timeouts e lotes dos jobs estão distribuídos entre o registro de sync e serviços;
- `whatsapp_alert_settings` existe no schema, mas o serviço ativo escolhe destinatários por variável de ambiente ou fallback, sem consumir a tabela;
- `dslite_catalog_xml_urls` usa `sync_runtime_config`, uma estrutura interna de string sem contrato administrativo;
- URL pública, ambiente fiscal, Supabase, chaves internas e segredos de links públicos são parâmetros de infraestrutura, não preferências comuns;
- o nickname do Mercado Livre é editável como dado da empresa, embora a identidade conectada também seja conhecida pela integração; a etapa correspondente deve eliminar a ambiguidade de fonte.

---

## 3. Classificação obrigatória

Cada item deve receber uma destas classes antes da implementação:

| Classe | Comportamento na interface |
|---|---|
| `EDITAVEL_IMEDIATO` | persistido com validação e consumido na próxima operação |
| `EDITAVEL_CONTROLADO` | alteração administrativa com confirmação, auditoria e limites seguros |
| `SECRET_WRITE_ONLY` | nunca retornado; a tela mostra apenas configurado/não configurado, substituição e remoção |
| `STATUS_SOMENTE_LEITURA` | diagnóstico, origem, ambiente, última validação e dependências, sem campo editável |
| `PREFERENCIA_LOCAL` | pertence ao usuário/navegador e não vira regra global |
| `INVARIANTE` | contrato legal, externo, de segurança ou integridade; não configurável |
| `OBSOLETO` | sem consumidor atual; deve ser removido em tarefa própria, não reapresentado |

### Regras de governança

- configurações globais pertencem à empresa e são isoladas pelo banco de cada ambiente;
- salvar é contextual por seção; não haverá “salvar tudo”;
- toda configuração técnica editável informa unidade, faixa segura, padrão e efeito;
- alteração técnica relevante registra usuário, instante, valor anterior sanitizado e novo valor sanitizado;
- collections usam estruturas tipadas; não serão armazenadas como JSON ou strings livres apenas por conveniência;
- `sync_runtime_config` continua reservado a coordenação interna, cursores e fixtures de homologação;
- nenhuma opção será exibida como funcional antes de todos os consumidores ativos usarem a mesma fonte;
- secrets nunca aparecem em GET, logs, auditoria ou mensagens da interface.

---

## 4. Arquitetura de informação final

| Seção | Conteúdo |
|---|---|
| Empresa e marca | identidade operacional, contato, endereço e identidade dos documentos |
| Fiscal | cadastro do emitente, Simples Nacional, defaults fiscais permitidos e saúde do emissor |
| Comercial e precificação | margens, lucros mínimos, faixas, custo alto, frete estimado e preço por quantidade |
| Produtos e estoque | políticas de ativação, estoque interno, recebimento e origens de oferta |
| Pedidos e fulfillment | prioridade de atendimento, prazos operacionais, etiqueta e expedição |
| Compras e fornecedores | modalidades, pagamentos, fornecedor e políticas específicas sem listas duplicadas |
| Mercado Livre e anúncios | conta conectada, garantia, preço, catálogo, publicação e limites permitidos |
| Dashboard, TV e metas | metas globais e parâmetros de exibição operacional |
| Notificações | canais, eventos, destinatários e testes |
| Integrações | credenciais write-only, endpoints permitidos, conexão, callback/webhook e diagnóstico |
| Usuários e permissões | contas e atribuição aos cargos canônicos |
| Sistema e jobs | agenda, ativação, limites operacionais, timeouts, retries e saúde, em área avançada |
| Ambiente e segurança | identidade do ambiente, URLs, build e estado dos secrets, somente leitura |

A navegação permanece numa única rota. As seções poderão usar grupos internos, mas não serão transformadas em novas páginas sem necessidade operacional.

---

## 5. Inventário por domínio

### 5.1 Empresa e marca

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Nome comercial | `empresa.nome` | `EDITAVEL_IMEDIATO`; usado em cabeçalhos e documentos próprios |
| Razão social | ausente | adicionar somente quando houver consumidor fiscal/documental comprovado |
| CNPJ | `empresa.cnpj` | `EDITAVEL_CONTROLADO`; validar dígitos e impacto fiscal |
| Inscrição estadual | ausente | candidato fiscal; só implementar junto do payload do emitente |
| E-mail e telefone | `empresa` | `EDITAVEL_IMEDIATO` |
| Endereço | texto livre | substituir em tarefa própria por campos estruturados sem perder o valor existente |
| UF e município IBGE | `empresa` | `EDITAVEL_CONTROLADO`; já consumidos no CFOP e emissão |
| Nickname ML | `empresa.nickname` | deixar somente leitura ou remover após consolidar a conta conectada como fonte |
| Logo usado pelo ERP/PDF | assets versionados Bentevi | `INVARIANTE` desta versão; não criar upload global sem requisito de multimarcas |
| Fuso horário | `America/Sao_Paulo` fixo | `INVARIANTE` enquanto a operação for exclusivamente brasileira |

### 5.2 Fiscal

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Início da atividade | `configuracoes.simples_inicio_atividade` | `EDITAVEL_CONTROLADO`; remover data hardcoded da API/UI |
| Alíquota confirmada e data PGDAS | `configuracoes` | `EDITAVEL_CONTROLADO`; manter validação conjunta |
| RBT12, faixa e alíquota estimada | calculados | `STATUS_SOMENTE_LEITURA` |
| Tabela e piso do Simples | regra legal em `pricing.ts` | `INVARIANTE`; atualizar por código e referência legal |
| Provedor NF-e | apenas Brasil NFe | `INVARIANTE`; remover seletor com opção única e mostrar provedor ativo |
| Ambiente Brasil NFe | variável de ambiente | `STATUS_SOMENTE_LEITURA`; nunca permitir troca casual entre homologação e produção |
| Ambiente de retorno fiscal | variável de ambiente | `STATUS_SOMENTE_LEITURA` |
| Modalidade de frete padrão | `NFE_DEFAULT_MODFRETE` | candidato `EDITAVEL_CONTROLADO`, após validar todos os emissores |
| Validação fiscal estrita | `STRICT_NFE_VALIDATION` | `INVARIANTE` de integridade; exibir estado, sem desligamento pela UI |
| CFOPs permitidos | contrato fiscal `5120/6120` | `INVARIANTE` até requisito fiscal específico e revisão contábil |
| Regras de cancelamento e CCe | domínio/API | `INVARIANTE`; a UI apenas informa disponibilidade |

### 5.3 Comercial e precificação

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Margem padrão | `configuracoes.margem_lucro` | manter somente se todos os consumidores forem identificados; caso contrário, consolidar ou aposentar |
| Faixas de custo | até 400, até 1.000 e acima | `EDITAVEL_CONTROLADO`; coleção tipada e sem sobreposição |
| Margem por faixa | 15%, 20% e 25% | `EDITAVEL_CONTROLADO`; validar imposto + taxa + margem abaixo de 100% |
| Lucro mínimo por faixa | R$ 20, R$ 60 e R$ 150 | `EDITAVEL_CONTROLADO`; valor não negativo |
| Limite de custo para inativação | R$ 2.000 | `EDITAVEL_CONTROLADO`; substituir a constante central, preservando fonte única |
| Custo de frete não informado | R$ 30 | `EDITAVEL_CONTROLADO`; mostrar quando é fallback e não frete real |
| Faixas de preço por quantidade | 3/5/10 unidades, 3%/4%/5% | `EDITAVEL_CONTROLADO`; respeitar resposta e elegibilidade do ML |
| Taxa ML | vem do anúncio/produto, com fallback localizado | valor observado quando disponível; qualquer fallback global deve ser explícito e único |
| Regras de break-even | cálculo central | `INVARIANTE`; não permitir configuração que gere denominador inválido |

### 5.4 Produtos, estoque e fulfillment

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Política de produto ativo por custo | consumidor da regra central | controlada pela configuração comercial do limite de custo |
| Prioridade entre estoque interno e fornecedor | regra consolidada de fulfillment | `INVARIANTE` até existir nova regra de negócio aprovada |
| Cálculo de quantidade segura | `max(interno, fornecedor)` | `INVARIANTE` de integridade |
| Fornecedores bloqueados para dropshipping | IDs fixos em policy | migrar para propriedade operacional do fornecedor, sem lista global paralela |
| Endereço de devolução do estoque interno | IDs/CEP fixos | `EDITAVEL_CONTROLADO`; validar com a conta ML conectada antes de ativar |
| URLs XML por fornecedor | `sync_runtime_config` | mover para configuração tipada da integração/fornecedor |
| Tamanho de lote de catálogo/ofertas | constantes técnicas | área avançada apenas se houver ganho operacional comprovado e faixa segura |
| Regras de SKU, estoque reservado e kits | contratos centrais | `INVARIANTE`; não configuráveis como texto livre |

### 5.5 Pedidos, compras e fornecedores

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Tempo para destacar atraso operacional | 1 hora | `EDITAVEL_CONTROLADO` com unidade em minutos |
| Criação de pedido DSLite | ação operacional explícita | não criar automação configurável sem tarefa funcional própria |
| Estratégia de etiqueta placeholder | arquivos e policy por fornecedor | parametrizar por fornecedor somente se o contrato DSLite aceitar; preservar bloqueios fiscais |
| Pagamento de fornecedor | modo vindo da oferta/compra | `STATUS_SOMENTE_LEITURA`; não substituir a origem por preferência global |
| Modalidades e apelido do fornecedor | cadastro do fornecedor | editar na página responsável e refletir aqui por link, sem duplicar fonte |
| Tipos de ledger | contrato canônico | `INVARIANTE` |
| Estados e progresso da venda | contratos canônicos | `INVARIANTE` |

### 5.6 Mercado Livre e anúncios

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Client ID | `integracoes.client_id` | `EDITAVEL_CONTROLADO` |
| Client Secret, access e refresh token | `integracoes` | `SECRET_WRITE_ONLY`; access/refresh continuam geridos pelo OAuth |
| Redirect URI | derivada da URL da aplicação | `STATUS_SOMENTE_LEITURA`; deve coincidir com o app externo |
| Seller autorizado | allowlist de runtime + usuário OAuth | identidade e status somente leitura; alteração exige ação técnica separada |
| Garantia padrão | 12 meses/fábrica | `EDITAVEL_CONTROLADO`, com tipo e duração válidos pelo contrato ML |
| Publicação de estoque igual | bloqueada por regra | `INVARIANTE` de eficiência e consistência |
| Elegibilidade de publicação | regra consolidada | `INVARIANTE`; motivos devem ser explicados, não desligados |
| Regras de catálogo e Buy Box | API ML | `INVARIANTE` externo; exibir estado e orientação |
| Frequência de observação/publicação | registro de jobs | administrada na seção avançada, não duplicada aqui |

### 5.7 Dashboard, TV e preferências locais

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Meta diária de lucro | `TV_DAILY_PROFIT_GOAL`, padrão R$ 1.500 | mover para `EDITAVEL_IMEDIATO` global e compartilhar Dashboard/TV |
| Período inicial dos painéis | escolhas locais da página | `PREFERENCIA_LOCAL`, se houver necessidade de persistência por usuário |
| Largura de tabelas | `localStorage` | `PREFERENCIA_LOCAL`; oferecer “restaurar colunas”, não tornar global |
| Tema Bentevi | dark e tokens versionados | `INVARIANTE` desta etapa |
| Atualização automática da TV | comportamento da futura `BNT-D21` | decidir e implementar somente naquela página, consumindo fonte única se configurável |

### 5.8 Notificações

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Push global | `configuracoes.notificacoes_push` | substituir por política por evento sem quebrar inscrições individuais |
| Inscrição push do navegador | `push_subscriptions` | `PREFERENCIA_LOCAL` por usuário/dispositivo |
| Eventos push | venda, pergunta e reclamação fixos | `EDITAVEL_IMEDIATO` por evento e canal |
| Destinatários push | cargos admin/gerente | `EDITAVEL_CONTROLADO`; selecionar usuários/cargos sem números livres |
| Destinatários WhatsApp | env/fallback hardcoded | consolidar em `whatsapp_alert_settings` e remover fallback nominal |
| Eventos WhatsApp | tipos internos do serviço | `EDITAVEL_CONTROLADO` por tipo e destinatário |
| E-mail de NF-e | SMTP/runtime | remetente write-only/configurado e destinatário informado na ação |
| Testes de canal | rotas específicas | ação administrativa explícita, sem alterar configuração ao testar |

### 5.9 Integrações

| Integração | Configuração administrável | Estado protegido/externo |
|---|---|---|
| Mercado Livre | Client ID, conectar/reconectar/desconectar | tokens write-only; callback, seller e saúde somente leitura |
| DSLite | URL, token, teste e feeds por fornecedor | token write-only; contrato e headers fixos |
| Brasil NFe | token da empresa, user token, URL permitida e teste | tokens write-only; ambiente e provedor somente leitura |
| Mercado Pago | credencial de teste/conta, conexão e saúde quando o fluxo estiver ativo | Access Token write-only; webhooks e tópicos conforme app externo |
| WAHA | endpoint, sessão, credencial e teste | chave write-only; engine e saúde somente leitura |
| SMTP | host, porta, TLS, usuário/remetente e teste | senha write-only |
| Push/VAPID | habilitação e saúde | chave privada write-only; chave pública pode ser servida pela API própria |
| GitHub operacional | repositório, labels e saúde | token write-only |
| OpenRouter | endpoint permitido, modelo e saúde | chave write-only |
| Firecrawl | habilitação e saúde | chave write-only |

Valores `NEXT_PUBLIC_*` são incorporados ao bundle pelo Next.js durante o build e não podem ser tratados como secrets nem como configuração dinâmica comum. Endpoints editáveis devem ter allowlist/protocolo e validação contra SSRF antes de aceitar entrada administrativa.

### 5.10 Usuários e permissões

| Parâmetro | Estado atual | Classe e destino |
|---|---|---|
| Nome, e-mail, avatar e senha | Auth/perfil | manter ações administrativas existentes |
| Cargo | `admin`, `gerente`, `operador`, `visualizador` | atribuição `EDITAVEL_CONTROLADO` |
| Matriz de permissões por cargo | `permissions.ts` | `INVARIANTE` de segurança nesta reestruturação |
| Acesso a Configurações | somente `admin` | `INVARIANTE` |
| Preferências visuais por usuário | inexistentes/globalmente fora do escopo escolhido | manter locais até existir requisito explícito |

### 5.11 Sistema e jobs — área avançada

O registro `SYNC_TASKS` é a fonte atual de 14 tarefas. A futura configuração deve usar a chave canônica de cada tarefa e nunca permitir editar path, domínio, tipo de progresso ou modo de dispatch.

| Grupo | Candidatos editáveis | Permanecem invariantes |
|---|---|---|
| Agenda | ativação e intervalos comercial/fora do horário das tarefas `scheduled` | tarefas `realtime` e `manual` não ganham cron automaticamente |
| Janela comercial | início e fim, mantendo fuso oficial | cálculo de timezone e ordenação dos dispatches |
| Execução | limites e janela de busca já presentes em `defaultBody` | endpoint, domínio de lock e identidade do job |
| Timeout | timeout por tarefa dentro de faixa segura | cancelamento, sinal e resposta terminal corretos |
| Retry | quantidade e backoff de falhas transitórias | classificação de erro fatal, idempotência e dedupe |
| Concorrência/lotes | somente valores comprovadamente operacionais e limitados | limites impostos por ML, DSLite, banco ou memória |
| Recuperação de job | limiar de stale compatível com lock/timeout | estados canônicos e impossibilidade de reexecutar efeito não idempotente |
| Saúde | última/próxima execução, duração, resultado e erro | somente leitura; não confundir observabilidade com configuração |

Feature flags temporárias (`ORDER_SNAPSHOT_V2_ENABLED`, fetch IBGE e fixtures BNT), cursores, watermarks, timestamps de trigger e chaves de coordenação não entram como preferências permanentes. Devem ser removidos ou mantidos internos conforme sua tarefa de origem.

### 5.12 Ambiente e segurança

| Item | Tratamento |
|---|---|
| URL pública e callback | somente leitura, com indicação se exige novo build |
| Supabase URL e ambiente | somente leitura; `.160` produção e `.162` DEV nunca são selecionáveis pela UI |
| Service role, anon key, JWT e API secret | mostrar apenas estado configurado; nunca revelar, copiar ou auditar valor |
| Segredos de links públicos | estado somente leitura/write-only em tarefa específica |
| Ambiente fiscal | somente leitura e destacado |
| Build/commit e versão | somente leitura |
| `NODE_ENV`, `PORT`, runtime Next | somente leitura |
| Credenciais de deploy/Easypanel/Cloudflare | fora da página e fora do banco do ERP |

---

## 6. Fontes de persistência aprovadas

1. **`empresa`:** identidade e cadastro fiscal do emitente.
2. **`configuracoes`:** valores escalares globais de negócio com tipos e constraints.
3. **`integracoes`:** metadados e credenciais write-only das integrações já suportadas.
4. **tabelas tipadas de domínio:** apenas para coleções reais, como faixas de preço, preferências por evento e ajustes por job.
5. **Auth/`profiles`:** usuários e cargo.
6. **preferência local:** somente estado visual do usuário/navegador.

Não criar tabela key/value genérica para absorver todos os domínios. O formato evitaria validação no banco, esconderia dependências e recriaria o problema de `sync_runtime_config` numa API administrativa.

Para alterações técnicas, uma auditoria administrativa dedicada é justificada. Ela deve guardar chave, domínio, autor, instante e valores sanitizados; secrets registram apenas mudança de estado.

---

## 7. Sequência de implementação

Cada ação abaixo é independente e bloqueia a seguinte até validação:

1. `BNT-CFG-01` — núcleo administrativo, contratos tipados e auditoria sanitizada;
2. `BNT-CFG-02` — Empresa e cadastro fiscal;
3. `BNT-CFG-03` — Comercial e precificação;
4. `BNT-CFG-04` — Produtos, estoque, pedidos e fulfillment;
5. `BNT-CFG-05` — Mercado Livre e anúncios;
6. `BNT-CFG-06` — Notificações e canais;
7. `BNT-MSG-01` — Templates e identidade das notificações;
8. `BNT-PARITY-00`, ações `BNT-PARITY-N` e `BNT-PARITY-GATE` — reconciliação bloqueante com produção;
9. `BNT-CFG-07` — Integrações, incluindo estados ausentes da interface;
10. `BNT-CFG-08` — Dashboard, TV e metas;
11. `BNT-CFG-09` — Sistema e jobs avançados;
12. `BNT-D20` — composição visual final de `/configuracoes`, responsividade desktop e aprovação.

`BNT-D20` somente será marcado como concluído quando todos os controles implementados tiverem consumidor real, autorização administrativa, validação, auditoria aplicável e teste direcionado.

Após `BNT-PARITY-GATE`, cada ação também deve conferir se `origin/main` avançou além do último SHA auditado. Antes da promoção, `BNT-PARITY-FINAL` repete obrigatoriamente o delta e bloqueia o release diante de regra ou commit sem classificação.

---

## 8. Inventário nominal de variáveis de runtime

Esta lista cobre as variáveis lidas pelo código da aplicação em `src/` na fotografia atual. Variáveis exclusivas de scripts de manutenção, auditoria ou lote não são configurações do ERP e permanecem sob seus próprios contratos operacionais.

| Grupo | Variáveis | Tratamento final |
|---|---|---|
| Runtime e build | `NODE_ENV`, `NEXT_PHASE`, `NEXT_RUNTIME`, `PORT` | `STATUS_SOMENTE_LEITURA` ou interno; nunca editáveis |
| URLs da aplicação | `NEXT_PUBLIC_APP_URL`, `INTERNAL_APP_URL`, `NEXT_INTERNAL_APP_URL` | somente leitura; alteração depende de ambiente/deploy |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | destino somente leitura; chaves apenas como estado configurado |
| Segurança interna | `API_SECRET_KEY`, `JWT_SECRET` | `SECRET_WRITE_ONLY`, fora das respostas administrativas |
| Mercado Livre | `ML_ALLOWED_USER_IDS` | allowlist de segurança somente leitura; identidade conectada vem do OAuth |
| Mercado Pago | `MERCADOPAGO_ACCESS_TOKEN` | consolidar com `integracoes`; `SECRET_WRITE_ONLY` |
| Brasil NFe | `BRASILNFE_TOKEN`, `BRASILNFE_USER_TOKEN`, `BRASILNFE_WEBHOOK_SECRET`, `BRASILNFE_BASE_URL`, `BRASILNFE_TIPO_AMBIENTE`, `BRASILNFE_RETURN_TIPO_AMBIENTE` | tokens write-only; URL controlada; ambientes somente leitura |
| Política fiscal | `NFE_DEFAULT_MODFRETE`, `STRICT_NFE_VALIDATION`, `IBGE_RUNTIME_FETCH_ENABLED` | modalidade candidata controlada; validação e feature flag internas |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_NFE` | parâmetros controlados e senha write-only |
| Push | `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | pública/status, privada write-only e subject controlado |
| WAHA/WhatsApp | `WAHA_BASE_URL`, `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION`, `WAHA_TEST_RECIPIENT_PHONE` | integração controlada; chave write-only; destinatários persistidos em tabela tipada |
| GitHub operacional | `GITHUB_OPS_TOKEN`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_OPS_ERROR_LABELS` | token write-only; repositório/labels controlados |
| IA e pesquisa | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `FIRECRAWL_API_KEY` | chaves write-only; endpoint/model controlados e saúde |
| Links públicos | `PUBLIC_BKR1_KIT_LINK_SECRET`, `PUBLIC_EVOLUSOM_GTIN_LINK_SECRET`, `PUBLIC_LABEL_LINK_SECRET`, `PUBLIC_NFE_LINK_SECRET`, `PUBLIC_SUPPLIER_RECEIPT_LINK_SECRET` | estado somente leitura/write-only; nunca mostrar valor |
| Metas e operação | `TV_DAILY_PROFIT_GOAL`, `INTERNAL_SYNC_TIMEOUT_MS` | migrar para configurações globais/avançadas tipadas |
| Feature flags internas | `ORDER_SNAPSHOT_V2_ENABLED` | interna e temporária; não transformar em preferência permanente |

### Constantes relevantes já classificadas

| Fonte | Decisão |
|---|---|
| `pricing.ts` — faixas, margens e lucros mínimos | tornar configuração comercial tipada; fórmulas e tabela legal continuam invariantes |
| `product-activity.ts` — limite de custo | tornar configuração comercial única |
| `ml/shipping-cost.ts` — frete não informado | tornar fallback explícito e configurável |
| `ml/quantity-pricing.ts` — quantidades/descontos | tornar coleção comercial validada |
| `ml-sale-terms.ts` — garantia | tornar preferência ML validada |
| `sync/registry.ts` — agenda, body, timeout, lock e retry | editar somente os campos operacionais aprovados; identidade e dispatch permanecem fixos |
| serviços de sync — concorrência, lote e retry | só promover à área avançada quando houver consumidor único e limites testados |
| `orders/operational-view.ts` — atraso de uma hora | tornar limiar operacional configurável |
| `whatsapp-alerts.ts` — destinatários e janela | destinatários migram para `whatsapp_alert_settings`; janela vira configuração avançada se ainda necessária |
| contratos de status, permissões, ledger, SKU, kits e fiscal | `INVARIANTE` |
| paginação, dimensões de PDF, cache de UI e formatação | implementação interna, fora de Configurações |

---

## 9. Contratos externos consultados

- Next.js 16.3.3, documentação local `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`: secrets permanecem no servidor; `NEXT_PUBLIC_*` é incorporado ao bundle no build.
- Mercado Livre, autenticação e autorização: `https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/autenticacao-e-autorizacao`.
- Mercado Livre, criação de aplicação: `https://developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre`.
- Mercado Pago, credenciais: `https://www.mercadopago.com.br/developers/pt/docs/credentials`.
- Mercado Pago, Webhooks: `https://www.mercadopago.com.br/developers/pt/docs/loja-integrada/additional-content/your-integrations/notifications/webhooks`.
- DSLite, referência oficial publicada em Postman: `https://documenter.getpostman.com/view/5316990/RWaRNkaA`.
- Brasil NFe, API oficial: `https://brasilnfe.com.br/api/`.

Os contratos externos definem capacidades e limites; a página não poderá criar opções que o provedor não suporte.

---

## 10. Aceite do dossiê

- todos os acessos de runtime a `process.env` foram classificados por grupo, incluindo infraestrutura, secrets, integração e candidatos de negócio;
- todos os consumidores de `empresa`, `configuracoes`, `integracoes` e `sync_runtime_config` foram localizados;
- armazenamento local foi separado de configuração global;
- constantes de negócio e operação relevantes foram separadas de paginação, layout, formatos, estados e contratos invariantes;
- nenhuma credencial, token, senha ou valor secreto foi reproduzido;
- nenhuma configuração foi implementada nesta etapa;
- nenhuma alteração de banco, integração, homologação ou produção faz parte de `BNT-CFG-00`.

---

## 11. Implementação por domínio

### `BNT-CFG-02 — Empresa e cadastro fiscal`

Implementado tecnicamente em `2026-09-04` no commit `439e685` e publicado em `dev.bentevi.shop`. A entrega consolidou identidade e contato, endereço fiscal estruturado, tributação do Simples e saúde somente leitura do emissor na aba `Empresa e fiscal`. O início de atividade passou a possuir fonte persistida obrigatória, Brasil NFe permaneceu como provedor invariável e os consumidores fiscais afetados deixaram de inferir UF a partir do endereço legado.

A migration `20260904210000_bnt_cfg_02_company_fiscal.sql` foi ensaiada com `ROLLBACK` e aplicada somente no `supabase-dev` em `192.168.1.162`. A entrega foi aprovada visualmente pelo responsável em `2026-09-04`, liberando `BNT-CFG-03` como próxima ação.

### `BNT-CFG-03 — Comercial e precificação`

Implementado tecnicamente em `2026-09-04` no commit `c86976a` e publicado em `dev.bentevi.shop`. A aba `Comercial` consolidou como fontes tipadas as três faixas de custo/margem/lucro mínimo, a taxa fallback do Mercado Livre, o frete `not_specified`, o limite de inativação por custo e a política mínima/fallback de preços por quantidade. O simulador compartilha o cálculo operacional e salvar a configuração não recalcula nem publica produtos ou anúncios existentes.

A migration `20260904223000_bnt_cfg_03_commercial_pricing.sql` foi ensaiada com `ROLLBACK` e aplicada somente no `supabase-dev` em `192.168.1.162`. O cálculo SQL e o TypeScript foram comparados nos quatro limites das faixas e produziram os mesmos valores. A aba foi aprovada visualmente pelo responsável em `2026-09-04`, liberando `BNT-CFG-04`.

### `BNT-CFG-04 — Produtos, estoque, pedidos e fulfillment`

Implementado tecnicamente em `2026-09-04`. A aba `Operação` concentra o prazo de atenção dos pedidos, o endereço do estoque interno validado na conta Mercado Livre e o estado write-only do feed XML por fornecedor. Q segura, capacidade de kits, criação explícita do pedido DSLite e aposentadoria permanente permanecem regras protegidas.

A migration `20260904233000_bnt_cfg_04_operation.sql` foi ensaiada com `ROLLBACK` e aplicada somente no `supabase-dev` em `192.168.1.162`. Ela removeu as fontes paralelas do runtime, preservou os valores legados, consolidou feed e aposentadoria em `fornecedores` e negou leitura da URL confidencial aos papéis cliente. A aba foi aprovada visualmente pelo responsável em `2026-09-04`, liberando `BNT-CFG-05`.

### `BNT-CFG-05 — Mercado Livre e anúncios`

Implementado tecnicamente em `2026-09-04` no commit `e267da9` e publicado em `dev.bentevi.shop`. A aba dedicada `Mercado Livre` concentra conta vendedora, aplicativo OAuth, credenciais write-only, diagnóstico, URL de callback e garantia padrão. Credenciais só podem ser alteradas desconectadas; desconectar revoga primeiro o grant remoto e não apaga tokens diante de falha transitória. O callback exige administrador, usa exclusivamente `NEXT_PUBLIC_APP_URL` HTTPS e não possui fallback para domínio aposentado.

A garantia deixou de ser uma constante injetada pelo runtime. Preview, sugestão e criação consultam os termos de venda oficiais da categoria e somente aplicam o padrão quando tipo e prazo configurados são aceitos. A migration `20260905003000_bnt_cfg_05_mercado_livre.sql` foi ensaiada com `ROLLBACK` e aplicada apenas no `supabase-dev` em `192.168.1.162`; o read-back confirmou três constraints e os defaults `garantia de fábrica / 12 meses`. A aba foi aprovada visualmente pelo responsável em `2026-09-04`, liberando `BNT-CFG-06`.

### `BNT-CFG-06 — Notificações e canais`

Implementado tecnicamente em `2026-09-04`. A antiga aba `Preferências` foi substituída por `Notificações`, separando a política automática por evento da inscrição Push individual de cada navegador. Push agora seleciona cargos e usuários ativos; WhatsApp usa exclusivamente os destinatários e eventos persistidos em `whatsapp_alert_settings`; SMTP permanece um canal transacional do fluxo fiscal.

A migration `20260905023000_bnt_cfg_06_notifications.sql` consolidou os destinatários legados, criou política e alvos Push normalizados, adicionou constraints, RLS, grants mínimos e RPC atômico de salvamento. Ela foi ensaiada e aplicada apenas no `supabase-dev` em `192.168.1.162`. Testes de canal continuam ações explícitas: Push alcança somente o navegador atual, WhatsApp somente o número de teste do ambiente e SMTP executa verificação de conexão sem enviar e-mail. A aba foi aprovada visualmente pelo responsável em `2026-09-04`, liberando `BNT-MSG-01`.

### `BNT-MSG-01 — Templates e identidade das notificações`

Implementado tecnicamente e publicado em homologação em `2026-09-04`. Os conteúdos ativos de WhatsApp, Push e e-mail fiscal passaram a ser produzidos por uma fonte tipada comum, também usada pela galeria administrativa de 20 amostras sintéticas. WhatsApp separa contexto, dados essenciais e próxima ação; Push preserva somente informação acionável; e-mail fiscal usa visual dark, logotipo Bentevi embutido e fallback texto.

Não foram alterados eventos, destinatários, permissões, dedupe, idempotência, anexos, auditoria ou contratos de transporte. Não houve migration nem operação de banco. O commit `0f81e63` foi publicado somente em `vortek-erp-dev`; as amostras foram aprovadas visualmente pelo responsável em `2026-09-04`.

### `Etapa 11.1 — Reconciliação contínua Produção → Bentevi`

A sequência de Configurações fica pausada antes de `BNT-CFG-07`. `BNT-PARITY-00` produzirá a fotografia e a matriz canônica das regras de produção; cada divergência será tratada em uma ação individual; e `BNT-PARITY-GATE` liberará a retomada somente depois de classificar todos os commits e regras produtivas. `BNT-PARITY-FINAL` repetirá o delta imediatamente antes do release.

A fotografia inicial deve reconfirmar `origin/main@95941f1`, `origin/dev@e83ceb2` e o ancestral comum `08b6237`. Nesse ponto existem 13 commits exclusivos em `main`, 83 arquivos afetados e quatro migrations a classificar. Produção e seu banco em `.160` permanecem estritamente somente leitura; qualquer correção futura será implementada uma regra por vez em `dev` e, quando necessário, somente no `supabase-dev` `.162`.
