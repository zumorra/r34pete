"use strict";

/**
 * Cola de borradores: las respuestas que la IA ha preparado para los privados
 * de Yuki y que estan esperando a que el los mande.
 *
 * Se guarda en disco (y en el repo, para que sobrevivan a un reinicio de la
 * sesion): cada borrador tiene su id corto, quien lo escribio, lo que dijo y
 * la respuesta preparada.
 */

const fs = require("node:fs");
const path = require("node:path");

class Borradores {
  constructor(ruta = "/var/lib/r34pete/borradores.json", max = 50) {
    this.ruta = ruta;
    this.max = max;
    this.lista = [];
    this.mtime = 0;
    this.cargar(true);
  }

  cargar(forzar = false) {
    try {
      const st = fs.statSync(this.ruta);
      if (!forzar && st.mtimeMs === this.mtime) return this.lista;
      const datos = JSON.parse(fs.readFileSync(this.ruta, "utf8"));
      this.lista = Array.isArray(datos) ? datos : datos.lista || [];
      this.mtime = st.mtimeMs;
      console.log(`Borradores cargados de ${this.ruta} (${this.lista.length})`);
    } catch (e) {
      if (forzar) console.warn(`No se pudo leer ${this.ruta}: ${e.message}`);
    }
    return this.lista;
  }

  guardar() {
    try {
      fs.mkdirSync(path.dirname(this.ruta), { recursive: true });
      fs.writeFileSync(this.ruta, JSON.stringify(this.lista, null, 1));
    } catch (e) {
      console.warn(`No se pudieron guardar los borradores: ${e.message}`);
    }
  }

  /** Anota un borrador nuevo. Si ya hay uno del mismo mensaje, no lo duplica. */
  anadir({ destinatario, usuario, mensajeId, texto, respuesta }) {
    this.cargar();
    if (this.lista.some((b) => b.mensajeId === mensajeId && !b.enviado)) return null;
    const id = Date.now().toString(36).slice(-5);
    const borrador = {
      id,
      destinatario,
      usuario: usuario || "",
      mensajeId,
      texto,
      respuesta,
      creado: Date.now(),
      enviado: false,
    };
    this.lista.unshift(borrador);
    if (this.lista.length > this.max) this.lista.length = this.max;
    this.guardar();
    return borrador;
  }

  listar() {
    return this.cargar().filter((b) => !b.enviado);
  }

  porId(id) {
    return this.cargar().find((b) => b.id === String(id)) || null;
  }

  marcarEnviado(id) {
    const b = this.porId(id);
    if (!b) return null;
    b.enviado = true;
    b.enviadoEn = Date.now();
    this.guardar();
    return b;
  }
}

module.exports = { Borradores };
