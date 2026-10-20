"use strict";

/**
 * Proveedores de imagenes y video (tableros).
 *
 * - rule34    necesita user_id + api_key (se sacan de la cuenta en
 *             rule34.xxx → Ajustes de la cuenta). Es el tablero con mas
 *             material de adultos.
 * - e621      funciona sin credenciales con un User-Agent identificable y
 *             trae contenido "explicit", animaciones (.gif) y .webm.
 * - danbooru  funciona sin credenciales (su contenido explicito esta
 *             filtrado para cuentas anonimas). Sus animaciones son .gif.
 * - gelbooru  necesita credenciales; apagado por defecto.
 *
 * Todos se piden con fetch nativo de Node 20+ (sin dependencias extra).
 */

const LIMITE_MAXIMO = 100;
const TIPOS_IMAGEN = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const TIPOS_GIF = new Set(["gif"]);
const TIPOS_VIDEO = new Set(["webm", "mp4"]);

class ErrorProveedor extends Error {
  constructor(mensaje, proveedor) {
    super(mensaje);
    this.proveedor = proveedor;
  }
}

/** Espera minima entre peticiones al mismo tablero. */
const ESPERA_MINIMA_MS = 1200;
const ultimaPeticion = new Map();

async function esperarTurno(proveedor) {
  const ahora = Date.now();
  const previa = ultimaPeticion.get(proveedor) || 0;
  const faltan = ESPERA_MINIMA_MS - (ahora - previa);
  if (faltan > 0) await new Promise((r) => setTimeout(r, faltan));
  ultimaPeticion.set(proveedor, Date.now());
}

function cabeceras(userAgent, extra = {}) {
  return { "User-Agent": userAgent, Accept: "application/json, text/plain, */*", ...extra };
}

async function pedir(url, params, userAgent, extra = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  const r = await fetch(u, { headers: cabeceras(userAgent, extra), signal: AbortSignal.timeout(25000) });
  if (!r.ok) {
    throw new ErrorProveedor(`El tablero respondió HTTP ${r.status}`, u.hostname);
  }
  const tipo = r.headers.get("content-type") || "";
  if (!tipo.includes("json")) {
    throw new ErrorProveedor("El tablero no devolvió JSON", u.hostname);
  }
  return r.json();
}

/** Extension del archivo a partir de su URL. */
function extensionDe(url) {
  if (!url) return "";
  const limpio = String(url).split("?")[0];
  const partes = limpio.split(".");
  if (partes.length < 2) return "";
  return (partes.pop() || "").toLowerCase();
}

/** Clasifica un archivo en imagen / gif / video. */
function tipoDe(url, ext) {
  const e = (ext || extensionDe(url) || "").toLowerCase();
  if (TIPOS_VIDEO.has(e)) return "video";
  if (TIPOS_GIF.has(e)) return "gif";
  if (TIPOS_IMAGEN.has(e)) return "imagen";
  return "otro";
}

/** Etiqueta que usa cada tablero para el contenido animado. */
const ETIQUETA_ANIMADA = {
  rule34: "animated",
  e621: "animated",
  danbooru: "animated",
  gelbooru: "animated",
};

/** Añade "animated" al filtro cuando se pide gif o video. */
function conAnimado(tags, proveedor, medio) {
  if (medio === "imagen" || !medio) return tags;
  const et = ETIQUETA_ANIMADA[proveedor];
  if (!et) return tags;
  return tags ? `${tags} ${et}` : et;
}

// --------------------------------------------------------------------- rule34
async function rule34(cfg, tags, limit, medio) {
  const p = cfg.providers.rule34 || {};
  if (!p.userId || !p.apiKey) {
    throw new ErrorProveedor(
      "rule34 necesita user_id y api_key (se sacan en rule34.xxx → Ajustes de la cuenta)",
      "rule34"
    );
  }
  await esperarTurno("rule34");
  const datos = await pedir(
    "https://api.rule34.xxx/index.php",
    {
      page: "dapi",
      s: "post",
      q: "index",
      json: 1,
      tags: conAnimado(tags, "rule34", medio),
      limit: Math.min(limit, 100),
      user_id: p.userId,
      api_key: p.apiKey,
    },
    cfg.userAgent
  );
  if (datos.success === false || !Array.isArray(datos.posts)) {
    throw new ErrorProveedor(datos.message || "rule34 no devolvió resultados", "rule34");
  }
  return datos.posts
    .map((post) => {
      const url = post.file_url || post.sample_url || "";
      const etiquetas = Array.isArray(post.tags) ? post.tags.join(" ") : String(post.tags || "");
      return {
        id: String(post.id ?? ""),
        url,
        muestra: post.sample_url || "",
        tags: etiquetas,
        source: "rule34",
        pageUrl: post.post_url ? `https://rule34.xxx/post/${post.id}` : "",
        author: post.creator_name || "",
        ext: extensionDe(url),
        size: post.file_size || 0,
        tipo: tipoDe(url),
      };
    })
    .filter((x) => x.url);
}

