#!/usr/bin/env bash
set -uo pipefail

# Resilient Supabase/Postgres backup.
# Usage:
#   SUPABASE_DB_URL='postgresql://...' bash scripts/backup-supabase-db-resilient.sh
#
# Output defaults to:
#   ~/backups/vortek-supabase/YYYY-MM-DD-HHMM

PROJECT_NAME="${PROJECT_NAME:-vortek-supabase}"
DB_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-${POSTGRES_URL:-}}}"
STAMP="${BACKUP_STAMP:-$(date +%Y-%m-%d-%H%M)}"
ROOT_DIR="${BACKUP_ROOT_DIR:-$HOME/backups/$PROJECT_NAME}"
OUT_DIR="${BACKUP_OUT_DIR:-$ROOT_DIR/$STAMP}"
RETRIES="${BACKUP_RETRIES:-5}"
RETRY_SLEEP="${BACKUP_RETRY_SLEEP:-10}"
CMD_TIMEOUT="${BACKUP_CMD_TIMEOUT:-300}"
SKIP_TABLES="${BACKUP_SKIP_TABLES:-}"
ONLY_TABLES="${BACKUP_ONLY_TABLES:-}"
PGOPTIONS_BACKUP="${PGOPTIONS_BACKUP:--c statement_timeout=0 -c lock_timeout=10s -c idle_in_transaction_session_timeout=0}"

if [[ -z "$DB_URL" ]]; then
  cat >&2 <<'EOF'
Missing Postgres connection string.

Set one of:
  SUPABASE_DB_URL
  DATABASE_URL
  POSTGRES_URL

Get it from Supabase Dashboard:
  Project Settings > Database > Connection string > URI

Prefer direct connection. If unavailable, use session pooler.
EOF
  exit 2
fi

mkdir -p "$OUT_DIR"/{logs,data/tables}
LOG_FILE="$OUT_DIR/logs/backup.log"
FAILED_FILE="$OUT_DIR/FAILED.txt"
MANIFEST_FILE="$OUT_DIR/MANIFEST.txt"
: >"$LOG_FILE"
: >"$FAILED_FILE"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

run_retry() {
  local label="$1"
  shift
  local attempt

  for attempt in $(seq 1 "$RETRIES"); do
    log "START $label attempt=$attempt/$RETRIES"
    if PGOPTIONS="$PGOPTIONS_BACKUP" timeout "$CMD_TIMEOUT" "$@" >>"$LOG_FILE" 2>&1; then
      log "OK $label"
      return 0
    fi

    log "FAIL $label attempt=$attempt/$RETRIES"
    sleep $((RETRY_SLEEP * attempt))
  done

  log "GIVE_UP $label"
  printf '%s\n' "$label" >>"$FAILED_FILE"
  return 1
}

dump_roles() {
  run_retry "roles" pg_dumpall \
    --roles-only \
    --no-role-passwords \
    --file="$OUT_DIR/roles.sql" \
    --dbname="$DB_URL"
}

dump_schema() {
  run_retry "schema" pg_dump \
    --dbname="$DB_URL" \
    --schema-only \
    --no-owner \
    --no-privileges \
    --schema=public \
    --schema=auth \
    --schema=storage \
    --schema=supabase_migrations \
    --file="$OUT_DIR/schema.sql"
}

dump_migrations() {
  run_retry "supabase_migrations" pg_dump \
    --dbname="$DB_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --schema=supabase_migrations \
    --file="$OUT_DIR/supabase_migrations.sql"
}

discover_tables() {
  PGOPTIONS="$PGOPTIONS_BACKUP" psql "$DB_URL" \
    -v ON_ERROR_STOP=1 \
    -Atc "
      select schemaname || '.' || tablename
      from pg_tables
      where schemaname in ('public', 'auth', 'storage')
      order by
        case schemaname
          when 'public' then 1
          when 'auth' then 2
          when 'storage' then 3
          else 9
        end,
        tablename;
    " 2>>"$LOG_FILE"
}

fallback_tables() {
  cat <<'EOF'
public.integracoes
public.configuracoes
public.empresa
public.fornecedores
public.produtos
public.produto_fornecedor_ofertas
public.anuncios_ml
public.pedidos
public.pedido_itens
public.compras
public.nf_auditoria_eventos
public.jobs
public.supplier_balance_movements
public.mercadopago_account_movements
public.mercadopago_payment_events
auth.users
auth.identities
storage.buckets
storage.objects
EOF
}

dump_table() {
  local table="$1"
  local safe_name="${table//./__}.sql"
  local target="$OUT_DIR/data/tables/$safe_name"

  if [[ " $SKIP_TABLES " == *" $table "* ]] || [[ ",$SKIP_TABLES," == *",$table,"* ]]; then
    log "SKIP table:$table"
    return 0
  fi

  run_retry "table:$table" pg_dump \
    --dbname="$DB_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --table="$table" \
    --file="$target"
}

dump_tables() {
  local table_file="$OUT_DIR/tables.txt"

  if [[ -n "$ONLY_TABLES" ]]; then
    log "Using BACKUP_ONLY_TABLES"
    printf '%s\n' $ONLY_TABLES >"$table_file"
  else
    log "Discovering tables"
  fi

  if [[ -n "$ONLY_TABLES" ]]; then
    log "Selected $(wc -l <"$table_file" | tr -d ' ') tables"
  elif discover_tables >"$table_file"; then
    log "Discovered $(wc -l <"$table_file" | tr -d ' ') tables"
  else
    log "Table discovery failed; using priority fallback list"
    fallback_tables >"$table_file"
  fi

  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    dump_table "$table" || true
  done <"$table_file"
}

write_manifest() {
  {
    echo "backup_dir=$OUT_DIR"
    echo "created_at=$(date -Is)"
    echo "pg_dump=$(pg_dump --version)"
    echo "psql=$(psql --version)"
    echo
    echo "[files]"
    find "$OUT_DIR" -type f -not -name 'SHA256SUMS.txt' -printf '%p %s bytes\n' | sort
    echo
    echo "[failed]"
    if [[ -s "$FAILED_FILE" ]]; then
      cat "$FAILED_FILE"
    else
      echo "none"
    fi
  } >"$MANIFEST_FILE"

  (cd "$OUT_DIR" && find . -type f -not -name 'SHA256SUMS.txt' -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS.txt)
}

main() {
  log "Backup started: $OUT_DIR"
  dump_roles || true
  dump_schema || true
  dump_migrations || true
  dump_tables
  write_manifest
  log "Backup finished: $OUT_DIR"

  if [[ -s "$FAILED_FILE" ]]; then
    log "Backup finished with failures. See $FAILED_FILE"
    exit 1
  fi
}

main "$@"
