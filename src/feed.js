"use strict";

/**
 * Feed automatico: publica en un canal con restriccion de edad.
 *
 * Cada "tirada" publica varios ficheros segun el perfil de slots del feed:
 * por ejemplo ["largo", "largo", "medio", "extraCorto"] para los videos y
 * ["cualquiera", "cualquiera"] para los GIFs. El tamano se averigua con una
 * peticion HEAD al fichero (sin descargarlo entero).
 *
 * Para no repetir nunca hay dos capas:
 *   1. el registro de publicados (vistos.json), que sobrevive a los reinicios;
 *   2. los ids que ya estan publicados en el propio canal, que se releen cada
 *      pocos minutos: asi, aunque se pierda el registro, el bot sigue sin
 *      repetir (era justo lo que pasaba al reiniciar la sesion).
 */

const { EmbedBuilder } = require("discord.js");
const proveedores = require("./providers");
const { canalEsNsfw, revisarTags } = require("./guard");

// Umbrales de tamano (bytes) para clasificar un video.
const UMBRALES = {
  extraCorto: 1 * 1024 * 1024, // < 1 MB
  corto: 3 * 1024 * 1024, // 1-3 MB
  medio: 10 * 1024 * 1024, // 3-10 MB
};
const ORDEN_BUCKETS = ["extraCorto", "corto", "medio", "largo"];
const MAX_PAGINAS_POR_TIRADA = 10;
const CANDIDATOS_MAX = 40;
const PAUSA_ENTRE_MENSAJES = 1200;

function bucketDe(bytes) {
  if (!bytes) return "medio";
  if (bytes < UMBRALES.extraCorto) return "extraCorto";
  if (bytes < UMBRALES.corto) return "corto";
  if (bytes < UMBRALES.medio) return "medio";
  return "largo";
}

/** Distancia entre dos buckets (0 = el mismo). */
function distancia(a, b) {
  const ia = ORDEN_BUCKETS.indexOf(a);
  const ib = ORDEN_BUCKETS.indexOf(b);
  if (ia < 0 || ib < 0) return 99;
  return Math.abs(ia - ib);
}

/**
 * Un solo feed por proveedor a la vez. Sin esto, los dos feeds (video y gif)
 * pueden mirar la lista en el mismo instante y elegir el MISMO post, que
 * acabaria publicado dos veces.
 */
const bloqueos = new Map();

async function conBloqueo(proveedor, fn) {
  const anterior = bloqueos.get(proveedor) || Promise.resolve();
  let liberar;
  const mio = new Promise((r) => {
    liberar = r;
  });
  bloqueos.set(proveedor, anterior.then(() => mio));
  await anterior;
  try {
    return await fn();
  } finally {
    liberar();
  }
}

