"use strict";
/* Comprobacion real del backend openrouter de R34pete: llama a la API de
 * OpenRouter con la clave de la instancia usando el MISMO codigo que el bot
 * (src/ia.js) y escribe en el log el modelo que sirvio de verdad.
 *
 * Se usa al arrancar el workflow, para ver en el log que el router gratuito
 * responde y que modelo cogio. Si falla, el bot sigue con el siguiente
 * backend de la lista (pollinations, gemini, groq). */

const fs = require("node:fs");
const ruta = require("node:path");

const config = require(ruta.join(__dirname, "src", "config.js"));
const ia = require(ruta.join(__dirname, "src", "ia.js"));

(async () => {
  let cfg;
  try {
    cfg = config.cargar();
  } catch (e) {
    // Si falta el token de Discord, el fichero se puede leer igual.
    cfg = JSON.parse(fs.readFileSync(config.rutaPorDefecto(), "utf8"));
  }

  const modelo = cfg.ia.openrouter_modelo;
  const clave = (cfg.ia.claves || {}).openrouter;
  console.log(`openrouter: modelo=${modelo} clave=${clave ? "puesta" : "FALTA"}`);
  if (!clave) {
    console.log("sin clave de openrouter: no se puede comprobar (el bot usara otro backend)");
    process.exit(0);
  }

  const r = await ia.responder(
    { ...cfg.ia, orden: ["openrouter"] },
    [{ role: "user", content: "Di hola en una frase." }]
  );
  console.log(`openrouter responde: backend=${r.backend} modelo=${r.modelo}`);
  console.log(`texto: ${String(r.texto).slice(0, 160)}`);
})().catch((e) => {
  console.error("el backend openrouter fallo:", e.message);
  process.exit(1);
});
