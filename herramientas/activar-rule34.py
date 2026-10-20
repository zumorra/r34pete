#!/usr/bin/env python3
"""Activa rule34 en la configuración de R34pete.

Pide la api_key por terminal SIN mostrarla (getpass), la guarda junto al
user_id, habilita el tablero, reinicia el servicio y prueba que funciona.

    sudo python3 herramientas/activar-rule34.py [user_id]

La clave no pasa por el chat, ni queda en el historial de la terminal
(getpass no la eco), ni se imprime en ningún log.
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
    if cuerpo.strip().startswith("{") or cuerpo.strip().startswith("["):
        try:
            datos = json.loads(cuerpo)
            posts = datos.get("posts", []) if isinstance(datos, dict) else datos
            return True, f"OK: {len(posts)} resultados para '{tags}'"
        except json.JSONDecodeError:
            return False, "respuesta no es JSON válido"
    return False, f"rechazado: {cuerpo.strip()[:120]}"


def main() -> int:
    print("== Activando rule34 en R34pete ==")
    datos = json.loads(RUTA.read_text())
    proveedores = datos.setdefault("providers", {})
    rule34 = proveedores.setdefault("rule34", {})

    user_id = input(f"user_id de rule34 [{USER_ID_POR_DEFECTO}]: ").strip() or USER_ID_POR_DEFECTO
    api_key = getpass.getpass("api_key de rule34 (no se muestra): ").strip()
    if not api_key:
        print("Sin api_key no puedo activarlo.", file=sys.stderr)
        return 1

    ok, detalle = probar(user_id, api_key)
    print(f"prueba con la clave: {detalle}")
    if not ok:
        print("La clave no es valida: revisa que la copies entera de la pagina de opciones.",
              file=sys.stderr)
        return 2

    rule34["userId"] = user_id
    rule34["apiKey"] = api_key
    rule34["enabled"] = True
    RUTA.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n")
    print(f"guardado en {RUTA} (permisos intactos)")

    print("reiniciando el servicio…")
    subprocess.run(["systemctl", "restart", "r34pete"], check=False)
    subprocess.run(["sleep", "6"], check=False)
    salida = subprocess.run(
        ["journalctl", "-u", "r34pete", "--no-pager", "-n", "5"], capture_output=True, text=True
    )
    print(salida.stdout.strip())
    print("listo: rule34 activo. Ya puedes usar /buscar con fuente:rule34")
    return 0


if __name__ == "__main__":
    sys.exit(main())
