# Bentevi — Dossiê Completo de Interface

**Ação:** `BNT-UX-00`
**Função:** especificação funcional e visual anterior à implementação do redesign
**Ambiente:** desenvolvimento e homologação
**Branch:** `dev`
**Data da fotografia:** 31/08/2026
**Base de código inspecionada:** `080500a899e52b10d4ae8f67de8a0fd7201fc944`
**Status:** concluído; nenhuma interface foi alterada nesta ação
**Próxima ação:** `BNT-SHELL-01 — Shell desktop Bentevi`

---

## 1. Objetivo, alcance e limites

Este dossiê transforma o inventário atual do Vortek na especificação de interface da Bentevi. Ele cobre o ERP web, sua futura adaptação para web celular, as páginas públicas e o aplicativo Expo, preservando os contratos e regras já implementados.

O documento define, para cada superfície:

- objetivo operacional, público e permissões;
- dados exibidos e suas fontes atuais;
- ações e efeitos já existentes;
- filtros, ordenação, paginação e estados;
- problemas de informação e hierarquia;
- composição alvo com Ant Design;
- wireframe desktop de baixa fidelidade;
- direção para `390×844`;
- dependências e critérios de aceite.

Esta ação é exclusivamente documental. Ela não altera UI, API, banco, domínio, assets, integrações ou regras. Uma informação desejável que não exista hoje é registrada como `BNT-GAP`; ela não será simulada no layout.

## 2. Método e fontes de verdade

A ordem usada para tomar decisões foi:

1. código, rotas, componentes, DTOs, permissões e testes atuais;
2. auditorias dos Itens 1 a 16 e plano do Item 17;
3. documentação operacional do redesign Bentevi;
4. documentação oficial atual dos produtos envolvidos;
5. referências de domínio usadas apenas como benchmark de organização.

Shopify, Odoo e Grafana não definem regras da Bentevi. Deles são aproveitados princípios de interface: separar lista e detalhe, tornar estados operacionais explícitos, permitir filtragem orientada a tarefa e fazer cada painel responder a uma pergunta. Os contratos do Mercado Livre continuam sendo representados conforme a integração Vortek e a documentação oficial do próprio Mercado Livre.

## 3. Fotografia transversal confirmada

### 3.1 Stack e tema atuais

- Next.js `16.3.3`, React `19.2.8` e Ant Design `5.24.0` no web;
- Expo/React Native e TanStack Query no aplicativo nativo;
- tema web escuro com `darkAlgorithm`, primária azul `#1677ff`, fundo `#000000`, superfície `#141414` e raio base 8;
- fonte Inter;
- estilos ainda distribuídos principalmente nas próprias páginas;
- sidebar fixa de 240 px e conteúdo com margem fixa de 240 px e padding de 24 px.

### 3.2 Públicos e permissões

| Papel | Leitura | Ações operacionais | Ações financeiras/admin |
|---|---|---|---|
| `admin` | completa | completa | completa |
| `gerente` | completa | completa | completa conforme permissões atuais |
| `operador` | TV, vendas, compras e tracking | WhatsApp de etiqueta, DSLite e expedição interna | sem confirmação de pagamento de compra |
| `visualizador` | TV, vendas, compras e tracking | nenhuma mutação operacional | nenhuma |
| acesso público por token | somente a página de fornecedor vinculada ao token | apenas edição contratada pela página pública | nenhuma área interna |

A autorização continua no servidor/proxy/API. Esconder ou desabilitar um controle é feedback de interface, nunca uma nova barreira de segurança. `/configuracoes` permanece exclusiva de `admin`.

### 3.3 Arquitetura de informação atual

```text
Dashboard
TV ao Vivo
Produtos
Estoque
Clientes
Fornecedores
  ├─ Cadastros
  └─ Créditos
Pedidos
  ├─ Vendas
  └─ Compras
Notas Fiscais
Anúncios
Catálogo
  ├─ No Catálogo
  └─ Elegíveis
Perguntas
Reputação
Reclamações
Configurações
```

O redesign preserva nomes, grupos, ordem e URLs. A marca visível muda para Bentevi em etapas próprias; identificadores técnicos e históricos Vortek não são renomeados.

### 3.4 Rotas canônicas, aliases e wrappers

| Tipo | Rota | Regra do redesign |
|---|---|---|
| canônica | `/pedidos`, `/dashboard`, demais `BNT-D01` a `BNT-D24` | possui especificação própria neste dossiê |
| alias | `/catalogo` | redireciona para `/catalogo/no-catalogo`; não recebe visual paralelo |
| visão compartilhada | `/catalogo/no-catalogo`, `/catalogo/elegiveis` | uma estrutura `CatalogoView`, com modo e ações específicas |
| wrapper | `/fornecedores/cadastros` | reutiliza a página `/fornecedores`; uma única implementação visual |
| detalhe | rotas `[id]` | contexto próprio, preservando retorno à lista responsável |
| pública | BKR1 e Evolusom | fora do shell autenticado e protegida pelo contrato de token atual |

## 4. Fundação de experiência alvo

### 4.1 Princípios

1. A primeira dobra responde “o que exige decisão agora?”.
2. KPIs existem apenas quando orientam filtro, prioridade ou tendência.
3. Status mostra significado operacional, não somente o valor técnico.
4. A ação primária pertence ao estágio atual; ações raras ficam agrupadas.
5. Lista serve para comparar e decidir; `Drawer` ou detalhe serve para investigar.
6. Filtros ativos permanecem visíveis e podem ser limpos sem perder contexto.
7. Loading, vazio, erro, parcial, sucesso e falta de permissão são estados desenhados.
8. Cor reforça significado, mas texto, ícone e forma mantêm a compreensão.
9. Conteúdo ausente não vira número ou tendência inventada.
10. O mesmo vocabulário é usado no web, web celular e aplicativo nativo.

### 4.2 Padrões compartilháveis permitidos

Somente padrões com consumidores reais devem ser centralizados:

- cabeçalho de página: título, contexto, atualização e ações;
- faixa compacta de KPIs acionáveis;
- barra de busca e filtros com resumo dos filtros ativos;
- tabela operacional com densidade, paginação e coluna de ação consistentes;
- estado de loading, vazio, erro e conteúdo parcial;
- `Drawer` de detalhe quando a navegação integral não é necessária;
- confirmação explícita para mutações destrutivas ou externas.

Não criar componente genérico de formulário, tabela, modal, polling ou data-fetch apenas para o redesign.

### 4.3 Shell alvo

```text
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ marca Bentevi │ título / contexto                     ajuda  usuário       │ 1
│ navegação     ├──────────────────────────────────────────────────────────────┤
│ agrupada      │ conteúdo da rota                                               │ 2
│               │                                                              │
│               │                                                              │
│ integrações   │                                                              │
│ usuário       │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
1. Topo contextual da rota, sem duplicar a navegação.
2. Área fluida; sidebar pode recolher no desktop e vira Drawer no celular.
```

No desktop, o shell mantém navegação lateral e passa a aceitar estado expandido/recolhido. No web celular, o conteúdo ocupa toda a largura, o menu abre em `Drawer` e o cabeçalho preserva título, volta e ação primária.

### 4.4 Componentes e acessibilidade

