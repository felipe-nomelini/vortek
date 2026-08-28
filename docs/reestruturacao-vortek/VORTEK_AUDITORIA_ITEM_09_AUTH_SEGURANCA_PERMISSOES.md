# Vortek — Auditoria de Limpeza e Organização

## Item 9 — Auth + Segurança + Permissões

**Status:** Coleta técnica concluída; P0 de autorização pendente de correção  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Objetivo:** mapear autenticação, cargos, autorização web/mobile, rotas públicas, RLS/grants, uso de `service_role`, links públicos, exposição de secrets e dependências de segurança antes de qualquer limpeza estrutural.

---

## 1. Conclusão executiva

A separação básica de autenticação do Vortek é boa:

```text
web
→ Supabase Auth por cookie
→ getUser()

mobile
→ Bearer JWT
→ validação Supabase
→ cargo carregado de profiles

backend
→ service_role apenas no servidor
```

Também existem proteções importantes:

- `service_role` separado do cliente público;
- mobile não usa `user_metadata` para autorização;
- permissões mobile centralizadas;
- rotas administrativas importantes usam `requireAdminUser`;
- hardening do Data API revogou acesso direto das tabelas operacionais para `anon/authenticated`;
- buckets de etiquetas e comprovantes são privados;
- links públicos de fornecedores para GTIN possuem expiração;
- webhook Mercado Pago possui validação HMAC;
- existe checagem para evitar secrets sensíveis como build args.

Porém foi encontrado um **P0 real no modelo de autorização**.

Hoje existem dois caminhos que tornam `cargo` controlável pelo próprio usuário/caller:

```text
1. /api/auth/register
   recebe cargo do request
   ↓
   usa service_role
   ↓
   grava profiles.cargo

2. profiles
   authenticated possui UPDATE da própria linha
   ↓
   policy limita a linha, mas não as colunas
   ↓
   cargo pode ser alterado
```

Isso destrói a fronteira de confiança do RBAC.

Além disso, um usuário que consiga chegar a `admin` passa a acessar rotas administrativas que usam `service_role`, inclusive uma rota que atualmente retorna credenciais/tokens de integrações ao navegador.

### Prioridades principais

**P0**
- impedir imediatamente que usuário/caller controle `profiles.cargo`.

**P1**
- unificar autorização web/mobile para operações sensíveis;
- deixar de devolver secrets de integrações ao browser;
- tornar links públicos de NF-e, etiqueta e comprovante realmente expirantes;
- planejar saída do Next.js 14, hoje fora de suporte.

**P2**
- reduzir informação do health público;
- revisar disciplina de RLS/grants das migrations posteriores ao hardening;
- remover dados operacionais pessoais versionados no código;
- revisar nomenclatura/policies que dizem “Admin” mas verificam apenas `authenticated`.

Não foi encontrado secret de produção reproduzido nesta auditoria.

---

# 2. Cargos atuais

O enum atual é:

```text
admin
gerente
operador
visualizador
```

A consulta operacional somente leitura em `profiles` encontrou atualmente:

```text
2 perfis
2 admin
0 perfis de menor privilégio
```

### Interpretação

A vulnerabilidade de autoelevação não está sendo exercida por um usuário de menor cargo na amostra atual.

Isso **não reduz a gravidade estrutural**, porque:

- os cargos de menor privilégio fazem parte do sistema;
- o mobile já possui regras específicas para eles;
- o endpoint público de registro pode criar novos usuários quando o Auth aceitar signup.

---

# 3. Autenticação web

O middleware cria cliente SSR com:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

e valida a sessão com:

```text
supabase.auth.getUser()
```

Usuário não autenticado:

- recebe `401` em APIs protegidas;
- é redirecionado para `/login` nas páginas privadas.

### Avaliação

**Manter.**

O middleware serve bem como primeira barreira de autenticação.

Ele não deve ser tratado como única camada de autorização.

---

# 4. Autorização web no middleware

O middleware aplica autorização por cargo diretamente apenas para:

```text
/configuracoes*
→ admin
```

As demais páginas autenticadas, em geral, passam com qualquer usuário autenticado.

