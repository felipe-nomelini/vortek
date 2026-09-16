# Bentevi — Oráculo de Fornecedores — Checklist de Implementação

**Função:** fonte de acompanhamento da liquidação consolidada de fornecedores

**Documento de origem:** `Briefing_Oraculo_Bentevi_Fornecedores_V2.pdf`

**Branch de desenvolvimento:** `dev`

**Aplicação produtiva:** `https://app.bentevi.shop`

**Banco produtivo:** `supabase.bentevi.shop` (`192.168.1.162`)

**Criado em:** 16/09/2026

**Última atualização:** 16/09/2026
**SHA-base analisado:** `53407a403a0f3f6ecc161d65632ae941585acf7d`

---

## 1. Como usar este checklist

Este documento é obrigatório durante toda a implementação. Antes de iniciar qualquer ação desta trilha:

1. ler `AGENTS.md` e o recorte **Bentevi em operação** do checklist central do Item 17;
2. confirmar branch `dev`, SHA e estado do Git;
3. executar somente a próxima ação liberada neste documento;
4. atualizar situação, evidências, testes e pendências ao terminar a ação;
5. não avançar enquanto o aceite da ação atual não estiver comprovado.

Regras permanentes:

- Uma ação técnica do Item 17 por tarefa.
- Planejado não significa concluído.
- Separar implementação, validação em DEV, publicação e aceite operacional.
- Não registrar credenciais, tokens, telefones completos, CNPJ completo ou chaves PIX.
- Não usar o banco produtivo para fixtures ou ensaios.
- Não executar backfill financeiro automático das compras existentes.
- Não alterar `main`, o aplicativo `mobile/` ou a TV comercial nesta trilha.
- Atualizar o checklist central somente com evidência real e resumida; os detalhes ficam aqui.
- Registrar `N/A` apenas com justificativa.
- Falha externa depois de um PIX confirmado não autoriza desfazer ou apagar a liquidação.

### Situações

| Situação | Significado |
|---|---|
| Pendente | Ainda não iniciada |
| Em andamento | Ação atual, ainda sem aceite |
| Bloqueado | Existe impedimento explícito registrado |
| Validado em DEV | Código e testes da ação passaram em `dev` |
| Publicado | Mesmo SHA validado foi promovido e publicado |
| Aceito | Comportamento e evidências da ação foram aprovados |

### Controle das ações

| Ordem | Ação | Situação | Dependência | Próximo gate |
|---:|---|---|---|---|
| 0 | ORC-00 — Contrato e checklist permanente | Validado em DEV | Nenhuma | Publicar e registrar a evidência final |
| 1 | ORC-01 — Schema aditivo | Pendente | ORC-00 aceito | Migration local sintética e compatibilidade |
| 2 | ORC-02 — Estados e elegibilidade | Pendente | ORC-01 aceito | Preview explica inclusões e exclusões |
| 3 | ORC-03 — Núcleo financeiro transacional | Pendente | ORC-02 aceito | Concorrência, idempotência e auditoria |
| 4 | ORC-04 — Pós-processamento e comunicação | Pendente | ORC-03 aceito | Jobs reprocessáveis sem duplicação |
| 5 | ORC-05 — Interfaces operacionais | Pendente | ORC-04 aceito | Compras, Vendas e Conta Corrente |
| 6 | ORC-06 — Cancelamentos e divergências | Pendente | ORC-05 aceito | Três cenários financeiros comprovados |
| 7 | ORC-07 — Ativação controlada | Pendente | ORC-06 aceito | Primeiro fechamento real acompanhado |
| 8 | ORC-08 — Dashboard resumido | Pendente | ORC-07 estabilizado | Aceite visual específico |

---

## 2. Contrato funcional aprovado

### Objetivo

Substituir dezenas de confirmações individuais por poucos fechamentos consolidados por fornecedor, sem misturar venda, fulfillment, etiqueta, obrigação financeira, pagamento e crédito.