- usar tokens do Ant Design 5, sem CSS paralelo para estados já cobertos pelo tema;
- `Layout`, `Menu`, `Drawer`, `Breadcrumb`, `Typography`, `Space` e `Flex` para estrutura;
- `Table` somente quando a comparação por coluna for relevante; no celular, cartões/listas ou detalhe progressivo;
- `Tag` e `Badge` com texto legível; não codificar estado apenas pela cor;
- `Alert`, `Result`, `Empty`, `Skeleton` e `Spin` conforme o estado real;
- ordem de foco previsível, foco visível, nomes acessíveis e operação por teclado;
- contraste final WCAG 2.2 AA e alvos de interação adequados.

## 5. Dossiê desktop — páginas canônicas

### BNT-D01 — Vendas (`/pedidos`) — piloto

**Objetivo e público.** Operar pedidos do recebimento à conclusão, priorizando bloqueios de pagamento, fulfillment, etiqueta, envio, tracking e fiscal. Admin e gerente operam tudo; operador executa as ações autorizadas; visualizador acompanha.

**Dados e fontes atuais.** `/api/pedidos` fornece a lista operacional e `/api/pedidos/resumo` os indicadores. O fluxo também consome download de XML/DANFE, tracking, fornecedor/DSLite, expedição interna e estados fiscais já existentes.

**Ações e efeitos.** Continuar/criar pedido DSLite, escolher envio, concluir etiqueta, enviar etiqueta por WhatsApp, processar expedição interna, desvincular DSLite, acompanhar rastreio e abrir documentos fiscais. Toda ação externa mantém confirmação, permissão e feedback atuais.

**Busca, filtros e estados.** Busca, status e paginação devem ser persistentes no contexto da sessão. Representar loading, vazio, erro de lista, erro parcial de resumo, pedido bloqueado, ação em curso, sucesso e erro da mutação.

**Análise.** A tabela atual concentra muitas etapas e ações na mesma linha. A informação precisa ser ordenada por decisão: pendência → responsável → prazo/idade → próxima ação; dados extensos migram para detalhe lateral.

**Hierarquia alvo.** `PageHeader`; KPIs/filas clicáveis; `Input.Search` + filtros; `Table` com pedido, cliente, valor, estágio, pendência, prazo e próxima ação; `Drawer` com timeline, itens, fulfillment, fiscal, tracking e histórico; `Dropdown` para ações secundárias.

```text
┌ Vendas ─ atualizado 10:32 ─────────────── [Exportar] [Atualizar] ┐
│ [Aguardando ação 8] [Etiquetas 3] [Envios 5] [Fiscal 2]          │ 1
│ [Buscar pedido/cliente] [Status] [Fulfillment] [Período] [Limpar]│ 2
│ Pedido | Cliente | Valor | Etapa | Pendência | Idade | Próxima   │ 3
│ #...   | ...     | ...   | tag   | detalhe   | ...   | [Agir]    │
└──────────────────────────── detalhe em Drawer ───────────────────┘
1. Filas alteram os filtros. 2. Filtros ativos visíveis. 3. Linha decide; Drawer explica.
```

**Web celular.** Filas em rolagem horizontal controlada; cada pedido vira cartão com pedido/cliente/valor, estágio, pendência e ação primária; detalhe ocupa `Drawer` de tela inteira.

**Documento exportado.** O relatório de Vendas é uma visão operacional detalhada em A4 paisagem e dark mode Bentevi. Reproduz filtros e indicadores do conjunto exportado e organiza `Data`, `Venda ML`, `Cliente`, `Produtos e SKUs`, `Valores`, `Origem`, `Andamento` e `Fiscal e entrega`. Venda e Pack são identificadores distintos; lucro usa semântica positiva, negativa ou pendente; andamento reutiliza as seis etapas da página; produtos extensos continuam em fragmentos numerados sem truncamento. O documento não contém ações e preserva autenticação e fonte da listagem.

**Dependências e aceite.** `UI-01` e `UI-04` concluídos. Preservar DTO, permissões e todos os efeitos; validar cada estágio e perfil; nenhum dado novo é requisito do piloto.

### BNT-D02 — Dashboard (`/dashboard`)

**Objetivo e público.** Dar visão executiva e operacional do período sem duplicar todas as áreas. Todos os usuários autenticados visualizam conforme os dados permitidos.

**Dados e fontes atuais.** Vendas operacionais, lucro conhecido, faturamento, pedidos, ticket, margem, itens vendidos e filas compartilhadas com Vendas. O período selecionado possui comparação real com a janela anterior equivalente.

**Ações e estados.** Alterar entre hoje, 7 e 30 dias; escolher a métrica do gráfico; atualizar; abrir a fila operacional ou o detalhe da venda. Distinguir loading, vazio, erro preservando dados anteriores e lucro ainda pendente.

**Análise.** O dashboard é um cockpit comercial, não uma central de integrações. Lucro é o indicador dominante e a meta é gamificada sem criar dados fictícios ou persistência paralela. Reputação, integrações, sincronizações e comandos administrativos permanecem nas páginas responsáveis.

**Hierarquia alvo.** Superfície dominante de lucro/meta; métricas secundárias em linha; tendência comparada; pulso da operação; produtos do período e vendas recentes.

```text
┌ Dashboard ─ [Hoje | 7 dias | 30 dias] [Atualizar] ────────────────┐
│ Lucro + comparação + métricas              Meta de lucro          │ 1
│ Ritmo comercial: [Faturamento | Lucro | Pedidos]                  │ 2
│ Exigem ação → Preparação → Transporte → Entregues                 │ 3
│ Produtos que puxaram o resultado       Vendas recentes            │ 4
└────────────────────────────────────────────────────────────────────┘
1. Resultado e objetivo. 2. Tendência real. 3. Operação. 4. Detalhe.
```

**Web celular e aceite.** Fora do escopo da etapa desktop. No desktop, evitar grade de cards pequenos; comparação usa período equivalente, cancelamentos não compõem resultado, lucro pendente é explícito e produtos derivam dos itens realmente vendidos no período. Atualização faz uma única chamada ao resumo.

### BNT-D03 — Compras (`/compras`)

**Objetivo e público.** Acompanhar compras vinculadas às vendas e confirmar pagamentos permitidos. Admin/gerente podem confirmar; operador e visualizador apenas acompanham conforme permissões.

**Dados e fontes atuais.** Lista e resumo de compras, alertas independentes do Mercado Livre, documentos e comprovantes no contexto da compra.

**Ações e estados.** Filtrar, exportar, abrir compra/documento e confirmar pagamento do fornecedor. Loading e erro da lista não devem apagar indicadores independentes; pagamento em curso bloqueia repetição.

**Análise.** A ligação venda → compra → fornecedor → pagamento → NF deve ser legível em uma sequência. Históricos Hayamax aposentados não voltam como interface ativa.

**Hierarquia alvo revisada.** Indicadores de compras, PIX aguardando confirmação, revisão, faturamento e valor de PIX ainda não confirmado; filtros; tabela que separa data, compra DSLite, Pack/Venda ML, produto, fornecedor, valores, andamento e ação. O detalhe concentra identificadores internos, todos os itens da venda, SKUs e as fontes fiscal/logística sem poluir a tabela.

```text
┌ Compras ───────────────────────────────────── [Exportar] [Atualizar]┐
│ [Compras] [PIX a confirmar] [Em revisão] [Faturadas] [Valor PIX]    │
│ [Busca] [Status] [Fornecedor] [Período]                              │
│ Data | DSLite | Pack + Venda ML | Produto | Fornecedor | Valores    │
│                         | DSLite → PIX → NF → Envio | Ação           │
└─────────────────────────────────────────────────────────────────────┘
```

