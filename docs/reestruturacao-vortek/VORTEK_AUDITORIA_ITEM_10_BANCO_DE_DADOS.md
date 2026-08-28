# Vortek — Auditoria de Limpeza e Organização

## Item 10 — Banco de Dados

**Status:** Concluído  
**Branch analisada:** `dev`  
**Atualizado em:** `2026-08-27`  
**Observação:** o P0 de autorização identificado no Item 9 permanece aberto.  
**Objetivo:** mapear tabelas por domínio, identificar fontes de verdade, separar dados canônicos de snapshots/derivações, revisar redundâncias, relacionamentos, índices, constraints, migrations, RLS/grants e distinguir históricos necessários de estruturas candidatas à limpeza.

---

## 1. Conclusão executiva

O banco do Vortek **não precisa ser redesenhado**.

A parte central possui uma estrutura coerente:

```text
produtos
→ ofertas de fornecedor
→ pedidos / itens
→ compras
→ estoque interno
→ anúncios
→ fiscal
→ financeiro
```

Há bons exemplos de modelagem já existentes:

- chaves estrangeiras em relações centrais;
- ledger de estoque interno;
- ledger financeiro de fornecedores;
- outbox Mercado Livre;
- locks por domínio;
- filas duráveis;
- views em vez de duplicar dados consolidados;
- snapshots externos separados do estado interno;
- constraints de quantidade/status em domínios importantes;
- índices voltados aos fluxos reais.

A dívida principal está nas **bordas evolutivas**:

1. campos derivados e históricos acumulados em tabelas grandes;
2. nomenclaturas/estados diferentes para o mesmo conceito;
3. tabelas criadas para auditorias/campanhas pontuais que continuam no schema;
4. tabelas de eventos aparentemente não adotadas;
5. configuração comum e secrets misturados;
6. RLS/grants aplicados de forma não uniforme em migrations posteriores;
7. short links sensíveis sem expiração;
8. migrations antigas descrevendo constraints que já não correspondem claramente ao estado operacional atual.

### Classificação geral

**P0**
- nenhum novo P0 de banco além do P0 de `profiles.cargo` já registrado no Item 9.

**P1**
- secrets operacionais misturados em `sync_runtime_config`;
- short links de documentos sensíveis persistidos sem expiração;
- P0 de autorização do Item 9 continua diretamente ligado ao banco.

**P2**
- tabelas de campanha `ml_p0_*` provavelmente temporárias/históricas;
- `whatsapp_alert_events` aparentemente não adotada;
- `ops_whatsapp_events` aparentemente histórica;
- `nf_auditoria_eventos` virou auditoria transversal, apesar do nome fiscal;
- estados de `jobs` não são uniformes;
- campos fiscais/operacionais sobrepostos em `pedidos`;
- identidade final de oferta precisa ser confirmada no schema operacional;
- disciplina de RLS/grants precisa virar uma regra verificável;
- `short_links` acumula registros de destino temporário sem retenção clara.

A limpeza futura deve **preservar o núcleo e podar os resíduos de evolução**.

---

# 2. Mapa de tabelas por domínio

## Auth / empresa / configuração

```text
profiles
empresa
configuracoes
integracoes
sync_runtime_config
```

## Produtos / fornecedores

```text
produtos
fornecedores
produto_fornecedor_ofertas
produto_kits
produto_kit_componentes
```

## Pedidos / clientes

```text
pedidos
pedido_itens
clientes
pedidos_operacionais   -- VIEW
```

## Estoque interno

```text
estoque_interno_movimentacoes
```

## Compras / financeiro

```text
compras
supplier_balance_movements
mercadopago_account_movements
```

## Mercado Livre

```text
anuncios_ml
anuncios_ml_outbox
catalogo_ml_snapshot
catalogo_ml_refresh_items
ml_manual_blocklist
```

## Jobs / automação

```text
jobs
sync_domain_locks
sync_runtime_config
```

## Fiscal / auditoria

```text
pedidos                    -- campos fiscais
pedido_itens               -- snapshot fiscal dos itens
nf_auditoria_eventos
```

## Comunicação / operação

```text
short_links
ops_whatsapp_events
whatsapp_alert_events
whatsapp_alert_settings
```

## Referência

```text
municipios_ibge
```

## Auditorias/campanhas específicas Mercado Livre

```text
ml_p0_population_snapshots
ml_p0_publication_audits
ml_p0_sanitize_runs
ml_p0_sanitize_results
ml_p0_phase3_runs
ml_p0_phase3_results
ml_p0_phase3_remote_items
```

