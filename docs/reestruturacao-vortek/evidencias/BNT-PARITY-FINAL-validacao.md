# BNT-PARITY-FINAL — auditoria comportamental final

Data: 09/09/2026

Situação: classificação concluída; promoção ainda bloqueada

## Resultado

Após `git fetch --prune`, foram auditados individualmente os 20 commits de
`origin/main` posteriores ao último watermark consolidado. Cada comportamento
essencial recebeu uma classificação e um destino explícito na arquitetura
Bentevi. Nenhum commit ou histórico foi integrado entre as branches.

| Referência | SHA |
| --- | --- |
| Baseline legado anterior | `7f0a2921fe986562c348e75b16c319ab25076a97` |
| `origin/main` auditada | `2fc441f67d1457a154b3bd475d4f0e68b032551a` |
| Serviço legado, última confirmação oficial em 09/09/2026 | `2fc441f67d1457a154b3bd475d4f0e68b032551a` |
| `origin/dev` auditada após os writers | `2c910ae761e902a2797dee8e404826cbe2086ea9` |
| Ancestral comum preservado | `08b6237428c406b55a876578b63dbc553e8c9584` |

O intervalo contém zero migration. Isso não encerra `DELTA_PROMOCAO`: os
históricos e schemas anteriores continuam diferentes e exigem ação própria.

## Matriz dos 20 commits

| Commit | Comportamento relevante | Classificação e destino |
| --- | --- | --- |
| `4a408329` | fallback de garantia do vendedor por 30 dias | `SUBSTITUÍDA`: a Bentevi exige evidência por produto e não fabrica prazo |
| `90bbabb3` | preparação, trava de duplicidade, auditoria e readback de lote | `SUBSTITUÍDA`: objetivos atendidos pelo PUB-GATE canônico; runner/coorte não serão copiados |
| `05c0e27f` | fingerprint do catálogo vivo e URL de imagem pública conferida | `INCORPORAR`: `BNT-REL-ML-PREFLIGHT-01` |
| `f00836ac` | warnings conhecidos do validador aceitos sem dispensar erro material | `INCORPORAR`: `BNT-REL-ML-PREFLIGHT-01` |
| `ec51185d` | pedido de criação, identidade remota, memória e readback preservados | `EQUIVALENTE`: operation/claim, captura durável e readback do PUB-GATE |
| `9014ee95` | comparação econômica pré e pós-publicação | `EQUIVALENTE`: memória canônica e trilha de decisão; script pontual não será copiado |
| `38db55ea` | relatório D0 e evidência de lote | `NÃO COPIAR`: evidência histórica, sem autorização futura |
| `8ecb22d7` | logs de build, testes e execução do lote | `NÃO COPIAR`: permanecem vinculados somente ao SHA legado |
| `12340852` | encerramento autorizado de observações de pricing | `SUBSTITUÍDA`: experimentos legados não continuarão no Bentevi |
| `ed8f2218` | tributo arredondado incluído na resolução do preço alvo | `EQUIVALENTE`: economia em centavos, teto tributário exato e refinamento até o alvo |
| `4089b4f9` | executor e relatório de correção pontual de preços ativos | `NÃO COPIAR`: preços vigentes serão preservados como dados; writer histórico não será executado |
| `304cf1db` | revisão de categoria, identidade do fornecedor e tentativa de substituição | revisão integral de categoria `INCORPORAR` em `BNT-REL-ML-CATEGORY-01`; identidade `EQUIVALENTE`; substituição `SUBSTITUÍDA` por `BNT-REL-ML-DELETE-01` |
| `dd349804` | safety stop isolado por tentativa de substituição | `SUBSTITUÍDA`: não haverá tentativa de substituição ou recuperação |
| `ca0b8b35` | moderação posterior interrompe o lote | `EQUIVALENTE`: criação inconclusiva não repete mutação; automação em lote não será copiada |
| `3ed7f127` | lote para na primeira falha e relata estado corrente | `NÃO COPIAR`: não existe lote produtivo automático no recorte inicial; falha individual permanece terminal/inconclusiva |
| `8ef8e7b7` | lucro vivo no preview e confirmação visual | `EQUIVALENTE`: Anúncios usa pricing canônico e exibe lucro atual/proposto |
| `ae059653` | resolução de parada para item excluído | `SUBSTITUÍDA`: `deleted` é terminal; nova publicação será uma nova entidade |
| `82f0425a` | dedupe entre SKUs e conciliação de excluídos | dedupe/propriedade `EQUIVALENTE`; conciliação de excluído `SUBSTITUÍDA` |
| `518bcd40` | comparação de `LENGTH` entre unidades equivalentes | `INCORPORAR`: `BNT-REL-ML-UNITS-01` |
| `2fc441f6` | substituição autorizada de anúncio excluído | `SUBSTITUÍDA`: `BNT-REL-ML-DELETE-01` implementará criação nova, nunca recuperação |

