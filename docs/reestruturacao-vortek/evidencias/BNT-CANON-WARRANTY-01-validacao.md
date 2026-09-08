# BNT-CANON-WARRANTY-01 — Garantia por evidência

Data: 07/09/2026. Base: `562ffa339cbd2cc65e22b609f2cbd64535fef7af`, branch `dev` inicialmente limpa.

**Estado: implementação local e banco DEV validados; pesquisa externa real e aceite visual pendentes. Não marcar o gate de garantia como homologado.** Nenhum push/deploy desta entrega, acesso à produção ou escrita no Mercado Livre.

## AS_IS → TO_BE

| Consumidor | Antes | Agora |
| --- | --- | --- |
| Configurações / Mercado Livre | Prazo/tipo global editável | Política por evidência; PATCH global retorna 410; colunas e auditoria históricas preservadas |
| Preparação do anúncio | Garantia global quando aceita pela categoria | Pesquisa pontual na primeira preparação, avaliação por produto, revisão e compatibilidade explícitas |
| Sugestão de atributos | Valores globais; possibilidade de cair no preenchimento genérico | WARRANTY_TYPE/TIME exclusivamente do resolvedor canônico, sem fallback de IA |
| Descrição | Texto podia repetir promessa sem comprovação | Texto específico do anúncio normalizado com garantia comprovada, sem alterar cadastro mestre |
| Criação | Termos globais/combinados com edição | Revisão atual obrigatória, termos coerentes e descrição sem promessa contraditória; bloqueio comercial mantido |
| Detalhe do produto | Sem comprovação administrável | Garantia em Comercial/estoque: fonte, trecho, prazo, revisão, domínio oficial e histórico |

## Contrato e decisões

- Fabricante comprovado → fornecedor comprovado → legal conforme classificação documentada: durável 90 dias; não durável 30 dias. Sem 12 meses universais e sem somar prazo contratual/legal.
- Fonte da informação não se confunde com concedente. Descrição da oferta ativa pode gerar candidato do fornecedor, nunca promessa do fabricante. `tempo_garantia` sem unidade documentada não gera duração. Referência interna `vortek:offer:<id>` vincula o candidato à oferta efetiva e requer revisão.
- Comprovação automática exige domínio previamente aprovado para aquela marca/fornecedor, trecho literal da página coletada, identidade do produto, duração e aplicação explícita no Brasil. Aprovar domínio não aprova prazo para todos os SKUs. Kits exigem comprovação do conjunto.
- Ausência/ambiguidade permanece inconclusiva ou pendente; fontes contraditórias não são arbitrariamente escolhidas. Todas as durações do trecho são confrontadas. 12 meses e 1 ano equivalem; dias não são aproximados em meses.
- Estados: `comprovada`, `legal`, `pendente_validacao`, `conflito`, `inconclusiva`. Revisão manual exige motivo, produto compatível, país e prazo coerentes; substitui a avaliação vigente, preservando histórico.
- Admin e gerente gerenciam; operador/visualizador apenas consultam. Amostras protegidas não são alvos graváveis. Exemplos visuais são identificados como demonstração, não evidências.
- Categorias ML são consultadas por `/categories/{id}/sale_terms`: tipo e unidade/enumeração precisam representar o prazo. Conversão exata de anos/meses permitida; não usar primeiro valor aceito nem inventar duração.
- Descrição sugerida continua usando o mecanismo existente, mas a cláusula de garantia é normalizada pela política canônica. Texto contraditório enviado à criação é recusado. Descrição específica de anúncio não é salva automaticamente no produto pelo botão de sugestão.

## Pesquisa e persistência

- Reutilização de Firecrawl e OpenRouter existentes: uma busca com até três páginas e, no máximo, um PDF vinculado à mesma origem; limite total de 45 segundos, sem retries. Não há varredura do catálogo, cron, fila ou dependência nova.
- Pesquisa ocorre na primeira preparação sem avaliação aplicável ou por ação explícita. GET apenas lê. Falha registrada não é repetida automaticamente a cada abertura. Nova pesquisa indisponível preserva avaliação anterior aplicável e exibe aviso.
- `warranty_sources`: decisões históricas sobre domínio/identidade; revogação invalida o uso automático da fonte. `product_warranty_assessments`: comando, autor, contexto, resultado, início/fim e deadline. RLS habilitada; browser sem acesso direto e service role sem DML direto.
- Comandos UUID idempotentes, lock por produto e finalização restrita ao mesmo autor com alçada. Resultado depois de 50 segundos ou com contexto alterado é descartado como inconclusivo. Produto, oferta, fornecedor operacional e composição participam do fingerprint.
- Leitura de contexto, fingerprint, avaliação e fontes ocorre num único snapshot SQL. Histórico da interface mostra as últimas 50 decisões com responsável; registros completos permanecem no banco. Fontes são deduplicadas no banco, sem buscar toda a tabela histórica no browser.
- Não há alteração de preço, atividade, anúncio, estoque, tributo, override ou liquidação nesta entrega. `pricing_execution_not_ready` continua bloqueando escritores comerciais na rota e no transporte.

