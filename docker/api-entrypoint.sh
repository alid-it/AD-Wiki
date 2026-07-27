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
read_secret JWT_SECRET jwt_secret
read_secret MONITORING_TOKEN monitoring_token
read_secret INTEGRATION_ENCRYPTION_KEY integration_encryption_key
read_secret SSO_ENCRYPTION_KEY sso_encryption_key
read_secret BACKUP_ENCRYPTION_KEY backup_encryption_key
read_secret MICROSOFT_CLIENT_SECRET microsoft_client_secret
read_secret INITIAL_ADMIN_PASSWORD initial_admin_password

if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  encoded_password=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$POSTGRES_PASSWORD")
  export DATABASE_URL="postgresql://${POSTGRES_USER:-adwiki}:${encoded_password}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-adwiki_wiki}"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL or the PostgreSQL secret configuration is required." >&2
  exit 1
fi

exec "$@"
