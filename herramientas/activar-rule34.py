#!/usr/bin/env python3
"""Activa rule34 en la configuración de R34pete.

La api_key se pide por terminal con getpass: NO se ve mientras la escribes,
NO queda en el historial y NO pasa por el chat. Antes de guardar nada, la
comprueba contra la API de rule34; si no vale, se para y no toca la config.

    sudo python3 herramientas/activar-rule34.py [user_id]

Dónde se saca la clave:
  1. En tu navegador normal, entra en rule34.xxx con tu cuenta.
  2. Ve a https://rule34.xxx/index.php?page=account&s=options  (Ajustes de la cuenta).
  3. Sección "API Keys": aparecen tu user_id y tu api_key. Si no hay clave,
     pidela ahí mismo (solo se concede una por aplicación).
  4. Copia la api_key y pégala cuando el script te la pida.
"""

import getpass
import json
import pathlib
import subprocess
import sys
import urllib.parse
import urllib.request

RUTA = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/etc/r34pete/config.json")
USER_ID_POR_DEFECTO = sys.argv[1] if len(sys.argv) > 1 else "6947812"
UA = "r34pete/1.0 (+https://github.com/zumorra/r34pete; contact: yuki)"


def probar(user_id, api_key, tags="furry"):
    """Devuelve (ok, detalle). Consulta la API de verdad con la clave."""
    url = (
        "https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1"
        f"&tags={urllib.parse.quote(tags)}&limit=3"
        f"&user_id={user_id}&api_key={urllib.parse.quote(api_key)}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            cuerpo = r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return False, f"error de red: {e}"
    limpio = cuerpo.strip()
    if limpio.startswith("{") or limpio.startswith("["):
        try:
            datos = json.loads(limpio)
            posts = datos.get("posts", []) if isinstance(datos, dict) else datos
            return True, f"OK: {len(posts)} resultados para '{tags}'"
        except json.JSONDecodeError:
            return False, "respuesta no es JSON válido"
    return False, f"rechazado: {limpio[:120]}"


def main() -> int:
    print("=" * 62)
    print(" Activando rule34 en R34pete")
    print("=" * 62)
    print("La api_key se pide ahora: no se ve al escribirla.")
    print("(Si prefieres, copiala de https://rule34.xxx/index.php?page=account&s=options)")
    print()

    datos = json.loads(RUTA.read_text())
    proveedores = datos.setdefault("providers", {})
    rule34 = proveedores.setdefault("rule34", {})

    user_id = input(f"user_id de rule34 [{USER_ID_POR_DEFECTO}]: ").strip() or USER_ID_POR_DEFECTO
    api_key = getpass.getpass("api_key de rule34 (no se muestra): ").strip()
    if not api_key:
        print("Sin api_key no puedo activarlo.", file=sys.stderr)
        return 1

    ok, detalle = probar(user_id, api_key)
    print(f"prueba con la clave -> {detalle}")
    if not ok:
        print(
            "La clave no es valida. Copiala entera de la pagina de opciones y prueba otra vez.",
            file=sys.stderr,
        )
        return 2

    rule34["userId"] = user_id
    rule34["apiKey"] = api_key
    rule34["enabled"] = True
    RUTA.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n")
    print(f"guardado en {RUTA}")

    print("reiniciando el servicio…")
    subprocess.run(["systemctl", "restart", "r34pete"], check=False)
    subprocess.run(["sleep", "6"], check=False)
    salida = subprocess.run(
        ["journalctl", "-u", "r34pete", "--no-pager", "-n", "6"], capture_output=True, text=True
    )
    print(salida.stdout.strip())
    print()
    print("rule34 activo. Ya puedes usar /buscar furry fuente:rule34")
    return 0


if __name__ == "__main__":
    sys.exit(main())
