"use strict";

/**
 * R34pete — bot de Discord para contenido de adultos.
 *
 * - /buscar   busca por etiquetas en los tableros y postea un resultado
 * - /feed     crea, lista y borra feeds automaticos por canal
 * - /estado   resumen del bot
 * - /ayuda    ayuda
 *
 * El bot solo publica en canales con "Restriccion de edad" activada.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const { cargar } = require("./config");
const proveedores = require("./providers");
const presets = require("./presets");
const { COMANDOS } = require("./comandos");
const { Vistos } = require("./seen");
const { Instrucciones } = require("./instrucciones");
const { Conocimiento } = require("./conocimiento");
const { Social } = require("../social/social");
const { Borradores } = require("../social/borradores");
const { Telegram } = require("../telegram/telegram");
const { Pendientes } = require("./pendientes");
const { Historial } = require("./historial");
const ia = require("./ia");
const { GestorFeeds } = require("./feed");
const { EstadoFeeds } = require("./feed-estado");
const guard = require("./guard");

const cfg = cargar();
const cliente = new Client({
  // Sin intents privilegiados de los que Discord revisa (no pedimos la lista de
  // miembros: el chequeo de rol se pide a la API cuando hace falta), asi el
  // bot no necesita revision de intents al pasar de 10.000 usuarios. El de
  // contenido de mensajes SI esta activado en el portal: es lo que permite
  // leer el texto de los DMs.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
  // Imprescindible para los DMs: un mensaje de alguien que no esta en el cache
  // llega como "partial" y SIN texto; con esto se puede pedir al gateway el
  // mensaje completo (es lo que hace el bot de referencia de GitHub).
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
cliente.cfg = cfg;
cliente.feeds = new GestorFeeds(cliente);
// Estado de los feeds: pagina por la que va cada uno y tamanos ya sabidos.
cliente.estadoFeeds = new EstadoFeeds(cfg.feedEstadoFile);
// Registro de lo ya publicado, en disco: evita repetir entre reinicios.
cliente.vistos = new Vistos(cfg.vistosFile);
// Chat automatico: instrucciones (fichero, recarga en caliente), memoria de
// conversacion y configuracion de IA.
cliente.instrucciones = new Instrucciones(cfg.chat.instrucciones);
cliente.conocimiento = new Conocimiento(cfg.conocimientoFile);
// Social SDK: lee la bandeja de privados de Yuki y prepara respuestas.
cliente.social = new Social(cfg.social || {});
cliente.borradores = new Borradores((cfg.social || {}).archivo || "/var/lib/r34pete/borradores.json");
// Telegram: el mismo cerebro en otro canal, donde si puede contestar solo.
cliente.telegram = new Telegram({ iaCfg: cfg.ia, maxHistorial: cfg.chat.maximo_historial });
cliente.pendientes = new Pendientes(cfg.pendientesFile);
cliente.historial = new Historial(cfg.chat.maximo_historial);
cliente.iaCfg = cfg.ia;

const COOLDOWNS = new Map();
const CHAT_COOLDOWNS = new Map();

/** Mezcla una lista (para no repetir siempre el mismo resultado). */
function barajar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Nombre del adjunto con la extensión correcta (Discord la usa para el vídeo). */
function nombreArchivo(post) {
  const ext = (post.ext || "").toLowerCase();
  const validas = ["jpg", "jpeg", "png", "webp", "gif", "webm", "mp4"];
  const e = validas.includes(ext) ? ext : post.tipo === "video" ? "webm" : "jpg";
  return `r34pete.${e}`;
}

// ------------------------------------------------------------------ comandos
async function registrarComandos() {
  const cuerpo = COMANDOS.map((c) => c.toJSON());
  if (cfg.guildId) {
    const guild = cliente.guilds.cache.get(cfg.guildId);
    if (guild) {
      await guild.commands.set(cuerpo);
      console.log(`Comandos registrados en ${guild.name} (${cfg.guildId})`);
      return;
    }
    console.log(`El servidor ${cfg.guildId} no esta en la cache todavia`);
  }
  const aplicacion = await cliente.application.fetch();
  await aplicacion.commands.set(cuerpo);
  console.log("Comandos registrados globalmente (pueden tardar hasta 1 hora)");
}

