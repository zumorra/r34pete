"use strict";

/**
 * Carga de configuración.
 *
 * Prioridad: variables de entorno > fichero config.json > valores por defecto.
 * El token y las claves de los tableros NUNCA se escriben en el repo:
 * van en /etc/r34pete/config.json (600) o en el entorno.
 */

const fs = require("node:fs");
const path = require("node:path");

const RUTA_POR_DEFECTO =
  process.env.R34PETE_CONFIG || "/etc/r34pete/config.json";

const POR_DEFECTO = {
  token: "",
  // Servidor donde se registran los comandos al instante.
  guildId: "",
  // Identificacion que los tableros ven en cada peticion.
  userAgent:
    "r34pete/1.0 (+https://github.com/zumorra/r34pete; contact: yuki)",
  providers: {
    rule34: { enabled: false, userId: "", apiKey: "" },
    e621: { enabled: true },
    danbooru: { enabled: true },
    gelbooru: { enabled: false, userId: "", apiKey: "" },
  },
  guards: {
    // Solo publica en canales con "Restriccion de edad" activada.
    requireNsfwChannel: true,
    // Rol "18+" (nombre o id). Vacio = no se exige.
    ageRole: "",
    // Segundos entre generaciones del mismo usuario.
    cooldownSeconds: 20,
    // Maximo de resultados que se piden por busqueda.
    maxResults: 40,
    // Limite de subida de Discord (25 MB por defecto; 50 MB con boost).
    maxUploadMb: 25,
  },
  feeds: [],
  // Fichero propio (escribible por el bot) donde se guardan los feeds
  // creados con /feed. La configuración con el token no se toca nunca.
  feedsFile: "/var/lib/r34pete/feeds.json",
  logLevel: "info",
};

function mezclar(base, extra) {
  const salida = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof salida[k] === "object" && salida[k] && !Array.isArray(salida[k])) {
      salida[k] = mezclar(salida[k], v);
    } else if (v !== undefined) {
      salida[k] = v;
    }
  }
  return salida;
}

function cargar(ruta = RUTA_POR_DEFECTO) {
  let datos = {};
  if (fs.existsSync(ruta)) {
    try {
      datos = JSON.parse(fs.readFileSync(ruta, "utf8"));
    } catch (e) {
      throw new Error(`El fichero de configuración ${ruta} no es JSON válido: ${e.message}`);
    }
  }

  let cfg = mezclar(POR_DEFECTO, datos);

  if (process.env.DISCORD_TOKEN) cfg.token = process.env.DISCORD_TOKEN;
  if (process.env.R34PETE_GUILD_ID) cfg.guildId = process.env.R34PETE_GUILD_ID;
  if (process.env.RULE34_USER_ID) {
    cfg.providers.rule34.userId = process.env.RULE34_USER_ID;
    cfg.providers.rule34.enabled = true;
  }
  if (process.env.RULE34_API_KEY) cfg.providers.rule34.apiKey = process.env.RULE34_API_KEY;
  if (process.env.R34PETE_FEEDS_FILE) cfg.feedsFile = process.env.R34PETE_FEEDS_FILE;

  if (!cfg.token) {
    throw new Error(
      `Falta el token de Discord. Ponlo en ${ruta} ([discord] no: campo "token") o en la variable DISCORD_TOKEN.`
    );
  }
  return cfg;
}

function rutaPorDefecto() {
  return RUTA_POR_DEFECTO;
}

module.exports = { cargar, rutaPorDefecto, POR_DEFECTO };