---

# 3. Fonte de verdade — produtos

A fonte mestre do produto continua sendo:

```text
produtos
```

com:

```text
SKU VTK
```

As ofertas externas pertencem a:

```text
produto_fornecedor_ofertas
```

### Regra conceitual

```text
produtos
= identidade e dados canônicos do Vortek

produto_fornecedor_ofertas
= dados específicos de cada fonte externa
```

### Avaliação

**Manter.**

Não transformar cada oferta externa em produto independente.

---

# 4. Snapshot da oferta preferencial em `produtos`

Como já confirmado no Item 3, campos como:

```text
custo
estoque
fornecedor
dslite_fornecedor_id
dslite_produto_id
```

em `produtos` representam a **projeção operacional da oferta preferencial**.

A fonte das ofertas individuais é:

```text
produto_fornecedor_ofertas
```

### Avaliação

**Duplicação intencional.**

Não remover os campos apenas por existir informação parecida em ofertas.

A regra futura deve ser:

```text
oferta
→ fonte
produto
→ snapshot derivado
```

e nenhum código deve tratá-los como duas fontes independentes.

---

# 5. Atributos descritivos produto x oferta

A oferta também pode guardar:

- nome;
- descrição;
- marca;
- imagens;
- GTIN;
- NCM;
- CEST.

Isso preserva informação recebida da fonte externa.

### Direção conceitual

```text
produto
= valor canônico escolhido pelo Vortek

oferta
= valor recebido/específico daquela fonte
```

### Avaliação

**P2 — deixar ownership explícita antes de remover qualquer coluna.**

---

# 6. Identidade de uma oferta — divergência a confirmar

A migration inicial de múltiplos fornecedores criou, entre outras, uma restrição baseada em:

```text
produto_id + dslite_fornecedor_id
```

Porém a consulta operacional realizada no Item 3 encontrou produtos com mais de uma oferta do mesmo fornecedor, diferenciadas por identificadores/SKUs externos.

### Conclusão

O modelo evoluiu além da constraint inicial analisada.

### Avaliação

**P2 — confirmar o schema operacional real antes de qualquer alteração.**

O plano de execução deve começar com uma fotografia de:

```text
pg_constraint
pg_indexes
```

para essa tabela.

Não deduplicar linhas apenas porque uma migration antiga sugere uma identidade mais simples.

---

# 7. Kits

O modelo:

```text
produto_kits
produto_kit_componentes
```

é normalizado e simples.

Cada componente:

- referencia produto mestre;
- possui quantidade positiva;
- impede autorreferência direta.

### Fonte de verdade

```text
produto_kit_componentes
```

define composição.

Custo e estoque do SKU do kit são derivados.

### Avaliação

**Manter.**

Não criar estoque independente de kit.

---

# 8. Estoque interno

A fonte de verdade é o ledger:

```text
estoque_interno_movimentacoes
```

O saldo é derivado das movimentações válidas.

### Avaliação

**Manter.**

Não criar um segundo campo de saldo físico como fonte concorrente.

---

# 9. P2 — estados sobrepostos no estoque interno

O Item 2 confirmou sobreposição entre:

```text
situacao_estoque
disponivel_venda
```

A disponibilidade real já depende principalmente do estado da movimentação.

### Avaliação

**P2 — consolidar semântica futura.**

Não remover campo enquanto existirem consumidores.

---

# 10. Pedidos como snapshot operacional

`pedidos` concentra muitos dados porque representa uma venda externa que precisa continuar operável mesmo se APIs externas estiverem indisponíveis.

Mantém snapshots de:

- comprador;
- cobrança;
- shipment;
- fiscal;
- pagamento;
- fulfillment;
- claims;
- bundle;
- integração DSLite.

### Avaliação

**A existência do snapshot é necessária.**

Uma tabela grande não é, por si só, sinal de modelagem errada.

Separar tudo em dezenas de tabelas aumentaria o custo de entender o pedido.

---

# 11. `pedidos_operacionais` não é duplicação

`pedidos_operacionais` é uma:

```text
VIEW
```

que consolida pedidos/bundles/carrinhos para visão operacional.

Ela deriva dados de:

```text
pedidos
```

e não mantém uma segunda cópia independente.

### Avaliação

**Manter.**

É um bom exemplo de usar projeção em vez de duplicar estado.

---

# 12. P2 — campos fiscais sobrepostos em `pedidos`

