"use strict";

/**
 * Proveedores de imagenes (tableros).
 *
 * - rule34    necesita user_id + api_key (se sacan de la cuenta en
 *             rule34.xxx → Ajustes de la cuenta). Es el tablero con mas
 *             material de adultos.
 * - e621      funciona sin credenciales con un User-Agent identificable y
 *             trae contenido "explicit".
 * - danbooru  funciona sin credenciales (su contenido explicito esta
 *             filtrado para cuentas anonimas).
 * - gelbooru  necesita credenciales; apagado por defecto.
 *
 * Todos se piden con fetch nativo de Node 20+ (sin dependencias extra).
 */

const LIMITE_MAXIMO = 100;

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

// --------------------------------------------------------------------- rule34
async function rule34(cfg, tags, limit) {
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
      tags,
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
    .map((post) => ({
      id: String(post.id ?? ""),
      url: post.file_url || post.sample_url || "",
      tags: Array.isArray(post.tags) ? post.tags.join(" ") : String(post.tags || ""),
      source: "rule34",
      pageUrl: post.post_url ? `https://rule34.xxx/post/${post.id}` : "",
      author: post.creator_name || "",
    }))
    .filter((x) => x.url);
}

// ----------------------------------------------------------------------- e621
async function e621(cfg, tags, limit) {
  await esperarTurno("e621");
  const datos = await pedir(
    "https://e621.net/posts.json",
    { tags, limit: Math.min(limit, 75) },
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
      return {
        id: String(post.id ?? ""),
        url: (post.file && post.file.url) || post.sample_url || "",
        tags: etiquetas,
        source: "e621",
        pageUrl: post.id ? `https://e621.net/posts/${post.id}` : "",
        author: artista,
      };
    })
    .filter((x) => x.url);
}

// ------------------------------------------------------------------ danbooru
async function danbooru(cfg, tags, limit) {
  await esperarTurno("danbooru");
  const datos = await pedir(
    "https://danbooru.donmai.us/posts.json",
    { tags, limit: Math.min(limit, 100) },
    cfg.userAgent
  );
  const lista = Array.isArray(datos) ? datos : [];
  return lista
    .map((post) => ({
      id: String(post.id ?? ""),
      url: post.file_url || post.large_file_url || post.preview_file_url || "",
      tags: String(post.tag_string || ""),
      source: "danbooru",
      pageUrl: post.id ? `https://danbooru.donmai.us/posts/${post.id}` : "",
      author: post.artist_name || "",
    }))
    .filter((x) => x.url);
}

// ------------------------------------------------------------------ gelbooru
async function gelbooru(cfg, tags, limit) {
  const p = cfg.providers.gelbooru || {};
  await esperarTurno("gelbooru");
  const datos = await pedir(
    "https://gelbooru.com/index.php",
    {
      page: "dapi",
      s: "post",
      q: "index",
      json: 1,
      tags,
      limit: Math.min(limit, 100),
      user_id: p.userId,
      api_key: p.apiKey,
    },
    cfg.userAgent
  );
  const lista = Array.isArray(datos.post) ? datos.post : [];
  return lista
    .map((post) => ({
      id: String(post.id ?? ""),
      url: post.file_url || post.sample_url || "",
      tags: String(post.tags || ""),
      source: "gelbooru",
      pageUrl: post.id ? `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}` : "",
      author: post.creator_name || "",
    }))
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

/** Busca en un tablero. */
async function buscar(cfg, nombre, tags, limit = 40) {
  const fn = PROVEEDORES[nombre];
  if (!fn) throw new ErrorProveedor(`Tablero desconocido: ${nombre}`, nombre);
  const p = (cfg.providers && cfg.providers[nombre]) || {};
  if (p.enabled === false) {
    throw new ErrorProveedor(`El tablero ${nombre} esta apagado en la configuracion.`, nombre);
  }
  return fn(cfg, tags, Math.min(limit, LIMITE_MAXIMO));
}

/** Descarga una imagen (mismo User-Agent: algunos tableros lo exigen). */
async function descargar(url, userAgent) {
  const r = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "image/*,*/*" },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new ErrorProveedor(`No se pudo descargar la imagen (HTTP ${r.status})`, "descarga");
  const tipo = r.headers.get("content-type") || "";
  if (!tipo.startsWith("image/")) {
    throw new ErrorProveedor("La respuesta no era una imagen", "descarga");
  }
  const buffer = Buffer.from(await r.arrayBuffer());
  return { buffer, tipo };
}

module.exports = { buscar, disponibles, descargar, ErrorProveedor, PROVEEDORES };
