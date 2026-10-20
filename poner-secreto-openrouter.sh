#!/bin/bash
# Pone el secreto OPENROUTER_API_KEY en el repo de GitHub sin que la clave pase por
# el chat ni por la linea de ordenes.
#
# 1) Yuki deja la clave en un fichero suyo (no pegada en el chat):
#      install -m 600 /dev/null ~/superyuki-arreglos/r34pete/clave-openrouter.txt
#      nano ~/superyuki-arreglos/r34pete/clave-openrouter.txt   # pega la clave y guarda
# 2) Yuki corre esto:
#      bash ~/superyuki-arreglos/r34pete/poner-secreto-openrouter.sh
#    La clave se lee del fichero, se pasa a 'gh secret set' por la tuberia (nunca en
#    argumentos, ni en el historial, ni en logs) y el fichero se borra.
# 3) Se lanza una ejecucion del workflow para probar el backend:
#      gh workflow run r34pete.yml --repo zumorra/r34pete -f minutos=5
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
    echo "  leo la clave de $FICHERO"
    echo "  gh secret set $SECRETO --repo $REPO   (por tuberia)"
    echo "  borro $FICHERO"
    echo "  gh workflow run r34pete.yml --repo $REPO -f minutos=5"
    exit 0
fi

[ -f "$FICHERO" ] || { echo "FALTA: no existe $FICHERO (mira las instrucciones de este script)"; exit 1; }
CLAVE=$(tr -d '\r\n ' < "$FICHERO")
case "$CLAVE" in
    sk-or-v1-*) ;;
    *) echo "PARO: eso no parece una clave de OpenRouter (deberia empezar por sk-or-v1-)"; exit 1 ;;
esac
[ ${#CLAVE} -gt 20 ] || { echo "PARO: la clave es demasiado corta"; exit 1; }

echo "-> poniendo el secreto $SECRETO en $REPO"
printf '%s' "$CLAVE" | gh secret set "$SECRETO" --repo "$REPO"
unset CLAVE
shred -u "$FICHERO" 2>/dev/null || rm -f "$FICHERO"
echo "-> secreto puesto y $FICHERO borrado"

echo "-> lanzando una ejecucion de prueba (5 min)"
gh workflow run r34pete.yml --repo "$REPO" -f minutos=5
echo "-> se vera en: gh run list --repo $REPO --limit 1"
echo "   (el paso 'Probar el backend openrouter' dice que modelo sirvio de verdad)"
