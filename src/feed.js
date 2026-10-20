"use strict";

/**
 * Feed automatico: publica imagenes cada cierto tiempo en un canal con
 * restriccion de edad, con las etiquetas que se le configuren.
 *
 * Cada feed lleva su propio temporizador y recuerda los ultimos ids ya
 * publicados, para no repetir la misma imagen seguidas.
 */

const { EmbedBuilder } = require("discord.js");
const proveedores = require("./providers");
const { canalEsNsfw, revisarTags } = require("./guard");

class Feed {
  constructor(id, datos, cliente) {
    this.id = id;
    this.canalId = String(datos.canalId);
    this.proveedor = datos.proveedor || "e621";
    this.tags = datos.tags || "";
    this.cadaMinutos = Math.max(5, Number(datos.cadaMinutos || 30));
    this.activado = datos.activado !== false;
    this.etiquetasPermitidas = datos.etiquetasPermitidas || null;
    this.cliente = cliente;
    this.vistos = new Set();
    this.timer = null;
    this.ultimo = 0;
  }

  aJSON() {
    return {
      id: this.id,
      canalId: this.canalId,
      proveedor: this.proveedor,
      tags: this.tags,
      cadaMinutos: this.cadaMinutos,
      activado: this.activado,
      etiquetasPermitidas: this.etiquetasPermitidas,
    };
  }

  arrancar() {
    this.parar();
    if (!this.activado) return;
    const ms = this.cadaMinutos * 60 * 1000;
    this.timer = setInterval(() => {
      this.publicar().catch((e) => console.error(`[feed ${this.id}] ${e.message}`));
    }, ms);
    // El primer posting llega a la mitad del intervalo, no al arrancar.
    setTimeout(() => {
      this.publicar().catch((e) => console.error(`[feed ${this.id}] ${e.message}`));
    }, Math.floor(ms / 2));
  }

  parar() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async publicar() {
    const canal = await this.cliente.channels.fetch(this.canalId).catch(() => null);
    if (!canal || !canal.isTextBased()) return;
    if (!canalEsNsfw(canal)) {
      console.warn(`[feed ${this.id}] el canal ${this.canalId} no tiene restriccion de edad: no se publica`);
      return;
    }
    try {
      revisarTags(this.tags);
    } catch (e) {
      console.warn(`[feed ${this.id}] ${e.message}`);
      return;
    }

    const limite = this.etiquetasPermitidas ? this.etiquetasPermitidas.length : 40;
    const resultados = await proveedores.buscar(this.cliente.cfg, this.proveedor, this.tags, limite);
    if (!resultados.length) return;

    let elegido = null;
    for (const p of resultados) {
      if (!this.vistos.has(`${this.proveedor}:${p.id}`)) {
        elegido = p;
        break;
      }
    }
    if (!elegido) elegido = resultados[0];
    this.vistos.add(`${this.proveedor}:${elegido.id}`);
    if (this.vistos.size > 500) {
      this.vistos = new Set([...this.vistos].slice(-200));
    }

    const { buffer } = await proveedores.descargar(elegido.url, this.cliente.cfg.userAgent);
    const embed = new EmbedBuilder()
      .setColor(0x9b30ff)
      .setTitle("Feed")
      .addFields(
        { name: "Tablero", value: elegido.source, inline: true },
        { name: "id", value: elegido.id || "-", inline: true }
      );
    if (elegido.tags) {
      embed.addFields({ name: "Etiquetas", value: elegido.tags.slice(0, 1000) });
    }
    if (elegido.pageUrl) {
      embed.setURL(elegido.pageUrl);
    }
    await canal.send({ embeds: [embed], files: [{ attachment: buffer, name: "r34pete.jpg" }] });
    this.ultimo = Date.now();
  }
}

class GestorFeeds {
  constructor(cliente) {
    this.cliente = cliente;
    this.feeds = new Map();
    this.contador = 0;
  }

  cargarDesdeConfig(lista) {
    for (const datos of lista || []) {
      const id = String(datos.id || `f${++this.contador}`);
      const feed = new Feed(id, datos, this.cliente);
      this.feeds.set(id, feed);
      this.contador = Math.max(this.contador, Number(String(id).replace(/\D/g, "")) || 0);
    }
    this.arrancarTodos();
  }

  arrancarTodos() {
    for (const feed of this.feeds.values()) feed.arrancar();
  }

  pararTodos() {
    for (const feed of this.feeds.values()) feed.parar();
  }

  crear(datos) {
    const id = `f${++this.contador}`;
    const feed = new Feed(id, datos, this.cliente);
    this.feeds.set(id, feed);
    feed.arrancar();
    return feed;
  }

  borrar(id) {
    const feed = this.feeds.get(id);
    if (!feed) return false;
    feed.parar();
    this.feeds.delete(id);
    return true;
  }

  aJSON() {
    return [...this.feeds.values()].map((f) => f.aJSON());
  }
}

module.exports = { Feed, GestorFeeds };
