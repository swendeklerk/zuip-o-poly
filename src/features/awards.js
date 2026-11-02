import { TEAM_COLORS, findGameMode } from "../data/gameConfig.js";
import { getRanking } from "../store/gameStore.js";
import { STATUS_META } from "../data/statuses.js";

// Awards, achievements & kroegstats.
// Leest alleen de spelstaat (nooit schrijven) en bewaart eigen tellers in
// localStorage via ctx.store. Alle UI zit in ctx.root, behalve de sectie
// 'De Kroegprijzen' die in het eindscherm (.screen-ended) wordt geplaatst.

const MAX_SEEN = 200;
const FACE_KEYS = [1, 2, 3, 4, 5, 6];

const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const num = (v) => (Number.isFinite(v) ? v : 0);
const fmtAvg = (n) => n.toFixed(1).replace(".", ",");

function fmtDuration(ms) {
  const minutes = Math.floor(num(ms) / 60000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}u ${String(minutes % 60).padStart(2, "0")}m`;
}

function fmtClock(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const hexOfColor = (colorId) => TEAM_COLORS.find((c) => c.id === colorId)?.hex ?? "#F0EEF4";

/* ------------------------------------------------------------------ */
/* Tellers per team                                                    */
/* ------------------------------------------------------------------ */

function emptyTeamStats() {
  return {
    rolls: 0,
    rollSum: 0,
    faces: [0, 0, 0, 0, 0, 0],
    sixes: 0,
    ones: 0,
    sixStreak: 0,
    bestSixStreak: 0,
    bonusRolls: 0,
    night: 0,
    jail: 0,
    freed: 0,
    hitsGiven: 0,
    hitsTaken: 0,
    handouts: 0,
    handoutsGot: 0,
    swaps: 0,
    swapped: 0,
    unos: 0,
    shares: 0,
    tasks: 0,
    skips: 0,
    powerSkips: 0,
    blocked: 0,
    chance: 0,
    fund: 0,
    station: 0,
    steps: 0,
    lastMoveAt: 0,
    puIds: [],
    puEarned: 0,
    maxPu: 0,
    hitPopupOn: false
  };
}

function ensureTeamStats(stats, teamId) {
  const base = emptyTeamStats();
  let s = stats.teams[teamId];
  if (!isObj(s)) {
    s = base;
  } else {
    for (const key of Object.keys(base)) {
      if (typeof s[key] !== typeof base[key]) s[key] = base[key];
    }
    if (!Array.isArray(s.faces) || s.faces.length !== 6) s.faces = base.faces;
    if (!Array.isArray(s.puIds)) s.puIds = [];
  }
  stats.teams[teamId] = s;
  return s;
}

function readTeamStats(stats, teamId) {
  const s = stats?.teams?.[teamId];
  if (!isObj(s)) return emptyTeamStats();
  const merged = { ...emptyTeamStats(), ...s };
  if (!Array.isArray(merged.faces) || merged.faces.length !== 6) merged.faces = [0, 0, 0, 0, 0, 0];
  return merged;
}

function sanitizeStats(raw, createdAt) {
  const base = { v: 1, createdAt, seen: [], teams: {}, earned: {} };
  if (!isObj(raw) || raw.createdAt !== createdAt) return base;
  return {
    ...base,
    seen: Array.isArray(raw.seen) ? raw.seen.filter((k) => typeof k === "string").slice(-MAX_SEEN) : [],
    teams: isObj(raw.teams) ? raw.teams : {},
    earned: isObj(raw.earned) ? raw.earned : {}
  };
}

/* ------------------------------------------------------------------ */
/* eventLog-teksten ontleden (formaten uit gameStore.js logEvent)      */
/* ------------------------------------------------------------------ */

function parseEvent(text, teams) {
  if (typeof text !== "string") return null;
  for (const a of teams) {
    if (!text.startsWith(`${a.name} `)) continue;
    const rest = text.slice(a.name.length + 1);
    let m = /^heeft (\d) gegooid( \(bonusworp\))?\.$/.exec(rest);
    if (m) return { kind: "roll", actor: a.id, roll: Number(m[1]), bonus: Boolean(m[2]) };
    if (rest === "zit in de cel.") return { kind: "jail", actor: a.id };
    if (rest === "heeft een ronde voltooid.") return { kind: "round", actor: a.id };
    if (rest === "heeft een opdracht afgerond.") return { kind: "task", actor: a.id };
    if (rest === "heeft een opdracht overgeslagen met een power-up.") return { kind: "skippower", actor: a.id };
    if (rest.startsWith("heeft een opdracht geskipt")) return { kind: "skip", actor: a.id };
    if (rest === "blokkeerde een aanval met Geluksvogel.") return { kind: "blocked", actor: a.id };
    if (rest === "kocht zich vrij uit de cel.") return { kind: "freed", actor: a.id };
    for (const b of teams) {
      if (b.id === a.id) continue;
      const bn = b.name;
      if (rest === `deelt uit aan ${bn}.`) return { kind: "handout", actor: a.id, target: b.id };
      if (rest === `laat ${bn} wachten.`) return { kind: "wait", actor: a.id, target: b.id };
      if (rest === `wisselde van positie met ${bn}.`) return { kind: "swap", actor: a.id, target: b.id };
      if (rest === `gebruikte Wisseltruc op ${bn}.`) return { kind: "swap", actor: a.id, target: b.id };
      if (rest === `gebruikte Uno Reverse op ${bn}.`) return { kind: "uno", actor: a.id, target: b.id };
      if (rest === `deelt de opdracht met ${bn} (Zuipmaatjes).`) return { kind: "share", actor: a.id, target: b.id };
      if (rest.startsWith(`zet ${bn} `)) {
        m = /^(\d+) vakjes (vooruit|achteruit)\.$/.exec(rest.slice(5 + bn.length));
        if (m) return { kind: "move", actor: a.id, target: b.id, n: Number(m[1]), dir: m[2] };
      }
    }
  }
  return null;
}

function applyEvent(stats, ev, at) {
  const s = ensureTeamStats(stats, ev.actor);
  const t = ev.target ? ensureTeamStats(stats, ev.target) : null;
  switch (ev.kind) {
    case "roll": {
      s.rolls += 1;
      s.rollSum += ev.roll;
      if (ev.roll >= 1 && ev.roll <= 6) s.faces[ev.roll - 1] += 1;
      if (ev.roll === 6) {
        s.sixes += 1;
        s.sixStreak += 1;
        s.bestSixStreak = Math.max(s.bestSixStreak, s.sixStreak);
      } else {
        s.sixStreak = 0;
      }
      if (ev.roll === 1) s.ones += 1;
      if (ev.bonus) s.bonusRolls += 1;
      const hour = new Date(at).getHours();
      if (Number.isFinite(hour) && hour >= 0 && hour < 5) s.night += 1;
      break;
    }
    case "jail":
      s.jail += 1;
      break;
    case "freed":
      s.freed += 1;
      break;
    case "task":
      s.tasks += 1;
      break;
    case "skip":
      s.skips += 1;
      break;
    case "skippower":
      s.powerSkips += 1;
      break;
    case "blocked":
      s.blocked += 1;
      break;
    case "handout":
      s.handouts += 1;
      if (t) t.handoutsGot += 1;
      break;
    case "move":
    case "wait":
      s.hitsGiven += 1;
      if (t) t.hitsTaken += 1;
      break;
    case "swap":
      s.swaps += 1;
      s.hitsGiven += 1;
      if (t) {
        t.swapped += 1;
        t.hitsTaken += 1;
      }
      break;
    case "uno":
      s.unos += 1;
      s.hitsGiven += 1;
      if (t) t.hitsTaken += 1;
      break;
    case "share":
      s.shares += 1;
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const BADGES = [
  { id: "eerste_slok", icon: "🍺", name: "Eerste Slok", desc: "Je eerste beurt gegooid. De avond is begonnen.", test: (c) => c.s.rolls >= 1 || c.turns >= 1 },
  { id: "zesdaagse", icon: "🎲", name: "Zesdaagse", desc: "Drie keer een 6 gegooid. Je hebt een deal met de dobbelsteen.", test: (c) => c.s.sixes >= 3 },
  { id: "pechvogel", icon: "🐦", name: "Pechvogel", desc: "Drie keer een 1 gegooid. Gecondoleerd.", test: (c) => c.s.ones >= 3 },
  { id: "jailbird", icon: "🚨", name: "Jailbird", desc: "Voor het eerst in de cel beland. Welkom bij de club.", test: (c) => c.s.jail >= 1 },
  { id: "stamgast", icon: "🪑", name: "Stamgast", desc: "10 beurten gespeeld. De barman kent je naam.", test: (c) => c.turns >= 10 },
  { id: "wisselaar", icon: "🔄", name: "Wisselaar", desc: "Van plek gewisseld met een ander team. Ruilen is ook een sport.", test: (c) => c.s.swaps >= 1 },
  { id: "gevreesd", icon: "😈", name: "Gevreesd", desc: "Een ander team geraakt. Niets persoonlijks, het hoort bij het spel.", test: (c) => c.s.hitsGiven >= 1 },
  { id: "slachtoffer", icon: "🤕", name: "Slachtoffer", desc: "Zelf geraakt door een ander team. Dat zet je even met beide benen op de grond.", test: (c) => c.s.hitsTaken >= 1 },
  { id: "rondje_nijmegen", icon: "🏁", name: "Rondje Nijmegen", desc: "Je eerste volledige ronde over het bord. Voeten nog heel?", test: (c) => c.rounds >= 1 },
  { id: "dubbele_cel", icon: "🔒", name: "Dubbele Cel", desc: "Twee keer in de cel gezeten. Slechte leerling.", test: (c) => c.s.jail >= 2 },
  { id: "kansspeler", icon: "🎰", name: "Kansspeler", desc: "Drie keer op een Kans-vak beland. Gokken zit in je bloed.", test: (c) => c.s.chance >= 3 },
  { id: "fondsmanager", icon: "💼", name: "Fondsmanager", desc: "Drie keer Algemeen Fonds getrokken. De bank kent je op de voornaam.", test: (c) => c.s.fund >= 3 },
  { id: "rondjesbaas", icon: "🍻", name: "Rondjesbaas", desc: "Een biertje uitgedeeld aan een ander team. Echte gentleman.", test: (c) => c.s.handouts >= 1 },
  { id: "geluksvogel", icon: "🍀", name: "Geluksvogel", desc: "Een aanval geblokkeerd met je schild. Nee, dank je.", test: (c) => c.s.blocked >= 1 },
  { id: "hamsteraar", icon: "🎒", name: "Hamsteraar", desc: "Drie power-ups tegelijk in je zak. Sparen voor erger.", test: (c) => c.s.maxPu >= 3 },
  { id: "vrijkoper", icon: "🗝️", name: "Vrijkoper", desc: "Jezelf vrijgekocht uit de cel. Geld regeert.", test: (c) => c.s.freed >= 1 },
  { id: "lafbek", icon: "🐔", name: "Lafbek", desc: "Een opdracht geskipt. Twee vakjes terug, eer ook.", test: (c) => c.s.skips >= 1 },
  { id: "vrijbrief", icon: "🎫", name: "Vrijbrief", desc: "Een opdracht overgeslagen met een power-up. Slim gespeeld.", test: (c) => c.s.powerSkips >= 1 },
  { id: "klusjesman", icon: "🛠️", name: "Klusjesman", desc: "Vijf opdrachten afgerond. Handen uit de mouwen.", test: (c) => c.s.tasks >= 5 },
  { id: "opdrachtmeester", icon: "🎖️", name: "Opdrachtmeester", desc: "Tien opdrachten afgerond. Waar is je bonus?", test: (c) => c.s.tasks >= 10 },
  { id: "dubbele_zes", icon: "🎯", name: "Dubbele Zes", desc: "Twee keer achter elkaar een 6. Verdacht.", test: (c) => c.s.bestSixStreak >= 2 },
  { id: "zesmaster", icon: "🤹", name: "Zesmaster", desc: "Zes keer een 6 gegooid. Die dobbelsteen eet uit je hand.", test: (c) => c.s.sixes >= 6 },
  { id: "schrikbewind", icon: "👹", name: "Schrikbewind", desc: "Drie keer andere teams geraakt. De hele kroeg trilt.", test: (c) => c.s.hitsGiven >= 3 },
  { id: "stootkussen", icon: "🥊", name: "Stootkussen", desc: "Drie keer zelf geraakt. Je blijft overeind, dat is knap.", test: (c) => c.s.hitsTaken >= 3 },
  { id: "marathonloper", icon: "👟", name: "Marathonloper", desc: "100 vakjes afgelegd. Je schoenen willen een weekend vrij.", test: (c) => c.s.steps >= 100 },
  { id: "bonusbier", icon: "🎁", name: "Bonusbier", desc: "Een bonusworp gegooid. Gratis is gratis.", test: (c) => c.s.bonusRolls >= 1 },
  { id: "uno_reverser", icon: "🔁", name: "Uno Reverser", desc: "Uno Reverse gebruikt. Karma is prachtig.", test: (c) => c.s.unos >= 1 },
  { id: "zuipmaatje", icon: "🤝", name: "Zuipmaatje", desc: "Een opdracht gedeeld met een ander team. Samen uit, samen thuis.", test: (c) => c.s.shares >= 1 },
  { id: "nachtbraker", icon: "🌙", name: "Nachtbraker", desc: "Na middernacht nog gegooid. Slapen is voor later.", test: (c) => c.s.night >= 1 },
  { id: "rondjesmonster", icon: "🎡", name: "Rondjesmonster", desc: "Twee volledige rondes. Je kent elke stoeptegel.", test: (c) => c.rounds >= 2 },
  { id: "doorzetter", icon: "⏱️", name: "Doorzetter", desc: "Een uur lang gespeeld. De lever houdt zich sterk.", test: (c) => c.playMs >= 60 * 60 * 1000 },
  { id: "koploper", icon: "👑", name: "Koploper", desc: "Op de eerste plek in de tussenstand. Kijk maar achterom.", test: (c) => c.rank === 1 && c.count >= 2 && c.turns >= 5 },
  { id: "rode_lantaarn", icon: "🏮", name: "Rode Lantaarn", desc: "Laatste in de tussenstand. Het kan alleen maar beter.", test: (c) => c.rank === c.count && c.count >= 2 && c.turns >= 5 },
  { id: "finisher", icon: "🧾", name: "Finisher", desc: "Al je beurten opgemaakt. Jullie zijn er doorheen gekomen.", test: (c) => c.finished },
  { id: "podium", icon: "🥉", name: "Podium", desc: "Bij de top 3 geëindigd (met minstens vier teams).", test: (c) => c.ended && c.rank <= 3 && c.count >= 4 },
  { id: "kroegkoning", icon: "🏆", name: "Kroegkoning", desc: "Het spel gewonnen. Nijmegen ligt aan je voeten.", test: (c) => c.ended && c.rank === 1 && c.count >= 2 }
];

/* ------------------------------------------------------------------ */
/* Dagboek-teksten                                                     */
/* ------------------------------------------------------------------ */

const ROLL_LINES = {
  1: ["gooide een 1. De dobbelsteen lacht je uit.", "gooide een 1. Au, dat doet pijn."],
  2: ["gooide een 2. Een beetje sneu, maar het is wat.", "gooide een 2. Schuifelen maar."],
  3: ["gooide een 3. Gemiddelde Nijmegenaar.", "gooide een 3. Niet slecht, niet goed."],
  4: ["gooide een 4. Prima, prima.", "gooide een 4. Daar kunnen we mee leven."],
  5: ["gooide een 5. Bijna een 6, maar toch niet.", "gooide een 5. Net niet perfect."],
  6: ["gooide een 6! Ja hoor, weer.", "gooide een 6! Iemand is blij."]
};

function pickLine(list, seed) {
  return list[Math.abs(Math.floor(num(seed))) % list.length];
}

function diaryEntry(entry, teams, hexByName) {
  const text = String(entry?.text ?? "");
  const ev = parseEvent(text, teams);
  const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? "Iemand";
  const hexOf = (id) => hexByName.get(id) ?? "#F0EEF4";
  const seed = num(entry?.at);
  const b = (id) => `<b>${escHtml(nameOf(id))}</b>`;
  if (ev) {
    switch (ev.kind) {
      case "roll": {
        const lines = ROLL_LINES[ev.roll] ?? ROLL_LINES[3];
        const bonus = ev.bonus ? " (bonusworp, gratis)" : "";
        return { icon: "🎲", accent: hexOf(ev.actor), html: `${b(ev.actor)} ${escHtml(pickLine(lines, seed))}${bonus}` };
      }
      case "jail":
        return { icon: "🚨", accent: hexOf(ev.actor), html: `${b(ev.actor)} zit achter de tralies. De bak ruikt naar bier en spijt.` };
      case "round":
        return { icon: "🏁", accent: hexOf(ev.actor), html: `${b(ev.actor)} heeft een heel rondje Nijmegen overleefd.` };
      case "task":
        return { icon: "✅", accent: hexOf(ev.actor), html: `${b(ev.actor)} rondde een opdracht af. Applaus, vooral van de bar.` };
      case "skip":
        return { icon: "🐔", accent: hexOf(ev.actor), html: `${b(ev.actor)} durfde de opdracht niet en loopt twee vakjes terug.` };
      case "skippower":
        return { icon: "🎫", accent: hexOf(ev.actor), html: `${b(ev.actor)} zwaaide met een vrijbrief en liep de opdracht voorbij.` };
      case "blocked":
        return { icon: "🍀", accent: hexOf(ev.actor), html: `${b(ev.actor)} blokkeerde een aanval. Geluksvogel!` };
      case "freed":
        return { icon: "🗝️", accent: hexOf(ev.actor), html: `${b(ev.actor)} kocht zich vrij uit de cel. Geld regeert.` };
      case "handout":
        return { icon: "🍻", accent: hexOf(ev.actor), html: `${b(ev.actor)} trakteert ${b(ev.target)} op een rondje.` };
      case "move":
        return { icon: "👊", accent: hexOf(ev.actor), html: `${b(ev.actor)} schopt ${b(ev.target)} ${ev.n} vakjes ${escHtml(ev.dir)}.` };
      case "wait":
        return { icon: "⏳", accent: hexOf(ev.actor), html: `${b(ev.actor)} trekt ${b(ev.target)} uit de flow. Even wachten maar.` };
      case "swap":
        return { icon: "🔄", accent: hexOf(ev.actor), html: `${b(ev.actor)} ruilt van plek met ${b(ev.target)}. Wie zat daar ook alweer?` };
      case "uno":
        return { icon: "🔁", accent: hexOf(ev.actor), html: `${b(ev.actor)} draait ${b(ev.target)} om met Uno Reverse. Karma!` };
      case "share":
        return { icon: "🤝", accent: hexOf(ev.actor), html: `${b(ev.actor)} sleept ${b(ev.target)} mee in dezelfde opdracht. Zuipmaatjes!` };
      default:
        break;
    }
  }
  if (text.startsWith("Het spel is afgelopen")) return { icon: "🏆", accent: "", html: "Het spel is afgelopen. De eindstand staat vast en de kroeg sluit." };
  if (text.startsWith("Het spel start zo")) return { icon: "🔔", accent: "", html: "Het spel start. Laat de dobbelstenen maar rollen." };
  if (text.startsWith("Testmodus gestart")) return { icon: "🧪", accent: "", html: "Testmodus gestart. Alles mag, niemand kijkt." };
  if (text.endsWith("heeft de spelkamer aangemaakt.")) return { icon: "🚪", accent: "", html: `${escHtml(text.replace(" heeft de spelkamer aangemaakt.", ""))} opende de kroeg.` };
  if (text.endsWith(" doet mee.")) return { icon: "🙋", accent: "", html: `${escHtml(text.replace(" doet mee.", ""))} schuift aan de bar.` };
  return { icon: "📝", accent: "", html: escHtml(text) };
}

function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

export function init(ctx) {
  ctx.loadCss(new URL("./awards.css", import.meta.url));

  const root = ctx.root;
  const app = ctx.app;
  const badgeStore = ctx.store("badges", []);
  const PHASE = ctx.GAME_PHASE ?? { LOBBY: "lobby", ENDED: "ended" };
  const TS = ctx.TEAM_STATUS ?? {};

  let room = null; // { code, createdAt, store, stats, lastJson }
  let currentState = null;
  let overlayEl = null;
  let activeTab = "stats";
  let renderQueued = false;
  let refreshTimer = null;
  let unseen = false;
  let endedAnimated = false;

  /* ---------- stats verwerken ---------- */

  function loadRoom(state) {
    const createdAt = num(state.createdAt);
    if (room && room.code === state.roomCode && room.createdAt === createdAt) return;
    const store = ctx.store(`stats-${state.roomCode}`, null);
    room = { code: state.roomCode, createdAt, store, stats: sanitizeStats(store.get(), createdAt), lastJson: "" };
  }

  function teamList(state) {
    return Object.values(state.teams ?? {})
      .filter((t) => t && typeof t.name === "string")
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => b.name.length - a.name.length);
  }

  function processEvents(state, stats) {
    const log = Array.isArray(state.eventLog) ? state.eventLog : [];
    const seen = new Set(stats.seen);
    const fresh = log
      .filter((e) => e && typeof e.text === "string" && !seen.has(`${e.at}|${e.text}`))
      .sort((a, b) => num(a.at) - num(b.at));
    if (!fresh.length) return;
    const teams = teamList(state);
    for (const entry of fresh) {
      const ev = parseEvent(entry.text, teams);
      if (ev) applyEvent(stats, ev, entry.at);
      stats.seen.push(`${entry.at}|${entry.text}`);
    }
    if (stats.seen.length > MAX_SEEN) stats.seen = stats.seen.slice(-MAX_SEEN);
  }

  function processTeams(state, stats) {
    for (const team of Object.values(state.teams ?? {})) {
      if (!team?.id) continue;
      const s = ensureTeamStats(stats, team.id);

      const move = team.lastMove;
      if (isObj(move) && num(move.movedAt) > s.lastMoveAt) {
        s.lastMoveAt = move.movedAt;
        if (Number.isFinite(move.steps)) s.steps += Math.abs(move.steps);
        const type = ctx.findTileById?.(move.to)?.type;
        if (type === "Kans") s.chance += 1;
        else if (type === "Algemeen Fonds") s.fund += 1;
        else if (type === "Wisselstation") s.station += 1;
      }

      const powerUps = Array.isArray(team.savedPowerUps) ? team.savedPowerUps : [];
      for (const p of powerUps) {
        if (p?.id && !s.puIds.includes(p.id)) {
          s.puIds.push(p.id);
          s.puEarned += 1;
        }
      }
      if (s.puIds.length > 40) s.puIds = s.puIds.slice(-40);
      s.maxPu = Math.max(s.maxPu, powerUps.length);

      // Testmodus logt aanvallen niet: tel daar de 'geraakt'-popup (eenmaal per verschijning).
      if (state.isDemo) {
        const title = team.activePopup?.title;
        const on = title === "Jullie zijn geraakt" || title === "Jullie zijn gewisseld";
        if (on && !s.hitPopupOn) s.hitsTaken += 1;
        s.hitPopupOn = on;
      }
    }
  }

  function getPlayMs(state) {
    if (!state?.gameStartedAt) return 0;
    return Math.max((state.endedAt ?? Date.now()) - state.gameStartedAt, 0);
  }

  function badgeContext(state, team, s) {
    const ranking = getRanking(state);
    const idx = ranking.findIndex((r) => r.teamState.id === team.id);
    return {
      s,
      team,
      state,
      rank: idx + 1,
      count: ranking.length,
      turns: num(team.normalTurnsUsed),
      rounds: num(team.completedRounds),
      ended: state.phase === PHASE.ENDED,
      finished: [TS.FINISHED, TS.GAME_OVER].includes(team.status) || state.phase === PHASE.ENDED,
      playMs: getPlayMs(state)
    };
  }

  function globalBadgeIds() {
    const raw = badgeStore.get();
    return new Set(
      (Array.isArray(raw) ? raw : []).map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean)
    );
  }

  function addGlobalBadges(list, roomCode) {
    const raw = badgeStore.get();
    const arr = Array.isArray(raw) ? raw.slice() : [];
    const have = globalBadgeIds();
    for (const b of list) {
      if (!have.has(b.id)) arr.push({ id: b.id, at: Date.now(), room: roomCode });
    }
    badgeStore.set(arr);
  }

  function evaluateBadges(state, stats) {
    const team = ctx.myTeam();
    if (!team || state.phase === PHASE.LOBBY || !state.teams?.[team.id]) return;
    const s = ensureTeamStats(stats, team.id);
    const c = badgeContext(state, state.teams[team.id], s);
    const earned = new Set(Array.isArray(stats.earned[team.id]) ? stats.earned[team.id] : []);
    const gained = [];
    for (const badge of BADGES) {
      if (earned.has(badge.id)) continue;
      let ok = false;
      try {
        ok = Boolean(badge.test(c));
      } catch {
        ok = false;
      }
      if (ok) {
        earned.add(badge.id);
        gained.push(badge);
      }
    }
    if (gained.length) {
      stats.earned[team.id] = [...earned];
      addGlobalBadges(gained, state.roomCode);
      announce(gained);
    }
  }

  function onState(state) {
    try {
      if (!state?.roomCode || !isObj(state.teams)) {
        currentState = null;
        updateUi();
        return;
      }
      currentState = state;
      loadRoom(state);
      const stats = room.stats;
      for (const id of Object.keys(stats.teams)) {
        if (!state.teams[id]) delete stats.teams[id];
      }
      processEvents(state, stats);
      processTeams(state, stats);
      evaluateBadges(state, stats);
      const json = JSON.stringify(stats);
      if (json !== room.lastJson) {
        room.lastJson = json;
        room.store.set(stats);
      }
      updateUi();
      ensureEndedSection();
    } catch (error) {
      console.warn("[awards] state-verwerking mislukt:", error);
    }
  }

  /* ---------- badge-toast ---------- */

  const queue = [];
  let showing = false;

  function announce(list) {
    unseen = true;
    if (list.length > 3) {
      queue.push({ multi: list });
    } else {
      for (const b of list) queue.push({ b });
    }
    pumpToasts();
  }

  function pumpToasts() {
    if (showing || !queue.length) return;
    showing = true;
    const item = queue.shift();
    const el = document.createElement("button");
    el.type = "button";
    el.className = "aw-badge-toast";
    el.setAttribute("role", "status");
    if (item.multi) {
      el.innerHTML = `
        <span class="aw-bt-icon">🏅</span>
        <span class="aw-bt-text">
          <span class="aw-bt-eyebrow">${item.multi.length} nieuwe badges!</span>
          <span class="aw-bt-name">${item.multi.map((b) => b.icon).join(" ")}</span>
          <span class="aw-bt-desc">Tik om ze te bekijken.</span>
        </span>`;
    } else {
      el.innerHTML = `
        <span class="aw-bt-icon">${item.b.icon}</span>
        <span class="aw-bt-text">
          <span class="aw-bt-eyebrow">Nieuwe badge!</span>
          <span class="aw-bt-name">${escHtml(item.b.name)}</span>
          <span class="aw-bt-desc">${escHtml(item.b.desc)}</span>
        </span>`;
    }
    el.addEventListener("click", () => openOverlay("badges"));
    root.appendChild(el);
    try {
      ctx.feedback?.powerup?.();
    } catch {
      /* geluid is optioneel */
    }
    window.setTimeout(() => el.classList.add("is-leaving"), 3500);
    window.setTimeout(() => {
      el.remove();
      showing = false;
      pumpToasts();
    }, 3950);
    updateUi();
  }

  /* ---------- knop + overlay ---------- */

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "aw-open";
  openBtn.setAttribute("aria-label", "Open kroegstats");
  openBtn.innerHTML = '<span aria-hidden="true">📊</span><i class="aw-open-dot" aria-hidden="true"></i>';
  openBtn.hidden = true;
  root.appendChild(openBtn);

  function updateUi() {
    const team = ctx.myTeam();
    const visible = Boolean(currentState && team && currentState.phase !== PHASE.LOBBY);
    openBtn.hidden = !visible;
    openBtn.classList.toggle("has-new", unseen);
    openBtn.classList.toggle("is-covered", Boolean(app?.querySelector(".popup-overlay")));
    if (!visible && overlayEl) closeOverlay();
    if (overlayEl) scheduleRender();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      renderOverlay();
    });
  }

  function openOverlay(tab) {
    if (tab && ["stats", "badges", "stand", "dagboek"].includes(tab)) activeTab = tab;
    unseen = false;
    openBtn.classList.remove("has-new");
    if (!overlayEl) {
      overlayEl = document.createElement("div");
      overlayEl.className = "aw-overlay";
      overlayEl.setAttribute("role", "dialog");
      overlayEl.setAttribute("aria-modal", "true");
      overlayEl.setAttribute("aria-label", "Kroegstats");
      overlayEl.innerHTML = `
        <div class="aw-sheet">
          <header class="aw-head">
            <div class="aw-head-text">
              <p class="aw-eyebrow">Kroegstats</p>
              <h2 class="aw-title"></h2>
            </div>
            <button type="button" class="aw-close" aria-label="Sluiten">✕</button>
          </header>
          <nav class="aw-tabs" role="tablist">
            <button type="button" role="tab" data-aw-tab="stats">Stats</button>
            <button type="button" role="tab" data-aw-tab="badges">Badges</button>
            <button type="button" role="tab" data-aw-tab="stand">Stand</button>
            <button type="button" role="tab" data-aw-tab="dagboek">Dagboek</button>
          </nav>
          <div class="aw-body"></div>
        </div>`;
      root.appendChild(overlayEl);
      refreshTimer = window.setInterval(scheduleRender, 20000);
    }
    renderOverlay(true);
  }

  function closeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  openBtn.addEventListener("click", () => openOverlay());

  root.addEventListener("click", (event) => {
    if (!overlayEl) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === overlayEl || target.closest(".aw-close")) {
      closeOverlay();
      return;
    }
    const tabBtn = target.closest("[data-aw-tab]");
    if (tabBtn) {
      activeTab = tabBtn.getAttribute("data-aw-tab") || "stats";
      renderOverlay(true);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlayEl) closeOverlay();
  });

  /* ---------- tabs renderen ---------- */

  function myContext() {
    const state = currentState;
    const me = ctx.myTeam();
    if (!state || !me || !state.teams?.[me.id]) return null;
    const team = state.teams[me.id];
    const s = readTeamStats(room?.stats, team.id);
    return badgeContext(state, team, s);
  }

  function renderOverlay(resetScroll = false) {
    if (!overlayEl) return;
    try {
      const c = myContext();
      const body = overlayEl.querySelector(".aw-body");
      const title = overlayEl.querySelector(".aw-title");
      if (!c || !body) {
        closeOverlay();
        return;
      }
      const hex = hexOfColor(c.team.colorId);
      overlayEl.style.setProperty("--team-accent", hex);
      if (title) title.textContent = c.team.name;
      overlayEl.querySelectorAll("[data-aw-tab]").forEach((btn) => {
        const on = btn.getAttribute("data-aw-tab") === activeTab;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      const previousScroll = body.scrollTop;
      const html =
        activeTab === "badges"
          ? renderBadgesTab(c)
          : activeTab === "stand"
            ? renderStandTab(c)
            : activeTab === "dagboek"
              ? renderDiaryTab(c)
              : renderStatsTab(c);
      body.innerHTML = html;
      body.scrollTop = resetScroll ? 0 : previousScroll;
    } catch (error) {
      console.warn("[awards] overlay renderen mislukt:", error);
    }
  }

  function statCell(value, label) {
    return `<div class="aw-stat"><span class="aw-stat-v">${escHtml(value)}</span><span class="aw-stat-l">${escHtml(label)}</span></div>`;
  }

  function renderStatsTab(c) {
    const { s, team, state } = c;
    const maxTurns = findGameMode(state.modeId)?.turns ?? 20;
    const rolls = Math.max(s.rolls, c.turns);
    const avg = s.rolls ? fmtAvg(s.rollSum / s.rolls) : "–";
    const maxFace = Math.max(1, ...s.faces.map(num));
    const totalFaces = s.faces.reduce((a, n) => a + num(n), 0);
    const dist = FACE_KEYS.map((face, i) => {
      const n = num(s.faces[i]);
      const pct = n ? Math.max(8, Math.round((n / maxFace) * 100)) : 0;
      return `<div class="aw-dist-col"><span class="aw-dist-n">${n}</span><span class="aw-dist-track"><span class="aw-dist-bar" style="height:${pct}%"></span></span><span class="aw-dist-f">${face}</span></div>`;
    }).join("");
    const rankLine =
      c.count >= 2 && c.rank
        ? `Nu <b>#${c.rank}</b> van ${c.count} teams`
        : "Nog geen concurrentie in beeld";
    return `
      <p class="aw-rankline">${rankLine} · ${c.turns}/${maxTurns} beurten</p>
      <div class="aw-grid">
        ${statCell(rolls, "Worpen")}
        ${statCell(avg, "Gem. worp")}
        ${statCell(fmtDuration(c.playMs), "Speeltijd")}
        ${statCell(s.sixes, "Zessen")}
        ${statCell(s.ones, "Enen")}
        ${statCell(s.jail, "In de cel")}
        ${statCell(s.hitsTaken, "Geraakt")}
        ${statCell(s.hitsGiven, "Uitgedeeld")}
        ${statCell(s.handouts, "Rondjes gegeven")}
        ${statCell(s.steps, "Vakjes gelopen")}
        ${statCell(num(team.completedRounds), "Rondes")}
        ${statCell(s.tasks, "Opdrachten")}
        ${statCell(s.puEarned, "Power-ups")}
        ${statCell(s.chance + s.fund, "Kaarten")}
        ${statCell(s.skips + s.powerSkips, "Geskipt")}
      </div>
      <section class="aw-card">
        <h3 class="aw-h3">Worpverdeling</h3>
        ${totalFaces ? `<div class="aw-dist">${dist}</div>` : '<p class="aw-empty">Nog niets gegooid. De dobbelsteen staat te popelen.</p>'}
      </section>
      <p class="aw-foot">Tellers komen uit het spellogboek van dit toestel. Wie later aanschuift, mist het begin.</p>`;
  }

  function renderBadgesTab(c) {
    const have = globalBadgeIds();
    const thisGame = new Set(Array.isArray(room?.stats?.earned?.[c.team.id]) ? room.stats.earned[c.team.id] : []);
    for (const id of thisGame) have.add(id);
    const cells = BADGES.map((b) => {
      const got = have.has(b.id);
      const fresh = thisGame.has(b.id);
      return got
        ? `<li class="aw-badge ${fresh ? "is-fresh" : ""}"><span class="aw-badge-icon">${b.icon}</span><span class="aw-badge-name">${escHtml(b.name)}</span><span class="aw-badge-desc">${escHtml(b.desc)}</span>${fresh ? '<span class="aw-badge-tag">dit spel</span>' : ""}</li>`
        : `<li class="aw-badge is-locked"><span class="aw-badge-icon">🔒</span><span class="aw-badge-name">???</span><span class="aw-badge-desc">Nog niet ontdekt. Blijf spelen.</span></li>`;
    }).join("");
    const gotCount = BADGES.filter((b) => have.has(b.id)).length;
    return `
      <p class="aw-rankline"><b>${gotCount}</b> van ${BADGES.length} badges verzameld</p>
      <ul class="aw-badges">${cells}</ul>`;
  }

  function renderStandTab(c) {
    const ranking = getRanking(c.state);
    const maxTurns = findGameMode(c.state.modeId)?.turns ?? 20;
    const rows = ranking
      .map(({ teamState: t }, i) => {
        const meta = STATUS_META?.[t.status] ?? null;
        const mine = t.id === c.team.id;
        return `
          <li class="aw-row ${mine ? "is-own" : ""}" style="--team-accent:${hexOfColor(t.colorId)}">
            <span class="aw-row-place">${i + 1}</span>
            <span class="aw-row-dot"></span>
            <span class="aw-row-main">
              <span class="aw-row-name">${escHtml(t.name)}${mine ? " (jullie)" : ""}</span>
              <span class="aw-row-sub">${num(t.completedRounds)} rondes · vak ${num(t.position)} · ${num(t.normalTurnsUsed)}/${maxTurns} beurten</span>
            </span>
            <span class="aw-row-status dot-${escHtml(meta?.dot ?? "yellow")}">${escHtml(meta?.label ?? "")}</span>
          </li>`;
      })
      .join("");
    return `
      <p class="aw-rankline">Live tussenstand · meeste rondes, dan hoogste vak</p>
      <ol class="aw-rows">${rows}</ol>`;
  }

  function renderDiaryTab(c) {
    const log = (Array.isArray(c.state.eventLog) ? c.state.eventLog : []).filter((e) => e && typeof e.text === "string");
    const teams = teamList(c.state);
    const hexMap = new Map(Object.values(c.state.teams).map((t) => [t.id, hexOfColor(t.colorId)]));
    const last = log.slice(-30).reverse();
    if (!last.length) return '<p class="aw-empty">Het dagboek is nog leeg. Er is nog niets schandelijks gebeurd.</p>';
    const items = last
      .map((entry) => {
        const d = diaryEntry(entry, teams, hexMap);
        return `
          <li class="aw-diary-item" style="--team-accent:${d.accent || "var(--text-dim, #4a4858)"}">
            <span class="aw-diary-time">${fmtClock(entry.at)}</span>
            <span class="aw-diary-icon">${d.icon}</span>
            <span class="aw-diary-text">${d.html}</span>
          </li>`;
      })
      .join("");
    return `
      <p class="aw-rankline">Het Kroegdagboek · de laatste ${last.length} gebeurtenissen</p>
      <ol class="aw-diary">${items}</ol>`;
  }

  /* ---------- eindscherm: De Kroegprijzen ---------- */

  function teamRows(state) {
    return getRanking(state).map(({ teamState }) => ({
      team: teamState,
      s: readTeamStats(room?.stats, teamState.id)
    }));
  }

  function pickTop(rows, value, min) {
    let best = null;
    let bestV = -Infinity;
    for (const row of rows) {
      const v = value(row);
      if (Number.isFinite(v) && v >= min && v > bestV) {
        best = row;
        bestV = v;
      }
    }
    return best ? { row: best, value: bestV } : null;
  }

  function pickLow(rows, value, min) {
    let best = null;
    let bestV = Infinity;
    for (const row of rows) {
      const v = value(row);
      if (Number.isFinite(v) && v >= min && v < bestV) {
        best = row;
        bestV = v;
      }
    }
    return best ? { row: best, value: bestV } : null;
  }

  function buildAwards(state) {
    const rows = teamRows(state);
    const awards = [];
    if (!rows.length) return awards;
    const push = (icon, title, pick, caption) => {
      if (!pick) return;
      awards.push({ icon, title, team: pick.row.team, caption: caption(pick.value, pick.row) });
    };
    const winner = rows[0];
    awards.push({
      icon: "👑",
      title: "Kroegkoning",
      team: winner.team,
      caption: `${num(winner.team.completedRounds)} ${num(winner.team.completedRounds) === 1 ? "ronde" : "rondes"}, vak ${num(winner.team.position)}. De rest mag een rondje geven.`
    });
    push("💢", "Meest Gehaat", pickTop(rows, (r) => r.s.hitsTaken, 1), (v) => `${v}x geraakt. Iedereen wilde ze hebben.`);
    push("😈", "Kroegterreur", pickTop(rows, (r) => r.s.hitsGiven, 1), (v) => `${v}x uitgedeeld. Niemand was veilig.`);
    push("🐦", "Pechvogel van de Avond", pickTop(rows, (r) => r.s.ones, 2), (v) => `${v}x een 1. De dobbelsteen had een hekel aan ze.`);
    push("🍀", "Gelukspoppetje", pickTop(rows, (r) => r.s.sixes, 2), (v) => `${v}x een 6. Wie heeft hier gesjoemeld?`);
    push("🔒", "Cel-Koning", pickTop(rows, (r) => r.s.jail, 1), (v) => `${v}x achter de tralies. De bak is hun tweede huis.`);
    const fast = pickTop(rows, (r) => (r.s.rolls >= 3 ? r.s.rollSum / r.s.rolls : NaN), 0);
    push("👟", "Snelste Schoen", fast, (v) => `Gemiddeld ${fmtAvg(v)} per worp. Rennen met een volle blaas.`);
    const slow = pickLow(
      rows.filter((r) => r.team.id !== fast?.row.team.id),
      (r) => (r.s.rolls >= 3 ? r.s.rollSum / r.s.rolls : NaN),
      0
    );
    push("🐌", "Slakkengang", slow, (v) => `Gemiddeld ${fmtAvg(v)} per worp. Het was een wandeling, geen wedstrijd.`);
    push("🍻", "Rondjesbaas", pickTop(rows, (r) => r.s.handouts, 1), (v) => `${v}x getrakteerd. Zo iemand wil je aan de bar.`);
    push("🛠️", "Klusjesman", pickTop(rows, (r) => r.s.tasks, 3), (v) => `${v} opdrachten afgerond. Nergens te beroerd voor.`);
    push("🐔", "Lafste Team", pickTop(rows, (r) => r.s.skips + r.s.powerSkips, 1), (v) => `${v}x een opdracht ontweken. Kip.`);
    push("🔄", "Wisselkoning", pickTop(rows, (r) => r.s.swaps, 1), (v) => `${v}x van plek geruild. Wie zit er nu waar?`);
    if (rows.length >= 2) {
      const last = rows[rows.length - 1];
      awards.push({
        icon: "🥈",
        title: "Beste Verliezer",
        team: last.team,
        caption: "Laatste geworden, maar wel met de beste sfeer. De echte winnaar van de avond (volgens henzelf)."
      });
    }
    return awards;
  }

  function buildAwardsHtml(state) {
    const awards = buildAwards(state);
    const me = ctx.myTeam();
    const c = me && state.teams?.[me.id] ? badgeContext(state, state.teams[me.id], readTeamStats(room?.stats, me.id)) : null;
    const earnedIds = new Set(Array.isArray(room?.stats?.earned?.[me?.id]) ? room.stats.earned[me.id] : []);
    const myBadges = BADGES.filter((b) => earnedIds.has(b.id)).map((b) => `<span class="aw-chip" title="${escHtml(b.name)}">${b.icon}</span>`).join("");
    const list = awards
      .map(
        (a) => `
        <li class="aw-award" style="--team-accent:${hexOfColor(a.team.colorId)}">
          <span class="aw-award-icon">${a.icon}</span>
          <span class="aw-award-text">
            <span class="aw-award-title">${escHtml(a.title)}</span>
            <span class="aw-award-team">${escHtml(a.team.name)}</span>
            <span class="aw-award-cap">${escHtml(a.caption)}</span>
          </span>
        </li>`
      )
      .join("");
    return `
      <section class="panel aw-awards ${endedAnimated ? "" : "is-in"}" aria-label="De Kroegprijzen">
        <h2>De Kroegprijzen</h2>
        <p class="panel-sub">Uitgereikt door de jury (de barman, die niks zegt maar alles ziet).</p>
        <ul class="aw-award-list">${list}</ul>
        ${
          c
            ? `<div class="aw-mine"><p class="aw-mine-title">Jullie avond in badges · ${earnedIds.size}/${BADGES.length}</p><div class="aw-chips">${myBadges || '<span class="aw-empty">Nog geen badges. Volgende keer beter.</span>'}</div></div>`
            : ""
        }
        <button type="button" class="button gold aw-share">Deel jullie kroegverslag</button>
      </section>`;
  }

  function ensureEndedSection() {
    try {
      const screen = app?.querySelector(".screen-ended");
      if (!screen) {
        endedAnimated = false;
        return;
      }
      if (screen.querySelector(".aw-awards")) return;
      const state = ctx.getState();
      if (!state?.teams) return;
      if (!room || room.code !== state.roomCode) onState(state);
      const tpl = document.createElement("template");
      tpl.innerHTML = buildAwardsHtml(state).trim();
      const node = tpl.content.firstElementChild;
      if (!node) return;
      const anchor = screen.querySelector('[data-action="leave-room"]');
      if (anchor && anchor.parentNode === screen) screen.insertBefore(node, anchor);
      else screen.appendChild(node);
      endedAnimated = true;
    } catch (error) {
      console.warn("[awards] eindscherm-sectie mislukt:", error);
    }
  }

  if (app) {
    const observer = new MutationObserver(() => {
      ensureEndedSection();
      openBtn.classList.toggle("is-covered", Boolean(app.querySelector(".popup-overlay")));
    });
    observer.observe(app, { childList: true });

    app.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".aw-share")) shareReport();
    });
  }

  /* ---------- kroegverslag delen ---------- */

  function buildReport(state) {
    const rows = teamRows(state);
    const awards = buildAwards(state);
    const me = ctx.myTeam();
    const mine = me && state.teams?.[me.id] ? badgeContext(state, state.teams[me.id], readTeamStats(room?.stats, me.id)) : null;
    const lines = [];
    lines.push("🍻 ZUIP-O-POLY NIJMEGEN · KROEGVERSLAG");
    const w = rows[0]?.team;
    if (w) lines.push(`🏆 Winnaar: ${w.name} (${num(w.completedRounds)} ${num(w.completedRounds) === 1 ? "ronde" : "rondes"}, vak ${num(w.position)})`);
    lines.push("");
    lines.push("📊 Eindstand");
    const medals = ["🥇", "🥈", "🥉"];
    rows.forEach((r, i) => {
      lines.push(`${medals[i] ?? `${i + 1}.`} ${r.team.name} · ${num(r.team.completedRounds)} rondes · vak ${num(r.team.position)}`);
    });
    if (awards.length) {
      lines.push("");
      lines.push("🎖️ De Kroegprijzen");
      for (const a of awards) lines.push(`${a.icon} ${a.title}: ${a.team.name}`);
    }
    if (mine) {
      const s = mine.s;
      const avg = s.rolls ? fmtAvg(s.rollSum / s.rolls) : "–";
      const earned = new Set(Array.isArray(room?.stats?.earned?.[mine.team.id]) ? room.stats.earned[mine.team.id] : []);
      lines.push("");
      lines.push(`🧾 Onze avond (${mine.team.name})`);
      lines.push(`🎲 ${Math.max(s.rolls, mine.turns)} worpen · gem. ${avg} · ${s.sixes}x een 6 · ${s.ones}x een 1`);
      lines.push(`🚨 ${s.jail}x in de cel · 👊 ${s.hitsGiven}x uitgedeeld · 🤕 ${s.hitsTaken}x geraakt`);
      lines.push(`⏱️ Speeltijd ${fmtDuration(mine.playMs)}`);
      if (earned.size) lines.push(`🏅 Badges (${earned.size}/${BADGES.length}): ${BADGES.filter((b) => earned.has(b.id)).map((b) => b.icon).join("")}`);
    }
    lines.push("");
    lines.push("Proost, Nijmegen! 🐻🎩");
    return lines.join("\n");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* val terug op textarea */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  async function shareReport() {
    try {
      const state = ctx.getState();
      if (!state?.teams) return;
      const text = buildReport(state);
      if (navigator.share) {
        try {
          await navigator.share({ title: "Zuip-O-Poly Nijmegen · Kroegverslag", text });
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
      const ok = await copyText(text);
      ctx.toast(
        ok ? "📋 Kroegverslag gekopieerd. Plak het in de groepsapp!" : "Kopiëren lukte niet. Probeer een screenshot.",
        { ms: 3200 }
      );
    } catch (error) {
      console.warn("[awards] delen mislukt:", error);
    }
  }

  /* ---------- starten ---------- */

  window.zuipFx = window.zuipFx || {};
  window.zuipFx.showStats = (tab) => {
    if (!currentState) onState(ctx.getState());
    if (currentState) openOverlay(typeof tab === "string" ? tab : undefined);
  };
  window.zuipFx.testBadge = (id) => {
    const badge = BADGES.find((b) => b.id === id) ?? BADGES[0];
    announce([badge]);
  };

  ctx.subscribe(onState);
  ensureEndedSection();
}
