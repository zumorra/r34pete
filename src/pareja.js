"use strict";

/**
 * Guia para parejas: recetas para cocinar juntos, consejos, juegos y planes.
 *
 * Todo el contenido vive en un JSON (pareja.json) para que se pueda editar
 * sin tocar codigo, igual que las instrucciones: el fichero se relee solo
 * cuando cambia (mtime), sin reiniciar el bot.
 *
 * El contenido es local a proposito: NO depende de la IA, asi que la guia
 * funciona aunque no haya cuota ni conexion, y siempre devuelve lo mismo
 * (nada de alucinaciones ni recetas inventadas con ingredientes raros).
 *
 * Niveles: 1 (suave) a 5 (muy picante). El bot solo enseña lo que es
 * menor o igual al nivel del ambito (servidor o privado).
 *
 * Todo es para adultos que se hablan: el consentimiento se pide siempre y
 * el "no" se respeta sin discutir (esta escrito en los propios consejos).
 */

const fs = require("node:fs");
const path = require("node:path");

const TIPOS = ["receta", "consejo", "juego", "plan"];
// El tipo es en singular (lo que se pide) y la clave del JSON en plural.
const CLAVES = { receta: "recetas", consejo: "consejos", juego: "juegos", plan: "planes" };
const NIVEL_MIN = 1;
const NIVEL_MAX = 5;

/** Minusculas y sin acentos, para comparar sin que se lie. */
function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Recorta un texto para que quepa en un mensaje de Discord. */
function cortar(texto, max = 1900) {
  const t = String(texto || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3).trimEnd() + "...";
}

class Guia {
  constructor(opciones = {}) {
    this.ruta = opciones.ruta || "/var/lib/r34pete/pareja.json";
    this.estadoFile = opciones.estadoFile || "/var/lib/r34pete/pareja-estado.json";
    this.nivelPorDefecto = Math.min(NIVEL_MAX, Math.max(NIVEL_MIN, opciones.nivel || 3));
    this.datos = { recetas: [], consejos: [], juegos: [], planes: [] };
    this.niveles = {};
    this.estado = { niveles: {}, vistos: [] };
    this.mtime = 0;
    this.cargar(true);
    this.cargarEstado();
  }

  // ------------------------------------------------------------- carga
  /** Lee el fichero de la guia. Si no ha cambiado, no hace nada. */
  cargar(forzar = false) {
    try {
      const st = fs.statSync(this.ruta);
      if (!forzar && st.mtimeMs === this.mtime) return this.datos;
      const crudo = JSON.parse(fs.readFileSync(this.ruta, "utf8"));
      this.datos = {
        recetas: Array.isArray(crudo.recetas) ? crudo.recetas : [],
        consejos: Array.isArray(crudo.consejos) ? crudo.consejos : [],
        juegos: Array.isArray(crudo.juegos) ? crudo.juegos : [],
        planes: Array.isArray(crudo.planes) ? crudo.planes : [],
      };
      this.niveles = crudo.niveles || {};
      this.mtime = st.mtimeMs;
      console.log(
        `Guia de pareja cargada de ${this.ruta} (${this.datos.recetas.length} recetas, ` +
          `${this.datos.consejos.length} consejos, ${this.datos.juegos.length} juegos, ` +
          `${this.datos.planes.length} planes)`
      );
    } catch (e) {
      if (forzar) console.warn(`No se pudo leer la guia ${this.ruta}: ${e.message}`);
    }
    return this.datos;
  }

  cargarEstado() {
    try {
      if (fs.existsSync(this.estadoFile)) {
        const crudo = JSON.parse(fs.readFileSync(this.estadoFile, "utf8"));
        this.estado = {
          niveles: crudo.niveles || {},
          vistos: Array.isArray(crudo.vistos) ? crudo.vistos : [],
        };
      }
    } catch (e) {
      console.warn(`No se pudo leer el estado de la guia: ${e.message}`);
      this.estado = { niveles: {}, vistos: [] };
    }
  }

  guardarEstado() {
    try {
      fs.mkdirSync(path.dirname(this.estadoFile), { recursive: true });
      fs.writeFileSync(this.estadoFile, JSON.stringify(this.estado, null, 2));
    } catch (e) {
      console.warn(`No se pudo guardar el estado de la guia: ${e.message}`);
    }
  }

  // -------------------------------------------------------------- niveles
  /** Nivel de un ambito (id del servidor o "dm"). */
  nivel(ambito = "dm") {
    const n = Number(this.estado.niveles[ambito]);
    if (!Number.isFinite(n)) return this.nivelPorDefecto;
    return Math.min(NIVEL_MAX, Math.max(NIVEL_MIN, n));
  }

  /** Cambia el nivel de un ambito y lo guarda. */
  setNivel(ambito, nivel) {
    const n = Math.min(NIVEL_MAX, Math.max(NIVEL_MIN, Math.round(Number(nivel) || 0)));
    if (!n) return this.nivelPorDefecto;
    this.estado.niveles[ambito] = n;
    this.guardarEstado();
    return n;
  }

