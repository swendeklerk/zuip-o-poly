const STREET_COLORS = {
  brown: "#8b5a2b",
  lightBlue: "#77d9ff",
  pink: "#ef52d1",
  orange: "#ff9f32",
  red: "#f13b4a",
  yellow: "#f4d64f",
  green: "#3ed46f",
  darkBlue: "#325dff"
};

const STREET_THEME_BY_TILE_ID = {
  2: STREET_COLORS.brown,
  4: STREET_COLORS.brown,
  7: STREET_COLORS.lightBlue,
  9: STREET_COLORS.lightBlue,
  10: STREET_COLORS.lightBlue,
  12: STREET_COLORS.pink,
  14: STREET_COLORS.pink,
  15: STREET_COLORS.pink,
  17: STREET_COLORS.orange,
  19: STREET_COLORS.orange,
  20: STREET_COLORS.orange,
  22: STREET_COLORS.red,
  24: STREET_COLORS.red,
  25: STREET_COLORS.red,
  27: STREET_COLORS.yellow,
  28: STREET_COLORS.yellow,
  30: STREET_COLORS.yellow,
  32: STREET_COLORS.green,
  33: STREET_COLORS.green,
  35: STREET_COLORS.green,
  38: STREET_COLORS.darkBlue,
  40: STREET_COLORS.darkBlue
};

export function getTileTheme(tile) {
  const type = tile.type.toLowerCase();

  if (STREET_THEME_BY_TILE_ID[tile.id]) {
    return {
      color: STREET_THEME_BY_TILE_ID[tile.id],
      className: "theme-street",
      label: shortLabel(tile.name)
    };
  }

  if (type.includes("snack") || type.includes("wissel")) {
    return {
      color: "#f6f1e8",
      className: "theme-station",
      label: type.includes("wissel") ? "Wissel" : "Snack"
    };
  }

  if (type.includes("kans")) {
    return {
      color: "#ff56d8",
      className: "theme-chance",
      label: "Kans"
    };
  }

  if (type.includes("algemeen")) {
    return {
      color: "#54dfff",
      className: "theme-fund",
      label: "Fonds"
    };
  }

  if (type.includes("belasting") || type.includes("straf")) {
    return {
      color: "#ff3048",
      className: "theme-tax",
      label: "Tax"
    };
  }

  if (type.includes("cel")) {
    return {
      color: "#f4bf45",
      className: "theme-jail",
      label: tile.id === 31 ? "Cel!" : "Cel"
    };
  }

  if (type.includes("start")) {
    return {
      color: "#f4bf45",
      className: "theme-start",
      label: "Start"
    };
  }

  if (type.includes("parkeer")) {
    return {
      color: "#53ffa1",
      className: "theme-park",
      label: "Vrij"
    };
  }

  if (type.includes("speciaal")) {
    return {
      color: "#ffffff",
      className: "theme-special",
      label: shortLabel(tile.name)
    };
  }

  return {
    color: "#e8e1d3",
    className: "theme-default",
    label: shortLabel(tile.name)
  };
}

function shortLabel(name) {
  const clean = name.replace(/^De\s+/i, "");
  const words = clean.split(/\s+/);
  return words[0].slice(0, 7);
}
