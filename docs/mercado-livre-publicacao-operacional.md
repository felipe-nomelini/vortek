# Publicação Mercado Livre — Procedimento Operacional

Este documento registra regras práticas validadas na criação de anúncios do Vortek.

## Estado da execução Bentevi DEV — 09/09/2026

O PUB-GATE publicado em DEV (`9a18ff8f`) substitui a criação direta por preparação, aprovação explícita, operação/outbox, worker e conferência. O formulário de preço também encaminha proposta à central; a rota de preço bruto continua bloqueada. A capacidade nova está **desabilitada por padrão**, restrita à conta de teste/allowlist/DEV e banco `.162`. Os testes locais não substituem a prova no ML: o seller de teste está conectado/verificado, mas o aceite autenticado e a prova externa limitada ainda estão pendentes. [Contrato, evidências, rollback e pendências do marco 1](reestruturacao-vortek/evidencias/BNT-CANON-PUB-GATE-tecnico-validacao.md).

**Estado atual:** o recorte técnico do marco 1 continua concluído para sequência e seu aceite autenticado/prova externa permanece transferido ao marco 6 de [Bentevi em operação](reestruturacao-vortek/VORTEK_ITEM_17_CHECKLIST_EXECUCAO.md#bentevi-em-operacao). A capacidade produtiva controlada foi preparada e validada em `dev` por `BNT-REL-WRITER-01`, mas segue `disabled` por padrão e não foi publicada nem ativada. Conta real e escritas continuam permitidas somente na ativação autorizada pelo workspace produtivo. [Evidência técnica](reestruturacao-vortek/evidencias/BNT-REL-WRITER-01-validacao.md).

### Modo produtivo controlado — preparado, não ativado

- `ML_PRICING_EXECUTION_MODE=production_controlled` somente produz capacidade quando o runtime é `production`, a origem é exatamente `https://app.bentevi.shop`, o Supabase resolve exclusivamente para `.162`, o seller está na allowlist e `/users/me` comprova conta `MLB` sem a tag `test_user`.
- `test_only` preserva o contrato de homologação, incluindo conta `test_user`; `disabled` permanece o padrão.
- Aprovação e aplicação continuam separadas e feitas pela mesma pessoa autorizada (`admin` ou `gerente`). Produção acrescenta confirmação final explícita com produto, SKU e preço antes de enfileirar.
- O executor canônico conserva claim único, revalidação imediatamente antes do envio, auditoria, captura do ID remoto, read-back e recuperação sem reenvio após resultado incerto. Escritores legados permanecem bloqueados.
- Em criação produtiva, o anúncio usa o nome comprovado do produto. O aviso `Item de Teste` existe somente em `test_only`.

Essas condições não reclassificam a `.162`, não configuram o serviço `local/bentevi-prod` e não autorizam testes reais. A ativação continua subordinada ao corte produtivo e ao marco 6.

Não reenviar criação ou preço após resultado incerto. A central pode solicitar nova conferência da mesma operação, sem repetir a mutação. Nenhuma destas regras autoriza anúncio real, publicação em massa ou escrita em produção.

## Regra central

Não criar anúncio até validar, por produto e por categoria:

1. categoria ML precisa;
2. atributos obrigatórios e condicionais;
3. valores permitidos pela categoria;
4. dados do fornecedor/fabricante e imagens;
5. preço, estoque e logística.

Nunca inventar especificação. Quando não houver evidência, usar `Não se aplica` apenas se a categoria aceitar.

## Fluxo obrigatório

1. Consultar produto local, oferta do fornecedor, GTIN, dimensões, peso, descrição e fotos.
2. Consultar previsão de categoria e validar domínio/categoria retornados pelo ML.
3. Consultar `GET /categories/{CATEGORY_ID}/attributes`.
4. Consultar atributos condicionais via `POST /categories/{CATEGORY_ID}/attributes/conditional` com payload completo.
5. Pesquisar fabricante/fornecedor/web quando atributo crítico estiver ausente.
6. Para atributos `list`, enviar o `value_id` oficial; não enviar texto livre fora da lista.
7. Criar um anúncio por vez e confirmar retorno ML antes do próximo.
8. Após criar, consultar item, atributos, descrição, imagem, status e substatus.

## Atributos

### Dados confirmados

Preencher com fonte confiável: fabricante, fornecedor, GTIN, embalagem ou documento técnico.

Exemplos:

- `MODEL`: modelo real do fabricante.
- `MOUNTING_PLACES`: usar valor oficial da lista. Para suporte Multivisão Easy, fornecedor informa parede e painel de madeira; ML aceita `Parede` (`value_id: 7720908`). "Painel de madeira" deve ficar na descrição.
- Cabo RCA: preencher tipo, comprimento, diâmetro, quantidade e gênero dos conectores quando confirmados.

### Não se aplica

Para atributos sem evidência ou incompatíveis com produto, enviar:

```json
{
  "id": "ATTRIBUTE_ID",
  "value_id": "-1",
  "value_name": null
}
```

Não usar `"value_name": "Null"`: ML pode aceitar HTTP 200 e descartar valor. Confirmar depois com:

```text
GET /items/{ITEM_ID}?attributes=attributes&include_internal_attributes=true
```

Preencher todos atributos visíveis da categoria: dado confirmado ou `Não se aplica`. Excluir somente atributos ocultos/fixos.

## Descrição

Descrição deve ser texto simples, factual e escaneável. Não copiar descrição bruta do fornecedor como bloco único.

Estrutura padrão:

```text
NOME DO PRODUTO

Resumo objetivo: produto, aplicação/compatibilidade e uso.

CARACTERÍSTICAS
• especificação confirmada
• especificação confirmada

BENEFÍCIOS
• benefício derivado de especificação confirmada
• benefício derivado de especificação confirmada

DIMENSÕES DA EMBALAGEM
• comprimento x largura x altura
• peso bruto

SKU: ...
```

Usar quebras de linha e bullets. Não prometer função, compatibilidade, certificação ou desempenho sem evidência.

Atualizar descrição existente com:

```text
PUT /items/{ITEM_ID}/description?api_version=2
```

## Imagens

### Requisito

URL de imagem precisa ser pública, estática, direta, sem redirecionamento e retornar `Content-Type` de imagem. Preferir JPG/PNG, mínimo 250 px em ambos lados e um lado maior que 500 px.

### Falha encontrada

URLs `https://evolusom.com.br/...jpg` retornavam:

```text
HTTP 301
Content-Type: text/html
```

ML não aceitou redirecionamento e deixou itens em `picture_download_pending`, depois `under_review / waiting_for_patch`.

### Correção padrão

1. Baixar origem direta (Evolusom usa `https://www.evolusom.com.br/...`).
2. Validar status HTTP, Content-Type e dimensões.
3. Salvar cópia no bucket público Supabase `product-images`.
4. Atualizar `produtos.imagens` com URL pública Vortek.
5. Atualizar ML via `PUT /items/{ITEM_ID}` com:

```json
{
  "pictures": [{ "source": "https://supabase.vortek.shop/storage/v1/object/public/product-images/..." }]
}
```

6. Consultar `/pictures/{PICTURE_ID}/errors` e status do item até processar.

Nunca usar URL de fornecedor que retorna 301/302, HTML, bloqueio ou Content-Type incompatível.

## Estados pós-publicação

- `paused` + `picture_download_pending`: ML está baixando imagem por URL.
- `under_review` + `waiting_for_patch` + `picture_download_pending`: imagem anterior falhou; reenviar URL válida.
- `active`: publicação liberada.

Não tratar criação como concluída enquanto imagem e ficha não forem verificadas.

## Verificação final por anúncio

1. `ml_item_id` salvo no produto e em `anuncios_ml`.
2. Categoria/dominio corretos.
3. Atributos principais preenchidos.
4. Todos secundários preenchidos com dado real ou `Não se aplica`.
5. Descrição com resumo, características, benefícios e dimensões quando disponíveis.
6. Foto no Storage Vortek e URL pública direta.
7. Diagnóstico de imagem sem erro.
8. Status/substatus ML compatíveis com processamento ou publicação ativa.

## Safe Publication Mode — procedimento superado, não executar

O procedimento histórico de criar primeiro e aplicar depois margem protetiva mínima de 50% foi superado pelo [Cânon Comercial 1.0](reestruturacao-vortek/VORTEK_CANON_COMERCIAL_V1.md), especialmente seções 2, 7, 20 e 23. Não é um motor alternativo nem autorização de publicação. A versão anterior permanece no histórico Git; não substituir 50% por outro percentual arbitrário.

Na Bentevi V2, a preparação deve usar economia canônica, evidências compatíveis de tarifa/frete, identidade, conflitos, garantia e grupo, com confirmação autorizada e read-back. Alvo é referência para preço novo; margem mínima e exceções seguem exclusivamente o cânon. Dado inconclusivo não autoriza inventar proteção ou executar ação destrutiva.

Os bloqueios comerciais da PRC-03 permanecem. A [fila reconciliada](reestruturacao-vortek/VORTEK_BENTEVI_PRICING_V2_PLANO.md#14-fila-obrigatória) entrega os contratos antes do `BNT-CANON-PUB-GATE`; esta correção documental não habilita código, não altera anúncios existentes e não executa ML. Dimensões normalizadas pelo Mercado Envios não substituem silenciosamente o cadastro mestre do fornecedor.

## Preços por Quantidade (B2B) — aposentado na Bentevi V2

O [Cânon Comercial 1.0, seção 12](reestruturacao-vortek/VORTEK_CANON_COMERCIAL_V1.md) substitui o procedimento anterior de desconto automático. A V2 não recomenda, configura nem publica faixas por quantidade, inclusive 3un/3%, 5un/4% e 10un/5%. Compras múltiplas mantêm o preço unitário.

- APIs de aplicação e prévia retornam HTTP 410 `quantity_pricing_retired`, após autenticação.
- Configurações não possuem editor nem parâmetros operacionais de faixas; tabela/auditoria antigas são exclusivamente históricas.
- Outbox antiga somente de atacado é cancelada sem ML/retry. Em payload misto, a intenção aposentada é descartada, preservando operações legítimas e os gates de preço existentes.
- Consulta de descontos já existentes no ML permanece informativa no detalhe, sem ação de alteração/remoção. `GET /items/{ITEM_ID}/prices` com `show-all-prices: true` permite ler esses dados.
- Não executar o procedimento histórico de recomendações ou remoção/migração de descontos remotos. A retirada de descontos já publicados exige tarefa e autorização específicas.

Evidência da retirada: [BNT-CANON-QTY-01](reestruturacao-vortek/evidencias/BNT-CANON-QTY-01-validacao.md).

## Consulta múltipla de itens

Desde `2026-09-05`, toda consulta múltipla de anúncios do Vortek deve usar `GET /items/bulk?ids=...`. O endpoint legado `GET /items?ids=...` não pode ser reintroduzido, embora o Mercado Livre mantenha convivência temporária até `2026-10-25`.

Contrato obrigatório:

1. enviar no máximo 20 IDs por chamada;
2. solicitar campos do item com prefixo `body.`, por exemplo `attributes=body.title,body.status`;
3. ler o identificador em `id`, na raiz de cada resultado;
4. ler o status individual em `status_code`;
5. ler os demais campos em `body` somente quando `status_code = 200`;
6. não criar fallback para o endpoint legado.

O helper canônico para rotas web é `src/lib/ml/items-bulk.ts`. Scripts operacionais isolados devem preservar o mesmo contrato.

## Runbook — Incidente OAuth Mercado Livre (`auth_fatal`)

Consolidado do antigo `GUIDE.md` em 09/09/2026. Conferido com `getMLAuthDiagnostics`,
os endpoints de saúde e o dispatcher atuais. Este procedimento é de recuperação;
a limpeza do repositório não executa sincronizações nem reautenticações.

### Sintomas e diagnóstico

- Respostas `401 auth_fatal`, jobs em `failed_auth` ou integração desconectada.
- Consultar `/api/ops/health` ou `/api/sync/cron-status`: `ml_auth.state = reauth_required`
  ou `blocked_until` ativo identifica o bloqueio. `state = degraded` exige investigar
  o erro de leitura/refresh antes de concluir que a reautenticação é necessária.
- Conferir em `integracoes` do tipo `mercadolivre`: `conectado`, `last_refresh_at`,
  `last_refresh_error` e `last_refresh_error_code`, sem reproduzir tokens.
- Erros fatais incluem `invalid_grant`, `invalid_client`, `unauthorized_client` e
  `unauthorized_application`. O dispatcher registra `skipped_auth_block` para
  tarefas ML e `queue_skipped_auth_block` para a fila enquanto houver bloqueio.

### Recuperação e aceite

1. Reautenticar a integração no painel pelo fluxo OAuth connect/callback.
2. Confirmar `conectado = true`, ausência de erro fatal e `ml_auth.state = ok`.
3. Quando houver autorização para sincronizar nesse ambiente/conta, validar
   `POST /api/sync/anuncios` e `POST /api/sync/pedidos` e acompanhar o scheduler.
4. Encerrar após dois ciclos de cron sem novos `401 auth_fatal`, jobs concluindo
   como `completo` e `ml_auth.blocked_until` nulo.

Em desenvolvimento, aplicar as restrições de homologação: banco `.162` e conta
de teste ou integração desabilitada. Recuperação de produção pertence ao workspace
`vortek-prod` com autorização própria. Não publicar nem reprecificar anúncios como
parte deste procedimento.

## Fontes oficiais

- https://developers.mercadolivre.com.br/pt_br/pt_br/publicacao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/atualiza-tuas-publicacoes
- https://developers.mercadolivre.com.br/pt_br/como-comecar/qualidade-das-publicacoes
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos
- https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos
- https://developers.mercadolivre.com.br/pt_br/realizacao-de-testes/trabalhar-com-imagens
- https://developers.mercadolivre.com.br/pt_br/envio-de-produto/diagnostico-de-imagens
- https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/pxq-porcentagem-b2b
- https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/itens-e-buscas
- https://supabase.com/docs/guides/storage/serving/downloads
