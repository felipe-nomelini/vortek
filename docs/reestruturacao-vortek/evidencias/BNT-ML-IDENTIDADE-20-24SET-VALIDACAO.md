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

Este documento registra a regra e o método; os resultados produtivos e o SHA
aplicado devem ser acrescentados depois do read-back real.