  /** Texto que explica los niveles. */
  textoNiveles() {
    const claves = Object.keys(this.niveles).sort((a, b) => Number(a) - Number(b));
    if (!claves.length) return "";
    return claves.map((k) => `**${k}** · ${this.niveles[k]}`).join("\n");
  }

  // -------------------------------------------------------------- contenido
  /** Todos los items de un tipo (sin filtrar). */
  items(tipo) {
    this.cargar();
    const lista = this.datos[CLAVES[tipo] || tipo];
    return Array.isArray(lista) ? lista : [];
  }

  /** Items que caben en el nivel y (opcionalmente) coinciden con el filtro. */
  candidatos(tipo, nivel, filtro = "") {
    const f = normalizar(filtro).trim();
    return this.items(tipo).filter((it) => {
      const n = Number(it.nivel) || 1;
      if (n > nivel) return false;
      if (!f) return true;
      const heno = normalizar(
        [
          it.titulo,
          it.texto,
          it.como,
          it.truco,
          (it.etiquetas || []).join(" "),
          (it.ingredientes || []).join(" "),
        ].join(" ")
      );
      return heno.includes(f);
    });
  }

  /**
   * Elige un item al azar entre los que caben en el nivel, sin repetir los
   * ultimos: si ya se han gastado todos, se recicla el ciclo.
   */
  elegir(tipo, nivel, filtro = "") {
    let lista = this.candidatos(tipo, nivel, filtro);
    if (!lista.length) return null;
    const vistos = new Set(this.estado.vistos);
    let frescos = lista.filter((it) => !vistos.has(`${tipo}:${it.id}`));
    if (!frescos.length) {
      // Todos vistos: se limpia el ciclo de este tipo y se elige igual.
      this.estado.vistos = this.estado.vistos.filter((k) => !String(k).startsWith(`${tipo}:`));
      frescos = lista;
    }
    const elegido = frescos[Math.floor(Math.random() * frescos.length)];
    this.marcarVisto(tipo, elegido.id);
    return elegido;
  }

  marcarVisto(tipo, id) {
    if (!id) return;
    const clave = `${tipo}:${id}`;
    this.estado.vistos.push(clave);
    if (this.estado.vistos.length > 300) {
      this.estado.vistos = this.estado.vistos.slice(-300);
    }
    this.guardarEstado();
  }

  /** Un plan ya escrito (si hay uno que encaje con los minutos pedidos). */
  elegirPlan(nivel, minutos = 0, soloSiEncaja = false) {
    const lista = this.candidatos("plan", nivel);
    if (!lista.length) return null;
    if (minutos > 0) {
      const encaja = lista.find((p) => {
        const dur = Number(String(p.duracion || "").split(" ")[0]) || 0;
        return dur && Math.abs(dur - minutos) <= Math.max(10, minutos * 0.3);
      });
      if (encaja) {
        this.marcarVisto("plan", encaja.id);
        return encaja;
      }
      // Ningun plan escrito encaja: el llamante monta uno a medida.
      if (soloSiEncaja) return null;
    }
    return this.elegir("plan", nivel);
  }

  /** Cuantos hay de cada tipo (para /estado). */
  contar() {
    this.cargar();
    return {
      receta: this.datos.recetas.length,
      consejo: this.datos.consejos.length,
      juego: this.datos.juegos.length,
      plan: this.datos.planes.length,
    };
  }

  // --------------------------------------------------------- formateadores
  formatoReceta(it) {
    if (!it) return "No hay ninguna receta con eso.";
    const ing = (it.ingredientes || []).map((i) => `• ${i}`).join("\n");
    const pasos = (it.pasos || []).map((p, i) => `${i + 1}. ${p}`).join("\n");
    const meta = [it.tiempo && `⏱ ${it.tiempo}`, it.para && `🍽 ${it.para}`, `🔥 nivel ${it.nivel || 1}`]
      .filter(Boolean)
      .join(" · ");
    const truco = it.truco ? `\n\n💡 *Truco:* ${it.truco}` : "";
    return cortar(
      `**${it.titulo}**\n${meta}\n\n**Ingredientes**\n${ing}\n\n**Cómo se hace**\n${pasos}${truco}`
    );
  }

  formatoConsejo(it) {
    if (!it) return "No hay ningún consejo con eso.";
    const etiquetas = (it.etiquetas || []).map((t) => `#${t}`).join(" ");
    return cortar(
      `**${it.titulo}** · 🔥 nivel ${it.nivel || 1}${etiquetas ? ` · ${etiquetas}` : ""}\n\n${it.texto}`
    );
  }

