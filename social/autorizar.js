"use strict";

/**
 * Autorizacion del Social SDK (se ejecuta UNA vez, en el equipo de Yuki).
 *
 * Abre el navegador, tu apruebas los permisos, y el script se guarda los
 * tokens como secretos del repo de GitHub (nunca se imprimen en pantalla ni
 * pasan por el chat).
 *
 *   node social/autorizar.js --app 1562157263483830462
 *
 * Necesitas:
 *   - DISCORD_SDK_PATH apuntando a la libreria nativa que descargaste del
 *     portal de Discord (la carpeta con libdiscord_partner_sdk.so).
 *   - El paquete @discordkit/native instalado (npm install).
 *   - gh autenticado (para guardar los secretos).
 */

const { spawn } = require("node:child_process");

function arg(nombre, defecto = "") {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
}

function guardarSecreto(repo, nombre, valor) {
  return new Promise((resolve) => {
    const p = spawn("gh", ["secret", "set", nombre, "--repo", repo], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => resolve({ code, err }));
    p.stdin.end(valor);
  });
}

(async () => {
  const appId = arg("app") || process.env.DISCORD_SOCIAL_APP_ID || "";
  const repo = arg("repo") || "zumorra/r34pete";
  if (!appId) {
    console.error("Falta el id de la app: --app 1562157263483830462");
    process.exit(1);
  }
  if (!process.env.DISCORD_SDK_PATH) {
    console.error(
      "Falta DISCORD_SDK_PATH: apunta a la carpeta con libdiscord_partner_sdk.so"
    );
    process.exit(1);
  }

  console.log(`Autorizando la app ${appId}... se abrira el navegador.`);
  const raiz = await import("@discordkit/native");
  const auth = await import("@discordkit/native/auth");
  raiz.init({ applicationId: appId });
  const tokens = await auth.authorize({ scopes: "communication" });

  console.log(`Permisos concedidos: ${tokens.scopes}`);
  console.log(`El acceso caduca el ${new Date(tokens.expiresAt).toISOString()}`);

  const appSecret = process.env.DISCORD_SOCIAL_APP_ID || appId;
  const trabajos = [
    ["DISCORD_SOCIAL_APP_ID", appSecret],
    ["DISCORD_SOCIAL_ACCESS", tokens.accessToken],
    ["DISCORD_SOCIAL_REFRESH", tokens.refreshToken],
    ["DISCORD_SOCIAL_EXPIRES", String(tokens.expiresAt)],
    ["DISCORD_SOCIAL_SCOPES", tokens.scopes],
  ];
  for (const [nombre, valor] of trabajos) {
    const r = await guardarSecreto(repo, nombre, valor);
    if (r.code !== 0) {
      console.error(`No se pudo guardar el secreto ${nombre}: ${r.err.trim()}`);
      process.exit(1);
    }
    console.log(`Secreto ${nombre} guardado en ${repo}`);
  }
  console.log("Listo. Ya puedes lanzar el bot: la bandeja se leera sola.");
})().catch((e) => {
  console.error(`Fallo la autorizacion: ${e.message}`);
  process.exit(1);
});