**Semântica obrigatória.** Pack e Order são identificadores distintos e aparecem simultaneamente quando disponíveis. Na tabela, o produto exibe o nome completo com quebra de linha e a quantidade; SKU Bentevi e SKU do fornecedor ficam no detalhe da compra, onde suas origens podem ser lidas sem poluir a listagem. O fornecedor usa primeiro o apelido canônico cadastrado (`Hayamax`, `BKR1`, `Evolusom` etc.) e recorre à razão social somente quando o apelido não existe. Em Valores, o custo é o número principal sem o prefixo redundante “Fornecedor”, e o valor da venda permanece como contexto secundário. “Valor aguardando confirmação” soma somente compras PIX pré-pago ainda pendentes no Vortek e não representa saldo bancário. “Registrar PIX” registra comprovante e referência depois da transferência feita no banco; o Vortek não transfere dinheiro. Fiscal e entrega distinguem a nota/rastreio do fornecedor via DSLite da nota da venda emitida por Vortek/Brasil NFe. Rastreio disponível significa acompanhamento em curso, nunca entrega concluída.

**Documento exportado.** O relatório de Compras é uma visão operacional detalhada em A4 paisagem e dark mode Bentevi. Deve repetir a hierarquia aprovada com cabeçalho de marca, filtros, indicadores, oito grupos de informação (`Data`, `Compra DSLite`, `Venda ML`, `Produto e SKUs`, `Fornecedor`, `Valores`, `Andamento`, `Fiscal e envio`), quebra de conteúdo longo, cabeçalho de tabela por página e rodapé numerado. Por ser documento detalhado, conserva SKU Bentevi e SKU do fornecedor; não contém ações. DANFE, etiquetas e documentos externos não pertencem a este redesign.

**Web celular e aceite.** Cartão exibe relação com a venda, fornecedor, total e dois estados; ação financeira só aparece para perfil autorizado. Preservar fetch independente implementado em `UI-06`.

### BNT-D04 — Notas Fiscais (`/notas-fiscais`)

**Objetivo e público.** Monitorar emissão e pós-emissão fiscal, localizar documentos e executar ações fiscais permitidas.

**Dados e fontes atuais.** Lista/resumo fiscal, XML, DANFE/PDF, e-mail, cancelamento, carta de correção e job de reconciliação Brasil NFe.

**Ações e estados.** Buscar/filtrar, baixar documentos, enviar e-mail, cancelar, emitir CCe e reconciliar. Exigir confirmação e explicar irreversibilidade/efeito externo quando aplicável.

**Análise.** O estado fiscal e sua próxima ação devem prevalecer sobre valores agregados. Cancelamento, e-mail e CCe são fluxos diferentes e não devem dividir um modal genérico.

**Hierarquia alvo.** KPIs de emitidas/pendentes/erro e valor; filtros por status, busca, período e faixa de valor; tabela; `Drawer` da nota; modais específicos.

```text
┌ Notas fiscais ─────────────────────────────────────── [Reconciliar]┐
│ [Pendentes] [Emitidas] [Com erro] [Valor]                           │
│ [Pedido/NF/cliente] [Status] [Data] [Valor]                         │
│ Pedido | NF | Cliente | Emissão | Valor | Estado | [Ação] [•••]    │
└─────────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Lista por nota com status e documento principal; ações raras em menu. Validar estados `not_found` e gates já corrigidos, sem chamada fiscal automática durante teste visual.

### BNT-D05 — Estoque (`/estoque`)

**Objetivo e público.** Administrar o ciclo de estoque interno e suas decisões após entrega confirmada.

**Dados e fontes atuais.** Lista, resumo e lifecycle de itens internos, com inserção manual, atualização e remoção já suportadas.

**Ações e estados.** Adicionar item, revisar, liberar, marcar inutilizável/vendido e remover quando permitido. Tabs atuais: revisão, liberado, inutilizável e vendido.

**Análise.** Quantidade física, situação operacional e origem precisam ser separadas. O usuário deve entender por que um item está bloqueado e qual transição é válida.

**Hierarquia alvo.** KPIs por situação; tabs como filas; busca/filtros; tabela por item/SKU/origem/entrada/situação; `Drawer` com histórico e ação permitida; modal simples para inserção manual.

```text
┌ Estoque ───────────────────────────────────────── [Adicionar item]┐
│ [Em revisão] [Liberado] [Inutilizável] [Vendido]                  │
│ Revisão (n) | Liberado (n) | Inutilizável | Vendido               │
│ [Buscar SKU/produto] [Origem] [Período]                           │
│ Item | Produto | Origem | Entrada | Situação | Próxima ação       │
└───────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Tabs roláveis, cartões com situação/motivo/ação. Preservar reserva atômica e `Q_segura`; layout não calcula estoque no cliente.

### BNT-D06 — Perguntas (`/perguntas`)

**Objetivo e público.** Responder rapidamente perguntas pré-venda com contexto suficiente do anúncio.

**Dados e fontes atuais.** Lista paginada do Mercado Livre e operação de resposta. Status é global; busca e data operam sobre a página carregada, conforme contrato preservado em `UI-05`.

**Ações e estados.** Filtrar por status, buscar localmente, responder e atualizar. Exibir não respondida, respondida, em revisão/indisponível, erro de integração e resposta em envio.

**Análise.** A prioridade é a pergunta não respondida e sua idade. KPIs da página atual não podem parecer totais globais. Produto/anúncio deve fornecer contexto sem tirar foco da resposta.

**Hierarquia alvo.** Inbox em duas áreas no desktop: fila à esquerda e contexto/resposta à direita; em volume pequeno, tabela + `Drawer`. Rótulos deixam explícito quando a métrica/filtro é local.

```text
┌ Perguntas ─ [Não respondidas ▾] [Busca nesta página] [Atualizar] ┐
│ Fila (página atual)              Contexto                         │
│ • 18 min  Produto A              Anúncio / pergunta completa      │
│ • 42 min  Produto B              [Resposta....................]   │
│ • 2 h     Produto C                         [Enviar resposta]      │
└───────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** A fila vira cartões; tocar abre tela/Drawer integral de resposta. Busca global só poderá ser desenhada após `BNT-GAP-001`; não alterar semântica da API.

### BNT-D07 — Produtos (`/produtos`)

**Objetivo e público.** Localizar e comparar produtos por estoque, fornecedor, custo, preço, rentabilidade e situação no Mercado Livre.

**Dados e fontes atuais.** Lista/resumo de produtos, fornecedores, estoque e estados ML. A página atual também contém o extenso fluxo de publicação: categoria, schema, atributos, fiscal, descrição, garantia, preço e sugestões.

**Ações e estados.** Buscar, filtrar, editar, exportar, abrir detalhe, atualizar preço e iniciar publicação. Estados de publicação devem indicar estágio, validação, erro e sucesso sem esconder o estado da lista.

**Análise.** Lista de gestão e assistente de publicação são tarefas diferentes. O redesign separa o contexto visual, mas reutiliza o fluxo atual até que uma tarefa funcional autorize outra arquitetura.

**Hierarquia alvo.** KPIs essenciais; filtros avançados recolhíveis; tabela comparativa; detalhe em rota existente; publicação em painel/fluxo dedicado iniciado pelo produto selecionado.

```text
┌ Produtos ────────────────────────────── [Exportar] [Publicar no ML]┐
│ [Com estoque] [Sem anúncio] [Margem em risco] [Receita potencial] │
│ [Busca] [Produto] [ML] [Fornecedor] [Estoque] [Preço/margem]       │
│ SKU | Produto | Fornecedor | Q segura | Custo | Preço | Lucro | ML│
└───────────────────────────────────────────────────────────────────┘
Publicação abre contexto próprio; não expande a tabela indefinidamente.
```

**Web celular e aceite.** Lista mostra produto, fornecedor, estoque, margem e ML; filtros avançados em Drawer; publicação é sequência de etapas. Preservar `RULE-01`, `RULE-02`, `RULE-04`, `RULE-06` e publicação operacional ML.

### BNT-D08 — Produto (`/produtos/[id]`)

**Objetivo e público.** Compreender e manter um produto, suas ofertas, imagens, cadastro, preço, estoque e vínculo ML.

**Dados e fontes atuais.** Produto e ofertas de fornecedores; imagens, identificação, fornecedor escolhido, status, custo/preço, dimensões, peso e descrição.

**Ações e estados.** Editar campos suportados, escolher fornecedor/oferta e voltar à lista. Diferenciar valor local, calculado e proveniente de fornecedor quando essa distinção já existe no dado.

**Análise.** O detalhe precisa de um resumo persistente e seções orientadas ao domínio, não um formulário contínuo. Alterações com impacto de publicação devem informar o efeito antes de salvar.

**Hierarquia alvo.** Cabeçalho com SKU/status/ML e ações; coluna de galeria; resumo de preço/estoque; tabs ou âncoras para cadastro, ofertas, logística, fiscal/atributos e descrição.

```text
┌ ← Produtos | Produto / SKU ─────────────────── [Editar] [•••] ┐
│ [galeria]  Nome / status / vínculo ML                          │
│            [Q segura] [Custo] [Preço] [Margem]                 │
│ Cadastro | Ofertas | Logística | Fiscal/atributos | Descrição  │
│ ─ conteúdo da seção com origem dos dados e ações ─             │
└───────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Resumo antes da galeria extensa; seções em navegação compacta; salvar com barra contextual somente durante edição. Preservar fonte central de preço e estoque.

