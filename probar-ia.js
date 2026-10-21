"use strict";
/* Comprobacion real de los backends de IA de R34pete: llama a cada proveedor
 * con la clave de la instancia usando el MISMO codigo que el bot (src/ia.js) y
 * escribe en el log que backend respondio y con que modelo.
 *
 * Sirve para ver, al arrancar el workflow, cual de los proveedores gratuitos
 * esta vivo de verdad (pollinations va sin clave; groq/gemini/openrouter
 * necesitan la clave en los secretos del repo).
 *
 *   node probar-ia.js            prueba los que tengan clave
 *   node probar-ia.js groq       prueba solo ese
 */

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

  const solo = process.argv[2];
  const lista = solo ? [solo] : cfg.ia.orden || [];
  const claves = cfg.ia.claves || {};

  console.log(`backends en orden: ${lista.join(", ")}`);
  for (const backend of lista) {
    const clave = claves[backend];
    const necesitaClave = ["groq", "gemini", "openrouter", "cerebras", "nvidia", "mistral", "cloudflare", "horde", "xai"].includes(backend);
    if (necesitaClave && !clave) {
      console.log(`${backend}: clave=${"FALTA"} (se salta)`);
      continue;
    }
    try {
      const r = await ia.responder(
        { ...cfg.ia, orden: [backend] },
        [{ role: "user", content: "Di hola en una frase." }]
      );
      console.log(`${backend}: RESPONDE backend=${r.backend} modelo=${r.modelo} texto=${String(r.texto).slice(0, 120)}`);
    } catch (e) {
      console.log(`${backend}: fallo -> ${e.message}`);
    }
  }
})().catch((e) => {
  console.error("la prueba de IA fallo:", e.message);
  process.exit(1);
});
