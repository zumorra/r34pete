"use strict";

/**
 * Crea un canal de texto con restricción de edad en el servidor configurado.
 * Usa el token del bot (lo lee de la configuración, nunca de la línea de
 * comandos) y la API de Discord.
 *
 *   node herramientas/crear-canal.js [nombre] [guildId]
 *
 * El bot necesita permiso de «Gestionar canales» en el servidor.
 */

const fs = require("node:fs");
const path = require("node:path");

const RUTA_CONFIG = process.env.R34PETE_CONFIG || "/etc/r34pete/config.json";

function cargarConfig() {
  const ruta = process.argv[3] ? path.resolve(process.argv[3]) : RUTA_CONFIG;
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

async function main() {
  const cfg = cargarConfig();
  const nombre = process.argv[2] || "nsfw";
  const guildId = cfg.guildId;
  if (!guildId) throw new Error("Falta guildId en la configuración");
  if (!cfg.token) throw new Error("Falta el token en la configuración");

  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${cfg.token}`,
      "Content-Type": "application/json",
      "User-Agent": cfg.userAgent,
    },
    body: JSON.stringify({
      name: nombre,
      type: 0,
      nsfw: true,
      topic: "Canal con restricción de edad para R34pete (feed automático y búsquedas).",
    }),
  });
  const cuerpo = await r.json();
  if (!r.ok) {
    console.error(`HTTP ${r.status}:`, cuerpo);
    process.exit(1);
  }
  console.log(`Canal creado: ${cuerpo.name} (${cuerpo.id}) nsfw=${cuerpo.nsfw}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
