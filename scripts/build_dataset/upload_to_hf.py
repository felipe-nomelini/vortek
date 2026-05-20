"""upload_to_hf.py - Upload generated parquet files to Hugging Face."""
import os
import sys
from pathlib import Path

try:
    from huggingface_hub import HfApi, create_repo, upload_folder
except ImportError:
    os.system(f"{sys.executable} -m pip install huggingface_hub -q")
    from huggingface_hub import HfApi, create_repo, upload_folder

DATA_DIR = Path(__file__).parent / "data"
REPO_ID = "vortek-tecnologia/vortek-training"

README_CONTENT = """---
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
"""

def main():
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: HF_TOKEN env var not set")
        print("Usage: HF_TOKEN=hf_xxx python upload_to_hf.py")
        sys.exit(1)

    print("=" * 50)
    print("  Upload to Hugging Face")
    print(f"  Repo: {REPO_ID}")
    print("=" * 50)

    api = HfApi(token=token)

    # Create or get repo
    print("\n[1/3] Creating repo...")
    try:
        api.create_repo(REPO_ID, repo_type="dataset", exist_ok=True)
        print(f"  Repo {REPO_ID} ready")
    except Exception as e:
        print(f"  Error creating repo: {e}")
        sys.exit(1)

    # Write README
    print("\n[2/3] Writing README.md...")
    readme_path = DATA_DIR.parent / "README.md"
    with open(readme_path, "w") as f:
        f.write(README_CONTENT)

    # Upload folder
    print("\n[3/3] Uploading parquet files...")
    files_to_upload = list(DATA_DIR.glob("*.parquet"))
    print(f"  Files: {[f.name for f in files_to_upload]}")

    for f in files_to_upload:
        size_mb = f.stat().st_size / 1024 / 1024
        print(f"  Uploading {f.name} ({size_mb:.1f} MB)...")
        api.upload_file(
            path_or_fileobj=str(f),
            path_in_repo=f"data/{f.name}",
            repo_id=REPO_ID,
            repo_type="dataset",
        )

    # Upload README
    print("  Uploading README.md...")
    api.upload_file(
        path_or_fileobj=str(readme_path),
        path_in_repo="README.md",
        repo_id=REPO_ID,
        repo_type="dataset",
    )

    print(f"\n  Done! View at: https://huggingface.co/datasets/{REPO_ID}")

if __name__ == "__main__":
    main()
