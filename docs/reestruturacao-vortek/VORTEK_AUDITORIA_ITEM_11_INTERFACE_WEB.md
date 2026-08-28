# Vortek — Auditoria de Limpeza e Organização

## Item 11 — Interface Web

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Observação:** o P0 de autorização identificado no Item 9 permanece aberto.  
**Objetivo:** revisar a interface web depois do mapeamento dos domínios, identificar páginas que misturam responsabilidades, regras de negócio no cliente, componentes/fluxos duplicados, chamadas desnecessárias e arquivos grandes que realmente justificam separação, sem refatoração estética.

---

## 1. Conclusão executiva

A interface web do Vortek **não precisa ser reescrita** e o uso amplo de Client Components não é, sozinho, um problema.

O sistema é uma aplicação operacional altamente interativa:

- tabelas;
- filtros;
- modais;
- acompanhamento de jobs;
- uploads;
- polling;
- ações administrativas;
- integração Mercado Livre/DSLite;
- operação fiscal e logística.

Portanto, muitas telas realmente precisam de:

```text
'use client'
+
state
+
effects
+
event handlers
```

O problema confirmado é mais específico.

Algumas telas cresceram até se tornar **orquestradores grandes demais**, misturando:

```text
listagem
+
filtros
+
mapeamento de DTO
+
ações de negócio
+
polling
+
modais
+
integrações
+
renderização
```

Os maiores candidatos a simplificação são:

```text
Pedidos        ~2.526 linhas
Produtos       ~2.419 linhas
CatalogoView   ~1.702 linhas
Configurações  ~1.251 linhas
Compras          ~976 linhas
Anúncios          ~934 linhas
```

Tamanho, sozinho, **não é critério de refatoração**.

Em Pedidos, Produtos, Catálogo e Configurações há responsabilidades diferentes comprovadas, portanto a separação futura é justificável.

### Principais achados

**P1 carregado do Item 9**
- a tela de Configurações recebe e mantém secrets/tokens completos no browser.

**P2**
1. fluxo de acompanhamento de publicação ML está duplicado em Produtos e Catálogo;
2. cálculo de lucro/preço possui fontes diferentes de regra: serviço central usa imposto padrão de 5%, enquanto `Anúncios` e `preco-detalhe` possuem cálculo local de 4%;
3. Pedidos usa o tipo da tabela `pedidos` para dados enriquecidos da API/view e compensa a diferença com muitos `as any`;
4. Compras refaz chamadas independentes de filtros a cada atualização da lista;
5. Perguntas aplica busca e filtros de data apenas sobre a página atual já carregada, embora a UI apresente busca/filtro de forma geral;
6. Sidebar mostra Configurações sem considerar `cargo`, apesar de a rota ser restrita a admin;
7. algumas páginas concentram vários domínios operacionais no mesmo Client Component.

**P3**
- oportunidade de reduzir client boundaries e JavaScript em telas específicas depois da separação, mas isso não deve virar uma migração ampla para Server Components.

Não foi identificado um novo P0 na interface.

---

# 2. Organização atual

Os principais módulos web identificados são:

```text
anuncios
catalogo
clientes
compras
configuracoes
dashboard
estoque
fornecedores
notas-fiscais
pedidos
perguntas
produtos
reclamacoes
reputacao
tv
```

Os componentes compartilhados atuais incluem:

```text
ResizableTable
ProgressModal
TrackingModal
QualidadeModal
Sidebar
componentes de catalogo
```

### Avaliação

A organização por domínio está correta.

Não é necessário criar:

```text
features/
domains/
modules/
```

ou outra árvore paralela apenas por preferência arquitetural.

A limpeza deve acontecer dentro da estrutura que já existe.

---

# 3. Client Components não são o problema por si só

Muitas páginas começam com:

```text
'use client'
```

A documentação atual do Next.js orienta Client Components para:

- state;
- event handlers;
- lifecycle/effects;
- browser APIs.

Essas características existem fortemente no Vortek.

O Next.js também suporta aplicações com comportamento SPA/client-side e permite adoção progressiva de Server Components.

### Avaliação

**Não converter todas as páginas para Server Components.**

A direção futura é:

```text
separar responsabilidades reais
↓
depois reduzir a boundary client onde isso ficar naturalmente simples
```

