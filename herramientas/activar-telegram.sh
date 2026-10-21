#!/usr/bin/env bash
# Guarda el token del bot de Telegram como secreto del repo, sin que el token
# pase por el chat ni se quede en el historial.
#
#   bash herramientas/activar-telegram.sh
#
# El token se copia en @BotFather (Telegram -> Buscar -> BotFather -> /newbot).
set -euo pipefail

REPO="${REPO:-zumorra/r34pete}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Necesitas la CLI de GitHub (gh) autenticada." >&2
  exit 1
fi

read -r -s -p "Token del bot de Telegram (@BotFather): " TOKEN
echo

if [[ -z "$TOKEN" ]]; then
  echo "No se escribio ningun token." >&2
  exit 1
fi

echo "==> Comprobando el token"
INFO=$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe")
if ! printf '%s' "$INFO" | jq -e '.ok == true' >/dev/null 2>&1; then
  echo "El token no vale: $(printf '%s' "$INFO" | jq -r '.description // "error desconocido"')" >&2
  exit 1
fi
NOMBRE=$(printf '%s' "$INFO" | jq -r '.result.username')
echo "    bot: @$NOMBRE"

echo "==> Guardando el secreto TELEGRAM_BOT_TOKEN en $REPO"
printf '%s' "$TOKEN" | gh secret set TELEGRAM_BOT_TOKEN --repo "$REPO"

echo "Listo. Lanza el bot y el bot de Telegram empieza a responder solo."
echo "Escribele a @$NOMBRE en Telegram y mandale /miid para ver tu id de chat."