Nas APIs, várias rotas implementam seus próprios guards, mas outras dependem apenas da autenticação.

### Avaliação

**P1 — autorização web inconsistente.**

A autorização deve estar na operação/handler, não depender apenas da página estar escondida.

---

# 5. Autenticação mobile

O mobile:

1. exige Bearer;
2. valida o JWT com Supabase Auth;
3. carrega o perfil por `id`;
4. obtém `cargo` da tabela controlada;
5. aplica uma matriz de permissões.

O código documenta explicitamente que:

```text
user_metadata
```

não é usado como fonte de autorização.

### Avaliação

**Manter.**

É uma base melhor definida que a autorização web atual.

---

# 6. Permissões mobile

Existe uma fonte central:

```text
src/lib/mobile-permissions.ts
```

com permissões como:

```text
tv.read
sales.read
purchases.read
sales.track
sales.dslite.*
sales.internal_shipping.process
purchases.payment.confirm
```

A matriz atual é:

```text
admin       → todas
gerente     → todas
operador    → leitura + operação
visualizador→ leitura
```

### Avaliação

**Manter o conceito.**

Não criar outra matriz paralela para web.

O caminho mais simples no futuro é reutilizar a mesma regra de domínio.

---

# 7. P1 — `authorizeApiRequest` aplica permissão somente no mobile

O helper:

```text
authorizeApiRequest(request, permission)
```

funciona assim:

```text
Bearer/mobile
→ valida cargo
→ valida permission

web/cookie
→ valida apenas se existe user
→ retorna autorizado
```

Portanto o parâmetro de permissão é ignorado na origem web.

### Evidência concreta

A rota:

```text
POST /api/compras/[id]/confirmar-pagamento
```

pede:

```text
purchases.payment.confirm
```

No mobile, `operador` não possui essa permissão.

No web, qualquer usuário autenticado passa pelo helper.

Essa operação:

- marca pagamento a fornecedor como pago;
- persiste comprovante;
- pode enviar WhatsApp;
- pode retomar fulfillment DSLite.

### Avaliação

**P1 — autorização operacional/financeira inconsistente.**

Depois de corrigir o P0 de cargos, essa deve ser uma das primeiras correções de autorização.

---

# 8. Guards administrativos corretos

Algumas rotas já utilizam:

```text
requireAdminUser(...)
```

e confirmam `profiles.cargo = admin` no servidor.

Exemplos analisados:

- configurações;
- configuração de integrações;
- decisão sobre crédito de fornecedor.

### Avaliação

**Manter.**

Esse é o comportamento correto para operações estritamente administrativas.

---

# 9. P0 — registro público aceita `cargo` do caller

O middleware considera:

```text
/api/auth/*
```

público.

A rota:

```text
POST /api/auth/register
```

recebe:

```text
email
senha
nome
cargo
```

Depois:

1. chama `auth.signUp`;
2. cria um `serviceClient`;
3. insere o perfil;
4. grava diretamente:

```text
cargo: cargo || 'operador'
```

### Problema

O caller controla o valor de `cargo`.

Se signup estiver habilitado no Supabase Auth, uma requisição pública pode solicitar diretamente um cargo privilegiado.

### Limitação da auditoria

Não foi possível confirmar pelas ferramentas disponíveis o valor operacional atual de:

```text
DISABLE_SIGNUP / configuração equivalente do Auth
```

Portanto:

- a vulnerabilidade no código é confirmada;
- a possibilidade de cadastro público no ambiente atual depende da configuração runtime do Supabase Auth.

### Avaliação

**P0.**

Um endpoint público nunca deve aceitar cargo privilegiado escolhido pelo usuário e persistir isso com `service_role`.

---

# 10. P0 — usuário pode atualizar o próprio `cargo` pelo Data API

A migration inicial cria policy:

```text
Usuários podem atualizar seu próprio perfil
```

com condição:

```text
auth.uid() = id
```

Depois o hardening mantém acesso direto ao perfil e executa:

```text
grant select, update on public.profiles to authenticated
```

### Problema

RLS limita **quais linhas** podem ser alteradas.

