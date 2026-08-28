# Vortek — Item 17 — Plano Completo de Execução e Ambiente de Homologação

**Status:** Planejamento concluído; execução não iniciada  
**Data-base:** 27/08/2026  
**Branch de produção:** `main`  
**Branch de homologação:** `dev`  
**Produção atual:** `https://app.vortek.shop`  
**Executor das mudanças:** IA Dev  
**Responsável por aprovação/avanço:** usuário responsável pelo Vortek  
**Base:** Auditoria Itens 1 a 16 + estado atual da branch `dev`

---

## 1. Objetivo

Este documento transforma a auditoria consolidada do Vortek em um plano de execução seguro.

O objetivo é:

- preservar a produção atual sem interrupções;
- criar um ambiente de homologação realmente separado;
- executar correções e simplificações por etapas pequenas;
- testar cada etapa antes de avançar;
- impedir que código de teste altere pedidos, estoque, anúncios, NF-e ou financeiro reais;
- manter a arquitetura atual sempre que ela já resolve corretamente o problema;
- promover para produção apenas alterações já validadas em homologação.

A execução deste documento será feita pela **IA Dev**. Este documento não autoriza deploy direto em produção nem alterações manuais no banco de produção.

---

## 2. Regra principal de ambientes

A branch `dev` separa o **código**, mas não separa automaticamente o **sistema**.

Para existir homologação segura, precisam ser separados:

1. aplicação;
2. banco de dados;
3. Storage/Auth do Supabase;
4. variáveis de ambiente e secrets;
5. contas/credenciais das integrações externas;
6. webhooks;
7. jobs e cron;
8. domínio público.

A versão de homologação **não deve apontar para o Supabase de produção** e **não deve carregar credenciais produtivas** de integrações que possam gerar efeitos externos.

---

# PARTE I — Arquitetura de ambientes

## 3. Arquitetura recomendada

### Produção

```text
GitHub main
    ↓
Easypanel: serviço vortek-erp
    ↓
app.vortek.shop
    ↓
Supabase self-hosted PRODUÇÃO
    ↓
Mercado Livre real
Mercado Pago real
Brasil NFe produção
DSLite real
WAHA real
e-mail/push reais
```

### Homologação

```text
GitHub dev
    ↓
Easypanel: novo serviço vortek-erp-staging
    ↓
dev.vortek.shop
    ↓
Supabase self-hosted STAGING
    ↓
somente integrações de teste/homologação
ou integrações desabilitadas
```

### Desenvolvimento da IA Dev

```text
branch dev
    ↓
alteração pequena
    ↓
teste direcionado
npm run validate
build quando aplicável
    ↓
commit na dev
    ↓
deploy em dev.vortek.shop
    ↓
validação funcional
```

Depois da aprovação:

```text
dev
↓
Pull Request para main
↓
revisão final
↓
merge
↓
deploy de produção
↓
smoke test seguro
```

---

## 4. O que não deve ser feito

- Não trocar o serviço atual `vortek-erp` do Easypanel para a branch `dev`.
- Não usar `app.vortek.shop` para homologação.
- Não apontar `dev.vortek.shop` para o banco de produção.
- Não copiar secrets produtivos para o staging por conveniência.
- Não deixar o scheduler de staging executar contra contas reais.
- Não testar emissão fiscal em produção.
- Não testar alteração de anúncios Mercado Livre na conta real.
- Não testar pagamentos Mercado Pago com credenciais produtivas.
- Não fazer migration de teste no banco de produção.
- Não usar produção como banco compartilhado "temporariamente".

---

## 5. Matriz de ambientes

| Recurso | Produção | Homologação |
|---|---|---|
| Git | `main` | `dev` |
| App Easypanel | `vortek-erp` | `vortek-erp-staging` |
| Domínio | `app.vortek.shop` | `dev.vortek.shop` |
| Supabase | stack atual de produção | stack staging independente |
| Banco PostgreSQL | produção | staging |
| Storage | produção | staging |
| Auth | produção | staging |
| Secrets | produção | staging/teste |
| Mercado Livre | seller real | usuários de teste |
| Mercado Pago | produção | credenciais/contas de teste |
| Brasil NFe | ambiente 1 | ambiente 2 / homologação |
| DSLite | produção | escrita desabilitada até confirmar ambiente/conta de teste |
| WAHA | sessão real | sessão/número de teste ou desabilitado |
| Cron/jobs | ativos | desabilitados por padrão; habilitados por domínio durante testes |
| Webhooks | URLs de produção | URLs separadas de staging e somente contas de teste |

