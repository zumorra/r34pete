#!/usr/bin/env bash
# Despliega R34pete en una instancia de Oracle Cloud desde la master.
#
#   bash desplegar-oci.sh <IP_PUBLICA> [usuario]      (usuario por defecto: ubuntu)
#
# Copia el codigo y la configuracion, instala el servicio y lo arranca.
# La llave es ~/.ssh/r34pete_oci (la publica se sube al crear la instancia).
set -euo pipefail

IP="${1:?falta la IP publica de la instancia}"
USUARIO="${2:-ubuntu}"
KEY="${R34PETE_SSH_KEY:-$HOME/.ssh/r34pete_oci}"
ORIGEN="${R34PETE_ORIGEN:-$HOME/superyuki-arreglos/r34pete}"
CONF_LOCAL="${R34PETE_CONFIG:-/etc/r34pete/config.json}"

[[ -f "$KEY" ]] || { echo "No encuentro la llave $KEY" >&2; exit 1; }
[[ -f "$CONF_LOCAL" ]] || { echo "No encuentro la configuracion $CONF_LOCAL" >&2; exit 1; }
grep -q "PEGA_AQUI_EL_TOKEN" "$CONF_LOCAL" && {
  echo "AVISO: la configuracion sigue con el token de ejemplo" >&2
}

echo "==> Copiando a $USUARIO@$IP"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$USUARIO@$IP" 'echo ok' >/dev/null

rsync -az -e "ssh -i $KEY" --exclude node_modules --exclude .git \
  "$ORIGEN/" "$USUARIO@$IP:/tmp/r34pete/"
scp -i "$KEY" "$CONF_LOCAL" "$USUARIO@$IP:/tmp/config.json"

echo "==> Instalando y arrancando"
ssh -i "$KEY" "$USUARIO@$IP" '
  set -e
  sudo bash /tmp/r34pete/install.sh /tmp/r34pete
  sudo install -m 640 -o root -g r34pete /tmp/config.json /etc/r34pete/config.json
  sudo systemctl enable --now r34pete
  sleep 3
  sudo systemctl --no-pager --lines=15 status r34pete || true
  echo "--- ultimos logs ---"
  sudo journalctl -u r34pete --no-pager -n 15 || true
'
echo "Listo. El bot deberia decir: R34pete conectado como R34pete#...."
