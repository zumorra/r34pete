#!/bin/bash
# R34pete: deja el backend de openrouter en el router de modelos gratuitos.
#
# Qué cambia: en /etc/r34pete/config.json, "ia.openrouter_modelo" pasa a
# "openrouter/free" (el router que sólo cae entre modelos gratuitos, nunca cobra de
# pago). Antes apuntaba a "meta-llama/llama-3.3-70b-instruct:free", un :free que ya
# no existe en OpenRouter: por eso el backend no respondía.
#
# El script NO toca las claves (ia.claves), el token del bot ni nada más: sólo esa
# línea. Deja copia .antes-openrouter-free-<fecha> y avisa del sha nuevo.
#
#   sudo bash ~/superyuki-arreglos/r34pete/parche-openrouter-free.sh [ruta-config]
#   sudo bash ~/superyuki-arreglos/r34pete/parche-openrouter-free.sh /etc/r34pete/config.json
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lánzalo con sudo"; exit 1; }
F="${1:-/etc/r34pete/config.json}"
[ -f "$F" ] || { echo "PARO: no existe $F"; exit 1; }

ANTES=$(sha256sum "$F" | cut -d' ' -f1)
cp -a "$F" "$F.antes-openrouter-free-$(date +%Y%m%d-%H%M%S)"

/usr/bin/python3 - "$F" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p, encoding="utf-8"))
ia = d.setdefault("ia", {})
viejo = ia.get("openrouter_modelo")
ia["openrouter_modelo"] = "openrouter/free"
json.dump(d, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open(p, "a", encoding="utf-8").write("\n")
print(f"   ia.openrouter_modelo: {viejo!r} -> 'openrouter/free'")
PY

DESPUES=$(sha256sum "$F" | cut -d' ' -f1)
echo "   config: $ANTES -> $DESPUES"
/usr/bin/python3 -c "
import json;d=json.load(open('$F',encoding='utf-8'));ia=d['ia']
print('   lee bien. openrouter_modelo =', ia['openrouter_modelo'])
print('   claves presentes:', {k: bool(v) for k, v in (ia.get('claves') or {}).items()})"
echo "== listo: reinicia el bot (systemctl restart r34pete) para que lo lea."