---

## 6. Easypanel — separação da aplicação

Criar **um novo serviço**, sem alterar o serviço atual.

### Serviço atual

```text
vortek-erp
branch: main
domínio: app.vortek.shop
```

### Novo serviço

```text
vortek-erp-staging
branch: dev
domínio: dev.vortek.shop
```

O Easypanel permite selecionar uma branch por serviço GitHub/Git. Portanto, os dois serviços podem usar o mesmo repositório e branches diferentes.

### Regras do serviço staging

- variáveis de ambiente próprias;
- domínio próprio;
- deploy webhook próprio;
- logs próprios;
- auto deploy pode ser habilitado apenas para `dev`;
- nunca reutilizar o deploy webhook de produção;
- não copiar `.env` produtivo inteiro.

### Produção

Recomenda-se manter o deploy de produção manual/controlado após merge para `main`.

---

## 7. Supabase — homologação precisa de uma stack separada

O Vortek usa Supabase **self-hosted**.

O Supabase self-hosted não oferece o mecanismo de branches/preview environments do Supabase Cloud. Portanto, a homologação deve usar uma **segunda stack self-hosted**, com PostgreSQL, Auth, Storage e configuração separados.

Nome conceitual:

```text
supabase-vortek-prod
supabase-vortek-staging
```

### Recomendação de infraestrutura

Melhor opção operacional:

```text
staging em VM/host separado
```

Isso elimina o risco de testes pesados consumirem recursos da produção.

Se não houver outro host disponível, é possível usar o mesmo servidor somente depois de confirmar capacidade de CPU/RAM/disco. Nesse caso, a stack staging precisa ter:

- projeto Docker/Compose separado;
- volumes separados;
- portas separadas;
- secrets separados;
- banco separado;
- Storage separado;
- domínio/API separados.

Nunca compartilhar volume PostgreSQL entre produção e staging.

---

## 8. Dados do banco de staging

### Primeira opção recomendada

Subir o staging a partir de:

```text
migrations do repositório
+
seed controlado
```

Criar apenas dados necessários para testes.

### Quando forem necessários casos reais complexos

Usar dados copiados de produção somente de forma:

```text
selecionada
+
anonimizada
+
sem secrets
+
sem tokens
+
sem credenciais
+
sem webhooks produtivos
```

Não restaurar um backup completo de produção em staging e simplesmente ligar o sistema.

Se futuramente for necessário usar um snapshot completo, antes de liberar a rede/aplicação devem ser removidos ou invalidados:

- tokens;
- integrations;
- URLs de webhook;
- chaves PIX;
- secrets;
- contatos reais;
- jobs/crons produtivos;
- short links;
- sessões;
- dados pessoais que não sejam necessários ao teste.

---

## 9. Jobs e cron no staging

O staging deve nascer com automações externas **desabilitadas por padrão**.

Motivo: o Vortek possui jobs que podem:

- publicar preço;
- publicar estoque;
- criar/atualizar operação DSLite;
- reconciliar NF-e;
- processar Mercado Pago;
- enviar WhatsApp;
- gerar efeitos externos.

### Regra de teste

Para testar um domínio:

```text
1. configurar credencial de teste daquele domínio
2. confirmar banco staging
3. habilitar somente o job necessário
4. executar cenário
5. validar
6. desabilitar novamente se não for uso contínuo
```

Não deixar staging com scheduler geral ativo enquanto existirem integrações sem isolamento confirmado.

---

## 10. Webhooks de staging

Webhooks devem apontar para:

```text
https://dev.vortek.shop/api/webhooks/...
```

apenas quando a conta/aplicação externa também for de teste.

Nunca configurar a conta real para entregar webhook simultaneamente para staging sem uma decisão técnica explícita.

### Mercado Livre

O Mercado Livre não oferece sandbox separado. A documentação oficial usa **usuários de teste no ambiente real da API**.

Portanto:

- criar usuário vendedor de teste;
- criar usuário comprador de teste;
- autorizar o Vortek staging contra o seller de teste;
- usar somente anúncios e operações entre usuários de teste;
- não carregar token do seller real no staging.

