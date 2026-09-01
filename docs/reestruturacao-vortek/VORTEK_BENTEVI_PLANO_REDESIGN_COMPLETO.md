# Bentevi — Plano do Redesign Completo

**Função:** especificação operacional da nova identidade e da reestruturação visual
**Ambientes alvo:** desenvolvimento e homologação
**Branch de execução:** `dev`
**Status:** dossiê UX, fundação visual e shell desktop concluídos; domínio DEV novo operacional, com retirada do alias antigo pendente
**Identidade visível:** Bentevi
**Homologação:** `https://dev.bentevi.shop`
**Produção futura:** `https://app.bentevi.shop`

---

## 1. Objetivo e limite

Redesenhar toda a apresentação do ERP web, web celular, aplicativo mobile e páginas públicas da Bentevi para que o sistema seja intuitivo, simples de operar e rico em informação útil.

O redesign deve:

- compreender a função e todas as informações de cada página antes de desenhá-la;
- pesquisar referências atuais e adequadas ao domínio de cada tela;
- definir hierarquia, diagramação, densidade e componentes Ant Design pela necessidade operacional;
- preservar APIs, regras de negócio, permissões e efeitos externos;
- transformar qualquer informação inexistente em requisito funcional separado;
- executar uma página por tarefa, com validação antes da seguinte.

Não faz parte desta iniciativa:

- trocar Ant Design ou a arquitetura de dados;
- criar uma biblioteca de estado ou design system paralelo;
- renomear identificadores técnicos, eventos, pacotes, storage ou histórico Vortek;
- implementar silenciosamente novos cálculos, campos, APIs ou regras;
- alterar produção, fazer merge em `main` ou promover domínio automaticamente.

---

## 2. Momento correto

O planejamento fica registrado agora, mas a implementação visual somente começa depois de:

1. concluir as Etapas 8, 9 e 10 do Item 17;
2. concluir `SEC-06 — Next.js`;
3. concluir `UI-01` a `UI-06`, corrigindo comportamento e fronteiras antes de redesenhar;
4. confirmar que a página alvo não depende de requisito funcional ainda pendente.

A sequência obrigatória é:

```text
correções funcionais
→ dossiê UX completo
→ identidade e shell Bentevi
→ domínio DEV Bentevi
→ todas as páginas desktop
→ todas as páginas web celular
→ aplicativo nativo
→ preparação controlada de produção
```

`BNT-UX-00 — Dossiê completo de interface` foi concluído em:

[VORTEK_BENTEVI_DOSSIE_UX_COMPLETO.md](./VORTEK_BENTEVI_DOSSIE_UX_COMPLETO.md)

Esse documento é a especificação obrigatória de cada superfície, dos aliases, do web celular, do aplicativo nativo e das lacunas funcionais. `BNT-BRAND-01 — Assets e tokens Bentevi`, `BNT-SHELL-01 — Shell desktop Bentevi`, `BNT-DOM-DEV — dev.bentevi.shop` e `BNT-D01 — Vendas /pedidos — piloto` foram concluídas. A ação atual é `BNT-D02 — Dashboard`.

---

## 3. Evidência do estado atual

O web atual possui:

- shell fixo com sidebar de 240 px e conteúdo deslocado por margem fixa;
- fundo preto e quatro tokens principais em `ConfigProvider`;
- aparência majoritariamente definida por estilos inline em cada página;
- mais de vinte rotas internas, além de login, TV e duas páginas públicas;
- páginas operacionais extensas, como Vendas, Produtos, Configurações e Catálogo;
- aplicativo Expo separado, com tokens próprios e oito superfícies de navegação/conteúdo;
- somente um asset de marca versionado em `public/logo.png`.

O logotipo Bentevi fornecido é um PNG RGBA de `7096×3548`. A cor amarela dominante observada é `#FFBD0E`. O wordmark horizontal não atende sozinho favicon, sidebar recolhida ou ícone mobile, por isso haverá uma variante compacta derivada do pássaro.

---

## 4. Método obrigatório por página

Antes de qualquer alteração visual da página:

1. mapear objetivo, usuários, permissões e decisões operacionais;
2. inventariar dados, origem, ações, filtros, estados e integrações;
3. verificar suficiência, excesso, duplicação e hierarquia das informações;
4. pesquisar referências atuais de excelentes interfaces do mesmo domínio;
5. escolher os elementos Ant Design adequados ao conteúdo, sem partir do componente atual como obrigação;
6. documentar dados ausentes como requisitos funcionais independentes;
7. propor wireframe desktop anotado;
8. implementar somente a página atual;
9. validar funcionalidade, permissões, acessibilidade e apresentação;
10. aguardar aprovação antes da página desktop seguinte.

Nenhuma recomendação de benchmark autoriza copiar regras de outro sistema. O Vortek atual continua sendo a fonte do comportamento da Bentevi.

---

