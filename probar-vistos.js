"use strict";
/* Prueba del registro de publicados (src/seen.js) tras el cambio que lo
 * guarda por medio y comparte la memoria entre el feed y /buscar. */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Vistos } = require(path.join(__dirname, "src", "seen.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vistos-"));
const ruta = path.join(tmp, "vistos.json");

(async () => {
  // 1) Semilla con formato viejo (claves por via: rule34:video, rule34:f2...)
  fs.writeFileSync(
    ruta,
    JSON.stringify({
      "rule34:video": ["1", "2"],
      "rule34:f2": ["1", "3"],
      "rule34:gif": ["9"],
      "e621:imagen": ["55"],
    })
  );
  let v = new Vistos(ruta);
  console.log("ok 1: carga el formato viejo");

  // 2) sinVer con TODAS las claves del proveedor: lo publicado por el feed
  //    (clave vieja f2) tambien lo sabe /buscar y al reves.
  const res = v.sinVer("rule34", [{ id: "1" }, { id: "3" }, { id: "4" }], "imagen");
  assert.deepStrictEqual(res.map((x) => x.id), ["4"], "el 3 (publicado por f2) debe contar como visto");
  console.log("ok 2: sinVer comparte memoria entre feed y /buscar -> quedan", res.map((x) => x.id));

  // 3) el proveedor equivocado no se mezcla
  assert.strictEqual(v.sinVer("e621", [{ id: "55" }, { id: "77" }], "imagen").length, 1);
  console.log("ok 3: cada proveedor tiene su propio registro");

  // 4) marcar guarda en la clave canonica proveedor:medio y NO duplica
  v.marcar("rule34", ["4"], "imagen", "f2");
  v.marcar("rule34", ["4"], "imagen", "f2");
  assert.ok(v.datos["rule34:imagen"].includes("4"), "debe guardarse en rule34:imagen");
  assert.strictEqual(v.datos["rule34:imagen"].filter((x) => x === "4").length, 1, "sin duplicados");
  console.log("ok 4: marcar -> rule34:imagen =", JSON.stringify(v.datos["rule34:imagen"]));

  // 5) tras marcar, el id ya no vuelve a salir (persiste en disco)
  const v2 = new Vistos(ruta);
  assert.deepStrictEqual(v2.sinVer("rule34", [{ id: "4" }], "imagen"), [], "debe persistir");
  console.log("ok 5: persiste en disco y al recargar sigue visto");

  // 6) posicionDe: 0 es lo mas antiguo (para repetir el que mas tiempo sin salir)
  assert.strictEqual(v.posicionDe("rule34", "1", "video"), 0, "el 1 fue lo primero");
  assert.ok(v.posicionDe("rule34", "2", "video") > v.posicionDe("rule34", "1", "video"));
  assert.strictEqual(v.posicionDe("rule34", "404", "video"), -1, "un id desconocido -> -1");
  console.log("ok 6: posicionDe ordena por antiguedad");

  // 7) los ids nuevos (nunca marcados) quedan al final, listos para elegirse
  assert.strictEqual(v.posicionDe("rule34", "nunca-visto", "gif"), -1);
  console.log("ok 7: posicionDe(-1) = nunca publicado");

  // 8) cuantos() sigue respondiendo algo razonable
  const c = v.cuantos("rule34");
  assert.ok(c >= 6, "debe contar todos los ids del proveedor, suma=" + c);
  console.log("ok 8: cuantos(rule34) =", c);

  // 9) la clave simple (sin medio) tambien se respeta
  assert.deepStrictEqual(v.sinVer("rule34", [{ id: "9" }]), [], "clave simple rule34 -> cuenta gif viejo");
  console.log("ok 9: la clave simple del proveedor tambien cuenta");

  console.log("todo correcto");
})().catch((e) => {
  console.error("FALLO:", e.message);
  process.exit(1);
});