### Mercado Pago

Usar:

- credenciais de teste;
- contas de teste;
- valores fictícios.

### Brasil NFe

Usar:

```text
TipoAmbiente = 2
```

Homologação.

Nenhuma NF-e de staging deve usar `TipoAmbiente = 1`.

### DSLite

A documentação pública analisada não comprova um sandbox equivalente para o fluxo completo do Vortek.

Regra:

```text
staging não executa escrita DSLite
```

até existir confirmação de uma conta/ambiente de teste suportado.

Leituras também devem ser avaliadas antes de usar credencial real.

### WAHA / WhatsApp

Usar:

- sessão de teste dedicada; ou
- integração desabilitada.

Nunca enviar alertas de staging para contatos reais.

---

## 11. DNS e acesso ao staging

Domínio recomendado:

```text
dev.vortek.shop
```

Ele deve apontar somente para o serviço `vortek-erp-staging`.

`app.vortek.shop` permanece intocado.

Se o tráfego atual passa por Cloudflare/Tunnel, criar uma rota/hostname adicional para staging sem alterar a rota de produção.

### Acesso

Como staging pode conter fluxos administrativos e dados de teste, recomenda-se restringir acesso quando possível:

- autenticação normal do Vortek;
- e, se simples na infraestrutura atual, proteção adicional no proxy/VPN.

Não criar uma infraestrutura de IAM separada apenas para staging.

---

## 12. Git — fluxo recomendado

### Branch `main`

Representa somente produção.

Regras:

- proteger contra force push;
- evitar push direto;
- mudanças entram por merge da `dev`;
- produção só é deployada após homologação;
- nunca usar `main` para experimentos.

### Branch `dev`

Representa a versão integrada em homologação.

Fluxo da IA Dev:

```text
dev atualizada
↓
uma ação do Item 17
↓
commit pequeno e identificável
↓
validação
↓
deploy staging
↓
aprovação
↓
próxima ação
```

Como existe apenas um executor principal e o plano já obriga uma mudança por vez, **não é necessário criar uma árvore permanente de várias branches adicionais**.

Se uma alteração específica ficar grande ou experimental, a IA Dev pode criar uma branch curta a partir de `dev` e só integrá-la depois de validada.

### Promoção

```text
dev validada
↓
PR dev → main
↓
confirmar diff
↓
confirmar migrations
↓
confirmar variáveis necessárias
↓
merge
↓
deploy produção
```

---

# PARTE II — Modelo de teste

## 13. Onde cada tipo de teste acontece

### Nível 1 — Código local / IA Dev

Executar antes do deploy staging:

```text
teste direcionado
npm run validate
npm run build quando aplicável
```

Objetivo:

- detectar regressão de código;
- validar tipos;
- validar lint;
- validar compilação.

### Nível 2 — Homologação

Executar em:

```text
https://dev.vortek.shop
```

com:

```text
Supabase staging
+
dados de teste
+
integrações de teste
```

Objetivo:

- testar tela;
- testar API;
- testar migrations;
- testar jobs;
- testar concorrência;
- testar webhooks;
- testar fluxo ponta a ponta.

### Nível 3 — Produção

Depois do merge:

Executar somente smoke tests seguros:

- login;
- navegação;
- consultas;
- health interno apropriado;
- leitura de um pedido;
- leitura de estoque;
- verificar logs.

Não criar pedidos, anúncios, pagamentos ou notas fictícias em produção apenas para validar deploy.

---

## 14. Gate obrigatório para avançar

Cada ação do plano segue:

```text
1. confirmar estado atual
2. criar teste de regressão se a falha não estiver coberta
3. fazer menor mudança possível
4. rodar teste direcionado
5. rodar npm run validate
6. rodar build quando aplicável
7. aplicar migration somente no staging, se houver
8. testar em dev.vortek.shop
9. registrar resultado
10. só então marcar ação concluída
```

Se falhar:

```text
não avançar
→ corrigir ou reverter
→ repetir validação
```

---

# PARTE III — Plano completo de execução

## 15. Etapa 0 — Criar homologação isolada

**Prioridade:** pré-requisito  
**Executar antes de qualquer mudança funcional**

### Objetivo

