"use strict";

/**
 * Estado persistente de los feeds: en que pagina va cada uno, los tamanos que
 * ya se saben (para no repetir las peticiones HEAD) y los ultimos ids
 * publicados que se han leido del canal.
 *
 * Vive en .r34pete/feed-estado.json y lo commitea el bot junto con el
 * registro de publicados.
 */

const fs = require("node:fs");
const path = require("node:path");

class EstadoFeeds {
  constructor(ruta = "/var/lib/r34pete/feed-estado.json", maxTamanos = 3000) {
    this.ruta = ruta;
    this.maxTamanos = maxTamanos;
    this.datos = {};
    this.cargar();
  }

  cargar() {
    try {
      if (fs.existsSync(this.ruta)) {
        const d = JSON.parse(fs.readFileSync(this.ruta, "utf8"));
        if (d && typeof d === "object") this.datos = d;
      }
    } catch (e) {
      console.warn(`No se pudo leer ${this.ruta}: ${e.message}`);
    }
  }

  guardar() {
    try {
      fs.mkdirSync(path.dirname(this.ruta), { recursive: true });
      fs.writeFileSync(this.ruta, JSON.stringify(this.datos));
    } catch (e) {
      console.warn(`No se pudo guardar el estado de los feeds: ${e.message}`);
    }
  }

  /** Estado de un feed (se crea vacio si no existe). */
  de(id) {
    const k = String(id);
    if (!this.datos[k]) {
      this.datos[k] = { pagina: 0, tamanos: {}, publicados: [] };
    }
    const e = this.datos[k];
    if (!e.tamanos) e.tamanos = {};
    if (!e.publicados) e.publicados = [];
    return e;
  }

  /** Guarda el estado de un feed y poda los tamanos viejos. */
  guardarDe(id) {
    const e = this.de(id);
    const claves = Object.keys(e.tamanos);
    if (claves.length > this.maxTamanos) {
      const sobra = claves.slice(0, claves.length - this.maxTamanos);
      for (const k of sobra) delete e.tamanos[k];
    }
    this.guardar();
  }
}

module.exports = { EstadoFeeds };
