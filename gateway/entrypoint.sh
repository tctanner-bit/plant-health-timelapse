#!/bin/sh
# TLS for explicit FTPS. Use a real certificate if one is provided as secrets
# (TLS_KEY / TLS_CERT, PEM text); otherwise generate a self-signed one.
# Cameras encrypt against either — embedded FTP clients generally don't
# verify the certificate — but a real one also protects against impersonation.
set -e
mkdir -p "$(dirname "$TLS_KEY_FILE")"
if [ -n "$TLS_KEY" ] && [ -n "$TLS_CERT" ]; then
  printf '%s\n' "$TLS_KEY" > "$TLS_KEY_FILE"
  printf '%s\n' "$TLS_CERT" > "$TLS_CERT_FILE"
elif [ ! -f "$TLS_CERT_FILE" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$TLS_KEY_FILE" -out "$TLS_CERT_FILE" \
    -subj "/CN=${GATEWAY_HOSTNAME:-phc-ftp.fly.dev}" 2>/dev/null
fi
exec node server.mjs
