#!/usr/bin/env bash
# Sube la libreria nativa del Social SDK a un repo privado y deja los secretos
# preparados en el repo de la nube. El fichero NO pasa por el chat: va de tu
# equipo a un repo privado de GitHub.
#
#   bash social/subir-sdk.sh /ruta/al/SDK/libdiscord_partner_sdk.so
#
set -euo pipefail

LIB="${1:-}"
REPO_PRIVADO="${2:-zumorra/r34pete-privado}"
REPO_NUBE="${REPO_NUBE:-zumorra/r34pete}"

if [[ -z "$LIB" || ! -f "$LIB" ]]; then
  echo "Uso: bash social/subir-sdk.sh /ruta/al/libdiscord_partner_sdk.so [repo-privado]" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Necesitas la CLI de GitHub (gh) autenticada." >&2
  exit 1
fi

echo "==> Repo privado $REPO_PRIVADO"
if ! gh repo view "$REPO_PRIVADO" >/dev/null 2>&1; then
  gh repo create "$REPO_PRIVADO" --private --description "Libreria del Social SDK de Discord (no redistribuible)" >/dev/null
  echo "   creado"
else
  echo "   ya existia"
fi

echo "==> Subiendo la libreria"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp "$LIB" "$TMP/libdiscord_partner_sdk.so"
cd "$TMP"
git init -q .
git checkout -q -b main
git config user.name "r34pete"
git config user.email "r34pete@users.noreply.github.com"
git add libdiscord_partner_sdk.so
git commit -q -m "libreria del Social SDK"
git remote add origin "https://github.com/$REPO_PRIVADO.git"
git push -q --force origin main
echo "   subida ($(stat -c %s libdiscord_partner_sdk.so) bytes)"

URL="https://raw.githubusercontent.com/$REPO_PRIVADO/main/libdiscord_partner_sdk.so"

echo "==> Dejando los secretos en $REPO_NUBE"
printf '%s' "$URL" | gh secret set SOCIAL_SDK_URL --repo "$REPO_NUBE"

# Token para leer el repo privado: el de gh vale, pero mejor un PAT con permiso
# de solo lectura sobre ese repo. Aqui se usa el token de esta sesion de gh.
TOKEN=$(gh auth token)
printf '%s' "$TOKEN" | gh secret set SOCIAL_SDK_TOKEN --repo "$REPO_NUBE"

echo
echo "Listo:"
echo "  1. Falta autorizar tu cuenta (una vez):"
echo "     DISCORD_SDK_PATH=/ruta/al/SDK node social/autorizar.js --app <APP_ID>"
echo "  2. Lanza el bot y mira el log: debe decir '[social] conectado'."
echo
echo "Aviso: como token se ha usado el de la CLI de gh. Si prefieres,"
echo "crea un PAT con solo lectura sobre $REPO_PRIVADO y:"
echo "  printf '%s' '\$PAT' | gh secret set SOCIAL_SDK_TOKEN --repo $REPO_NUBE"
