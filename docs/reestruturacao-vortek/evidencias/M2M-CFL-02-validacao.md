# M2M-CFL-02 — Identidade, embalagem e quantidade

Data: 07/09/2026. Base: `26a255e`, branch `dev`, working tree inicialmente limpa.

## Resultado e limite

Implementação e validação local concluídas. Sem migration, chamada autenticada ao ML, acesso ao banco, deploy, push ou produção. A guarda `pricing_execution_not_ready` permanece: este trabalho não habilita publicação, reprecificação ou pausa autônoma. CFL-03 e CFL-04 não foram executadas.

## Fotografia AS_IS → TO_BE

| Antes | Agora |
| --- | --- |
| Lista vazia de divergências admitia atributos ausentes como validação | Cobertura, evidências, motivos e estado explícitos por dimensão/atributo |
| SKU/GTIN podiam autorizar substituir marca local pela marca ML | Divergência de marca é material; não altera marca automaticamente |
| 120 V convertido implicitamente para 127 V | Equivalência não presumida; revisão inconclusiva |
| Produto split implicava duas caixas | Volume de transporte exige declaração explícita; não é quantidade vendida |
| Verificação ignorava apresentação/seleção de variação | Quantidade comercial e variação selecionada avaliadas sem misturar atributos de variantes |
| Falha de read-back usava resposta inicial da criação | Falha é explícita e não provoca pausa por evidência ausente |

## Contrato e fontes

`ml-listing-identity.ts` compara fatos normalizados e retorna `identityState`, avaliações `identity` e `packaging_quantity`, comparações, motivos, cobertura e provas compatíveis com CFL-01. `ml-critical-attributes.ts` continua responsável por resolver fatos locais e oferta preferencial ativa, reutilizando a política existente.

- Atributo ausente vira `PENDENCIA_VALIDACAO`; fonte contraditória, inválida ou duvidosa vira `INCONCLUSIVO`.
- Divergência material comprovada entre fontes válidas vira `CONFLITO_CONFIRMADO`.
- GTIN equivalente não elimina divergência de marca/modelo/apresentação. Divergência de SKU isolada não prova outro produto.
- Identificadores, fonte, timestamp e condição acompanham a evidência; ausência de metadados não é substituída por timestamp inventado.
- Categoria define aplicabilidade, valores oficiais e atributos críticos/obrigatórios. Categoria indisponível não produz aprovação silenciosa.
- Variação deve ser selecionada de forma inequívoca; GTIN e atributos variáveis não são herdados arbitrariamente do item raiz.
- Dados normalizados contemplam GTIN, marca, modelo, part number, cor, tensão, diâmetro e apresentação quando disponíveis. Normalização não fabrica especificação.
- Extração textual reconhece declarações explícitas, não qualquer descrição livre. Formatos não reconhecidos permanecem pendentes.
- Unidades por embalagem, número de packs e caixas/volumes de transporte são fatos distintos.
- Composição usa `produto_kits`/`produto_kit_componentes` existentes e consulta componentes em lote. Quantidade de componentes não prova unidades por componente. Kits compostos sem prova remota suficiente da composição permanecem pendentes.
- Não foram criadas tabelas, migrations, dependências, jobs ou fontes administrativas paralelas. As skills de DEV/Supabase orientaram reutilização das estruturas existentes e leitura em lote, sem operação no servidor.

## Consumidores migrados

| Consumidor | Mudança |
| --- | --- |
| `api/ml/anuncio/schema` | Preenchimento crítico somente com fato comprovado; lista usa valor oficial correspondente |
| `api/ml/anuncio/criar` | Mesma fonte crítica e avaliação; categoria conferida antes de limpar bloqueio; read-back obrigatório; sem reconciliação automática de marca |
| `api/sync/anuncios` | Observação preservada; pendência não cria novo vínculo por SKU, não limpa bloqueio e não deriva ações sobre produto |

Somente identidade e apresentação completas e coerentes permitem chamar a limpeza existente de bloqueio automático; proteção de bloqueios manuais permanece no helper existente. Conflito confirmado mantém o caminho de bloqueio local já existente. A rotina de pausa pós-criação é preexistente e continua atrás da guarda comercial; ausência de evidência/read-back não a aciona por identidade. Não foi criado executor novo. Avaliar identidade não resolve vínculo/grupo nem economia e não concede autorização comercial.

Categoria e composição são reutilizadas por chave somente durante a execução do sync; não foi criado cache persistente. Observações dos anúncios continuam sendo registradas, separadas de decisões sobre o produto.

## Testes e evidências executadas

118 testes direcionados aprovados (0 falhas), executando:

```sh
node --test tests/m2m-cfl-02-identity.test.js tests/m2m-cfl-02-consumers.test.js tests/m2m-cfl-01-conflicts.test.js tests/ml-critical-attributes.test.js tests/ml-identity-block-lifecycle.test.js tests/m2m-prc-03-execution.test.js tests/preferred-offer.test.js tests/ml-virtual-kit-orders.test.js tests/ml-listings-observed-batch.test.js
npm run validate
npm run build
```

Os dois arquivos novos cobrem 29 casos de identidade e 7 casos de consumidores. Incluem fontes ausentes/contraditórias, provas independentes, apresentação, kits, variantes, valores oficiais, tensão nominal versus alimentação, 120/127, diâmetro e unidades equivalentes. Testes dos consumidores executam trechos reais da decisão de sync/preenchimento com dependências simuladas; read-back e guarda de execução também possuem verificações estruturais. Não equivalem a teste ponta a ponta autenticado.

Regressões adicionais: contrato CFL-01, atributos críticos, lifecycle de bloqueios, bloqueio de escrita comercial, preferência ativa, kits virtuais e observação em lote. `npm run validate` e build concluíram com código de saída 0.

## Documentação oficial consultada

- [ML — Variações](https://developers.mercadolivre.com.br/pt_br/variacoes): atributos por variação e leitura com `include_attributes=all`.
- [ML — Identificadores de produtos](https://developers.mercadolivre.com.br/pt_br/identificadores-de-produtos): identidade/GTIN.
- [ML — Validações](https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/validacoes): formato de venda e unidades por embalagem.
- [Supabase — Select](https://supabase.com/docs/reference/javascript/select): projeções/leitura dos registros existentes.

As páginas ML foram consultadas pelo conteúdo oficial indexado; abertura direta apresentou bloqueio 403. Não houve consulta autenticada a anúncio real nesta entrega.

## Pendências, riscos e rollback

- Homologação externa/deploy não executados nesta tarefa; não há mudança visual pretendida.
- Dados insuficientes podem ampliar a fila de revisão. Isso não autoriza completar GTIN, marca, unidade ou embalagem por suposição.
- Kits heterogêneos precisam de evidência da composição remota para conclusão; não se presume que o primeiro componente represente todo o kit.
- Escritores comerciais permanecem fechados. Seu gate deve validar preparação/criação ponta a ponta antes de habilitá-los.
- Frete vivo ME2 permanece para conexão autorizada da conta real, conforme decisão registrada em PRC-04; bloqueia liberação comercial, não o próximo desenvolvimento.
- Próxima ação: planejar `M2M-CFL-03 / BNT-PRICING-V2-07 — Vínculos e grupos de anúncios`.
- Rollback: reversão seletiva deste commit em `dev`, nova validação antes de eventual deploy. Não há migration ou dado externo desta tarefa a desfazer. Reverter código não autoriza habilitar a política antiga ou remover a guarda comercial.
