"use strict";

/**
 * Registro de los privados donde se ha hablado con el bot.
 *
 * Sirve para dos cosas:
 *  - saber en que canales hay que mirar al arrancar;
 *  - retomar la conversacion si alguien escribio mientras el bot estaba
 *    reiniciandose (la sesion de GitHub Actions rota cada pocas horas).
 */

const fs = require("node:fs");
const path = require("node:path");

class Pendientes {
  constructor(ruta = "/var/lib/r34pete/pendientes.json", max = 50) {
    this.ruta = ruta;
    this.max = max;
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
      fs.writeFileSync(this.ruta, JSON.stringify(this.datos, null, 1));
    } catch (e) {
      console.warn(`No se pudieron guardar los pendientes: ${e.message}`);
    }
  }

  /** Apunta el ultimo mensaje visto en un canal. */
  anotar(canalId, mensajeId) {
    this.datos[String(canalId)] = { ultimo: String(mensajeId), visto: Date.now() };
    // Poda los canales mas antiguos para no crecer sin fin.
    const claves = Object.entries(this.datos)
      .sort((a, b) => (b[1].visto || 0) - (a[1].visto || 0))
      .slice(0, this.max);
    this.datos = Object.fromEntries(claves);
    this.guardar();
  }

  /** Canales conocidos, del mas reciente al mas antiguo. */
  canales(limite = 20) {
    return Object.entries(this.datos)
      .sort((a, b) => (b[1].visto || 0) - (a[1].visto || 0))
      .slice(0, limite)
      .map(([id, v]) => ({ id, ...v }));
  }
}

module.exports = { Pendientes };
