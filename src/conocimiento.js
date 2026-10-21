"use strict";

/**
 * Base de conocimiento: "si te preguntan esto, responde aquello".
 *
 * Vive en un JSON aparte de las instrucciones para poder tocar las respuestas
 * sin tocar el prompt de personalidad, y se relee solo cuando cambia el
 * fichero (igual que instrucciones.md).
 *
 * Formato de cada regla:
 *   {
 *     "id": "nombre",
 *     "pregunta": "como te llamas",     // para Listing y para la IA
 *     "claves": ["r34pete", "quien eres"],  // se buscan en el texto del usuario
 *     "respuesta": "Me llamo R34pete...",    // lo que hay que contestar
 *     "exacto": false                  // true = se devuelve tal cual, sin IA
 *   }
 */

const fs = require("node:fs");

class Conocimiento {
  constructor(ruta = "/var/lib/r34pete/respuestas.json") {
    this.ruta = ruta;
    this.reglas = [];
    this.mtime = 0;
    this.cargar(true);
  }

  cargar(forzar = false) {
    try {
      const st = fs.statSync(this.ruta);
      if (!forzar && st.mtimeMs === this.mtime) return this.reglas;
      const datos = JSON.parse(fs.readFileSync(this.ruta, "utf8"));
      const lista = Array.isArray(datos) ? datos : datos.reglas || [];
      this.reglas = lista.filter((r) => r && r.respuesta);
      this.mtime = st.mtimeMs;
      console.log(`Conocimiento cargado de ${this.ruta} (${this.reglas.length} reglas)`);
    } catch (e) {
      if (forzar) console.warn(`No se pudo leer ${this.ruta}: ${e.message} (sin reglas extra)`);
    }
    return this.reglas;
  }

  /** Minusculas y sin acentos, para comparar sin que se líe. */
  static normalizar(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  /** Primera regla cuyas claves aparecen en el texto. */
  buscar(texto) {
    const t = Conocimiento.normalizar(texto);
    if (!t) return null;
    for (const regla of this.cargar()) {
      for (const clave of regla.claves || []) {
        const k = Conocimiento.normalizar(clave);
        if (k && t.includes(k)) return regla;
      }
    }
    return null;
  }

  /** Texto para pegar al prompt de sistema. */
  prompt() {
    const reglas = this.cargar();
    if (!reglas.length) return "";
    const lineas = reglas.map((r) => {
      const cuando = r.pregunta || (r.claves || []).join(", ");
      return `- Si te preguntan "${cuando}", respondes: ${r.respuesta}`;
    });
    return [
      "Base de conocimiento de Yuki (respeta estos datos cuando te los pregunten):",
      ...lineas,
    ].join("\n");
  }
}

module.exports = { Conocimiento };
