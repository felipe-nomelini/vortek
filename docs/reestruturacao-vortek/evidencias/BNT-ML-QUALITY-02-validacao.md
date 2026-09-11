# BNT-ML-QUALITY-02 — Qualidade dos anúncios com visitas e sem vendas

Data operacional: 10/09/2026.

## Objetivo e limites

Priorizar os anúncios ativos que recebem visitas e ainda não venderam, corrigir
somente características comprovadas do produto e tornar a fila reutilizável na
central de Anúncios e no relatório. Preço, promoção, tipo de publicação,
parcelamento, frete, Envios Flex, publicidade e vídeo permaneceram fora deste
recorte.

O procedimento operacional local foi conferido antes das escritas. A execução
também respeitou os contratos oficiais de atualização de itens, atributos e
User Products: cada `PUT /items/{id}` continha apenas os campos técnicos da
correção, seguido de leitura do item e da qualidade publicada pelo Mercado
Livre.

## Fotografia produtiva e priorização

O preflight confirmou `supabase.bentevi.shop` no destino gravável `.162`, o
runtime Bentevi e a conta Mercado Livre `BENTEVITECNOLOGIA`, site `MLB`, sem a
tag de usuário de teste. A fotografia inicial encontrou:

- 2.021 anúncios ativos com visitas, somando 59.429 visitas;
- 163 anúncios com venda;
- 1.858 anúncios sem venda, somando 19.452 visitas;
- 1.754 anúncios com nota menor que 80 e nenhum com nota 100;
- 845 anúncios sem venda com objetivo técnico pendente, somando 8.734 visitas;
- 682 desses anúncios fora de catálogo, somando 5.264 visitas;
- 960 anúncios com pendências somente comerciais, somando 10.277 visitas;
- 53 anúncios sem objetivo disponível, somando 441 visitas.

Depois da sincronização produtiva, a consulta canônica passou a identificar
1.863 anúncios ativos com visitas e zero venda. A pequena variação é resultado
da fotografia mais recente recebida do Mercado Livre, não de uma mudança na
regra da fila.

## Mudança no Bentevi

- a central de Anúncios ganhou a fila `Com visitas, sem vendas`, com contador
  próprio e ordenação inicial por maior número de visitas;
- o mesmo filtro passou a existir no contrato da API e no PDF;
- a sincronização passou a buscar a qualidade de catálogo quando um anúncio
  regular possui objetivo técnico pendente e a armazenar domínio, estado de
  adoção e atributos faltantes no snapshot de performance;
- o Drawer passou a mostrar os atributos técnicos faltantes devolvidos pelo
  Mercado Livre;
- a reconciliação passou a corrigir o indicador local de catálogo pelo valor
  vivo `catalog_listing` do item.

Não houve migration nem alteração de schema.

## Pilotos técnicos

Os seis pilotos estavam ativos, sem venda, pertenciam à conta produtiva e foram
relidos imediatamente antes de cada escrita. Atributos sem fonte suficiente
continuaram pendentes; não foram preenchidos com estimativas ou `Não se
aplica`.

| Produto / anúncio | Evidência aplicada | Nota antes → depois | Resultado e pendências |
|---|---|---:|---|
| `VTK025430 / MLB4971292359` | comprimento `10 polegadas`; resposta de frequência `50 a 2000 Hz` | 76 → 78 | Permanecem linha, número de vias e profundidade. |
| `VTK012229 / MLB7111649308` | cabo P10 de 5 m; entrada e saída Jack, macho, uma de cada | 61 → 70 | A tentativa de corrigir a categoria foi revertida assincronamente pelo User Product. Permanecem somente atributos que não puderam ser comprovados. |
| `VTK025400 / MLB4971199005` | comprimento `8 polegadas` | 76 → 78 | Permanecem linha, número de vias e profundidade. |
| `VTK025423 / MLB4971294701` | comprimento `15 polegadas` | 76 → 78 | Permanecem linha, número de vias e profundidade. |
| `VTK009849 / MLB4932006275` | origem China; corpo em poplar; braço em maple | 70 → 75 | Permanecem linha, ano, formato/acabamento do corpo, escala e material do tampo. |
| `VTK012513 / MLB4857539465` | fabricante, peso, dimensões, entradas e saídas | 64 → 64 | A ficha ficou mais completa, mas os objetivos restantes dependem de especificações ainda não comprovadas. |

