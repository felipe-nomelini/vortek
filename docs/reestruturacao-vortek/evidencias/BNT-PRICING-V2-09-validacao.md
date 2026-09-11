# BNT-PRICING-V2-09 — desempenho comercial 30/90/150

Data da execução: 11/09/2026.

## Resultado

A ação foi implementada e publicada no Bentevi produtivo. A análise de anúncios
passou a apresentar visitas, vendas, unidades, faturamento, conversão e
recorrência em janelas independentes de 30, 90 e 150 dias. A janela primária é
30 dias e os indicadores só aparecem quando a cobertura inteira do período foi
comprovada.

O desempenho permanece separado da avaliação econômica. Esta ação não cria,
aprova ou executa alteração de preço, publicação ou pausa no Mercado Livre.

## Contratos implementados

- coleta oficial de visitas diárias do Mercado Livre em exatamente 150 dias
  completos, encerrados no dia anterior no fuso `America/Sao_Paulo`;
- persistência atômica dos pontos e da cobertura, com falha parcial incapaz de
  apagar a última janela válida;
- vendas concretizadas obtidas dos pedidos Bentevi, sem canceladas, com
  deduplicação por pedido e preservação da quantidade de unidades;
- recorrência indisponível quando não há identidade suficiente do comprador,
  sem transformar ausência de informação em zero;
- agregação somente para um grupo atual e confirmado da mesma conta Mercado
  Livre; vínculo pendente mantém a análise restrita ao anúncio selecionado;
- distinção entre zero comprovado e período sem amostra completa;
- histórico acumulado da tabela identificado como tal, sem ser confundido com
  as novas janelas comerciais.

## Banco e segurança

Migration aplicada: `20260911190000_bnt_pricing_v2_09_performance.sql`.

O preflight confirmou o destino gravável em `192.168.1.162`, banco `postgres`,
ausência prévia dos novos objetos e ausência de operações comerciais em voo. A
migration foi ensaiada integralmente em transação com rollback antes da
aplicação real.

O read-back confirmou:

- tabelas `ml_listing_visit_days` e `ml_listing_visit_coverage` presentes;
- índice direcionado de itens de venda presente;
- RLS habilitada nas duas tabelas;
- `service_role` com leitura das tabelas e execução da RPC, mas sem escrita
  direta;
- `authenticated` sem leitura das tabelas e sem execução da RPC;
- migration registrada no histórico do Supabase;
- uma janela real com 150 pontos e cobertura completa persistida pelo fluxo da
  aplicação.

Como a mudança é aditiva, a recuperação segura é publicar uma correção
progressiva e preservar os pontos coletados. O aplicativo anterior não consome
os novos objetos; não é necessária restauração cega do banco.

## Validações

- `npm run validate`: aprovado;
- `npm run check:build-secrets`: aprovado;
- 94 testes direcionados dos domínios de anúncios, pricing, grupos e
  desempenho: aprovados;
- `npm run build`: aprovado com Next.js 16.3.3;
- `git diff --check`: aprovado;
- contrato real do endpoint de visitas conferido antes da publicação: o
  intervalo inclusivo do provedor foi normalizado para 150 dias completos;
- serviço de desempenho executado contra anúncio real vendido: janelas
  30/90/150 disponíveis, cobertura completa e escopo individual aplicado por
  falta de grupo confirmado;
- após a leitura real, `pricing_operations` permaneceu vazia e a distribuição
  de estados de `anuncios_ml_outbox` permaneceu inalterada.

## Git, deploy e smoke

- `origin/main` permaneceu no watermark já auditado
  `2fc441f67d1457a154b3bd475d4f0e68b032551a`;
- implementação validada em `dev` e promovida por fast-forward para
  `bentevi-prod`: `ca1a9c27110f7f6efed10a9a46e6d0d2bb28a493`;
- ação única do Easypanel: `cmtwzrc8q009707nt2oxja4q0`, estado `done`;
- `local/bentevi-prod` confirmado executando o mesmo SHA, com uma réplica e
  troca sem indisponibilidade;
- `app.bentevi.shop/api/ops/health`: HTTP 200, Mercado Livre conectado e leitura
  válida, ambiente fiscal válido;
- `/login`: HTTP 200;
- `/anuncios` sem sessão: redirecionamento para login;
- nova rota sem sessão: HTTP 401.

Não foi aberta uma sessão de navegador autenticada nesta execução. A integração
e os cálculos foram exercitados com a fonte real por meio do mesmo serviço de
domínio publicado; a conferência visual autenticada permanece como aceite de
uso, sem bloquear a entrega técnica.