Garantir que todas as mudanças futuras possam ser testadas sem risco para `app.vortek.shop`.

### Ações

- [ ] Criar serviço `vortek-erp-staging` no Easypanel.
- [ ] Configurar source GitHub na branch `dev`.
- [ ] Configurar domínio `dev.vortek.shop`.
- [ ] Criar deploy webhook separado para staging.
- [ ] Criar stack Supabase staging independente.
- [ ] Aplicar migrations atuais no staging.
- [ ] Criar usuário admin de staging.
- [ ] Criar seed mínimo de produtos/pedidos/ofertas/kits quando necessário.
- [ ] Garantir que nenhuma integração produtiva esteja configurada.
- [ ] Garantir que jobs externos estejam desabilitados.
- [ ] Configurar Mercado Livre com usuários de teste quando a etapa exigir.
- [ ] Configurar Mercado Pago com credenciais de teste quando a etapa exigir.
- [ ] Configurar Brasil NFe em homologação.
- [ ] Manter DSLite de escrita desabilitada até validar ambiente de teste.
- [ ] Configurar WAHA de teste ou manter desabilitado.
- [ ] Testar login e navegação no staging.
- [ ] Rodar `npm run validate`.
- [ ] Rodar `npm run build`.
- [ ] Confirmar que `app.vortek.shop` não sofreu alteração.

### Critério de conclusão

Homologação funciona sem qualquer dependência capaz de modificar produção.

### Rollback

Excluir/parar somente o serviço e stack staging. Produção não deve ser afetada.

---

## 16. Etapa 1 — Segurança crítica

### SEC-02 — Credencial versionada

**Prioridade:** P0/P1

#### Problema

Existe credencial administrativa literal em documentação versionada.

#### Ação

- remover do arquivo ativo;
- revogar/rotacionar se ainda puder ser válida;
- verificar usos atuais;
- avaliar histórico Git depois da rotação.

#### Validação

- busca no estado atual do repositório não encontra a credencial;
- serviço dependente continua autenticando com credencial nova, se aplicável.

---

### SEC-01 — Controle de `cargo`

**Prioridade:** P0

#### Problema

O caller pode influenciar `cargo` no registro e a própria linha de `profiles` possui atualização ampla.

#### Fonte de verdade

```text
profiles.cargo
```

continua sendo o papel do usuário.

#### Ação mínima

- caller público não escolhe cargo privilegiado;
- usuário comum não altera a coluna `cargo`;
- mudança de cargo ocorre somente por operação administrativa autorizada;
- preservar edição dos campos pessoais que realmente precisam ser editáveis.

#### Testes obrigatórios

- [ ] caller público não cria admin;
- [ ] operador não vira admin;
- [ ] visualizador não muda cargo;
- [ ] admin autorizado consegue realizar alteração permitida.

#### Rollback

Migration e API devem ser projetadas com reversão explícita antes da aplicação em produção.

---

### SEC-03 — Permissões web + mobile

**Prioridade:** P1  
**Dependência:** SEC-01

#### Ação

Evoluir a matriz atual de permissões para ser a regra do Vortek, independente de origem:

```text
cookie web
Bearer mobile
↓
mesma permission matrix
```

Não criar uma segunda matriz web.

#### Testes

- operador web não confirma pagamento quando a mesma permissão é negada ao operador mobile;
- visualizador permanece leitura;
- admin/gerente recebem as permissões definidas.

---

### SEC-04 — Secrets no browser

**Prioridade:** P1

#### Ação

A API de integrações deixa de retornar valor integral de:

- client secrets;
- access tokens;
- refresh tokens.

A UI recebe somente estado como:

```text
configurado
não configurado
```

e envia novo valor somente quando o usuário o altera.

---

### SEC-05 — Links sensíveis com expiração

**Prioridade:** P1

Aplicar expiração real a:

- XML;
- DANFE;
- etiqueta;
- comprovante.

Reutilizar a infraestrutura de expiração já existente, sem criar novo serviço.

---

## 17. Etapa 2 — Prazo externo Mercado Livre

### ML-01 — Preços por Quantidade

**Prioridade:** P1 com prazo  
**Prazo:** antes de 26/10/2026

#### Objetivo

Migrar o fluxo para o contrato percentual B2B atual do Mercado Livre.

