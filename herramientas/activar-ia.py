#!/usr/bin/env python3
"""Mete una clave de IA en R34pete de forma segura y la comprueba de verdad.

    sudo python3 herramientas/activar-ia.py [proveedor]

La clave se pide por terminal con getpass: no se ve al escribirla, no queda en
el historial y no se imprime. Antes de guardarla se hace una peticion real al
proveedor; si la clave no vale, no se toca nada.

Si el bot vive en GitHub Actions, la clave tambien se guarda como secreto del
repo (IA_<PROVEEDOR>) para que la version online la use.

Proveedores con plan gratuito (sin tarjeta):

  pollinations  sin clave (1 respuesta cada 30 s por IP). Con clave (pollen)
                el limite es mucho mayor.
  groq          console.groq.com -> Llama 3.3 70B, muy rapido.
  cerebras      cloud.cerebras.ai -> Llama 3.3 70B, muy rapido.
  nvidia        build.nvidia.com -> Llama 3.3 70B.
  gemini        aistudio.google.com -> Gemini Flash (corta contenido adulto).
  mistral       console.mistral.ai -> Mistral Small.
  openrouter    openrouter.ai -> modelos ":free" (50/dia sin creditos).
  cloudflare    dash.cloudflare.com -> Workers AI (10.000 neuronas/dia).
  horde         stablehorde.net -> comunidad voluntaria, Llama 3.3 70B.
"""

import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

CONFIG = pathlib.Path(os.environ.get("R34PETE_CONFIG", "/etc/r34pete/config.json"))
REPO = os.environ.get("R34PETE_REPO", "zumorra/r34pete")

PROVEEDORES = {
    "pollinations": {
        "url": "https://text.pollinations.ai/openai",
        "modelo": "openai-fast",
        "donde": "https://enter.pollinations.ai/ (clave 'pollen')",
    },
    "groq": {
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "modelo": "llama-3.3-70b-versatile",
        "donde": "https://console.groq.com/keys",
    },
    "cerebras": {
        "url": "https://api.cerebras.ai/v1/chat/completions",
        "modelo": "llama-3.3-70b",
        "donde": "https://cloud.cerebras.ai/",
    },
    "nvidia": {
        "url": "https://integrate.api.nvidia.com/v1/chat/completions",
        "modelo": "meta/llama-3.3-70b-instruct",
        "donde": "https://build.nvidia.com/",
    },
    "gemini": {
        "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        "modelo": "gemini-2.5-flash",
        "donde": "https://aistudio.google.com/apikey",
        "estilo": "gemini",
    },
    "mistral": {
        "url": "https://api.mistral.ai/v1/chat/completions",
        "modelo": "mistral-small-latest",
        "donde": "https://console.mistral.ai/api-keys",
    },
    "openrouter": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "modelo": "openrouter/free",
        "donde": "https://openrouter.ai/keys",
    },
    "cloudflare": {
        "url": "https://api.cloudflare.com/client/v4",
        "modelo": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "donde": "https://dash.cloudflare.com/ (API Tokens + id de cuenta)",
        "estilo": "cloudflare",
    },
    "horde": {
        "url": "https://stablehorde.net/api/v2",
        "modelo": "meta-llama/Meta-Llama-3.3-70B-Instruct",
        "donde": "https://stablehorde.net/register (registro gratis)",
        "estilo": "horde",
    },
}


