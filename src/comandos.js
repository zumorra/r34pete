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
    .setName("enviar")
    .setDescription("Manda un borrador preparado por la IA a tu bandeja de Discord.")
    .addStringOption((o) =>
      o.setName("id").setDescription("Id del borrador (miralos con /borradores).").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("borradores")
    .setDescription("Lista los borradores que esperan que los mandes."),

  new SlashCommandBuilder()
    .setName("saber")
    .setDescription("Muestra lo que el bot sabe responder (reglas cargadas)."),

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
            .setDescription("Cada cuantos minutos publica (minimo 1).")
            .setMinValue(1)
            .setMaxValue(10080)
        )
        .addStringOption((o) =>
          o
            .setName("perfil")
            .setDescription("Que publica en cada tirada (largo, medio, corto, extraCorto o cualquiera).")
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("borrar")
        .setDescription("Borra un feed por su id.")
        .addStringOption((o) => o.setName("id").setDescription("Id del feed.").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("spice")
    .setDescription("Guia para parejas: recetas, consejos, juegos y planes para subir la temperatura.")
    .addSubcommand((s) => s.setName("idea").setDescription("Una idea al azar: receta, consejo o juego."))
    .addSubcommand((s) =>
      s.setName("receta").setDescription("Una receta para cocinar los dos.").addStringOption((o) =>
        o
          .setName("con")
          .setDescription("Filtra por ingrediente (chocolate, picante, mar...).")
          .setRequired(false)
      )
    )
    .addSubcommand((s) => s.setName("consejo").setDescription("Un consejo para la noche."))
    .addSubcommand((s) => s.setName("juego").setDescription("Un juego para dos."))
    .addSubcommand((s) =>
      s
        .setName("plan")
        .setDescription("Un plan completo con horario.")
        .addIntegerOption((o) =>
          o
            .setName("minutos")
            .setDescription("Cuantos minutos dura el plan.")
            .setMinValue(5)
            .setMaxValue(600)
            .setRequired(false)
        )
    )
    .addSubcommand((s) =>
      s
        .setName("nivel")
        .setDescription("Muestra o cambia el nivel de picante (1 suave - 5 fuego).")
        .addIntegerOption((o) =>
          o
            .setName("nivel")
            .setDescription("1 suave, 2, 3, 4, 5 fuego.")
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(false)
        )
    )
    .addSubcommand((s) => s.setName("lista").setDescription("Que hay en la guia.")),

  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Escribe al bot y te contesta (sirve en privado).")
    .addStringOption((o) =>
      o.setName("mensaje").setDescription("Lo que quieres que te diga.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("instrucciones")
    .setDescription("Muestra las instrucciones que sigue el bot para responder."),
  new SlashCommandBuilder()
    .setName("ia")
    .setDescription("Estado de la IA que responde por privado."),
  new SlashCommandBuilder()
    .setName("olvidar")
    .setDescription("Borra la memoria de conversacion de este chat."),
  new SlashCommandBuilder().setName("estado").setDescription("Resumen del bot."),
  new SlashCommandBuilder().setName("ayuda").setDescription("Como se usa el bot."),
];

module.exports = { COMANDOS, FUENTES, MEDIOS };
