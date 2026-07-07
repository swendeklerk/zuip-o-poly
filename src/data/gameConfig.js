// Spelstanden: de spelstarter kiest er één bij het aanmaken van de spelkamer.
export const GAME_MODES = [
  {
    id: "gezellig",
    label: "Gezellig",
    turns: 15,
    tagline: "Korter en beter uit te houden. Actief en competitief, zonder marathon."
  },
  {
    id: "fanatiek",
    label: "Fanatiek",
    turns: 20,
    isDefault: true,
    tagline: "De standaard. Genoeg beurten voor opdrachten, kaarten en sabotage."
  },
  {
    id: "legendarisch",
    label: "Legendarisch",
    turns: 25,
    tagline: "De volledige Zuip-O-Poly-ervaring. Maximale ruimte voor chaos."
  }
];

export const DEFAULT_MODE_ID = "fanatiek";

export function findGameMode(modeId) {
  return GAME_MODES.find((mode) => mode.id === modeId) ?? GAME_MODES.find((mode) => mode.isDefault);
}

// Teamkleuren die teams bij het joinen kunnen kiezen.
export const TEAM_COLORS = [
  { id: "geel", name: "Geel", hex: "#FFD600" },
  { id: "paars", name: "Paars", hex: "#C800FF" },
  { id: "ijsblauw", name: "IJsblauw", hex: "#00D4FF" },
  { id: "groen", name: "Groen", hex: "#00D464" },
  { id: "oranje", name: "Oranje", hex: "#FF7A00" },
  { id: "roze", name: "Roze", hex: "#FF3D9A" },
  { id: "wit", name: "Wit", hex: "#F0EEF4" },
  { id: "blauw", name: "Blauw", hex: "#2979FF" }
];

export function findTeamColor(colorId) {
  return TEAM_COLORS.find((color) => color.id === colorId) ?? TEAM_COLORS[0];
}

export const GAME_CONFIG = {
  countdownSeconds: 10,
  startTileId: 1,
  boardSize: 40,
  minTeams: 1,
  maxTeams: 8,
  skipPenaltySteps: 2,
  jailWaitSeconds: 4 * 60,
  swapWaitSeconds: 3 * 60,
  attackWaitSeconds: 3 * 60,
  roomCodeLength: 5
};

// Minimumtimers per opdrachtsoort (seconden). Refresh reset een timer nooit:
// timers zijn gebaseerd op een opgeslagen absolute starttijd.
export const TASK_TIMERS = {
  short: 30,
  bar: 75,
  location: 180,
  snack: 120,
  none: 0
};

export const TEAM_RULES = [
  "Gooi met 1 dobbelsteen. De app verplaatst jullie automatisch.",
  "Voer de opdracht van het vak uit.",
  "Bevestig zelf zodra de opdracht gedaan is.",
  "Skippen mag altijd, maar kost 2 vakjes achteruit.",
  "Andere teams dwarszitten mag. Sterker nog: het moet.",
  "Beurten op? Dan zijn jullie gefinisht. De app bepaalt de winnaar."
];
