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
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const { cargar, rutaPorDefecto } = require("./config");
const proveedores = require("./providers");
const { GestorFeeds } = require("./feed");
const guard = require("./guard");

const cfg = cargar();
const cliente = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
cliente.cfg = cfg;
cliente.feeds = new GestorFeeds(cliente);

const COOLDOWNS = new Map();

// ------------------------------------------------------------------ comandos
const COMANDOS = [
  new SlashCommandBuilder()
    .setName("buscar")
    .setDescription("Busca por etiquetas y postea un resultado al azar.")
    .addStringOption((o) =>
      o.setName("tags").setDescription("Etiquetas separadas por espacios.").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("fuente")
        .setDescription("Tablero donde buscar.")
        .setRequired(false)
        .addChoices(
          { name: "rule34", value: "rule34" },
          { name: "e621", value: "e621" },
          { name: "danbooru", value: "danbooru" },
          { name: "gelbooru", value: "gelbooru" }
        )
    ),

  new SlashCommandBuilder()
    .setName("feed")
    .setDescription("Feeds automaticos por canal.")
    .addSubcommand((s) =>
      s
        .setName("listar")
        .setDescription("Muestra los feeds configurados.")
    )
    .addSubcommand((s) =>
      s
        .setName("anadir")
        .setDescription("Crea un feed automatico en un canal.")
        .addChannelOption((o) =>
          o.setName("canal").setDescription("Canal con restriccion de edad.").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("tags").setDescription("Etiquetas del feed.").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("fuente")
            .setDescription("Tablero.")
            .setRequired(false)
            .addChoices(
              { name: "rule34", value: "rule34" },
              { name: "e621", value: "e621" },
              { name: "danbooru", value: "danbooru" },
              { name: "gelbooru", value: "gelbooru" }
            )
        )
        .addIntegerOption((o) =>
          o
            .setName("minutos")
            .setDescription("Cada cuantos minutos publica (minimo 5).")
            .setMinValue(5)
            .setMaxValue(10080)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("borrar")
        .setDescription("Borra un feed por su id.")
        .addStringOption((o) =>
          o.setName("id").setDescription("Id del feed (lo da /feed listar).").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("estado")
    .setDescription("Resumen del bot."),

  new SlashCommandBuilder()
    .setName("ayuda")
    .setDescription("Como se usa el bot."),
];

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

/** Guarda los feeds en el fichero de configuracion (si se puede escribir). */
function guardarFeeds() {
  const ruta = rutaPorDefecto();
  try {
    const actual = fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, "utf8")) : {};
    actual.feeds = cliente.feeds.aJSON();
    fs.writeFileSync(ruta, JSON.stringify(actual, null, 2));
    console.log(`Feeds guardados en ${ruta}`);
  } catch (e) {
    console.warn(`No se pudieron guardar los feeds: ${e.message}`);
  }
}

// ------------------------------------------------------------------ handlers
cliente.once("ready", async () => {
  console.log(`R34pete conectado como ${cliente.user.tag}`);
  cliente.feeds.cargarDesdeConfig(cfg);
  await registrarComandos();
});

cliente.on("interactionCreate", async (interaccion) => {
  if (!interaccion.isChatInputCommand()) return;

  try {
    if (interaccion.commandName === "buscar") return await cmdBuscar(interaccion);
    if (interaccion.commandName === "feed") return await cmdFeed(interaccion);
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
  const motivo = guard.comprobarCanal(interaccion, cfg.guards);
  if (motivo) return respuestaEphemeral(interaccion, motivo);

  const fuente = interaccion.options.getString("fuente") || "e621";
  const tags = guard.normalizarTags(interaccion.options.getString("tags"));
  try {
    guard.revisarTexto(tags);
  } catch (e) {
    return respuestaEphemeral(interaccion, e.message);
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
    const resultados = await proveedores.buscar(
      cfg,
      fuente,
      tags,
      cfg.guards.maxResults || 40
    );
    if (!resultados.length) {
      return await interaccion.editReply("No encontre nada con esas etiquetas.");
    }
    const elegido = resultados[Math.floor(Math.random() * resultados.length)];
    const { buffer } = await proveedores.descargar(elegido.url, cfg.userAgent);
    const embed = new EmbedBuilder()
      .setColor(0x9b30ff)
      .setTitle("Resultado")
      .addFields(
        { name: "Tablero", value: elegido.source, inline: true },
        { name: "id", value: elegido.id || "-", inline: true }
      );
    if (elegido.tags) embed.addFields({ name: "Etiquetas", value: elegido.tags.slice(0, 1000) });
    if (elegido.pageUrl) embed.setURL(elegido.pageUrl);
    await interaccion.editReply({
      embeds: [embed],
      files: [{ attachment: buffer, name: "r34pete.jpg" }],
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
    const tags = guard.normalizarTags(interaccion.options.getString("tags"));
    try {
      guard.revisarTexto(tags);
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
      cadaMinutos: minutos,
      activado: true,
    });
    guardarFeeds();
    return respuestaEphemeral(
      interaccion,
      `Feed **${feed.id}** creado en <#${canal.id}>: cada ${minutos} min, ${fuente}, \`${tags}\`.`
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
      "Bot de contenido de adultos: busca imagenes por etiquetas y publica feeds automaticos.\n" +
        "Solo funciona en canales con **Restriccion de edad** activada."
    )
    .addFields(
      { name: "/buscar", value: "Busca por etiquetas y postea un resultado." },
      { name: "/feed anadir", value: "Crea un feed automatico en un canal (permiso de gestionar canales)." },
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

cliente.login(cfg.token).catch((e) => {
  console.error(`No se pudo iniciar sesión en Discord: ${e.message}`);
  process.exit(1);
});