#### Antes de alterar

A IA Dev deve reler:

- `docs/mercado-livre-publicacao-operacional.md`;
- documentação oficial atual de Preços por Quantidade;
- código atual do backend e preview da UI.

#### Ação

- uma regra única de quantity pricing no backend;
- UI apenas exibe a regra;
- remover fórmula independente do cliente;
- preservar outbox/worker existente.

#### Testes

- preview = payload publicado;
- quantidades/faixas esperadas;
- erros/versões do contrato tratados segundo documentação atual.

---

## 18. Etapa 3 — Estoque e fulfillment

### STO-01 + STO-02 — Reserva atômica

**Prioridade:** P1

#### Problema

Hoje seleção `internal`, validação e consumo do estoque não formam uma operação atômica.

#### Objetivo

Garantir:

```text
se pedido ficou internal
→ estoque já está garantido
```

#### Direção

Evoluir os mecanismos existentes:

- PostgreSQL;
- RPC;
- locks;
- ledger de estoque;
- fulfillment_source.

Não criar Redis ou nova fila.

#### Conceito mínimo

```text
disponível
→ reservado
→ despachado
```

Falha antes do despacho:

```text
reservado
→ liberado/estornado
```

#### Testes obrigatórios

- saldo 1 + duas vendas simultâneas = somente uma reserva;
- retry não cria segunda reserva;
- cancelamento libera reserva;
- despacho transforma reserva em saída;
- falha fiscal/etiqueta não perde a reserva;
- kit reserva os componentes corretos.

---

## 19. Etapa 4 — Capacidade e quantidade segura

### RULE-01 — Capacidade de fulfillment

Criar/reutilizar funções pequenas do domínio para responder:

```text
internal consegue atender quanto?
supplier consegue atender quanto?
```

Não criar `AvailabilityEngine`.

### Q segura

```text
Q_segura = max(Q_internal, Q_supplier)
```

Nunca:

```text
Q_internal + Q_supplier
```

### Kits

Capacidade sempre derivada dos componentes.

### ML-03 — Não publicar estoque igual

Depois da fonte de verdade estar centralizada:

```text
quantidade não mudou
→ não cria nova outbox

quantidade mudou
→ cria outbox
```

Não usar timestamp de sync como mudança de estoque.

#### Testes

- internal 2 / supplier 3 → 3;
- internal 5 / supplier 3 → 5;
- preferencial 3 / outra oferta válida 8 → supplier 8;
- oferta inválida não entra;
- reserva reduz Q_internal;
- kit respeita componentes;
- quantidade igual não cria outbox.

---

## 20. Etapa 5 — Mercado Livre observado e publicação

### ML-02 — Scan repetido

**Prioridade:** P1

#### Problema

O Vortek reconstrói a população completa de anúncios para cada lote pequeno.

#### Objetivo

Obter a população uma vez por ciclo e processá-la de forma retomável.

#### Restrição

O `scroll_id` oficial é temporário. A solução não pode depender dele como estado durável de longa duração.

#### Direção

Reutilizar o padrão durável já existente no Vortek quando isso for a menor solução, sem fila externa.

#### Testes

- todos os itens do ciclo são processados;
- nenhum item é pulado;
- nenhum item é processado duas vezes indevidamente;
- retomada funciona;
- novo ciclo refaz população quando necessário.

---

### RULE-06 — Elegibilidade de publicação

Centralizar no domínio ML:

```text
anúncio modificável?
erro transitório?
erro terminal?
```

Producer e worker devem usar a mesma semântica.

Objetivo: não reenfileirar continuamente anúncio conhecido como não modificável.

---

### INV-05 — Automação nativa de preço

Antes de mudar código:

- confirmar se existem anúncios reais/teste com automação nativa ativa;
- comparar comportamento com a documentação oficial atual;
- só implementar pre-check se houver necessidade operacional.

---

### INV-02 — Helpers antigos de estoque

Rastrear todos os chamadores.

Remover somente depois de provar que `stock-publish.ts` cobre o fluxo atual.

---

## 21. Etapa 6 — Fiscal

### FIS-01 — Upload XML correto

Remover chamadas comprovadamente inválidas.

Fluxo desejado:

```text
GET invoice atual
↓
se nova:
POST XML
↓
se existente e precisa atualizar:
PUT XML
↓
GET verificar
```