// ---------------------------------------------------------------- utilidades
function respuestaEphemeral(interaccion, contenido) {
  if (interaccion.deferred || interaccion.replied) {
    return interaccion.followUp({ content: contenido, ephemeral: true });
  }
  return interaccion.reply({ content: contenido, ephemeral: true });
}

function cooledDown(interaccion) {
  const ahora = Date.now();
  const previo = COOLDOWNS.get(interaccion.user.id) || 0;
  const cd = (cfg.guards.cooldownSeconds || 0) * 1000;
  if (cd > 0 && ahora - previo < cd) {
    const faltan = Math.ceil((cd - (ahora - previo)) / 1000);
    return `Vas rapido. Espera ${faltan} s.`;
  }
  COOLDOWNS.set(interaccion.user.id, ahora);
  return null;
}

/** Guarda los feeds en el fichero propio del bot (la config con el token no se toca). */
function guardarFeeds() {
  const ruta = cfg.feedsFile;
  try {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(cliente.feeds.aJSON(), null, 2));
    console.log(`Feeds guardados en ${ruta}`);
  } catch (e) {
    console.warn(`No se pudieron guardar los feeds: ${e.message}`);
  }
}

/** Feeds: los del fichero propio (los creados con /feed) + los de la config. */
function leerFeeds() {
  const delFichero = [];
  try {
    if (fs.existsSync(cfg.feedsFile)) {
      const datos = JSON.parse(fs.readFileSync(cfg.feedsFile, "utf8"));
      if (Array.isArray(datos)) delFichero.push(...datos);
    }
  } catch (e) {
    console.warn(`No se pudo leer ${cfg.feedsFile}: ${e.message}`);
  }
  return [...(cfg.feeds || []), ...delFichero];
}


// ---------------------------------------------------------------- chat por DM
// Responde automaticamente a quien escriba al bot por privado, y en los
// canales del servidor solo si le mencionan o si usa el disparador.
cliente.on("messageCreate", async (mensaje) => {
  await manejarChat(mensaje);
});

/**
 * Logica del chat automatico. Se separa del evento para poder probarla
 * sin un evento real de Discord.
 */
async function manejarChat(mensaje) {
  if (!cfg.chat.habilitado) return;
  if (mensaje.author.bot && !cfg.chat.responder_a_bots) return;
  if (cliente.user && mensaje.author.id === cliente.user.id) return;
  // Un DM de alguien que no esta en el cache llega como mensaje parcial y SIN
  // texto: hay que pedirlo al gateway para poder leerlo.
  if (mensaje.partial) {
    try {
      mensaje = await mensaje.fetch();
    } catch (e) {
      console.warn(`[chat] no se pudo completar el mensaje parcial: ${e.message}`);
      return;
    }
  }
  if (!mensaje.content || !mensaje.content.trim()) return;

  // Privado (1 a 1), grupo de MDs o el canal que se haya autorizado.
  const esDM = mensaje.channel.type === ChannelType.DM;
  const esGrupo = mensaje.channel.type === ChannelType.GroupDM;
  const idBot = cliente.user ? cliente.user.id : null;
  const menciona = idBot && mensaje.mentions.users.has(idBot);
  const disparador = cfg.chat.disparador || "!";
  const conDisparador =
    disparador && mensaje.content.trim().toLowerCase().startsWith(disparador.toLowerCase());
  const canalAutorizado =
    cfg.chat.canalPermitido && String(mensaje.channel.id) === String(cfg.chat.canalPermitido);

  if (esDM || esGrupo) {
    if (cfg.chat.en_dm !== "siempre") return;
  } else {
    // En los canales solo contesta si ese canal esta autorizado.
    if (canalAutorizado) {
      // permitido: sigue
    } else if (cfg.chat.en_canales === "nunca") {
      if (menciona) {
        await mensaje
          .reply("Aqui solo hablo por privado: escribeme un mensaje directo y te contesto.")
          .catch(() => {});
      }
      return;
    } else if (cfg.chat.en_canales === "mencion" && !menciona && !conDisparador) {
      return;
    }
  }

  try {
    guard.revisarTexto(mensaje.content);
  } catch (e) {
    return mensaje.reply(e.message).catch(() => {});
  }

  const ahora = Date.now();
  const previo = CHAT_COOLDOWNS.get(mensaje.author.id) || 0;
  const cd = (cfg.chat.cooldown_s || 5) * 1000;
  if (ahora - previo < cd) return;
  CHAT_COOLDOWNS.set(mensaje.author.id, ahora);

  const texto = (conDisparador && !esDM ? mensaje.content.slice(disparador.length).trim() : mensaje.content).trim();
  if (!texto) return;

  // Anota el privado por si hay que retomarlo al reiniciar la sesion.
  if (esDM || esGrupo) {
    cliente.pendientes.anotar(mensaje.channel.id, mensaje.id);
  }

  try {
    await mensaje.channel.sendTyping().catch(() => {});
    const r = await responderConIA(mensaje.author.id, texto);
    if (!r) return;
    console.log(`[chat] ${mensaje.author.tag} en ${mensaje.channel.type === ChannelType.DM ? "DM" : mensaje.channel.name}: ${r.backend}/${r.modelo}`);
    await enviarPartido(mensaje, r.texto);
    return r.texto;
  } catch (e) {
    console.error(`[chat] fallo: ${e.message}`);
    await mensaje
      .reply("Ahora mismo no puedo responder (se acabo la cuota o la IA no responde). Intentalo en un momento.")
      .catch(() => {});
  }
}

