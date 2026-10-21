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
    let probadas = 0;
    let restantes = 0;
    const candidatos = [];
    for (let salto = 0; salto < 16 && candidatos.length < 10; salto++) {
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
      // Se miran TODAS las claves del proveedor (medio y id del feed):
      // si no, el feed repetiria lo que ya publico /buscar.
      const nuevos = vistos
        ? vistos.sinVer(this.proveedor, resultados, this.medio, this.id)
        : resultados;
      restantes += resultados.length - nuevos.length;
      // Si esta pagina esta toda vista, se prueba la siguiente en vez de
      // repetir: repetir solo pasa si no queda nada nuevo en ninguna pagina.
      if (!nuevos.length) continue;
      candidatos.push(...nuevos);
      console.log(
        `[feed ${this.id}] pagina ${pagina}: ${nuevos.length} sin ver de ${resultados.length}`
      );
    }
    this.pagina = (this.pagina + Math.max(1, probadas)) % 20;

    if (!candidatos.length) {
      // Ultimo recurso: se repite el primer resultado de la pagina actual.
      const resultados = await proveedores.buscar(
        this.cliente.cfg,
        this.proveedor,
        this.tags,
        limite,
        this.medio,
        { pagina: this.pagina }
      );
      if (!resultados.length) {
        console.warn(`[feed ${this.id}] no hay resultados en ${this.proveedor}`);
        return;
      }
      // No queda nada nuevo en ninguna pagina: se repite el que mas tiempo
      // lleva sin publicarse (el mas antiguo del registro), no siempre el
      // primero, para que la repeticion sea la mas espaciada posible.
      if (vistos) {
        const antiguedad = (post) => {
          const p = vistos.posicionDe(this.proveedor, vistos.idDe(post), this.medio, this.id);
          return p < 0 ? Number.MAX_SAFE_INTEGER : p;
        };
        resultados.sort((a, b) => antiguedad(a) - antiguedad(b));
      }
      candidatos.push(resultados[0]);
      console.warn(
        `[feed ${this.id}] no queda nada nuevo (${restantes} ya vistos): se repetira el mas antiguo (id ${resultados[0].id})`
      );
    }

    // Se prueba cada candidato hasta que uno se descargue bien y quepa.
    const descargado = await proveedores.descargarApto(
      candidatos,
      this.cliente.cfg.guards.maxUploadMb || 25,
      this.cliente.cfg.userAgent
    );
    if (!descargado) {
      console.warn(
        `[feed ${this.id}] no se pudo descargar ninguno de los ${candidatos.length} candidatos`
      );
      return;
    }
    const elegidoPost = descargado.post;
    const buffer = descargado.buffer;
    if (vistos) vistos.marcar(this.proveedor, [elegidoPost.id], this.medio, this.id);
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