Ela não limita **quais colunas** da linha podem ser alteradas.

Logo, com `UPDATE` de tabela, o próprio usuário pode tentar atualizar:

```text
cargo
```

na própria linha.

A documentação oficial do Supabase confirma que RLS por linha não restringe colunas e que `UPDATE` de tabela concede acesso às colunas salvo restrição específica.

### Avaliação

**P0 confirmado estruturalmente.**

A regra de “usuário pode editar o próprio perfil” precisa excluir qualquer campo de autorização.

---

# 11. Impacto do P0

O problema não é apenas aparecer como admin na interface.

O backend usa:

```text
profiles.cargo
```

como fonte de autorização.

Logo:

```text
controle de cargo
↓
requireAdminUser passa
↓
rotas administrativas passam
↓
service_role executa a operação
```

Isso pode permitir acesso a dados e operações privilegiadas.

### Avaliação

**Corrigir antes de continuar qualquer refatoração estrutural.**

---

# 12. P1 — rota administrativa devolve secrets ao navegador

A rota:

```text
/api/integracoes/config
```

é corretamente protegida por `requireAdminUser`.

Porém seu GET seleciona e devolve ao cliente campos sensíveis de integrações, incluindo:

- client secret;
- access token;
- refresh token.

O PATCH também retorna o registro atualizado com esses campos.

### Problema

Mesmo para admin legítimo, o navegador não precisa receber o valor integral de secrets já salvos apenas para exibir/configurar integrações.

### Impacto combinado

Com o P0 de cargo, a exposição se torna ainda mais crítica:

```text
autoelevação
→ admin
→ endpoint de integração
→ credenciais externas
```

### Avaliação

**P1 independente do P0.**

A API deve aceitar novos secrets quando necessário, mas respostas devem ser mascaradas/minimizadas.

Nenhum valor foi reproduzido neste documento.

---

# 13. Hardening do Data API

A migration:

```text
20260610001532_harden_public_table_access.sql
```

faz uma mudança importante:

```text
enable RLS em tabelas existentes
revoke anon
revoke authenticated
grant service_role
```

Também remove policies públicas antigas de:

- produtos;
- pedidos;
- clientes;
- fornecedores.

E define default privileges para impedir que futuras tabelas/functions criadas pelo papel configurado sejam automaticamente expostas.

### Avaliação

**Manter.**

A direção arquitetural é boa:

```text
browser
→ API Next.js
→ service_role
→ banco
```

O problema é que, quando o backend usa `service_role`, a autorização da API precisa ser correta porque `service_role` ignora RLS.

---

# 14. Service role

`createServiceClient()`:

- usa URL server-side;
- usa `SUPABASE_SERVICE_ROLE_KEY`;
- não persiste sessão;
- é usado em handlers backend.

O browser client usa a chave pública.

### Avaliação

**Manter.**

Não foi encontrado uso intencional de `service_role` em código client-side na amostra analisada.

---

# 15. P2 — disciplina de RLS após o hardening não é uniforme

Algumas migrations posteriores habilitam RLS explicitamente.

Exemplos:

```text
short_links
estoque_interno_movimentacoes
produto_kits
produto_kit_componentes
```

Porém existem migrations posteriores que criam tabelas sem:

```text
ALTER TABLE ... ENABLE ROW LEVEL SECURITY
```

Um exemplo confirmado é a criação de tabelas de alertas WhatsApp.

### Importante

O hardening também revogou default grants para `anon/authenticated`, então ausência de RLS **não prova exposição atual**.

A exposição real depende de:

- papel que criou a tabela;
- default privileges efetivos;
- grants atuais no banco operacional.

### Avaliação

**P2 — disciplina inconsistente / revisar no Item 10.**

No Item 10 deve ser validado o estado real de:

```text
pg_policy
grants
RLS enabled
default privileges
```

para todas as tabelas.

---

# 16. P2 — policies de kit chamadas “Admin” não verificam admin

A migration de kits cria policies com nomes como:

```text
Admin pode gerenciar kits de produto
```

mas a expressão é:

```text
auth.role() = 'authenticated'
```