O PIX pertence à liquidação. Cada compra recebe uma alocação auditável dentro dela.

### Decisões fechadas

- A liquidação consolidada será o fluxo padrão.
- A confirmação individual permanecerá como compatibilidade controlada e usará o mesmo núcleo.
- Somente compras comprovadamente prontas poderão entrar em uma liquidação.
- Dúvida, divergência ou dado incompleto exclui a compra; não haverá inferência otimista.
- O agrupamento financeiro será por CNPJ normalizado e chave PIX.
- Na primeira versão, uma conta financeira deverá corresponder a um único fornecedor operacional.
- BKR1 e MKS continuarão com contas, livros e PIX separados, mesmo compartilhando contato.
- A comunicação será agrupada por contato: uma mensagem poderá informar mais de uma liquidação, com separação explícita por CNPJ.
- A mensagem será gerada, revisada por uma pessoa e somente então enviada.
- O gestor escolherá quanto crédito usar, entre zero e o saldo confirmado disponível; o sistema sugerirá o máximo aplicável.
- Crédito pendente não reduz o PIX.
- Admin e gerente poderão preparar, cancelar, confirmar e comunicar.
- Operador e visualizador terão somente leitura.
- O comprovante será opcional e pertencerá à liquidação.
- Liquidação confirmada será imutável; correções financeiras usarão movimentos compensatórios auditáveis.
- A primeira fase alterará Compras, Vendas e Conta Corrente.
- Dashboard será posterior ao núcleo. A TV comercial não será alterada.
- Não haverá integração bancária ou execução automática de PIX nesta versão.
- O Oráculo não altera preço, margem ou outra regra do cânon comercial.

### Elegibilidade mínima

Uma compra somente poderá ser incluída quando todas as condições abaixo forem verdadeiras:

- pagamento `prepaid_pix` pendente;
- valor de pagamento conhecido e positivo;
- venda vinculada e ativa;
- compra não cancelada;
- etiqueta real disponível e entregue pelo fluxo operacional;
- abastecimento confirmado como `ready`;
- fornecedor com cadastro financeiro válido;
- nenhuma divergência financeira ou operacional aberta;
- nenhuma alocação em outra liquidação preparada ou confirmada.

O preview deverá apresentar separadamente as compras excluídas e o motivo objetivo de cada exclusão.

---

## 3. Fotografia do estado atual — ORC-00

### Fluxo implementado

- `compras` é a fonte da compra DSLite e guarda o pagamento individual.
- A rota individual de confirmação exige `purchases.payment.confirm`.
- O fluxo atual atualiza a compra, envia WhatsApp e pode retomar a DSLite no mesmo processamento HTTP.
- O comprovante é exigido pelo fluxo normal atual, salvo caminhos de retomada.
- BKR1 adia o PIX enquanto existe etiqueta provisória.
- Compras permite “Registrar PIX” individualmente.
- Vendas deriva ações como confirmar pagamento, enviar comprovante e retomar DSLite.
- A API usada pelo mobile delega à confirmação individual; o código em `mobile/` permanece fora do escopo.
- `supplier_balance_movements` controla créditos, ajustes e usos de crédito, com estados pendente/confirmado/rejeitado/anulado.
- Créditos de cancelamento são criados para venda cancelada e compra pré-paga já paga, mas o ponto exato do despacho ainda não impede todos os créditos automáticos.
- A infraestrutura persistente de jobs já possui deduplicação e recuperação e deverá ser reutilizada.
- Eventos operacionais de pagamento e WhatsApp já aparecem em `nf_auditoria_eventos`; a nova implementação não deve criar uma segunda trilha sem necessidade.

### Riscos confirmados

