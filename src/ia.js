"use strict";

/**
 * Backends de IA para el chat automatico.
 *
 * Se prueban en el orden que diga la configuracion y, si uno falla, se pasa
 * al siguiente. Asi el bot sigue respondiendo aunque un proveedor se caiga.
 *
 * - ollama      local, gratis e ilimitado, sin censura (el de la master).
 * - pollinations  online, gratis y SIN clave (1 respuesta cada 30 s por IP).
 * - gemini      online, gratis con clave (Google AI Studio).
 * - groq        online, gratis con clave (console.groq.com).
 * - openrouter  online, gratis con clave (modelos "free").
 */

const TIMEOUT_MS = 120000;

function quitarPensamientos(texto) {
  // Los modelos "razonadores" a veces dejan el razonamiento fuera del campo
  // de contenido: se recorta si aparece.
  const marcas = ["Thinking Process:", "Reasoning:", "Análisis:", "Analysis:"];
  for (const m of marcas) {
    const i = texto.indexOf(m);
    if (i === 0) {
      const resto = texto.slice(m.length).trim();
      const corte = resto.search(/\n\s*(Hola|Hola,|¡Hola|Ok|Bien)/i);
      return corte > 0 ? resto.slice(corte).trim() : resto;
    }
  }
  return texto.trim();
}

async function pedir(url, opciones) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opciones, signal: ctrl.signal });
    if (!r.ok) {
      const cuerpo = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}: ${cuerpo.slice(0, 160)}`);
    }
    return r;
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------------- ollama
async function ollama(cfg, mensajes) {
  const r = await pedir(`${cfg.ollama_url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.ollama_modelo,
      messages: mensajes,
      think: false,
      stream: false,
      options: { temperature: cfg.temperatura ?? 0.85, num_predict: cfg.max_tokens ?? 400 },
    }),
  });
  const datos = await r.json();
  const texto = (datos.message && datos.message.content) || datos.response || "";
  if (!texto.trim()) throw new Error("ollama devolvio texto vacio");
  return {
    texto: quitarPensamientos(texto),
    modelo: cfg.ollama_modelo,
    aviso: datos.eval_count ? `${datos.eval_count} tok` : "",
  };
}

// -------------------------------------------------------------- pollinations
async function pollinations(cfg, mensajes) {
  const ultimo = mensajes[mensajes.length - 1];
  const r = await pedir("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.pollinations_modelo,
      messages: mensajes,
      max_tokens: cfg.max_tokens ?? 400,
      ...(cfg.claves && cfg.claves.pollinations ? { key: cfg.claves.pollinations } : {}),
    }),
  });
  const datos = await r.json();
  const el = (datos.choices && datos.choices[0] && datos.choices[0].message) || {};
  const texto = el.content || "";
  if (!texto.trim()) throw new Error("pollinations devolvio texto vacio");
  return { texto: texto.trim(), modelo: cfg.pollinations_modelo, aviso: ultimo ? "" : "" };
}

// ------------------------------------------------------------------- gemini
async function gemini(cfg, mensajes) {
  const clave = cfg.claves && cfg.claves.gemini;
  if (!clave) throw new Error("falta la clave de gemini");
  const partes = [];
  for (const m of mensajes) {
    const rol = m.role === "assistant" ? "model" : "user";
    partes.push({ role: rol, parts: [{ text: m.content }] });
  }
  const r = await pedir(
    `https://generativelanguage.googleapis.com/v1beta/models/${cfg.gemini_modelo}:generateContent?key=${clave}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: partes, generationConfig: { maxOutputTokens: cfg.max_tokens ?? 400 } }),
    }
  );
  const datos = await r.json();
  const texto =
    (datos.candidates &&
      datos.candidates[0] &&
      datos.candidates[0].content &&
      datos.candidates[0].content.parts &&
      datos.candidates[0].content.parts.map((p) => p.text).join("")) ||
    "";
  if (!texto.trim()) throw new Error("gemini devolvio texto vacio");
  return { texto: texto.trim(), modelo: cfg.gemini_modelo };
}

// --------------------------------------------------------------- openai-like
async function compatible(cfg, mensajes, nombre, url, modelo) {
  const clave = cfg.claves && cfg.claves[nombre];
  if (!clave) throw new Error(`falta la clave de ${nombre}`);
  const r = await pedir(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clave}`,
      ...(nombre === "openrouter"
        ? { "HTTP-Referer": "https://github.com/zumorra/r34pete", "X-Title": "R34pete" }
        : {}),
    },
    body: JSON.stringify({
      model: modelo,
      messages,
      max_tokens: cfg.max_tokens ?? 400,
      temperature: cfg.temperatura ?? 0.85,
    }),
  });
  const datos = await r.json();
  const texto = (datos.choices && datos.choices[0] && datos.choices[0].message.content) || "";
  if (!texto.trim()) throw new Error(`${nombre} devolvio texto vacio`);
  return { texto: texto.trim(), modelo };
}

const groq = (cfg, m) => compatible(cfg, m, "groq", "https://api.groq.com/openai/v1/chat/completions", cfg.groq_modelo);
const openrouter = (cfg, m) =>
  compatible(cfg, m, "openrouter", "https://openrouter.ai/api/v1/chat/completions", cfg.openrouter_modelo);

const BACKENDS = { ollama, pollinations, gemini, groq, openrouter };

/**
 * Responde con el primer backend que funcione.
 * @returns {Promise<{texto:string, backend:string, modelo:string, avisos:string[]}>}
 */
async function responder(cfg, mensajes) {
  const avisos = [];
  for (const nombre of cfg.orden || ["ollama", "pollinations"]) {
    const fn = BACKENDS[nombre];
    if (!fn) continue;
    try {
      const r = await fn(cfg, mensajes);
      return { texto: r.texto, backend: nombre, modelo: r.modelo, avisos };
    } catch (e) {
      avisos.push(`${nombre}: ${e.message}`);
      console.warn(`IA ${nombre} fallo: ${e.message}`);
    }
  }
  const detalle = avisos.length ? ` (${avisos.join(" | ")})` : "";
  throw new Error(`ningun backend de IA respondio${detalle}`);
}

module.exports = { responder, BACKENDS, quitarPensamientos };
