#!/usr/bin/env bash
# Instala R34pete en una maquina Linux (Oracle Cloud, Ubuntu/Oracle Linux).
#
#   sudo bash install.sh /ruta/al/codigo
#
# Deja:
#   /opt/r34pete            codigo + node_modules
#   /etc/r34pete/config.json configuracion (600, root:r34pete)
#   /etc/systemd/system/r34pete.service
set -euo pipefail

ORIGEN="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
DESTINO=/opt/r34pete
CONF=/etc/r34pete/config.json
UNIDAD=/etc/systemd/system/r34pete.service
USUARIO=r34pete

[[ $EUID -eq 0 ]] || { echo "Ejecutar con sudo" >&2; exit 1; }
[[ -f "$ORIGEN/package.json" ]] || { echo "No encuentro package.json en $ORIGEN" >&2; exit 1; }

echo "==> Node"
if ! command -v node >/dev/null; then
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  else
    echo "Instala Node 20+ a mano y repite" >&2
    exit 1
  fi
fi
node -v

echo "==> Usuario y directorios"
id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --home-dir /opt/r34pete --shell /usr/sbin/nologin "$USUARIO"
mkdir -p "$DESTINO" /etc/r34pete
if [[ -f "$CONF" ]]; then
  cp -a "$CONF" "$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  echo "Config anterior guardado"
else
  install -m 640 -o root -g "$USUARIO" "$ORIGEN/config.example.json" "$CONF"
  echo "Config creada en $CONF (pon el token)"
fi

echo "==> Codigo"
rsync -a --delete --exclude node_modules --exclude config.json "$ORIGEN/" "$DESTINO/"
cd "$DESTINO"
npm ci --omit=dev || npm install --omit=dev
chown -R "$USUARIO:$USUARIO" "$DESTINO"
chown root:"$USUARIO" "$CONF"
chmod 640 "$CONF"

echo "==> Servicio"
install -m 644 "$ORIGEN/r34pete.service" "$UNIDAD"
systemctl daemon-reload
systemctl enable r34pete

echo
echo "Listo. Falta:"
echo "  1. El token:   sudo nano $CONF      (campo \"token\")"
echo "  2. Arrancar:   sudo systemctl restart r34pete"
echo "  3. Ver logs:   sudo journalctl -u r34pete -f"
