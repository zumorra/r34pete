"use strict";

/**
 * Bot de Telegram con el mismo cerebro que R34pete.
 *
 * Sirve para lo que Discord no deja: que la IA conteste SOLA a quien te
 * escribe, sin limites de servidor y sin formularios. Funciona con el token
 * que da @BotFather (un secreto del repo: TELEGRAM_BOT_TOKEN).
 *
 * Usa la API de Telegram por HTTPS con fetch (sin dependencias).
 */

const TELEGRAM = "https://api.telegram.org";

class Telegram {
  constructor(cfg = {}) {
    this.token = process.env.TELEGRAM_BOT_TOKEN || cfg.token || "";
    this.iaCfg = cfg.iaCfg || {};
    this.instrucciones = null;
    this.conocimiento = null;
    this.historial = new Map(); // chatId -> [{role, content}]
    this.maxHistorial = cfg.maxHistorial || 12;
    this.dueno = cfg.dueno || "";
    this.sesionAbierta = false;
    this.offset = 0;
  }

  disponible() {
    return Boolean(this.token);
  }

  /** Configura el cerebro (lo llama el bot al arrancar). */
  conCerebro({ instrucciones, conocimiento, iaCfg, dueno }) {
    this.instrucciones = instrucciones;
    this.conocimiento = conocimiento;
    this.iaCfg = iaCfg || this.iaCfg;
    if (dueno) this.dueno = dueno;
  }

  async api(metodo, datos = {}) {
    const url = `${TELEGRAM}/bot${this.token}/${metodo}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(`Telegram ${metodo}: ${j.description || r.status}`);
    return j.result;
  }

  /** Arranca el bucle de escucha. Nunca lanza: si falla, avisa y sigue. */
  async escuchar() {
    if (!this.disponible()) {
      console.log("[telegram] sin TELEGRAM_BOT_TOKEN: esta parte queda apagada");
      return;
    }
    try {
      const me = await this.api("getMe");
      console.log(`[telegram] conectado como @${me.username}`);
    } catch (e) {
      console.warn(`[telegram] no se pudo conectar: ${e.message}`);
      return;
    }
    this.sesionAbierta = true;
    while (this.sesionAbierta) {
      try {
        const Updates = await this.api("getUpdates", {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ["message"],
        });
        for (const u of Updates || []) {
          this.offset = u.update_id + 1;
          await this.tratar(u.message).catch((e) =>
            console.warn(`[telegram] fallo al atender: ${e.message}`)
          );
        }
      } catch (e) {
        console.warn(`[telegram] error en el bucle: ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /** Atiende un mensaje de Telegram. */
  async tratar(mensaje) {
    if (!mensaje || !mensaje.chat) return;
    const chatId = mensaje.chat.id;
    const texto = String(mensaje.text || "").trim();
    if (!texto) return;

    // Comandos propios
    if (texto.startsWith("/start")) {
      await this.api("sendMessage", {
        chat_id: chatId,
        text: "Hola, soy la IA de Yuki. Preguntame lo que quieras: SlimeVR, la granja, como buscar contenido... Respondo al momento.",
      });
      return;
    }
    if (texto.startsWith("/miid")) {
      await this.api("sendMessage", {
        chat_id: chatId,
        text: `Tu id de chat de Telegram es ${chatId}.`,
      });
      return;
    }
    if (texto.startsWith("/saber")) {
      const reglas = this.conocimiento ? this.conocimiento.cargar() : [];
      await this.api("sendMessage", {
        chat_id: chatId,
        text: reglas.length
          ? reglas.map((r) => `• ${r.respuesta}`).join("\n\n")
          : "Ahora mismo no hay reglas cargadas.",
      });
      return;
    }

    // Conversacion normal: el mismo cerebro que el bot de Discord.
    const sistema = [
      this.instrucciones ? this.instrucciones.actual() : "",
      this.conocimiento ? this.conocimiento.prompt() : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const historial = this.historial.get(chatId) || [];
    const mensajes = [
      { role: "system", content: sistema },
      ...historial,
      { role: "user", content: texto },
    ];
    const r = await this.responder(mensajes);
    historial.push({ role: "user", content: texto });
    historial.push({ role: "assistant", content: r.texto });
    while (historial.length > this.maxHistorial * 2) historial.shift();
    this.historial.set(chatId, historial);

    await this.api("sendMessage", { chat_id: chatId, text: r.texto });
  }

  /** Llama a la IA con el mismo orden de backends que el bot de Discord. */
  async responder(mensajes) {
    const ia = require("../src/ia");
    const r = await ia.responder(this.iaCfg, mensajes);
    return r;
  }

  /** Envia un aviso al chat del dueno (notificaciones de borradores). */
  async avisar(chatId, texto) {
    if (!this.disponible() || !chatId) return;
    try {
      await this.api("sendMessage", { chat_id: chatId, text: String(texto).slice(0, 4000) });
    } catch (e) {
      console.warn(`[telegram] no se pudo avisar: ${e.message}`);
    }
  }
}

module.exports = { Telegram };
