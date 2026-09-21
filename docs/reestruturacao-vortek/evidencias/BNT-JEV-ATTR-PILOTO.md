# Piloto Jev — atributos de anúncios

**Data:** 21/09/2026. **Escopo:** comparação interna, somente leitura, sem ativar Jev no Bentevi e sem publicar ou alterar anúncios.

## Execução

O comparador `scripts/jev-attribute-pilot.js` lê produtos, ofertas de fornecedores operacionais e categorias do Supabase Bentevi `.162`, consulta por `GET` os atributos e a predição de categoria do Mercado Livre e envia à TypeSafe apenas nome, marca, descrição, evidência textual do fornecedor e opções oficiais dos atributos. Preço, dados de clientes e credenciais não entram no estado enviado. A referência executa as funções vigentes de `preencher-inteligente/route.ts` sem copiar suas regras.

O modelo foi fixado em `jev-1.13.0`. Entram apenas atributos `list` com 2 a 25 opções, excluindo atributos ocultos, fixos e críticos para a identidade do produto. A opção `no_evidence` permite não sugerir valor. Confiança abaixo de 0,6, erro da API ou resposta inválida é inconclusiva. Esse limite de confiança é provisório e não foi calibrado para o catálogo.

Para repetir o ensaio, configure `TYPESAFE_API_KEY` apenas no ambiente privado local e execute `node scripts/jev-attribute-pilot.js`. `--prepare` seleciona os casos sem chamar a TypeSafe. Relatórios completos são gerados em `reports/jev-attributes/`, fora do Git, com acesso local restrito. A chave não é registrada no relatório.

## Resultado observado

| Medida | Resultado |
|---|---:|
| Produtos e categorias inspecionados | 45 e 27 |
| Casos selecionados | 22 atributos, 18 produtos e 13 categorias |
| Chamadas TypeSafe | 18, sem erro |
| Avaliações com confiança ≥ 0,6 | 20 |
| Concordâncias com o preenchimento atual | 12 |
| Divergências | 8 |
| Respostas inconclusivas | 2 |
| Divergências com sugestão Jev apoiada pela evidência | 5 |
| Divergências que exigem critério/revisão da categoria | 3 |
| Tokens de entrada e custo estimado | 16.688; US$ 0,000701 |
| Tempo por chamada, mediana e máximo observados | 302 ms; 791 ms |

As cinco sugestões sustentadas pela descrição e pelas opções oficiais foram: montagem em parede de suporte de TV, palheta para saxofone, dois produtos explicitamente descritos como conectores e cabo P2–P10 como cabo adaptador. A divergência de “cores sortidas” não prova que cada unidade seja multicolorida. Em dois cabos de microfone, a categoria só oferece `Fio`, `Cabo adaptador` e `Adaptador`; a evidência não resolve com segurança se `Fio` deve ser usado ou se o campo deve ficar vazio.

**Limite da conclusão:** concordância não demonstra acerto, e a revisão manual cobriu as oito divergências, não todos os casos. O ensaio indica valor para sugerir opções fechadas em lacunas específicas, com revisão humana. Não autoriza preencher automaticamente, modificar o anúncio ou trocar a regra atual. A amostra e os limites de confiança devem ser ampliados e calibrados antes de qualquer proposta de integração ao formulário.

## Validação e preservação

Passaram os seis testes direcionados de reutilização da regra atual, seleção, minimização de dados, validação de resposta e falhas da API. `npm run validate` passou. O script usa somente `SELECT` no Bentevi, `GET` no Mercado Livre e `POST /v1/systemone` para avaliação; não há DDL, migration, escrita no banco, publicação ou alteração remota de anúncios. O trabalho permanece na `dev`; a produção da aplicação não recebe esta ferramenta interna.