---

### FIS-02 — Gate do shipment

Antes de upload:

```text
status = ready_to_ship
substatus = invoice_pending
```

Se não estiver apto:

- não enviar;
- aguardar fluxo legítimo existente.

---

### FIS-03 — `not_found` Brasil NFe

Distinguir:

```text
transitório
terminal
reaberto por mudança real
```

Um `not_found` determinístico não deve voltar a cada poucos minutos sem mudança de estado.

#### Testes

- POST XML direto para nova invoice;
- sem upload quando shipment não está apto;
- mesma chave já vinculada continua idempotente;
- `not_found` terminal não volta ao ciclo continuamente.

---

## 22. Etapa 7 — Mercado Pago e financeiro

### FIN-01 — Lifecycle do relatório

**Prioridade:** P1

O mesmo job/tarefa deve percorrer:

```text
requested
→ processing
→ processed
→ download
→ import
→ complete
```

Não criar um segundo cron.

---

### FIN-02 — Parser

Usar os campos oficiais relevantes, incluindo o valor líquido que impacta saldo.

Antes de qualquer crédito automático, validar:

- tipo da transação;
- valor líquido;
- moeda;
- idempotência.

#### Testes

- 202/requested não vira completo;
- mesma task é retomada;
- valor líquido prevalece;
- importação é idempotente;
- movimento não gera crédito duplicado.

---

### WEBHOOK-03 — `payment_lookup_failed`

Resolver dentro da mesma estratégia de reconciliação financeira.

Não criar fila paralela apenas para o webhook.

---

## 23. Etapa 8 — Jobs e DSLite

### JOB-01 — Catálogo `on_hold`

Investigar a causa do job órfão no mecanismo atual.

Possíveis áreas a verificar:

- pg_cron;
- pg_net;
- estado runtime;
- worker;
- eligibility;
- lock.

Não criar outro cron.

#### Teste

```text
on_hold existente
→ mecanismo atual encontra
→ retoma
→ conclui ou volta a estado observável
```

---

### DSL-01 — Timeout DSLite

Timeout/erro de request não pode virar:

```text
0 pedidos
+
job completo
```

Preservar erro/status do request até a decisão de retry.

---

### INV-01 — API DSLite x XML

Só depois da saúde do sync:

- mapear qual é fonte principal;
- qual é fallback/reconciliador;
- remover uma fonte apenas se sua função estiver comprovadamente coberta.

---

## 24. Etapa 9 — Plataforma e banco

### SEC-06 — Next.js

Fazer upgrade isolado para uma major atualmente suportada.

Antes da execução, a IA Dev deve consultar novamente:

- versão atual do repo;
- Support Policy oficial;
- migration guides da versão alvo.

Não misturar upgrade com refatoração de UI.

#### Validação

- testes direcionados;
- `npm run validate`;
- `npm run build`;
- smoke staging.

---

### SEC-07 — Secrets runtime

Antes de mover secrets:

- confirmar recurso realmente disponível no Supabase self-hosted atual;
- preferir secret store suportado;
- não implementar criptografia própria.

---

### DB-03 — Fotografia real do banco

Antes de limpeza destrutiva:

capturar em staging e depois conferir produção:

- RLS;
- grants;
- policies;
- constraints;
- indexes;
- default privileges;
- functions SECURITY DEFINER relevantes.

Não tomar migration antiga como única verdade do schema atual.

---

## 25. Etapa 10 — Consolidação de regras P2

Executar uma regra por vez.

### RULE-02 — Pricing

`services/pricing.ts` permanece dono.

Definir claramente os contextos de 4% e 5% antes de remover fórmulas locais.

Não alterar taxa por suposição.

### RULE-03 — Payment mode

Fonte:

```text
offer.payment_mode
+
inferência compartilhada como fallback
```

Preview e execução devem produzir o mesmo resultado.

### RULE-04 — Threshold de custo

Reutilizar `product-activity.ts`.

### RULE-05 — Status fiscal

Distinguir:

- bruto externo;
- normalizado técnico;
- persistido canônico.

### RULE-07 — Tipos do ledger

TypeScript deve representar os tipos realmente aceitos/operados no banco.

### JOB-02 — Dispatch duplicado

Consolidar a lógica interna de:

```text
/api/sync/run
/api/sync/disparar
```

Mantendo autenticação/origem diferentes.

### JOB-04 — Status de job

Normalizar writers antes de criar constraint.

---

## 26. Etapa 11 — Interface

A interface só deve ser reorganizada depois das regras acima.

### UI-05 — Perguntas

Corrigir busca/filtro que hoje trabalha apenas sobre a página carregada.

### UI-02 — Tracking ML

Produtos e Catálogo devem compartilhar o fluxo específico de acompanhamento de publicação.

Não criar polling framework genérico.

### UI-01 — Pedidos

Separar somente blocos funcionais reais:

- DSLite;
- pagamento fornecedor;
- etiqueta/WhatsApp.

### UI-03 — Configurações

Separar tabs em componentes depois de segurança/secrets estarem corretos.

### UI-04 — DTO Pedidos

Criar tipo real da resposta operacional da API.

Não fazer campanha genérica de remoção de `any`.

### UI-06 — Compras

Separar fetch dependente de filtros dos indicadores independentes.

---

## 27. Etapa 12 — Limpeza histórica

Executar somente após o sistema estar funcional e validado.

### HIST-01 — Cluster `ml-p0-*`

Antes de remover:

- confirmar campanha encerrada;
- localizar consumers;
- separar testes permanentes;
- preservar evidências necessárias.

Depois:

- remover comandos;
- scripts;
- libs;
- testes específicos;
- reports ativos;
- dependências sem consumidor;
- objetos atuais de banco por nova migration.

Migrations antigas permanecem.

---

### HIST-02 / HIST-03 — WhatsApp histórico

Revisar:

```text
whatsapp_alert_events
ops_whatsapp_events
```

Remover apenas após ausência completa de consumers.

---

### HIST-04 — Scripts/reports one-off

Remover por cluster, nunca por arquivo aleatório.

---

### HIST-05 — Panasonic

Remover/arquivar juntos:

```text
Panasonic.xls
importador correspondente
```

se o processo já encerrou.

---

### HIST-06 — Dataset

Remover `scripts/build_dataset/` se não existe iniciativa atual que o utilize.

---

### HIST-07 — OpenCode

```text
em uso → corrigir referência
sem uso → remover opencode.json
```

---

### HIST-08 — RTK.md

```text
consumido → alinhar com AGENTS.md
sem consumidor → remover
```

---

# PARTE IV — Ordem de release

## 28. Como uma alteração chega à produção

Nenhuma etapa inteira precisa esperar todas as outras para chegar à produção.

A regra é por mudança validada.

Exemplo:

```text
SEC-01 concluída
↓
validada staging
↓
aprovada
↓
merge dev → main
↓
deploy produção
```

Depois a `dev` continua da nova base.

Isso evita manter por semanas uma branch `dev` muito diferente da produção.

### Regra recomendada

Promover para produção em lotes pequenos e coerentes.

Não acumular todo o Item 17 em um único merge final.

---

## 29. Procedimento de release

Antes de PR `dev → main`:

- [ ] branch dev atualizada;
- [ ] testes direcionados verdes;
- [ ] `npm run validate`;
- [ ] build se aplicável;
- [ ] migrations aplicadas e testadas somente em staging;
- [ ] staging funcional;
- [ ] diff revisado;
- [ ] nenhuma secret adicionada ao Git;
- [ ] rollback conhecido;
- [ ] variáveis de produção identificadas sem expor valores;
- [ ] nenhuma mudança estranha fora do escopo.

Depois do merge:

- [ ] backup quando a mudança exigir;
- [ ] aplicar migration de produção quando aplicável;
- [ ] deploy pelo caminho oficial Easypanel;
- [ ] smoke test seguro;
- [ ] verificar logs;
- [ ] confirmar operação;
- [ ] registrar release.

---

## 30. Rollback

### Código sem migration destrutiva

- redeploy do commit anterior;
- ou revert do commit.

### Migration aditiva

Preferir compatibilidade para permitir rollback de código sem rollback imediato do banco.

### Migration destrutiva

Só executar quando:

- consumers removidos;
- backup verificado;
- migration de transição concluída;
- rollback ou restauração definido.

### Integração externa

Se a mudança produz side effect:

