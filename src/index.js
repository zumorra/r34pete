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
const { Historial } = require("./historial");
const ia = require("./ia");
const { GestorFeeds } = require("./feed");
const guard = require("./guard");

const cfg = cargar();
const cliente = new Client({
  // Sin intents privilegiados: el bot no lee mensajes ni necesita la lista
  // de miembros (el chequeo de rol se pide a la API cuando hace falta).
  // Asi el bot no necesita revision de intents al pasar de 10.000 usuarios.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});
cliente.cfg = cfg;
cliente.feeds = new GestorFeeds(cliente);
// Registro de lo ya publicado, en disco: evita repetir entre reinicios.
cliente.vistos = new Vistos(cfg.vistosFile);
// Chat automatico: instrucciones (fichero, recarga en caliente), memoria de
// conversacion y configuracion de IA.
cliente.instrucciones = new Instrucciones(cfg.chat.instrucciones);
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

  try {
    await mensaje.channel.sendTyping().catch(() => {});
    const historial = cliente.historial.ultimos(mensaje.author.id);
    const mensajes = [
      { role: "system", content: cliente.instrucciones.actual() },
      ...historial,
      { role: "user", content: texto },
    ];
    const r = await ia.responder(cliente.iaCfg, mensajes);
    cliente.historial.anadir(mensaje.author.id, "user", texto);
    cliente.historial.anadir(mensaje.author.id, "assistant", r.texto);
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
    if (interaccion.commandName === "ia") return await cmdIa(interaccion);
    if (interaccion.commandName === "olvidar") return await cmdOlvidar(interaccion);
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
    const feed = cliente.feeds.crear({
      canalId: canal.id,
      proveedor: fuente,
      tags,
      medio,
      cadaMinutos: minutos,
      activado: true,
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

module.exports = { cliente, manejarChat, cfg };
