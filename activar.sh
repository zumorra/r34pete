#!/usr/bin/env bash
# Pone el token del bot en la configuracion y arranca el servicio.
#
#   cat token.txt | bash activar.sh          (el token se lee por stdin)
#   bash activar.sh < token.txt
#
# El token NO se escribe nunca en la linea de comandos (quedaria en el
# historial) ni en ningun log.
set -euo pipefail

CONF="${R34PETE_CONFIG:-/etc/r34pete/config.json}"
TOKEN="$(cat)"

if [[ -z "$TOKEN" ]]; then
  echo "No llego el token por stdin" >&2
  exit 1
fi
if [[ "$TOKEN" == *"PEGA_AQUI"* ]]; then
  echo "Eso es el token de ejemplo, no el real" >&2
  exit 1
fi

echo "==> Actualizando $CONF"
cp -a "$CONF" "$CONF.bak-$(date +%Y%m%d-%H%M%S)"
TOKEN="$TOKEN" CONF="$CONF" python3 - <<'PY'
import json, os, pathlib
ruta = pathlib.Path(os.environ["CONF"])
token = os.environ["TOKEN"]
datos = json.loads(ruta.read_text())
datos["token"] = token
ruta.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n")
print("token actualizado")
PY

chown root:r34pete "$CONF"
chmod 640 "$CONF"

echo "==> Arrancando el servicio"
systemctl enable --now r34pete
sleep 6
systemctl --no-pager --lines=8 status r34pete || true
echo "--- logs ---"
journalctl -u r34pete --no-pager -n 15 || true