## Decisões de transição

### Anúncio deletado

- `deleted` é permanente para o item antigo: ele nunca será recuperado,
  reativado ou reutilizado.
- Se o produto precisar voltar a ser anunciado, a operação criará outro item,
  com nova autorização e novo identificador.
- Antes do novo POST, serão obrigatórias leitura autoritativa do item antigo em
  `deleted`, busca completa por todos os SKUs e ausência de anúncio ativo,
  pausado, duplicado ou vínculo inconclusivo.
- O histórico local permanece auditável, mas deixa de ser ponte para o item
  novo. O comportamento atual ainda bloqueia todo histórico `deleted` e precisa
  ser adaptado em `BNT-REL-ML-DELETE-01`.

### Experimentos de pricing legados

- Por decisão do responsável, estados, coortes e checkpoints da `main` não
  serão migrados nem continuados.
- Os preços observados no momento do corte serão preservados; a decisão não
  autoriza revertê-los ou alterá-los.
- O Bentevi começará com writers em confirmação explícita, sem segundo motor.
- O job legado deverá ser interrompido junto com o serviço legado no corte.

Não foi possível renovar nesta ação o agregado vivo da chave de experimento no
Supabase `.160`: o workspace contém somente configuração da `.162`, e a sessão
administrativa temporária usada anteriormente no Easypanel foi revogada. Nenhuma
credencial produtiva foi improvisada ou copiada. Como o destino aprovado é o
mesmo para `active`, `awaiting_director_decision` ou `closed`, a classificação
está encerrada; o readback agregado continua obrigatório no preflight do corte
para comprovar que o scheduler legado foi desativado.

## Bloqueadores nativos abertos

1. `BNT-REL-ML-DELETE-01` — tratar `deleted` como terminal e permitir uma
   publicação realmente nova somente após prova completa de ausência de vínculo.
2. `BNT-REL-ML-CATEGORY-01` — vincular categoria, árvore/domínio e evidência viva
   da oferta/produto do fornecedor; sugestão não equivale a comprovação.
3. `BNT-REL-ML-PREFLIGHT-01` — conferir alcance/conteúdo das imagens e aceitar
   somente warnings ML conhecidos e integralmente atendidos, mantendo qualquer
   erro material como bloqueio.
4. `BNT-REL-ML-UNITS-01` — comparar `LENGTH` por grandeza e unidade, incluindo
   polegadas, sem aplicar conversão a atributos não dimensionais.

São ações DEV separadas. Esta auditoria não implementa nenhuma delas. O release
também continua bloqueado por `DELTA_PROMOCAO`, dados, backup/recuperação,
inventário de runtime e demais aceites do marco 5.

## Validações executadas

- 20/20 commits confirmados por `git rev-list` e inspecionados por diff.
- zero migration no intervalo `7f0a2921..2fc441f6`.
- 193/193 testes direcionados aprovados para economia/tributo, identidade,
  vínculos, garantia, PUB-GATE, writers e interface de anúncios.
- 85/85 regressões do Assistente aprovadas porque o checklist é fonte
  documental consumida em runtime.
- Antes do commit dos writers: 46/46 testes direcionados, `npm run validate`,
  `npm run build` com Next.js 16.3.3 e 127 páginas/rotas,
  `npm run check:build-secrets` e `git diff --check` aprovados.
- Nenhum banco, serviço Easypanel, domínio, conta Mercado Livre, anúncio ou preço
  foi alterado. Não houve deploy nem migration.

Rollback documental: reverter o commit desta evidência por novo commit. Isso não
reverte `BNT-REL-WRITER-01` e não produz efeito externo.