- A confirmação individual não é atômica para várias compras.
- Banco, WhatsApp e retomada DSLite estão acoplados e admitem falha parcial.
- Não existe cabeçalho de liquidação nem alocação de compras em um PIX consolidado.
- O modelo atual não distingue formalmente obrigação, liquidação e conta corrente.
- Etiqueta real/provisória e seu canal ainda não possuem contrato único persistido.
- Compras pendentes existentes incluem canceladas, etiquetas futuras, placeholders e casos sem venda ativa; não podem ser migradas em lote por suposição.
- CNPJ/chave PIX e telefone são dimensões diferentes e não podem usar o mesmo agrupamento.
- Existe identificador financeiro em migration histórica; não duplicar o valor e não reescrever o histórico nesta trilha.

### Leitura produtiva inicial, somente leitura

O levantamento de 16/09/2026 confirmou:

- banco alvo em `.162` e ausência das novas tabelas de liquidação;
- 13 fornecedores e 1.452 compras no momento da consulta;
- 22 compras pré-pagas pendentes, misturando casos ativos, cancelados e incompletos;
- BKR1 e MKS com contato compartilhado, mas CNPJ e chave PIX distintos;
- saldo confirmado existente para Vanral e créditos de outros fornecedores ainda dependentes do ledger atual;
- os casos 407678 e 407812 já mudaram desde a redação do briefing e serão cenários conceituais de teste, não fixtures copiadas da produção.

Esses números são fotografia datada, não condição fixa da implementação. ORC-01 deverá repetir o preflight antes de qualquer migration produtiva.

### Consumidores que exigem compatibilidade

- Página e APIs de Compras.
- Página, ações e projeção de leitura de Vendas.
- Fluxo de criação/retomada DSLite.
- Sincronização de pedidos DSLite.
- Conta Corrente/Créditos de fornecedores.
- Geração de PDFs de Compras e Vendas.
- Assistente Bentevi e sua projeção de leitura.
- API compartilhada consumida pelo mobile, sem alterar arquivos do aplicativo.
- Jobs, eventos de auditoria e templates de WhatsApp.

---

## 4. Contrato técnico mínimo

Os nomes abaixo ficam reservados para ORC-01 e seguintes. Qualquer alteração exige atualizar este documento antes de implementar.

### Persistência

`supplier_settlements` será o cabeçalho do fechamento e terá, no mínimo:

- fornecedor e conta financeira;
- fotografia de nome, CNPJ e chave PIX;
- estado `prepared`, `confirmed` ou `cancelled`;
- total bruto, crédito escolhido e PIX líquido;
- referência e comprovante opcionais;
- chave de idempotência e versão;
- ator e datas de preparação, confirmação e cancelamento.

`supplier_settlement_items` registrará:

- liquidação, compra e venda;
- fotografias dos identificadores e valores usados;
- valor bruto, crédito alocado e PIX alocado;
- vínculo ativo único por compra.

Extensões previstas:

- `compras`: vínculo com liquidação e estado de abastecimento;
- `pedidos`: `label_type`, `label_delivery_channel` e `label_delivered_at`;
- índices em todas as chaves estrangeiras e nos filtros operacionais reais;
- índice único parcial impedindo duas alocações ativas da mesma compra;
- checks de estado, valores não negativos e igualdade entre bruto, crédito e PIX.

`supplier_balance_movements` continuará como fonte dos créditos. As novas tabelas serão a fonte das obrigações e pagamentos consolidados; não haverá duplicação das obrigações no ledger.

### APIs previstas

- `GET /api/compras/liquidacoes/preview`
- `POST /api/compras/liquidacoes/preparar`
- `GET /api/compras/liquidacoes/[id]`
- `POST /api/compras/liquidacoes/[id]/confirmar`
- `POST /api/compras/liquidacoes/[id]/cancelar`
- `POST /api/compras/liquidacoes/[id]/comunicar`
- endpoint de gestão do estado de abastecimento

A rota individual existente se tornará um adaptador de liquidação com um item. Ela não poderá manter um segundo escritor financeiro.