e não o contrário.

---

# 4. Páginas pequenas/coesas — preservar

Nem toda tela precisa ser dividida.

Exemplos observados:

## Estoque

A página é pequena e focada em:

- carregar movimentos;
- atualizar situação;
- adicionar entrada;
- refresh periódico.

### Avaliação

**Manter simples.**

---

## Clientes

A tela é relativamente pequena e focada no domínio de clientes.

### Avaliação

**Não refatorar por estética.**

---

## Fornecedores

Possui tamanho moderado e responsabilidades compatíveis com o domínio.

### Avaliação

**Revisar somente se Item 12/13 revelar regra ou chamada duplicada.**

---

# 5. Pedidos — maior ponto de concentração da UI

Arquivo:

```text
src/app/(app)/pedidos/page.tsx
```

possui aproximadamente:

```text
2.526 linhas
```

A página concentra:

- filtros;
- visão operacional;
- resumo;
- tabela;
- exportação PDF;
- tracking;
- WhatsApp;
- envio de etiqueta;
- polling de WhatsApp;
- criação/retomada DSLite;
- polling de job DSLite;
- confirmação de pagamento do fornecedor;
- upload de comprovante;
- seleção de frete;
- emissão/vínculo fiscal;
- download de etiquetas;
- vários modais;
- transformação do DTO da API.

### Avaliação

**P2 — responsabilidades comprovadamente diferentes.**

A futura separação é justificada.

Não dividir em dezenas de hooks genéricos.

O caminho mais simples é manter a página como orquestradora e extrair apenas blocos funcionais que já possuem fronteira clara, por exemplo:

```text
fluxo DSLite
fluxo pagamento fornecedor
fluxo etiqueta/WhatsApp
modais correspondentes
```

A lista/filtros podem continuar na página.

---

# 6. Pedidos — DTO incorreto na fronteira da interface

A função:

```text
mapDBtoOrder(...)
```

declara entrada como:

```text
Database['public']['Tables']['pedidos']['Row']
```

Porém a resposta consumida contém campos enriquecidos/derivados, como:

```text
compra_id
fornecedor_nome
internal_stock_available
dslite_next_action
is_virtual_kit
operational_dslite_ids
whatsapp_label_status
...
```

Para acessar esses campos a tela utiliza repetidamente:

```text
(item as any)
```

### Problema

A UI está tipando uma resposta operacional como se fosse uma linha bruta da tabela `pedidos`.

### Avaliação

**P2 — contrato API/UI incorreto.**

A solução futura não é “remover todos os `any`” manualmente.

A solução é definir o tipo real da resposta da API de pedidos e usar esse contrato na UI.

Isso deve ser consolidado com o Item 12.

---

# 7. Pedidos — listagem + resumo

A página busca em paralelo:

```text
/api/pedidos
/api/pedidos/resumo
```

com os mesmos filtros principais.

### Avaliação

**Não classificado como desperdício neste item.**

Lista paginada e resumo global possuem objetivos diferentes.

Não fundir endpoints ou carregar todos os pedidos apenas para calcular cards no cliente.

A performance real fica para o Item 13.

---

# 8. Produtos — página muito ampla

Arquivo:

```text
src/app/(app)/produtos/page.tsx
```

possui aproximadamente:

```text
2.419 linhas
```

A página concentra:

- listagem de produtos;
- filtros;
- stats;
- preço customizado;
- cálculo de preço/lucro;
- oferta preferencial;
- publicação Mercado Livre;
- criação de anúncio;
- categorização;
- atributos;
- GTIN;
- imagens;
- acompanhamento da outbox;
- aplicação de atacado;
- múltiplos modais.

### Ponto positivo

A listagem utiliza:

```text
calculateSuggestedPrice
calculateNetProfitAtPrice
```

do serviço central de pricing.

### Avaliação

Existe boa reutilização parcial.

O problema é a quantidade de fluxos independentes dentro da mesma página.

---

# 9. Produtos — separação futura recomendada

Não dividir por tamanho.

As fronteiras naturais são:

```text
lista/filtros de produto
edição de preço customizado
publicação/criação ML
acompanhamento de publicação ML
```

### Avaliação

**P2 — candidato a separação funcional.**

