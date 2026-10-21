"use strict";
/* Prueba de integracion del feed (src/feed.js) con el registro de publicados
 * (src/seen.js): comprueba que no repite, que comparte memoria con /buscar y
 * que, cuando no queda nada nuevo, repite el MAS ANTIGUO y no siempre el
 * primero. Los proveedores y el canal estan simulados: no se toca internet
 * ni Discord. */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const proveedores = require(path.join(__dirname, "src", "providers.js"));
const { Vistos } = require(path.join(__dirname, "src", "seen.js"));
const { Feed } = require(path.join(__dirname, "src", "feed.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "feed-"));
const ruta = path.join(tmp, "vistos.json");

// ---- proveedores simulados -------------------------------------------------
let resultadosSimulados = [];
proveedores.buscar = async () => resultadosSimulados.map((r) => ({ ...r }));
proveedores.descargarApto = async (candidatos) => {
  if (!candidatos.length) return null;
  return { post: candidatos[0], buffer: Buffer.from("video-falso") };
};

// ---- canal y cliente simulados --------------------------------------------
const enviados = [];
const canal = {
  nsfw: true,
  isTextBased: () => true,
  send: async (payload) => enviados.push(payload),
};
const cliente = {
  cfg: { guards: { maxUploadMb: 25 }, userAgent: "prueba" },
  channels: { fetch: async () => canal },
  vistos: new Vistos(ruta),
};

const feed = new Feed(
  "f2",
  { canalId: "123", proveedor: "rule34", tags: "furry", medio: "video", cadaMinutos: 20 },
  cliente
);

const post = (id) => ({
  id,
  source: "https://rule34.example/post/show/" + id,
  ext: "mp4",
  tipo: "video",
  tags: "furry futa",
  pageUrl: "https://rule34.example/post/show/" + id,
});
const idsVistos = () =>
  Object.entries(cliente.vistos.datos)
    .filter(([k]) => k.startsWith("rule34"))
    .flatMap(([, v]) => v);

(async () => {
  // 1) Todo nuevo: publica el primero y lo apunta en rule34:video
  resultadosSimulados = [post("a1"), post("a2"), post("a3")];
  await feed.publicar();
  assert.strictEqual(enviados.length, 1, "debe publicar uno");
  assert.ok(cliente.vistos.datos["rule34:video"].includes("a1"), "debe apuntar a1");
  console.log("ok 1: publica a1 y lo apunta en rule34:video");

  // 2) La proxima vez NO repite a1: publica a2
  await feed.publicar();
  const idDe = (i) => enviados.at(i).embeds[0].data.fields.find((f) => f.name === "id").value;
  assert.strictEqual(enviados.length, 2, "publica el segundo");
  assert.strictEqual(idDe(-1), "a2", "no debe repetir a1");
  assert.ok(cliente.vistos.datos["rule34:video"].includes("a2"), "debe apuntar a2");
  console.log("ok 2: no repite a1, publica a2");

  // 3) Comparte memoria con /buscar: si /buscar apunta "a3" como imagen,
  //    el feed NO debe volver a publicarlo.
  cliente.vistos.marcar("rule34", ["a3"], "imagen");
  await feed.publicar();
  // candidatos: a1 y a2 ya vistos, a3 visto por /buscar -> repite el mas antiguo
  const repetido = enviados.at(-1).embeds[0].data.fields.find((f) => f.name === "id").value;
  assert.strictEqual(repetido, "a1", "al no quedar nada nuevo repite el mas antiguo (a1), no el primero de la pagina");
  console.log("ok 3: /buscar y feed comparten memoria; al agotarse repite el mas antiguo (id", repetido + ")");

  // 4) La marca de /buscar como imagen sigue vigente tras recargar
  const recargado = new Vistos(ruta);
  assert.deepStrictEqual(recargado.sinVer("rule34", [{ id: "a3" }], "video"), [], "a3 sigue visto");
  console.log("ok 4: la marca de /buscar persiste en disco y el feed la respeta");

  // 5) Llegan resultados nuevos otra vez: vuelve a elegirlos antes de repetir
  resultadosSimulados = [post("b1"), post("b2")];
  await feed.publicar();
  const elegido = enviados.at(-1).embeds[0].data.fields.find((f) => f.name === "id").value;
  assert.strictEqual(elegido, "b1", "con algo nuevo deja de repetir");
  console.log("ok 5: al aparecer contenido nuevo lo elige antes que repetir (id", elegido + ")");

  console.log("todo correcto");
})().catch((e) => {
  console.error("FALLO:", e.message);
  console.error(e.stack);
  if (e.errors) for (const x of e.errors) console.error(" ->", x && x.stack ? x.stack : x);
  process.exit(1);
});
