"use strict";
/* Prueba del backend "opencode" de R34pete: el que llama al cliente oficial de
 * OpenCode para usar los modelos ":free" (deepseek-v4.1-flash-free...) desde
 * la nube. NO llama a internet: el proceso del CLI esta simulado. */

const assert = require("node:assert");
const ruta = require("node:path");
const cp = require("node:child_process");

// Se simula el CLI: el primer modelo dice "sin cuota" y el segundo contesta.
const llamadas = [];
let guion = {
  "opencode/deepseek-v4.1-flash-free": { status: 1, stdout: "", stderr: "Error: Rate limit exceeded." },
  "opencode/minimax-m3.1-flash-free": { status: 0, stdout: "hola desde el modelo\n", stderr: "> build" },
};
cp.spawnSync = (bin, args, opciones) => {
  const modelo = args[args.indexOf("--model") + 1];
  llamadas.push({ bin, args, modelo, cwd: opciones.cwd });
  return { status: 0, stdout: "", stderr: "", ...(guion[modelo] || { status: 1, stdout: "", stderr: "sin guion" }) };
};

const ia = require(ruta.join(__dirname, "src", "ia.js"));
const mensajes = [
  { role: "system", content: "eres un bot corto" },
  { role: "user", content: "dime hola" },
];

(async () => {
  // 1) el primer modelo sin cuota -> cae al siguiente y responde
  const r = await ia.responder(
    { orden: ["opencode"], opencode_modelo: "opencode/deepseek-v4.1-flash-free,opencode/minimax-m3.1-flash-free" },
    mensajes
  );
  assert.strictEqual(r.backend, "opencode");
  assert.strictEqual(r.texto, "hola desde el modelo");
  assert.strictEqual(r.modelo, "opencode/minimax-m3.1-flash-free");
  console.log("ok 1: cae del modelo sin cuota al siguiente ->", r.modelo);

  // 2) el prompt lleva el system y el mensaje del usuario
  const prompt = llamadas[0].args[llamadas[0].args.length - 1];
  assert.ok(prompt.includes("eres un bot corto"), "el prompt debe llevar el system");
  assert.ok(prompt.includes("dime hola"), "el prompt debe llevar la pregunta");
  assert.strictEqual(llamadas[0].bin, "opencode");
  console.log("ok 2: el prompt se arma con el system y la pregunta");

  // 3) si todos los modelos fallan -> error claro, sin_BACKENDS rotos
  guion = { "opencode/x": { status: 1, stdout: "", stderr: "Rate limit exceeded." } };
  let err = null;
  try {
    await ia.responder({ orden: ["opencode"], opencode_modelo: "opencode/x" }, mensajes);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "debe fallar si no contesta ninguno");
  assert.ok(/no respondio/.test(err.message), "el error debe decirlo claro: " + (err && err.message));
  console.log("ok 3: si no contesta ninguno ->", err.message);

  // 4) si no esta instalado el CLI -> aviso claro
  cp.spawnSync = () => ({ error: { code: "ENOENT" }, status: 1, stdout: "", stderr: "" });
  err = null;
  try {
    await ia.responder({ orden: ["opencode"], opencode_modelo: "opencode/x" }, mensajes);
  } catch (e) {
    err = e;
  }
  assert.ok(err && /no esta instalado/.test(err.message), "debe avisar de que falta el cliente");
  console.log("ok 4: sin el cliente instalado ->", err.message);

  console.log("todo correcto");
})().catch((e) => {
  console.error("FALLO:", e.message);
  process.exit(1);
});