A página pode continuar como shell/orquestrador.

Não criar um framework interno de formulários ou uma camada genérica de “ações de produto”.

---

# 10. Catálogo — wrapper já simples

A rota de catálogo já possui uma decisão boa.

A página de rota é pequena e delega para:

```text
CatalogoView
```

### Avaliação

**Manter.**

Esse é um exemplo correto de extração por responsabilidade.

---

# 11. `CatalogoView` ainda concentra muitos fluxos

O componente:

```text
src/components/catalogo/CatalogoView.tsx
```

possui aproximadamente:

```text
1.702 linhas
```

Ele atende modos diferentes e concentra:

- listagem;
- refresh durável;
- status de job;
- análise de preço;
- Buy Box;
- opt-in;
- atualização de preço;
- polling de outbox;
- aplicação de atacado;
- modais;
- múltiplas tabelas.

### Avaliação

**P2 — pode ser dividido por fluxo real.**

As fronteiras mais claras são:

```text
refresh/análise
lista no catálogo
elegíveis
publicação de preço
```

Não separar simples render functions apenas para diminuir número de linhas.

---

# 12. P2 — fluxo ML de publicação duplicado em Produtos e Catálogo

Produtos e `CatalogoView` possuem implementações muito semelhantes de:

- `parseOutboxStepLabel`;
- `buildMlPublishSteps`;
- polling de `/api/ml/anuncio/atualizar-preco/status`;
- estado do modal;
- retry;
- acompanhamento de outbox;
- aplicação de atacado pelo modal;
- mensagens de resultado.

Os dois também chamam:

```text
/api/ml/anuncio/aplicar-atacado
```

e reiniciam o mesmo acompanhamento.

### Avaliação

**Duplicação real confirmada.**

É um bom candidato a **uma única implementação client-side compartilhada**.

Não criar abstração genérica de polling.

Criar/reutilizar apenas o fluxo específico:

```text
ML price publish tracking
```

porque já existem pelo menos dois consumidores reais.

---

# 13. Anúncios — regra de lucro fora da fonte central

Arquivo:

```text
src/app/(app)/anuncios/page.tsx
```

define localmente:

```text
lucro =
preço
- custo
- frete
- 4% imposto
- taxa ML
```

O endpoint:

```text
/api/ml/anuncio/preco-detalhe
```

repete o mesmo cálculo de 4%.

Ao mesmo tempo, o serviço central:

```text
src/services/pricing.ts
```

possui:

```text
TAX_RATE = 5%
```

para:

- break-even;
- lucro líquido em um preço;
- margem exata;
- preço sugerido.

O serviço também possui uma constante específica de 4% para outra função:

```text
TARGET_NET_PROFIT_TAX_RATE
```

### Conclusão

Não é correto afirmar, apenas por esta auditoria, que “4% está errado”.

O problema confirmado é:

```text
existem contextos de 4% e 5%
+
a regra do modal foi reimplementada localmente
+
o ownership não está explícito
```

### Avaliação

**P2 — regra de negócio duplicada/ambígua.**

O Item 12 precisa decidir qual regra fiscal/pricing pertence a cada cálculo e centralizar a implementação correspondente.

---

# 14. Anúncios — atacado calculado no cliente

A página monta a prévia:

```text
3 unidades  → -3%
5 unidades  → -4%
10 unidades → -5%
```

diretamente no cliente.

### Importante

O cliente não é a autoridade final da publicação.

A operação real é enviada ao backend/outbox.

### Avaliação

**P2 — preview de regra de negócio não deve possuir fórmula independente.**

Se essas faixas são a regra oficial do Vortek, a UI deveria receber/reutilizar a mesma regra que o backend usa.

Isso evita drift futuro.

---

# 15. Compras — mistura operação + financeiro

Arquivo:

```text
src/app/(app)/compras/page.tsx
```

concentra:

- lista de compras;
- resumo;
- alertas de anúncios ML;
- saldo Hayamax;
- recarga Hayamax;
- importação de extrato;
- revisão de movimentos Mercado Pago;
- estado de pagamento de fornecedor.

### Avaliação

**P2 — domínio principal + painel financeiro misturados.**

Não é urgente dividir a página, mas existe fronteira real entre:

```text
listagem de compras
e
painel financeiro Hayamax/Mercado Pago
```

