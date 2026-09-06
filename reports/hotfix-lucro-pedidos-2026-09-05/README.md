# Correção do lucro dos pedidos — 05/09/2026

Correção implantada em produção no commit `69bfdd3`. Cinco vendas recalculadas em transação única, com tarifa e frete consultados no Mercado Livre. A venda `2000018304422954` passou de lucro zero para **R$ 7,46 estimados**, sem a pendência econômica que bloqueava o fluxo.

## Causa e correção

A migração de pricing passou a exigir despesas adicionais opcionais para calcular o lucro. A configuração existente não as informava; o cálculo devolvia resultado indisponível e o banco mantinha o valor inicial zero. O serviço agora calcula com os componentes conhecidos e registra `estimated` e os motivos quando despesas adicionais ou tributo não estão confirmados. Não foi cadastrado um custo adicional fictício. Custo, tarifa, frete e tributação necessários continuam sujeitos à validação.

O kit `VTK016034` não possui oferta direta: sua composição é de duas unidades de `VTK003213`, com oferta ativa de R$ 12,36 por unidade. O cálculo agora reutiliza o resolvedor existente de kits e ofertas elegíveis: custo de R$ 24,72 por kit. A tarifa é multiplicada pela quantidade vendida do anúncio, sem multiplicá-la novamente pela composição. Kits sem composição suportada ou oferta elegível permanecem inconclusivos.

A sincronização registra status e motivos econômicos na auditoria existente. O fluxo DSLite distingue sincronização malsucedida de dados econômicos incompletos, indicando a pendência concreta.

## Recuperação executada

`financial-preview.json` contém os dados imediatamente anteriores à transação, os cálculos, alterações propostas e as dez consultas GET ao ML. `baseline.json` preserva o levantamento inicial; estados operacionais podem ter avançado normalmente entre o baseline e a execução.

Foram atualizados somente o lucro das cinco vendas e, no kit, a pendência `lucro_pendente_produto` e seu indicador de incompletude. A transação conferiu `updated_at` por pedido para evitar sobrescrever alterações concorrentes e registrou `order_profit_recalculated` em `nf_auditoria_eventos`, origem `hotfix-order-profit-69bfdd3`.

A leitura posterior confirmou as cinco alterações e a preservação dos campos de NF, DSLite e etiqueta em relação ao instante anterior à transação. A recuperação não emitiu NF, não criou compras no DSLite, não enviou etiquetas ou mensagens e não escreveu no ML. Na venda do kit, NF e compra DSLite continuam pendentes; o processamento dessas etapas não foi executado como teste.

Todos os resultados recuperados são estimados: tributação central estimada e despesas adicionais não informadas. Valores e componentes estão em `financial-preview.json` e `pedidos-recalculados.csv`.

## Validação e implantação

- `npm run test:m2m-pricing-radar`: 101 testes aprovados, zero falhas; inclui despesas opcionais, despesas inválidas, kits, multiplicação de quantidades e fontes obrigatórias.
- `npm run validate`: lint e typecheck aprovados.
- `npm run build`: aprovado.
- Commit `69bfdd3` enviado para `main`; deploy pelo script oficial do repositório. Atualização do serviço concluída; build `kxoemSFgscxhYUR5tZKLv`, com os marcadores da correção confirmados no código compilado em execução.
- Transação confirmada e cinco pedidos relidos, conforme `transaction-result.json` e `after.json`.
- Handler real da TV executado isoladamente com banco de produção e autenticação substituída somente no teste local: retornou os cinco valores corrigidos, conforme `tv-handler-validation.json`.

**Limite da validação da TV:** não houve conferência visual em sessão autenticada. A chamada HTTP de produção com chave interna retornou 401 porque essa rota exige sessão de usuário; a autenticação de produção foi preservada. O teste isolado valida a consulta e a montagem dos dados, não o login nem a renderização no navegador.

## Reversibilidade

Não houve migração de banco. Reversão de código, se necessária, deve usar revert do commit `69bfdd3` e o fluxo normal de implantação; reintroduziria a falha aqui corrigida. Os valores anteriores e alterações exatas estão preservados para eventual recuperação manual controlada, sempre conferindo alterações posteriores. Nenhuma reversão foi executada.

As modificações preexistentes em `package.json` e demais arquivos fora deste hotfix foram preservadas.
