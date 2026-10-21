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
 * - cerebras    online, gratis con clave (Cerebras Cloud).
 * - nvidia      online, gratis con clave (integrate.api.nvidia.com).
 * - mistral     online, gratis con clave (La Plateforme).
 * - cloudflare  online, gratis con clave (Workers AI: 10.000 neuronas/dia).
 * - horde       online, gratis con clave (AI Horde, comunidad voluntaria).
 * - xai         online, DE PAGO (Grok): la clave necesita creditos en el equipo.
 *
 * Para openrouter, el modelo se puede poner de dos formas:
 *   - "openrouter/free": el router de modelos gratuitos; nunca cae a uno de pago.
 *   - "modelo-a:free,modelo-b:free": lista de respaldo; OpenRouter va al siguiente
 *     si el primero falla por cuota, caida o moderacion (si se mezcla uno de pago,
 *     ese se cobra: para no pagar, todos deben terminar en ":free").
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

// User-Agent de navegador: algunas APIs (groq, cerebras) estan delante de
// Cloudflare y rechazan las peticiones de Node con el error 1010.
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

async function pedir(url, opciones) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const cabeceras = { "User-Agent": USER_AGENT, Accept: "application/json", ...(opciones.headers || {}) };
  try {
    const r = await fetch(url, { ...opciones, headers: cabeceras, signal: ctrl.signal });
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
function cuerpoModelo(modelo, esOpenRouter) {
  // El array "models" es SOLO de OpenRouter (respaldo automatico). Los demas
  // proveedores (groq, cerebras, nvidia, mistral, xai) esperan un unico "model":
  // si se les mandara "models" se quedarian sin modelo y fallarian.
  if (!esOpenRouter) return { model: modelo };
  // "a,b,c" es una lista de respaldo de OpenRouter; un solo nombre va en "model".
  const lista = String(modelo).split(",").map((s) => s.trim()).filter(Boolean);
  return lista.length > 1 ? { models: lista } : { model: lista[0] ?? modelo };
}

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
      ...cuerpoModelo(modelo, nombre === "openrouter"),
      messages: mensajes,
      max_tokens: cfg.max_tokens ?? 400,
      temperature: cfg.temperatura ?? 0.85,
    }),
  });
  const datos = await r.json();
  const texto = (datos.choices && datos.choices[0] && datos.choices[0].message.content) || "";
  if (!texto.trim()) throw new Error(`${nombre} devolvio texto vacio`);
  // con lista de modelos, el que sirvio de verdad viene en la respuesta
  return { texto: texto.trim(), modelo: datos.model || modelo };
}

const groq = (cfg, m) => compatible(cfg, m, "groq", "https://api.groq.com/openai/v1/chat/completions", cfg.groq_modelo);
const openrouter = (cfg, m) =>
  compatible(cfg, m, "openrouter", "https://openrouter.ai/api/v1/chat/completions", cfg.openrouter_modelo);

// ------------------------------------------------------- cerebras / nvidia / mistral
// Todos son compatibles con la API de OpenAI: mismo cuerpo, distinto host.
const cerebras = (cfg, m) =>
  compatible(cfg, m, "cerebras", "https://api.cerebras.ai/v1/chat/completions", cfg.cerebras_modelo);
const nvidia = (cfg, m) =>
  compatible(cfg, m, "nvidia", "https://integrate.api.nvidia.com/v1/chat/completions", cfg.nvidia_modelo);
const mistral = (cfg, m) =>
  compatible(cfg, m, "mistral", "https://api.mistral.ai/v1/chat/completions", cfg.mistral_modelo);

// ---------------------------------------------------------------------- xai/grok
// Compatible con OpenAI. OJO: xAI no es gratis: la clave necesita creditos
// en el equipo (console.x.ai/team/...), si no el API responde 403.
const xai = (cfg, m) =>
  compatible(cfg, m, "xai", "https://api.x.ai/v1/chat/completions", cfg.xai_modelo);

// --------------------------------------------------------- cloudflare workers ai
// Necesita la clave de la API y el id de cuenta (los dos van en ia.claves).
async function cloudflare(cfg, mensajes) {
  const token = cfg.claves && cfg.claves.cloudflare;
  const cuenta = cfg.claves && cfg.claves.cloudflare_account;
  if (!token || !cuenta) throw new Error("faltan la clave o el id de cuenta de cloudflare");
  const modelo = cfg.cloudflare_modelo || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const r = await pedir(
    `https://api.cloudflare.com/client/v4/accounts/${cuenta}/ai/run/${encodeURIComponent(modelo)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: mensajes, max_tokens: cfg.max_tokens ?? 400 }),
    }
  );
  const datos = await r.json();
  const texto =
    (datos.result && datos.result.response) || datos.response || (datos.result && datos.result.text) || "";
  if (!texto.trim()) throw new Error("cloudflare devolvio texto vacio");
  return { texto: texto.trim(), modelo };
}

// ------------------------------------------------------------------ ai horde
// Comunidad de自愿: clave gratuita (hay que registrarse en stablehorde.net).
async function horde(cfg, mensajes) {
  const clave = cfg.claves && cfg.claves.horde;
  if (!clave) throw new Error("falta la clave de horde");
  const prompt = mensajes
    .map((m) => (m.role === "system" ? m.content : `${m.role}: ${m.content}`))
    .join("\n\n");
  const r = await pedir("https://stablehorde.net/api/v2/generate/async", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: clave },
    body: JSON.stringify({
      apikey: clave,
      prompt,
      params: { max_length: cfg.max_tokens ?? 400, temperature: cfg.temperatura ?? 0.85 },
      models: [cfg.horde_modelo || "meta-llama/Meta-Llama-3.3-70B-Instruct"],
      trusted_workers: false,
      slow_workers: true,
    }),
  });
  const id = (await r.json()).id;
  if (!id) throw new Error("horde no devolvio id de generacion");
  const modelo = cfg.horde_modelo || "meta-llama/Meta-Llama-3.3-70B-Instruct";
  for (let i = 0; i < 30; i++) {
    await new Promise((s) => setTimeout(s, 2000));
    const c = await pedir(`https://stablehorde.net/api/v2/generate/check/${id}`, {
      headers: { apikey: clave },
    });
    const d = await c.json();
    if (d.finished) {
      const texto = (d.generations || []).map((g) => g.text).join(" ").trim();
      if (texto) return { texto, modelo };
      break;
    }
    if (d.kudos && d.kudos > 0) throw new Error("horde: generacion cancelada");
  }
  throw new Error("horde: se agoto el tiempo de espera");
}

const BACKENDS = { ollama, pollinations, gemini, groq, openrouter, cerebras, nvidia, mistral, cloudflare, horde, xai };

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
