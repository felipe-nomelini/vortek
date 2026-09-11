# BNT-PRICING-DECISION-CENTER-01 — Central de alertas acionável

Data: 11/09/2026
Branch de desenvolvimento: `dev`
Destino: `app.bentevi.shop` e Supabase Bentevi produtivo `.162`

## Resultado

A central passou a separar **Alertas** de **Decisões**, paginar e contar por
produto afetado e agregar os diagnósticos do mesmo produto. Um alerta sem
proposta deixou de exibir uma ação enganosa de decisão: abre o diagnóstico e
permite reanalisar vínculo e fontes comerciais sem preparar proposta e sem
escrever no Mercado Livre.

A reanálise é autenticada para `admin`/`gerente`, aceita apenas `productId` e
`commandId`, registra um job idempotente e executa novamente vínculo, grupo e
avaliação econômica. Falhas são devolvidas sem conteúdo interno ou credenciais.

## Correções de contrato

- anúncio existente exige identidade comercial segura para alteração de preço,
  sem herdar os campos editoriais mais rígidos usados na criação de anúncio;
- conflitos comerciais confirmados continuam bloqueando o vínculo;
- mudanças entre consulta e confirmação agora retornam códigos próprios para
  produto, anúncio, conta, identidade, elegibilidade, grupo e concorrência;
- a RPC `search_pricing_decision_product_ids` pagina por produto, devolve
  contadores distintos e só pode ser executada por `service_role`;
- o writer produtivo ganhou escopo explícito de operação. O recorte desta ação
  permite somente `price_change`; `listing_create`, lote e automação continuam
  bloqueados;
- toda alteração de preço ainda exige proposta válida, aprovação humana,
  confirmação final, claim único, uma tentativa mutante e read-back no ML.

## Validação técnica

- `npm run validate`: lint e typecheck aprovados;
- `node --test tests/*.test.js`: 1.355 casos, 1.352 aprovados, zero falhas e três
  casos LIVE configurados como ignorados;
- testes direcionados do recorte: 155 aprovados, zero falhas;
- `npm run build`: Next.js 16.3.3 aprovado com 128 páginas/rotas, incluindo
  `/api/pricing/decisions/reanalyze`;
- `git diff --check`: aprovado;
- inspeção do diff: nenhum segredo acrescentado.

O tipo gerado da nova RPC foi acrescentado e o último recorte passou novamente
por `npm run validate`, build, 16 testes da central/reanálise e
`git diff --check`.

## Banco e publicação

A escrita foi precedida de confirmação do runtime produtivo e do destino:
`SUPABASE_SERVICE_URL` resolve para `192.168.1.162`; o PostgreSQL confirmou o
banco `postgres` e endereço interno `172.18.0.5/32`. A migration aditiva
`20260911100000_pricing_decision_center_products.sql` foi aplicada em transação
curta e registrada. O read-back confirmou a função, a versão da migration e a
execução da RPC pelo backend. A primeira tentativa falhou integralmente antes do
commit porque `min(uuid)` não existe; o SQL foi corrigido para `min(id::text)` e
somente a segunda tentativa foi persistida.

O SHA funcional `8d35cce12ac0911ece01ce91ff8d3c9faf69e2ef` foi enviado para
`origin/dev`, promovido por fast-forward para `origin/bentevi-prod` e executado
por `local/bentevi-prod`. O Easypanel concluiu a ação
`cmtwebxfr00hc07mf4cnufabc`; o serviço confirmou o mesmo SHA, sem erro de
inicialização. `/api/ops/health` respondeu `200`, `/anuncios` redirecionou o
visitante sem sessão e `/api/pricing/decisions` respondeu `401` sem sessão.

O fechamento de tipos, escopo por operação e documentação foi versionado em
`b017624d97ff36837616e5ff5492d65243b59d7a`, novamente promovido por
fast-forward de `dev` para `bentevi-prod`. A ação Easypanel
`cmtwghdyc00jb07mf3rqehvg5` terminou com estado `done`; o serviço confirmou o
SHA exato, sem erro de inicialização. O novo processo respondeu health `200`,
login `200`, redirecionamento autenticado de `/anuncios` e `401` nas duas APIs
de decisões sem sessão, incluindo `/reanalyze`.

## Segurança operacional e recuperação

Durante migration, deploy, smoke e reconciliação, a execução comercial
permaneceu `disabled`. O preflight confirmou zero operação de pricing, zero
outbox de pricing e nenhuma operação não terminal antes da ativação. Criação de
anúncio e escritores automáticos não fazem parte deste recorte.

O scan observado iniciado antes do deploy foi retomado pelo mecanismo oficial
após a troca do processo e concluiu 7.052/7.052 itens, com zero falha terminal.
Os dois anúncios que originaram os alertas foram relidos; os dois produtos
ficaram com grupo `verified`, dois membros e sincronismo de catálogo confirmado.
Os alertas econômicos históricos permanecem visíveis até que um usuário
autorizado use a nova reanálise; a leitura não os apagou nem criou proposta.

A conta Mercado Livre foi reconfirmada por leitura com a credencial mantida no
backend: integração conectada, `/users/me` HTTP 200, site `MLB`, ausência de
`test_user` e identidade exata na única entrada da allowlist produtiva. Nenhum
token ou valor de credencial foi reproduzido na evidência.

Depois desses gates, o ambiente do serviço foi preservado e somente duas
chaves foram ajustadas: modo `production_controlled` e operações permitidas
`price_change`. O read-back da configuração confirmou runtime/origem
produtivos, preço manual habilitado, `listing_create` ausente, Assistente ainda
bloqueado e destino `.162`. O primeiro canário depende da sessão e confirmação
humana do responsável; nenhuma operação ou outbox de pricing existia no momento
da ativação.

Para interromper novas alterações de preço, restaurar
`ML_PRICING_EXECUTION_MODE=disabled` preservando as demais variáveis do serviço.
Depois de uma tentativa real, não reenviar nem presumir rollback remoto: usar o
estado da operação e o read-back do Mercado Livre. A migration é aditiva; se o
consumidor for revertido, a função pode permanecer sem efeito ou ser removida
explicitamente depois de confirmar que não há consumidor.
