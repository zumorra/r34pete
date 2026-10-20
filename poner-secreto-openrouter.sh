#!/bin/bash
# Pone el secreto OPENROUTER_API_KEY en el repo de GitHub sin que la clave pase por
# el chat, ni por la linea de ordenes, ni por el historial.
#
# USO (un solo comando):
#    bash ~/superyuki-arreglos/r34pete/poner-secreto-openrouter.sh
#    -> te pide la clave SIN ECO (no se ve al teclear), la mete como secreto de GitHub
#       por tuberia, borra el fichero y lanza una ejecucion de prueba de 5 min.
#
# O con la clave ya en un fichero 600 (se borra con shred):
#    install -m 600 /dev/null ~/superyuki-arreglos/r34pete/clave-openrouter.txt
#    nano ~/superyuki-arreglos/r34pete/clave-openrouter.txt
#    bash ~/superyuki-arreglos/r34pete/poner-secreto-openrouter.sh
#
# Con --dry-run enseña lo que haria sin tocar nada.
set -euo pipefail
REPO="${R34PETE_REPO:-zumorra/r34pete}"
SECRETO="${R34PETE_SECRETO:-OPENROUTER_API_KEY}"
SECO=0
if [ "${1:-}" = "--dry-run" ]; then SECO=1; shift; fi
FICHERO="${1:-$HOME/superyuki-arreglos/r34pete/clave-openrouter.txt}"

if [ "$SECO" = "1" ]; then
    echo "Haria:"
    echo "  leo la clave (del fichero $FICHERO o escribiendola en la terminal)"
    echo "  gh secret set $SECRETO --repo $REPO   (por tuberia, la clave no se ve)"
    echo "  borro el fichero si existia"
    echo "  gh workflow run r34pete.yml --repo $REPO -f minutos=5"
    exit 0
fi

CLAVE=""
DESDE_FICHERO=0
if [ -f "$FICHERO" ]; then
    CLAVE=$(tr -d '\r\n ' < "$FICHERO")
    DESDE_FICHERO=1
else
    echo "Pega tu clave de OpenRouter (sk-or-v1-...) y pulsa Enter. NO se ve al teclear:"
    read -rs CLAVE
    echo
fi
case "$CLAVE" in
    sk-or-v1-*) ;;
    *) echo "PARO: eso no parece una clave de OpenRouter (deberia empezar por sk-or-v1-)"; exit 1 ;;
esac
[ ${#CLAVE} -gt 20 ] || { echo "PARO: la clave es demasiado corta"; exit 1; }

echo "-> comprobando que la clave vale (GET /api/v1/key)"
if ! curl -s -m 25 -H "Authorization: Bearer $CLAVE" https://openrouter.ai/api/v1/key \
     | grep -q '"label"'; then
    echo "PARO: OpenRouter no reconoce esa clave. Comprueba que copiaste la entera."
    exit 1
fi
echo "-> clave valida. Poniendo el secreto $SECRETO en $REPO"
printf '%s' "$CLAVE" | gh secret set "$SECRETO" --repo "$REPO"
unset CLAVE
if [ "$DESDE_FICHERO" = "1" ]; then
    shred -u "$FICHERO" 2>/dev/null || rm -f "$FICHERO"
    echo "-> fichero borrado"
fi

echo "-> lanzando una ejecucion de prueba (5 min)"
gh workflow run r34pete.yml --repo "$REPO" -f minutos=5
echo "-> se vera en: gh run list --repo $REPO --limit 1"
echo "   (el paso 'Probar el backend openrouter' dice que modelo sirvio de verdad)"
