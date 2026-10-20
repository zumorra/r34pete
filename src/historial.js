"use strict";

/**
 * Memoria de conversacion por usuario (en memoria, no se guarda en disco).
 *
 * Se guarda una ventana de los ultimos mensajes para que el bot tenga
 * contexto de lo que se ha dicho, sin crecer sin limite.
 */

class Historial {
  constructor(maximo = 12) {
    this.maximo = maximo;
    this.mapa = new Map();
  }

  /** Devuelve el historial (sin mutarlo) y anade el mensaje nuevo. */
  anadir(usuarioId, rol, texto) {
    if (!this.mapa.has(usuarioId)) this.mapa.set(usuarioId, []);
    const lista = this.mapa.get(usuarioId);
    lista.push({ role: rol, content: texto });
    while (lista.length > this.maximo) lista.shift();
    return lista;
  }

  ultimos(usuarioId, n = this.maximo) {
    const lista = this.mapa.get(usuarioId) || [];
    return lista.slice(-n);
  }

  olvidar(usuarioId) {
    const n = (this.mapa.get(usuarioId) || []).length;
    this.mapa.delete(usuarioId);
    return n;
  }

  vaciar() {
    const n = this.mapa.size;
    this.mapa.clear();
    return n;
  }
}

module.exports = { Historial };
