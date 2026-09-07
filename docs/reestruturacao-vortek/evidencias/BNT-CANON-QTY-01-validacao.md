# BNT-CANON-QTY-01 — Retirar desconto por quantidade

Data: 06/09/2026. Escopo exclusivo: DEV/homologação.

## Estado

Implementação e validação local concluídas. Migration ensaiada com ROLLBACK e aplicada transacionalmente no destino confirmado 192.168.1.162 / supabase-dev; histórico agora com 111 versões, última 20260906130000. Código `9898b71` publicado e homologação autenticada concluída em `dev.bentevi.shop`. Ação concluída; próxima ação: planejar M2M-PRC-04, sem executá-la.

## Causa e mudança

PRC-03 bloqueava execução, mas Comercial ainda exigia três faixas; criação/preço, worker e acompanhamento mantinham chamadas, recomendações e pendências de atacado. O cânon seção 12 exige aposentadoria permanente.

- Editor, DTO, schema estrito e carregador comercial não recebem nem consultam faixas. PUT com campo antigo retorna 422 antes de gravar; RPC administrativa recebe somente três parâmetros.
- POST aplicar-atacado e atacado-preview preservam autenticação (401) e retornam 410 quantity_pricing_retired, sem consulta comercial, payload, fila ou ML.
- Removidos writers, recomendações e callbacks de criação/preço/worker/tracking. Sem “ausência de atacado” como falha; cancelamento é terminal, sem polling/retry da UI.
- Leitor de descontos remotos mantido somente no detalhe do anúncio, identificado como consulta. Nenhuma remoção/alteração remota foi autorizada ou executada.
- Enqueue/merge/reabertura e worker descartam a intenção antiga independentemente do gate de pricing. Fila pura termina cancelled; mista preserva operações legítimas. Preço permanece sujeito à PRC-03.
- Quantidades do carrinho/pedido, preço unitário, estoque, fulfillment e histórico não foram alterados.

## Validação local

281 testes passaram, zero falhas. Suítes de pricing, memória, contexto, consumidores, configuração, quantity pricing, outbox, tracking, pedidos, produtos, anúncios e paridades de atividade/preferência/fornecedor. Build e validate passaram (ESLint e TypeScript separadamente). Uma execução adicional de 47 testes de quantidades/catálogo, pedidos, outbox e deploy também passou; há sobreposição com a suíte principal, não são 328 casos únicos.

Cobertura: endpoints 401/410 sem efeitos, configuração antiga 422/nova 200, carregador sem tabela histórica, parsing informativo, retirada de exports escritores, payloads booleanos legados, gate ligado/desligado, fila pura/mista/repetida/reaberta, leitura de cancelamento sem ML, compra de 1/3/5/10 unidades sem desconto ou alteração do input.

## Banco e reversão

Fotografia anterior: [schema, permissões e hash das faixas](BNT-CANON-QTY-01-schema-before.json). Destino físico do socket confirmado .162; hostname supabase-dev. Histórico anterior: 110 versões, última 20260906120000. Dependência encontrada da tabela: somente RPC comercial.

Migration: 20260906130000_bnt_canon_qty_01_retire_quantity_pricing.sql.
SHA-256: 6c9626476446c01363ef752c48ccde09007966d5b84204fd49d475ac203d9e27.

Ensaio: troca de assinatura, ACLs e salvamento dos parâmetros atuais como service_role, seguido de ROLLBACK integral. Faixas preservadas por hash; anon/authenticated sem execute. Tabela continua RLS habilitada e service_role somente SELECT. Sem reescrita de migrations antigas nem apagamento de auditoria. Após COMMIT, introspecção confirmou somente assinatura de três argumentos e nenhuma função consumidora da tabela histórica. Tipos da RPC regenerados a partir da assinatura viva e comparados com o arquivo atualizado; correspondência exata. Hash das três faixas antes/depois: `1d2e551c545783929d0d6b654dc78b2ccf9f37a5dd719de35d2c95362398e166`.

Reversão, se necessária: preflight .162 e fotografia atual; ensaiar migration compensatória que remove a assinatura de três argumentos e restaura a definição/ACL/comentário da fotografia, coordenada com código anterior. Manter bloqueios de publicação da PRC-03; nunca reabilitar writers de atacado nem apagar entradas do histórico de migrations. Não há rollback remoto de descontos, pois nenhum foi alterado.

## Homologação e fechamento

- Commit de runtime: `9898b71`; push somente em dev. Deploy pelo script oficial, ação Easypanel `cmtqk4k3g000006mnbvhfctoq`.
- Serviço `local_vortek-erp-dev`, container `349225c0ff69`, atualização concluída em 07/09/2026 às 01:26:08 UTC (06/09 às 22:26:08 em São Paulo). Hashes de módulo quantity-pricing, aba Comercial e endpoint aplicar-atacado conferidos entre local e container.
- Autenticação temporária somente no Auth .162, sem mudança de senha; sessão encerrada ao final.
- HTTP 200 em Produtos, resumo, detalhe, Anúncios, Comercial, simulador e PDFs de Produtos/Anúncios. Amostra protegida já existente: 40 produtos e 55 anúncios, sem nova cópia de produção.
- Comercial não retorna quantityPricingTiers. PUT com campo legado retorna 422. Salvamento válido foi provado no teste isolado da rota (200/RPC de três argumentos/auditoria) e no ensaio real da RPC em .162 com ROLLBACK; não houve alteração de parâmetros pelo navegador.
- Endpoints aplicar-atacado e atacado-preview: HTTP 410 autenticado. Criação/preço/opt-in: HTTP 409 pricing_execution_not_ready, preservando PRC-03.
- Navegação em Produtos/detalhe, Anúncios e Comercial sem erros de página. Editor/adicionar faixas ausentes; botão Simular no servidor respondeu 200. Simulação controlada CMV 4000c/frete 1000c/tarifa 14% retornou alvo 6667c, estimado.
- [Captura da aba Comercial](BNT-CANON-QTY-01-comercial.png), inspecionada visualmente. Testes de filas usam dependências simuladas: nenhum estoque/status real foi publicado.
- Nenhuma migration, DML ou acesso ao banco de produção. Host .160 usado somente para deploy/inspeção do serviço web DEV.
- Checklist e documentação fechados após as evidências. Sem avanço de PRC-04 ou liberação de execução comercial.

## Fontes e limites

Cânon Comercial 1.0 seção 12; [PostgreSQL — funções](https://www.postgresql.org/docs/17/sql-createfunction.html), [Supabase — funções e permissões](https://supabase.com/docs/guides/database/functions), [ML — consulta PxQ](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b), [Ant Design — formulário](https://ant.design/components/form/), guia local Next.js instalado. ML direto respondeu 403; conteúdo oficial indexado foi consultado, sem nova escrita ML.

Skills DEV/Supabase orientaram isolamento, inspeção e ensaio transacional; o mapa AGENTS .162 prevalece sobre endereço antigo na skill. AGENTS e cânon imutável preservados. Sem main, produção, descontos remotos ou implementação de PRC-04.
