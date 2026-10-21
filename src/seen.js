"use strict";

/**
 * Registro de lo ya publicado, guardado en disco.
 *
 * Sirve para no repetir: el feed y /buscar consultan este registro antes de
 * elegir y, al publicar, apuntan el id. Al vivir en un fichero, sobrevive a
 * los reinicios del servicio (si no, el bot volvería a publicar lo mismo que
 * ya posteó antes de reiniciar).
 *
 * Importante: el registro se guarda POR MEDIO (proveedor:imagen, :gif,
 * :video) y al mirar si algo está visto se cuentan TODAS las claves del
 * proveedor (la simple, la del medio y las antiguas por id de feed). Antes
 * cada via usaba su propia clave, así que el feed publicaba un vídeo que
 * /buscar ya había publicado, y al revés.
 */

const fs = require("node:fs");
const path = require("node:path");

const MEDIOS = ["imagen", "gif", "video"];

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

  /**
   * Todas las claves que cuentan como "ya visto" para un proveedor.
   *
   * Se cogen TODAS las suyas (la simple y las que empiezan por "proveedor:"),
   * sin importar por que via se marco: asi, lo publicado por el feed, por
   * /buscar o por un feed antiguo con su propia clave (rule34:f2, rule34:f3)
   * nunca vuelve a salir, y el registro no se parte en trozos.
   */
  clavesDe(proveedor) {
    const prefijo = `${proveedor}:`;
    const claves = Object.keys(this.datos).filter(
      (k) => k === String(proveedor) || k.startsWith(prefijo)
    );
    return claves.length ? claves : [String(proveedor)];
  }

  /** ids ya vistos, en orden de marcado (los mas antiguos primero). */
  vistosDe(proveedor, ...extras) {
    const lista = [];
    for (const k of this.clavesDe(proveedor, ...extras)) {
      for (const id of this.datos[k] || []) lista.push(String(id));
    }
    return lista;
  }

  /** id de un elemento (admite objetos con .id o cadenas sueltas). */
  idDe(item) {
    if (item === null || item === undefined) return "";
    if (typeof item === "object") return String(item.id ?? "");
    return String(item);
  }

  /** elementos de una lista que no se han visto todavia. */
  sinVer(proveedor, items, ...extras) {
    const vistos = new Set(this.vistosDe(proveedor, ...extras));
    return (items || []).filter((item) => !vistos.has(this.idDe(item)));
  }

  /**
   * Apunta elementos como ya vistos. Se guardan en la clave canonica
   * proveedor:medio, que es la que comparten el feed y /buscar.
   */
  marcar(proveedor, items, ...extras) {
    const medio = extras.find((e) => MEDIOS.includes(String(e))) || extras[0] || "";
    const k = this.clave(proveedor, medio);
    const lista = this.datos[k] || [];
    for (const item of items || []) {
      const id = this.idDe(item);
      if (id && !lista.includes(id)) lista.push(id);
    }
    this.datos[k] = lista.slice(-this.max);
    this.guardar();
  }

  /**
   * Posicion de un id en el orden de marcado (0 = el mas antiguo). Sirve para
   * elegir, cuando no queda nada nuevo, lo que mas tiempo lleva sin
   * publicarse en vez de repetir siempre el primero.
   */
  posicionDe(proveedor, id, ...extras) {
    return this.vistosDe(proveedor, ...extras).indexOf(String(id));
  }

  /** cuantos hay apuntados (para el comando /estado). */
  cuantos(proveedor, ...extras) {
    if (!extras.length) return this.vistosDe(proveedor).length;
    return this.vistosDe(proveedor, ...extras).length;
  }
}

module.exports = { Vistos };
