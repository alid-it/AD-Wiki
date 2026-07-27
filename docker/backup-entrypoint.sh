#!/bin/sh
set -eu

read_secret() {
  variable_name="$1"
  secret_name="$2"
  secret_file="/run/secrets/$secret_name"

  if [ -f "$secret_file" ]; then
    secret_value=$(cat "$secret_file")
    export "$variable_name=$secret_value"
  fi
}

read_secret POSTGRES_PASSWORD postgres_password
read_secret BACKUP_ENCRYPTION_KEY backup_encryption_key

if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  encoded_password=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$POSTGRES_PASSWORD")
  export DATABASE_URL="postgresql://${POSTGRES_USER:-adwiki}:${encoded_password}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-adwiki_wiki}"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL oder das PostgreSQL-Secret ist erforderlich." >&2
  exit 1
fi

operation="${1:-worker}"
shift || true

case "$operation" in
  worker)
    exec node /app/apps/api/dist/backup-worker/main.js "$@"
    ;;
  restore)
    exec node /app/apps/api/dist/modules/backups/restore-cli.js "$@"
    ;;
  *)
    echo "Unbekannter Operations-Befehl: $operation" >&2
    exit 2
    ;;
esac