Os Itens 5 e 9 já apontaram campos que precisam de semântica clara:

```text
nfe_status
nota_fiscal_emitida
nfe_external_id
ml_invoice_reported
ml_invoice_id
nfe_danfe_url
```

### Direção conceitual

Fonte forte da NF-e:

```text
nfe_status
+
nfe_chave
+
nfe_xml
+
nfe_protocolo
```

Outros campos devem ser classificados como:

```text
derivados
compatibilidade
cache
histórico
```

### Avaliação

**P2 — não apagar antes de mapear leitores/escritores.**

---

# 13. `pedido_itens`

`pedido_itens` preserva o snapshot dos produtos efetivamente vendidos, inclusive:

- SKU;
- quantidade;
- preço;
- dados fiscais usados na operação.

### Avaliação

**Manter.**

Um pedido histórico não deve depender do estado atual de `produtos` para reconstruir o que foi vendido.

---

# 14. Compras

`compras` representa uma operação diferente de `pedidos`.

Ela guarda:

- DSID;
- fornecedor;
- destinatário;
- item;
- quantidade;
- estados DSLite;
- pagamento do fornecedor.

### Avaliação

**Manter separada.**

Pedido de venda e pedido de compra não devem ser fundidos.

---

# 15. P2 — semântica financeira de `compras`

Como identificado no Item 6:

```text
valor_total
```

e:

```text
supplier_payment_amount
```

não possuem significado suficientemente óbvio pelo nome.

### Avaliação

**P2 — esclarecer antes de alterar schema.**

A fonte do valor devido ao fornecedor precisa ser única e documentada.

---

# 16. Ledger financeiro do fornecedor

A fonte de verdade para saldo/crédito do fornecedor é:

```text
supplier_balance_movements
```

O banco já aceita tipos como:

```text
topup
purchase_debit
adjustment
manual_credit
cancellation_credit
credit_usage
```

e possui constraints de sinal/status.

### Avaliação

**Manter um único ledger.**

O problema encontrado no Item 6 está no TypeScript desatualizado, não na necessidade de outra tabela.

---

# 17. Mercado Pago x ledger de fornecedor

```text
mercadopago_account_movements
```

é o espelho/importação do movimento financeiro externo.

```text
supplier_balance_movements
```

é o ledger operacional do Vortek.

### Avaliação

**Manter separados.**

A ligação entre os dois preserva auditoria.

Não fundir movimento bruto externo com movimento contábil interno.

---

# 18. `anuncios_ml`

É o estado operacional local do anúncio Mercado Livre.

Mantém:

- item;
- SKU;
- preço;
- status;
- catálogo;
- métricas;
- bloqueios.

### Avaliação

**Manter.**

Não é a mesma coisa que catálogo ou outbox.

---

# 19. `catalogo_ml_snapshot`

É uma fotografia do estado externo de catálogo/Buy Box.

Possui:

- preço;
- `price_to_win`;
- estado de competição;
- vínculo de catálogo;
- timestamps.

Há índices adequados para:

- seller/status;
- Buy Box;
- preço;
- busca textual.

### Avaliação

**Snapshot necessário.**

Não fundir com `anuncios_ml`.

---

# 20. `anuncios_ml_outbox`

Representa:

```text
estado desejado / mudança pendente
```

e não:

```text
estado observado
```

Possui:

- tentativas;
- disponibilidade para retry;
- processamento;
- payload desejado.

### Avaliação

**Manter.**

É parte central da confiabilidade Mercado Livre.

---

# 21. `sync_domain_locks`

Representa coordenação temporária entre processos.

Não é estado de negócio.

### Avaliação

**Manter.**

Não substituir por infraestrutura externa sem necessidade.

---

# 22. `catalogo_ml_refresh_items`

É o manifesto durável de um refresh grande.

Possui:

```text
job_id + ml_item_id
```

como chave e referência ao job.

### Avaliação

**Manter.**

Não há evidência de bloat descontrolado suficiente para remover.

A política de retenção de jobs/manifestos deve ser medida no Item 13/15.

---

# 23. Jobs — schema flexível demais

`jobs.status` não possui uma linguagem única de estados.

A consulta operacional confirmou simultaneamente:

```text
completo
concluido
```

em famílias diferentes.

Também existem:

```text
pendente
rodando
on_hold
erro
```

### Problema

Um consumidor genérico precisa conhecer vocabulários de diferentes gerações.

### Avaliação

**P2 — padronizar domínio de status posteriormente.**