/**
 * Al arrancar, mira los privados conocidos y contesta lo ultimo que se quedo
 * sin respuesta (pasa si alguien escribio mientras el bot se reiniciaba).
 */
async function revisarPendientes() {
  const canales = cliente.pendientes.canales(10);
  for (const info of canales) {
    let canal;
    try {
      canal = await cliente.channels.fetch(info.id);
    } catch {
      continue;
    }
    if (!canal || !canal.isTextBased()) continue;
    let mensajes;
    try {
      mensajes = await canal.messages.fetch({ limit: 30 });
    } catch {
      continue;
    }
    const lista = [...mensajes.values()].sort(
      (a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0)
    );
    // el ultimo mensaje humano y si el bot respondio despues
    let ultimoHumano = null;
    let respondioDespues = false;
    for (const m of lista) {
      if (m.author && !m.author.bot) {
        ultimoHumano = m;
        respondioDespues = false;
      } else if (m.author && m.author.bot && ultimoHumano) {
        respondioDespues = true;
      }
    }
    if (!ultimoHumano || respondioDespues) continue;
    if (!ultimoHumano.content || !ultimoHumano.content.trim()) continue;
    console.log(`[chat] retomar pendiente del canal ${info.id}`);
    try {
      const r = await responderConIA(ultimoHumano.author.id, ultimoHumano.content.trim());
      await enviarPartido(ultimoHumano, r.texto);
      cliente.pendientes.anotar(canal.id, ultimoHumano.id);
    } catch (e) {
      console.warn(`[chat] no se pudo retomar el pendiente: ${e.message}`);
    }
  }
}

/**
 * Lee la bandeja de privados de Yuki (Social SDK), redacta con la IA lo que le
 * escriben y deja el borrador listo para mandarlo con /enviar.
 *
 * Discord solo permite enviar mensajes en nombre de un usuario tras una accion
 * explicita de ese usuario, asi que aqui NUNCA se envia solo: se redacta solo y
 * el envio lo pide Yuki.
 */
async function bucleSocial() {
  const ok = await cliente.social.iniciar();
  if (!ok) return;
  const cada = Math.max(1, (cfg.social || {}).cadaMinutos || 3);
  while (true) {
    await new Promise((r) => setTimeout(r, cada * 60 * 1000));
    try {
      const nuevos = await cliente.social.bandeja();
      for (const n of nuevos) {
        const r = await responderConIA(`social:${n.destinatario}`, n.texto);
        const borrador = cliente.borradores.anadir({
          destinatario: n.destinatario,
          usuario: n.usuario || "",
          mensajeId: n.mensajeId,
          texto: n.texto,
          respuesta: r.texto,
        });
        if (!borrador) continue;
        console.log(`[social] borrador ${borrador.id} para ${n.destinatario}`);
        await avisarDueno(borrador);
      }
    } catch (e) {
      console.warn(`[social] fallo el ciclo: ${e.message}`);
    }
  }
}

