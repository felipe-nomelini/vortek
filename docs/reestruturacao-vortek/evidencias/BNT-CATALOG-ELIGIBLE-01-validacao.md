# BNT-CATALOG-ELIGIBLE-01 — Carregamento dos elegíveis ao catálogo

Data: 11/09/2026.

## Resultado

A página **Elegíveis ao catálogo** passou a consultar somente os anúncios
indicados pelo Mercado Livre para esse fluxo. A busca preserva os filtros ao
avançar pelas páginas e para assim que alcança o total informado pelo
provedor, sem varrer o restante da conta.

Uma falha de consulta também deixou de ser apresentada como uma lista vazia.
A tela mantém o último resultado válido, explica que não conseguiu atualizar
os dados e oferece a ação **Tentar novamente**.

## Causa confirmada

A primeira chamada ao Mercado Livre usava corretamente o filtro de anúncios
elegíveis. Nas chamadas seguintes, o cursor era enviado sem repetir esse
filtro e sem preservar a situação selecionada. Com isso, a API passava a
devolver anúncios comuns da conta.

Uma reprodução somente leitura do comportamento anterior acumulou 2.217
identificadores em 47 consultas e consumiu 14,6 segundos apenas nessa etapa,
antes de carregar elegibilidade, detalhes, vínculos e produtos de catálogo.
Esse trabalho excedente explicava a espera longa e o erro posterior. Como a
interface apagava as linhas ao receber uma falha, o usuário via uma tabela
vazia em vez da causa real.

## Correção

- o filtro de elegibilidade, a situação escolhida e o limite permanecem em
  todas as chamadas, inclusive depois do primeiro cursor;
- a busca usa o total declarado pelo Mercado Livre como condição de parada;
- identificadores repetidos são ignorados e cursores repetidos encerram a
  consulta como falha, sem devolver resultado parcial enganoso;
- detalhes, elegibilidade, vínculos locais e produtos de catálogo são
  obrigatórios para uma resposta bem-sucedida; falhas não são convertidas em
  campos vazios;
- a interface cancela consultas superadas por uma troca de filtro, preserva a
  última resposta válida e separa falha de uma lista realmente sem resultados;
- os tempos de cada etapa ficam registrados no servidor para diagnóstico, sem
  termos técnicos na mensagem apresentada ao usuário.

O contrato de sucesso da API foi preservado. A ação é exclusivamente de
leitura no Mercado Livre e no Supabase; não cria, altera, vincula, pausa ou
publica anúncios.

## Validação

- 15 cenários direcionados aprovados, incluindo filtro após cursor, parada pelo
  total, remoção de duplicados, cursor repetido, autenticação e comportamento
  visual de erro;
- regressão completa: 1.391 cenários, com 1.388 aprovados, nenhuma falha e três
  verificações externas explicitamente ignoradas;
- `npm run validate` aprovado, incluindo lint e TypeScript;
- `npm run build` aprovado com Next.js 16.3.3 e 128 páginas/rotas;
- `npm run check:build-secrets` aprovado;
- `git diff --check` aprovado;
- consulta real somente leitura: dois candidatos encontrados em uma chamada e
  182 ms, sendo um anúncio ativo e um pausado.

Não há migration ou mudança de schema. A promoção e a publicação usam uma
única ação com o SHA integral desta entrega; seus identificadores são
registrados no fechamento da tarefa, pois só existem depois que esta evidência
é versionada.

## Recuperação

O código pode ser desfeito por commit corretivo seguido do fluxo normal de
promoção e uma nova publicação. Não há dado, migration ou alteração remota no
Mercado Livre a reverter.