### BNT-D09 — Ofertas (`/produtos/ofertas`)

**Objetivo e público.** Comparar as ofertas dos fornecedores e localizar divergências de custo, estoque, elegibilidade e associação ao produto mestre.

**Dados e fontes atuais.** Lista de ofertas por SKU do fornecedor, oferta/produto, fornecedor, estoque e custo, com métricas de total, em estoque, sem anúncio ML e lucro médio.

**Ações e estados.** Buscar, filtrar por fornecedor/estoque e abrir a oferta. Exibir carregamento, vazio por filtro, oferta sem produto mestre e dado de fornecedor indisponível.

**Análise.** A tela é comparativa: custo e disponibilidade devem ter mais peso que contagens decorativas. A relação oferta → produto mestre deve ser reconhecível na linha.

**Hierarquia alvo.** KPIs úteis; busca/filtros; tabela densa com SKU, oferta, produto mestre, fornecedor, estoque, custo, elegibilidade e ação; destaque discreto da oferta preferida quando o dado existir.

```text
┌ Ofertas de fornecedores ─────────────────────────── [Atualizar] ┐
│ [Em estoque] [Sem produto] [Sem ML] [Lucro médio]               │
│ [Buscar SKU/produto] [Fornecedor] [Estoque] [Elegibilidade]     │
│ SKU forn. | Oferta | Produto mestre | Fornecedor | Q | Custo | →│
└─────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Cartão mantém oferta, fornecedor, custo e quantidade; detalhes secundários expandem. Não recalcular elegibilidade nem preferência na UI.

### BNT-D10 — Oferta (`/produtos/ofertas/[id]`)

**Objetivo e público.** Investigar uma oferta específica, seu fornecedor, produto mestre, dados fiscais e ofertas relacionadas.

**Dados e fontes atuais.** Imagens, dados da oferta, fornecedor, forma de pagamento, vínculo com produto/ML, descrição e ofertas relacionadas.

**Ações e estados.** Editar associação/fornecedor conforme suporte atual e navegar ao produto mestre. O histórico Hayamax e sua forma de pagamento aposentada permanecem somente leitura quando ainda necessários para auditoria.

**Análise.** Campos sincronizados e locais precisam de origem visível. Comparação com relacionadas deve apoiar decisão sem transformar a tela em outra lista de produtos.

**Hierarquia alvo.** Cabeçalho e resumo operacional; seções Oferta, Fornecedor, Produto mestre/ML, Fiscal e Descrição; tabela curta de relacionadas.

```text
┌ ← Ofertas | Oferta / SKU fornecedor ─────────────── [Editar] ┐
│ [imagem] Fornecedor • estoque • custo • elegibilidade         │
│ Oferta | Produto mestre/ML | Fiscal | Descrição                │
│ dados com origem: sincronizado / local                         │
│ Ofertas relacionadas: fornecedor | Q | custo | preferência    │
└───────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Resumo e vínculo mestre primeiro; seções empilhadas; histórico aposentado claramente identificado e sem ação ativa.

### BNT-D11 — Anúncios (`/anuncios`)

**Objetivo e público.** Monitorar anúncios Mercado Livre, qualidade, preço, rentabilidade, status, catálogo e desempenho.

**Dados e fontes atuais.** Lista/resumo de anúncios, detalhe e atualização de preço, outbox, prévia de atacado, lote, produto relacionado, vendidos, visitas e qualidade.

**Ações e estados.** Buscar/filtrar, exportar, abrir no ML, analisar/atualizar preço e acompanhar lote/outbox. Uma atualização externa precisa mostrar progresso e resultado por item.

**Análise.** Qualidade, competitividade de preço e estado operacional são dimensões distintas. Buy Box/análise de preço precisa de painel próprio para não sobrecarregar a linha.

**Hierarquia alvo.** KPIs total/ativo/pausado/qualidade; filtros; tabela SKU/anúncio/produto/preço/margem/qualidade/status/catálogo; `Drawer` para preço e Buy Box; status de lote separado.

```text
┌ Anúncios ───────────────────────────── [Exportar] [Atualizar dados]┐
│ [Ativos] [Pausados] [Qualidade em risco] [Preço em revisão]       │
│ [Busca] [Status] [Qualidade] [Catálogo] [Preço/margem]             │
│ SKU | Anúncio | Preço | Margem | Qualidade | Status | Catálogo | →│
└──────────────────────────── análise em Drawer ─────────────────────┘
```

**Web celular e aceite.** Cartão exibe preço, margem, qualidade e estado; análise abre tela cheia. Respeitar o fluxo único de estoque e o contrato operacional de publicação ML.

### BNT-D12 — Catálogo (`/catalogo/no-catalogo`, `/catalogo/elegiveis`)

**Objetivo e público.** Separar acompanhamento de anúncios fora do catálogo da fila de produtos elegíveis para publicação/opt-in, mantendo a visão compartilhada atual.

**Dados e fontes atuais.** `CatalogoView` em dois modos, análise, job de refresh, opt-in, atualização de preço, criação em massa e acompanhamento de catálogo/Buy Box.

**Ações e estados.** Atualizar análise, reanalisar, fazer opt-in, atualizar preço e criar lote elegível. Distinguir job aceito, em execução, parcialmente concluído, falho e concluído.

**Análise.** As duas rotas são perspectivas do mesmo domínio e não duas páginas independentes. Refresh, análise, opt-in, publicação e acompanhamento precisam de fronteiras visuais claras.

**Hierarquia alvo.** Seletor de visão equivalente às rotas; resumo próprio por modo; filtros; tabela específica; painel de job/lote; detalhe de preço/Buy Box.