### Concorrência e efeitos externos

- Preparar, confirmar e cancelar serão operações transacionais no banco.
- Conta, compras e créditos serão travados em ordem determinística.
- Toda elegibilidade será revalidada dentro da transação.
- Se um item mudar, o lote inteiro será rejeitado.
- Crédito será reservado em `prepared`, consumido em `confirmed` e liberado em `cancelled`.
- A distribuição do crédito escolhido será determinística, das compras mais antigas para as mais novas.
- Chamadas DSLite e WhatsApp ficarão fora da transação.
- A confirmação criará atomicamente um job de pós-processamento.
- Serão reutilizados os jobs persistentes existentes, com os tipos `supplier_settlement_postprocess` e `supplier_settlement_communication`.
- Repetição da requisição ou do job não poderá duplicar pagamento, retomada ou mensagem.

---

## 5. Ações e critérios de aceite

### ORC-00 — Contrato e checklist permanente

- [x] Analisar o briefing e separar venda, fulfillment, etiqueta, obrigação, liquidação e crédito.
- [x] Cruzar o briefing com código, migrations, documentação e dados produtivos somente leitura.
- [x] Registrar decisões funcionais aprovadas pelo responsável.
- [x] Registrar riscos, consumidores e limites da primeira versão.
- [x] Definir ordem, gates, testes e recuperação.
- [x] Criar este checklist permanente.
- [x] Validar referências e `git diff --check`.
- [ ] Commitar e enviar a ação em `dev`.
- [ ] Promover o mesmo SHA para `bentevi-prod`.
- [ ] Registrar evidência final e mudar ORC-00 para `Aceito`.

**Não inclui:** migration, código funcional, escrita no banco ou ativação. A publicação documental segue o fluxo normal do Bentevi.

### ORC-01 — Schema aditivo

- [ ] Repetir a inspeção do schema atual em `.162`, sem escrita.
- [ ] Conferir funções, triggers, RLS, grants, índices e consumidores das tabelas afetadas.
- [ ] Criar uma única migration idempotente e aditiva.
- [ ] Criar tabelas, colunas, checks, FKs e índices definidos no contrato.
- [ ] Aplicar privilégio mínimo: sem escrita direta para `anon`/`authenticated`; acesso pelo servidor autorizado.
- [ ] Não classificar ou migrar compras existentes automaticamente.
- [ ] Ensaiar no DEV local com dados sintéticos.
- [ ] Provar que o código antigo funciona com as novas colunas vazias.
- [ ] Documentar recuperação antes de liquidações confirmadas.
- [ ] Executar preflight, backup proporcional, migration em `.162` e read-back.
- [ ] Registrar migration, SHA, alvo e evidências.

**Aceite:** schema aditivo publicado sem alterar o fluxo financeiro existente.

### ORC-02 — Estados e elegibilidade

- [ ] Criar fonte única da elegibilidade.
- [ ] Persistir e projetar etiqueta provisória/real, canal e entrega.
- [ ] Implementar abastecimento `unknown`, `ready`, `blocked` e `cancelled`.
- [ ] Restringir alteração manual a admin/gerente.
- [ ] Implementar preview por conta financeira.
- [ ] Exibir cada exclusão com motivo determinístico.
- [ ] Classificar compras pendentes individualmente; manter dúvida em `unknown`.
- [ ] Não inferir `ready` de texto livre, ausência de erro ou status DSLite ambíguo.

**Aceite:** preview inclui somente compras comprovadamente prontas e explica todas as exclusões.

### ORC-03 — Núcleo financeiro transacional

