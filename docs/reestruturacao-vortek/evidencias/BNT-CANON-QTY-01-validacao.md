# BNT-CANON-QTY-01 — Retirar desconto por quantidade

Data: 06/09/2026. Escopo exclusivo: DEV/homologação.

## Estado

Implementação e validação local concluídas. Migration ensaiada com ROLLBACK e aplicada transacionalmente no destino confirmado 192.168.1.162 / supabase-dev; histórico agora com 111 versões, última 20260906130000. Homologação web pendente antes do fechamento do checklist.

## Causa e mudança

PRC-03 bloqueava execução, mas Comercial ainda exigia três faixas; criação/preço, worker e acompanhamento mantinham chamadas, recomendações e pendências de atacado. O cânon seção 12 exige aposentadoria permanente.

- Editor, DTO, schema estrito e carregador comercial não recebem nem consultam faixas. PUT com campo antigo retorna 422 antes de gravar; RPC administrativa recebe somente três parâmetros.
- POST aplicar-atacado e atacado-preview preservam autenticação (401) e retornam 410 quantity_pricing_retired, sem consulta comercial, payload, fila ou ML.
- Removidos writers, recomendações e callbacks de criação/preço/worker/tracking. Sem “ausência de atacado” como falha; cancelamento é terminal, sem polling/retry da UI.
- Leitor de descontos remotos mantido somente no detalhe do anúncio, identificado como consulta. Nenhuma remoção/alteração remota foi autorizada ou executada.
- Enqueue/merge/reabertura e worker descartam a intenção antiga independentemente do gate de pricing. Fila pura termina cancelled; mista preserva operações legítimas. Preço permanece sujeito à PRC-03.
- Quantidades do carrinho/pedido, preço unitário, estoque, fulfillment e histórico não foram alterados.

## Validação local

281 testes passaram, zero falhas. Suítes de pricing, memória, contexto, consumidores, configuração, quantity pricing, outbox, tracking, pedidos, produtos, anúncios e paridades de atividade/preferência/fornecedor. Build passou; validate executa ESLint e TypeScript separadamente.

Cobertura: endpoints 401/410 sem efeitos, configuração antiga 422/nova 200, carregador sem tabela histórica, parsing informativo, retirada de exports escritores, payloads booleanos legados, gate ligado/desligado, fila pura/mista/repetida/reaberta, leitura de cancelamento sem ML, compra de 1/3/5/10 unidades sem desconto ou alteração do input.

## Banco e reversão

Fotografia anterior: [schema, permissões e hash das faixas](BNT-CANON-QTY-01-schema-before.json). Destino físico do socket confirmado .162; hostname supabase-dev. Histórico anterior: 110 versões, última 20260906120000. Dependência encontrada da tabela: somente RPC comercial.

Migration: 20260906130000_bnt_canon_qty_01_retire_quantity_pricing.sql.
SHA-256: 6c9626476446c01363ef752c48ccde09007966d5b84204fd49d475ac203d9e27.

Ensaio: troca de assinatura, ACLs e salvamento dos parâmetros atuais como service_role, seguido de ROLLBACK integral. Faixas preservadas por hash; anon/authenticated sem execute. Tabela continua RLS habilitada e service_role somente SELECT. Sem reescrita de migrations antigas nem apagamento de auditoria.

Reversão, se necessária: preflight .162 e fotografia atual; ensaiar migration compensatória que remove a assinatura de três argumentos e restaura a definição/ACL/comentário da fotografia, coordenada com código anterior. Manter bloqueios de publicação da PRC-03; nunca reabilitar writers de atacado nem apagar entradas do histórico de migrations. Não há rollback remoto de descontos, pois nenhum foi alterado.

## Homologação e fechamento

Pendente registrar versão implantada, conferência autenticada e captura. Não liberar PRC-04 antes desta validação.

## Fontes e limites

Cânon Comercial 1.0 seção 12; [PostgreSQL — funções](https://www.postgresql.org/docs/17/sql-createfunction.html), [Supabase — funções e permissões](https://supabase.com/docs/guides/database/functions), [ML — consulta PxQ](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b), [Ant Design — formulário](https://ant.design/components/form/), guia local Next.js instalado. ML direto respondeu 403; conteúdo oficial indexado foi consultado, sem nova escrita ML.

Skills DEV/Supabase orientaram isolamento, inspeção e ensaio transacional; o mapa AGENTS .162 prevalece sobre endereço antigo na skill. AGENTS e cânon imutável preservados. Sem main, produção, descontos remotos ou implementação de PRC-04.
