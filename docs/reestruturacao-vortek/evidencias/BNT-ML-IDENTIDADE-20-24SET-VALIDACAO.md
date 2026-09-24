# Conferência de identidade dos 20 anúncios vendedores — 24/09/2026

## Escopo e fonte

Janela de vendas: 25/08–23/09/2026, 30 dias completos. A conferência leu o
Supabase produtivo Bentevi em `192.168.1.162`, as ofertas sincronizadas da
DSLite e os itens/User Products da conta ML `3294514937`. Os 20 bloqueios
automáticos estavam ativos; 14 anúncios estavam ativos no ML e seis pausados.
Cinco dos 20 também pertenciam ao grupo separado de 44 anúncios sem capacidade.

“Anúncio irmão” é o anúncio comum do mesmo produto/SKU e User Product de um
anúncio de catálogo. Nos seis casos dessa classe, o anúncio de catálogo estava
coerente; o campo `MODEL` do anúncio comum mantinha a divergência ou grafia
descritiva. A avaliação deve incluir os dois IDs antes de encerrar o bloqueio.

## Causa identificada

- O extrator de `Modelo:` às vezes incluía campos seguintes da descrição DSLite,
  e o separador ` - ` cortava códigos como `CT - 1 - BK`.
- A comparação literal tratava um modelo explícito da DSLite como diferente do
  mesmo modelo dentro do rótulo descritivo do ML. O código agora aceita essa
  apresentação somente com SKU, GTIN e marca exatos, sem aceitar código
  alternativo ou divergência numérica.
- Para kits homogêneos, a validação comparava o número de cartelas com o número
  de pilhas. As composições comprovadas são 2×2=4, 3×5=15 e 6×6=36.
  O kit de quatro pilhas aparece no catálogo como duas cartelas, uma unidade por
  cartela; título, SKU, marca e GTIN do componente foram conferidos. A exceção
  exige ainda `PACKS_NUMBER=2` e não se aplica a kits sem prova de composição.
- Duas marcas mestras locais não refletiam a marca registrada na oferta DSLite:
  `VTK006362` continha o número `1120727` em vez de `BRASFORT`;
  `VTK003638` continha `Philips` em vez de `PHILIPS WALITA`.
- As grafias `Bori`/`Bo Ri` e `LESON`/`Le Son` representam o mesmo nome nos
  respectivos produtos com SKU e GTIN coincidentes. O fornecedor Vanral também
  usa New York e NY-F1RST para a linha dessas baterias; o ML mostra ainda a
  grafia `Ny F1rst`. Equivalências explícitas evitam generalizar por
  semelhança textual para marcas não verificadas.

## Mudança de código

`ml-critical-attributes.ts` extrai o modelo até o próximo campo rotulado,
calcula o total dos kits com a quantidade por cartela do componente e aceita
a representação de cartelas do catálogo somente com prova completa.
`ml-listing-identity.ts` reconhece o modelo da DSLite dentro de um rótulo mais
longo do ML com as âncoras fortes descritas acima. Conflitos de código, GTIN,
SKU, marca ou quantidade não comprovada permanecem bloqueados. A regra vale
para anúncios existentes; não dispensa validações de criação/publicação.

## Conferência após a implantação

1. Releitura dos 20 itens e seis pares na conta correta, sem supor que o
   snapshot anterior continue atual.
2. Registrar as equivalências verificadas e corrigir as duas marcas locais
   com leitura anterior e posterior; nenhuma dessas ações altera preço/estoque.
3. Corrigir no ML somente atributos que continuarem realmente diferentes da
   DSLite e forem editáveis, lendo antes o item e o User Product. Conferir a
   propagação assíncrona e preservar preço, quantidade e estado.
4. Encerrar somente linhas automáticas `ml_identity_gate` de itens cujo próprio
   anúncio e par estejam comprovadamente válidos. Pausas manuais permanecem.

## Resultado em produção

O código foi validado em `dev` e promovido pelo SHA
`94724a0840a938b7bd4e0227dc7c6dcbcb991056` para `bentevi-prod`.
O webhook produtivo aceitou o deploy; a rota de saúde de `app.bentevi.shop`
continuou respondendo e o tempo de vida do processo reiniciou após o envio.
A rota de saúde não expõe o SHA executado, então o SHA do container não foi
comprovado diretamente.

- Em `192.168.1.162`, `VTK006362` passou de marca `1120727` para `BRASFORT`
  e `VTK003638` de `Philips` para `PHILIPS WALITA`, conforme as ofertas DSLite
  de mesmo GTIN. Foram registradas quatro equivalências exatas:
  `Bori`/`Bo Ri`, `LESON`/`Le Son`, `New York`/`NY-F1RST` e
  `NY-F1RST`/`Ny F1rst`. A releitura confirmou as seis mudanças.
- No ML, foram corrigidos `MODEL` de `MLB7111645058` para
  `Micro Ventilador Mini (Cod. 19134)`, `MODEL` de `MLB7111649036`
  para `CT-1-BK` e `BRAND` de `MLB7597882660` para
  `SOHOPLUS - FURUKAWA`. Cada PUT teve backup e releitura imediata;
  preço, quantidade, estado, SKU e GTIN foram preservados.
- A releitura dos 20 IDs e de todos os dez outros anúncios cadastrados nos
  mesmos 19 produtos classificou os 20 próprios como seguros. Entre os dez
  associados, oito ficaram seguros e dois têm marca diferente na ficha de
  catálogo do ML. A busca oficial por SKU e a relação dos pares foram
  conferidas; 17 dos 19 grupos tiveram vínculo completo.
- Foram encerrados 18 bloqueios ativos criados por `ml_identity_gate`.
  Permaneceram dois bloqueios automáticos: `MLB7111545754` / `VTK003638`,
  cujo catálogo associado `MLB7149369808` usa `BRAND=Philips` em vez de
  `PHILIPS WALITA`; e `MLB6573107140` / `VTK006362`, cujo catálogo
  `MLB4621152043` está encerrado com `BRAND=1120727` em vez de `BRASFORT`.
  As próprias fichas de catálogo `MLB38516321` e `MLB47710319` contêm
  esses valores, portanto a correção exige tratamento no catálogo do ML.
  Não foram criadas equivalências para essas marcas diferentes.
- Após a liberação, os 59 IDs distintos dos grupos de identidade e capacidade
  mantiveram estado e quantidade remotos. Os 44 sem capacidade continuaram
  pausados com quantidade zero. Nenhuma pausa manual foi removida.

Os testes direcionados (52 casos), `npm run validate`, `npm run build`,
`npm run check:build-secrets` e `git diff --check` passaram. O teste
`m2m-cfl-02-consumers.test.js` continua falhando por fixture preexistente
sem mock de `@/lib/ml/brand-equivalences`; não foi tratado como aprovação.
