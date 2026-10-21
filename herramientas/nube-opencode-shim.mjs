// Puente OpenAI-compatible que corre DENTRO del runner de GitHub Actions.
//
// El tier gratis de OpenCode (los ":free") tiene el tope POR IP: la master se
// queda sin cuota y el runner de la nube contesta el MISMO modelo porque sale
// por otra IP. Este shim expone el runner como una API OpenAI-compatible
// (POST /v1/chat/completions) y por debajo usa el cliente oficial de OpenCode
// ("opencode run"), que es la unica via por la que los :free contestan.
//
//   CUBO_TOKEN   clave compartida (cabecera Authorization: Bearer ...)
//   CUBO_PORT    puerto (8080 por defecto)
//   CUBO_MODELOS lista de modelos :free que se ofrecen
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = Number(process.env.CUBO_PORT || 8080);
const TOKEN = process.env.CUBO_TOKEN || "";
const MODELOS = (process.env.CUBO_MODELOS ||
  "deepseek-v4.1-flash-free,nemotron-3-ultra-free,nemotron-3.5-lightning-free,minimax-m3.1-flash-free,beam-free")
  .split(",").map((s) => s.trim()).filter(Boolean);

function autorizado(req) {
  if (!TOKEN) return true;
  const a = String(req.headers["authorization"] || "");
  const x = String(req.headers["x-cubo-token"] || "");
  return a === `Bearer ${TOKEN}` || x === TOKEN;
}

function contenido(m) {
  if (typeof m?.content === "string") return m.content;
  if (Array.isArray(m?.content)) return m.content.map((c) => c?.text || "").join(" ");
  return "";
}

function construirPrompt(messages) {
  const partes = [];
  for (const m of messages || []) {
    const c = contenido(m).trim();
    if (!c) continue;
    const quien = m.role === "assistant" ? "Asistente" : m.role === "system" ? "Instrucciones" : "Usuario";
    partes.push(`${quien}: ${c}`);
  }
  // El runner no tiene el prompt en espanol de la master.
  return "Responde siempre en español, de forma directa.\n\n" + partes.join("\n\n");
}

function opencode(model, prompt) {
  return new Promise((resolve, reject) => {
    const objetivo = model.includes("/") ? model : `opencode/${model}`;
    const child = spawn("opencode", ["run", "--model", objetivo], { env: process.env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      // "opencode run" imprime una cabecera "> build · modelo" antes de la respuesta.
      const texto = out.split("\n").filter((l) => !/^\s*>\s/.test(l)).join("\n").trim();
      if (code === 0 && texto) return resolve(texto);
      reject(new Error(String(err || out || `opencode terminó con código ${code}`).slice(-600)));
    });
    child.stdin.end(prompt);
  });
}

function sse(res, modelo, texto) {
  const id = "chatcmpl-nube-" + Date.now();
  const creado = Math.floor(Date.now() / 1000);
  const trozo = (delta, fin) => JSON.stringify({
    id, object: "chat.completion.chunk", created: creado, model: modelo,
    choices: [{ index: 0, delta, finish_reason: fin ?? null }],
  });
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${trozo({ role: "assistant" })}\n\n`);
  for (const parte of texto.split(/(?<=\n)/)) {
    if (parte) res.write(`data: ${trozo({ content: parte })}\n\n`);
  }
  res.write(`data: ${trozo({}, "stop")}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, modelos: MODELOS, servicio: "cubo-nube-opencode" }));
  }
  if (!autorizado(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "no autorizado" } }));
  }
  if (req.method === "GET" && req.url.startsWith("/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      object: "list",
      data: MODELOS.map((id) => ({ id, object: "model", owned_by: "nube" })),
    }));
  }
  if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
    let crudo = "";
    req.on("data", (d) => { crudo += d; });
    req.on("end", async () => {
      let cuerpo = {};
      try { cuerpo = JSON.parse(crudo || "{}"); } catch { /* cuerpo vacio */ }
      const modelo = cuerpo.model || MODELOS[0];
      const prompt = construirPrompt(cuerpo.messages);
      try {
        const texto = await opencode(modelo, prompt);
        if (cuerpo.stream) return sse(res, modelo, texto);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          id: "chatcmpl-nube-" + Date.now(),
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelo,
          choices: [{ index: 0, message: { role: "assistant", content: texto }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }));
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" });
        return res.end(JSON.stringify({
          error: { message: String(e?.message || e), type: "upstream_error", code: "cubo_nube" },
        }));
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "ruta no encontrada" } }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`cubo nube escuchando en 127.0.0.1:${PORT} con ${MODELOS.length} modelos`);
});