- ter condição de interrupção;
- não reverter criando side effect oposto automaticamente sem entender o estado externo.

---

# PARTE V — Critérios de encerramento

## 31. Item 17 estará executado quando

- [ ] staging estiver isolado e operacional;
- [ ] P0 resolvidos;
- [ ] P1 resolvidos ou formalmente reclassificados com evidência;
- [ ] quantity pricing migrado antes do prazo;
- [ ] estoque interno tiver reserva segura;
- [ ] Q segura possuir uma fonte;
- [ ] ML não fizer scans/outboxes desnecessários comprovados;
- [ ] fiscal não fizer chamadas inválidas;
- [ ] Mercado Pago fechar o lifecycle;
- [ ] jobs não esconderem falhas críticas;
- [ ] principais regras duplicadas estiverem consolidadas;
- [ ] UI estiver simplificada onde havia mistura real;
- [ ] clusters históricos confirmados tiverem sido removidos;
- [ ] testes críticos permanentes estiverem identificados;
- [ ] produção continuar operando normalmente.

---

## 32. Regras para a IA Dev

Antes de cada ação, a IA Dev deve:

1. ler `INSTRUCOES_AGENTE_VORTEK.md`, quando fornecido no ambiente;
2. ler o `AGENTS.md` atual;
3. verificar a branch e o working tree;
4. ler código, migrations e testes diretamente ligados ao item;
5. consultar documentação oficial atual de qualquer integração externa envolvida;
6. confirmar causa e escopo;
7. fazer a menor mudança correta;
8. criar teste de regressão quando a falha crítica não estiver coberta;
9. validar localmente;
10. deployar somente em staging;
11. relatar exatamente o que foi executado;
12. aguardar aprovação antes de promover para `main`.

A IA Dev não deve:

- executar todo o Item 17 de uma vez;
- modificar `main` diretamente;
- usar o banco de produção para testes;
- aplicar migrations de teste em produção;
- acessar/mostrar secrets sem necessidade;
- criar infraestrutura paralela para resolver um problema que o Vortek já consegue resolver;
- avançar de etapa com validação falhando.

---

# PARTE VI — Fontes

## 33. Fontes internas

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`
- Auditoria Item 1 — Mapa Geral
- Auditoria Item 2 — Pedidos + Fulfillment + Estoque
- Auditoria Item 3 — Produtos + Fornecedores + Kits
- Auditoria Item 4 — Mercado Livre
- Auditoria Item 5 — Fiscal
- Auditoria Item 6 — Compras + Financeiro
- Auditoria Item 7 — Jobs + Scheduler
- Auditoria Item 8 — Webhooks
- Auditoria Item 9 — Segurança
- Auditoria Item 10 — Banco
- Auditoria Item 11 — Interface
- Auditoria Item 12 — Regras Compartilhadas
- Auditoria Item 13 — Performance
- Auditoria Item 14 — Testes
- Auditoria Item 15 — Históricos
- Auditoria Item 16 — Consolidação
- `docs/easypanel-deploys.md`
- `docs/mercado-livre-publicacao-operacional.md`
- `package.json`

## 34. Documentação oficial utilizada para o desenho de ambientes

- Easypanel — App Service: branch Git/GitHub, domínio, environment e deploys.
- Supabase — Self-hosting: stack self-hosted é um projeto único e não possui branching de preview do Supabase Cloud.
- Supabase — Managing Environments / Deployment: princípio de separar development/staging/production.
- GitHub — protected branches e deployment environments.
- Mercado Livre — Realização de testes: testes com usuários de teste, sem sandbox separado.
- Mercado Pago — credenciais e contas de teste.
- Brasil NFe — `TipoAmbiente = 2` para homologação.

---

## 35. Conclusão

A estrutura recomendada é:

```text
main = produção
dev = homologação
```

mas com isolamento completo:

```text
código
+
aplicação
+
banco
+
Storage/Auth
+
secrets
+
integrações
+
webhooks
+
jobs
```

O local de teste funcional do novo Vortek será:

```text
https://dev.vortek.shop
```

ligado a um Supabase staging separado.

`https://app.vortek.shop` e o Supabase de produção permanecem fora do ciclo de testes.

O Item 17 deve ser executado em mudanças pequenas. Cada mudança só passa de `dev` para `main` depois de validada em homologação.