  formatoJuego(it) {
    if (!it) return "No hay ningún juego con eso.";
    const mat = (it.materiales || []).length ? `\n**Materiales:** ${it.materiales.join(", ")}` : "";
    return cortar(
      `**${it.titulo}** · ⏱ ${it.tiempo || "a ojo"} · 🔥 nivel ${it.nivel || 1}${mat}\n\n${it.como}`
    );
  }

  formatoPlan(it) {
    if (!it) return "No hay ningún plan con eso.";
    const guion = (it.guion || [])
      .map((g) => `⏱ **${g.min} min** — ${g.texto}`)
      .join("\n\n");
    return cortar(
      `**${it.titulo}** · ⏱ ${it.duracion || "a ojo"} · 🔥 nivel ${it.nivel || 1}\n\n${guion}`
    );
  }

  /**
   * Plan hecho al momento: una receta + un juego + un consejo, encajados
   * en una linea de tiempo. Se usa cuando no hay un plan escrito que encaje.
   */
  planHecho(nivel, minutos = 60) {
    const receta = this.elegir("receta", nivel);
    const juego = this.elegir("juego", nivel);
    const consejo = this.elegir("consejo", nivel);
    const partes = [];
    if (receta) {
      partes.push(`🍳 **Cocina:** ${receta.titulo} (${receta.tiempo || "sin prisas"})\n${receta.truco || ""}`);
    }
    if (juego) {
      partes.push(`🎲 **Juego:** ${juego.titulo} (${juego.tiempo || "a ojo"})\n${juego.como}`);
    }
    if (consejo) {
      partes.push(`💬 **Para el después:** ${consejo.titulo}\n${consejo.texto}`);
    }
    return cortar(
      `**Plan para hoy** · ⏱ ${minutos} min · 🔥 nivel ${nivel}\n\n${partes.join("\n\n")}`
    );
  }

  /** Formatea un item según su tipo. */
  formatear(tipo, it) {
    if (tipo === "receta") return this.formatoReceta(it);
    if (tipo === "consejo") return this.formatoConsejo(it);
    if (tipo === "juego") return this.formatoJuego(it);
    if (tipo === "plan") return this.formatoPlan(it);
    return "";
  }

  // ------------------------------------------------- atajo para el chat
  /**
   * Si lo que ha escrito alguien en privado va de esta guia, contesta aqui
   * (sin IA y sin gastar cuota). Devuelve null si no es del tema.
   */
  responder(texto, ambito = "dm") {
    const t = normalizar(texto);
    if (!t) return null;
    // Solo entra en la guia si el mensaje lo pide de verdad: "noche" o
    // "calentar" sueltos serian falsos positivos en una conversacion normal.
    const FUERTE = /\b(spice|pareja|parejas|parejita|afrodisia|afrodisiaco|romantica|romantico|erotica|erotico|coqueteo|ritual)\b/;
    const TEMAS =
      /\b(receta|recetas|cocina|cocinar|cenar|cena|comida|postre|desayuno|consejo|consejos|dormitorio|cama|masaje|juego|juegos|jugar|plan)\b/;
    const esGuia = FUERTE.test(t);
    if (!esGuia && !TEMAS.test(t)) return null;

    const nivel = this.nivel(ambito);
    const quiereReceta = /\b(receta|recetas|cocina|cocinar|cenar|cena|comida|postre|desayuno|chef)\b/.test(t);
    const quiereJuego = /\b(juego|juegos|jugar|diversion|reto|desafio)\b/.test(t);
    const quiereConsejo = /\b(consejo|consejos|conse|tip|tips|dormitorio|cama|toque|masaje)\b/.test(t);
    const quierePlan = /\b(plan|planes|guion|noche completa|cita)\b/.test(t);

    if (quierePlan) {
      const plan = this.elegirPlan(nivel, 0);
      return plan
        ? this.formatoPlan(plan)
        : `No tengo planes escritos cargados, pero puedo montarte uno: /spice plan`;
    }
    if (quiereReceta) {
      const receta = this.elegir("receta", nivel);
      return receta
        ? this.formatoReceta(receta)
        : `No tengo recetas cargadas ahora mismo: /spice receta`;
    }
    if (quiereJuego) {
      const juego = this.elegir("juego", nivel);
      return juego ? this.formatoJuego(juego) : `No tengo juegos cargados: /spice juego`;
    }
    if (quiereConsejo) {
      const consejo = this.elegir("consejo", nivel);
      return consejo ? this.formatoConsejo(consejo) : `No tengo consejos cargados: /spice consejo`;
    }
    // "spice" a secas: una idea de cualquier tipo.
    const tipos = ["receta", "consejo", "juego"];
    const tipo = tipos[Math.floor(Math.random() * tipos.length)];
    const item = this.elegir(tipo, nivel);
    return item
      ? this.formatear(tipo, item)
      : `Ahora mismo no tengo nada de la guía cargado. Mira /spice lista`;
  }
}

module.exports = { Guia, TIPOS, normalizar, cortar, NIVEL_MIN, NIVEL_MAX };