---

# 16. P2 — Compras refaz chamadas independentes dos filtros

`fetchData()` executa em paralelo:

```text
/api/compras
/api/compras/resumo
/api/ml/anuncios/alertas
```

e depois, sequencialmente:

```text
/api/fornecedores/saldo-hayamax
```

A função depende de:

- página;
- ordenação;
- busca;
- status;
- datas.

Consequentemente, trocar página/filtro pode refazer também:

```text
alertas ML
saldo Hayamax
```

que não dependem desses filtros.

### Avaliação

**P2 — chamadas desnecessárias confirmadas.**

A futura simplificação pode separar:

```text
fetch da listagem/resumo
```

de:

```text
fetch dos indicadores operacionais independentes
```

Sem cache novo e sem nova biblioteca.

---

# 17. Perguntas — paginação no servidor

A API:

```text
/api/perguntas
```

envia ao Mercado Livre:

```text
limit
offset
status
```

e retorna o total global da consulta.

A página usa:

```text
PAGE_SIZE = 100
```

### Avaliação

A paginação no servidor é correta.

Não carregar todas as perguntas no navegador.

---

# 18. P2 — busca e datas de Perguntas filtram somente a página atual

A UI possui:

```text
Buscar (ID, anúncio, cliente, pergunta)
```

e filtros de:

```text
data da pergunta
data da resposta
```

Porém esses valores **não são enviados à API**.

Eles são aplicados com:

```text
questions.filter(...)
```

apenas sobre as 100 perguntas carregadas da página atual.

### Consequência

Um usuário pode buscar algo que existe na página 2 e receber:

```text
0 resultados
```

na página 1.

Os cards:

```text
Pendentes
Respondidas
```

também são calculados sobre o array carregado, não necessariamente sobre o universo inteiro.

### Avaliação

**P2 — comportamento da interface potencialmente enganoso.**

A solução futura deve escolher uma semântica única:

```text
filtro global → backend/provider
```

ou deixar explicitamente claro:

```text
filtrar página atual
```

Para busca operacional, o comportamento global tende a ser o esperado, mas a implementação deve respeitar o contrato oficial do Mercado Livre.

---

# 19. Configurações — muitas responsabilidades distintas

Arquivo:

```text
src/app/(app)/configuracoes/page.tsx
```

possui aproximadamente:

```text
1.251 linhas
```

Concentra:

- empresa;
- configurações gerais;
- integrações;
- fiscal;
- notificações;
- usuários;
- criação/edição de usuário.

### Avaliação

**P2 — separação por seções é justificável.**

Tabs já existem.

O caminho natural é transformar as tabs realmente independentes em componentes, mantendo uma única rota de Configurações.

Não criar novas páginas/rotas se isso não melhorar a operação.

---

# 20. P1 carregado — secrets mantidos no estado do browser

A tela carrega da API e coloca em state valores completos como:

```text
client_secret
access_token
refresh_token
```

e os usa em inputs de senha.

### Avaliação

**P1 já identificado no Item 9.**

A raiz do problema está no contrato da API.

A UI futura deve trabalhar com algo como:

```text
configured = true
valor mascarado/não retornado
```

e enviar um novo secret apenas quando houver alteração.

Não implementar uma máscara visual mantendo o secret real no JavaScript; isso não resolve o problema.

---

# 21. Sidebar — autorização visual não acompanha o cargo

`Sidebar.tsx` inclui:

```text
/configuracoes
```

na lista fixa.

O componente não consulta `cargo`.

Ele usa `localStorage` para nome/avatar e status de integrações.

### Estado de segurança

O middleware/backend continuam sendo a proteção real.

Esconder menu nunca deve substituir autorização.

### Avaliação

**P2/P3 — UX de permissão inconsistente.**

Depois de o P0 do Item 9 ser corrigido e a matriz web/mobile ser consolidada, a Sidebar deve apenas refletir as permissões reais.

Não criar lógica de autorização exclusiva na Sidebar.

---

# 22. Dashboard

A tela busca em paralelo informações de:

- resumo;
- reputação;
- integrações.

Também acompanha sync manual.

### Avaliação

**Coerente com a função de dashboard.**

Não foi encontrado motivo para separar por estética.

