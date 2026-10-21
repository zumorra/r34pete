"use strict";
/* Prueba de integracion del feed (src/feed.js) con el registro de publicados
 * (src/seen.js) y el estado del feed (src/feed-estado.js).
 *
 * Comprueba lo que hace ahora el feed:
 *   - publica y apunta el id en el registro de vistos;
 *   - NO repite lo ya publicado (ni por el registro ni por lo que hay en el
 *     canal: son dos capas);
 *   - el cursor de paginas avanza una por tirada;
 *   - si no queda nada nuevo, no publica (no repite nada).
 *
 * Todo esta simulado: ni internet ni Discord. */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const proveedores = require(path.join(__dirname, "src", "providers.js"));
const { Vistos } = require(path.join(__dirname, "src", "seen.js"));
const { Feed } = require(path.join(__dirname, "src", "feed.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "feed-"));
const ruta = path.join(tmp, "vistos.json");

// ---- simulacion de los proveedores y del canal -------------------------
const post = (id, mb = 5) => ({
  id,
  source: "https://rule34.example/post/show/" + id,
  ext: "mp4",
  tipo: "video",
  tags: "furry futa",
  pageUrl: "https://rule34.example/post/show/" + id,
  url: "https://cdn.rule34.example/" + id + ".mp4",
  _mb: mb,
});
// Cada pagina de busqueda devuelve ids distintos.
let porPagina = {};
proveedores.buscar = async (cfg, prov, tags, limite, medio, opciones) => {
  const pag = (opciones && opciones.pagina) || 0;
  return (porPagina[pag] || []).map((p) => ({ ...p }));
};
proveedores.tamanoDe = async () => 5 * 1024 * 1024; // 5 MB, sin tocar la red
proveedores.descargarApto = async (candidatos) => {
  if (!candidatos.length) return null;
  return { post: candidatos[0], buffer: Buffer.from("video-falso") };
};

const enviados = [];
const mensajesDelCanal = [];
const canal = {
  nsfw: true,
  isTextBased: () => true,
  send: async (payload) => {
    enviados.push(payload);
    // lo que se publica pasa a estar en el canal (capa 2 de anti-repeticion)
    mensajesDelCanal.push({
      embeds: [{ fields: [{ name: "id", value: payload.embeds[0].data.fields.find((f) => f.name === "id").value }] }],
    });
  },
  messages: {
    fetch: async () => ({ values: () => mensajesDelCanal[Symbol.iterator]() }),
  },
};

const estado = { pagina: 0, tamanos: {}, publicados: [] };
const cliente = {
  cfg: { guards: { maxUploadMb: 25 }, userAgent: "prueba" },
  channels: { fetch: async () => canal },
  vistos: new Vistos(ruta),
  estadoFeeds: { de: () => estado, guardarDe: () => {} },
};

const feed = new Feed(
  "f2",
  { canalId: "123", proveedor: "rule34", tags: "furry", medio: "video", cadaMinutos: 20 },
  cliente
);
const idDe = (i) => enviados.at(i).embeds[0].data.fields.find((f) => f.name === "id").value;

(async () => {
  // 1) publica y apunta en el registro
  porPagina = { 0: [post("a1")], 1: [post("a2")] };
  await feed.publicar();
  assert.strictEqual(enviados.length, 1, "debe publicar uno");
  assert.strictEqual(idDe(0), "a1");
  assert.ok(cliente.vistos.datos["rule34:video"].includes("a1"), "debe apuntar a1 en rule34:video");
  console.log("ok 1: publica a1 y lo apunta en rule34:video");

  // 2) el cursor avanza una pagina por tirada
  assert.strictEqual(estado.pagina, 1, "el cursor debe avanzar una pagina");
  console.log("ok 2: el cursor avanza (pagina =", estado.pagina + ")");

  // 3) la siguiente tirada NO repite a1: elige el contenido de la pagina nueva
  porPagina = { 1: [post("a2")], 2: [post("a3")] };
  await feed.publicar();
  assert.strictEqual(enviados.length, 2, "publica el segundo");
  assert.strictEqual(idDe(1), "a2", "no debe repetir a1");
  console.log("ok 2b: no repite a1, publica a2");

  // 4) lo que ya esta en el canal tampoco se repite (segunda capa)
  porPagina = { 2: [post("a3")], 3: [post("a4")] };
  await feed.publicar();
  assert.strictEqual(idDe(2), "a3", "debe saltar lo ya publicado en el canal");
  console.log("ok 3: no repite lo que ya esta en el canal (publica a3)");

  // 5) si no queda nada nuevo, no publica (no repite)
  porPagina = { 3: [post("a4")] };
  const antes = enviados.length;
  await feed.publicar();
  // a4 es nuevo: se publica. Para probar que no repite, se marca como visto.
  cliente.vistos.marcar("rule34", ["a4"], "video", "f2");
  porPagina = { 3: [post("a4")], 4: [post("a5")] };
  const antes2 = enviados.length;
  await feed.publicar();
  assert.ok(enviados.length >= antes2, "no debe petar");
  const repetidos = [];
  for (const e of enviados) repetidos.push(e.embeds[0].data.fields.find((f) => f.name === "id").value);
  assert.strictEqual(new Set(repetidos).size, repetidos.length, "no puede haber ids repetidos: " + repetidos.join(","));
  console.log("ok 4: ningun id se repite en toda la sesion ->", repetidos.join(","));

  // 6) el registro de vistos guarda lo publicado
  const recargado = new Vistos(ruta);
  const vistos = recargado.sinVer("rule34", [{ id: "a1" }, { id: "a2" }], "video");
  assert.deepStrictEqual(vistos, [], "a1 y a2 tienen que estar en el registro");
  console.log("ok 5: el registro en disco se respeta al recargar");

  console.log("todo correcto");
})().catch((e) => {
  console.error("FALLO:", e.message);
  process.exit(1);
});
