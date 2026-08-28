# Vortek — Auditoria de Limpeza e Organização

## Item 1 — Mapa Geral do Sistema Web

**Status:** Concluído  
**Branch analisada:** `dev`  
**Objetivo:** mapear a estrutura atual do projeto web antes de qualquer planejamento de simplificação, sem propor alterações prematuras.

---

## 1. Resumo executivo

O Vortek web é uma aplicação Next.js com App Router que concentra interface, backend, automações e integração com serviços externos.

A estrutura geral observada é:

```text
Interface Web
     ↓
APIs Next.js
     ↓
Regras / Orquestrações
     ↓
┌──────────────┬───────────────────────────────┐
│ Supabase     │ Integrações externas          │
│ PostgreSQL   │ ML / DSLite / Brasil NFe /   │
│ Auth/Storage │ Mercado Pago / WAHA / etc.   │
└──────────────┴───────────────────────────────┘
     ↑
Jobs / Sync / Webhooks
```

O Supabase operacional é self-hosted.

O projeto já apresenta domínios claros, mas também possui áreas onde código de negócio, integração, interface e automação se misturam. Neste item isso foi apenas identificado; nenhuma simplificação foi decidida ainda.

O núcleo operacional do sistema é:

```text
Produtos + Fornecedores + Estoque
             ↓
      Pedidos / Fulfillment
       ↙      ↓       ↘
    DSLite   Fiscal   Mercado Livre
       ↘      ↓       ↙
         Jobs / Sync
             ↓
       Operação final
```

Pedidos/Fulfillment é atualmente o maior ponto de convergência entre os principais domínios.

---

## 2. Módulos funcionais principais

### Pedidos
Responsável por pedidos, fulfillment, despacho, estados operacionais e integração com fiscal, estoque, fornecedor e Mercado Livre.

### Produtos
Responsável por cadastro, SKU, custos, atributos e informações usadas por estoque, fornecedores e anúncios.

### Fornecedores
Responsável por cadastro de fornecedores, ofertas, custos, disponibilidade externa e vínculo com produtos.

### Estoque
Responsável por estoque interno, movimentações, devoluções, disponibilidade para venda, estornos e estados relacionados.

### Compras
Responsável por compras junto a fornecedores, integração com DSLite e estados operacionais/financeiros relacionados.

### Anúncios
Responsável principalmente por anúncios Mercado Livre, preço, estoque, status, catálogo e automações relacionadas.

### Catálogo
Responsável por catálogo Mercado Livre, competição, snapshots e acompanhamento de anúncios.

### Fiscal
Responsável por NF-e, Brasil NFe, estados fiscais, XML, DANFE e reconciliação.

### Clientes
Responsável por compradores/clientes e identificação ligada a pedidos e operações.

### Configurações
Responsável por empresa, integrações e parâmetros operacionais.

### Operação Mercado Livre
Também existem áreas específicas para perguntas, reclamações, reputação, catálogo, anúncios e sincronizações.

### Dashboard / TV
Responsáveis por acompanhamento operacional e visualização de estado do negócio.

---

## 3. Backend e APIs

O backend acompanha os mesmos domínios funcionais da interface e adiciona áreas técnicas.

Principais grupos identificados:

- autenticação;
- produtos;
- pedidos;
- estoque;
- compras;
- fornecedores;
- anúncios;
- catálogo;
- fiscal;
- integrações;
- jobs;
- sincronizações;
- webhooks;
- operações;
- mobile.

Existe uma área relevante dedicada à automação e sincronização, incluindo cron, dispatch, recuperação de jobs, sincronização DSLite, sincronização Mercado Livre, preço e estoque, pedidos, Mercado Pago e Brasil NFe.

Os webhooks fazem parte da infraestrutura de integração e devem ser tratados como componentes operacionais, não como código acessório.

---

## 4. Núcleo de código

### `src/services`

Mistura atualmente dois tipos principais de responsabilidade.

#### Integrações externas
- Mercado Livre;
- DSLite;
- Mercado Pago;
- Brasil NFe;
- WAHA;
- e-mail.

#### Orquestração interna
- pedidos;
- pricing;
- jobs;
- sync;
- catálogo;
- auditoria fiscal.

Isso não foi classificado ainda como errado. Apenas significa que, nas próximas auditorias, será necessário separar complexidade necessária de responsabilidades realmente duplicadas.

### `src/lib`

Já existem domínios organizados:

- `auth`;
- `catalogo`;
- `dslite`;
- `fiscal`;
- `ml`;
- `orders`;
- `sync`.

Ao mesmo tempo, ainda há código específico diretamente na raiz de `src/lib`.

A existência desses domínios é importante porque qualquer futura simplificação deve preferir consolidar o que já existe, sem criar uma arquitetura paralela.

---

## 5. Banco de dados — grupos principais

### Negócio
- produtos;
- clientes;
- fornecedores;
- ofertas de fornecedor;
- kits;
- pedidos;
- itens de pedido;
- compras;
- estoque interno.

### Mercado Livre
- anúncios;
- snapshots de catálogo;
- refresh de catálogo;
- outbox;
- bloqueios;
- estados relacionados à sincronização.

