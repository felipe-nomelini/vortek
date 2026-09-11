# BNT-ML-QUALITY-01 — Qualidade dos anúncios com vendas

Data operacional: 10/09/2026.

## Objetivo e limites

Priorizar os anúncios ativos que já venderam, distinguir a nota realmente
fornecida pelo Mercado Livre de ausência de leitura e aplicar somente melhorias
de catálogo sustentadas por evidência do produto. Preço, promoção, tipo de
publicação, parcelamento, frete, Envios Flex, publicidade e vídeo permaneceram
fora deste recorte.

Foram usados os contratos oficiais de
[performance do anúncio](https://developers.mercadolivre.com.br/pt_br/qualidade-das-publicacoes),
[qualidade de catálogo](https://developers.mercadolivre.com.br/pt_br/guia-para-imoveis/saiba-como-estao-seus-vendedores-em-relacao-carga-de-atributos),
[User Products](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos/user-products)
e [imagens](https://developers.mercadolivre.com.br/devcenter/trabalhar-com-imagens).
O procedimento local obrigatório de publicação também foi conferido antes da
escrita.

## Fotografia produtiva

O preflight confirmou `supabase.bentevi.shop` no destino gravável `.162`, o
runtime Bentevi e a conta Mercado Livre `BENTEVITECNOLOGIA`, site `MLB`, sem a
tag de usuário de teste. A leitura encontrou:

- 163 anúncios ativos com ao menos uma venda e 647 unidades vendidas no total;
- 158 notas disponíveis pela API de performance e 5 leituras indisponíveis;
- nenhum anúncio com nota 100;
- 26 notas entre 50 e 64, 104 entre 65 e 79 e 28 entre 80 e 99.

As pendências mais frequentes pertencem a decisões comerciais ou logísticas:
Envios Flex, promoção, vídeo, parcelamento sem juros, preço e frete. Elas foram
somente apresentadas, sem mutação.

### VTK017447

O item `MLB5196586609` é controlado por catálogo (`MLB15553603`) e a API de
performance não publica sua nota. A tela oficial fornecida pelo responsável
mostra nota 64, oito objetivos atingidos e quatro pendências: vídeo, menor
preço, Envios Flex e promoção. As quatro exigem conteúdo ou decisão comercial
fora do recorte; portanto, não existe alteração técnica segura que leve esse
anúncio a 100 nesta ação. O conteúdo herdado do catálogo não foi forçado.

## Triagem dos 24 candidatos de catálogo

A fotografia persistida indicava 20 candidatos de fotos e 4 de características.
A releitura individual imediatamente anterior a qualquer escrita mostrou que
13 anúncios passaram a ser controlados pelo catálogo, 7 continuam sem uma
terceira foto comprovada, 3 dependem de especificações ausentes e 1 permitia
correção segura e foi corrigido.

| Classificação | Anúncios | Decisão |
|---|---|---|
| Controlado pelo catálogo | `VTK000045/MLB7216666520`, `VTK009672/MLB7044869292`, `VTK009674/MLB4786757691`, `VTK017679/MLB4972470597`, `VTK000302/MLB7086773274`, `VTK001528/MLB4612539573`, `VTK003659/MLB5109037741`, `VTK021855/MLB7332768248`, `VTK021396/MLB4971945451`, `VTK012105/MLB4880526015`, `VTK012386/MLB7149328794`, `VTK019466/MLB7381674662`, `VTK012034/MLB4987964345` | Sem escrita: fotos e ficha são herdadas do produto de catálogo. |
| Fotos insuficientes e sem fonte adicional comprovada | `VTK017679/MLB4937467285`, `VTK009672/MLB4773175289`, `VTK012302/MLB4857637711`, `VTK003146/MLB7111713568`, `VTK002836/MLB6563424810`, `VTK016053/MLB4903865373`, `VTK004225/MLB7087435606` | Sem escrita: não duplicar imagens nem usar fotos de outro produto. |
| Características sem evidência suficiente | `VTK012556/MLB7111655878`, `VTK000751/MLB4857498447`, `VTK012545/MLB4857541977` | Sem escrita: impedância, tensão, pressão, diâmetro interno e homologação Anatel não podem ser inventados. |
| Corrigido | `VTK003105/MLB4857622801` | Cinco imagens verificadas; objetivo de fotos concluído. |

## Correção real: VTK003105

Produto: Pilha Auditiva Duracell 312, cartela com 6 unidades. O produto mestre e
duas ofertas ativas tinham o mesmo GTIN `041333030203`; cinco imagens de 1.200 ×
1.200 foram revisadas como pertencentes exatamente ao produto. As imagens
foram copiadas para objetos imutáveis em
`product-images/ml-quality/VTK003105/` e relidas pelo hostname público do
Supabase Bentevi antes da chamada ao Mercado Livre.

Uma única chamada `PUT /items/MLB4857622801` preservou os dois IDs de imagem
existentes e acrescentou três imagens secundárias. O body não continha preço,
quantidade, status ou qualquer outro campo comercial.

| Evidência | Antes | Depois |
|---|---:|---:|
| Fotos no item | 2 | 5 |
| Fotos no User Product `MLBU4248393442` | 2 | 5 |
| Objetivo `UP_PICTURES` | pendente, progresso 2/3 | concluído, progresso 3/3 |
| Nota oficial pela API | 65 | 69 |
| Preço | R$ 66,70 | R$ 66,70 |
| Quantidade disponível | 100 | 100 |
| Status | ativo | ativo |
| Imagens no produto mestre | 1 | 5 |

O endpoint de erros por imagem respondeu 404 inclusive para as duas imagens
anteriores, portanto esse endpoint não foi tratado como prova positiva. O
aceite usou o read-back HTTP 200 do item, do User Product e da performance. O
snapshot `anuncios_ml` do item foi atualizado de 65 para 69 com a mesma leitura
oficial e com as regras detalhadas preservadas.

## Mudança no Bentevi

- a sincronização preserva as regras, textos e progresso devolvidos pela API de
  performance;
- anúncios de catálogo sem score deixam de parecer nota zero e recebem um
  diagnóstico explícito da API de qualidade de catálogo;
- a central de Anúncios ganhou a visão `Com vendas`, preservada também no PDF;
- a linha e o Drawer explicam quando a nota existe somente no painel do Mercado
  Livre e mostram atributos faltantes quando o endpoint de catálogo os fornece.

Não houve migration nem alteração de schema.

## Validação técnica

- 47/47 cenários direcionados de Anúncios e documentação do Assistente;
- `npm run validate` com lint e typecheck aprovados;
- `npm run build` aprovado com Next.js 16.3.3 e 127 páginas/rotas;
- `npm run check:build-secrets` aprovado;
- `git diff --check` aprovado.

## Recuperação

O código pode ser revertido sem alteração de banco. Para desfazer somente a
mutação do VTK003105, enviar novamente os dois IDs de imagem preservados no
item, atualizar o produto mestre para uma única imagem válida e confirmar item,
User Product, preço, quantidade e status. Os objetos imutáveis adicionais do
Storage podem permanecer sem efeito operacional; sua remoção não é necessária
para a recuperação.
