"use strict";

/**
 * Registro de lo ya publicado, guardado en disco.
 *
 * Sirve para no repetir: el feed y /buscar consultan este registro antes de
 * elegir y, al publicar, apuntan el id. Al vivir en un fichero, sobrevive a
 * los reinicios del servicio (si no, el bot volvería a publicar lo mismo que
 * ya posteó antes de reiniciar).
 */

const fs = require("node:fs");
const path = require("node:path");

class Vistos {
  constructor(ruta = "/var/lib/r34pete/vistos.json", maxPorClave = 4000) {
    this.ruta = ruta;
    this.max = maxPorClave;
    this.datos = {};
    this.cargar();
  }

  cargar() {
    try {
      if (fs.existsSync(this.ruta)) {
        const datos = JSON.parse(fs.readFileSync(this.ruta, "utf8"));
        if (datos && typeof datos === "object") this.datos = datos;
      }
    } catch (e) {
      console.warn(`No se pudo leer ${this.ruta}: ${e.message}`);
      this.datos = {};
    }
  }

  guardar() {
    try {
      fs.mkdirSync(path.dirname(this.ruta), { recursive: true });
      fs.writeFileSync(this.ruta, JSON.stringify(this.datos));
    } catch (e) {
      console.warn(`No se pudieron guardar los vistos: ${e.message}`);
    }
  }

  clave(proveedor, extra = "") {
    return extra ? `${proveedor}:${extra}` : String(proveedor);
  }

  /** id de un elemento (admite objetos con .id o cadenas sueltas). */
  idDe(item) {
    if (item === null || item === undefined) return "";
    if (typeof item === "object") return String(item.id ?? "");
    return String(item);
  }

  /** elementos de una lista que no se han visto todavia. */
  sinVer(proveedor, items, extra = "") {
    const vistos = new Set(this.datos[this.clave(proveedor, extra)] || []);
    return (items || []).filter((item) => !vistos.has(this.idDe(item)));
  }

  /** apunta elementos como ya vistos (y persiste). */
  marcar(proveedor, items, extra = "") {
    const k = this.clave(proveedor, extra);
    const lista = this.datos[k] || [];
    for (const item of items || []) {
      const id = this.idDe(item);
      if (id) lista.push(id);
    }
    const unicos = [...new Set(lista)];
    this.datos[k] = unicos.slice(-this.max);
    this.guardar();
  }

  /** cuantos hay apuntados para una clave (para el comando /estado). */
  cuantos(proveedor, extra = "") {
    return (this.datos[this.clave(proveedor, extra)] || []).length;
  }
}

module.exports = { Vistos };
