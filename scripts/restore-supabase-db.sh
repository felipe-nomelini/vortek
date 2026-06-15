#!/usr/bin/env bash
set -euo pipefail

# Restore the Vortek Supabase backup into a local/self-hosted Supabase Postgres.
#
# Required:
#   LOCAL_DB_URL='postgresql://...'
#
# Safety:
#   Set CONFIRM_RESET_LOCAL_SUPABASE=YES to drop/recreate auth, public,
#   storage, and supabase_migrations from the target database.
#
# Recommended:
#   Use Docker with postgres:17 client to match the backup/server version.

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/vortek-supabase/2026-06-15-0740}"
LOCAL_DB_URL="${LOCAL_DB_URL:-}"
CONFIRM_RESET="${CONFIRM_RESET_LOCAL_SUPABASE:-NO}"
USE_DOCKER="${RESTORE_USE_DOCKER:-auto}"
PSQL_IMAGE="${RESTORE_PSQL_IMAGE:-postgres:17}"
LOG_FILE="${RESTORE_LOG_FILE:-$BACKUP_DIR/restore-db.log}"
DOCKER_NETWORK="${RESTORE_DOCKER_NETWORK:-host}"
TMP_DIR="${RESTORE_TMP_DIR:-/tmp/vortek-restore-$$}"

if [[ -z "$LOCAL_DB_URL" ]]; then
  echo "Missing LOCAL_DB_URL." >&2
  exit 2
fi

for required in "$BACKUP_DIR/schema.sql" "$BACKUP_DIR/supabase_migrations.sql" "$BACKUP_DIR/data/tables"; do
  if [[ ! -e "$required" ]]; then
    echo "Missing backup artifact: $required" >&2
    exit 2
  fi
done

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$TMP_DIR"
: >"$LOG_FILE"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

docker_available() {
  command -v docker >/dev/null 2>&1
}

should_use_docker() {
  [[ "$USE_DOCKER" == "true" ]] && return 0
  [[ "$USE_DOCKER" == "false" ]] && return 1
  docker_available
}

psql_run() {
  if should_use_docker; then
    docker run --rm --network "$DOCKER_NETWORK" \
      -e LOCAL_DB_URL="$LOCAL_DB_URL" \
      -v "$BACKUP_DIR:/backup:ro" \
      -v "$TMP_DIR:/restore-tmp:ro" \
      "$PSQL_IMAGE" \
      psql "$LOCAL_DB_URL" "$@"
  else
    psql "$LOCAL_DB_URL" "$@"
  fi
}

backup_path() {
  local file="$1"
  if should_use_docker; then
    printf '/backup/%s' "$file"
  else
    printf '%s/%s' "$BACKUP_DIR" "$file"
  fi
}

sql_path() {
  local file="$1"
  local source="$BACKUP_DIR/$file"
  local target="$TMP_DIR/$file"

  mkdir -p "$(dirname "$target")"
  # Dumps made from PG17 include transaction_timeout. PG15 targets do not
  # recognize it, so strip only that harmless SET line for compatibility.
  # The schema dump was restricted to app schemas, so extension creation is
  # injected after the schemas exist.
  if [[ "$file" == "schema.sql" ]]; then
    awk '
      /^SET transaction_timeout = / { next }
      { print }
      /^CREATE SCHEMA supabase_migrations;$/ {
        print "CREATE SCHEMA IF NOT EXISTS extensions;"
        print "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" WITH SCHEMA extensions;"
        print "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;"
        print "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;"
        print "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;"
      }
    ' "$source" >"$target"
  else
    sed '/^SET transaction_timeout = /d' "$source" >"$target"
  fi

  if should_use_docker; then
    printf '/restore-tmp/%s' "$file"
  else
    printf '%s' "$target"
  fi
}

target_has_vortek_data() {
  psql_run -v ON_ERROR_STOP=1 -Atc "
    with candidate_tables(schema_name, table_name) as (
      values
        ('public','produtos'),
        ('public','pedidos'),
        ('public','pedido_itens'),
        ('public','compras'),
        ('public','integracoes'),
        ('public','produto_fornecedor_ofertas')
    )
    select coalesce(sum(row_estimate), 0)
    from (
      select
        case
          when to_regclass(format('%I.%I', schema_name, table_name)) is null then 0
          else (
            select reltuples::bigint
            from pg_class
            where oid = to_regclass(format('%I.%I', schema_name, table_name))
          )
        end as row_estimate
      from candidate_tables
    ) s;
  " | tr -d '[:space:]'
}

reset_target() {
  if [[ "$CONFIRM_RESET" != "YES" ]]; then
    local estimate
    estimate="$(target_has_vortek_data || echo unknown)"
    cat >&2 <<EOF
Target reset not confirmed.

Estimated existing Vortek rows: $estimate

To restore the full Supabase backup safely, run again with:
  CONFIRM_RESET_LOCAL_SUPABASE=YES

This will DROP these schemas on the target database:
  public, auth, storage, supabase_migrations
EOF
    exit 3
  fi

  log "Resetting target schemas"
  psql_run -v ON_ERROR_STOP=1 -c "
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    drop schema if exists storage cascade;
    drop schema if exists supabase_migrations cascade;
  " >>"$LOG_FILE" 2>&1
}

restore_schema() {
  log "Restoring schema"
  psql_run -v ON_ERROR_STOP=1 -f "$(sql_path schema.sql)" >>"$LOG_FILE" 2>&1
}

restore_migrations() {
  log "Restoring supabase_migrations"
  psql_run -v ON_ERROR_STOP=1 -c "set session_replication_role = replica;" \
    -f "$(sql_path supabase_migrations.sql)" \
    -c "set session_replication_role = origin;" >>"$LOG_FILE" 2>&1
}

restore_table_file() {
  local file="$1"
  local rel="${file#$BACKUP_DIR/}"
  log "Restoring $rel"
  psql_run -v ON_ERROR_STOP=1 \
    -c "set session_replication_role = replica;" \
    -f "$(sql_path "$rel")" \
    -c "set session_replication_role = origin;" >>"$LOG_FILE" 2>&1
}

restore_tables() {
  local file
  while IFS= read -r file; do
    restore_table_file "$file"
  done < <(find "$BACKUP_DIR/data/tables" -maxdepth 1 -type f -name '*.sql' | sort)
}

validate_counts() {
  log "Validating critical counts"
  psql_run -v ON_ERROR_STOP=1 -P pager=off -c "
    select 'produtos' as tabela, count(*) from public.produtos
    union all select 'produto_fornecedor_ofertas', count(*) from public.produto_fornecedor_ofertas
    union all select 'pedidos', count(*) from public.pedidos
    union all select 'pedido_itens', count(*) from public.pedido_itens
    union all select 'compras', count(*) from public.compras
    union all select 'integracoes', count(*) from public.integracoes
    union all select 'anuncios_ml', count(*) from public.anuncios_ml
    union all select 'jobs', count(*) from public.jobs
    union all select 'nf_auditoria_eventos', count(*) from public.nf_auditoria_eventos
    order by tabela;
  " | tee -a "$LOG_FILE"
}

main() {
  log "Testing target connection"
  psql_run -v ON_ERROR_STOP=1 -c 'select version();' >>"$LOG_FILE" 2>&1
  reset_target
  restore_schema
  restore_migrations
  restore_tables
  log "Running analyze"
  psql_run -v ON_ERROR_STOP=1 -c 'analyze;' >>"$LOG_FILE" 2>&1
  validate_counts
  log "Database restore finished"
}

main "$@"
