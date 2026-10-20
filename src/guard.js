"use strict";

/**
 * Guardas del bot.
 *
 * 1. Solo publica en canales con "Restriccion de edad" activada (Discord lo
 *    exige para contenido maduro).
 * 2. Rol de edad opcional ("18+").
 * 3. Lista negra incondicional: menores y material no consentido se rechazan
 *    siempre, en cualquier servidor, sin excepcion.
 */

/** Peticiones que implican menores: rechazo incondicional. */
const LISTA_NEGRA = [
  "loli",
  "lolicon",
  "lolicon",
  "shota",
  "shotacon",
  "toddler",
  "toddlercon",
  "underage",
  "menor de edad",
  "menores",
  "preteen",
  "child porn",
  "childporn",
  "csam",
  "pedophile",
  "pedófilo",
  "pedofila",
];

/** Material no consentido o sobre personas reales. */
const LISTA_NCII = [
  "deepfake de",
  "nude de celebridad",
  "revenge porn",
  "porno de la vedette",
  "nudes reales",
];

/** Etiquetas que ni el bot ni los tableros deben usar. */
const ETIQUETAS_VEDADAS = ["loli", "lolicon", "shota", "shotacon", "toddler", "underage"];

class Rechazado extends Error {}

/** Normaliza la entrada del usuario a una cadena de etiquetas. */
function normalizarTags(entrada) {
  return String(entrada || "")
    .replace(/[,\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lanza Rechazado si el texto pide algo prohibido. */
function revisarTexto(texto) {
  const t = String(texto || "").toLowerCase();
  if (!t) return;
  if (LISTA_NEGRA.some((p) => t.includes(p))) {
    throw new Rechazado(
      "Ese contenido no lo hago: va contra la ley y contra las reglas del servidor."
    );
  }
  if (LISTA_NCII.some((p) => t.includes(p))) {
    throw new Rechazado(
      "No publico material no consentido ni imitaciones de personas reales."
    );
  }
}

/** Revisa las etiquetas una por una (para feeds y busquedas). */
function revisarTags(tags) {
  const lista = normalizarTags(tags).toLowerCase().split(" ");
  for (const etiqueta of lista) {
    if (ETIQUETAS_VEDADAS.includes(etiqueta)) {
      throw new Rechazado(
        "Ese contenido no lo hago: va contra la ley y contra las reglas del servidor."
      );
    }
  }
}

/** true si el canal tiene la restriccion de edad activada. */
function canalEsNsfw(canal) {
  if (!canal) return false;
  if (typeof canal.nsfw === "boolean") return canal.nsfw;
  return false;
}

/** true si el miembro cumple el rol de edad configurado. */
function tieneRolEdad(miembro, rolEdad) {
  if (!rolEdad) return true;
  if (!miembro || !miembro.roles) return false;
  return miembro.roles.cache.some(
    (r) => r.name.toLowerCase() === String(rolEdad).toLowerCase() || r.id === String(rolEdad)
  );
}

/** Devuelve el motivo del rechazo, o null si puede continuar. */
function comprobarCanal(interaccion, guards) {
  if (guards.requireNsfwChannel && !canalEsNsfw(interaccion.channel)) {
    return (
      "Este canal no tiene la **restriccion de edad** activada. Activala en " +
      "*Ajustes del canal → Restriccion de edad* o usa otro canal."
    );
  }
  if (!tieneRolEdad(interaccion.member, guards.ageRole)) {
    return "Necesitas el rol de edad para usar este bot aqui.";
  }
  return null;
}

module.exports = {
  LISTA_NEGRA,
  LISTA_NCII,
  ETIQUETAS_VEDADAS,
  Rechazado,
  revisarTexto,
  revisarTags,
  normalizarTags,
  canalEsNsfw,
  tieneRolEdad,
  comprobarCanal,
};