## 5. Fundação visual Bentevi

### 5.1 Identidade

- amarelo principal: `#FFBD0E`;
- fundo base: `#09090B`;
- superfície principal: `#141316`;
- superfície elevada: `#1D1B20`;
- borda: `#34313A`;
- texto principal: `#F7F7F8`;
- texto secundário: `#B3AFB7`;
- texto sobre amarelo: `#17120A`;
- fonte: Inter;
- tema: escuro em todos os canais.

Sucesso, atenção, erro e informação permanecem semânticos e não dependem somente da cor. Os pares finais devem cumprir WCAG 2.2 AA.

### 5.2 Assets derivados

Gerar a partir do master fornecido, sem redesenhar a marca:

- wordmark otimizado para shell, login, TV e páginas públicas;
- pássaro compacto para sidebar recolhida;
- favicon, Apple icon e ícones PWA;
- ícone e splash mobile;
- variantes de resolução adequadas, sem versionar o master de 7096 px sem necessidade.

### 5.3 Shell

- manter itens, nomes, grupos, ordem e URLs do menu atual;
- redesenhar sidebar, seleção, área do usuário e saúde das integrações;
- permitir sidebar expandida e recolhida no desktop;
- usar `Drawer` para o menu no web celular;
- refletir permissões existentes sem criar autorização exclusiva na interface;
- centralizar tokens e padrões comprovadamente repetidos;
- não criar abstração genérica de tabela, formulário, modal ou polling.

Padrões compartilhados só serão criados quando tiverem consumidores reais: cabeçalho de página, faixa de filtros, cartão de métrica, estados de carregamento/vazio/erro e hierarquia de ações.

---

## 6. Execução desktop página por página

`Vendas` é o piloto obrigatório.

| ID | Página/rota | Direção aprovada |
|---|---|---|
| `BNT-D01` | Vendas — `/pedidos` | Filas operacionais, KPIs essenciais, filtros persistentes, tabela orientada à decisão, detalhe em `Drawer` e ações agrupadas por etapa. Requer `UI-04` e `UI-01`. |
| `BNT-D02` | Dashboard — `/dashboard` | Indicadores principais, tendências, pendências acionáveis, vendas recentes, reputação e integrações com hierarquia única. |
| `BNT-D03` | Compras — `/compras` | Resumo, filtros, tabela e pagamento/comprovante no contexto da compra. Nenhuma interface Hayamax ativa. Requer `UI-06`. |
| `BNT-D04` | Notas Fiscais — `/notas-fiscais` | Estados fiscais, documentos e ações por nota; detalhe lateral e modais específicos para e-mail, cancelamento e CCe. |
| `BNT-D05` | Estoque — `/estoque` | KPIs por situação, filas de revisão/liberação e inserção manual simples. |
| `BNT-D06` | Perguntas — `/perguntas` | Caixa de entrada com prioridade, busca correta, contexto do anúncio e resposta contínua. Requer `UI-05`. |
| `BNT-D07` | Produtos — `/produtos` | KPIs, filtros e tabela orientados a estoque, rentabilidade, fornecedor e estado ML; publicação separada da listagem. |
| `BNT-D08` | Produto — `/produtos/[id]` | Cabeçalho persistente, galeria e seções claras para cadastro, fornecedores, estoque, preço, dimensões e descrição. |
| `BNT-D09` | Ofertas — `/produtos/ofertas` | Comparação de custo, estoque, fornecedor, elegibilidade e preferência. |
| `BNT-D10` | Oferta — `/produtos/ofertas/[id]` | Resumo operacional, produto principal, dados fiscais e comparação legível com ofertas relacionadas. |
| `BNT-D11` | Anúncios — `/anuncios` | KPIs, qualidade, estado e preço; análise de preço e Buy Box em painel dedicado. |
| `BNT-D12` | Catálogo — `/catalogo/no-catalogo` e `/catalogo/elegiveis` | Preservar rotas e componente compartilhado; separar refresh, análise, opt-in, publicação e acompanhamento. Requer `UI-02`. |
| `BNT-D13` | Clientes — `/clientes` | Resumo PF/PJ, busca e tabela com dados essenciais, sem métricas decorativas. |
| `BNT-D14` | Cliente — `/clientes/[id]` | Identidade, contato editável, endereço, documento e histórico de pedidos. |
| `BNT-D15` | Fornecedores — `/fornecedores/cadastros` | Filtros operacionais, estado DSLite, modalidades e sincronização sem poluir a tabela. |
| `BNT-D16` | Fornecedor — `/fornecedores/[id]` | Cadastro, condições operacionais, alertas e auditoria; distinguir campos locais de sincronizados. |
| `BNT-D17` | Créditos — `/fornecedores/creditos` | KPIs, saldos, pendências e extrato em `Drawer`; históricos aposentados somente leitura. |
| `BNT-D18` | Reputação — `/reputacao` | Nível atual, métricas determinantes, tendências e limites em leitura progressiva. |
| `BNT-D19` | Reclamações — `/reclamacoes` | Fila priorizada, contexto e histórico; ações não suportadas continuam direcionadas ao Mercado Livre. |
| `BNT-D20` | Configurações — `/configuracoes` | Manter uma rota e tabs; seções coesas de empresa, integrações, fiscal, notificações e usuários. Requer `UI-03`. |
| `BNT-D21` | TV — `/tv` | Painel de alta leitura para monitor, com métricas, tendências, metas, vendas, perguntas e controles discretos. |
| `BNT-D22` | Login — `/login` | Identidade Bentevi, formulário direto, feedback claro e autenticação inalterada. |
| `BNT-D23` | BKR1 pública | Marca, instruções, resumo, preenchimento e estados de link válido/expirado. |
| `BNT-D24` | Evolusom pública | Mesmo padrão externo, preservando o contrato específico de GTIN e segurança do link. |