---

# 23. TV

A tela TV possui atualização frequente de dados ao vivo e atualização completa em frequência menor.

### Avaliação

Isso pode ser necessário para o objetivo da tela.

Não classificar como excesso sem medir:

- payload;
- custo;
- latência;
- render.

Fica para Item 13.

---

# 24. Notas Fiscais

A tela concentra ações de um mesmo domínio:

- lista;
- visualizar;
- baixar;
- email;
- cancelamento;
- CCe;
- acompanhamento de estado.

### Avaliação

O número de ações não prova mistura indevida.

**Não dividir automaticamente.**

Se futuras métricas ou regras duplicadas aparecerem, revisar pontualmente.

---

# 25. Reputação e Reclamações

São telas de integração Mercado Livre com estado e ações específicas.

### Avaliação

Nenhuma necessidade estrutural clara de divisão foi confirmada neste item.

---

# 26. Componentes compartilhados existentes — preservar

Há reutilização real de:

```text
ResizableTable
ProgressModal
TrackingModal
remote-sort helpers
format helpers
pricing service
CatalogoView
```

### Avaliação

A interface não está sem organização.

A limpeza deve **estender mecanismos compartilhados que já provaram utilidade**.

Não criar biblioteca interna genérica de:

```text
TablePage
ApiHook
ModalManager
PollingEngine
```

apenas para padronizar aparência.

---

# 27. P2 — regra de negócio ainda aparece na UI

Além do pricing, existem pequenos helpers de decisão/estado dentro de páginas.

Nem todos são problema.

### Regra prática para o plano

Pode permanecer na UI:

```text
label
cor
formatação
estado visual
texto de progresso
```

Deve sair da UI quando for fonte de decisão operacional:

```text
cálculo de preço/lucro
elegibilidade
fulfillment
disponibilidade
permissão
estado terminal
```

### Avaliação

O Item 12 deve usar essa fronteira para consolidar somente regras confirmadas como duplicadas.

---

# 28. `any` na interface

Existem usos de `any` em várias páginas.

O caso mais significativo é Pedidos, porque os casts escondem uma divergência real entre:

```text
tipo declarado
e
payload recebido
```

### Avaliação

**Não executar campanha de “remover any”.**

Corrigir tipos apenas onde representam contrato real mal definido.

Isso reduz código e risco ao mesmo tempo.

---

# 29. Filtros e summaries no backend

Várias telas já utilizam:

```text
paginação remota
ordenação remota
resumo remoto
```

Exemplos:

- pedidos;
- produtos;
- compras.

### Avaliação

**Boa direção.**

Não mover cálculos globais para o cliente para “simplificar API”.

---

# 30. Requisições e race conditions

Produtos já usa IDs de request para não aplicar resposta antiga sobre uma consulta nova.

Pedidos aplica debounce antes de atualizar a lista.

### Avaliação

Há cuidados reais com concorrência no cliente.

Não substituir por nova biblioteca de fetching sem necessidade comprovada.

O Vortek web atual não usa TanStack Query como padrão raiz, e `AGENTS.md` orienta preservar os padrões atuais salvo necessidade.

---

# 31. Next.js — direção correta para futuras mudanças

A documentação atual do Next.js recomenda:

```text
Server Components
para dados/partes sem interação

Client Components
para state/eventos/browser APIs
```

Também orienta posicionar `'use client'` em boundaries mais específicas quando isso ajuda a reduzir JavaScript.

### Avaliação para Vortek

Isso deve ser aplicado **progressivamente**, depois de separar responsabilidades.

Exemplo:

```text
page/server shell
↓
client list/filter component
↓
client operational modal
```

somente quando simplificar.

Não é prioridade antes dos P0/P1 funcionais.

---

# 32. Complexidade essencial — preservar

## Interface operacional
- modais de fluxo;
- progresso de jobs;
- polling quando acompanha operação assíncrona real;
- filtros;
- tabelas;
- upload;
- ações contextuais.

## Pedidos
- visão operacional;
- acompanhamento DSLite;
- pagamento;
- etiqueta;
- tracking.

## Produtos/Mercado Livre
- publicação;
- acompanhamento de outbox;
- diagnóstico.

## Catálogo
- refresh durável;
- Buy Box;
- opt-in.