```text
┌ Catálogo ─ No catálogo | Elegíveis ───────────── [Atualizar análise]┐
│ resumo do modo atual                                                │
│ [Busca] [Status] [Buy Box] [Preço]                                  │
│ item/anúncio | estado | competitividade | análise | próxima ação    │
│ Job atual: estado • progresso • falhas [Ver detalhes]               │
└─────────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Alternância das visões preserva URL; cards mostram estado, análise e ação; lote tem progresso separado. `/catalogo` continua apenas redirect, sem terceira interface.

### BNT-D13 — Clientes (`/clientes`)

**Objetivo e público.** Localizar clientes e acessar rapidamente identidade, contato, endereço e histórico.

**Dados e fontes atuais.** Lista/resumo com ID Mercado Livre, nome, PF/PJ, documento, endereço, e-mail, telefone e quantidade de pedidos.

**Ações e estados.** Buscar, filtrar por tipo e abrir detalhe. Loading, vazio, contato ausente e documento incompleto precisam ser explícitos, sem confundir ausente com erro.

**Análise.** Resumo PF/PJ é suficiente; métricas adicionais sem decisão não serão criadas. Dados sensíveis devem ter densidade e exposição proporcionais à tarefa.

**Hierarquia alvo.** Cards total/PF/PJ; busca e tipo; tabela nome, tipo, documento abreviado conforme política, localização/contato essencial, pedidos e acesso ao detalhe.

```text
┌ Clientes ─────────────────────────────────────────────── [Atualizar]┐
│ [Total] [Pessoa física] [Pessoa jurídica]                           │
│ [Buscar nome/documento/ID] [Tipo]                                  │
│ Cliente | Tipo | Documento | Cidade/UF | Contato | Pedidos | →      │
└─────────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Cartão com nome, tipo, cidade e pedidos; contato completo fica no detalhe. Preservar escopo e proteção atuais dos dados pessoais.

### BNT-D14 — Cliente (`/clientes/[id]`)

**Objetivo e público.** Consultar a identidade do cliente e seu histórico de vendas; manter e-mail e telefone quando permitido.

**Dados e fontes atuais.** Identidade, documento, contato, endereço e pedidos com data, valor, status e tracking.

**Ações e estados.** Editar e-mail/telefone e abrir pedido/tracking. Diferenciar dados originados do marketplace, editáveis localmente e ausentes.

**Análise.** Histórico de pedidos é o principal contexto operacional; o cadastro não deve parecer totalmente editável quando a origem não permite isso.

**Hierarquia alvo.** Cabeçalho com identidade e resumo; cards de contato/endereço/documento; histórico em tabela; edição pequena e contextual.

```text
┌ ← Clientes | Nome do cliente ───────────────────── [Editar contato]┐
│ [Identidade/documento] [Contato] [Endereço]                        │
│ Histórico de pedidos                                               │
│ Pedido | Data | Valor | Status | Tracking | →                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Cards de cadastro e timeline/lista de pedidos; telefone/e-mail editáveis sem sugerir edição de campos sincronizados.

### BNT-D15 — Fornecedores (`/fornecedores`, wrapper `/fornecedores/cadastros`)

**Objetivo e público.** Administrar fornecedores, modalidades operacionais e sincronização DSLite.

**Dados e fontes atuais.** ID/nickname DSLite, nome, contato, capacidades de cross-docking/dropshipping, status e última sincronização.

**Ações e estados.** Buscar/filtrar, sincronizar, alterar status conforme suporte e abrir detalhe/payload. Estados da sincronização precisam indicar início, término, erro e dado potencialmente desatualizado.

**Análise.** Dados técnicos DSLite são importantes no diagnóstico, mas não devem dominar a tabela. Modalidades e estado operacional são a comparação principal.

**Hierarquia alvo.** Resumo de ativos/sincronização; filtros status/modalidade; tabela fornecedor, modalidades, status, contato e última sync; detalhe técnico progressivo.

```text
┌ Fornecedores ─────────────────────────────────── [Sincronizar] ┐
│ [Ativos] [Inativos] [Sync com atenção]                         │
│ [Busca] [Status] [Cross-docking] [Dropshipping]                │
│ Fornecedor | Modalidades | Status | Contato | Última sync | →  │
└────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Cartão com nome, modalidades, status e freshness; dados técnicos em detalhe. `/fornecedores/cadastros` não ganha implementação duplicada.

### BNT-D16 — Fornecedor (`/fornecedores/[id]`)

**Objetivo e público.** Consultar e manter dados locais do fornecedor, distinguindo-os dos campos sincronizados.

**Dados e fontes atuais.** Cadastro, contato, PIX, observações, campos DSLite, capacidades, status e alertas.

**Ações e estados.** Editar campos locais, alternar status quando permitido e consultar dados sincronizados. Campos DSLite devem ser somente leitura quando a origem é externa.

**Análise.** Misturar origem local e DSLite gera expectativa incorreta de edição. A interface deve mostrar proprietário/fonte e momento da última sincronização.

**Hierarquia alvo.** Cabeçalho/status; alertas; seções Dados locais, Operação, Pagamento, DSLite e Observações; edição por seção.

```text
┌ ← Fornecedores | Fornecedor ───────────────── [Ativar/Desativar]┐
│ [Alerta operacional, quando existir]                            │
│ Dados locais | Operação | Pagamento | DSLite                    │
│ campo ........ valor ........ origem / última sincronização     │
│ Observações                                        [Editar seção]│
└─────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Seções em accordions apenas se melhorarem leitura; ação de status exige confirmação. Nunca reativar recursos exclusivos Hayamax.

### BNT-D17 — Créditos de fornecedores (`/fornecedores/creditos`)

**Objetivo e público.** Acompanhar saldos, movimentos e decisões pendentes do ledger de fornecedores. Ações financeiras seguem as permissões atuais.

**Dados e fontes atuais.** Saldo disponível, pendente, uso no mês, fornecedores com pendência, movimentos, reconciliação de cancelamentos e extrato.

**Ações e estados.** Adicionar movimento, decidir pendência, reconciliar e consultar extrato. Bloquear envio duplicado e manter histórico aposentado somente leitura.

**Análise.** Saldo e pendência precisam indicar composição e tipo do ledger. Um valor agregado sem extrato ou estado de reconciliação não basta para decisão.

**Hierarquia alvo.** KPIs financeiros; fila de pendências; tabela por fornecedor/saldo/último movimento; `Drawer` de extrato; modais distintos para movimento e decisão.

```text
┌ Créditos ─────────────────────────── [Novo movimento] [Reconciliar]┐
│ [Disponível] [Pendente] [Usado no mês] [Fornecedores pendentes]   │
│ Pendências prioritárias                                             │
│ Fornecedor | Saldo | Pendente | Último movimento | [Extrato]       │
└─────────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** KPIs 2×2; fornecedor em cartão; extrato em tela cheia. Preservar os tipos consolidados em `RULE-07` e não ressuscitar conta-saldo Hayamax.

### BNT-D18 — Reputação (`/reputacao`)

**Objetivo e público.** Explicar o nível atual da reputação Mercado Livre e quais métricas determinantes exigem atenção.

**Dados e fontes atuais.** Nível, transações, cancelamentos e indicadores/limites retornados pela integração; estado de conexão ML.

**Ações e estados.** Conectar quando necessário e atualizar. Tratar sem conexão, sem histórico suficiente, dado parcial e erro externo sem fabricar nível ou tendência.