def pedir(url, cuerpo, cabeceras, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode(),
                                 headers=cabeceras, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8", "replace"))


def comprobar(nombre, clave, extra):
    """Peticion real de prueba. Devuelve (ok, detalle)."""
    p = PROVEEDORES[nombre]
    estilo = p.get("estilo", "openai")
    if estilo == "gemini":
        url = p["url"] + "?key=" + clave
        cuerpo = {"contents": [{"role": "user", "parts": [{"text": "di hola en una palabra"}]}],
                  "generationConfig": {"maxOutputTokens": 32}}
        cabeceras = {"Content-Type": "application/json"}
    elif estilo == "cloudflare":
        url = f"{p['url']}/accounts/{extra}/ai/run/{p['modelo']}"
        cuerpo = {"messages": [{"role": "user", "content": "di hola en una palabra"}], "max_tokens": 32}
        cabeceras = {"Content-Type": "application/json", "Authorization": f"Bearer {clave}"}
    elif estilo == "horde":
        url = f"{p['url']}/generate/async"
        cuerpo = {"apikey": clave, "prompt": "User: di hola en una palabra",
                  "params": {"max_length": 32}, "models": [p["modelo"]],
                  "trusted_workers": False, "slow_workers": True}
        cabeceras = {"Content-Type": "application/json", "apikey": clave}
    else:
        url = p["url"]
        cuerpo = {"model": p["modelo"],
                  "messages": [{"role": "user", "content": "di hola en una palabra"}],
                  "max_tokens": 32}
        cabeceras = {"Content-Type": "application/json", "Authorization": f"Bearer {clave}"}
    try:
        status, datos = pedir(url, cuerpo, cabeceras)
        return True, f"HTTP {status}: el proveedor acepto la peticion"
    except urllib.error.HTTPError as e:
        detalle = e.read().decode("utf-8", "replace")[:160]
        if e.code in (401, 403):
            return False, f"HTTP {e.code}: la clave no es valida ({detalle})"
        if e.code == 400:
            return False, f"HTTP 400: el proveedor rechazo el modelo o el cuerpo ({detalle})"
        return False, f"HTTP {e.code}: {detalle}"
    except Exception as e:
        return False, f"error de red: {e}"


def guardar(nombre, clave, extra):
    datos = json.loads(CONFIG.read_text())
    claves = datos.setdefault("ia", {}).setdefault("claves", {})
    claves[nombre] = clave
    if extra:
        claves[nombre + "_account"] = extra
    CONFIG.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n")
    subprocess.run(["chown", "root:r34pete", str(CONFIG)], check=False)
    subprocess.run(["chmod", "640", str(CONFIG)], check=False)
    print(f"guardada en {CONFIG}")


def secreto_github(nombre, clave, extra=""):
    # El workflow lee <PROVEEDOR>_API_KEY (y CLOUDFLARE_ACCOUNT_ID aparte).
    try:
        subprocess.run(["gh", "secret", "set", f"{nombre.upper()}_API_KEY", "--body", clave],
                       check=True, capture_output=True)
        print(f"secreto {nombre.upper()}_API_KEY creado en {REPO}")
    except subprocess.CalledProcessError as e:
        print(f"no se pudo crear el secreto de GitHub: {e.stderr.decode()[:120]}")
    if extra:
        try:
            subprocess.run(["gh", "secret", "set", "CLOUDFLARE_ACCOUNT_ID", "--body", extra],
                           check=True, capture_output=True)
            print("secreto CLOUDFLARE_ACCOUNT_ID creado")
        except subprocess.CalledProcessError:
            pass


def main():
    print("Proveedores con plan gratuito (sin tarjeta):\n")
    for nombre, p in PROVEEDORES.items():
        print(f"  {nombre:12} {p['modelo']:42} {p['donde']}")
    print()

    objetivo = sys.argv[1] if len(sys.argv) > 1 else None
    if not objetivo:
        objetivo = input("Proveedor (o 'todos'): ").strip().lower()
    objetivos = list(PROVEEDORES) if objetivo in ("todos", "all") else [objetivo]

    import getpass
    for nombre in objetivos:
        if nombre not in PROVEEDORES:
            print(f"proveedor desconocido: {nombre}")
            continue
        p = PROVEEDORES[nombre]
        print(f"\n=== {nombre} ({p['modelo']}) ===")
        print(f"pide la clave en: {p['donde']}")
        clave = getpass.getpass("clave (no se muestra): ").strip()
        if not clave:
            print("sin clave, se salta")
            continue
        extra = ""
        if p.get("estilo") == "cloudflare":
            extra = input("id de cuenta de Cloudflare: ").strip()
        ok, detalle = comprobar(nombre, clave, extra)
        print(f"prueba: {detalle}")
        if not ok:
            print("no se guarda nada (la clave no vale)")
            continue
        guardar(nombre, clave, extra)
        secreto_github(nombre, clave, extra)

    print("\nListo. Para que las use el bot, anade el proveedor al orden:")
    print('  "ia": { "orden": ["pollinations", "groq", ...] }')
    print("en config.github.json (y en /etc/r34pete/config.json si corre en tu maquina).")


if __name__ == "__main__":
    main()