Não aplicar uma constraint nova sem primeiro mapear todos os writers, jobs históricos e rotas.

---

# 24. `processados` e `total`

Como identificado no Item 7:

```text
1 / 1
```

em alguns jobs significa:

```text
uma etapa terminou
```

enquanto em outros significa volume real de registros.

### Avaliação

**P2 — semântica de observabilidade, não necessariamente schema errado.**

Primeiro definir o contrato dos jobs antes de alterar colunas.

---

# 25. `nf_auditoria_eventos`

A tabela nasceu como auditoria fiscal/Mercado Livre.

Hoje armazena eventos de:

- NF-e;
- webhooks;
- WhatsApp;
- pagamento;
- alertas;
- operações diversas.

### Avaliação

**P2 — nome e domínio não correspondem mais ao uso real.**

Não criar imediatamente uma nova tabela de eventos.

No Item 12/15 decidir se:

```text
a tabela vira auditoria operacional genérica
```

ou se parte do conteúdo é histórico e pode ser eliminado.

---

# 26. `whatsapp_alert_events`

A tabela foi criada para eventos de alertas.

### Estado operacional

Consulta somente leitura atual:

```text
0 registros
```

O caminho atual de alertas grava em:

```text
nf_auditoria_eventos
```

### Avaliação

**P2 — forte candidata a tabela não adotada.**

Confirmar todos os leitores/escritores no Item 15 antes da remoção.

---

# 27. `ops_whatsapp_events`

A tabela possui dados reais de comandos operacionais via WhatsApp.

### Estado operacional

Os registros mais recentes encontrados são de:

```text
22/06/2026
```

e o Item 8 não encontrou endpoint inbound WAHA atual no web.

### Avaliação

**P2 — forte candidata a histórico.**

Não remover enquanto não forem verificados scripts/serviços externos.

---

# 28. Tabelas `ml_p0_*`

Foram criadas várias estruturas específicas para uma auditoria/campanha Mercado Livre:

```text
ml_p0_population_snapshots
ml_p0_publication_audits
ml_p0_sanitize_runs
ml_p0_sanitize_results
ml_p0_phase3_runs
ml_p0_phase3_results
ml_p0_phase3_remote_items
```

Essas migrations possuem regras e números de baseline específicos daquela operação.

### Estado operacional

Na tabela de jobs foi encontrada uma execução:

```text
ml_p0_premium_audit
```

em:

```text
15/08/2026
```

processando:

```text
501 / 501
```

Não foram encontrados novos jobs desse tipo na consulta realizada.

### Avaliação

**P2 — provável estrutura especial/histórica.**

Ainda é recente demais para apagar por suposição.

No Item 15 deve ser confirmado se:

- algum código ainda lê/escreve;
- algum relatório depende delas;
- a campanha foi encerrada;
- os dados precisam ser arquivados.

Se não houver função operacional, são fortes candidatas a remoção do schema ativo.

---

# 29. Migrations históricas não são “lixo” automaticamente

O repositório contém migrations de:

- reparos pontuais;
- backfills;
- correções de dados;
- campanhas;
- criação e posterior remoção de estruturas temporárias.

### Importante

Uma migration já aplicada é parte da história de implantação.

### Avaliação

**Não apagar/squashar migrations aplicadas apenas para deixar a pasta bonita.**

A limpeza deve se concentrar em:

```text
objetos atuais sem função
+
scripts/documentação antigos
```

e não em destruir o histórico de schema.

---

# 30. Exemplo positivo — fila manual removida

O histórico possui uma migration criando uma fila de revisão manual de catálogo e outra posterior removendo-a quando deixou de ser necessária.

### Avaliação

Isso demonstra uma direção saudável:

```text
estrutura temporária
→ cumpre finalidade
→ confirmação de obsolescência
→ remoção explícita
```

Esse deve ser o padrão para `ml_p0_*`, WhatsApp legado e outros candidatos.

---

# 31. `short_links`

A tabela possui:

- código;
- destino;
- propósito;
- metadata;
- `expires_at`;
- contadores de acesso.

O schema já suporta expiração.

### Estado operacional

A consulta atual encontrou dezenas de links recentes para:

```text
XML
DANFE
etiqueta
comprovante de fornecedor
```

e os registros amostrados estavam com:

```text
expires_at = null
```

### Avaliação

**P1 de segurança já identificado no Item 9.**

O problema não é ausência de suporte no banco.

O caller não utiliza o recurso existente de expiração.

---

# 32. P2 — churn/retenção de `short_links`