**Análise.** A leitura deve ir do nível para os fatores que o determinam e só depois para detalhes. Limite e valor atual precisam compartilhar unidade e período.

**Hierarquia alvo.** Faixa do nível atual; métricas determinantes com valor/limite; orientação contextual; histórico/tendência apenas quando presente no DTO.

```text
┌ Reputação Mercado Livre ─────────────────────────── [Atualizar] ┐
│ Nível atual: [faixa e significado]                              │
│ [Cancelamentos valor/limite] [Reclamações] [Atrasos]            │
│ O que exige atenção agora                                      │
│ Detalhes e período analisado                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Nível e maior risco primeiro; métricas empilhadas. O texto deve refletir somente os campos oficiais e o retorno real de `/users/{id}`.

### BNT-D19 — Reclamações (`/reclamacoes`)

**Objetivo e público.** Priorizar reclamações por estágio, prazo e responsável, oferecendo contexto seguro para acompanhamento.

**Dados e fontes atuais.** ID, pedido/cliente/produto, tipo, estágio, status e atualização. A integração atual consulta; ações não suportadas direcionam ao Mercado Livre.

**Ações e estados.** Buscar/filtrar, atualizar e abrir a reclamação no Mercado Livre. Não exibir botão interno de resolução sem endpoint e contrato implementados.

**Análise.** Status aberto/fechado isolado é insuficiente: estágio, responsável e prazo disponível determinam prioridade. O filtro deve manter o vendedor/recurso exigido pelo contrato externo.

**Hierarquia alvo.** Resumo de abertas e críticas; filtros por busca, tipo, estágio e status; tabela ID/pedido/contexto/estágio/responsável/prazo/atualização; detalhe progressivo.

```text
┌ Reclamações ───────────────────────────────────────── [Atualizar]┐
│ [Abertas] [Com prazo] [Mediação] [Atualizadas hoje]              │
│ [Busca] [Tipo] [Estágio] [Status]                                │
│ ID | Pedido/cliente | Motivo | Estágio | Responsável | Prazo | → │
└──────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Cartão prioriza prazo, estágio e responsável; ação segura abre ML. Ações internas dependem de `BNT-GAP-003` e tarefa funcional separada.

### BNT-D20 — Configurações (`/configuracoes`)

**Objetivo e público.** Administrar empresa, integrações, usuários e preferências em uma única rota. Acesso exclusivo de `admin`.

**Dados e fontes atuais.** Quatro áreas já extraídas: Empresa, Integrações, Usuários e Preferências; dados fiscais e de notificação permanecem dentro das áreas responsáveis atuais.

**Ações e estados.** Editar/salvar cada domínio, conectar integrações e administrar usuários conforme contratos existentes. Segredos continuam mascarados e nunca retornam ao browser.

**Análise.** A navegação deve mostrar escopo e estado não salvo. Não criar várias rotas nem um “salvar tudo” que misture efeitos independentes.

**Hierarquia alvo.** Cabeçalho; tabs laterais ou superiores conforme largura; descrição curta da seção; formulário em blocos; ação salvar contextual; saúde/configuração nas integrações sem revelar secrets.

```text
┌ Configurações ──────────────────────────────────────────────────┐
│ Empresa | Integrações | Usuários | Preferências                 │
│ Título da seção                                                  │
│ [bloco coerente de campos]                                      │
│ [bloco secundário]                         [Cancelar] [Salvar]   │
└─────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Tabs viram seletor/rolagem acessível; salvar fica contextual à seção. Preservar `UI-03`, proteção admin e regras de secrets runtime/browser.

### BNT-D21 — TV ao Vivo (`/tv`)

**Objetivo e público.** Exibir em monitor uma leitura imediata do desempenho diário, metas, vendas e perguntas, sem exigir interação constante.

**Dados e fontes atuais.** Live/metrics com polling, vendas do dia, receita, lucro, metas/tendências, vendas recentes e perguntas; celebrações de venda/pergunta.

**Ações e estados.** Atualizar, entrar/sair de tela cheia. Indicar perda de atualização, última leitura e erro parcial sem apagar os últimos dados válidos de forma enganosa.

**Análise.** Distância de leitura exige poucos níveis, tipografia grande e cor semântica. Controles e detalhes técnicos ficam discretos; animação não pode impedir leitura.

**Hierarquia alvo.** Métrica dominante; meta/progresso; tendências reais; feed curto de vendas/perguntas; timestamp/saúde; controles no canto.

```text
┌ BENTEVI TV                                     10:32  [⛶] [↻] ┐
│    RECEITA HOJE        VENDAS        LUCRO                    │
│    R$ xx.xxx            000          R$ x.xxx                 │
│ Meta ━━━━━━━━━━━━━ 72%      tendência / comparação real       │
│ Vendas recentes                     Perguntas pendentes        │
└────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** A rota pode ser consultada, mas sua composição primária é 16:9/monitor. Respeitar preferência de movimento reduzido e não aumentar frequência de polling por causa do layout.

### BNT-D22 — Login (`/login`)

**Objetivo e público.** Autenticar usuário interno com o menor atrito possível e identidade Bentevi clara.

**Dados e fontes atuais.** E-mail, senha, sessão Supabase e retorno de autenticação.

**Ações e estados.** Entrar; loading, credencial inválida, indisponibilidade e sessão já válida. Não revelar se uma conta específica existe além do contrato de autenticação atual.

**Análise.** Uma única tarefa pede uma composição direta. Marca e mensagem de ambiente DEV devem ser visíveis sem poluir o formulário.

**Hierarquia alvo.** Logo otimizado, título curto, e-mail, senha, mensagem de erro e botão primário; identificação discreta de homologação.

```text
┌──────────────────────────────────────────────┐
│                 BENTEVI                      │
│          Acesse o painel                     │
│  E-mail [.................................]  │
│  Senha  [.................................]  │
│  [mensagem de erro]                          │
│  [                 Entrar                 ]  │
│              Ambiente de homologação         │
└──────────────────────────────────────────────┘
```

**Web celular e aceite.** Card perde moldura desnecessária e usa largura confortável; teclado não esconde ação. Autenticação permanece inalterada.

### BNT-D23 — Página pública BKR1 (`/fornecedor/bkr1/kits-sem-anuncio`)

**Objetivo e público.** Permitir que o fornecedor preencha GTINs válidos dos kits sem anúncio por um link público controlado.

**Dados e fontes atuais.** Token do link, lista de kits/SKUs sem anúncio/GTIN, resumo e GTIN editável entre 8 e 14 dígitos conforme validação atual.

**Ações e estados.** Salvar GTIN por SKU. Tratar link válido, inválido, expirado, já concluído, lista vazia, salvamento e erro por linha.

**Análise.** O usuário externo não conhece o ERP. Instrução, progresso e resultado por item devem ser autoexplicativos; nenhum menu interno aparece.

**Hierarquia alvo.** Marca Bentevi; identificação do parceiro/tarefa; instrução curta; progresso; tabela/lista SKU/produto/GTIN/estado; confirmação final.

