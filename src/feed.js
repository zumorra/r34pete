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
    this.medio = datos.medio || "imagen";
    this.cadaMinutos = Math.max(5, Number(datos.cadaMinutos || 30));
    this.activado = datos.activado !== false;
    this.etiquetasPermitidas = datos.etiquetasPermitidas || null;
    this.cliente = cliente;
    this.pagina = 0;          // rota de pagina para no repetir
    this.timer = null;
    this.ultimo = 0;
  }

  aJSON() {
    return {
      id: this.id,
      canalId: this.canalId,
      proveedor: this.proveedor,
      tags: this.tags,
      medio: this.medio,
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
    const vistos = this.cliente.vistos;

    // Se recorren varias paginas hasta encontrar algo que no se haya
    // publicado antes. El registro de vistos vive en disco, asi que el
    // bot no repite lo que ya posteo en una sesion anterior.
    let elegido = null;
    let probadas = 0;
    for (let salto = 0; salto < 4 && !elegido; salto++) {
      const pagina = this.pagina + salto;
      const resultados = await proveedores.buscar(
        this.cliente.cfg,
        this.proveedor,
        this.tags,
        limite,
        this.medio,
        { pagina }
      );
      if (!resultados.length) continue;
      probadas++;
      const nuevos = vistos.sinVer(this.proveedor, resultados, this.id);
      const bolsa = nuevos.length ? nuevos : resultados;
      elegido = bolsa[Math.floor(Math.random() * bolsa.length)];
      vistos.marcar(this.proveedor, [elegido.id], this.id);
    }
    if (!elegido) {
      console.warn(`[feed ${this.id}] no hay resultados en las paginas probadas`);
      return;
    }
    this.pagina = (this.pagina + Math.max(1, probadas)) % 20;

    const { post: elegidoPost, buffer } = await proveedores.descargarApto(
      [elegido],
      this.cliente.cfg.guards.maxUploadMb || 25,
      this.cliente.cfg.userAgent
    );
    if (!elegidoPost) {
      console.warn(`[feed ${this.id}] el archivo no cabe en el limite de subida`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0x9b30ff)
      .setTitle("Feed")
      .addFields(
        { name: "Tablero", value: elegidoPost.source, inline: true },
        { name: "id", value: elegidoPost.id || "-", inline: true },
        { name: "Medio", value: elegidoPost.tipo || this.medio, inline: true }
      );
    if (elegidoPost.tags) {
      embed.addFields({ name: "Etiquetas", value: elegidoPost.tags.slice(0, 1000) });
    }
    if (elegidoPost.pageUrl) {
      embed.setURL(elegidoPost.pageUrl);
    }
    const validas = ["jpg", "jpeg", "png", "webp", "gif", "webm", "mp4"];
    const ext = validas.includes((elegidoPost.ext || "").toLowerCase())
      ? (elegidoPost.ext || "").toLowerCase()
      : elegidoPost.tipo === "video"
        ? "webm"
        : "jpg";
    await canal.send({
      embeds: [embed],
      files: [{ attachment: buffer, name: `r34pete.${ext}` }],
    });
    console.log(
      `[feed ${this.id}] publicado id ${elegidoPost.id} (${elegidoPost.ext}, ${Math.round(buffer.length / 1024)} KB) en ${this.canalId}`
    );
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