Muitos registros são criados em grupos, frequentemente para documentos temporários.

Como o destino pode conter URL temporária diferente, o código determinístico por:

```text
purpose + targetUrl
```

não necessariamente reutiliza o mesmo short link do documento em execuções posteriores.

### Resultado

Pode ocorrer:

```text
novo target temporário
→ novo short link
→ expires_at null
→ registro permanece
```

### Avaliação

**P2 — definir retenção/identidade no Item 13/15.**

Não otimizar sem medir volume total.

---

# 33. `sync_runtime_config`

A tabela contém configuração mutável de runtime.

O schema:

- habilita RLS;
- possui policy `false`;
- é acessado por funções `SECURITY DEFINER`;
- é utilizado por jobs/crons internos.

### Avaliação

O conceito de configuração runtime é válido.

---

# 34. P1 — secrets misturados em `sync_runtime_config`

A consulta operacional somente leitura confirmou que a tabela contém, ao mesmo tempo:

```text
estado runtime comum
+
segredos operacionais
+
URLs de integração com informação credenciada
```

Nenhum valor foi reproduzido nesta auditoria.

### Proteção atual

A migration possui:

```text
RLS deny-all
```

para acesso normal do Data API.

Portanto, **não foi comprovada exposição pública direta dessa tabela**.

### Problema

Secrets ficam misturados a configuração comum em texto armazenado no banco e disponíveis para caminhos privilegiados/backups.

### Avaliação

**P1 — separar secret material de configuração comum.**

Na execução futura, confirmar primeiro qual solução de secrets está disponível no Supabase self-hosted do Vortek:

```text
environment/runtime secret store
ou
Supabase Vault, se suportado/configurado
```

Não criar solução própria de criptografia.

A documentação oficial do Supabase oferece Vault para armazenamento criptografado de secrets, mas sua disponibilidade no ambiente self-hosted deve ser confirmada antes de qualquer plano.

---

# 35. `integracoes`

A tabela de integrações também contém credenciais/tokens das plataformas.

Isso é esperado para algumas integrações, mas exige tratamento como tabela altamente sensível.

### Item 9

Já foi identificado que:

```text
/api/integracoes/config
```

devolve secrets ao navegador admin.

### Avaliação

**Não duplicar credenciais em outras tabelas/configs.**

A correção de exposição fica no Item 9/12.

---

# 36. Hardening do Data API

A migration de hardening:

- habilitou RLS nas tabelas então existentes;
- removeu grants de `anon/authenticated`;
- concedeu acesso privilegiado ao `service_role`;
- removeu policies públicas antigas;
- alterou default privileges do papel configurado.

### Avaliação

**Boa base.**

O Vortek adota corretamente a direção:

```text
browser
→ API Next.js
→ backend privilegiado
→ banco
```

O risco é esse modelo depender fortemente da autorização correta das APIs.

---

# 37. P2 — RLS não é aplicada uniformemente nas migrations posteriores

Depois do hardening:

- várias tabelas novas habilitam RLS explicitamente;
- algumas migrations novas não possuem `ENABLE ROW LEVEL SECURITY`.

Exemplos de estruturas que precisam confirmação operacional incluem tabelas de eventos WhatsApp.

### Importante

Os default privileges podem impedir acesso de `anon/authenticated`.

Portanto:

```text
migration sem ENABLE RLS
```

não prova, isoladamente:

```text
tabela exposta
```

### Avaliação

**P2 — transformar segurança do schema em invariant verificável.**

No plano futuro, validar no banco real:

```text
relrowsecurity
grants
policies
default privileges
```

para toda tabela no schema exposto.

A documentação oficial do Supabase recomenda RLS para tabelas em schemas expostos.

---

# 38. `profiles` — P0 carregado do Item 9

O hardening preservou:

```text
SELECT
UPDATE
```

para o próprio perfil.

Como `cargo` está na mesma linha, o usuário pode potencialmente modificar um campo de autorização.

### Avaliação

**P0 permanece aberto.**

O Item 10 não altera sua prioridade.

---

# 39. Policies de kits

As policies possuem nomes indicando administração, mas a condição analisa apenas o papel PostgreSQL autenticado.

### Avaliação

**P2 de segurança/schema já registrado no Item 9.**

Mesmo que grants atuais impeçam acesso, policy e intenção precisam ser coerentes.

---

# 40. Índices e constraints — pontos positivos

Foram identificados bons exemplos:

## Ofertas
- FKs para produto;
- índices por produto/fornecedor;
- identificadores externos;
- constraints de identidade em migrations.