```text
┌ BENTEVI | Atualização de GTIN — BKR1 ──────────────────────────┐
│ Instrução curta • link seguro • progresso 7/12                  │
│ SKU | Produto/kit | GTIN [______________] | [Salvar] ✓/erro     │
│ ...                                                             │
│ Dúvida? orientação de contato autorizada                        │
└─────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Um item por cartão com input numérico adequado e feedback inline; não expor dados além do token. Preservar contrato específico e salvamento por SKU.

### BNT-D24 — Página pública Evolusom (`/fornecedor/evolusom/produtos-sem-gtin`)

**Objetivo e público.** Coletar do fornecedor GTINs ausentes para os produtos vinculados ao link público.

**Dados e fontes atuais.** Token, produtos sem GTIN e validação de 8, 12, 13 ou 14 dígitos.

**Ações e estados.** Salvar GTIN por produto; representar link inválido/expirado/concluído, lista vazia, valor inválido e resultado por linha.

**Análise.** Compartilha linguagem visual externa com BKR1, mas o contrato de validação não é idêntico e não deve ser generalizado silenciosamente.

**Hierarquia alvo.** Mesmo esqueleto de marca, orientação, progresso e feedback; conteúdo e validação específicos de Evolusom.

```text
┌ BENTEVI | Atualização de GTIN — Evolusom ──────────────────────┐
│ Informe GTIN com 8, 12, 13 ou 14 dígitos • progresso           │
│ SKU | Produto | GTIN [______________] | [Salvar] ✓/erro         │
│ ...                                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Web celular e aceite.** Cartões de produto e feedback inline; foco avança após sucesso quando seguro. Reutilizar apenas o padrão visual comprovado, preservando API, token e validação próprios.

## 6. Web celular — contrato comum das 24 superfícies

A adaptação web celular ocorre somente depois da aprovação das 24 páginas desktop e na mesma ordem. Não haverá uma segunda aplicação nem componentes funcionais paralelos.

### 6.1 Viewport e navegação

- viewport de aceite: `390×844`;
- sidebar substituída por `Drawer`, aberto pelo cabeçalho;
- detalhe em `Drawer` de tela inteira ou navegação à rota existente;
- breadcrumb longo vira ação de voltar + título;
- filtros secundários ficam em Drawer, mas busca e filtro principal permanecem acessíveis;
- ação primária deve permanecer visível sem criar uma barra fixa em páginas somente leitura.

### 6.2 Listas e tabelas

- converter tabela em lista/cartões quando a comparação entre colunas não for essencial;
- preservar duas ou três informações de decisão, status e ação primária no cartão;
- colocar metadados e ações secundárias na expansão/detalhe;
- admitir scroll horizontal apenas para conteúdo genuinamente tabular, nunca no documento inteiro;
- manter paginação, total, ordenação e escopo dos filtros visíveis.

### 6.3 Formulários e ações

- uma coluna, labels explícitos e teclado/tipo de input apropriados;
- salvar contextual à seção em edição;
- confirmação de ação destrutiva/externa com efeito e objeto identificados;
- feedback inline próximo ao controle e resumo no topo quando houver múltiplos erros;
- estados de permissão não devem depender de controles meramente ocultos.

### 6.4 Wireframe comum

```text
┌☰  Título da página                   [ação]┐
│ [KPI] [KPI] [KPI] →                         │
│ [Buscar........................] [Filtros 2] │
│ ┌ item / contexto                    status ┐│
│ │ dado decisório • dado decisório           ││
│ │ pendência / motivo            [Ação]      ││
│ └───────────────────────────────────────────┘│
│ ...                                           │
└───────────────────────────────────────────────┘
```

## 7. Aplicativo nativo — oito superfícies

O aplicativo usa Expo/React Native, navegação própria, TanStack Query e `/api/mobile/v1`; não deve importar padrões ou dependências exclusivas do web. `slug`, scheme, package Android, projeto EAS e outros identificadores técnicos permanecem atuais.

### 7.1 Shell e tabs

**Objetivo.** Tornar TV, Vendas, Compras e Perfil imediatamente reconhecíveis, aplicar marca/tokens Bentevi e preservar navegação nativa.

**Estrutura alvo.** Safe areas, status bar coerente, quatro tabs com ícone+rótulo, badge apenas para contagem real e cabeçalho por stack. Loading de bootstrap e perda de sessão têm tratamento global.

```text
┌ cabeçalho da rota ──────────────────┐
│ conteúdo da stack                   │
│                                     │
├─────────────────────────────────────┤
│ TV      Vendas     Compras   Perfil │
└─────────────────────────────────────┘
```

**Aceite.** Navegação, deep links e sessão preservados; toque, foco e leitura de tela validados.

### 7.2 Login

**Objetivo/dados.** Autenticar com e-mail/senha pelo fluxo mobile atual. Marca, campos, erro e ação seguem a linguagem de `BNT-D22`, sem compartilhar código web.

```text
┌ BENTEVI ────────────────────────────┐
│ Acesse o aplicativo                 │
│ E-mail [.........................]  │
│ Senha  [.........................]  │
│ [Entrar]                            │
└─────────────────────────────────────┘
```

**Estados/aceite.** Teclado, loading, credencial inválida, rede indisponível e sessão válida; botão não dispara envio duplicado.

### 7.3 TV

**Objetivo/dados.** Leitura portátil das métricas disponíveis na API mobile; não reduzir literalmente o painel 16:9.

```text
┌ TV ao vivo ───────────── atualizado ┐
│ Receita hoje                        │
│ R$ xx.xxx                           │
│ [Vendas] [Lucro]                    │
│ Meta / tendência real               │
│ Atividade recente                   │
└─────────────────────────────────────┘
```

**Ações/aceite.** Pull-to-refresh se já compatível com o fluxo, loading/erro/parcial e timestamp. Não criar polling mais agressivo que o atual.

### 7.4 Lista de Vendas

**Objetivo/dados.** Localizar e priorizar vendas usando o DTO mobile atual, filtros suportados e permissões.

```text
┌ Vendas ─────────────────── [Filtro] ┐
│ [Buscar.........................]   │
│ #pedido  cliente            status │
│ valor • pendência              [›] │
│ ...                                 │
└─────────────────────────────────────┘
```

**Estados/aceite.** Loading, vazio, erro, paginação/refresh e filtro ativo. Não omitir estágio crítico em favor de detalhes decorativos.

### 7.5 Detalhe da Venda

**Objetivo/dados.** Mostrar resumo, itens, fulfillment, fiscal, tracking e ações autorizadas pela API mobile.

```text
┌ ‹ Venda #... ─────────────── status ┐
│ cliente • valor • data              │
│ Próxima ação / pendência            │
│ Itens                               │
│ Fulfillment / envio                 │
│ Fiscal / tracking                   │
│ [ação autorizada]                   │
└─────────────────────────────────────┘
```

**Aceite.** Ação principal corresponde ao estágio; efeitos externos têm confirmação e feedback; visualizador permanece somente leitura.

### 7.6 Lista de Compras

**Objetivo/dados.** Acompanhar compra, venda relacionada, fornecedor, valor, pagamento e fiscal no contrato mobile atual.

```text
┌ Compras ────────────────── [Filtro] ┐
│ [Buscar.........................]   │
│ #compra • venda #...        status │
│ fornecedor • total             [›] │
└─────────────────────────────────────┘
```

**Aceite.** Estados e filtros consistentes com o web, sem introduzir ação financeira fora das permissões.

### 7.7 Detalhe da Compra

**Objetivo/dados.** Explicar vínculo com venda, fornecedor, itens, pagamento, comprovante e NF.

```text
┌ ‹ Compra #... ────────────── status ┐
│ venda vinculada • fornecedor        │
│ total • pagamento                   │
│ Itens / documento / comprovante     │
│ [ação autorizada]                   │
└─────────────────────────────────────┘
```

**Aceite.** Confirmação financeira somente para papel autorizado; histórico Hayamax não reaparece como ação.

### 7.8 Perfil

