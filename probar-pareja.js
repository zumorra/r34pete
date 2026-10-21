"use strict";
/* Prueba de la guia para parejas (src/pareja.js).
 *
 * Comprueba lo que tiene que cumplir:
 *   - la guia carga desde el JSON (recetas, consejos, juegos y planes);
 *   - el nivel filtra el contenido (nivel 1 no ve nada de nivel 5);
 *   - no repite lo mismo hasta agotar el ciclo;
 *   - el filtro por ingrediente funciona;
 *   - el nivel se guarda y se relee al recargar;
 *   - el atajo del chat solo contesta cuando el mensaje es de la guia;
 *   - todo lo que se manda cabe en un mensaje de Discord (2000 caracteres).
 *
 * Todo esta simulado: ni internet ni Discord. */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Guia } = require(path.join(__dirname, "src", "pareja.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pareja-"));
const rutaGuia = path.join(__dirname, "pareja.json");
const rutaEstado = path.join(tmp, "pareja-estado.json");

const guia = new Guia({ ruta: rutaGuia, estadoFile: rutaEstado, nivel: 3 });

(async () => {
  // 1) carga el contenido
  const c = guia.contar();
  assert.ok(c.receta >= 8, "debe haber recetas (hay " + c.receta + ")");
  assert.ok(c.consejo >= 8, "debe haber consejos (hay " + c.consejo + ")");
  assert.ok(c.juego >= 4, "debe haber juegos (hay " + c.juego + ")");
  assert.ok(c.plan >= 3, "debe haber planes (hay " + c.plan + ")");
  console.log("ok 1: la guia carga ->", JSON.stringify(c));

  // 2) el nivel filtra: con nivel 1 solo sale contenido de nivel 1
  const nivel1 = guia.candidatos("receta", 1);
  assert.ok(nivel1.length > 0, "debe haber recetas de nivel 1");
  assert.ok(
    nivel1.every((r) => (r.nivel || 1) <= 1),
    "con nivel 1 no puede salir nada de nivel 2 o mas"
  );
  const nivel5 = guia.candidatos("consejo", 5);
  assert.ok(nivel5.length >= c.consejo, "con nivel 5 tienen que verse todos los consejos");
  console.log("ok 2: el nivel filtra (nivel 1 ->", nivel1.length, "recetas, nivel 5 ->", nivel5.length, "consejos)");

  // 3) no repite hasta agotar el ciclo
  const vistos = new Set();
  for (let i = 0; i < c.receta; i++) {
    const r = guia.elegir("receta", 5);
    assert.ok(r, "debe devolver una receta");
    assert.ok(!vistos.has(r.id), "no debe repetir la receta " + r.id);
    vistos.add(r.id);
  }
  console.log("ok 3: no repite recetas hasta agotarlas (" + vistos.size + " distintas)");

  // 4) el filtro por ingrediente
  const conChocolate = guia.candidatos("receta", 5, "chocolate");
  assert.ok(conChocolate.length >= 1, "debe encontrar recetas con chocolate");
  assert.ok(
    conChocolate.every((r) => JSON.stringify(r).toLowerCase().includes("chocolate")),
    "el filtro debe devolver solo recetas que talken de chocolate"
  );
  const conCosaInexistente = guia.candidatos("receta", 5, "caviar-de-unicornio");
  assert.strictEqual(conCosaInexistente.length, 0, "un filtro raro no debe devolver nada");
  console.log("ok 4: el filtro por ingrediente funciona (", conChocolate.length, "con chocolate )");

  // 5) el nivel se guarda y se relee
  const ambito = "guild-de-prueba";
  assert.strictEqual(guia.nivel(ambito), 3, "el nivel por defecto es 3");
  guia.setNivel(ambito, 5);
  const otra = new Guia({ ruta: rutaGuia, estadoFile: rutaEstado, nivel: 3 });
  assert.strictEqual(otra.nivel(ambito), 5, "el nivel debe persistir en el fichero de estado");
  assert.strictEqual(otra.nivel("otro-ambito"), 3, "otro ambito keeps su nivel");
  console.log("ok 5: el nivel se guarda y se relee (5 en", ambito + ")");

  // 6) el atajo del chat: solo contesta lo que es de la guia
  assert.strictEqual(guia.responder("hola, ¿qué tal?"), null, "una charla normal no es de la guia");
  assert.strictEqual(
    guia.responder("¿qué vas a hacer esta noche cuando llegue a casa?"),
    null,
    "una frase con 'noche' no debe disparar la guia"
  );
  const r1 = guia.responder("dame una receta picante para la pareja");
  assert.ok(r1 && r1.length > 50, "una peticion de receta debe contestarla");
  const r2 = guia.responder("spice");
  assert.ok(r2 && r2.length > 50, "'spice' debe devolver una idea");
  console.log("ok 6: el atajo del chat solo responde a lo de la guia");

  // 7) el plan con minutos: o encaja, o se monta a medida
  const plan = guia.elegirPlan(5, 15, true);
  assert.ok(plan, "debe haber un plan de 15 minutos");
  const dur = Number(String(plan.duracion).split(" ")[0]);
  assert.ok(Math.abs(dur - 15) <= 10, "el plan debe encajar con los 15 minutos pedidos (duracion " + dur + ")");
  const hecho = guia.planHecho(3, 45);
  assert.ok(hecho.includes("Plan para hoy"), "debe montar un plan a medida");
  console.log("ok 7: el plan encaja o se monta a medida");

  // 8) todo cabe en un mensaje de Discord (2000 caracteres)
  const plantillas = [
    () => guia.formatoReceta(guia.elegir("receta", 5)),
    () => guia.formatoConsejo(guia.elegir("consejo", 5)),
    () => guia.formatoJuego(guia.elegir("juego", 5)),
    () => guia.formatoPlan(guia.elegir("plan", 5)),
    () => guia.planHecho(5, 60),
    () => guia.textoNiveles(),
  ];
  for (const plantilla of plantillas) {
    const txt = plantilla();
    assert.ok(txt.length <= 2000, "un mensaje se pasa de 2000 caracteres (" + txt.length + ")");
  }
  console.log("ok 8: todos los mensajes caben en 2000 caracteres");

  console.log("todo correcto");
})().catch((e) => {
  console.error("FALLO:", e.message);
  process.exit(1);
});