Rotas-wrapper e aliases reutilizam a página responsável; não receberão implementações visuais paralelas.

---

## 7. Web celular

Somente depois de `BNT-D01` a `BNT-D24` aprovados, adaptar as mesmas páginas na mesma ordem:

- menu em `Drawer`;
- listas/cartões com detalhe progressivo no lugar de tabelas comprimidas;
- ação primária visível e ações secundárias agrupadas;
- barra fixa apenas em edição ou confirmação;
- nenhum overflow no documento;
- scroll horizontal limitado ao conteúdo tabular em que for indispensável.

O viewport de aceite é `390×844`. Não haverá etapa específica de tablet, embora nenhuma largura intermediária deva ficar propositalmente quebrada.

---

## 8. Aplicativo nativo

Depois do web celular, executar separadamente:

1. shell, tabs e tokens Bentevi;
2. login;
3. TV;
4. lista de Vendas;
5. detalhe da Venda;
6. lista de Compras;
7. detalhe da Compra;
8. Perfil.

Alterar nome visível, ícone e splash. Preservar `slug`, scheme, package Android, projeto EAS e demais identificadores técnicos atuais.

---

## 9. Domínio

A migração de domínio é uma ação operacional separada do layout.

### DEV

Depois da fundação visual e antes da aprovação do piloto:

1. inventariar consumidores atuais das URLs;
2. configurar DNS, TLS e domínio `dev.bentevi.shop` no serviço de homologação;
3. atualizar somente configurações DEV, callbacks e notificações de contas de teste;
4. validar login, OAuth, webhooks, links públicos, workers e aplicativo;
5. tornar o domínio novo canônico após os readbacks;
6. remover o alias antigo somente quando nenhum consumidor depender dele.

Estado em `2026-08-31`: DNS, Cloudflare Tunnel, TLS, login, health, callback e webhook do domínio novo foram validados. O alias `dev.vortek.shop` foi retirado do serviço DEV no Easypanel e seus DNS e ingress antigos foram removidos. `BNT-D01` foi aprovado em homologação e `BNT-D02` é a ação desktop corrente.

### Produção

`app.bentevi.shop` será preparado somente no checklist de promoção, com autorização explícita. O endpoint público do Supabase não muda nesta iniciativa. URLs de runtime devem vir da configuração de ambiente, nunca de hardcode.

---

## 10. Gate de validação

Cada página desktop deve comprovar:

- comportamento e dados preservados;
- permissões de admin, gerente, operador e visualizador;
- estados de carregamento, vazio, erro, conteúdo longo e paginação;
- filtros, ordenação e ações principais;
- contraste, foco, teclado e alvos de interação;
- screenshot em `1440×900` e `1920×1080`;
- teste direcionado, `npm run validate` e `npm run build`;
- homologação e aprovação antes da página seguinte.

Para web celular, validar também em `390×844`. Para mobile nativo, executar `npm run typecheck`, `npm run doctor` e smoke test Android.

Nenhuma validação visual deve disparar escrita externa ou operação destrutiva sem um fixture e uma autorização específicos.

---

## 11. Fontes oficiais da fundação

- Ant Design 5 — tema e tokens: <https://5x.ant.design/docs/react/customize-theme/>
- Ant Design 5 — Layout responsivo: <https://5x.ant.design/components/layout/>
- Ant Design 5 — tabelas: <https://5x.ant.design/components/table/>
- Next.js — metadata: <https://nextjs.org/docs/app/api-reference/functions/generate-metadata>
- Next.js — ícones: <https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons>
- Expo — app config: <https://docs.expo.dev/versions/latest/config/app/>
- Expo — ícone e splash: <https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/>
- WCAG 2.2: <https://www.w3.org/TR/wcag/>

As referências de domínio de cada página devem ser pesquisadas novamente no início de sua tarefa, porque este documento define o método e não congela benchmarks futuros.
