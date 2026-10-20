"use strict";

/**
 * Mini-idioma de búsqueda: palabras sueltas que se traducen a etiquetas y
 * al tipo de archivo que se quiere.
 *
 *   /buscar furry            -> e621, etiqueta "anthro"
 *   /buscar futa             -> e621, etiqueta "futa"
 *   /buscar gif              -> contenido animado en .gif
 *   /buscar videos           -> contenido animado en .webm/.mp4 (Discord lo
 *                               reproduce como vídeo)
 *   /buscar furry videos     -> las dos cosas a la vez
 *
 * Las palabras que no estén en la tabla se usan tal cual como etiqueta
 * (estilo danbooru).
 */

const PALABRAS = {
  // anthro / furry: en e621 no existe "furry" (lo anthro es "anthro"); en
  // rule34 sí existe "furry", así que allí se usa tal cual.
  furry: { tags: ["furry"], e621: { tags: ["anthro"] } },
  anthro: { tags: ["anthro"] },
  anthropo: { tags: ["anthro"] },
  antropomorfo: { tags: ["anthro"] },
  // especies
  canine: { tags: ["canine"] },
  canino: { tags: ["canine"] },
  perro: { tags: ["canine"] },
  felino: { tags: ["feline"] },
  felina: { tags: ["feline"] },
  gato: { tags: ["feline"] },
  fox: { tags: ["fox"] },
  zorro: { tags: ["fox"] },
  lobo: { tags: ["wolf"] },
  lobo: { tags: ["wolf"] },
  dragon: { tags: ["dragon"] },
  cuadrupedo: { tags: ["quadruped"] },
  // categorias
  futa: { tags: ["futa"] },
  // formato
  gif: { tags: ["animated"], medio: "gif" },
  gifs: { tags: ["animated"], medio: "gif" },
  gifv: { tags: ["animated"], medio: "gif" },
  animado: { tags: ["animated"], medio: "gif" },
  animada: { tags: ["animated"], medio: "gif" },
  video: { tags: ["animated"], medio: "video" },
  videos: { tags: ["animated"], medio: "video" },
  imagen: { medio: "imagen" },
  imagenes: { medio: "imagen" },
};

/**
 * Interpreta lo que el usuario ha escrito.
 * @param {string} entrada texto libre ("furry videos")
 * @param {string|null} medioOpcion medio elegido en la opción del comando
 * @param {string|null} proveedor tablero: cambia según el tablero (e621 no
 *        tiene etiqueta "furry", rule34 sí)
 * @returns {{tags: string, medio: string, traducciones: string[]}}
 */
function interpretar(entrada, medioOpcion = null, proveedor = null) {
  const palabras = String(entrada || "")
    .replace(/[,\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const tags = [];
  const traducciones = [];
  let medio = null; // el que gana es el que viene en el texto

  for (const palabra of palabras) {
    const base = PALABRAS[palabra.toLowerCase()];
    const def =
      base && proveedor && base[proveedor] ? { ...base, ...base[proveedor] } : base;
    if (def) {
      if (def.tags) {
        tags.push(...def.tags);
        traducciones.push(`${palabra} → ${def.tags.join(" ")}`);
      }
      if (def.medio) {
        medio = def.medio;
        traducciones.push(`${palabra} → ${def.medio}`);
      }
    } else {
      tags.push(palabra);
    }
  }

  return {
    tags: tags.join(" "),
    medio: medio || medioOpcion || "imagen",
    traducciones,
  };
}

module.exports = { interpretar, PALABRAS };