- [ ] Implementar preparação, reserva de crédito, confirmação e cancelamento.
- [ ] Sugerir crédito máximo, permitindo escolher de zero ao disponível.
- [ ] Registrar fotografias dos dados financeiros e operacionais.
- [ ] Aplicar locks em ordem estável e manter transações curtas.
- [ ] Revalidar estado dentro da transação.
- [ ] Implementar idempotência e restrições contra alocação duplicada.
- [ ] Tornar liquidação confirmada imutável.
- [ ] Adaptar a confirmação individual ao mesmo núcleo.
- [ ] Preservar o contrato da API compartilhada usada pelo mobile.
- [ ] Atualizar projeções e relatórios que leem pagamento individual.

**Aceite:** concorrência e repetição não duplicam compra, crédito ou PIX; totais fecham no banco.

### ORC-04 — Pós-processamento e comunicação

- [ ] Criar os dois tipos de job usando a infraestrutura existente.
- [ ] Enfileirar pós-processamento na mesma transação da confirmação.
- [ ] Retomar DSLite de forma idempotente.
- [ ] Gerar comunicação consolidada por contato e separada por CNPJ.
- [ ] Exigir revisão humana antes do envio.
- [ ] Registrar envio, falha, tentativa e reprocessamento.
- [ ] Não desfazer o financeiro por falha externa.
- [ ] Impedir mensagens e retomadas duplicadas.

**Aceite:** falhas de DSLite/WhatsApp ficam visíveis e reprocessáveis sem duplicar efeitos.

### ORC-05 — Interfaces operacionais

- [ ] Adicionar “Liquidação de hoje” e “Fechar pagamentos” em Compras.
- [ ] Mostrar grupos, bruto, crédito sugerido/escolhido, PIX e exceções.
- [ ] Permitir comprovante opcional no fechamento.
- [ ] Exigir confirmação humana do PIX.
- [ ] Mostrar liquidação e estado financeiro em Vendas, sem misturar logística.
- [ ] Evoluir Conta Corrente com créditos, reservas, usos, liquidações e ajustes.
- [ ] Exibir saldo contábil e saldo reconciliado.
- [ ] Aplicar permissões também nas APIs.
- [ ] Atualizar PDFs e Assistente quando consumirem os campos afetados.

**Aceite:** uma tela responde quanto pagar por CNPJ, itens incluídos/excluídos, créditos, etiquetas e exceções.

### ORC-06 — Cancelamentos e divergências

- [ ] Antes do pagamento: invalidar obrigação e remover elegibilidade.
- [ ] Depois do pagamento e antes do despacho: criar crédito pendente para análise.
- [ ] Depois do despacho: não criar crédito automaticamente.
- [ ] Bloquear divergências até decisão explícita.
- [ ] Usar movimento compensatório com referência à origem.
- [ ] Não apagar ou editar liquidação confirmada.

**Aceite:** os três momentos do cancelamento produzem resultados distintos e auditáveis.

### ORC-07 — Ativação controlada

- [ ] Criar flag de ativação inicialmente desligada.
- [ ] Publicar mantendo o fluxo atual como padrão.
- [ ] Fazer smoke sem pagamentos fictícios.
- [ ] Ativar para um fechamento real pequeno e acompanhado.
- [ ] Conferir banco, compra, venda, crédito, job, DSLite e mensagem.
- [ ] Tornar lote o padrão somente depois do aceite do canário.
- [ ] Manter confirmação individual como exceção identificada.
- [ ] Monitorar os primeiros sete dias e pelo menos um ciclo completo.

**Aceite:** operação diária consolidada sem perda de rastreabilidade ou dupla execução.

### ORC-08 — Dashboard resumido

- [ ] Definir resumo pequeno a partir do núcleo estabilizado.
- [ ] Não duplicar a torre operacional de Compras.
- [ ] Obter aceite visual específico.
- [ ] Manter TV comercial inalterada.

---

## 6. Matriz mínima de testes

### Elegibilidade

- [ ] Compra pronta incluída.
- [ ] Etiqueta provisória excluída.
- [ ] Etiqueta real ainda não entregue excluída.
- [ ] Abastecimento `unknown` ou `blocked` excluído.
- [ ] Venda cancelada excluída.
- [ ] Valor ausente, zero ou divergente excluído.
- [ ] Compra já alocada excluída.