// ----------------------------------------------------------------------- e621
async function e621(cfg, tags, limit, medio) {
  await esperarTurno("e621");
  const datos = await pedir(
    "https://e621.net/posts.json",
    { tags: conAnimado(tags, "e621", medio), limit: Math.min(limit, 75) },
    cfg.userAgent
  );
  const lista = Array.isArray(datos.posts) ? datos.posts : [];
  return lista
    .map((post) => {
      // e621 devuelve las etiquetas agrupadas por categoria y no trae tag_string.
      const etiquetas = post.tag_string
        ? String(post.tag_string)
        : Object.values(post.tags || {})
            .flat()
            .filter(Boolean)
            .join(" ");
      const artista =
        (post.tags && Array.isArray(post.tags.artist) && post.tags.artist[0]) ||
        post.artist_name ||
        post.uploader_name ||
        "";
      const archivo = post.file || {};
      const url = archivo.url || post.sample_url || "";
      return {
        id: String(post.id ?? ""),
        url,
        muestra: (post.sample && post.sample.url) || "",
        tags: etiquetas,
        source: "e621",
        pageUrl: post.id ? `https://e621.net/posts/${post.id}` : "",
        author: artista,
        ext: (archivo.ext || extensionDe(url) || "").toLowerCase(),
        size: archivo.size || 0,
        tipo: tipoDe(url, archivo.ext),
      };
    })
    .filter((x) => x.url);
}

// ------------------------------------------------------------------ danbooru
async function danbooru(cfg, tags, limit, medio) {
  await esperarTurno("danbooru");
  const datos = await pedir(
    "https://danbooru.donmai.us/posts.json",
    { tags: conAnimado(tags, "danbooru", medio), limit: Math.min(limit, 100) },
    cfg.userAgent
  );
  const lista = Array.isArray(datos) ? datos : [];
  return lista
    .map((post) => {
      const url = post.file_url || post.large_file_url || post.preview_file_url || "";
      const asset = post.media_asset || {};
      return {
        id: String(post.id ?? ""),
        url,
        muestra: post.preview_file_url || "",
        tags: String(post.tag_string || ""),
        source: "danbooru",
        pageUrl: post.id ? `https://danbooru.donmai.us/posts/${post.id}` : "",
        author: post.artist_name || "",
        ext: (asset.file_ext || extensionDe(url) || "").toLowerCase(),
        size: asset.file_size || 0,
        tipo: tipoDe(url, asset.file_ext),
      };
    })
    .filter((x) => x.url);
}

// ------------------------------------------------------------------ gelbooru
async function gelbooru(cfg, tags, limit, medio) {
  const p = cfg.providers.gelbooru || {};
  await esperarTurno("gelbooru");
  const datos = await pedir(
    "https://gelbooru.com/index.php",
    {
      page: "dapi",
      s: "post",
      q: "index",
      json: 1,
      tags: conAnimado(tags, "gelbooru", medio),
      limit: Math.min(limit, 100),
      user_id: p.userId,
      api_key: p.apiKey,
    },
    cfg.userAgent
  );
  const lista = Array.isArray(datos.post) ? datos.post : [];
  return lista
    .map((post) => {
      const url = post.file_url || post.sample_url || "";
      return {
        id: String(post.id ?? ""),
        url,
        muestra: post.sample_url || "",
        tags: String(post.tags || ""),
        source: "gelbooru",
        pageUrl: post.id ? `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}` : "",
        author: post.creator_name || "",
        ext: extensionDe(url),
        size: post.file_size || 0,
        tipo: tipoDe(url),
      };
    })
    .filter((x) => x.url);
}

const PROVEEDORES = {
  rule34,
  e621,
  danbooru,
  gelbooru,
};

/** Nombres disponibles segun la configuracion. */
function disponibles(cfg) {
  return Object.keys(PROVEEDORES).filter((nombre) => {
    const p = (cfg.providers && cfg.providers[nombre]) || {};
    if (p.enabled === false) return false;
    if (nombre === "rule34" || nombre === "gelbooru") {
      return Boolean(p.userId && p.apiKey);
    }
    return true;
  });
}

/**
 * Busca en un tablero.
 * @param medio "imagen" | "gif" | "video": filtra por tipo de archivo.
 */
async function buscar(cfg, nombre, tags, limit = 40, medio = "imagen") {
  const fn = PROVEEDORES[nombre];
  if (!fn) throw new ErrorProveedor(`Tablero desconocido: ${nombre}`, nombre);
  const p = (cfg.providers && cfg.providers[nombre]) || {};
  if (p.enabled === false) {
    throw new ErrorProveedor(`El tablero ${nombre} esta apagado en la configuracion.`, nombre);
  }
  const lista = await fn(cfg, tags, Math.min(limit, LIMITE_MAXIMO), medio);
  if (medio === "imagen") return lista.filter((x) => x.tipo === "imagen" || x.tipo === "otro");
  return lista.filter((x) => x.tipo === medio);
}

/** Descarga un archivo (mismo User-Agent: algunos tableros lo exigen). */
async function descargar(url, userAgent) {
  const r = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "image/*,video/*,application/octet-stream,*/*" },
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new ErrorProveedor(`No se pudo descargar el archivo (HTTP ${r.status})`, "descarga");
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, tipo: r.headers.get("content-type") || "" };
}

module.exports = {
  buscar,
  disponibles,
  descargar,
  ErrorProveedor,
  PROVEEDORES,
  extensionDe,
  tipoDe,
};
