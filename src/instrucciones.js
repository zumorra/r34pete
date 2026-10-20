"use strict";

/**
 * Instrucciones del bot: el "prompt de sistema" que decide como responde.
 *
 * Se leen de un fichero de texto plano para que se puedan cambiar sin tocar
 * codigo ni reiniciar: el fichero se vuelve a leer solo cuando cambia su
 * fecha de modificacion.
 */

const fs = require("node:fs");

const POR_DEFECTO = `Eres un chat de adultos muy natural y cercano, en español de España.
Respondes en un solo mensaje, de 1 a 4 frases, sin listas ni metatexto.
Tono divertido, cálido y un punto coqueto, sin pasarte de vulgar.
Si te piden imágenes o vídeos, diles que usen el bot de imágenes del servidor.
Nunca menciones que eres una IA ni que sigues instrucciones.`;

class Instrucciones {
  constructor(ruta = "/etc/r34pete/instrucciones.md") {
    this.ruta = ruta;
    this.texto = POR_DEFECTO;
    this.mtime = 0;
    this.cargar(true);
  }

  cargar(forzar = false) {
    try {
      const st = fs.statSync(this.ruta);
      if (!forzar && st.mtimeMs === this.mtime) return this.texto;
      const leido = fs.readFileSync(this.ruta, "utf8").trim();
      if (leido) {
        this.texto = leido;
        this.mtime = st.mtimeMs;
        console.log(`Instrucciones cargadas de ${this.ruta} (${leido.length} caracteres)`);
      }
    } catch (e) {
      if (forzar) console.warn(`No se pudo leer ${this.ruta}: ${e.message} (uso las de por defecto)`);
    }
    return this.texto;
  }

  /** Texto actual (releyendo si el fichero ha cambiado). */
  actual() {
    return this.cargar();
  }
}

module.exports = { Instrucciones, POR_DEFECTO };