## Kits
- PK composta nos componentes;
- FK para produto;
- quantidade positiva;
- proteção contra autorreferência.

## Catálogo
- unique por `ml_item_id`;
- índices por seller/status;
- Buy Box;
- preço;
- busca.

## Jobs
- unique parcial por:

```text
tipo + dedupe_key
```

para jobs ativos da hidratação ML.

## Financeiro
- checks de tipo/status;
- restrições de sinal;
- índices de consulta.

## Catálogo durável
- PK:

```text
job_id + ml_item_id
```

- FK com cascade;
- índice de itens pendentes.

### Avaliação

**Preservar.**

O banco já contém várias proteções que evitam depender apenas do código da aplicação.

---

# 41. Constraints flexíveis em domínios evolutivos

Nem todos os domínios usam enum/check rígido.

`jobs.status` é o exemplo mais evidente.

### Vantagem histórica

Facilitou evolução rápida.

### Custo atual

Permitiu vocabulários concorrentes.

### Avaliação

**Não adicionar checks retroativamente sem limpeza prévia.**

Primeiro:

```text
mapear valores
normalizar writers
migrar dados
só depois restringir
```

---

# 42. Snapshots necessários

Devem ser preservados:

```text
pedido_itens
dados fiscais do pedido
dados do comprador no pedido
catalogo_ml_snapshot
anuncios_ml
mercadopago_account_movements
```

### Motivo

Representam:

```text
estado externo observado
ou
estado histórico necessário
```

e não meras cópias evitáveis.

---

# 43. Históricos necessários

Devem permanecer auditáveis:

```text
estoque_interno_movimentacoes
supplier_balance_movements
nf_auditoria_eventos   -- enquanto for a trilha operacional atual
jobs/log
```

### Princípio

Não apagar histórico para “limpar”.

A limpeza deve eliminar:

```text
estrutura sem função
estado redundante
dados transitórios sem retenção
```

sem destruir rastreabilidade.

---

# 44. Candidatos fortes a simplificação/remoção futura

Somente após confirmação no Item 15:

```text
whatsapp_alert_events
ops_whatsapp_events
ml_p0_*
```

Além disso, campos candidatos a consolidação:

```text
pedidos.ml_invoice_reported
pedidos.ml_invoice_id
pedidos.nota_fiscal_emitida
estoque_interno_movimentacoes.disponivel_venda
```

### Importante

**Nenhum deles está autorizado para remoção neste Item 10.**

Ainda faltam leitores/escritores, interface e histórico.

---

# 45. Fontes de verdade consolidadas

| Dado | Fonte principal |
|---|---|
| Produto | `produtos` |
| SKU mestre | `produtos.sku` |
| Oferta externa | `produto_fornecedor_ofertas` |
| Oferta preferencial | `oferta_preferencial_id` + regra compartilhada |
| Composição de kit | `produto_kit_componentes` |
| Estoque interno | ledger `estoque_interno_movimentacoes` |
| Pedido | `pedidos` |
| Itens vendidos | `pedido_itens` |
| Compra DSLite | `compras` |
| Saldo/crédito fornecedor | `supplier_balance_movements` |
| Movimento bruto Mercado Pago | `mercadopago_account_movements` |
| Anúncio ML observado | `anuncios_ml` |
| Mudança desejada ML | `anuncios_ml_outbox` |
| Catálogo/Buy Box | `catalogo_ml_snapshot` |
| Job | `jobs` |
| Lock de sync | `sync_domain_locks` |
| NF-e | `nfe_status` + chave + XML + protocolo no pedido |
| Auditoria operacional atual | `nf_auditoria_eventos` |
| Município fiscal | `municipios_ibge` |

---

# 46. P1/P2/P3 consolidados do Item 10

## P1 — secrets em runtime config

`sync_runtime_config` mistura secret material e configuração comum.

Direção:

```text
separar
+
usar secret store já suportado
+
não inventar criptografia
```

---

## P1 — short links sensíveis sem expiração

O banco já possui `expires_at`, mas os links operacionais amostrados estão sem prazo.

---

## P2 — tabelas `ml_p0_*` especiais

Provável resíduo de campanha/auditoria concluída.

Confirmar Item 15.

---

## P2 — `whatsapp_alert_events`

Tabela vazia e não utilizada pelo caminho atual observado.

---

## P2 — `ops_whatsapp_events`

Sem atividade recente; provável histórico.

---

## P2 — auditoria fiscal virou genérica

