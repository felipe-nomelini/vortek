"""generate.py - Create the Vortek training dataset by merging Tesslate base + Vortek custom examples."""
import json
import os
import sys
from pathlib import Path

try:
    from datasets import load_dataset, Dataset, concatenate_datasets
except ImportError:
    print("Installing datasets...")
    os.system(f"{sys.executable} -m pip install datasets pyarrow pandas huggingface_hub -q")
    from datasets import load_dataset, Dataset, concatenate_datasets

EXAMPLES_DIR = Path(__file__).parent / "examples"
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Category normalization map
CAT_MAP = {
    "error_fixes": "error_fix",
    "components": "component",
    "api_integrations": "api_integration",
    "conventions": "convention",
    "negatives": "negative",
}

def load_vortek_examples() -> list[dict]:
    rows = []
    for cat_file, category in CAT_MAP.items():
        filepath = EXAMPLES_DIR / f"{cat_file}.jsonl"
        if not filepath.exists():
            print(f"  WARN: {filepath} not found, skipping")
            continue
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                row["category"] = category
                row["is_vortek"] = True
                rows.append(row)
        print(f"  {category}: {len([r for r in rows if r['category'] == category])} examples")
    return rows

def main():
    print("=" * 50)
    print("  Vortek Training Dataset Builder")
    print("=" * 50)

    # 1. Load Tesslate base
    print("\n[1/4] Loading Tesslate/Next.js-Dataset (50k rows)...")
    try:
        tesslate = load_dataset("Tesslate/Next.js-Dataset", split="train")
    except Exception as e:
        print(f"  WARN: Could not load Tesslate dataset: {e}")
        print("  Creating standalone Vortek-only dataset...")
        tesslate = None

    if tesslate is not None:
        print(f"  Loaded {len(tesslate):,} rows")
        tesslate = tesslate.add_column("category", [None] * len(tesslate))
        tesslate = tesslate.add_column("vortek_files", [None] * len(tesslate))
        tesslate = tesslate.add_column("is_vortek", [False] * len(tesslate))

    # 2. Load Vortek examples
    print("\n[2/4] Loading Vortek custom examples...")
    vortek_rows = load_vortek_examples()
    total_vortek = len(vortek_rows)
    print(f"  Total: {total_vortek} examples")

    by_cat = {}
    for r in vortek_rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    for cat, count in sorted(by_cat.items()):
        print(f"    {cat}: {count}")

    # 3. Create datasets
    print("\n[3/4] Building Parquet files...")

    vortek_ds = Dataset.from_list(vortek_rows)

    if tesslate is not None:
        full_ds = concatenate_datasets([tesslate, vortek_ds])
        total_rows = len(tesslate) + len(vortek_ds)
    else:
        full_ds = vortek_ds
        total_rows = len(vortek_ds)

    # Save
    train_path = str(DATA_DIR / "train.parquet")
    vortek_path = str(DATA_DIR / "vortek_only.parquet")

    full_ds.to_parquet(train_path)
    print(f"  train.parquet: {total_rows:,} rows ({os.path.getsize(train_path) / 1024 / 1024:.1f} MB)")

    vortek_ds.to_parquet(vortek_path)
    print(f"  vortek_only.parquet: {len(vortek_ds)} rows ({os.path.getsize(vortek_path) / 1024:.1f} MB)")

    # 4. Summary
    print(f"\n[4/4] Done!")
    print(f"  Tesslate base: {len(tesslate):,} rows" if tesslate else "  Tesslate base: NOT INCLUDED")
    print(f"  Vortek custom: {total_vortek} rows")
    print(f"  Total dataset: {total_rows:,} rows")
    print(f"\n  Output: {DATA_DIR}/train.parquet")
    print(f"  Output: {DATA_DIR}/vortek_only.parquet")

if __name__ == "__main__":
    main()
