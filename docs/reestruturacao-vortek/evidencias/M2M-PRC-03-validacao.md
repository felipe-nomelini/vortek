# M2M-PRC-03 — Corte dos consumidores legados

Data: 06/09/2026. Ambiente: branch dev; banco 192.168.1.162, hostname supabase-dev.

## Estado

Implementação local validada e migration aplicada. Publicação DEV e homologação web ainda em execução; não declarar o item concluído até registrar o resultado abaixo.

## Mudança e critérios

- Produtos/lista/detalhe/PDF, Anúncios, análise de catálogo e schema/preço-detalhe usam o contexto e a memória econômica centrais. Não há fórmula financeira própria no browser ou PDF.
- Preço registrado e alvo estimado são distintos. Ausência de CMV/frete/tarifa/tributo produz resultado inconclusivo, nunca zero fabricado. custom_price não comprova autoria manual.
- Busca financeira de Produtos e Anúncios ocorre no servidor sobre todo o conjunto antes de filtros econômicos, ordenação, resumo e paginação. O PDF de Produtos faz uma única leitura completa. Q segura vem do carregador operacional existente.
- Formulário/contrato/RPC comercial não recebem costTiers; a política final é somente leitura. Simulação administrativa explícita no servidor, sem alterar configuração, preço ou fila.
- Aritmética de pedidos usa base total explícita, cobertura integral de itens e competência da venda no fuso oficial. Custo atual e compras.valor_total não comprovam CMV histórico. A API admite evidência histórica itemizada, mas os chamadores atuais não possuem essa prova: novos lucros ficam inconclusivos, sem apagar os valores registrados. Não apresentar isso como lucro realizado confirmado.
- Scripts comerciais históricos, criação/preço/opt-in, transporte e escrita de preço permanecem bloqueados. Outbox mista continua estoque/status sem preço; preço puro antigo é cancelado sem retry.
- RBT12/Simples, atividade manual, preferência ativa, kits simples e demais paridades permanecem. Sem nova pesquisa pesada, publicação comercial, automação noturna, alteração de produção ou avanço de QTY-01/PRC-04.

## Evidência local

290 testes passaram, zero falhas:

```sh
node --test tests/m2m-*.test.js tests/*pricing*.test.js tests/*products*.test.js tests/*listings*.test.js tests/bentevi-product-detail.test.js tests/seo-reactivation.test.js tests/catalog-cleanup.test.js tests/preferred-offer.test.js tests/product-activity.test.js tests/supplier-deactivation.test.js tests/ml-price-publish-tracking.test.js tests/ml-publish-outbox.test.js tests/ml-order-profit.test.js tests/easypanel-deploy-contract.test.js
npm run validate
npm run build
git diff --check
```

Inclui 1.105 produtos, ordenação/filtro global, resumo com inconclusivos, lote repetido, PDF real em memória, autorização e rejeição de campos legados no simulador, competência/quantidade/cobertura dos pedidos e guardas antes de inicializar scripts externos.

O build não substitui typecheck: validate executou ambos ESLint e TypeScript separadamente.

## Banco

Fotografia anterior: [M2M-PRC-03-schema-before.json](M2M-PRC-03-schema-before.json), cinco definições completas, owners e ACLs; sem dados comerciais ou credenciais.

- Histórico antes: 109 versões; última 20260905120000.
- Migration nova: 20260906120000_m2m_prc_03_retire_legacy_pricing.sql.
- SHA-256: abd96f873fc0af3a00697083f5326ed1f5c2ea948fdf83a1bfcec3927eced2a2.
- Ensaio com BEGIN/ROLLBACK passou. Consultas Produtos/Anúncios responderam; helper SQL legado removido. anon/authenticated sem execução das novas RPCs; service_role autorizado.
- Aplicação transacional e registro no histórico confirmados somente em .162. Histórico após: 110 versões, última 20260906120000. Cinco produtos operacionais preservados; zero anúncios operacionais.
- Assinaturas dos tipos afetados conferidas por introspecção após aplicar: busca com dez argumentos, configuração com quatro; RPC de resumo legada removida. Não houve regeneração indiscriminada do schema inteiro.
- Amostra protegida já existente: 40 produtos, separada dos registros operacionais; não foi copiado banco de produção.

## Reversão coordenada

Não remover isoladamente os bloqueios de escrita e não restaurar fórmulas antigas como solução comercial. Se o corte de leitura precisar ser revertido, manter guardas e coordenar código/schema em DEV.

1. Confirmar branch dev e transporte físico .162; salvar o estado atual e conferir histórico.
2. Em transação de ensaio, remover somente as duas novas assinaturas de busca/configuração. Restaurar as cinco definições da fotografia (helper privado primeiro), owners e ACLs registrados; restaurar também comentários legados conforme o histórico.
3. Ensaiar compatibilidade com o código anterior de leitura, preservando os bloqueios de execução; ROLLBACK.
4. Se a reversão for necessária, usar migration compensatória nova e código coordenado. Nunca reescrever nem apagar a versão 20260906120000 do histórico.
5. Não alterar produtos, preços, pedidos ou política histórica para contornar falha de leitura.

## Limites preservados

Aquisição, validade e recotação ML viva pertencem à PRC-04. Governança, origem prospectiva, override, grupos e autorização continuam nos respectivos gates. A ausência real de provas pode deixar preço sugerido/lucro indisponíveis; não foi introduzido fallback de produto.custo/frete antigo para esconder essa condição.

Fontes oficiais consultadas: [PostgreSQL 17 — funções](https://www.postgresql.org/docs/17/sql-createfunction.html), [Supabase — funções](https://supabase.com/docs/guides/database/functions), [Easypanel — deployments](https://easypanel.io/docs/services/app#deployments). Guia local da versão Next.js instalada consultado. Consulta direta de documentação ML encontrou HTTP 403; nenhum novo contrato de cotação foi presumido.

## Homologação web

Pendente registrar commit implantado, respostas autenticadas, simulador e capturas em dev.bentevi.shop.