Isso significa:

```text
qualquer usuário autenticado
```

e não:

```text
profiles.cargo = admin
```

### Situação atual

A falta de grant direto para `authenticated`, se confirmada no banco, pode impedir o acesso pelo Data API.

Mesmo assim, a policy é semanticamente errada e cria uma armadilha futura: um grant posterior pode transformar essa policy em acesso amplo.

### Avaliação

**P2 — corrigir nomenclatura/regra no plano de banco.**

---

# 17. Rotas públicas

O middleware libera:

```text
/api/public/*
/api/webhooks/*
/api/auth/*
/api/ops/health
```

Também libera duas páginas específicas de fornecedor e `/s/*`.

Essa escolha não é errada por si só.

Rotas públicas precisam apenas possuir um controle próprio compatível com seu propósito.

---

# 18. Links de fornecedor para cadastro de GTIN

Os fluxos públicos de BKR1 e Evolusom:

- usam HMAC;
- incluem `expiresAt`;
- rejeitam token expirado;
- limitam SKU/produto elegível;
- validam GTIN;
- validam fornecedor;
- aplicam verificações adicionais antes da atualização.

### Avaliação

**Manter.**

É um bom exemplo de link público operacional com escopo e expiração.

---

# 19. P1 — links públicos de documentos não expiram de verdade

Foram analisados links públicos de:

- etiqueta de envio;
- comprovante de pagamento do fornecedor;
- DANFE;
- XML da NF-e.

Eles usam HMAC e `timingSafeEqual`, portanto não são links triviais de adivinhar.

Porém os tokens são calculados apenas com:

```text
tipo + ID
```

e não possuem:

```text
expiresAt
nonce revogável
uso único
```

### Consequência

A URL assinada do Storage pode expirar em minutos/horas.

Mas o endpoint público aceita o mesmo token novamente e gera uma nova URL, ou retorna o documento novamente.

Assim, se o link público vazar:

```text
o acesso permanece válido indefinidamente
até rotação do segredo
```

### Gravidade

Esses documentos podem conter dados fiscais, logísticos ou financeiros.

### Avaliação

**P1.**

O padrão correto já existe nos links BKR1/Evolusom: token com prazo.

Não criar novo serviço de links.

---

# 20. Short links

`short_links` possui suporte a:

```text
expires_at
```

e o resolver `/s/[code]` respeita esse prazo.

Porém:

```text
createShortLink(...)
```

usa:

```text
expiresAt = null
```

quando o caller não informa prazo.

No fluxo de comprovante analisado, não é passado `expiresAt`.

### Avaliação

**P1 associado aos links de documento.**

A infraestrutura já suporta expiração; deve ser utilizada.

---

# 21. P2 — `/api/ops/health` é público e detalhado demais

O endpoint público retorna informações como:

- PID;
- uptime;
- uso de memória;
- jobs ativos;
- diagnóstico de autenticação Mercado Livre;
- estado de expiração/conectividade;
- configuração fiscal de ambiente.

Ele não retorna os tokens em si.

### Avaliação

**P2 — exposição operacional desnecessária.**

Health público deve responder somente o mínimo necessário para monitoramento externo.

Diagnóstico detalhado deve exigir autenticação interna/admin.

---

# 22. Webhooks

## Mercado Pago

O Item 8 confirmou:

```text
HMAC
x-signature
x-request-id
```

antes de processar pagamentos.

### Avaliação

**Manter.**

## Mercado Livre

O handler valida:

```text
user_id
```

contra a conta autorizada e depois busca o recurso real na API.

### Avaliação

**Manter o desenho atual.**

A revisão de autenticidade específica do callback deve continuar baseada no contrato oficial do Mercado Livre; não inventar assinatura que a API não forneça.

---

# 23. Rotas internas por API key

O middleware permite chamadas de sistema em grupos específicos quando:

```text
x-api-key == API_SECRET_KEY
```

Isso atende:

- sync;
- pedido DSLite interno;
- refresh de catálogo;
- fluxo específico de anúncio.

### Avaliação

**Manter por enquanto.**

Não colocar essa chave em cliente/browser.

