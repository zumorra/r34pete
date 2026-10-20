"use strict";

/**
 * Definición de los comandos de barra, compartida por el bot (src/index.js)
 * y por el script de registro (src/register.js) para que no se separen.
 */

const { SlashCommandBuilder } = require("discord.js");

const FUENTES = [
  { name: "rule34", value: "rule34" },
  { name: "e621", value: "e621" },
  { name: "danbooru", value: "danbooru" },
  { name: "gelbooru", value: "gelbooru" },
];

const MEDIOS = [
  { name: "Imagen", value: "imagen" },
  { name: "GIF", value: "gif" },
  { name: "Video", value: "video" },
];

const COMANDOS = [
  new SlashCommandBuilder()
    .setName("buscar")
    .setDescription("Busca por etiquetas y postea un resultado al azar.")
    .addStringOption((o) =>
      o
        .setName("tags")
        .setDescription("Etiquetas o palabras clave (furry, futa, gif, videos…).")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("fuente")
        .setDescription("Tablero donde buscar.")
        .setRequired(false)
        .addChoices(FUENTES)
    )
    .addStringOption((o) =>
      o
        .setName("medio")
        .setDescription("Qué tipo de archivo quieres (las palabras del texto también valen).")
        .setRequired(false)
        .addChoices(MEDIOS)
    ),

  new SlashCommandBuilder()
    .setName("feed")
    .setDescription("Feeds automaticos por canal.")
    .addSubcommand((s) => s.setName("listar").setDescription("Muestra los feeds configurados."))
    .addSubcommand((s) =>
      s
        .setName("anadir")
        .setDescription("Crea un feed automatico en un canal.")
        .addChannelOption((o) =>
          o.setName("canal").setDescription("Canal con restriccion de edad.").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("tags").setDescription("Etiquetas del feed (furry, futa, gif, videos…).").setRequired(true)
        )
        .addStringOption((o) =>
          o
            .setName("fuente")
            .setDescription("Tablero.")
            .setRequired(false)
            .addChoices(FUENTES)
        )
        .addStringOption((o) =>
          o
            .setName("medio")
            .setDescription("Tipo de archivo del feed.")
            .setRequired(false)
            .addChoices(MEDIOS)
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
        .addStringOption((o) => o.setName("id").setDescription("Id del feed.").setRequired(true))
    ),

  new SlashCommandBuilder().setName("estado").setDescription("Resumen del bot."),
  new SlashCommandBuilder().setName("ayuda").setDescription("Como se usa el bot."),
];

module.exports = { COMANDOS, FUENTES, MEDIOS };