### Financeiro

- [ ] Várias compras do mesmo CNPJ/chave geram um fechamento.
- [ ] BKR1 e MKS geram dois PIX e uma comunicação revisável.
- [ ] Crédito confirmado parcial e integral.
- [ ] Crédito pendente não reduz PIX.
- [ ] Crédito acima do disponível é rejeitado.
- [ ] Cancelar preparação libera compras e reserva.
- [ ] Liquidação confirmada não aceita edição ou cancelamento.
- [ ] Comprovante ausente não bloqueia a confirmação.
- [ ] Totais usam `numeric`, sem ponto flutuante.

### Concorrência e integração

- [ ] Dois gestores preparando as mesmas compras.
- [ ] Repetição da preparação e confirmação.
- [ ] Compra alterada entre preview e preparação.
- [ ] Falha DSLite depois do PIX.
- [ ] Falha WhatsApp e reprocessamento.
- [ ] Job repetido não duplica efeito.
- [ ] Rota individual mantém compatibilidade usando o novo núcleo.

### Cancelamento e acesso

- [ ] Cancelamento antes do pagamento.
- [ ] Cancelamento depois do pagamento e antes do despacho.
- [ ] Cancelamento depois do despacho.
- [ ] Admin e gerente escrevem.
- [ ] Operador e visualizador somente leem.
- [ ] Chamador sem permissão é rejeitado no servidor e no banco.

### Validação por ação

- [ ] Testes direcionados primeiro.
- [ ] `npm run validate` para código web.
- [ ] `npm run build` para runtime/configuração sensível.
- [ ] `git diff --check` em todas as ações.
- [ ] Migrations e testes de banco somente no DEV local com dados sintéticos antes da publicação.
- [ ] Smoke e read-back produtivos proporcionais à mudança.

---

## 7. Publicação, monitoramento e recuperação

### Publicação obrigatória

Para cada ação técnica:

1. validar na branch `dev`;
2. commit e push somente dos arquivos da ação;
3. confirmar SHA remoto de `dev`;
4. promover esse SHA por fast-forward para `bentevi-prod`;
5. comprovar o alvo `.162` antes de qualquer escrita;
6. aplicar apenas a migration da ação, quando houver;
7. publicar em `local/bentevi-prod` quando houver mudança de runtime;
8. conferir SHA executado, health, comportamento e read-back;
9. registrar evidências neste documento.

### Monitoramento

- Liquidações `prepared` antigas.
- Reservas de crédito sem liquidação ativa.
- Jobs falhos, `on_hold` ou repetidos.
- Liquidações confirmadas com pós-processamento pendente.
- Compras com elegibilidade desconhecida.
- Divergências de totais ou tentativas idempotentes rejeitadas.

### Recuperação

- Antes de existir liquidação confirmada: desligar a flag, cancelar preparações e reverter código; manter schema aditivo.
- Depois de existir liquidação confirmada: bloquear novos fechamentos e corrigir progressivamente.
- Nunca restaurar backup cegamente, apagar pagamento ou voltar para `main`.
- Reprocessar efeitos externos pelos jobs sem alterar a confirmação financeira.

---

## 8. Registro de evidências

| Data | Ação | SHA/migration | Validação | Resultado e pendência |
|---|---|---|---|---|
| 16/09/2026 | ORC-00 | Base `53407a403a` | Referências, `git diff --check` e 34 testes de `tests/assistant-chat.test.js` | Checklist validado em DEV; commit e publicação ainda pendentes |

## 9. Próxima ação permitida

Concluir somente **ORC-00**: validar este documento, registrar o commit publicado e mudar seu estado para `Aceito`.

Somente uma nova tarefa poderá iniciar **ORC-01 — Schema aditivo**.
