"use strict";

/**
 * Registra los comandos de barra en un servidor, sin levantar el bot.
 * Util cuando los comandos no aparecen (o tardan) en un servidor concreto.
 *
 *   DISCORD_TOKEN=... node src/register.js [guildId]
 */

const { REST, Routes } = require("discord.js");
const { COMANDOS } = require("./comandos");
const { cargar } = require("./config");

const cfg = cargar();
const guildId = process.argv[2] || cfg.guildId;

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