No Item 10/15 deve ser verificado se existem rotas antigas que ainda aceitam esse mecanismo sem necessidade.

---

# 24. P1 — Next.js 14 está fora de suporte

O lockfile atual fixa:

```text
Next.js 14.2.35
```

A política oficial atual do Next.js considera suportadas:

```text
16.x → Active LTS
15.x → Maintenance LTS
```

e lista:

```text
14.x → unsupported
```

Em 25/08/2026 o Next.js publicou nova rodada de correções de segurança críticas para as linhas suportadas.

### Importante

Esta auditoria **não afirma** que o Vortek é explorável pelos CVEs específicos dessa rodada.

O problema confirmado é:

```text
produção em major sem suporte
→ ausência de garantia de novos patches de segurança
```

### Avaliação

**P1 — planejar upgrade para linha suportada.**

Não fazer atualização de major de forma improvisada junto com o P0.

Primeiro corrigir autorização; depois planejar upgrade com testes.

---

# 25. Secrets no repositório/build

O repositório possui:

```text
scripts/check-build-secrets.sh
```

que detecta uso de secrets sensíveis como build args.

O `.gitignore` cobre:

- `.env.local`;
- `.env.deploy.local`;
- arquivos de runtime/desenvolvimento relevantes.

A raiz pública analisada contém `.env.example`, não um `.env` de produção.

### Avaliação

**Boa direção.**

Nesta auditoria não foi identificado um arquivo de credenciais de produção versionado na raiz.

Não foi feita varredura forense de todo o histórico Git.

---

# 26. P2 — dados operacionais pessoais versionados em migration

Foi identificada uma migration contendo números de WhatsApp operacionais em texto claro.

Os valores não são reproduzidos neste documento.

### Avaliação

**P2 — remover configuração pessoal do código no futuro e revisar histórico.**

Não são secrets de autenticação, mas não precisam estar em um repositório público.

A classificação definitiva/limpeza de histórico deve ocorrer no Item 15.

---

# 27. P3 — `.gitignore` não bloqueia `.env` genérico

O `.gitignore` atual ignora arquivos específicos como:

```text
.env.local
.env.deploy.local
```

mas não possui regra genérica para:

```text
.env
.env.*
```

com exceção explícita para `.env.example`.

### Estado atual

Nenhum `.env` de produção apareceu na raiz pública analisada.

### Avaliação

**P3 preventivo.**

Uma regra mais segura reduz risco de commit acidental futuro.

---

# 28. Storage privado

As migrations analisadas definem como privados:

```text
etiquetas
supplier-payment-receipts
```

### Avaliação

**Manter.**

O problema atual desses documentos não é bucket público.

É a duração do token da rota pública que cria/entrega acesso.

---

# 29. Modelo desejado de autorização

A direção mais simples é manter:

```text
profiles.cargo
```

como fonte única de papel, mas impedir que usuário comum modifique o campo.

Depois:

```text
cargo
↓
uma regra compartilhada de permissions
↓
web
mobile
APIs
```

Exemplo conceitual:

```text
admin/gerente
→ permissões administrativas/financeiras conforme regra

operador
→ operações de fulfillment

visualizador
→ leitura
```

Não precisamos introduzir:

- novo serviço de IAM;
- ACL externa;
- tabela complexa por usuário;
- JWT customizado apenas para resolver esse problema.

---

# 30. Correção mínima conceitual do P0

Sem executar agora, a direção deve ser:

```text
1. /api/auth/register
   não aceitar cargo do caller
   OU
   tornar criação de usuário uma operação admin

2. profiles
   authenticated não pode atualizar cargo
   usuário pode atualizar apenas campos pessoais permitidos

3. mudanças de cargo
   somente por endpoint administrativo protegido

4. testar explicitamente:
   operador não vira admin
   visualizador não vira operador
   caller público não escolhe cargo
```

A documentação oficial do Supabase recomenda separar dados de perfil editáveis de dados usados para autorização, ou restringir privilégios por coluna quando necessário.

---

# 31. Correção conceitual de permissões web

Depois do P0:

```text
authorizeApiRequest(request, permission)
```

