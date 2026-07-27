#!/bin/sh
set -eu

INPUT_DIR=/input
OUTPUT_DIR=/tls
CERT_INPUT="$INPUT_DIR/server.crt"
KEY_INPUT="$INPUT_DIR/server.key"
CHAIN_INPUT="$INPUT_DIR/ca-chain.crt"

first_allowed_host=$(printf '%s' "${TLS_FALLBACK_HOSTS:-localhost}" | cut -d, -f1 | tr -d ' ')
domain=${TLS_DOMAIN:-$first_allowed_host}
days=${TLS_SELF_SIGNED_DAYS:-825}

case "$domain" in
  ""|*/*|*:*|*" "*)
    echo "TLS_DOMAIN muss genau einen Hostnamen ohne Schema, Port oder Pfad enthalten." >&2
    exit 1
    ;;
esac

case "$days" in
  *[!0-9]*|"")
    echo "TLS_SELF_SIGNED_DAYS muss eine positive Ganzzahl sein." >&2
    exit 1
    ;;
esac

if [ "$days" -lt 1 ]; then
  echo "TLS_SELF_SIGNED_DAYS muss mindestens 1 sein." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
umask 077

validate_pair() {
  cert_file="$1"
  key_file="$2"
  openssl x509 -in "$cert_file" -noout >/dev/null 2>&1 || return 1
  openssl pkey -in "$key_file" -noout >/dev/null 2>&1 || return 1
  cert_key=$(openssl x509 -in "$cert_file" -pubkey -noout \
    | openssl pkey -pubin -outform DER 2>/dev/null \
    | openssl dgst -sha256)
  private_key=$(openssl pkey -in "$key_file" -pubout -outform DER 2>/dev/null \
    | openssl dgst -sha256)
  [ "$cert_key" = "$private_key" ]
}

set_output_permissions() {
  chmod 644 \
    "$OUTPUT_DIR/server.crt" \
    "$OUTPUT_DIR/ca-chain.crt" \
    "$OUTPUT_DIR/fullchain.crt"
  chmod 600 "$OUTPUT_DIR/server.key"
}

cert_provided=${TLS_CERT_PROVIDED:-false}
key_provided=${TLS_KEY_PROVIDED:-false}
chain_provided=${TLS_CHAIN_PROVIDED:-false}

if [ "$cert_provided" = "true" ] || [ "$key_provided" = "true" ]; then
  if [ "$cert_provided" != "true" ] || [ "$key_provided" != "true" ]; then
    echo "TLS_CERT_PATH und TLS_KEY_PATH müssen immer gemeinsam gesetzt werden." >&2
    exit 1
  fi
  if ! validate_pair "$CERT_INPUT" "$KEY_INPUT"; then
    echo "TLS-Zertifikat oder privater Schlüssel ist ungültig beziehungsweise gehört nicht zusammen." >&2
    exit 1
  fi
  if [ "$chain_provided" = "true" ]; then
    if ! openssl crl2pkcs7 -nocrl -certfile "$CHAIN_INPUT" \
      | openssl pkcs7 -print_certs -noout >/dev/null 2>&1; then
      echo "TLS_CA_CHAIN_PATH enthält keine gültige PEM-Zertifikatskette." >&2
      exit 1
    fi
  fi

  temporary=$(mktemp -d "$OUTPUT_DIR/.provided.XXXXXX")
  trap 'rm -rf "$temporary"' EXIT
  cp "$CERT_INPUT" "$temporary/server.crt"
  cp "$KEY_INPUT" "$temporary/server.key"
  if [ "$chain_provided" = "true" ]; then
    cp "$CHAIN_INPUT" "$temporary/ca-chain.crt"
    { cat "$CERT_INPUT"; printf '\n'; cat "$CHAIN_INPUT"; } > "$temporary/fullchain.crt"
  else
    cp "$CERT_INPUT" "$temporary/ca-chain.crt"
    cp "$CERT_INPUT" "$temporary/fullchain.crt"
  fi
  chmod 644 "$temporary/server.crt" "$temporary/ca-chain.crt" "$temporary/fullchain.crt"
  chmod 600 "$temporary/server.key"
  cp "$temporary/server.crt" "$OUTPUT_DIR/server.crt"
  cp "$temporary/server.key" "$OUTPUT_DIR/server.key"
  cp "$temporary/ca-chain.crt" "$OUTPUT_DIR/ca-chain.crt"
  cp "$temporary/fullchain.crt" "$OUTPUT_DIR/fullchain.crt"
  set_output_permissions
  echo "Bereitgestelltes TLS-Zertifikat wurde validiert und installiert."
  exit 0
fi

if [ "$chain_provided" = "true" ]; then
  echo "TLS_CA_CHAIN_PATH kann nur zusammen mit TLS_CERT_PATH und TLS_KEY_PATH verwendet werden." >&2
  exit 1
fi

if [ -f "$OUTPUT_DIR/server.crt" ] \
  && [ -f "$OUTPUT_DIR/server.key" ] \
  && validate_pair "$OUTPUT_DIR/server.crt" "$OUTPUT_DIR/server.key" \
  && openssl x509 -in "$OUTPUT_DIR/server.crt" -checkend 86400 -noout >/dev/null 2>&1 \
  && openssl x509 -in "$OUTPUT_DIR/server.crt" -checkhost "$domain" -noout >/dev/null 2>&1; then
  set_output_permissions
  echo "Vorhandenes selbstsigniertes TLS-Zertifikat für $domain wird weiterverwendet."
  exit 0
fi

temporary=$(mktemp -d "$OUTPUT_DIR/.generated.XXXXXX")
trap 'rm -rf "$temporary"' EXIT
openssl req -x509 -newkey rsa:3072 -sha256 -nodes \
  -days "$days" \
  -subj "/CN=$domain/O=AD-Wiki Self-Signed" \
  -addext "subjectAltName=DNS:$domain,DNS:localhost,IP:127.0.0.1" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  -keyout "$temporary/server.key" \
  -out "$temporary/server.crt" >/dev/null 2>&1
cp "$temporary/server.crt" "$temporary/ca-chain.crt"
cp "$temporary/server.crt" "$temporary/fullchain.crt"
chmod 644 "$temporary/server.crt" "$temporary/ca-chain.crt" "$temporary/fullchain.crt"
chmod 600 "$temporary/server.key"
cp "$temporary/server.crt" "$OUTPUT_DIR/server.crt"
cp "$temporary/server.key" "$OUTPUT_DIR/server.key"
cp "$temporary/ca-chain.crt" "$OUTPUT_DIR/ca-chain.crt"
cp "$temporary/fullchain.crt" "$OUTPUT_DIR/fullchain.crt"
set_output_permissions
echo "Selbstsigniertes TLS-Zertifikat für $domain wurde für $days Tage erzeugt."