## Validações

- Migration nova `20260907213000_bnt_canon_warranty.sql` ensaiada com rollback e aplicada somente em **192.168.1.162 / supabase-dev**, com conferência de destino TCP, hostname, histórico e schema. Conteúdo aplicado igual ao arquivo versionável; nenhuma migration anterior reescrita.
- Tipos das duas tabelas e cinco RPCs gerados pelo metadata desse mesmo DEV; contratos não relacionados preservados.
- `tests/product-warranty.sql`: idempotência, comandos concorrentes, finalização repetida, preservação após pesquisa indisponível, fonte, contexto alterado, prazo expirado, alçada, RLS e privilégios. Ensaio e execução pós-migration aprovados, ambos revertidos.
- Duas conexões reais ao `.162`: segunda transação bloqueada pelo advisory lock da primeira, comprovada por `lock_timeout`; ambas revertidas. Zero avaliações de garantia persistidas pelos testes.
- RPC de snapshot respondeu HTTP 200 no PostgREST `.162`; payload real aceito pelo contrato tipado, sem imprimir dados dos produtos.
- **386 testes Node aprovados**: domínio, pesquisa HTTP simulada, limite de fontes/tempo, extração, API/permissões, retirada do endpoint global e SSR com Ant Design real, além das regressões M2M, pricing, capacidade e detalhe do produto. SSR não substitui aprovação visual em navegador.
- `npm run validate` e `npm run build` aprovados, sem warnings de lint; build mantém configuração existente que pula typecheck, executado separadamente no validate. `git diff --check` aprovado; AGENTS.md e .gitignore não alterados.

Comando de regressão:

```bash
node --test tests/m2m-*.test.js tests/pricing-audit*.test.js tests/pricing-overrides.test.js tests/pricing-clearances.test.js tests/permissions.test.js tests/fulfillment-capacity.test.js tests/bentevi-product-detail.test.js tests/product-warranty.test.js tests/bnt-cfg-05-mercado-livre.test.js tests/bnt-cfg-07-integrations.test.js tests/configuracoes-ui-responsibilities.test.js
```

## Pendências e próxima ação

1. **Piloto concluído em 07/09/2026:** `BNT-AI-PROVIDER-01` comprovou extração real com login ChatGPT no escopo individual/local de Felipe; [evidência própria](BNT-AI-PROVIDER-01-validacao.md). OpenRouter não é exigido nesse caminho. Demais consumidores, modalidade compartilhada e Easypanel não foram migrados/homologados.
   **Pendência vigente:** configurar `FIRECRAWL_API_KEY` **de desenvolvimento** e o runtime local completo; executar pesquisa real limitada com domínio oficial aprovado e evidência do produto. O extrator passou com amostras sintéticas, sem coleta Firecrawl real nem gravação desses exemplos no banco. Não reutilizar credenciais de produção.
2. Push/deploy desta entrega somente quando solicitado e aceite visual em `dev.bentevi.shop`: fabricante, fornecedor, legal, pendência, conflito e indisponibilidade; revisão e histórico. Nenhuma aprovação visual desta etapa foi presumida.
3. Contrato de representação real de garantia no ML permanece sob o gate de publicação, sem POST/PUT externo nesta etapa.
4. **Paridade identificada em BNT-AI-PROVIDER-01:** reconciliar o fallback comercial `VORTEK-WARRANTY-2026-09-06-SELLER-30` de `main` (commit `4a40832`, presente no ref `dd34980`) com o contrato de evidência/classificação legal da V2. Não concluir a garantia ou copiar os 30 dias silenciosamente; [classificação e fontes de código](BNT-AI-PROVIDER-01-validacao.md#decisão-e-estado-encontrado).

Depois de validar a etapa, a fila segue para **BNT-PRICING-V2-08 / M2M-CFL-04 — Buy Box econômica**. Frete vivo ME2 na conexão autorizada da conta real e os demais gates comerciais continuam pendentes; esta entrega não os substitui.

## Rollback

Reverter seletivamente a aplicação mantendo a migration, as avaliações e a trilha. Preservar o bloqueio comercial: rollback não pode reabilitar publicação com garantia global. Não apagar histórico nem reescrever a migration aplicada. Ajustes posteriores de banco exigem nova migration e preflight `.162`.

## Referências

Skills locais de implementação/Supabase orientaram preflight, schema incremental e validações, sempre sob o mapa do AGENTS (`.162` DEV).

- [Firecrawl Search](https://docs.firecrawl.dev/api-reference/endpoint/search) e [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape).
- [OpenRouter Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request).
- [Mercado Livre — publicação e termos de venda](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos).
- [CDC atualizado, arts. 24, 26 e 50](https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html).
- [PostgreSQL 17 — locks](https://www.postgresql.org/docs/17/explicit-locking.html) e [Supabase — funções e privilégios](https://supabase.com/docs/guides/database/functions).
- Guias instalados de Route Handlers do Next.js 16.3.3; [Ant Design 5 — Form](https://5x.ant.design/components/form/).