/** Avisa a Yuki por privado de que hay un borrador nuevo. */
async function avisarDueno(borrador) {
  const id = (cfg.social || {}).dueno;
  if (!id) return;
  try {
    const user = await cliente.users.fetch(id);
    await user.send(
      `📝 **Borrador ${borrador.id}** de ${borrador.usuario || borrador.destinatario}:\n> ${borrador.texto}\n\nMi respuesta:\n> ${borrador.respuesta}\n\nPara mandarla: \`/enviar ${borrador.id}\``
    );
  } catch (e) {
    console.warn(`[social] no se pudo avisar al dueno: ${e.message}`);
  }
}

/** /enviar <id>: manda un borrador (esto SI es la accion del usuario). */
async function cmdEnviar(interaccion) {
  const id = interaccion.options.getString("id", true);
  const borrador = cliente.borradores.porId(id);
  if (!borrador) {
    return await respuestaEphemeral(interaccion, { content: "No hay ningun borrador con ese id." });
  }
  if (borrador.enviado) {
    return await respuestaEphemeral(interaccion, { content: "Ese borrador ya se habia mandado." });
  }
  try {
    await cliente.social.enviar(borrador.destinatario, borrador.respuesta);
    cliente.borradores.marcarEnviado(borrador.id);
    await respuestaEphemeral(interaccion, {
      content: `✅ Mandado a ${borrador.usuario || borrador.destinatario}:\n> ${borrador.respuesta}`,
    });
  } catch (e) {
    await respuestaEphemeral(interaccion, { content: `No se pudo enviar: ${e.message}` });
  }
}

/** /borradores: lista los pendientes. */
async function cmdBorradores(interaccion) {
  const lista = cliente.borradores.listar();
  if (!lista.length) {
    return await respuestaEphemeral(interaccion, { content: "No hay borradores pendientes." });
  }
  const texto = lista
    .map(
      (b) =>
        `**${b.id}** - de ${b.usuario || b.destinatario}: "${String(b.texto || "").slice(0, 90)}"\n> ${String(b.respuesta || "").slice(0, 300)}`
    )
    .join("\n\n");
  await respuestaEphemeral(interaccion, {
    content: `**Borradores pendientes** (manda con \`/enviar <id>\`):\n\n${texto}`,
  });
}

/**
 * Pide una respuesta a la IA con el contexto del usuario y la guarda en el
 * historial. La usan tanto los DMs automaticos como el comando /chat.
 */
async function responderConIA(usuarioId, texto) {
  const historial = cliente.historial.ultimos(usuarioId);
  // Lo que sabe el bot (reglas de "si te preguntan X, responde Y") va al prompt.
  const kb = cliente.conocimiento.prompt();
  const mensajes = [
    {
      role: "system",
      content: cliente.instrucciones.actual() + (kb ? "\n\n" + kb : ""),
    },
    ...historial,
    { role: "user", content: texto },
  ];
  // Regla marcada como "exacta": se contesta tal cual, sin gastar IA.
  const regla = cliente.conocimiento.buscar(texto);
  if (regla && regla.exacto) {
    cliente.historial.anadir(usuarioId, "user", texto);
    cliente.historial.anadir(usuarioId, "assistant", regla.respuesta);
    return { texto: regla.respuesta, backend: "reglas", modelo: "respuestas.json", avisos: [] };
  }
  const r = await ia.responder(cliente.iaCfg, mensajes);
  cliente.historial.anadir(usuarioId, "user", texto);
  cliente.historial.anadir(usuarioId, "assistant", r.texto);
  return r;
}

