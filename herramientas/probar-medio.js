"use strict";

/**
 * Publica una imagen, un gif o un vídeo en un canal, usando el mismo camino
 * que el bot (tablero → descarga → subida a Discord). Sirve para comprobar
 * que los tres medios funcionan de verdad.
 *
 *   node herramientas/probar-medio.js <canalId> <palabra> [palabra…]
 *   node herramientas/probar-medio.js 1562158527164850274 furry
 *   node herramientas/probar-medio.js 1562158527164850274 furry videos
 */

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const proveedores = require("../src/providers");
const presets = require("../src/presets");
const { cargar } = require("../src/config");

const canalId = process.argv[2];
const entrada = process.argv.slice(3).join(" ");
if (!canalId || !entrada) {
  console.error("uso: node herramientas/probar-medio.js <canalId> <palabras>");
  process.exit(2);
}

const cfg = cargar();
const { tags, medio } = presets.interpretar(entrada, null);
console.log(`buscando '${entrada}' -> tags=[${tags}] medio=${medio}`);

(async () => {
  const cliente = new Client({ intents: [GatewayIntentBits.Guilds] });
  await cliente.login(cfg.token);
  const canal = await cliente.channels.fetch(canalId);
  if (!canal) throw new Error(`No encuentro el canal ${canalId}`);

  const resultados = await proveedores.buscar(cfg, "e621", tags, 25, medio);
  console.log(`${resultados.length} resultados`);
  if (!resultados.length) throw new Error("sin resultados");

  const limite = (cfg.guards.maxUploadMb || 25) * 1024 * 1024;
  const caben = resultados.filter((r) => !r.size || r.size <= limite);
  const elegido = (caben.length ? caben : resultados)[0];
  const url = elegido.size > limite && elegido.muestra ? elegido.muestra : elegido.url;
  console.log(`elegido: id ${elegido.id} ${elegido.ext} ${Math.round((elegido.size||0)/1024)}KB`);

  const { buffer } = await proveedores.descargar(url, cfg.userAgent);
  const validas = ["jpg", "jpeg", "png", "webp", "gif", "webm", "mp4"];
  const ext = validas.includes((elegido.ext || "").toLowerCase())
    ? elegido.ext.toLowerCase()
    : medio === "video"
      ? "webm"
      : "jpg";

  const embed = new EmbedBuilder()
    .setColor(0x9b30ff)
    .setTitle("Prueba de medio")
    .addFields(
      { name: "Tablero", value: elegido.source, inline: true },
      { name: "id", value: elegido.id || "-", inline: true },
      { name: "Medio", value: elegido.tipo || medio, inline: true },
      { name: "Etiquetas", value: (elegido.tags || "").slice(0, 500) }
    );
  const enviado = await canal.send({
    embeds: [embed],
    files: [{ attachment: buffer, name: `r34pete.${ext}` }],
  });
  console.log(`publicado: ${enviado.id} (${ext}, ${Math.round(buffer.length/1024)}KB)`);
  await cliente.destroy();
})().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