deve aplicar a mesma permissão independentemente da origem:

```text
web
mobile
```

A autenticação pode continuar diferente:

```text
cookie
Bearer
```

Mas a autorização precisa terminar na mesma regra.

### Avaliação

**Consolidar, não duplicar.**

---

# 32. O que NÃO fazer

Não devemos:

- criar outro sistema de usuários;
- mover autorização para `user_metadata`;
- confiar apenas no middleware;
- criar cargo separado para mobile e web;
- criar uma tabela de ACL por endpoint sem necessidade;
- expor `service_role` ao browser;
- colocar secrets em JWT/client;
- tornar buckets públicos para simplificar links;
- remover todos os endpoints públicos;
- reescrever Auth;
- fazer upgrade de Next.js junto com todas as correções de segurança em um único big bang.

---

# 33. Prioridades consolidadas

## P0 — corrigir antes de prosseguir com mudanças estruturais

### P0.1
`/api/auth/register` aceita `cargo` controlado pelo caller e persiste com `service_role`.

### P0.2
`profiles` concede `UPDATE` da própria linha inteira a `authenticated`, incluindo `cargo`.

---

## P1 — alto

### P1.1
Permissão passada para `authorizeApiRequest` é aplicada no mobile, mas ignorada no web.

### P1.2
`/api/integracoes/config` devolve secrets/tokens ao navegador admin.

### P1.3
Links públicos de NF-e/etiqueta/comprovante possuem token sem expiração.

### P1.4
Next.js 14.2.35 está em major oficialmente sem suporte.

---

## P2 — médio

### P2.1
Health público expõe diagnóstico interno excessivo.

### P2.2
RLS/grants posteriores ao hardening precisam auditoria de consistência.

### P2.3
Policies de kit chamadas “Admin” testam apenas `authenticated`.

### P2.4
Dados operacionais pessoais foram versionados em migration pública.

---

## P3 — baixo

### P3.1
`.gitignore` não protege `.env` genérico.

---

# 34. Dependências para itens futuros

## Item 10 — Banco de Dados

Após corrigir o P0, confirmar no banco real:

- `pg_policy`;
- `relrowsecurity`;
- grants por tabela/coluna;
- default privileges;
- functions `SECURITY DEFINER`;
- policies das tabelas criadas após o hardening;
- roles com acesso ao schema público.

## Item 11 — Interface Web

Confirmar:

- páginas visíveis por cargo;
- botões de operações sensíveis;
- ausência de falsa segurança baseada apenas em esconder UI.

## Item 12 — Regras Compartilhadas

Consolidar:

- matriz de permissões;
- `requireAdminUser`;
- `authorizeApiRequest`;
- autorização web/mobile;
- regra de alteração de cargo.

## Item 14 — Testes

Adicionar cobertura mínima de segurança:

```text
anon não altera cargo
authenticated não altera cargo
operador não confirma pagamento
visualizador não executa operação
admin executa operação permitida
links expirados falham
```

## Item 15 — Scripts + Documentação + Históricos

Revisar:

- números/dados pessoais em migrations/histórico;
- aliases e endpoints antigos de auth;
- secrets históricos;
- scripts de build/deploy;
- arquivos `.env` antigos, se houver no histórico.

---

# 35. Resultado do checklist — Item 9

- [x] Mapear usuários, cargos e autenticação.
- [x] Revisar middleware e rotas públicas.
- [x] Revisar modelo de autorização web.
- [x] Revisar modelo de autorização mobile.
- [x] Revisar RLS/grants disponíveis nas migrations relacionadas.
- [x] Identificar uso de `service_role`.
- [x] Identificar secrets ou permissões excessivas.
- [x] Revisar links públicos de documentos.
- [x] Revisar health público.
- [x] Revisar buckets privados relacionados.
- [x] Comparar RLS/column privileges com documentação oficial Supabase.
- [x] Comparar versão Next.js com política oficial de suporte.
- [x] Identificar P0 de autoelevação/criação de cargo.
- [x] Identificar P1 de autorização web/mobile divergente.
- [x] Identificar P1 de exposição de secrets ao browser admin.
- [x] Identificar P1 de links públicos sem expiração.
- [ ] **Corrigir o P0 de cargo antes de prosseguir para mudanças estruturais.**

