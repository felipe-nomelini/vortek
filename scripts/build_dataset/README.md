---
license: apache-2.0
language:
  - pt
  - en
tags:
  - next.js
  - typescript
  - ant-design
  - mercadolivre-api
  - e-commerce
  - dropshipping
  - supabase
  - code-generation
task_categories:
  - text-generation
size_categories:
  - 10K<n<100K
---

# Vortek Training Dataset

Dataset especializado para fine-tuning de LLMs no ecossistema Vortek ERP —
sistema de gestão de dropshipping com integração Mercado Livre, DSLite, Brasil NFe e Supabase.

## Estrutura

Baseado no [Tesslate/Next.js-Dataset](https://huggingface.co/datasets/Tesslate/Next.js-Dataset) (50k exemplos gerais de Next.js)
com 30 exemplos adicionais especializados do projeto Vortek.

### Colunas

| Coluna | Tipo | Descrição |
|---|---|---|
| `question` | string | Prompt da tarefa |
| `response` | string | Código/explicação correta |
| `reasoning` | string | Cadeia de raciocínio passo a passo |
| `category` | string | Categoria do exemplo (null para Tesslate) |
| `vortek_files` | list[string] | Arquivos do projeto referenciados |
| `is_vortek` | bool | true = exemplo Vortek, false = Tesslate |

### Categorias Vortek

| Categoria | Exemplos | Descrição |
|---|---|---|
| `error_fix` | 5 | Correções de erros reais cometidos durante o desenvolvimento |
| `component` | 10 | Componentes Ant Design bem estruturados do projeto |
| `api_integration` | 5 | Padrões de integração com APIs (Mercado Livre, DSLite, Supabase) |
| `convention` | 5 | Convenções do AGENTS.md (estrutura, validação, performance) |
| `negative` | 5 | Exemplos do que NÃO fazer (anti-padrões com explicação) |

### Tecnologias cobertas

- **Next.js 14+** (App Router, Server Components, API Routes)
- **TypeScript** (strict mode, generics, discriminated unions)
- **Ant Design 5.x** (Table, Form, Modal, Tabs, Statistics, Progress)
- **Supabase** (PostgreSQL, Auth, REST API, RLS)
- **Mercado Livre API** (OAuth2, Items, Fiscal Information, Orders, Webhooks)
- **DSLite API** (Catalog sync, Order creation)
- **Zod** (validation schemas)
- **TanStack Query** (React Query patterns)

## Uso

```python
from datasets import load_dataset

# Dataset completo (Tesslate + Vortek)
ds = load_dataset("vortek-tecnologia/vortek-training", split="train")

# Apenas exemplos Vortek
vortek = ds.filter(lambda x: x["is_vortek"] == True)

# Apenas erros corrigidos
errors = ds.filter(lambda x: x["category"] == "error_fix")
```

## Fine-tuning

Este dataset é otimizado para fine-tuning de modelos instruction-following (chat).
Formato compatível com:

- Mistral, Llama (formato conversacional)
- QLoRA / LoRA fine-tuning
- Axolotl, Unsloth, Hugging Face TRL

## Arquivos

- `train.parquet` — Dataset completo (Tesslate 50k + Vortek 30)
- `vortek_only.parquet` — Apenas exemplos Vortek (para fine-tuning leve)

## Licença

Apache 2.0