## Configuração
- tabs;
- conexão de integrações.

Não remover interatividade apenas para reduzir JavaScript.

---

# 33. Complexidade acidental / problemas confirmados

## P1 — secrets completos no browser

Carregado do Item 9.

---

## P2 — Pedidos concentra responsabilidades independentes

Separação futura justificada.

---

## P2 — Produtos concentra listagem + publicação complexa ML

Separação futura justificada.

---

## P2 — CatalogoView concentra múltiplos fluxos

Separação futura justificada.

---

## P2 — tracking de publicação ML duplicado

Produtos e Catálogo implementam o mesmo fluxo.

---

## P2 — pricing tem múltiplas fontes de regra

4% no contexto de Anúncios/preço-detalhe e 5% no serviço padrão.

A semântica precisa ser definida no Item 12.

---

## P2 — DTO de Pedidos usa `any` para compensar contrato incorreto

Definir tipo real da API.

---

## P2 — Compras faz chamadas independentes a cada filtro/página

Separar carregamentos.

---

## P2 — busca/data de Perguntas filtram somente a página atual

Alinhar UI com escopo real da busca.

---

## P2 — Configurações mistura responsabilidades distintas

Extrair por tabs/responsabilidades quando executar limpeza.

---

## P2/P3 — Sidebar não reflete permissões

Corrigir depois da fonte única de autorização.

---

## P3 — boundaries client podem ser menores

Somente depois das simplificações acima.

---

# 34. Estado desejado conceitualmente

A interface não precisa de nova arquitetura.

O desenho desejado é:

```text
route/page
↓
orquestra somente o domínio da tela
↓
componentes para blocos funcionais reais
↓
regra de negócio vem do backend/lib compartilhada
↓
fluxos repetidos possuem uma implementação
```

Exemplo de Pedidos:

```text
PedidosPage
├─ filtros/lista
├─ OrderSupplierPaymentFlow
├─ OrderDsliteFlow
└─ OrderLabelFlow
```

Os nomes acima são conceituais, não decisão de arquivos.

O plano deve escolher o menor número de extrações realmente útil.

---

# 35. O que NÃO fazer agora

Não devemos:

- reescrever a interface;
- trocar Ant Design;
- adicionar nova biblioteca de estado;
- adicionar TanStack Query ao web só para padronizar;
- converter todas as páginas para Server Components;
- criar design system novo;
- criar abstração genérica de modal;
- criar abstração genérica de polling;
- quebrar todo arquivo grande em dezenas de arquivos pequenos;
- mover toda lógica de exibição para backend;
- alterar UX apenas para atender preferência arquitetural;
- fazer limpeza cosmética antes dos riscos funcionais.

---

# 36. Ordem futura de limpeza da interface

Quando chegar o plano de execução, a ordem recomendada é:

```text
1. corrigir P0/P1 de segurança
2. centralizar regras de negócio duplicadas
3. consolidar fluxo ML duplicado
4. corrigir comportamentos de busca/fetch comprovadamente incorretos
5. separar Pedidos/Produtos/Catálogo/Configurações por responsabilidade
6. somente depois avaliar boundaries client/performance
```

Isso evita mover código incorreto para componentes novos antes de corrigir sua fonte de verdade.

---

# 37. Dependências para itens futuros

## Item 12 — Regras de Negócio Compartilhadas

Confirmar e centralizar:

- pricing 4% x 5%;
- atacado;
- quantidade segura;
- permissões;
- estados operacionais;
- DTO/API de pedidos;
- disponibilidade.

## Item 13 — Performance e Saúde Operacional

Medir:

- peso do bundle das páginas grandes;
- custo da TV;
- chamadas repetidas de Compras;
- lista + summary;
- polling;
- renderização de tabelas;
- páginas que realmente se beneficiariam de Server Components.

## Item 14 — Testes

Cobrir:

- filtros/paginação;
- busca de Perguntas;
- cálculo exibido de pricing;
- acompanhamento de outbox;
- permissões visuais essenciais;
- componentes extraídos durante limpeza futura.

## Item 15 — Scripts + Documentação + Históricos

Revisar referências a páginas/fluxos antigos antes de remover compatibilidades da interface.

---

# 38. Resultado do checklist — Item 11

