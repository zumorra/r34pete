"use strict";
/* Prueba del backend openrouter de R34pete: comprueba que el cuerpo de la peticion
 * lleva "model" para un nombre solo y "models" para una lista de respaldo, y que
 * devuelve el modelo que de verdad sirvio. NO llama a internet: fetch esta simulado. */

const assert = require("node:assert");
const ruta = require("node:path");

const capturado = [];
global.fetch = async (url, opciones) => {
  capturado.push({ url, body: JSON.parse(opciones.body) });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: capturado[capturado.length - 1].body.models
        ? capturado[capturado.length - 1].body.models[1]
        : capturado[capturado.length - 1].body.model,
      choices: [{ message: { content: "hola" } }],
    }),
    text: async () => "",
  };
};

(async () => {
  const ia = require(ruta.join(__dirname, "src", "ia.js"));
  const cfg = {
    claves: { openrouter: "sk-or-v1-falsa" },
    openrouter_modelo: "openrouter/free",
    max_tokens: 400,
    temperatura: 0.85,
  };
  const mensajes = [{ role: "user", content: "hola" }];

  // 1) un solo modelo -> "model"
  let r = await ia.responder({ ...cfg, orden: ["openrouter"] }, mensajes);
  let p = capturado.at(-1);
  assert.strictEqual(p.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.strictEqual(p.body.model, "openrouter/free");
  assert.ok(!p.body.models, "no debe mandar 'models' con un solo nombre");
  assert.strictEqual(r.modelo, "openrouter/free");
  assert.strictEqual(r.backend, "openrouter");
  console.log("ok 1: modelo suelto -> body.model =", p.body.model);

  // 2) lista de respaldo -> "models" (y devuelve el que sirvio)
  r = await ia.responder(
    { ...cfg, orden: ["openrouter"], openrouter_modelo: "a:free,b:free,c:free" },
    mensajes
  );
  p = capturado.at(-1);
  assert.ok(!p.body.model, "con lista no debe mandar 'model'");
  assert.deepStrictEqual(p.body.models, ["a:free", "b:free", "c:free"]);
  assert.strictEqual(r.modelo, "b:free");
  console.log("ok 2: lista -> body.models =", JSON.stringify(p.body.models), "y sirve:", r.modelo);

  // 3) sin clave -> error claro y se pasa al siguiente backend
  capturado.length = 0;
  let err = null;
  try {
    await ia.responder({ ...cfg, claves: {}, orden: ["openrouter"] }, mensajes);
  } catch (e) {
    err = e;
  }
  assert.ok(err && /falta la clave de openrouter/.test(err.message), "debe avisar de la clave");
  console.log("ok 3: sin clave ->", err.message);

  console.log("todo correcto");
})().catch((e) => {
  console.error("FALLO:", e.message);
  process.exit(1);
});
