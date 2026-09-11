# BNT-CATALOG-UX-01 — Atualização do catálogo e linguagem operacional

Data: 11/09/2026.

## Resultado

A atualização completa do Catálogo deixou de apresentar uma conclusão verde
quando nenhum anúncio foi atualizado. A interface agora distingue atualização
concluída, atualização com pendências e falha, informa o impacto em linguagem
direta e confirma que os dados anteriores foram preservados.

O mesmo limite de apresentação foi aplicado às páginas e componentes web:
mensagens técnicas continuam disponíveis nos contratos internos e nos logs,
mas códigos, estados de processamento e detalhes de infraestrutura não são
mais reproduzidos como orientação ao usuário.

## Causa e correção do catálogo

O recurso em lote do Mercado Livre devolve `id` e `status_code` na raiz de cada
resposta e os dados do anúncio em `body`. A projeção usada pelo Bentevi pedia
somente campos de `body`, eliminava os identificadores necessários para
associar a resposta ao anúncio e classificava todo o lote como indisponível.
Além disso, a finalização somava a mesma falha na fila e nos avisos, produzindo
14.034 avisos para 7.017 anúncios, e a tela tratava o estado parcial como
sucesso.

A correção:

- sempre solicita `id`, `status_code` e os campos necessários de `body`;
- mantém no máximo 20 anúncios por consulta ao recurso em lote;
- repete cada anúncio indisponível até três vezes;
- preserva a fotografia anterior quando as três tentativas não resolvem;
- não conta a mesma falha duas vezes;
- usa um resultado único para sucesso, pendência parcial e falha total;
- entrega à interface um título, uma explicação e uma próxima ação próprios
  para o usuário, sem exibir o nome do estado interno.

O procedimento de anúncios permanece subordinado ao
[contrato operacional do Mercado Livre](../../mercado-livre-publicacao-operacional.md).
Esta ação consulta anúncios e atualiza a fotografia local; não cria, altera
preço, pausa ou publica anúncios.

## Linguagem da aplicação web

Foi criado um limite compartilhado para mensagens de erro e de andamento. Ele
preserva mensagens de negócio conhecidas, mas substitui respostas com códigos,
nomes de tabelas, estados internos, detalhes HTTP, banco ou infraestrutura por
uma orientação curta e acionável.

Foram revisadas as áreas de Anúncios, Assistente, Catálogo, Clientes, Compras,
Configurações, Estoque, Fornecedores, Notas Fiscais, Pedidos, Perguntas,
Produtos, Ofertas, Reclamações, Reputação e os componentes compartilhados de
acompanhamento. Identificadores úteis ao trabalho, como SKU, GTIN, NF-e, PIX,
NCM, CEST e números do Mercado Livre, permanecem visíveis.

## Validação

- 33 cenários direcionados do catálogo e da linguagem aprovados;
- regressão completa: 1.385 cenários, sem falhas e com três verificações
  externas explicitamente ignoradas;
- `npm run validate` aprovado, incluindo lint e TypeScript;
- `npm run build` aprovado com Next.js 16.3.3 e 128 páginas/rotas;
- `npm run check:build-secrets` aprovado;
- `git diff --check` aprovado.

Não há migration ou mudança de schema nesta entrega. A publicação e a
conferência produtiva são feitas uma única vez com o SHA integral desta ação;
seus identificadores ficam no histórico do Easypanel e no registro final da
tarefa, pois são gerados somente depois que este arquivo já está versionado.

## Recuperação

O código pode ser desfeito por um commit corretivo seguido do fluxo normal de
promoção. A atualização do catálogo não remove a fotografia anterior dos
anúncios que falharem: essas linhas são marcadas como vistas na execução atual
e permanecem disponíveis até uma consulta posterior bem-sucedida. Não há
alteração remota de anúncio a ser revertida.