**Objetivo/dados.** Identificar usuário, papel e sessão, oferecer preferências mobile já existentes e saída segura.

```text
┌ Perfil ─────────────────────────────┐
│ avatar  nome                        │
│ e-mail • papel                      │
│ Preferências disponíveis            │
│ [Sair do aplicativo]                │
└─────────────────────────────────────┘
```

**Aceite.** Papel é informativo, não editável; logout limpa sessão conforme o fluxo atual; nenhuma credencial é exibida.

## 8. Lacunas funcionais registradas

Estas lacunas não bloqueiam `BNT-BRAND-01` nem o shell. Elas bloqueiam somente a experiência indicada caso o produto decida ampliá-la além do contrato atual.

| ID | Evidência atual | Impacto no redesign | Tratamento |
|---|---|---|---|
| `BNT-GAP-001` | Em Perguntas, status é global, mas busca e período são aplicados à página carregada. | Uma inbox com busca global seria enganosa. | Manter rótulo “nesta página”; criar tarefa de API/paginação apenas se busca global for requisito. |
| `BNT-GAP-002` | A sidebar lê do `localStorage` somente sinais de ML e DSLite. | Não sustenta, por si só, um centro completo e atualizado de saúde das integrações. | No shell, representar apenas sinais comprovados; ampliar health em tarefa funcional separada. |
| `BNT-GAP-003` | Reclamações oferece acompanhamento e link externo; não há fluxo interno completo de resolução. | Botões internos de ação prometeriam capacidade inexistente. | Manter direcionamento seguro ao ML até endpoint, permissão, idempotência e teste próprios. |
| `BNT-GAP-004` | Tendências/comparações variam conforme o DTO disponível em Dashboard, TV e Reputação. | Gráficos sem série/período real fabricariam significado. | Renderizar somente séries reais; qualquer nova agregação exige requisito de dados separado. |

Não há lacuna funcional conhecida que justifique mudar banco, API ou regra de negócio para iniciar a fundação visual.

## 9. Sequência de implementação derivada

| Ordem | Ação | Saída esperada |
|---:|---|---|
| 1 | `BNT-BRAND-01` | assets derivados do master e tokens Bentevi validados |
| 2 | `BNT-SHELL-01` | shell desktop responsivo, navegação e permissões preservadas |
| 3 | `BNT-DOM-DEV` | `dev.bentevi.shop` configurado e validado sem tocar produção |
| 4 | `BNT-D01` | piloto Vendas desktop aprovado |
| 5 | `BNT-D02` a `BNT-D24` | uma página desktop por tarefa e aprovação |
| 6 | web celular | mesmas 24 páginas, mesma ordem, uma por tarefa |
| 7 | aplicativo nativo | oito superfícies, uma por tarefa |
| 8 | promoção | checklist separado, somente com autorização explícita |

Uma página não avança se depender de um `BNT-GAP` ainda não resolvido para cumprir o comportamento aprovado. A lacuna pode ser explicitamente retirada do escopo, mas nunca mascarada por dado fictício.

## 10. Critérios de aceite do dossiê

- [x] 24 superfícies web canônicas inventariadas;
- [x] alias `/catalogo` e wrappers/visões compartilhadas identificados;
- [x] shell, navegação, públicos e permissões documentados;
- [x] dados, ações, estados e hierarquia alvo registrados por página;
- [x] wireframe desktop anotado por página;
- [x] direção `390×844` registrada por página e contrato celular comum definido;
- [x] oito superfícies do aplicativo nativo especificadas;
- [x] lacunas funcionais separadas do redesign;
- [x] nenhuma implementação, migration, escrita externa ou mudança de domínio realizada;
- [x] próxima ação limitada a `BNT-BRAND-01`.

## 11. Fontes internas

- [Plano do redesign completo](./VORTEK_BENTEVI_PLANO_REDESIGN_COMPLETO.md)
- [Plano completo do Item 17](./VORTEK_ITEM_17_PLANO_COMPLETO_EXECUCAO_HOMOLOGACAO.md)
- [Checklist de execução do Item 17](./VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md)
- [Consolidação do Item 16](./VORTEK_AUDITORIA_ITEM_16_CONSOLIDACAO.md)
- [Interface web — Item 11](./VORTEK_AUDITORIA_ITEM_11_INTERFACE_WEB.md)
- [Pedidos e fulfillment — Item 2](./VORTEK_AUDITORIA_ITEM_02_PEDIDOS_FULFILLMENT_ESTOQUE_INTERNO_ATUALIZADO.md)
- [Produtos, fornecedores e kits — Item 3](./VORTEK_AUDITORIA_ITEM_03_PRODUTOS_FORNECEDORES_KITS.md)
- [Mercado Livre — Item 4](./VORTEK_AUDITORIA_ITEM_04_MERCADO_LIVRE_ANUNCIOS_CATALOGO.md)
- [Fiscal — Item 5](./VORTEK_AUDITORIA_ITEM_05_FISCAL.md)
- [Compras e financeiro — Item 6](./VORTEK_AUDITORIA_ITEM_06_COMPRAS_FORNECEDORES_FINANCEIRO.md)
- [Segurança e permissões — Item 9](./VORTEK_AUDITORIA_ITEM_09_AUTH_SEGURANCA_PERMISSOES.md)
- [Regras compartilhadas — Item 12](./VORTEK_AUDITORIA_ITEM_12_REGRAS_NEGOCIO_COMPARTILHADAS.md)
- [Performance e saúde — Item 13](./VORTEK_AUDITORIA_ITEM_13_PERFORMANCE_SAUDE_OPERACIONAL.md)
- código atual em `src/app`, `src/components`, `src/lib`, `mobile/app` e APIs correspondentes.

## 12. Referências oficiais atuais

### Interface, acessibilidade e plataforma

- Ant Design 5 — customização de tema: <https://5x.ant.design/docs/react/customize-theme/>
- Ant Design 5 — Layout: <https://5x.ant.design/components/layout/>
- Ant Design 5 — Table: <https://5x.ant.design/components/table/>
- WCAG 2.2: <https://www.w3.org/TR/WCAG22/>
- Expo — configuração do aplicativo: <https://docs.expo.dev/versions/latest/config/app/>
- Expo — ícone e splash: <https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/>

### Benchmarks de organização operacional

- Shopify — detalhes de pedido e timeline: <https://help.shopify.com/en/manual/fulfillment/managing-orders/managing-order-details>
- Shopify — gestão e estados de estoque: <https://help.shopify.com/en/manual/products/inventory>
- Shopify — busca, filtros e colunas de estoque: <https://help.shopify.com/en/manual/products/inventory/adjusting-inventory/viewing-inventory>
- Odoo 19 — Purchase: <https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase.html>
- Odoo 19 — Inventory: <https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory.html>
- Grafana — boas práticas de dashboards: <https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/>

### Contratos Mercado Livre que afetam a representação

- Gerenciamento de orders: <https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas>
- Perguntas e respostas: <https://developers.mercadolivre.com.br/devcenter/perguntas-e-respostas>
- Publicação de produtos: <https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos>
- Publicações requeridas no catálogo: <https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/publicacoes-necessarias-do-catalogo>
- Qualidade das publicações: <https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes>
- Reputação de vendedores: <https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/reputacao-de-vendedores>
- Gerenciar reclamações: <https://developers.mercadolivre.com.br/pt_br/atributos/gerenciar-reclamacoes>

As referências devem ser reconfirmadas na tarefa de cada página. Este dossiê congela a decisão de organização em 31/08/2026, não versões futuras de APIs ou componentes.