---

# 36. Restrições desta etapa

Nesta etapa:

- nenhum usuário foi criado;
- nenhum cargo foi alterado;
- nenhuma tentativa de exploração foi executada;
- nenhum secret foi acessado ou reproduzido;
- nenhuma RLS/policy/grant foi alterada;
- nenhuma migration foi executada;
- nenhum código foi alterado;
- nenhum deploy foi realizado;
- nenhum teste de segurança foi executado contra produção.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise das migrations relacionadas;
- consulta somente leitura dos cargos existentes;
- consulta à documentação oficial atual do Supabase;
- consulta à documentação oficial atual do Next.js.

A configuração runtime de signup do Supabase Auth não pôde ser confirmada pelas ferramentas disponíveis.

---

# 37. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Código Vortek — branch `dev`

Arquivos principais:

- `src/middleware.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/login/route.ts`
- `src/lib/auth/admin.ts`
- `src/lib/api-request-auth.ts`
- `src/lib/mobile-auth.ts`
- `src/lib/mobile-permissions.ts`
- `src/lib/supabase.ts`
- `src/app/api/compras/[id]/confirmar-pagamento/route.ts`
- `src/app/api/fornecedores/creditos/[id]/route.ts`
- `src/app/api/configuracoes/route.ts`
- `src/app/api/integracoes/config/route.ts`
- `src/app/api/ops/health/route.ts`
- `src/app/api/public/comprovantes-fornecedor/[id]/route.ts`
- `src/app/api/public/etiquetas/[id]/route.ts`
- `src/app/api/public/notas-fiscais/[id]/danfe/route.ts`
- `src/app/api/public/notas-fiscais/[id]/xml/route.ts`
- `src/lib/public-supplier-receipt-links.ts`
- `src/lib/public-shipping-label-links.ts`
- `src/lib/public-nfe-links.ts`
- `src/lib/public-bkr1-kit-links.ts`
- `src/lib/public-evolusom-gtin-links.ts`
- `src/lib/short-links.ts`
- `src/app/s/[code]/route.ts`
- `package.json`
- `package-lock.json`
- `.gitignore`
- `scripts/check-build-secrets.sh`

## Migrations principais

- `00001_schema.sql`
- `20260610001532_harden_public_table_access.sql`
- `20260618185121_shipping_labels_storage.sql`
- `20260618212911_short_links.sql`
- `20260619153640_whatsapp_alerts.sql`
- `20260619192918_supplier_payment_receipts.sql`
- `20260714193934_kit_inventory.sql`
- `20260720010000_estoque_interno.sql`

## Banco operacional — somente leitura

Consultado:

- `profiles` — apenas coluna `cargo`.

## Supabase — documentação oficial

Row Level Security:

`https://supabase.com/docs/guides/database/postgres/row-level-security`

Column Level Security:

`https://supabase.com/docs/guides/database/postgres/column-level-security`

Securing the Data API:

`https://supabase.com/docs/guides/api/securing-your-api`

## Next.js — documentação oficial

Support Policy:

`https://nextjs.org/support-policy`

Security releases:

`https://nextjs.org/blog`

---

# 38. Conclusão final do Item 9

A autenticação do Vortek não precisa ser reescrita.

As bases corretas já existem:

```text
Supabase Auth
+
profiles
+
service_role somente no backend
+
permissões mobile
+
admin guard
+
RLS/grants
```

O problema é que a fronteira mais importante — **quem controla o cargo** — está quebrada.

Antes de qualquer limpeza estrutural adicional, o sistema precisa garantir:

```text
usuário não escolhe cargo
+
usuário não altera cargo
+
somente operação administrativa muda cargo
```

Depois disso, o próximo passo de segurança é fazer a autorização web usar a mesma matriz de permissões já existente para mobile.

O **Item 9 está com a coleta concluída, mas não deve ser marcado como encerrado enquanto o P0 de cargo permanecer aberto**.