- [x] Revisar os principais módulos web depois de entender seus domínios.
- [x] Identificar páginas fazendo regra de negócio.
- [x] Identificar componentes/fluxos duplicados.
- [x] Identificar chamadas excessivas comprovadas.
- [x] Separar arquivos grandes somente quando há responsabilidades realmente diferentes.
- [x] Confirmar Pedidos como principal candidato a separação funcional.
- [x] Confirmar Produtos como listagem + publicação ML excessivamente concentradas.
- [x] Confirmar CatalogoView com múltiplos fluxos independentes.
- [x] Identificar tracking de publicação ML duplicado em Produtos/Catálogo.
- [x] Identificar pricing duplicado/ambíguo entre 4% e 5%.
- [x] Identificar contrato DTO de Pedidos compensado com `any`.
- [x] Identificar chamadas independentes repetidas em Compras.
- [x] Identificar busca/filtros locais de Perguntas sobre apenas a página atual.
- [x] Confirmar exposição de secrets na tela Configurações já registrada no Item 9.
- [x] Identificar Sidebar sem filtro por cargo.
- [x] Confirmar que `'use client'` não é problema por si só.
- [x] Separar complexidade essencial de complexidade acidental.

---

# 39. Restrições desta etapa

Nesta etapa:

- nenhum componente foi alterado;
- nenhuma página foi alterada;
- nenhuma regra de pricing foi modificada;
- nenhuma chamada foi removida;
- nenhuma biblioteca foi adicionada;
- nenhuma boundary server/client foi alterada;
- nenhum teste foi executado;
- nenhum build foi executado;
- nenhum deploy foi realizado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise das páginas e componentes diretamente relacionados;
- comparação entre UI, APIs e serviços de regra;
- consulta à documentação oficial atual do Next.js.

---

# 40. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Vortek — branch `dev`

Principais arquivos analisados:

- `src/app/(app)/pedidos/page.tsx`
- `src/app/(app)/produtos/page.tsx`
- `src/app/(app)/anuncios/page.tsx`
- `src/components/catalogo/CatalogoView.tsx`
- `src/app/(app)/compras/page.tsx`
- `src/app/(app)/configuracoes/page.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/estoque/page.tsx`
- `src/app/(app)/fornecedores/page.tsx`
- `src/app/(app)/notas-fiscais/page.tsx`
- `src/app/(app)/clientes/page.tsx`
- `src/app/(app)/perguntas/page.tsx`
- `src/app/(app)/reclamacoes/page.tsx`
- `src/app/(app)/reputacao/page.tsx`
- `src/app/(app)/tv/page.tsx`
- `src/components/Sidebar.tsx`
- `src/components/ResizableTable.tsx`
- `src/components/modals/ProgressModal.tsx`
- `src/services/pricing.ts`
- `src/app/api/ml/anuncio/preco-detalhe/route.ts`
- `src/app/api/ml/anuncio/aplicar-atacado/route.ts`
- `src/app/api/perguntas/route.ts`
- `src/app/api/pedidos/route.ts`

## Next.js — documentação oficial

Server and Client Components:

`https://nextjs.org/docs/app/getting-started/server-and-client-components`

`use client`:

`https://nextjs.org/docs/app/api-reference/directives/use-client`

SPA / client-side applications:

`https://nextjs.org/docs/app/guides/single-page-applications`

Production checklist:

`https://nextjs.org/docs/app/guides/production-checklist`

---

# 41. Conclusão final do Item 11

A interface web do Vortek possui dívida de organização, mas não precisa de um redesenho.

O padrão correto para a limpeza é:

```text
não dividir por tamanho
↓
identificar responsabilidade real
↓
centralizar regra duplicada
↓
reutilizar fluxo comprovadamente repetido
↓
extrair somente blocos independentes
```

As maiores oportunidades estão em:

```text
Pedidos
Produtos
CatalogoView
Configurações
Compras
```

e nos fluxos compartilhados de:

```text
pricing
publicação ML
permissões
```

A maior melhoria funcional específica encontrada na interface é a busca/filtro de Perguntas, que hoje trabalha apenas sobre a página carregada.

O **Item 11 está concluído**.

O P0 do Item 9 continua pendente e permanece prioritário antes do futuro checklist de execução.
