// Illustratie per vak (assets/tiles/<naam>.png). Vakken zonder illustratie
// (kroegen, snack- en wisselstations) tonen alleen hun kleurrand of NS-logo.
const IMAGE_BY_NAME = {
  start: [1],
  "algemeen-fonds": [3, 18, 34],
  kans: [8, 23, 37],
  drankspelbelasting: [5],
  waterleiding: [13],
  elektriciteit: [29],
  zuipbelasting: [39],
  "vrij-parkeren": [21],
  "in-de-cel": [11],
  "ga-naar-de-cel": [31]
};

export const TILE_IMAGES = Object.fromEntries(
  Object.entries(IMAGE_BY_NAME).flatMap(([name, tileIds]) =>
    tileIds.map((tileId) => [tileId, `./assets/tiles/${name}.png`])
  )
);

export function getTileImage(tileId) {
  return TILE_IMAGES[tileId] ?? null;
}
