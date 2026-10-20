"use strict";

/**
 * Registra los comandos de barra en un servidor, sin levantar el bot.
 * Util cuando los comandos no aparecen (o tardan) en un servidor concreto.
 *
 *   DISCORD_TOKEN=... node src/register.js [guildId]
 */

const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const { cargar } = require("./config");

const cfg = cargar();
const guildId = process.argv[2] || cfg.guildId;

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
    .addSubcommand((s) => s.setName("listar").setDescription("Muestra los feeds."))
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
          o.setName("id").setDescription("Id del feed.").setRequired(true)
        )
    ),
  new SlashCommandBuilder().setName("estado").setDescription("Resumen del bot."),
  new SlashCommandBuilder().setName("ayuda").setDescription("Como se usa el bot."),
];

(async () => {
  const rest = new REST({ version: "10" }).setToken(cfg.token);
  const cuerpo = COMANDOS.map((c) => c.toJSON());
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.applicationId || process.env.DISCORD_APP_ID, guildId), { body: cuerpo });
    console.log(`Comandos registrados en el servidor ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(cfg.applicationId || process.env.DISCORD_APP_ID), { body: cuerpo });
    console.log("Comandos registrados globalmente");
  }
})();
