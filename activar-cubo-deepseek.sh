#!/usr/bin/env bash
# Anade un cubo EXTRA de DeepSeek (gratis, sin tarjeta) al OpenCode de la
# master y al de la instancia que usan los bots, y lo anade al catalogo del
# panel para que se pueda elegir.
#
#   bash ~/superyuki-arreglos/r34pete/activar-cubo-deepseek.sh cloudflare
#   bash ~/superyuki-arreglos/r34pete/activar-cubo-deepseek.sh nvidia
#
# Pide la clave por terminal (sin eco) y la cuenta si hace falta, la valida
# contra el proveedor ANTES de guardarla, y luego escribe:
#   - ~/.config/opencode/opencode.json                (este bot, 600)
#   - /etc/superyuki/codigo/opencode.json             (instancia de los bots, 640)
#   - ~/.openmausbot/providers/engine-models/opencodeGo.json (selector del panel)
# Reinicia la instancia de los bots al final.
set -uo pipefail

PROVEEDOR="${1:-}"
case "$PROVEEDOR" in
  cloudflare)
    ETIQUETA="Cloudflare Workers AI (10.000 neuronas/dia gratis)"
    MODELOS=(
      "@cf/deepseek-ai/deepseek-v4.1-flash-1017"
      "@cf/deepseek-ai/deepseek-v4-pro-0813"
      "@cf/deepseek-ai/deepseek-v4-flash-0731"
    )
    URL="https://api.cloudflare.ai/client/v4/accounts"
    ;;
  nvidia)
    ETIQUETA="NVIDIA NIM (creditos gratis al registrarse)"
    MODELOS=(
      "deepseek-ai/deepseek-v4.1-flash"
      "deepseek-ai/deepseek-v4-flash"
      "deepseek-ai/deepseek-v4-pro"
    )
    URL="https://integrate.api.nvidia.com/v1"
    ;;
  *)
    echo "Uso: $0 cloudflare|nvidia" >&2
    exit 2
    ;;
esac

read -r -p "Clave de $PROVEEDOR (no se ve al teclear): " -s CLAVE; echo
[ -z "$CLAVE" ] && { echo "Falta la clave." >&2; exit 2; }
CUENTA=""
if [ "$PROVEEDOR" = "cloudflare" ]; then
  read -r -p "Account ID de Cloudflare (se ve en dash.cloudflare.com): " CUENTA
  [ -z "$CUENTA" ] && { echo "Falta el Account ID." >&2; exit 2; }
  BASE="https://api.cloudflare.ai/client/v4/accounts/${CUENTA}/ai/v1"
else
  BASE="https://integrate.api.nvidia.com/v1"
fi

echo "Validando la clave contra $PROVEEDOR (peticion real minima)..."
# OJO: /models de NVIDIA es PUBLICO (devuelve 200 sin clave), asi que la
# unica forma de validar de verdad es hacer una inferencia minima.
MODELO_PRUEBA="${MODELOS[0]}"
if [ "$PROVEEDOR" = "cloudflare" ]; then
  CODE=$(curl -s -o /tmp/cf-prueba.json -w "%{http_code}" -m 45 \
    -H "Authorization: Bearer $CLAVE" -H "Content-Type: application/json" \
    "$BASE/chat/completions" \
    -d "{\"model\":\"$MODELO_PRUEBA\",\"messages\":[{\"role\":\"user\",\"content\":\"di OK\"}],\"max_tokens\":5}")
else
  CODE=$(curl -s -o /tmp/nv-prueba.json -w "%{http_code}" -m 45 \
    -H "Authorization: Bearer $CLAVE" -H "Content-Type: application/json" \
    "$URL/chat/completions" \
    -d "{\"model\":\"$MODELO_PRUEBA\",\"messages\":[{\"role\":\"user\",\"content\":\"di OK\"}],\"max_tokens\":5}")
fi
if [ "$CODE" != "200" ]; then
  echo "La clave no sirve para $PROVEEDOR (HTTP $CODE). No se guarda nada." >&2
  head -c 200 /tmp/cf-prueba.json 2>/dev/null; head -c 200 /tmp/nv-prueba.json 2>/dev/null
  exit 1
fi
echo "Clave validada (inferencia real con $MODELO_PRUEBA: HTTP $CODE)."

# ---- 1) config de este bot --------------------------------------------
python3 - "$CLAVE" "$BASE" "$PROVEEDOR" "$ETIQUETA" "${MODELOS[@]}" <<'PY'
import json,os,sys
clave,base,prov,etiqueta=sys.argv[1:5]
modelos=sys.argv[5:]
p="/home/yukimaster/.config/opencode/opencode.json"
d=json.load(open(p))
d.setdefault("provider",{})[prov]={
  "npm":"@ai-sdk/openai-compatible",
  "name":etiqueta,
  "options":{"baseURL":base,"apiKey":clave,
             "headers":{"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}},
  "models":{m:{"name":f"{m} ({prov})"} for m in modelos}
}
json.dump(d,open(p,"w"),indent=2,ensure_ascii=False)
os.chmod(p,0o600)
print("config de este bot actualizada")
PY

# ---- 2) config de la instancia de los bots ----------------------------
sudo python3 - "$CLAVE" "$BASE" "$PROVEEDOR" "$ETIQUETA" "${MODELOS[@]}" <<'PY'
import json,os,shutil,sys
clave,base,prov,etiqueta=sys.argv[1:5]
modelos=sys.argv[5:]
p="/etc/superyuki/codigo/opencode.json"
if not os.path.exists(p+".bak-piration"): shutil.copy2(p,p+".bak-piration")
d=json.load(open(p))
d.setdefault("provider",{})[prov]={
  "npm":"@ai-sdk/openai-compatible",
  "name":etiqueta,
  "options":{"baseURL":base,"apiKey":clave,
             "headers":{"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}},
  "models":{m:{"name":f"{m} ({prov})"} for m in modelos}
}
json.dump(d,open(p,"w"),indent=2,ensure_ascii=False)
st=os.stat(p); os.chown(p,st.st_uid,st.st_gid); os.chmod(p,0o640)
print("config de la instancia actualizada")
PY

# ---- 3) catalogo del panel --------------------------------------------
python3 - "$PROVEEDOR" "${MODELOS[@]}" <<'PY'
import json,os,shutil,sys
prov=sys.argv[1]; modelos=sys.argv[2:]
p="/home/yukimaster/.openmausbot/providers/engine-models/opencodeGo.json"
if not os.path.exists(p+".bak-piration"): shutil.copy2(p,p+".bak-piration")
d=json.load(open(p))
ids={o["id"] for o in d["options"]}
for m in modelos:
    mid=f"{prov}/{m}"
    if mid not in ids:
        d["options"].append({"id":mid,"label":f"{prov.capitalize()} · {m}"})
json.dump(d,open(p,"w"),indent=2,ensure_ascii=False)
print("catalogo del panel: opciones ahora",len(d["options"]))
PY

# ---- 4) reiniciar la instancia de los bots ----------------------------
sudo systemctl restart superyuki-codigo.service
sleep 6
systemctl is-active superyuki-codigo.service >/dev/null && echo "instancia reiniciada y activa" || echo "AVISO: la instancia no quedo activa"

echo
echo "Listo. Cubo nuevo de DeepSeek en $PROVEEDOR para este bot y para todos los del panel."
echo "Modelos: ${MODELOS[*]}"
echo "Comprueba que contestan con:  ia --estado"