class Feed {
  constructor(id, datos, cliente) {
    this.id = id;
    this.canalId = String(datos.canalId);
    this.proveedor = datos.proveedor || "e621";
    this.tags = datos.tags || "";
    this.medio = datos.medio || "imagen";
    this.cadaMinutos = Math.max(1, Number(datos.cadaMinutos || 30));
    this.activado = datos.activado !== false;
    this.etiquetasPermitidas = datos.etiquetasPermitidas || null;
    // Perfil de la tirada: que slots se publican y de que tamano.
    this.slots =
      Array.isArray(datos.slots) && datos.slots.length
        ? datos.slots.map((s) => String(s))
        : ["cualquiera"];
    this.cliente = cliente;
    this.timer = null;
    this.ultimo = 0;
    this.publicando = false;
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
      slots: this.slots,
    };
  }

  get estado() {
    return this.cliente.estadoFeeds ? this.cliente.estadoFeeds.de(this.id) : { pagina: 0, tamanos: {}, publicados: [] };
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
    // Con intervalo corto una publicacion puede solaparse con la anterior.
    if (this.publicando) return;
    this.publicando = true;
    try {
      await conBloqueo(this.proveedor, () => this.publicarAhora());
    } finally {
      this.publicando = false;
    }
  }

  /** Ids ya publicados en el propio canal (capa 2 anti-repeticion). */
  async idsDelCanal(canal) {
    const estado = this.estado;
    const ahora = Date.now();
    if (estado.publicados && estado.publicados.length && ahora - (estado.leidoCanal || 0) < 120000) {
      return estado.publicados;
    }
    const ids = [];
    try {
      const mensajes = await canal.messages.fetch({ limit: 100 });
      for (const m of mensajes.values()) {
        for (const e of m.embeds || []) {
          for (const f of e.fields || []) {
            if (f.name === "id" && f.value && f.value !== "-") ids.push(String(f.value));
          }
        }
      }
      estado.publicados = ids;
      estado.leidoCanal = ahora;
      if (this.cliente.estadoFeeds) this.cliente.estadoFeeds.guardarDe(this.id);
    } catch (e) {
      console.warn(`[feed ${this.id}] no se pudieron leer los mensajes del canal: ${e.message}`);
    }
    return estado.publicados || [];
  }

  /** Tamano de un post (con cache en el estado, para no repetir el HEAD). */
  async tamano(post) {
    const estado = this.estado;
    const id = String(post.id);
    if (estado.tamanos && estado.tamanos[id]) return Number(estado.tamanos[id]);
    const bytes = await proveedores.tamanoDe(post.url, this.cliente.cfg.userAgent);
    if (bytes > 0) {
      estado.tamanos[id] = bytes;
      if (this.cliente.estadoFeeds) this.cliente.estadoFeeds.guardarDe(this.id);
    }
    return bytes;
  }

  async publicarAhora() {
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
    const estado = this.estado;
    const yaEnElCanal = new Set(await this.idsDelCanal(canal));

    // Recorre paginas hasta tener suficientes candidatos sin ver.
    let probadas = 0;
    const candidatos = [];
    for (let salto = 0; salto < MAX_PAGINAS_POR_TIRADA && candidatos.length < CANDIDATOS_MAX; salto++) {
      const pagina = (estado.pagina || 0) + salto;
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
      const nuevos = vistos
        ? vistos.sinVer(this.proveedor, resultados, this.medio, this.id)
        : resultados;
      for (const post of nuevos) {
        if (yaEnElCanal.has(String(post.id))) continue;
        candidatos.push(post);
        if (candidatos.length >= CANDIDATOS_MAX) break;
      }
    }
    // La pagina sigue avanzando: el indice de rule34 tiene miles de entradas
    // y asi el feed va metiendose en material cada vez mas viejo en vez de
    // dar la vuelta y repetir lo mismo.
    estado.pagina = ((estado.pagina || 0) + Math.max(1, probadas)) % 400;
    if (this.cliente.estadoFeeds) this.cliente.estadoFeeds.guardarDe(this.id);

    if (!candidatos.length) {
      console.warn(`[feed ${this.id}] no hay nada nuevo en ${probadas} paginas`);
      return;
    }

    // Reparte los candidatos entre los slots de la tirada. Primero se averigua
    // el tamano de cada uno (HEAD, con cache) para poder clasificarlos y
    // descartar los que no caben en el limite de subida de Discord (si no,
    // el slot se perdia: un video de 100 MB no se puede subir).
    const maxBytes = (this.cliente.cfg.guards.maxUploadMb || 25) * 1024 * 1024;
    const info = [];
    for (const post of candidatos) {
      const bytes = await this.tamano(post);
      info.push({ post, bytes, cabe: !bytes || bytes <= maxBytes });
    }

    const usados = new Set();
    const planes = [];
    for (const slot of this.slots) {
      const opciones = [];
      if (slot === "cualquiera") {
        for (const i of info) {
          if (!usados.has(String(i.post.id)) && i.cabe) opciones.push(i.post);
        }
        if (!opciones.length) {
          for (const i of info) {
            if (!usados.has(String(i.post.id))) opciones.push(i.post);
          }
        }
      } else {
        // Se ordenan por lo cerca que estan del tamano pedido.
        const conDistancia = info
          .filter((i) => !usados.has(String(i.post.id)))
          .map((i) => ({ ...i, d: distancia(bucketDe(i.bytes), slot) }))
          .sort((a, b) => a.d - b.d);
        for (const i of conDistancia) {
          if (i.cabe) opciones.push(i.post);
        }
        // Si no hay NINGUNO que quepa en el limite de subida, se usan los que
        // no caben (mejor publicar algo que no cumple el perfil a no publicar).
        if (!opciones.length) {
          for (const i of conDistancia) opciones.push(i.post);
        }
      }
      if (!opciones.length) break;
      // Solo se reservan los candidatos del plan (los 3 primeros): si se
      // marcaran todos, el siguiente slot se quedaria sin opciones.
      const plan = opciones.slice(0, 3);
      for (const p of plan) usados.add(String(p.id));
      planes.push({ slot, opciones: plan });
    }

    if (!planes.length) {
      console.warn(`[feed ${this.id}] no se pudo elegir nada para los slots ${this.slots.join(", ")}`);
      return;
    }

    // Se descarga y publica uno a uno, con una pausa para no ir contra el
    // limite de Discord. Si el primero no se puede descargar, se prueba con
    // el siguiente del slot.
    for (const plan of planes) {
      let descargado = null;
      for (const post of plan.opciones) {
        descargado = await proveedores.descargarApto(
          [post],
          this.cliente.cfg.guards.maxUploadMb || 25,
          this.cliente.cfg.userAgent
        );
        if (descargado) break;
      }
      if (!descargado) {
        console.warn(`[feed ${this.id}] no se pudo descargar nada para el slot ${plan.slot}`);
        continue;
      }
      const elegidoPost = descargado.post;
      const buffer = descargado.buffer;
      if (vistos) vistos.marcar(this.proveedor, [elegidoPost.id], this.medio, this.id);
      estado.publicados = [String(elegidoPost.id), ...(estado.publicados || [])].slice(0, 300);

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
        `[feed ${this.id}] publicado id ${elegidoPost.id} (${(buffer.length / 1024 / 1024).toFixed(1)} MB, ${elegidoPost.ext}) en ${this.canalId}`
      );
      this.ultimo = Date.now();
      await new Promise((r) => setTimeout(r, PAUSA_ENTRE_MENSAJES));
    }
    if (this.cliente.estadoFeeds) this.cliente.estadoFeeds.guardarDe(this.id);
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
    const feed = this.feeds.get(String(id));
    if (!feed) return false;
    feed.parar();
    this.feeds.delete(String(id));
    return true;
  }

  aJSON() {
    return [...this.feeds.values()].map((f) => f.aJSON());
  }
}

module.exports = { Feed, GestorFeeds, bucketDe, UMBRALES, ORDEN_BUCKETS };
