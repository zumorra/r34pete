"use strict";

/**
 * Puente con el Discord Social SDK (SDK oficial de Discord).
 *
 * Sirve para LEER la bandeja de privados de Yuki y para ENVIAR mensajes en su
 * nombre. Ojo con la regla de Discord: el SDK solo permite enviar "in response
 * to an explicit user action" (asi lo dice su propia documentacion del
 * metodo sendUserMessage). Por eso aqui:
 *   - LEER y REDACTAR es automatico (la IA prepara la respuesta);
 *   - ENVIAR solo ocurre cuando el propio Yuki lo pide (comando /enviar).
 *
 * Requisitos para que funcione:
 *   1. Una app de Discord con "Discord Social SDK" activado en el portal.
 *   2. La libreria nativa del SDK (libdiscord_partner_sdk.so) descargada del
 *      portal y en la variable DISCORD_SDK_PATH.
 *   3. Tokens: DISCORD_SOCIAL_ACCESS, DISCORD_SOCIAL_REFRESH (y opcionalmente
 *      DISCORD_SOCIAL_EXPIRES) y DISCORD_SOCIAL_APP_ID.
 *
 * Si falta cualquier cosa, el bot sigue funcionando como un bot normal.
 */

const APP_ID = process.env.DISCORD_SOCIAL_APP_ID || "";
const ACCESS = process.env.DISCORD_SOCIAL_ACCESS || "";
const REFRESH = process.env.DISCORD_SOCIAL_REFRESH || "";
const EXPIRES = Number(process.env.DISCORD_SOCIAL_EXPIRES || 0);
const SCOPES = process.env.DISCORD_SOCIAL_SCOPES || "openid sdk.social_layer";

let sdk = null;
let cliente = null;
let conectado = false;

class Social {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.dueno = cfg.dueno || "";
    this.cadaMinutos = cfg.cadaMinutos || 3;
    this.ultimo = new Map(); // destinatario -> id del ultimo mensaje visto
  }

  /** ¿Estan los tokens y la app configurados? */
  disponible() {
    return Boolean(APP_ID && ACCESS && REFRESH);
  }

  /** Almacen de tokens: en la nube vienen de los secretos del repo. */
  almacen() {
    return {
      async load() {
        if (!ACCESS || !REFRESH) return undefined;
        return {
          accessToken: ACCESS,
          refreshToken: REFRESH,
          expiresAt: EXPIRES,
          scopes: SCOPES,
        };
      },
      async save() {}, // en la nube los tokens son secretos: no se guardan en disco
      async clear() {},
    };
  }

  /** Arranca la sesion. Devuelve true si el SDK queda conectado. */
  async iniciar() {
    if (!this.disponible()) {
      console.log(
        "[social] sin tokens o sin DISCORD_SOCIAL_APP_ID: la parte de la bandeja queda apagada"
      );
      return false;
    }
    try {
      const raiz = await import("@discordkit/native");
      const auth = await import("@discordkit/native/auth");
      const mens = await import("@discordkit/native/messaging");
      sdk = { raiz, auth, mens };
      cliente = raiz.init({
        applicationId: APP_ID,
        tokenStore: this.almacen(),
      });
      raiz.subscribe(cliente.status, (estado) => {
        if (String(estado).toLowerCase() === "ready") console.log("[social] sesion lista");
      });
      // Reconecta en silencio con los tokens guardados: no abre navegador.
      const ok = await auth.resumeSession();
      if (!ok) {
        console.warn("[social] los tokens no sirvian: hay que autorizar de nuevo");
        return false;
      }
      conectado = true;
      console.log("[social] conectado a la bandeja de Discord");
      return true;
    } catch (e) {
      console.warn(`[social] no se pudo iniciar (${e.message})`);
      return false;
    }
  }

  /**
   * Privados con mensajes nuevos. Devuelve [{destinatario, mensajeId, texto}].
   * Solo mira el ultimo mensaje de cada conversacion.
   */
  async bandeja() {
    if (!conectado || !sdk) return [];
    const nuevos = [];
    try {
      const resumenes = await sdk.mens.getUserMessageSummaries();
      for (const resumen of resumenes || []) {
        const destinatario = String(resumen.userId);
        const mensajes = await sdk.mens.getUserMessages(resumen.userId, 5);
        const lista = Array.isArray(mensajes) ? mensajes : [];
        if (!lista.length) continue;
        // La lista viene de mas nuevo a mas viejo.
        const ultimo = lista[0];
        const visto = this.ultimo.get(destinatario);
        if (!visto) {
          // Primera vuelta: se memoriza el estado, no se responde a lo viejo.
          this.ultimo.set(destinatario, String(ultimo.id));
          continue;
        }
        if (String(ultimo.id) === visto) continue;
        this.ultimo.set(destinatario, String(ultimo.id));
        const texto = (ultimo.content || ultimo.rawContent || "").trim();
        if (!texto) continue;
        // Si el ultimo mensaje es nuestro, no hay nada que contestar.
        if (String(ultimo.authorId) === this.dueno) continue;
        nuevos.push({
          destinatario,
          mensajeId: String(ultimo.id),
          texto,
        });
      }
    } catch (e) {
      console.warn(`[social] no se pudo leer la bandeja: ${e.message}`);
    }
    return nuevos;
  }

  /** Envia un mensaje en nombre de Yuki. Solo tras accion explicita suya. */
  async enviar(destinatario, texto) {
    if (!conectado || !sdk) throw new Error("el Social SDK no esta conectado");
    const id = await sdk.mens.sendUserMessage(String(destinatario), String(texto));
    return String(id);
  }
}

module.exports = { Social };