Em todos os pilotos, preço, quantidade disponível, status `active` e tipo de
publicação foram preservados. O `VTK012229` chegou transitoriamente à categoria
pretendida, mas a vinculação do User Product restabeleceu a categoria anterior;
a ação não foi repetida porque insistir poderia disputar a fonte canônica do
Mercado Livre.

## Estoque e catálogo

O aparente desvio do `VTK025834 / MLB4980622371` foi investigado até a fonte
operacional. Ele é um kit de 10 unidades do componente `VTK012129`; com 67
unidades disponíveis no componente, a disponibilidade canônica é
`floor(67 / 10) = 6`. O writer restaurou corretamente a quantidade remota para
6 após uma tentativa pontual de usar o campo legado `produtos.estoque=1`.
Nenhuma nova escrita foi feita e a quantidade final correta permaneceu 6.

Também foram comparados 7.017 anúncios locais com o snapshot de catálogo. Os
575 candidatos divergentes foram relidos na API oficial em lotes de no máximo
20 itens, com conferência do seller. O read-back vivo confirmou e corrigiu 573
flags observacionais — 567 para catálogo e 6 para anúncio padrão — enquanto 2
já coincidiam com o item vivo. A releitura final encontrou zero divergência no
recorte corrigido. Não houve alteração em catálogo, produto, preço ou anúncio
remoto nessa reconciliação.

## Sincronização e validação

A rota produtiva de sincronização processou os sete anúncios do recorte com
HTTP 200: 7 vistos, 7 snapshots atualizados, 6 performances relidas e nenhuma
falha. Os avisos restantes eram diferenças informativas de identidade de marca,
sem erro de persistência ou publicação.

- 24/24 cenários direcionados de Anúncios e relatório aprovados;
- `npm run validate` aprovado;
- `npm run build` aprovado com Next.js 16.3.3 e 127 páginas/rotas;
- `npm run check:build-secrets` aprovado;
- suíte completa: 1.351 cenários, 1.348 aprovados, zero falhas e 3 skips vivos
  explícitos;
- `git diff --check` aprovado.

O commit funcional `a4cc28217977489bec5229f169b0d969afbbd73c` foi enviado para
`dev` e promovido por fast-forward para `bentevi-prod`, sem alteração de
`main`. A action Easypanel `cmtwccde700fu07mf94xi9vsp` terminou como `done`, e o
serviço `local/bentevi-prod` confirmou o mesmo SHA na branch correta.

O smoke público confirmou `/api/ops/health` e `/login` com HTTP 200,
redirecionamento de `/anuncios` para login sem sessão e proteção da API com HTTP
401. O log do serviço não apresentou erros no intervalo do deploy. O read-back
do banco confirmou a qualidade e os diagnósticos atualizados dos pilotos, a
flag de catálogo corrigida e a nova fila com 1.863 anúncios.

## Recuperação

O código pode ser revertido por um commit corretivo que desfaça `a4cc282`,
seguido do fluxo normal de promoção e deploy. As flags de catálogo são
observações do item vivo e serão novamente reconciliadas pela sincronização;
não devem ser restauradas para snapshots sabidamente antigos.

As características dos pilotos podem ser corrigidas progressivamente com um
novo `PUT` limitado ao atributo afetado e read-back do item. A categoria do
`VTK012229` já foi restaurada pelo próprio User Product, e o estoque do
`VTK025834` já se encontra no valor canônico 6; nenhum rollback remoto é
necessário para esses dois casos.