`nf_auditoria_eventos` precisa ter função/nome consolidado.

---

## P2 — estados de jobs divergentes

`completo` e `concluido` coexistem.

---

## P2 — campos derivados/legados de pedido

Especialmente ciclo fiscal/vínculo de invoice.

---

## P2 — identidade final de ofertas precisa confirmação

Não tomar migration inicial como schema operacional definitivo.

---

## P2 — RLS/grants precisam invariant

Toda tabela exposta deve possuir postura explícita e auditável.

---

## P2 — retenção de short links

Destinos temporários podem gerar registros permanentes.

---

## P3 — organização/nomenclatura menor

Alguns nomes refletem origem histórica e não domínio atual.

Só corrigir quando reduzir confusão real.

---

# 47. Estado desejado conceitualmente

O banco deve continuar com poucos princípios simples:

```text
cada dado importante
→ uma fonte de verdade

dados derivados
→ claramente derivados

estado externo
→ snapshot identificado como snapshot

ação pendente
→ fila/outbox

histórico financeiro/estoque
→ ledger auditável

configuração comum
→ runtime config

segredo
→ secret store

estrutura temporária encerrada
→ arquivar/remover de forma explícita
```

Não é necessário normalizar tudo ao máximo.

---

# 48. O que NÃO fazer agora

Não devemos:

- criar novo banco;
- dividir por microserviço;
- criar schema novo para cada domínio;
- remover snapshots externos;
- apagar movimentos históricos;
- apagar migrations aplicadas;
- remover `pedidos_operacionais`;
- remover outbox;
- fundir catálogo com anúncios;
- criar outro ledger;
- remover campos apenas por duplicação visual;
- criar tabela nova de auditoria antes de decidir o futuro de `nf_auditoria_eventos`;
- mover secrets para solução customizada sem verificar secret store existente;
- aplicar constraints rígidas antes de normalizar dados/writers;
- implementar correções durante esta auditoria.

---

# 49. Dependências para itens futuros

## Item 11 — Interface Web

Confirmar consumidores de:

- campos fiscais antigos;
- `processados/total`;
- tabelas WhatsApp;
- short links;
- snapshots duplicados.

## Item 12 — Regras Compartilhadas

Definir contratos únicos para:

- oferta preferencial;
- quantidade segura;
- status de job;
- status fiscal;
- disponibilidade de estoque;
- autorização;
- auditoria;
- retry.

## Item 13 — Performance e Saúde Operacional

Medir:

- tamanho de tabelas;
- crescimento de `jobs`;
- `nf_auditoria_eventos`;
- `short_links`;
- snapshots;
- índices usados/não usados;
- consultas grandes;
- retenção.

## Item 14 — Testes

Cobrir:

- constraints importantes;
- ledgers;
- dedupe;
- integridade de FKs;
- RLS/permissões;
- migrations de limpeza futuras.

## Item 15 — Scripts + Documentação + Históricos

Confirmar remoção/arquivamento de:

- `ml_p0_*`;
- `whatsapp_alert_events`;
- `ops_whatsapp_events`;
- campos/scripts auxiliares antigos;
- artefatos de campanhas encerradas.

---

# 50. Resultado do checklist — Item 10

- [x] Mapear tabelas por domínio.
- [x] Identificar fonte de verdade de cada dado importante.
- [x] Identificar tabelas/campos redundantes.
- [x] Revisar relacionamentos principais.
- [x] Revisar índices e constraints relevantes nas migrations.
- [x] Revisar evolução das migrations.
- [x] Diferenciar view de tabela duplicada.
- [x] Diferenciar snapshot necessário de duplicação acidental.
- [x] Confirmar ledgers de estoque e fornecedor como fontes auditáveis.
- [x] Confirmar outbox/locks/manifestos como estruturas operacionais necessárias.
- [x] Identificar `jobs.status` com vocabulário inconsistente.
- [x] Identificar tabelas WhatsApp candidatas a histórico/redundância.
- [x] Identificar tabelas `ml_p0_*` como estruturas especiais a revisar no Item 15.
- [x] Confirmar `short_links` sem expiração na operação atual.
- [x] Identificar secrets misturados em `sync_runtime_config`.
- [x] Revisar postura RLS/grants das migrations relacionadas.
- [x] Registrar necessidade de auditoria operacional de `pg_policy`, grants e indexes antes de mudanças destrutivas.
- [x] Separar históricos necessários de candidatos à limpeza.

---

# 51. Restrições desta etapa

