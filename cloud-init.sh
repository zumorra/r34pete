#!/bin/bash
# Cloud-init para Oracle Cloud (Always Free).
#
# Pegar en OCI: Crear instancia → Advanced options → Cloud-init script.
# Prepara el sistema para R34pete (Node 22, usuario, directorio, servicio).
# NO lleva el token ni el codigo: eso se copia despues por scp.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "== actualizando =="
apt-get update -y || true
apt-get upgrade -y || true

echo "== node 22 =="
apt-get install -y curl ca-certificates gnupg rsync
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "== usuario r34pete =="
id -u r34pete >/dev/null 2>&1 || useradd --system --home-dir /opt/r34pete --shell /usr/sbin/nologin r34pete
mkdir -p /opt/r34pete /etc/r34pete

echo "== servicio =="
cat > /etc/systemd/system/r34pete.service <<'UNIT'
[Unit]
Description=R34pete — bot de Discord de contenido de adultos
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=r34pete
Group=r34pete
WorkingDirectory=/opt/r34pete
Environment=NODE_ENV=production
Environment=R34PETE_CONFIG=/etc/r34pete/config.json
ExecStart=/usr/bin/node /opt/r34pete/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=r34pete
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/r34pete

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable r34pete

# reloj en UTC y locale para que las marcas de tiempo cuadren
timedatectl set-timezone UTC || true

echo "== listo =="
echo "Ahora copia el codigo y la configuracion:"
echo "  scp -i <tu_llave> -r r34pete/ ubuntu@<IP>:/opt/r34pete/"
echo "  scp -i <tu_llave> config.json ubuntu@<IP>:/etc/r34pete/config.json"
echo "  ssh -i <tu_llave> ubuntu@<IP> 'sudo chown root:r34pete /etc/r34pete/config.json && sudo chmod 640 /etc/r34pete/config.json && sudo systemctl restart r34pete'"
