#!/usr/bin/env bash
# Despliega R34pete en una instancia de Oracle Cloud desde la master.
#
#   bash desplegar-oci.sh <IP_PUBLICA> [usuario]      (usuario por defecto: ubuntu)
#
# Copia el codigo, la configuracion (con el token y la api_key de rule34) y las
# instrucciones del chat, instala el servicio y comprueba que arranca.
# La llave es ~/.ssh/r34pete_oci (la publica se sube al crear la instancia).
#
# En la instancia la IA es SIEMPRE online: no se usa el Ollama de la master
# (alli no llega). El orden por defecto es pollinations (sin clave) y, si se
# anaden claves, gemini / groq / openrouter.
set -euo pipefail

IP="${1:?falta la IP publica de la instancia}"
USUARIO="${2:-ubuntu}"
KEY="${R34PETE_SSH_KEY:-$HOME/.ssh/r34pete_oci}"
ORIGEN="${R34PETE_ORIGEN:-$HOME/superyuki-arreglos/r34pete}"
CONF_LOCAL="${R34PETE_CONFIG:-/etc/r34pete/config.json}"
INSTRUCCIONES="${R34PETE_INSTRUCCIONES:-/etc/r34pete/instrucciones.md}"

[[ -f "$KEY" ]] || { echo "No encuentro la llave $KEY" >&2; exit 1; }
[[ -f "$CONF_LOCAL" ]] || { echo "No encuentro la configuracion $CONF_LOCAL" >&2; exit 1; }
grep -q "PEGA_AQUI_EL_TOKEN" "$CONF_LOCAL" && {
  echo "AVISO: la configuracion sigue con el token de ejemplo" >&2
}

echo "==> Comprobando la conexion con $USUARIO@$IP"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$USUARIO@$IP" 'echo ok' >/dev/null

echo "==> Copiando codigo, configuracion e instrucciones"
rsync -az -e "ssh -i $KEY" --exclude node_modules --exclude .git \
  "$ORIGEN/" "$USUARIO@$IP:/tmp/r34pete/"
scp -i "$KEY" "$CONF_LOCAL" "$USUARIO@$IP:/tmp/config.json"
[[ -f "$INSTRUCCIONES" ]] && scp -i "$KEY" "$INSTRUCCIONES" "$USUARIO@$IP:/tmp/instrucciones.md" || true

echo "==> Instalando y arrancando"
ssh -i "$KEY" "$USUARIO@$IP" '
  set -e
  sudo bash /tmp/r34pete/install.sh /tmp/r34pete
  sudo install -m 640 -o root -g r34pete /tmp/config.json /etc/r34pete/config.json
  if [ -f /tmp/instrucciones.md ]; then
    sudo install -m 644 -o root -g r34pete /tmp/instrucciones.md /etc/r34pete/instrucciones.md
  fi
  sudo systemctl enable --now r34pete
  sleep 8
  echo "--- estado ---"
  sudo systemctl --no-pager --lines=8 status r34pete || true
  echo "--- logs ---"
  sudo journalctl -u r34pete --no-pager -n 12 || true
'
echo
echo "Listo. Deberia decir: R34pete conectado como R34pete#1680"
echo "Para comprobarlo desde la master:"
echo "  ssh -i $KEY $USUARIO@$IP 'sudo journalctl -u r34pete -f'"