Nesta etapa:

- nenhuma tabela foi criada/removida;
- nenhuma coluna foi alterada;
- nenhuma constraint foi alterada;
- nenhum índice foi criado/removido;
- nenhuma migration foi executada;
- nenhum dado foi modificado;
- nenhum secret foi reproduzido;
- nenhum backup foi acessado;
- nenhum deploy foi realizado;
- nenhum teste foi executado.

Foram realizadas apenas:

- leitura do repositório atual na branch `dev`;
- análise das migrations atuais;
- análise do código consumidor relacionado aos achados;
- consultas somente leitura em tabelas operacionais disponíveis;
- consulta à documentação oficial atual do Supabase/PostgreSQL.

### Limitação

As ferramentas desta auditoria não oferecem consulta arbitrária a:

```text
information_schema
pg_catalog
pg_policy
pg_indexes
```

no banco operacional.

Portanto, antes da futura execução de alterações de schema, deve ser capturada uma fotografia real dessas estruturas.

Nenhuma afirmação destrutiva deste Item 10 depende de presumir o estado final apenas pelas migrations.

---

# 52. Fontes principais

## Referência operacional

- `INSTRUCOES_AGENTE_VORTEK.md`
- `AGENTS.md`

## Repositório Vortek — branch `dev`

Analisados principalmente:

- `supabase/migrations`
- `src/lib/preferred-offer.ts`
- `src/lib/produto-fornecedor.ts`
- `src/lib/produto-kits.ts`
- `src/lib/short-links.ts`
- `src/lib/sync/domain-lock.ts`
- `src/services/whatsapp-alerts.ts`
- fluxos de pedidos, fiscal, jobs e financeiro previamente auditados.

### Migrations relevantes

- `00001_schema.sql`
- `00018_cron_dispatch_schedule.sql`
- `00022_ml_pack_and_nf_audit.sql`
- `20260528123000_sync_domain_locks_and_ml_publish_outbox.sql`
- `20260608123000_multi_supplier_product_offers.sql`
- `20260608193000_product_offer_listing_details.sql`
- `20260610001532_harden_public_table_access.sql`
- `20260618212911_short_links.sql`
- `20260619153640_whatsapp_alerts.sql`
- `20260622093000_ops_whatsapp_audit.sql`
- `20260714193934_kit_inventory.sql`
- `20260720010000_estoque_interno.sql`
- `20260729182648_consolidate_virtual_kit_orders.sql`
- `20260731002740_consolidate_cart_orders.sql`
- `20260801232600_durable_ml_order_hydration_queue.sql`
- `20260804001421_durable_catalog_price_refresh.sql`
- `20260804202357_supplier_credits_control.sql`
- `20260815221030_ml_p0_audit.sql`
- `20260815225216_ml_p0_sanitize.sql`
- `20260816005942_ml_p0_phase3.sql`

## Banco operacional — somente leitura

Foram usados dados operacionais apenas para validar comportamento/uso, incluindo:

- `jobs`;
- `short_links`;
- `whatsapp_alert_events`;
- `ops_whatsapp_events`;
- `sync_runtime_config`.

Nenhum valor sensível encontrado foi incluído neste documento.

## Supabase — documentação oficial

Row Level Security:

`https://supabase.com/docs/guides/database/postgres/row-level-security`

Indexes:

`https://supabase.com/docs/guides/database/query-optimization`

Vault:

`https://supabase.com/docs/guides/database/vault`

## PostgreSQL — documentação oficial

Constraints:

`https://www.postgresql.org/docs/current/ddl-constraints.html`

Indexes:

`https://www.postgresql.org/docs/current/indexes.html`

---

# 53. Conclusão final do Item 10

O banco do Vortek não está estruturalmente desorganizado.

O núcleo possui boas decisões:

```text
produto mestre
+
ofertas
+
ledgers
+
snapshots externos
+
outbox
+
locks
+
views
+
filas duráveis
```

A dívida acumulada está principalmente em:

```text
estado histórico sobreposto
+
nomes antigos
+
tabelas temporárias que ficaram
+
eventos espalhados
+
status não uniformes
+
configuração sensível misturada
+
retenção indefinida
```

A limpeza correta não é uma grande normalização.

É:

```text
confirmar fonte de verdade
→ consolidar writers
→ confirmar consumidores
→ remover somente o que ficou sem função
```

O **Item 10 está concluído**.

O P0 do Item 9 continua aberto e deve permanecer prioritário antes do futuro plano de execução.
