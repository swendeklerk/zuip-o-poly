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

// Turbo-testmodus: alle timers ~15x korter om het hele spel snel te doorlopen.
// Aan via ?turbo=1 (blijft onthouden), uit via ?turbo=0 of de knop op het startscherm.
const TURBO_KEY = "zuipopoly.turbo";

function readTurbo() {
  try {
    const param = new URLSearchParams(window.location.search).get("turbo");
    if (param === "1" || param === "0") {
      window.localStorage.setItem(TURBO_KEY, param);
    }
    return window.localStorage.getItem(TURBO_KEY) === "1";
  } catch {
    return false;
  }
}

export const TURBO = readTurbo();

export function setTurbo(on) {
  window.localStorage.setItem(TURBO_KEY, on ? "1" : "0");
}

const timerSeconds = (seconds) =>
  TURBO && seconds > 0 ? Math.max(3, Math.round(seconds / 15)) : seconds;

export const GAME_CONFIG = {
  countdownSeconds: timerSeconds(10),
  startTileId: 1,
  boardSize: 40,
  minTeams: 1,
  maxTeams: 4,
  skipPenaltySteps: 2,
  jailWaitSeconds: timerSeconds(7 * 60),
  swapWaitSeconds: timerSeconds(3 * 60),
  attackWaitSeconds: timerSeconds(3 * 60),
  roomCodeLength: 6 // 32^6 = ~1 miljard codes: niet te raden/enumereren (5 tekens: 33 miljoen)
};

// Minimumtimers per opdrachtsoort (seconden). Refresh reset een timer nooit:
// timers zijn gebaseerd op een opgeslagen absolute starttijd.
export const TASK_TIMERS = {
  short: timerSeconds(30),
  bar: timerSeconds(75),
  location: timerSeconds(180),
  snack: timerSeconds(120),
  none: 0
};

export const TEAM_RULES = [
  "Jullie spelen een kroegentocht door Nijmegen. Bijna elk vakje op het bord is een echte kroeg of plek in de stad, en die moeten jullie ook echt bezoeken.",
  "Gooi met 1 dobbelsteen. De app verplaatst jullie automatisch over het bord.",
  "Staat jullie pion op een kroeg of plek? Loop er met het hele team naartoe en voer daar de opdracht uit.",
  "Is de opdracht gedaan? Bevestig het in de app. Speelt er een spelleider mee, stuur dan een foto of filmpje als bewijs en wacht op goedkeuring.",
  "Kans, Algemeen Fonds en Wisselstations zijn kaarten en acties die je kunnen helpen, of juist dwarszitten. Power-ups bewaar je tot het juiste moment.",
  "Skippen mag altijd, maar kost 2 vakjes achteruit.",
  "Andere teams dwarszitten mag. Sterker nog: het moet.",
  "Beurten op? Dan zijn jullie gefinisht. De app bepaalt de winnaar."
];