/** Envia un texto largo partido en trozos que quepan en un mensaje. */
async function enviarPartido(mensaje, texto) {
  const trozos = String(texto).match(/[\s\S]{1,1900}/g) || [String(texto)];
  for (const trozo of trozos) {
    await mensaje.reply(trozo).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ------------------------------------------------------------------ handlers
cliente.once("ready", async () => {
  revisarPendientes().catch((e) => console.warn(`[chat] no se pudieron revisar los pendientes: ${e.message}`));
  if ((cfg.social || {}).habilitado) {
    bucleSocial().catch((e) => console.warn(`[social] el bucle se ha parado: ${e.message}`));
  }
  cliente.telegram.conCerebro({
    instrucciones: cliente.instrucciones,
    conocimiento: cliente.conocimiento,
    iaCfg: cfg.ia,
  });
  cliente.telegram.escuchar().catch((e) => console.warn(`[telegram] el bucle se ha parado: ${e.message}`));
  console.log(`R34pete conectado como ${cliente.user.tag}`);
  cliente.feeds.cargarDesdeConfig(leerFeeds());
  await registrarComandos();
});

cliente.on("interactionCreate", async (interaccion) => {
  if (!interaccion.isChatInputCommand()) return;

  try {
    if (interaccion.commandName === "buscar") return await cmdBuscar(interaccion);
    if (interaccion.commandName === "feed") return await cmdFeed(interaccion);
    if (interaccion.commandName === "instrucciones") return await cmdInstrucciones(interaccion);
    if (interaccion.commandName === "saber") return await cmdSaber(interaccion);
    if (interaccion.commandName === "enviar") return await cmdEnviar(interaccion);
    if (interaccion.commandName === "borradores") return await cmdBorradores(interaccion);
    if (interaccion.commandName === "ia") return await cmdIa(interaccion);
    if (interaccion.commandName === "olvidar") return await cmdOlvidar(interaccion);
    if (interaccion.commandName === "chat") return await cmdChat(interaccion);
    if (interaccion.commandName === "estado") return await cmdEstado(interaccion);
    if (interaccion.commandName === "ayuda") return await cmdAyuda(interaccion);
  } catch (e) {
    console.error(e);
    try {
      await respuestaEphemeral(interaccion, `Error: ${e.message}`);
    } catch {
      /* interaction caducada */
    }
  }
});

async function cmdBuscar(interaccion) {
  const motivo = await guard.comprobarCanal(interaccion, cfg.guards);
  if (motivo) return respuestaEphemeral(interaccion, motivo);

  const fuente = interaccion.options.getString("fuente") || "e621";
  const entrada = interaccion.options.getString("tags");
  const medioOpcion = interaccion.options.getString("medio");
  const { tags, medio, traducciones } = presets.interpretar(entrada, medioOpcion, fuente);
  try {
    guard.revisarTexto(entrada);
    guard.revisarTags(tags);
  } catch (e) {
    return respuestaEphemeral(interaccion, e.message);
  }
  if (!tags) {
    return respuestaEphemeral(
      interaccion,
      "Dime qué buscar. Ejemplos: `furry`, `futa`, `gif`, `videos`, `furry videos`."
    );
  }

  const disponibles = proveedores.disponibles(cfg);
  if (!disponibles.includes(fuente)) {
    return respuestaEphemeral(
      interaccion,
      `El tablero **${fuente}** no esta disponible en la configuracion. ` +
        `Disponibles: ${disponibles.join(", ") || "ninguno"}.`
    );
  }

  const cd = cooledDown(interaccion);
  if (cd) return respuestaEphemeral(interaccion, cd);

  await interaccion.deferReply({ ephemeral: false });
  try {
    // Se prueban varias paginas para no repetir lo recien visto.
    const vistos = cliente.vistos;
    let resultados = [];
    let nuevos = [];
    for (let pagina = 0; pagina < 6 && !nuevos.length; pagina++) {
      resultados = await proveedores.buscar(
        cfg,
        fuente,
        tags,
        cfg.guards.maxResults || 40,
        medio,
        { pagina }
      );
      if (!resultados.length) break;
      nuevos = vistos.sinVer(fuente, resultados, medio);
    }
    if (!resultados.length) {
      return await interaccion.editReply(
        `No encontre nada **${medio}** con \`${tags}\` en ${fuente}.`
      );
    }
    const bolsa = nuevos.length ? barajar(nuevos) : barajar(resultados);
    const descargado = await proveedores.descargarApto(
      bolsa,
      cfg.guards.maxUploadMb || 25,
      cfg.userAgent
    );
    if (!descargado) {
      return await interaccion.editReply(
        "No encontré ninguno que quepa en el límite de subida de Discord."
      );
    }
    const post = descargado.post;
    const buffer = descargado.buffer;
    vistos.marcar(fuente, [post.id], medio);
    const embed = new EmbedBuilder()
      .setColor(0x9b30ff)
      .setTitle("Resultado")
      .addFields(
        { name: "Tablero", value: post.source, inline: true },
        { name: "id", value: post.id || "-", inline: true },
        { name: "Medio", value: post.tipo || medio, inline: true }
      );
    if (post.rating) embed.addFields({ name: "Rating", value: post.rating, inline: true });
    if (post.tags) embed.addFields({ name: "Etiquetas", value: post.tags.slice(0, 1000) });
    if (traducciones.length) {
      embed.addFields({
        name: "Traducido",
        value: traducciones.join(" · ").slice(0, 500),
      });
    }
    if (post.pageUrl) embed.setURL(post.pageUrl);
    await interaccion.editReply({
      embeds: [embed],
      files: [{ attachment: buffer, name: nombreArchivo(post) }],
    });
  } catch (e) {
    console.error(e);
    await interaccion.editReply(`No pude buscar: ${e.message}`);
  }
}

async function cmdFeed(interaccion) {
  const sub = interaccion.options.getSubcommand();

  if (sub === "listar") {
    const feeds = cliente.feeds.aJSON();
    if (!feeds.length) {
      return respuestaEphemeral(interaccion, "No hay feeds configurados.");
    }
    const texto = feeds
      .map(
        (f) =>
          `**${f.id}** → canal \`${f.canalId}\` · ${f.proveedor} · cada ${f.cadaMinutos} min · \`${f.tags}\``
      )
      .join("\n");
    return respuestaEphemeral(interaccion, `Feeds:\n${texto}`);
  }

  if (sub === "anadir") {
    if (!interaccion.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return respuestaEphemeral(interaccion, "Necesitas permiso de **gestionar canales**.");
    }
    const canal = interaccion.options.getChannel();
    if (!canal || !canal.isTextBased() || canal.type === ChannelType.GuildVoice) {
      return respuestaEphemeral(interaccion, "Ese canal no vale.");
    }
    if (cfg.guards.requireNsfwChannel && !guard.canalEsNsfw(canal)) {
      return respuestaEphemeral(
        interaccion,
        "Ese canal no tiene la **restriccion de edad** activada. Activala antes de crear el feed."
      );
    }
    const entrada = interaccion.options.getString("tags");
    const { tags, medio } = presets.interpretar(
      entrada,
      interaccion.options.getString("medio")
    );
    try {
      guard.revisarTexto(entrada);
      guard.revisarTags(tags);
    } catch (e) {
      return respuestaEphemeral(interaccion, e.message);
    }
    const fuente = interaccion.options.getString("fuente") || "e621";
    if (!proveedores.disponibles(cfg).includes(fuente)) {
      return respuestaEphemeral(
        interaccion,
        `El tablero **${fuente}** no esta disponible en la configuracion.`
      );
    }
    const minutos = interaccion.options.getInteger("minutos") || 30;
    const perfil = (interaccion.options.getString("perfil") || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const feed = cliente.feeds.crear({
      canalId: canal.id,
      proveedor: fuente,
      tags,
      medio,
      cadaMinutos: minutos,
      activado: true,
      slots: perfil.length ? perfil : undefined,
    });
    guardarFeeds();
    return respuestaEphemeral(
      interaccion,
      `Feed **${feed.id}** creado en <#${canal.id}>: cada ${minutos} min, ${fuente}, ` +
        `${medio}, \`${tags}\`.`
    );
  }

  if (sub === "borrar") {
    if (!interaccion.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return respuestaEphemeral(interaccion, "Necesitas permiso de **gestionar canales**.");
    }
    const id = interaccion.options.getString("id");
    const ok = cliente.feeds.borrar(id);
    if (ok) guardarFeeds();
    return respuestaEphemeral(
      interaccion,
      ok ? `Feed **${id}** borrado.` : `No hay ningun feed con id **${id}**.`
    );
  }
}

async function cmdChat(interaccion) {
  const texto = (interaccion.options.getString("mensaje") || "").trim();
  if (!texto) return respuestaEphemeral(interaccion, "Escribeme algo.");
  try {
    guard.revisarTexto(texto);
  } catch (e) {
    return respuestaEphemeral(interaccion, e.message);
  }
  await interaccion.deferReply({ ephemeral: false });
  try {
    const r = await responderConIA(interaccion.user.id, texto);
    console.log(`[chat] /chat de ${interaccion.user.tag}: ${r.backend}/${r.modelo}`);
    const trozos = String(r.texto).match(/[\s\S]{1,1900}/g) || [r.texto];
    for (const trozo of trozos) {
      await interaccion.followUp(trozo);
      await new Promise((x) => setTimeout(x, 250));
    }
  } catch (e) {
    console.error(`[chat] /chat fallo: ${e.message}`);
    await interaccion.editReply(
      "Ahora mismo no puedo responder (se acabo la cuota o la IA no responde). Intentalo en un momento."
    );
  }
}

/** Muestra lo que el bot sabe responder (las reglas cargadas). */
async function cmdSaber(interaccion) {
  const reglas = cliente.conocimiento.cargar();
  if (!reglas.length) {
    return await respuestaEphemeral(interaccion, {
      content: `Todavia no hay reglas cargadas (\`${cfg.conocimientoFile}\`).`,
    });
  }
  const texto = reglas
    .map((r) => `**${r.id || r.pregunta || "regla"}**${r.exacto ? " _(exacta)_" : ""}: ${r.respuesta}`)
    .join("\n\n");
  await respuestaEphemeral(interaccion, {
    content: `**Lo que se de saber** (de \`${cfg.conocimientoFile}\`):\n\n${texto}`,
  });
}

async function cmdInstrucciones(interaccion) {
  const texto = cliente.instrucciones.actual();
  await respuestaEphemeral(interaccion, {
    content: `**Instrucciones actuales** (de \`${cfg.chat.instrucciones}\`):\n\n${texto}`,
  });
}

async function cmdIa(interaccion) {
  const emb = new EmbedBuilder()
    .setColor(0x9b30ff)
    .setTitle("IA del chat")
    .addFields(
      { name: "Backends (en orden)", value: (cliente.iaCfg.orden || []).join(", ") || "-", inline: true },
      { name: "Chat en DM", value: cfg.chat.habilitado ? cfg.chat.en_dm : "desactivado", inline: true },
      { name: "En canales", value: cfg.chat.en_canales, inline: true },
      { name: "Disparador", value: cfg.chat.disparador || "!" },
      { name: "Memoria", value: `${cfg.chat.maximo_historial} mensajes por usuario` }
    );
  await respuestaEphemeral(interaccion, { embeds: [emb] });
}

async function cmdOlvidar(interaccion) {
  const n = cliente.historial.olvidar(interaccion.user.id);
  await respuestaEphemeral(interaccion, `Memoria borrada (${n} mensajes).`);
}

async function cmdEstado(interaccion) {
  const embed = new EmbedBuilder()
    .setColor(0x9b30ff)
    .setTitle("R34pete")
    .addFields(
      { name: "Tableros", value: proveedores.disponibles(cfg).join(", ") || "ninguno" },
      { name: "Feeds", value: String(cliente.feeds.feeds.size) },
      { name: "Canal NSFW exigido", value: cfg.guards.requireNsfwChannel ? "si" : "no" },
      { name: "Rol de edad", value: cfg.guards.ageRole || "no" },
      { name: "Servidor", value: interaccion.guild?.name || "DM" }
    );
  return respuestaEphemeral(interaccion, { embeds: [embed] });
}

async function cmdAyuda(interaccion) {
  const embed = new EmbedBuilder()
    .setColor(0x9b30ff)
    .setTitle("R34pete — ayuda")
    .setDescription(
      "Bot de contenido de adultos: busca imagenes y animaciones por etiquetas y publica feeds automaticos.\n" +
        "Solo funciona en canales con **Restriccion de edad** activada."
    )
    .addFields(
      {
        name: "/buscar",
        value:
          "`furry` `futa` `gif` `videos` `canine` `feline` `dragon`…\n" +
          "Las palabras sueltas se traducen solas: **furry**→`anthro`, **gif**→animado en .gif, " +
          "**videos**→animado en .webm/.mp4 (Discord lo reproduce). Se pueden combinar: `furry videos`.",
      },
      {
        name: "/feed anadir",
        value: "Crea un feed automatico en un canal (permiso de gestionar canales).",
      },
      { name: "/feed listar", value: "Muestra los feeds." },
      { name: "/feed borrar", value: "Borra un feed por id." },
      { name: "/estado", value: "Resumen." }
    );
  return respuestaEphemeral(interaccion, { embeds: [embed] });
}

// -------------------------------------------------------------------- arranque
cliente.on("error", (e) => console.error("Error del cliente:", e));
process.on("unhandledRejection", (e) => console.error("Promesa sin capturar:", e));
process.on("SIGTERM", () => {
  cliente.feeds.pararTodos();
  cliente.destroy();
  process.exit(0);
});

if (require.main === module) {
  cliente.login(cfg.token).catch((e) => {
    console.error(`No se pudo iniciar sesión en Discord: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { cliente, manejarChat, revisarPendientes, cfg };