### Fiscal
- dados fiscais ligados aos pedidos;
- emissão de NF-e;
- auditoria fiscal;
- estados de reconciliação.

### Financeiro
- pagamentos a fornecedores;
- saldo de fornecedores;
- movimentos do Mercado Pago.

### Automação
- jobs;
- locks;
- configurações de sincronização;
- estados de processamento.

### Comunicação / operação
- eventos de WhatsApp;
- alertas;
- links;
- integrações.

As migrations mostram evolução progressiva desses domínios conforme as automações foram crescendo.

---

## 6. Dependências entre áreas

```text
Produtos + Fornecedores + Estoque
             ↓
      Pedidos / Fulfillment
       ↙      ↓       ↘
    DSLite   Fiscal   Mercado Livre
       ↘      ↓       ↙
         Jobs / Sync
             ↓
       Operação final
```

### Interpretação

**Pedidos/Fulfillment** é o principal ponto de convergência do sistema.

**Produtos/Fornecedores/Estoque** formam a base de disponibilidade, custo e origem de atendimento.

**Jobs/Sync** são infraestrutura transversal da automação.

**Mercado Livre** é a integração externa com maior superfície funcional e operacional.

**Fiscal** é parte crítica do fluxo de pedidos e não deve ser analisado isoladamente de fulfillment.

---

## 7. Código operacional x administrativo x histórico

### Claramente operacional
- `src/app`;
- `src/services`;
- `src/lib`;
- `src/types`;
- migrations Supabase;
- grande parte dos testes;
- jobs;
- sincronizações;
- webhooks.

### Suporte operacional
- scripts de deploy;
- diagnóstico;
- backup;
- recuperação;
- reconciliação;
- manutenção recorrente.

### Administrativo
- `docs`;
- `.agents`;
- configurações de desenvolvimento;
- configurações de deploy.

### Forte candidato a histórico
- grande parte de `reports/`;
- scripts datados;
- scripts específicos de campanhas;
- scripts de fornecedores;
- repairs antigos;
- relatórios de fases anteriores.

**Importante:** nenhum desses candidatos foi marcado para exclusão. Essa classificação serve apenas para uma auditoria posterior de limpeza.

---

## 8. Testes

O projeto possui uma quantidade relevante de testes distribuídos por áreas importantes.

Foram identificadas coberturas relacionadas a:

- estoque interno;
- DSLite;
- pricing;
- catálogo;
- jobs;
- Mercado Livre;
- fluxos operacionais.

Isso será importante para o planejamento de execução porque a limpeza futura deverá aproveitar testes existentes como proteção contra regressão.

---

## 9. Integrações externas identificadas

As principais integrações do projeto web são:

- Mercado Livre;
- Mercado Pago;
- DSLite;
- Brasil NFe;
- Supabase self-hosted;
- WAHA / WhatsApp;
- serviços de e-mail e notificações associados à operação.

A existência dessas integrações aumenta naturalmente a complexidade do projeto.

Nas próximas auditorias, cada retry, fallback, webhook, reconciliador ou job deverá ser avaliado pelo motivo operacional que resolve antes de ser considerado redundante.

---

## 10. Conclusão do Item 1

O Vortek não é um conjunto de módulos independentes.

Ele possui um núcleo fortemente integrado:

1. produtos, fornecedores e estoque definem disponibilidade e custo;
2. pedidos/fulfillment decidem como a venda será atendida;
3. DSLite, Fiscal e Mercado Livre executam partes da operação;
4. jobs, sync e webhooks mantêm o processo automatizado;
5. a interface acompanha e controla esse fluxo.

A primeira auditoria funcional profunda deve, portanto, ser:

**Pedidos + Fulfillment + Estoque Interno.**

Essa área conecta o maior número de domínios e também precisa ser preparada para o crescimento do estoque próprio sem destruir as automações atuais.

---

## 11. Resultado para o checklist

- [x] Mapear módulos, páginas, APIs, services, libs, jobs, webhooks, banco e integrações.
- [x] Identificar quem depende de quem.
- [x] Separar código operacional de código administrativo/histórico.
- [x] Identificar o núcleo operacional do sistema.
- [x] Definir a próxima área a ser auditada profundamente.

---

## 12. Restrições desta etapa

Nesta etapa:

- nenhum arquivo foi alterado;
- nenhuma migration foi executada;
- nenhum deploy foi realizado;
- nenhum código foi removido;
- nenhuma refatoração foi proposta como decisão final;
- nenhum artefato foi classificado definitivamente como lixo.

O objetivo foi apenas construir o mapa estrutural necessário para as próximas auditorias.

---

## 13. Fontes principais consultadas

### Repositório Vortek — branch `dev`
- `AGENTS.md`
- `src/app`
- `src/app/api`
- `src/services`
- `src/lib`
- `supabase/migrations`
- `tests`
- `reports`

Repositório oficial: `https://github.com/felipe-nomelini/vortek`

### Referência operacional
- `INSTRUCOES_AGENTE_VORTEK.md`

### Documentação externa
As decisões específicas sobre integrações externas serão documentadas nos itens correspondentes da auditoria, para evitar misturar áreas e conclusões.
