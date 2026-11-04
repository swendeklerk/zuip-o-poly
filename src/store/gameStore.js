import {
  DEFAULT_MODE_ID,
  findGameMode,
  findTeamColor,
  GAME_CONFIG,
  TASK_TIMERS,
  TEAM_COLORS
} from "../data/gameConfig.js";
import { CARD_DECKS, drawCard } from "../data/cards.js";
import { CAFE_VAN_OUDS_WHEEL_OPTIONS, DOCK17_DRINKS } from "../data/tileAssignments.js";
import { createTaskForTile } from "../data/tasks.js";
import { findTileById } from "../data/tiles.js";
import { sha256Hex } from "./sha256.js";
import { GAME_PHASE, TEAM_STATUS } from "../data/statuses.js";
import {
  loadRemoteGameState,
  saveRemoteGameState,
  subscribeRemoteGameState
} from "../services/remoteGameState.js";

const ROOM_KEY_PREFIX = "zuipopoly.v2.room.";
const SESSION_KEY = "zuipopoly.v2.session";
const listeners = new Set();
let remoteSyncReady = false;
let applyingRemoteState = false;
let remoteUnsubscribe = null;
let remotePollInterval = null;
let remoteFocusListenersReady = false;
let lastLocalSaveAt = 0;

// Gratis verrassing (power-up) na normale beurt 3 en 18, met een wisselende titel.
const GIFT_TITLES = [
  "Cadeautje van de beer",
  "Gratis van het huis",
  "De kroegbaas is gul",
  "Meevaller!",
  "Een knipoog van het bord",
  "Verrassing uit de tap",
  "Jullie hebben het verdiend",
  "De beer is trots op jullie"
];
const ANGEL_TURNS = [3, 18];
const ANGEL_POWER_UPS = [
  { type: "skip_task", label: "Opdracht overslaan", body: "Sla een opdracht over zonder straf. Daarna een bonusworp." },
  { type: "skip_free", label: "Gratis skip", body: "Skip één opdracht zonder de 2-vakjes-straf." },
  { type: "shield", label: "Geluksvogel", body: "Blokkeert automatisch de eerstvolgende Kans-, Fonds-, Wisselstation- of bonusactie van een ander team." },
  { type: "jail_free", label: "Celvrij", body: "Direct uit de echte cel, zonder wachttijd en strafopdracht." },
  { type: "uno_reverse", label: "Uno Reverse", body: "Wijs een ander team aan voor de wodka-Red Bull-opdracht." },
  { type: "share_task", label: "Zuipmaatjes", body: "Kies een team dat dezelfde opdracht met jullie mee moet doen." }
];

function now() {
  return Date.now();
}

function createId(prefix = "id") {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${now()}`;
}

// Roomcodes zonder verwarrende tekens (geen 0/O, 1/I).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomCode() {
  let code = "";
  const bytes = new Uint32Array(GAME_CONFIG.roomCodeLength);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    }
  }
  for (let i = 0; i < GAME_CONFIG.roomCodeLength; i += 1) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Sessie (dit toestel)                                                */
/* ------------------------------------------------------------------ */

export function getSession() {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    // Alleen de drie bekende velden, gevalideerd (geen willekeurige keys of typen).
    const roomCode = normalizeRoomCode(parsed?.roomCode);
    if (!ROOM_CODE_PATTERN.test(roomCode)) {
      return null;
    }
    // Spelleider-sessie: geen team, alleen de kamer en de rol.
    if (parsed?.role === "leader") {
      const savedCode = normalizeRoomCode(parsed?.leaderCode);
      return {
        roomCode,
        teamId: null,
        role: "leader",
        sessionId: cleanId(parsed?.sessionId, ""),
        leaderCode: LEADER_CODE_PATTERN.test(savedCode) ? savedCode : ""
      };
    }
    const teamId = cleanId(parsed?.teamId);
    if (!teamId) {
      return null;
    }
    return { roomCode, teamId, sessionId: cleanId(parsed?.sessionId, "") };
  } catch {
    return null;
  }
}

function setSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emit();
}

export function clearSession() {
  stopRemoteSync();
  window.localStorage.removeItem(SESSION_KEY);
  emit();
}

/* ------------------------------------------------------------------ */
/* State-opbouw                                                        */
/* ------------------------------------------------------------------ */

// Eén naam per teamlid; leeg betekent "Speler N" (zie playerNameOf).
function cleanPlayerNames(list, count) {
  const source = Array.isArray(list) ? list : [];
  return Array.from({ length: count }, (_, index) =>
    typeof source[index] === "string"
      ? source[index].replace(/[\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_PLAYER_NAME)
      : ""
  );
}

export function playerNameOf(team, index) {
  const name = team?.playerNames?.[index];
  return typeof name === "string" && name.trim() ? name.trim() : `Speler ${index + 1}`;
}

function createTeamState({ id, name, colorId, playerCount, playerNames }) {
  const count = Math.min(Math.max(Number(playerCount) || 1, 1), 8);
  return {
    id,
    name,
    colorId,
    playerCount: count,
    playerNames: cleanPlayerNames(playerNames, count),
    joinedAt: now(),
    activeSessionId: null,
    status: TEAM_STATUS.WAITING_START,
    position: GAME_CONFIG.startTileId,
    completedRounds: 0,
    positionReachedAt: now(),
    normalTurnsUsed: 0,
    pendingBonusRoll: false,
    lastRoll: null,
    lastMove: null,
    lastStreetTileId: null,
    currentTask: null,
    pendingTasks: [],
    activePopup: null,
    waitUntil: null,
    jailUntil: null,
    savedPowerUps: [],
    oncePerTeamCardIds: [],
    angelsGiven: [],
    finishedAt: null,
    // Spelleider-modus: bewijs verstuurd en wacht op goedkeuring / intro gezien.
    awaitingApproval: null,
    proofIntroAck: false,
    lastProofDecidedSentAt: 0,
    teamSyncRevision: 0,
    teamSyncUpdatedAt: 0
  };
}

function createRoomState({ roomCode, modeId, starterTeamId }) {
  return {
    version: 2,
    roomCode,
    modeId: findGameMode(modeId)?.id ?? DEFAULT_MODE_ID,
    starterTeamId,
    phase: GAME_PHASE.LOBBY,
    createdAt: now(),
    countdownStartedAt: null,
    gameStartedAt: null,
    endedAt: null,
    syncRevision: 0,
    syncUpdatedAt: 0,
    teams: {},
    eventLog: []
  };
}

/* ------------------------------------------------------------------ */
/* Validatie van niet-vertrouwde state (remote, localStorage)          */
/* ------------------------------------------------------------------ */
// State komt uit Supabase of localStorage en kan door een kwaadwillende
// speler zijn aangepast. Alles wat de UI later in HTML/attributen zet wordt
// hier begrensd en gewhitelist: ids, getallen, statussen, tekstlengtes.

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{3,12}$/;
const LEADER_CODE_PATTERN = /^[A-Z0-9]{5,8}$/;
const LEADER_CODE_LENGTH = 8;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

// De spelleiderscode zelf staat nooit in de spelstand, alleen deze hash (per kamer gezouten).
function leaderCodeHash(roomCode, leaderCode) {
  return sha256Hex(`zuipopoly:${roomCode}:${leaderCode}`);
}
const WORD_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_TEXT = 2000;
const MAX_NAME = 40;
const MAX_PLAYER_NAME = 20;
const MAX_DEPTH = 8;
const MAX_ARRAY = 100;
const MAX_KEYS = 80;
const MAX_TIMESTAMP = 4102444800000; // 1 jan 2100
const TEAM_STATUS_VALUES = new Set(Object.values(TEAM_STATUS));
const GAME_PHASE_VALUES = new Set(Object.values(GAME_PHASE));

// Diepe kopie zonder gevaarlijke keys, met begrensde diepte/lengte/aantallen.
// Gedraagt zich als een JSON-roundtrip: undefined/functies verdwijnen.
function sanitizeValue(value, depth = 0) {
  switch (typeof value) {
    case "string":
      return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
    case "number":
      return Number.isFinite(value) ? value : 0;
    case "boolean":
      return value;
    case "object":
      break;
    default:
      return undefined;
  }
  if (value === null) {
    return null;
  }
  if (depth >= MAX_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => {
      const clean = sanitizeValue(item, depth + 1);
      return clean === undefined ? null : clean;
    });
  }
  const out = {};
  let count = 0;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    const clean = sanitizeValue(value[key], depth + 1);
    if (clean === undefined) {
      continue;
    }
    count += 1;
    if (count > MAX_KEYS) {
      break;
    }
    out[key] = clean;
  }
  return out;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanInt(value, min, max, fallback) {
  const number = Number(value);
  if (value === null || value === "" || typeof value === "boolean" || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function cleanTimestamp(value, fallback = null) {
  const number = Number(value);
  if (value === null || value === undefined || typeof value === "boolean" || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(number), 0), MAX_TIMESTAMP);
}

function cleanText(value, max, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  // Stuurtekens (behalve tab en nieuwe regel) eruit; lengte begrenzen.
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").slice(0, max);
}

function cleanId(value, fallback = null) {
  return typeof value === "string" && ID_PATTERN.test(value) && !FORBIDDEN_KEYS.has(value)
    ? value
    : fallback;
}

function cleanWord(value, fallback = undefined) {
  return typeof value === "string" && WORD_PATTERN.test(value) ? value : fallback;
}

function cleanTeamName(value, fallback = "Team") {
  const name = cleanText(value, MAX_NAME).replace(/\s+/g, " ").trim();
  return name || fallback;
}

// Optionele velden: alleen aanpassen als ze er zijn (anders blijft de vorm gelijk).
function setIfPresent(target, key, cleaner) {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    const cleaned = cleaner(target[key]);
    if (cleaned === undefined) {
      delete target[key];
    } else {
      target[key] = cleaned;
    }
  }
}

function sanitizeChoiceList(list, extraCleaner) {
  if (!Array.isArray(list)) {
    return [];
  }
  const choices = [];
  list.slice(0, 8).forEach((item, index) => {
    if (!isPlainObject(item)) {
      return;
    }
    const choice = sanitizeValue(item);
    choice.id = cleanId(choice.id, `player_${index + 1}`);
    choice.name = cleanText(choice.name, MAX_NAME, `Speler ${index + 1}`);
    extraCleaner(choice);
    choices.push(choice);
  });
  return choices;
}

function sanitizeTask(input) {
  if (!isPlainObject(input)) {
    return null;
  }
  const task = sanitizeValue(input);
  setIfPresent(task, "title", (v) => cleanText(v, 160));
  setIfPresent(task, "body", (v) => cleanText(v, MAX_TEXT));
  setIfPresent(task, "popup", (v) => cleanText(v, MAX_TEXT));
  setIfPresent(task, "rules", (v) => cleanText(v, MAX_TEXT));
  setIfPresent(task, "tileName", (v) => cleanText(v, 80));
  setIfPresent(task, "location", (v) => cleanText(v, 120));
  setIfPresent(task, "notifyActorText", (v) => cleanText(v, MAX_TEXT));
  setIfPresent(task, "notifyTargetText", (v) => cleanText(v, MAX_TEXT));
  setIfPresent(task, "powerUpLabel", (v) => cleanText(v, 80));
  setIfPresent(task, "presentation", (v) => cleanWord(v));
  setIfPresent(task, "effectType", (v) => cleanWord(v));
  setIfPresent(task, "savedPowerUpType", (v) => cleanWord(v));
  setIfPresent(task, "cardId", (v) => cleanId(v));
  setIfPresent(task, "delta", (v) => cleanInt(v, -80, 80, 0));
  setIfPresent(task, "waitSeconds", (v) => (v === null ? null : cleanInt(v, 0, 7200, 0)));
  setIfPresent(task, "timerSeconds", (v) => cleanInt(v, 0, 3600, 0));
  setIfPresent(task, "startedAt", (v) => cleanTimestamp(v));
  setIfPresent(task, "pendingTileId", (v) => cleanInt(v, 1, GAME_CONFIG.boardSize, 1));
  setIfPresent(task, "skippable", (v) => Boolean(v));
  setIfPresent(task, "placeholder", (v) => Boolean(v));
  setIfPresent(task, "oncePerTeam", (v) => Boolean(v));
  setIfPresent(task, "dock17Revealed", (v) => Boolean(v));
  setIfPresent(task, "vanOudsComplete", (v) => Boolean(v));
  setIfPresent(task, "bonusPowerUp", (v) =>
    isPlainObject(v)
      ? { type: cleanWord(v.type, "unknown"), label: cleanText(v.label, 80, "Power-up") }
      : null
  );

  if (task.specialFlow !== "dock17" && task.specialFlow !== "vanOuds") {
    delete task.specialFlow;
  }
  if (task.specialFlow === "dock17") {
    task.dock17Choices = sanitizeChoiceList(task.dock17Choices, (choice) => {
      choice.number = choice.number === null ? null : cleanInt(choice.number, 1, 17, null);
      // Het drankje volgt altijd uit het getal (ook bij oude opgeslagen spellen).
      choice.drink = choice.number ? dock17DrinkFor(choice.number) : "";
    });
    // Oude opgeslagen spellen (select-flow): iedereen heeft al een getal maar de
    // onthulling ontbrak. Rond dat af, anders blijft de bevestigknop op slot.
    if (!task.dock17Revealed && task.dock17Choices.every((choice) => choice.number)) {
      task.dock17Revealed = true;
    }
  } else {
    delete task.dock17Choices;
  }
  if (task.specialFlow === "vanOuds") {
    task.vanOudsChoices = sanitizeChoiceList(task.vanOudsChoices, (choice) => {
      choice.result = cleanText(choice.result, 80);
      setIfPresent(choice, "resultIndex", (v) => cleanInt(v, 0, 99, 0));
    });
  } else {
    delete task.vanOudsChoices;
  }
  return task;
}

function sanitizePopup(input) {
  if (!isPlainObject(input)) {
    return null;
  }
  const popup = sanitizeValue(input);
  setIfPresent(popup, "title", (v) => cleanText(v, 160));
  setIfPresent(popup, "body", (v) => cleanText(v, MAX_TEXT));
  setIfPresent(popup, "blockedChoiceMessage", (v) => cleanText(v, 300));
  setIfPresent(popup, "cardId", (v) => cleanId(v));
  // kind belandt in een class-attribuut: alleen veilige woorden.
  setIfPresent(popup, "kind", (v) => cleanWord(v, "info"));
  setIfPresent(popup, "stage", (v) => (v === "intro" || v === "detail" ? v : "detail"));
  return popup;
}

function sanitizeLastMove(input) {
  if (!isPlainObject(input)) {
    return null;
  }
  const move = sanitizeValue(input);
  setIfPresent(move, "roll", (v) => (v === null ? null : cleanInt(v, 1, 6, null)));
  setIfPresent(move, "from", (v) => cleanInt(v, 1, GAME_CONFIG.boardSize, 1));
  setIfPresent(move, "to", (v) => cleanInt(v, 1, GAME_CONFIG.boardSize, 1));
  setIfPresent(move, "roundsGained", (v) => cleanInt(v, 0, 50, 0));
  setIfPresent(move, "crossedStart", (v) => Boolean(v));
  setIfPresent(move, "tileName", (v) => cleanText(v, 80));
  setIfPresent(move, "movedAt", (v) => cleanTimestamp(v, 0));
  setIfPresent(move, "source", (v) => cleanWord(v, "move"));
  setIfPresent(move, "steps", (v) => (v === null ? null : cleanInt(v, -80, 80, null)));
  return move;
}

function sanitizeSavedPowerUps(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const result = [];
  for (const item of list.slice(0, 30)) {
    if (!isPlainObject(item)) {
      continue;
    }
    const id = cleanId(item.id);
    const type = cleanWord(item.type);
    if (!id || !type) {
      continue;
    }
    const powerUp = sanitizeValue(item);
    powerUp.id = id;
    powerUp.type = type;
    powerUp.cardId = cleanId(item.cardId, "");
    powerUp.title = cleanText(item.title, 120);
    powerUp.label = cleanText(item.label, 80, powerUp.title);
    powerUp.body = cleanText(item.body, MAX_TEXT);
    result.push(powerUp);
  }
  return result;
}

function sanitizePendingTasks(list) {
  if (!Array.isArray(list)) {
    return [];
  }
  const result = [];
  for (const item of list.slice(0, 20)) {
    const task = sanitizeTask(item?.task);
    if (task) {
      result.push({ kind: cleanWord(item.kind, "task"), task });
    }
  }
  return result;
}

// Bewijs dat op goedkeuring van de spelleider wacht. taskStartedAt koppelt het
// bewijs aan precies deze opdracht (verdwijnt de opdracht, dan vervalt het ook).
function sanitizeAwaitingApproval(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const sentAt = cleanTimestamp(value.sentAt, null);
  if (!sentAt) {
    return null;
  }
  return {
    sentAt,
    taskStartedAt: cleanTimestamp(value.taskStartedAt, 0),
    withBonus: value.withBonus === true
  };
}

function normalizeTeam(input) {
  const raw = isPlainObject(input) ? input : {};
  const id = cleanId(raw.id) ?? createId("team");
  const base = createTeamState({
    id,
    name: cleanTeamName(raw.name),
    colorId: findTeamColor(raw.colorId).id,
    playerCount: raw.playerCount ?? 3
  });
  // Onbekende extra velden blijven (gesaneerd) bewaard; bekende velden worden
  // hieronder streng gevalideerd en overschreven.
  const team = { ...base, ...sanitizeValue(raw) };
  team.id = id;
  team.name = cleanTeamName(raw.name);
  team.colorId = findTeamColor(raw.colorId).id;
  team.playerCount = cleanInt(raw.playerCount, 1, 8, base.playerCount);
  team.playerNames = cleanPlayerNames(raw.playerNames, team.playerCount);
  team.joinedAt = cleanTimestamp(raw.joinedAt, base.joinedAt);
  team.activeSessionId = cleanId(raw.activeSessionId, null);
  team.status = TEAM_STATUS_VALUES.has(raw.status) ? raw.status : base.status;
  team.position = cleanInt(raw.position, 1, GAME_CONFIG.boardSize, base.position);
  team.completedRounds = cleanInt(raw.completedRounds, 0, 1000, 0);
  team.positionReachedAt = cleanTimestamp(raw.positionReachedAt, base.positionReachedAt);
  team.normalTurnsUsed = cleanInt(raw.normalTurnsUsed, 0, 1000, 0);
  team.pendingBonusRoll = Boolean(raw.pendingBonusRoll);
  team.lastRoll = cleanInt(raw.lastRoll, 1, 6, null);
  team.lastMove = sanitizeLastMove(raw.lastMove);
  team.lastStreetTileId = cleanInt(raw.lastStreetTileId, 1, GAME_CONFIG.boardSize, null);
  team.currentTask = sanitizeTask(raw.currentTask);
  team.pendingTasks = sanitizePendingTasks(raw.pendingTasks);
  team.activePopup = sanitizePopup(raw.activePopup);
  team.waitUntil = cleanTimestamp(raw.waitUntil, null);
  team.jailUntil = cleanTimestamp(raw.jailUntil, null);
  team.finishedAt = cleanTimestamp(raw.finishedAt, null);
  team.savedPowerUps = sanitizeSavedPowerUps(raw.savedPowerUps);
  team.oncePerTeamCardIds = Array.isArray(raw.oncePerTeamCardIds)
    ? raw.oncePerTeamCardIds.slice(0, 50).map((value) => cleanId(value)).filter(Boolean)
    : [];
  // Engeltje-momenten (beurtnummers) die al zijn uitgedeeld; alleen bekende momenten.
  // Een team uit een spel van vóór het engeltje (veld ontbreekt) krijgt de momenten die al
  // voorbij zijn niet alsnog; die gelden als al uitgedeeld.
  team.angelsGiven = Array.isArray(raw.angelsGiven)
    ? ANGEL_TURNS.filter((turn) => raw.angelsGiven.includes(turn))
    : ANGEL_TURNS.filter((turn) => team.normalTurnsUsed >= turn);
  // Spelleider-modus: bewijs onderweg (alleen bekende velden) en intro gezien.
  team.awaitingApproval = sanitizeAwaitingApproval(raw.awaitingApproval);
  team.proofIntroAck = raw.proofIntroAck === true;
  team.lastProofDecidedSentAt = cleanTimestamp(raw.lastProofDecidedSentAt, 0);
  team.teamSyncRevision = cleanInt(raw.teamSyncRevision, 0, 1e9, 0);
  team.teamSyncUpdatedAt = cleanTimestamp(raw.teamSyncUpdatedAt, 0);
  return team;
}

function normalizeState(input) {
  if (!isPlainObject(input)) {
    return null;
  }
  const roomCode = normalizeRoomCode(input.roomCode);
  if (!ROOM_CODE_PATTERN.test(roomCode)) {
    return null;
  }
  const state = createRoomState({
    roomCode,
    modeId: input.modeId,
    starterTeamId: cleanId(input.starterTeamId, null)
  });
  // Onbekende extra top-level velden blijven (gesaneerd) bewaard.
  for (const key of Object.keys(input)) {
    if (key === "teams" || key === "eventLog" || FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    const clean = sanitizeValue(input[key]);
    if (clean !== undefined) {
      state[key] = clean;
    }
  }
  state.roomCode = roomCode;
  state.version = 2;
  state.modeId = findGameMode(input.modeId)?.id ?? DEFAULT_MODE_ID;
  state.starterTeamId = cleanId(input.starterTeamId, null);
  state.phase = GAME_PHASE_VALUES.has(input.phase) ? input.phase : GAME_PHASE.LOBBY;
  state.createdAt = cleanTimestamp(input.createdAt, now());
  state.countdownStartedAt = cleanTimestamp(input.countdownStartedAt, null);
  state.gameStartedAt = cleanTimestamp(input.gameStartedAt, null);
  state.endedAt = cleanTimestamp(input.endedAt, null);
  state.syncRevision = cleanInt(input.syncRevision, 0, 1e9, 0);
  state.syncUpdatedAt = cleanTimestamp(input.syncUpdatedAt, 0);
  // Spelleider-modus: alleen een echte boolean en een code van 5 tekens.
  if (input.leaderMode === true) {
    state.leaderMode = true;
  } else {
    delete state.leaderMode;
  }
  // Alleen de hash blijft bewaard. Een oude kamer met een leesbare code wordt hier omgezet.
  const legacyCode = normalizeRoomCode(input.leaderCode);
  let codeHash = typeof input.leaderCodeHash === "string" && HEX64_PATTERN.test(input.leaderCodeHash)
    ? input.leaderCodeHash
    : "";
  if (!codeHash && LEADER_CODE_PATTERN.test(legacyCode)) {
    codeHash = leaderCodeHash(roomCode, legacyCode);
  }
  delete state.leaderCode;
  if (codeHash) {
    state.leaderCodeHash = codeHash;
  } else {
    delete state.leaderCodeHash;
  }
  // De testmodus (teleporteren, kaarten kiezen) bestaat alleen lokaal; een
  // remote of aangepaste state mag dit nooit voor een echte spelkamer aanzetten.
  if (input.isDemo === true && roomCode === DEMO_ROOM_CODE) {
    state.isDemo = true;
  } else {
    delete state.isDemo;
  }

  state.eventLog = Array.isArray(input.eventLog)
    ? input.eventLog
        .slice(-60)
        .filter(isPlainObject)
        .map((event) => ({
          at: cleanTimestamp(event.at, 0),
          text: cleanText(event.text, 300)
        }))
    : [];

  state.teams = {};
  const teamEntries = isPlainObject(input.teams) ? Object.entries(input.teams) : [];
  const validEntries = teamEntries.filter(
    ([teamId, teamState]) =>
      ID_PATTERN.test(teamId) &&
      !FORBIDDEN_KEYS.has(teamId) &&
      !/^\d+$/.test(teamId) &&
      isPlainObject(teamState)
  );
  // Meer dan het maximum aantal teams is nooit legitiem: houd de oudst gejoinde.
  const limited =
    validEntries.length > GAME_CONFIG.maxTeams
      ? [...validEntries]
          .sort((a, b) => (Number(a[1].joinedAt) || 0) - (Number(b[1].joinedAt) || 0))
          .slice(0, GAME_CONFIG.maxTeams)
      : validEntries;
  for (const [teamId, teamState] of limited) {
    state.teams[teamId] = normalizeTeam({ ...teamState, id: teamId });
  }
  return state;
}

function storageKey(roomCode) {
  return `${ROOM_KEY_PREFIX}${normalizeRoomCode(roomCode)}`;
}

export function getState() {
  const session = getSession();
  if (!session?.roomCode) {
    return null;
  }
  const raw = window.localStorage.getItem(storageKey(session.roomCode));
  if (!raw) {
    return null;
  }
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Opslaan + sync (refresh-proof: alles staat in de spelkamer-state)   */
/* ------------------------------------------------------------------ */

function getTeamComparableState(teamState) {
  const { teamSyncRevision, teamSyncUpdatedAt, ...comparable } = teamState;
  return comparable;
}

function didTeamChange(previousTeamState, nextTeamState) {
  return (
    JSON.stringify(getTeamComparableState(previousTeamState)) !==
    JSON.stringify(getTeamComparableState(nextTeamState))
  );
}

function prepareLocalStateForSave(state, previousState) {
  const previous = previousState ?? getState();
  const updatedAt = now();
  const teams = { ...state.teams };

  for (const [teamId, nextTeam] of Object.entries(teams)) {
    const previousTeam = previous?.teams?.[teamId];
    if (!previousTeam || didTeamChange(previousTeam, nextTeam)) {
      teams[teamId] = {
        ...nextTeam,
        teamSyncRevision: (previousTeam?.teamSyncRevision ?? 0) + 1,
        teamSyncUpdatedAt: updatedAt
      };
    }
  }

  return {
    ...state,
    teams,
    syncRevision: Math.max(state.syncRevision ?? 0, previous?.syncRevision ?? 0) + 1,
    syncUpdatedAt: updatedAt
  };
}

function saveState(state, previousState = null) {
  const normalizedState = normalizeState(state);
  if (!normalizedState) {
    return;
  }
  const prepared = applyingRemoteState
    ? normalizedState
    : prepareLocalStateForSave(normalizedState, previousState);
  window.localStorage.setItem(storageKey(prepared.roomCode), JSON.stringify(prepared));
  if (remoteSyncReady && !applyingRemoteState) {
    lastLocalSaveAt = now();
    saveRemoteGameState(prepared.roomCode, prepared);
  }
  emit();
}

function isRemoteGlobalNewer(remote, local) {
  if (remote.syncRevision !== local.syncRevision) {
    return remote.syncRevision > local.syncRevision;
  }
  return remote.syncUpdatedAt > local.syncUpdatedAt && now() - lastLocalSaveAt > 5000;
}

function isRemoteTeamNewer(remoteTeam, localTeam) {
  if (!localTeam) return true;
  if (!remoteTeam) return false;
  if (remoteTeam.teamSyncRevision !== localTeam.teamSyncRevision) {
    return remoteTeam.teamSyncRevision > localTeam.teamSyncRevision;
  }
  return remoteTeam.teamSyncUpdatedAt > localTeam.teamSyncUpdatedAt && now() - lastLocalSaveAt > 5000;
}

// Staat er aan de ene kant nog een bewijs te wachten (sentAt = S) terwijl de
// andere kant dat bewijs al heeft beslist (lastProofDecidedSentAt >= S)? Dan
// is de beslissende kant de enige juiste; anders null (gewone revisie-regel).
function pickProofDecision(remoteTeam, localTeam) {
  if (!remoteTeam || !localTeam) {
    return null;
  }
  const remoteWaiting = remoteTeam.awaitingApproval?.sentAt ?? 0;
  const localWaiting = localTeam.awaitingApproval?.sentAt ?? 0;
  if (remoteWaiting && (localTeam.lastProofDecidedSentAt ?? 0) >= remoteWaiting && !localWaiting) {
    return localTeam;
  }
  if (localWaiting && (remoteTeam.lastProofDecidedSentAt ?? 0) >= localWaiting && !remoteWaiting) {
    return remoteTeam;
  }
  return null;
}

function mergeRemoteState(remote, local) {
  if (!local) {
    return remote;
  }
  const useRemoteGlobal = isRemoteGlobalNewer(remote, local);
  const merged = {
    ...(useRemoteGlobal ? remote : local),
    syncRevision: Math.max(remote.syncRevision, local.syncRevision),
    syncUpdatedAt: Math.max(remote.syncUpdatedAt, local.syncUpdatedAt),
    teams: {}
  };
  const teamIds = new Set([...Object.keys(remote.teams), ...Object.keys(local.teams)]);
  for (const teamId of teamIds) {
    const remoteTeam = remote.teams[teamId];
    const localTeam = local.teams[teamId];
    // Een beslissing van de spelleider (goed- of afkeuren) wint altijd van een
    // gelijktijdige schrijfactie van het team die nog van het oude bewijs uitgaat,
    // ook als de teamrevisies gelijk of omgekeerd liggen.
    const decided = pickProofDecision(remoteTeam, localTeam);
    if (decided) {
      merged.teams[teamId] = decided;
      continue;
    }
    merged.teams[teamId] = isRemoteTeamNewer(remoteTeam, localTeam)
      ? remoteTeam ?? localTeam
      : localTeam ?? remoteTeam;
  }
  return normalizeState(merged);
}

function applyRemoteState(remoteState) {
  const remote = normalizeState(remoteState);
  const session = getSession();
  if (!remote || !session?.roomCode || normalizeRoomCode(remote.roomCode) !== normalizeRoomCode(session.roomCode)) {
    return false;
  }
  if (remote.roomCode === DEMO_ROOM_CODE) {
    return false;
  }

  const local = getState();
  const merged = mergeRemoteState(remote, local);
  const mergedMatchesRemote = JSON.stringify(merged) === JSON.stringify(remote);
  const mergedMatchesLocal = local && JSON.stringify(merged) === JSON.stringify(local);

  if (!mergedMatchesRemote && remoteSyncReady && !applyingRemoteState) {
    lastLocalSaveAt = now();
    saveRemoteGameState(merged.roomCode, merged);
  }

  if (mergedMatchesLocal) {
    return false;
  }

  applyingRemoteState = true;
  window.localStorage.setItem(storageKey(merged.roomCode), JSON.stringify(merged));
  applyingRemoteState = false;
  emit();
  return true;
}

async function pullRemoteState() {
  const session = getSession();
  if (!remoteSyncReady || applyingRemoteState || !session?.roomCode || now() - lastLocalSaveAt < 2000) {
    return;
  }
  const remoteState = await loadRemoteGameState(session.roomCode);
  if (remoteState) {
    applyRemoteState(remoteState);
  }
}

function startRemotePolling() {
  if (!remotePollInterval) {
    remotePollInterval = window.setInterval(() => {
      pullRemoteState();
    }, 2500);
  }
  if (remoteFocusListenersReady) {
    return;
  }
  window.addEventListener?.("focus", () => pullRemoteState());
  if (typeof document !== "undefined") {
    document.addEventListener?.("visibilitychange", () => {
      if (!document.hidden) {
        pullRemoteState();
      }
    });
  }
  remoteFocusListenersReady = true;
}

export async function initializeRemoteSync() {
  const session = getSession();
  if (!session?.roomCode) {
    return { ok: false, mode: "local" };
  }
  // Testmodus blijft volledig lokaal.
  if (getState()?.isDemo) {
    return { ok: false, mode: "local" };
  }
  if (remoteSyncReady) {
    return { ok: true, mode: "remote" };
  }

  const remoteState = await loadRemoteGameState(session.roomCode);
  if (remoteState) {
    applyRemoteState(remoteState);
  } else {
    const localState = getState();
    if (localState) {
      const didSave = await saveRemoteGameState(session.roomCode, localState);
      if (!didSave) {
        return { ok: false, mode: "local" };
      }
    }
  }

  remoteUnsubscribe = await subscribeRemoteGameState(session.roomCode, (state) => {
    applyRemoteState(state);
  });

  remoteSyncReady = true;
  startRemotePolling();
  pullRemoteState();
  return { ok: true, mode: "remote" };
}

export function stopRemoteSync() {
  if (remoteUnsubscribe) {
    remoteUnsubscribe();
  }
  remoteUnsubscribe = null;
  if (remotePollInterval) {
    window.clearInterval(remotePollInterval);
  }
  remotePollInterval = null;
  remoteSyncReady = false;
}

function emit() {
  const state = getState();
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(getState());
  return () => {
    listeners.delete(listener);
  };
}

function updateState(updater) {
  const current = getState();
  if (!current) {
    return null;
  }
  const ticked = tickState(current);
  const next = updater(ticked);
  saveState(next, current);
  return next;
}

/* ------------------------------------------------------------------ */
/* Eventlog                                                            */
/* ------------------------------------------------------------------ */

function logEvent(state, text) {
  return {
    ...state,
    eventLog: [...(state.eventLog ?? []), { at: now(), text }].slice(-60)
  };
}

/* ------------------------------------------------------------------ */
/* Spelkamer aanmaken / joinen / sessies                               */
/* ------------------------------------------------------------------ */

export function createRoom({ modeId, teamName, colorId, playerCount, playerNames }) {
  const name = cleanTeamName(teamName, "");
  if (!name) {
    return { ok: false, message: "Kies eerst een teamnaam." };
  }

  const roomCode = createRoomCode();
  const teamId = createId("team");
  const sessionId = createId("session");
  const team = createTeamState({ id: teamId, name, colorId, playerCount, playerNames });
  team.activeSessionId = sessionId;

  let state = createRoomState({ roomCode, modeId, starterTeamId: teamId });
  state.teams[teamId] = team;
  state = logEvent(state, `${name} heeft de spelkamer aangemaakt.`);

  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, teamId, sessionId }));
  saveState(state, null);
  return { ok: true, roomCode, teamId };
}

function createLeaderCode() {
  const length = LEADER_CODE_LENGTH;
  const bytes = new Uint32Array(length);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    }
  }
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

// Spelleider maakt een kamer ZONDER eigen team. De spelleiderscode staat leesbaar
// in de state: een eerlijkheidscode, geen echte beveiliging.
export function createLeaderRoom({ modeId }) {
  const roomCode = createRoomCode();
  const sessionId = createId("session");
  let state = createRoomState({ roomCode, modeId, starterTeamId: null });
  const leaderCode = createLeaderCode();
  state.leaderMode = true;
  state.leaderCodeHash = leaderCodeHash(roomCode, leaderCode);
  state = logEvent(state, "De spelleider heeft de spelkamer aangemaakt.");

  // De leesbare code blijft alleen op dit toestel (in de sessie), zodat je hem kunt doorgeven.
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode, role: "leader", sessionId, leaderCode }));
  saveState(state, null);
  return { ok: true, roomCode, leaderCode };
}

// Tweede (of herstelde) spelleider: spelcode + spelleiderscode.
export function joinAsLeader({ roomCode, leaderCode, roomState = null }) {
  const code = normalizeRoomCode(roomCode);
  const enteredCode = normalizeRoomCode(leaderCode);

  let state = null;
  const existingRaw = window.localStorage.getItem(storageKey(code));
  if (existingRaw) {
    try {
      state = normalizeState(JSON.parse(existingRaw));
    } catch {
      state = null;
    }
  }
  state = state ?? (roomState ? normalizeState(roomState) : null);
  if (!state) {
    return { ok: false, message: "Spelkamer niet gevonden." };
  }
  if (!state.leaderMode || !state.leaderCodeHash) {
    return { ok: false, message: "Dit is geen spelkamer met spelleider." };
  }
  if (!enteredCode || leaderCodeHash(code, enteredCode) !== state.leaderCodeHash) {
    return { ok: false, message: "Deze spelleiderscode klopt niet." };
  }

  window.localStorage.setItem(storageKey(code), JSON.stringify(state));
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ roomCode: code, role: "leader", sessionId: createId("session"), leaderCode: enteredCode })
  );
  emit();
  return { ok: true, roomCode: code };
}

export function isLeaderSession(session = getSession()) {
  return session?.role === "leader";
}

export async function fetchRoom(roomCode) {
  const code = normalizeRoomCode(roomCode);
  if (!code) {
    return { ok: false, message: "Vul een spelcode in." };
  }

  const localRaw = window.localStorage.getItem(storageKey(code));
  if (localRaw) {
    try {
      const state = normalizeState(JSON.parse(localRaw));
      if (state) {
        return { ok: true, state };
      }
    } catch {
      // negeer kapotte lokale kopie en probeer remote
    }
  }

  // De testkamer bestaat alleen lokaal en wordt nooit van remote geladen.
  const remoteState = code === DEMO_ROOM_CODE ? null : await loadRemoteGameState(code);
  const state = remoteState ? normalizeState(remoteState) : null;
  if (!state) {
    return {
      ok: false,
      message: "Spelkamer niet gevonden. Controleer de code, of check de internetverbinding."
    };
  }
  window.localStorage.setItem(storageKey(code), JSON.stringify(state));
  return { ok: true, state };
}

export function joinRoom({ roomCode, teamName, colorId, playerCount, playerNames, roomState }) {
  const code = normalizeRoomCode(roomCode);
  const name = cleanTeamName(teamName, "");
  if (!name) {
    return { ok: false, message: "Kies eerst een teamnaam." };
  }

  const existingRaw = window.localStorage.getItem(storageKey(code));
  let state = null;
  if (existingRaw) {
    try {
      state = normalizeState(JSON.parse(existingRaw));
    } catch {
      state = null;
    }
  }
  state = state ?? (roomState ? normalizeState(roomState) : null);
  if (!state) {
    return { ok: false, message: "Spelkamer niet gevonden." };
  }
  if (state.phase !== GAME_PHASE.LOBBY) {
    return { ok: false, message: "Dit spel is al gestart. Joinen kan alleen in de lobby." };
  }
  if (Object.keys(state.teams).length >= GAME_CONFIG.maxTeams) {
    return { ok: false, message: "De spelkamer zit vol." };
  }

  const nameTaken = Object.values(state.teams).some(
    (team) => team.name.toLowerCase() === name.toLowerCase()
  );
  if (nameTaken) {
    return { ok: false, message: "Deze teamnaam is al gekozen. Kies een andere naam." };
  }
  const colorTaken = Object.values(state.teams).some((team) => team.colorId === colorId);
  if (colorTaken) {
    return { ok: false, message: "Deze teamkleur is al gekozen. Kies een andere kleur." };
  }

  const teamId = createId("team");
  const sessionId = createId("session");
  const team = createTeamState({ id: teamId, name, colorId, playerCount, playerNames });
  team.activeSessionId = sessionId;

  let nextState = {
    ...state,
    teams: { ...state.teams, [teamId]: team }
  };
  nextState = logEvent(nextState, `${name} doet mee.`);

  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: code, teamId, sessionId }));
  saveState(nextState, state);
  return { ok: true, teamId };
}

// Zelfde team op nieuw toestel: bestaande sessie vervangen. De spelstand
// verandert niet — een nieuw toestel geeft geen voordeel.
export function takeoverTeam(roomCode, teamId, roomState = null) {
  const code = normalizeRoomCode(roomCode);
  const sessionId = createId("session");

  if (roomState) {
    const state = normalizeState(roomState);
    if (state?.teams?.[teamId]) {
      window.localStorage.setItem(storageKey(code), JSON.stringify(state));
    }
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: code, teamId, sessionId }));

  const result = updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: { ...teamState, activeSessionId: sessionId }
      }
    };
  });

  if (!result?.teams?.[teamId]) {
    window.localStorage.removeItem(SESSION_KEY);
    return { ok: false, message: "Team niet gevonden in deze spelkamer." };
  }
  return { ok: true, teamId, sessionId };
}

export function setPlayerCount(teamId, playerCount) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }
    const count = Math.min(Math.max(Number(playerCount) || 1, 1), 8);
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          playerCount: count,
          playerNames: cleanPlayerNames(teamState.playerNames, count)
        }
      }
    };
  });
}

// Namen van de teamleden: alleen in de lobby aanpasbaar, daarna staan ze vast.
export function setPlayerNames(teamId, names) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState || state.phase !== GAME_PHASE.LOBBY) {
      return state;
    }
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          playerNames: cleanPlayerNames(names, teamState.playerCount)
        }
      }
    };
  });
}

export function isSessionActive(state, session) {
  const teamState = state?.teams?.[session?.teamId];
  return Boolean(teamState && teamState.activeSessionId === session.sessionId);
}

/* ------------------------------------------------------------------ */
/* Spelverloop: start, klok, fases                                     */
/* ------------------------------------------------------------------ */

export function startGame(teamId) {
  return updateState((state) => {
    if (state.phase !== GAME_PHASE.LOBBY || state.starterTeamId !== teamId) {
      return state;
    }
    if (Object.keys(state.teams).length < GAME_CONFIG.minTeams) {
      return state;
    }
    return logEvent(
      { ...state, phase: GAME_PHASE.COUNTDOWN, countdownStartedAt: now() },
      "Het spel start zo. Countdown loopt."
    );
  });
}

// Spelleider start het spel (zonder starter-team); daarna loopt dezelfde countdown.
export function startGameAsLeader() {
  const session = getSession();
  if (!isLeaderSession(session)) {
    return null;
  }
  return updateState((state) => {
    if (!state.leaderMode || state.phase !== GAME_PHASE.LOBBY) {
      return state;
    }
    if (Object.keys(state.teams).length < GAME_CONFIG.minTeams) {
      return state;
    }
    return logEvent(
      { ...state, phase: GAME_PHASE.COUNTDOWN, countdownStartedAt: now() },
      "De spelleider start het spel. Countdown loopt."
    );
  });
}

export function getCountdownRemaining(state) {
  if (state?.phase !== GAME_PHASE.COUNTDOWN || !state.countdownStartedAt) {
    return null;
  }
  const elapsedSeconds = Math.floor((now() - state.countdownStartedAt) / 1000);
  return Math.max(GAME_CONFIG.countdownSeconds - elapsedSeconds, 0);
}

export function getTeamCountdownSeconds(teamState, fieldName) {
  const targetTime = teamState?.[fieldName];
  if (!targetTime) {
    return null;
  }
  return Math.max(Math.ceil((targetTime - now()) / 1000), 0);
}

export function getTaskConfirmRemaining(teamState) {
  const task = teamState?.currentTask;
  if (!task?.startedAt || !task.timerSeconds) {
    return 0;
  }
  return Math.max(Math.ceil((task.startedAt + task.timerSeconds * 1000 - now()) / 1000), 0);
}

function maxTurnsForState(state) {
  return findGameMode(state.modeId)?.turns ?? 20;
}

function hasTeamReachedTurnLimit(state, teamState) {
  return (teamState?.normalTurnsUsed ?? 0) >= maxTurnsForState(state);
}

function isTeamDone(state, teamState) {
  return (
    hasTeamReachedTurnLimit(state, teamState) &&
    ![
      TEAM_STATUS.TASK_ACTIVE,
      TEAM_STATUS.CHOOSING_TEAM,
      TEAM_STATUS.CHOOSING_POWERUP,
      TEAM_STATUS.IN_JAIL,
      TEAM_STATUS.WAITING_TIMER,
      TEAM_STATUS.WAITING_SWAP
    ].includes(teamState.status) &&
    !teamState.pendingBonusRoll
  );
}

// Welk engeltje-moment (3 of 18) is voor dit team aan de beurt? null = geen.
// Bonusworpen tellen niet mee (normalTurnsUsed); Gezellig (15) heeft geen beurt 18.
function dueAngelMoment(state, teamState) {
  if (
    !teamState ||
    teamState.status !== TEAM_STATUS.CAN_ROLL ||
    teamState.currentTask ||
    teamState.activePopup ||
    String(teamState.activeSessionId ?? "").startsWith("bot_")
  ) {
    return null;
  }
  const turns = maxTurnsForState(state);
  const given = teamState.angelsGiven ?? [];
  return (
    ANGEL_TURNS.find(
      (turn) => turn <= turns && (teamState.normalTurnsUsed ?? 0) >= turn && !given.includes(turn)
    ) ?? null
  );
}

// Geeft een willekeurige power-up + popup + eventlog-regel. moment = 3 of 18
// (wordt vastgelegd in angelsGiven), of null voor de testknop.
function giveAngelPowerUp(state, teamId, moment = null) {
  const teamState = state.teams[teamId];
  if (!teamState) {
    return state;
  }
  // Per team en moment dezelfde power-up, ook als twee toestellen tegelijk rekenen.
  // De testknop (moment null) blijft willekeurig.
  let seed = 2166136261;
  for (const char of `${teamId}:${moment}`) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const pick =
    moment === null
      ? ANGEL_POWER_UPS[Math.floor(Math.random() * ANGEL_POWER_UPS.length)]
      : ANGEL_POWER_UPS[seed % ANGEL_POWER_UPS.length];
  const given = teamState.angelsGiven ?? [];
  const angelsGiven = moment !== null && !given.includes(moment) ? [...given, moment] : given;
  const next = {
    ...teamState,
    angelsGiven,
    savedPowerUps: [
      ...getSavedPowerUps(teamState),
      {
        id: moment === null ? `angel-${pick.type}-${now()}` : `angel-${pick.type}-${moment}`,
        cardId: `angel-${pick.type}`,
        title: pick.label,
        label: pick.label,
        body: pick.body,
        type: pick.type
      }
    ],
    activePopup: {
      title: GIFT_TITLES[(seed >>> 8) % GIFT_TITLES.length],
      body: `Gratis power-up omdat jullie goed bezig zijn! Jullie hebben ${pick.label} gekregen.`,
      kind: "info",
      stage: "detail"
    }
  };
  return logEvent(
    { ...state, teams: { ...state.teams, [teamId]: next } },
    `${teamState.name} kreeg een gratis verrassing: ${pick.label}.`
  );
}

function tickState(state) {
  if (!state) {
    return state;
  }

  if (state.phase === GAME_PHASE.COUNTDOWN && state.countdownStartedAt) {
    const elapsedSeconds = Math.floor((now() - state.countdownStartedAt) / 1000);
    if (elapsedSeconds >= GAME_CONFIG.countdownSeconds) {
      const startedState = {
        ...state,
        phase: GAME_PHASE.RUNNING,
        gameStartedAt: state.countdownStartedAt + GAME_CONFIG.countdownSeconds * 1000,
        teams: { ...state.teams }
      };
      for (const [teamId, teamState] of Object.entries(startedState.teams)) {
        startedState.teams[teamId] = {
          ...teamState,
          status:
            teamState.status === TEAM_STATUS.WAITING_START
              ? TEAM_STATUS.CAN_ROLL
              : teamState.status
        };
      }
      return tickState(startedState);
    }
    return state;
  }

  if (state.phase !== GAME_PHASE.RUNNING) {
    return state;
  }

  let nextState = state;

  // Wachtend bewijs dat niet meer bij de lopende opdracht hoort (aanval,
  // verplaatsing, spelleidermodus uit) vervalt, zodat niemand blijft hangen.
  for (const [teamId, teamState] of Object.entries(nextState.teams)) {
    if (teamState.awaitingApproval && (!nextState.leaderMode || !isProofCurrent(teamState))) {
      nextState = {
        ...nextState,
        teams: { ...nextState.teams, [teamId]: { ...teamState, awaitingApproval: null } }
      };
    }
  }

  for (const [teamId, teamState] of Object.entries(nextState.teams)) {
    // Wachttimers (aanval / Wisselstation) aflopen.
    if (
      [TEAM_STATUS.WAITING_TIMER, TEAM_STATUS.WAITING_SWAP].includes(teamState.status) &&
      teamState.waitUntil &&
      now() >= teamState.waitUntil
    ) {
      nextState = {
        ...nextState,
        teams: {
          ...nextState.teams,
          [teamId]: advanceTeamAfterResolution(nextState, {
            ...teamState,
            waitUntil: null,
            currentTask: null
          })
        }
      };
    }

    // Celtijd voorbij: strafopdracht verschijnt.
    const jailTeam = nextState.teams[teamId];
    if (jailTeam.status === TEAM_STATUS.IN_JAIL && jailTeam.jailUntil && now() >= jailTeam.jailUntil) {
      const jailTile = findTileById(31);
      const punishment = {
        ...createTaskForTile(jailTile),
        title: "Strafopdracht cel",
        startedAt: now()
      };
      nextState = {
        ...nextState,
        teams: {
          ...nextState.teams,
          [teamId]: {
            ...jailTeam,
            jailUntil: null,
            currentTask: punishment,
            status: TEAM_STATUS.TASK_ACTIVE,
            activePopup: {
              title: "Strafopdracht",
              body: punishment.body,
              kind: "task",
              stage: "detail"
            }
          }
        }
      };
    }
  }

  // Wachtrij-vakken (na ronde-overgang of Uno Reverse) automatisch activeren.
  for (const [teamId, teamState] of Object.entries(nextState.teams)) {
    if (teamState.status === TEAM_STATUS.TASK_ACTIVE && teamState.currentTask?.pendingTileId) {
      nextState = activatePendingTileIfNeeded(nextState, teamId);
    }
  }

  // Engeltje uit de lucht: pas als het team rustig weer mag gooien (geen popup,
  // geen lopende opdracht), zodat er niets overschreven of onderbroken wordt.
  for (const [teamId, teamState] of Object.entries(nextState.teams)) {
    const moment = dueAngelMoment(nextState, teamState);
    if (moment !== null) {
      nextState = giveAngelPowerUp(nextState, teamId, moment);
    }
  }

  // Spel afgelopen zodra alle teams klaar zijn.
  const allTeams = Object.values(nextState.teams);
  if (
    allTeams.length > 0 &&
    !nextState.endedAt &&
    allTeams.every((teamState) => isTeamDone(nextState, teamState))
  ) {
    const endedState = {
      ...nextState,
      phase: GAME_PHASE.ENDED,
      endedAt: now(),
      teams: { ...nextState.teams }
    };
    for (const [teamId, teamState] of Object.entries(endedState.teams)) {
      endedState.teams[teamId] = {
        ...teamState,
        status: TEAM_STATUS.GAME_OVER,
        activePopup: {
          title: "Spel afgelopen",
          body: "Alle teams zijn klaar. De app heeft de eindstand bepaald. Bekijk wie er gewonnen heeft!",
          kind: "finished"
        }
      };
    }
    return logEvent(endedState, "Het spel is afgelopen. De eindstand staat vast.");
  }

  return nextState;
}

export function runClockTick() {
  const current = getState();
  if (!current) {
    return;
  }
  const next = tickState(current);
  if (next !== current) {
    saveState(next, current);
  }
}

/* ------------------------------------------------------------------ */
/* Bordlogica en taken                                                 */
/* ------------------------------------------------------------------ */

function normalizeBoardPosition(rawPosition) {
  const size = GAME_CONFIG.boardSize;
  return {
    position: ((((rawPosition - 1) % size) + size) % size) + 1,
    roundsGained: rawPosition > size ? Math.floor((rawPosition - 1) / size) : 0
  };
}

function getSavedPowerUps(teamState) {
  return teamState.savedPowerUps ?? [];
}

function removeSavedPowerUp(teamState, powerUpId) {
  return getSavedPowerUps(teamState).filter((powerUp) => powerUp.id !== powerUpId);
}

function getShieldPowerUp(teamState) {
  return getSavedPowerUps(teamState).find((powerUp) => powerUp.type === "shield") ?? null;
}

function drawCardForTeam(type, teamState) {
  const deckType = type === "fund" ? "fund" : "chance";
  const deck = CARD_DECKS[deckType] ?? CARD_DECKS.chance;
  const usedOnceCards = teamState.oncePerTeamCardIds ?? [];
  const eligibleCards = deck.filter(
    (card) => !card.oncePerTeam || !usedOnceCards.includes(card.id)
  );
  const pool = eligibleCards.length ? eligibleCards : deck.filter((card) => !card.oncePerTeam);
  return pool[Math.floor(Math.random() * pool.length)] ?? drawCard(deckType);
}

function createTaskFromCard(card, presentation, teamState) {
  const base = {
    title: card.title,
    body: card.body,
    popup: card.popup ?? "",
    rules: card.rules ?? "",
    placeholder: false,
    presentation,
    cardId: card.id,
    oncePerTeam: Boolean(card.oncePerTeam),
    effectType: card.effectType,
    delta: card.delta ?? 0,
    waitSeconds: card.waitSeconds ?? null,
    powerUpLabel: card.powerUpLabel,
    savedPowerUpType: card.savedPowerUpType,
    timerSeconds: 0,
    skippable: card.effectType === "task",
    startedAt: now()
  };

  // Bankkaart: de app doet direct uitspraak (vastgezet op het moment van trekken).
  if (card.effectType === "bank_verdict") {
    const verdict = card.verdicts[Math.floor(Math.random() * card.verdicts.length)];
    if (verdict.id === "meevaller") {
      return {
        ...base,
        effectType: "team_choice_notify",
        title: verdict.title,
        body: verdict.body,
        notifyTargetText:
          "De Bank heeft een ander team een alcoholische meevaller gegeven. Zij bellen jullie en delen drankjes uit aan ieder actief teamlid. Proost!",
        notifyActorText: "Bel het gekozen team en deel de drankjes uit."
      };
    }
    return {
      ...base,
      effectType: "task",
      title: verdict.title,
      body: verdict.body,
      skippable: true,
      timerSeconds: TASK_TIMERS.bar
    };
  }

  if (card.timerType) {
    base.timerSeconds = TASK_TIMERS[card.timerType] ?? 0;
  }

  return base;
}

function dock17DrinkFor(number) {
  return DOCK17_DRINKS.find((item) => item.id === Number(number))?.drink ?? "Onbekend drankje";
}

function withDock17Meta(task, teamState, tileId) {
  if (tileId !== 32) {
    return task;
  }
  return {
    ...task,
    specialFlow: "dock17",
    dock17Choices: Array.from({ length: teamState.playerCount }, (_, index) => ({
      id: `player_${index + 1}`,
      name: playerNameOf(teamState, index),
      number: null,
      drink: ""
    })),
    dock17Revealed: false
  };
}

function withVanOudsMeta(task, teamState, tileId) {
  if (tileId !== 33) {
    return task;
  }
  return {
    ...task,
    specialFlow: "vanOuds",
    vanOudsChoices: Array.from({ length: teamState.playerCount }, (_, index) => ({
      id: `player_${index + 1}`,
      name: playerNameOf(teamState, index),
      result: ""
    })),
    vanOudsComplete: false
  };
}

function withSpecialTaskMeta(task, teamState, tileId) {
  return withVanOudsMeta(withDock17Meta(task, teamState, tileId), teamState, tileId);
}

function createStartBonusTask(actorName = "Een ander team") {
  const startTile = findTileById(1);
  const task = createTaskForTile(startTile);
  return {
    ...task,
    title: "Ronde voltooid!",
    effectType: "team_choice_notify",
    presentation: "start",
    cardId: "ronde-bonus",
    skippable: false,
    timerSeconds: 0,
    startedAt: now(),
    notifyActorText: "Bel het gekozen team en deel het biertje uit. Daarna gewoon verder spelen.",
    notifyTargetText:
      `${actorName} is langs Start gekomen en heeft jullie gekozen voor de rondebonus: zij delen een biertje uit aan jullie team. Wacht op hun belletje. Jullie spelen gewoon door.`
  };
}

function markOncePerTeamCard(teamState, task) {
  if (!task?.oncePerTeam || !task.cardId) {
    return teamState.oncePerTeamCardIds ?? [];
  }
  return Array.from(new Set([...(teamState.oncePerTeamCardIds ?? []), task.cardId]));
}

// Bepaalt status + taak bij aankomst op een vak. viaEffect=true betekent:
// hier gekomen door kaart/aanval (celvak 11 wordt dan echte cel).
function arriveAtTile(state, teamId, options = {}) {
  const teamState = state.teams[teamId];
  const tileId = teamState.position;
  const tile = findTileById(tileId);
  const viaEffect = Boolean(options.viaEffect);

  // Ga naar de Cel (31) is altijd echte cel; bezoekvak (11) alleen via effect.
  if (tileId === 31 || (tileId === 11 && viaEffect)) {
    return sendTeamToJail(state, teamId);
  }

  let task;
  let status = TEAM_STATUS.TASK_ACTIVE;

  if (tile.type === "Kans" || tile.type === "Algemeen Fonds") {
    const deckType = tile.type === "Kans" ? "chance" : "fund";
    const presentation = deckType === "chance" ? "chance" : "fund";
    const card = drawCardForTeam(deckType, teamState);
    task = createTaskFromCard(card, presentation, teamState);
  } else if (tile.type === "Wisselstation") {
    task = {
      ...createTaskForTile(tile),
      title: "Wisselstation",
      presentation: "swap",
      cardId: `wisselstation-${tile.id}`,
      effectType: "wisselstation",
      waitSeconds: GAME_CONFIG.swapWaitSeconds,
      skippable: false,
      startedAt: now()
    };
  } else {
    task = { ...createTaskForTile(tile), startedAt: now() };
  }

  task = withSpecialTaskMeta(task, teamState, tileId);

  const withTask = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        currentTask: task,
        oncePerTeamCardIds: markOncePerTeamCard(teamState, task),
        lastStreetTileId: tile.type === "Straatvak" ? tileId : teamState.lastStreetTileId,
        activePopup:
          options.popup ??
          (options.keepPopup && teamState.activePopup
            ? teamState.activePopup
            : task.popup || ["chance", "fund", "swap"].includes(task.presentation)
              ? {
                  title: task.title,
                  body: task.popup || task.body,
                  kind: task.presentation,
                  stage: options.revealDirect ? "detail" : "intro",
                  cardId: task.cardId
                }
              : null),
        status
      }
    }
  };

  return applyImmediateTaskEffect(withTask, teamId);
}

// Automatische kaarteffecten direct verwerken (kettingreacties inbegrepen).
function applyImmediateTaskEffect(state, teamId) {
  const teamState = state.teams[teamId];
  const task = teamState?.currentTask;
  if (!task) {
    return state;
  }

  switch (task.effectType) {
    case "move_self":
      return moveTeamByDelta(state, teamId, task.delta, { keepPopup: true, viaEffect: true });
    case "return_previous_street": {
      const target = teamState.lastStreetTileId ?? teamState.position;
      return moveTeamToTile(state, teamId, target, { keepPopup: true, viaEffect: false });
    }
    case "jail_self":
      return sendTeamToJail(state, teamId);
    case "bonus_roll":
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: advanceTeamAfterResolution(state, {
            ...teamState,
            pendingBonusRoll: true,
            currentTask: null
          })
        }
      };
    case "saved_powerup":
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: advanceTeamAfterResolution(state, {
            ...teamState,
            currentTask: null,
            savedPowerUps: [
              ...getSavedPowerUps(teamState),
              {
                id: `${task.cardId}-${now()}`,
                cardId: task.cardId,
                title: task.title,
                label: task.powerUpLabel ?? task.title,
                body: task.body,
                type: task.savedPowerUpType
              }
            ]
          })
        }
      };
    case "team_choice_move":
    case "team_choice_wait":
    case "team_choice_notify":
    case "swap_positions":
    case "wisselstation":
    case "uno_reverse":
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: { ...state.teams[teamId], status: TEAM_STATUS.CHOOSING_TEAM }
        }
      };
    default:
      return state;
  }
}

// Volgende stap voor een team nadat een taak/timer is afgerond:
// wachtrij > gefinisht > mag gooien.
function advanceTeamAfterResolution(state, teamState) {
  const pending = teamState.pendingTasks ?? [];
  if (pending.length > 0) {
    const [nextPending, ...rest] = pending;
    return {
      ...teamState,
      pendingTasks: rest,
      currentTask: { ...nextPending.task, startedAt: now() },
      status:
        nextPending.task.effectType &&
        ["team_choice_move", "team_choice_wait", "team_choice_notify", "swap_positions", "wisselstation", "uno_reverse"].includes(
          nextPending.task.effectType
        )
          ? TEAM_STATUS.CHOOSING_TEAM
          : TEAM_STATUS.TASK_ACTIVE
    };
  }

  if (hasTeamReachedTurnLimit(state, teamState) && !teamState.pendingBonusRoll) {
    return {
      ...teamState,
      status: TEAM_STATUS.FINISHED,
      finishedAt: teamState.finishedAt ?? now(),
      activePopup: teamState.activePopup ?? {
        title: "Gefinisht!",
        body: "Jullie beurten zitten erop. Lekker gespeeld. Wacht tot alle teams klaar zijn, daarna toont de app de eindstand.",
        kind: "finished"
      }
    };
  }

  return { ...teamState, status: TEAM_STATUS.CAN_ROLL };
}

function moveTeamByDelta(state, teamId, delta, options = {}) {
  const teamState = state.teams[teamId];
  const rawPosition = teamState.position + delta;
  const { position, roundsGained } = normalizeBoardPosition(rawPosition);
  return applyMovement(state, teamId, position, roundsGained, {
    ...options,
    steps: options.steps ?? delta,
    source: options.source ?? "card"
  });
}

function moveTeamToTile(state, teamId, position, options = {}) {
  return applyMovement(state, teamId, position, 0, options);
}

function applyMovement(state, teamId, position, roundsGained, options = {}) {
  const teamState = state.teams[teamId];
  const movedAt = now();
  const tile = findTileById(position);
  const crossedStart = roundsGained > 0;

  let nextTeam = {
    ...teamState,
    position,
    completedRounds: teamState.completedRounds + roundsGained,
    positionReachedAt: movedAt,
    currentTask: null,
    lastMove: {
      roll: options.roll ?? teamState.lastRoll,
      from: teamState.position,
      to: position,
      roundsGained,
      crossedStart,
      tileName: tile.name,
      movedAt,
      source: options.source ?? "move",
      // Aantal stappen dat de pion loopt (positief = vooruit, negatief = achteruit).
      // null bij teleport/wissel: dan springt de pion direct.
      steps: options.steps ?? null
    }
  };

  // Ronde-overgang: bonus tonen, bestemming komt in de wachtrij.
  if (crossedStart) {
    nextTeam = {
      ...nextTeam,
      pendingTasks: [
        { kind: "tile", task: { ...createPendingTileMarker(position) } },
        ...(nextTeam.pendingTasks ?? [])
      ]
    };
  }

  let movedState = {
    ...state,
    teams: { ...state.teams, [teamId]: nextTeam }
  };

  if (crossedStart) {
    movedState = logEvent(movedState, `${teamState.name} heeft een ronde voltooid.`);
    const bonusTask = createStartBonusTask(teamState.name);
    movedState = {
      ...movedState,
      teams: {
        ...movedState.teams,
        [teamId]: {
          ...movedState.teams[teamId],
          currentTask: bonusTask,
          status: TEAM_STATUS.CHOOSING_TEAM,
          activePopup: {
            title: bonusTask.title,
            body: bonusTask.popup || bonusTask.body,
            kind: "start",
            stage: "detail"
          }
        }
      }
    };
    return movedState;
  }

  return arriveAtTile(movedState, teamId, options);
}

// Marker in de wachtrij: het vak zelf wordt pas geactiveerd (en een eventuele
// kaart pas getrokken) zodra het team eraan toe is.
function createPendingTileMarker(tileId) {
  return { pendingTileId: tileId, title: `Vak ${tileId}` };
}

function activatePendingTileIfNeeded(state, teamId) {
  const teamState = state.teams[teamId];
  const task = teamState?.currentTask;
  if (!task?.pendingTileId) {
    return state;
  }
  const cleared = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: { ...teamState, currentTask: null }
    }
  };
  return arriveAtTile(cleared, teamId, { viaEffect: false, revealDirect: false });
}

function sendTeamToJail(state, teamId) {
  const teamState = state.teams[teamId];
  const jailUntil = now() + GAME_CONFIG.jailWaitSeconds * 1000;
  const jailedState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        position: 11,
        positionReachedAt: now(),
        jailUntil,
        currentTask: {
          title: "Echte cel",
          body: `Jullie zitten in de cel. Wacht ${Math.round(
            GAME_CONFIG.jailWaitSeconds / 60
          )} minuten. Daarna krijgen jullie je strafopdracht.`,
          placeholder: false,
          presentation: "jail",
          skippable: false,
          timerSeconds: 0,
          startedAt: now()
        },
        status: TEAM_STATUS.IN_JAIL
      }
    }
  };
  return logEvent(jailedState, `${teamState.name} zit in de cel.`);
}

/* ------------------------------------------------------------------ */
/* Acties van teams                                                    */
/* ------------------------------------------------------------------ */

export function rollDice(teamId, forcedRoll = null) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const canRoll =
      state.phase === GAME_PHASE.RUNNING &&
      teamState?.status === TEAM_STATUS.CAN_ROLL &&
      (teamState.pendingBonusRoll || !hasTeamReachedTurnLimit(state, teamState));

    if (!canRoll) {
      return state;
    }

    const isBonusRoll = Boolean(teamState.pendingBonusRoll);
    // Een vaste worp is alleen toegestaan in de lokale testmodus; in een echte
    // spelkamer kan niemand (bijv. via aangepaste knoppen in de DOM) de worp kiezen.
    const roll =
      state.isDemo && Number.isInteger(forcedRoll) && forcedRoll >= 1 && forcedRoll <= 6
        ? forcedRoll
        : Math.floor(Math.random() * 6) + 1;

    // Geworpen is geworpen: beurt + worp worden direct vastgelegd.
    const rolledState = logEvent(
      {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            normalTurnsUsed: teamState.normalTurnsUsed + (isBonusRoll ? 0 : 1),
            pendingBonusRoll: false,
            lastRoll: roll
          }
        }
      },
      `${teamState.name} heeft ${roll} gegooid${isBonusRoll ? " (bonusworp)" : ""}.`
    );

    const rawPosition = rolledState.teams[teamId].position + roll;
    const { position, roundsGained } = normalizeBoardPosition(rawPosition);
    return applyMovement(rolledState, teamId, position, roundsGained, {
      roll,
      steps: roll,
      source: isBonusRoll ? "bonus_roll" : "roll",
      viaEffect: false
    });
  });
}

// De eigenlijke afronding van een opdracht, als reducer (state => state). Geeft
// dezelfde `state` terug als afronden nu niet mag. Wordt gebruikt door het team
// zelf (zonder spelleider) en door approveProof (met spelleider).
function confirmTaskReducer(teamId, withBonus) {
  return (state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!task || teamState.status !== TEAM_STATUS.TASK_ACTIVE) {
      return state;
    }
    if (task.pendingTileId) {
      return activatePendingTileIfNeeded(state, teamId);
    }
    // Minimumtimer moet verstreken zijn — refresh verandert hier niets aan.
    if (task.timerSeconds && task.startedAt && now() < task.startedAt + task.timerSeconds * 1000) {
      return state;
    }
    if (task.specialFlow === "dock17" && !task.dock17Revealed) {
      return state;
    }
    if (task.specialFlow === "vanOuds" && !task.vanOudsComplete) {
      return state;
    }

    let nextTeam = {
      ...teamState,
      currentTask: null,
      activePopup: null
    };

    if (withBonus && task.bonusPowerUp) {
      nextTeam = {
        ...nextTeam,
        savedPowerUps: [
          ...getSavedPowerUps(nextTeam),
          {
            id: `bonus-${now()}`,
            cardId: `bonus-${task.bonusPowerUp.type}`,
            title: task.bonusPowerUp.label,
            label: task.bonusPowerUp.label,
            body: "Wijs één ander actief team aan. Dat team moet ieder actief teamlid een adje wodka-Red Bull laten doen voordat ze opnieuw mogen gooien.",
            type: task.bonusPowerUp.type
          }
        ],
        activePopup: {
          title: "Power-up verdiend",
          body: `Jullie hebben de power-up ${task.bonusPowerUp.label} verdiend! Zet hem in via het power-up-paneel wanneer het jullie uitkomt.`,
          kind: "fund",
          stage: "detail"
        }
      };
    }

    const confirmedState = logEvent(
      {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: advanceTeamAfterResolution(state, nextTeam)
        }
      },
      `${teamState.name} heeft een opdracht afgerond.`
    );

    return activatePendingTileIfNeeded(confirmedState, teamId);
  };
}

export function confirmTask(teamId, { withBonus = false } = {}) {
  return updateState((state) => {
    const reduce = confirmTaskReducer(teamId, withBonus);
    if (!state.leaderMode) {
      return reduce(state);
    }
    // Met spelleider: "Bewijs gestuurd" voltooit niets, maar zet het team in de
    // wacht. Alle bestaande voorwaarden (minimumtimer, Dock 17, Rad) gelden eerst.
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!task || teamState.status !== TEAM_STATUS.TASK_ACTIVE || teamState.awaitingApproval) {
      return state;
    }
    if (task.pendingTileId) {
      return reduce(state); // wachtrij-marker: gewoon doorlopen, geen bewijs nodig
    }
    if (reduce(state) === state) {
      return state; // afronden mag nu nog niet
    }
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          awaitingApproval: {
            sentAt: now(),
            taskStartedAt: task.startedAt ?? 0,
            withBonus: Boolean(withBonus && task.bonusPowerUp)
          }
        }
      }
    };
  });
}

/* ------------------------------------------------------------------ */
/* Spelleider: bewijs goed- of afkeuren                                */
/* ------------------------------------------------------------------ */

// Hoort het wachtende bewijs nog bij de lopende opdracht? Een aanval of
// verplaatsing kan de opdracht hebben laten vervallen.
function isProofCurrent(teamState) {
  const awaiting = teamState?.awaitingApproval;
  const task = teamState?.currentTask;
  return Boolean(
    awaiting &&
      task &&
      teamState.status === TEAM_STATUS.TASK_ACTIVE &&
      (task.startedAt ?? 0) === awaiting.taskStartedAt
  );
}

// Alleen een spelleider (of de lokale testmodus) mag bewijs beoordelen.
function canJudgeProof(state) {
  return Boolean(state?.leaderMode && (state.isDemo || isLeaderSession()));
}

// Wachtende teams, oudste eerst, voor het spelleiderscherm.
export function getPendingApprovals(state) {
  if (!state?.leaderMode || state.phase !== GAME_PHASE.RUNNING) {
    return [];
  }
  return Object.values(state.teams)
    .filter((teamState) => isProofCurrent(teamState))
    .map((teamState) => ({
      teamState,
      task: teamState.currentTask,
      sentAt: teamState.awaitingApproval.sentAt
    }))
    .sort((a, b) => a.sentAt - b.sentAt);
}

export function approveProof(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const awaiting = teamState?.awaitingApproval;
    // Idempotent: wacht het team niet (meer), dan gebeurt er niets.
    if (!awaiting || !canJudgeProof(state)) {
      return state;
    }
    const decided = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: { ...teamState, awaitingApproval: null, lastProofDecidedSentAt: awaiting.sentAt }
      }
    };
    if (!isProofCurrent(teamState)) {
      return decided; // opdracht is intussen vervallen: alleen het wachten opruimen
    }
    return confirmTaskReducer(teamId, awaiting.withBonus)(
      logEvent(decided, `De spelleider keurde het bewijs van ${teamState.name} goed.`)
    );
  });
}

export function rejectProof(teamId, reason = "") {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const awaiting = teamState?.awaitingApproval;
    if (!awaiting || !canJudgeProof(state)) {
      return state;
    }
    const why = cleanText(reason, 200).trim();
    const current = isProofCurrent(teamState);
    const next = {
      ...teamState,
      awaitingApproval: null,
      lastProofDecidedSentAt: awaiting.sentAt,
      activePopup: current
        ? {
            title: "Bewijs afgekeurd",
            body:
              "Jullie spelleider heeft het bewijs niet goedgekeurd. Probeer het opnieuw of sla de opdracht over (-2 vakjes)." +
              (why ? `\n\nReden: ${why}` : ""),
            kind: "info",
            stage: "detail"
          }
        : teamState.activePopup
    };
    const decided = { ...state, teams: { ...state.teams, [teamId]: next } };
    return current
      ? logEvent(decided, `De spelleider keurde het bewijs van ${teamState.name} af.`)
      : decided;
  });
}

// Eenmalige uitleg in de lobby ("Bewijs sturen"); onthouden zodat hij niet terugkomt.
export function acknowledgeProofIntro(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState || teamState.proofIntroAck) {
      return state;
    }
    return {
      ...state,
      teams: { ...state.teams, [teamId]: { ...teamState, proofIntroAck: true } }
    };
  });
}

// Skippen mag altijd, maar kost standaard 2 vakjes achteruit.
// Het nieuwe vak wordt direct uitgevoerd (kettingreactie).
export function skipTask(teamId, { powerUpId = null } = {}) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!task || teamState.status !== TEAM_STATUS.TASK_ACTIVE || task.skippable === false) {
      return state;
    }
    // Tijdens het wachten op de spelleider kan er niet worden geskipt.
    if (teamState.awaitingApproval) {
      return state;
    }

    // Gratis skip of "opdracht overslaan"-power-up.
    if (powerUpId) {
      const powerUp = getSavedPowerUps(teamState).find((item) => item.id === powerUpId);
      if (!powerUp || !["skip_task", "skip_free"].includes(powerUp.type)) {
        return state;
      }
      const withoutPowerUp = {
        ...teamState,
        savedPowerUps: removeSavedPowerUp(teamState, powerUpId),
        currentTask: null,
        pendingBonusRoll: powerUp.type === "skip_task" ? true : teamState.pendingBonusRoll,
        activePopup: {
          title: "Opdracht overgeslagen",
          body:
            powerUp.type === "skip_task"
              ? "Power-up gebruikt: opdracht overgeslagen zonder straf. De volgende worp is een bonusworp en telt niet als normale beurt."
              : "Vrijbrief gebruikt: opdracht overgeslagen zonder straf.",
          kind: "fund",
          stage: "detail"
        }
      };
      const skippedState = logEvent(
        {
          ...state,
          teams: { ...state.teams, [teamId]: advanceTeamAfterResolution(state, withoutPowerUp) }
        },
        `${teamState.name} heeft een opdracht overgeslagen met een power-up.`
      );
      return activatePendingTileIfNeeded(skippedState, teamId);
    }

    const penalizedState = logEvent(
      {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            currentTask: null,
            activePopup: {
              title: "Opdracht geskipt",
              body: `Skippen is nooit gratis: jullie gaan ${GAME_CONFIG.skipPenaltySteps} vakjes achteruit. Het nieuwe vak wordt direct uitgevoerd.`,
              kind: "chance",
              stage: "detail"
            }
          }
        }
      },
      `${teamState.name} heeft een opdracht geskipt (-${GAME_CONFIG.skipPenaltySteps}).`
    );

    return moveTeamByDelta(penalizedState, teamId, -GAME_CONFIG.skipPenaltySteps, {
      keepPopup: true,
      viaEffect: true,
      source: "skip"
    });
  });
}

/* ------------------------------------------------------------------ */
/* Teamkeuze en teamaanvallen                                          */
/* ------------------------------------------------------------------ */

// Niet kiesbaar: eigen team, teams in de echte cel, gefinishte teams.
// Teams met schild verschijnen wél in de lijst: kiezen verbruikt hun schild
// en de aanvaller moet opnieuw kiezen ("Jullie aanval is geblokkeerd.").
export function getChoosableTeams(state, actorTeamId) {
  return Object.values(state?.teams ?? {}).filter((teamState) => {
    if (teamState.id === actorTeamId) return false;
    if (teamState.status === TEAM_STATUS.IN_JAIL) return false;
    if ([TEAM_STATUS.FINISHED, TEAM_STATUS.GAME_OVER].includes(teamState.status)) return false;
    return true;
  });
}

export function chooseTeam(teamId, targetTeamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const targetState = state.teams[targetTeamId];
    const task = teamState?.currentTask;
    if (
      !teamState ||
      !targetState ||
      !task ||
      teamId === targetTeamId ||
      teamState.status !== TEAM_STATUS.CHOOSING_TEAM
    ) {
      return state;
    }

    if (
      targetState.status === TEAM_STATUS.IN_JAIL ||
      [TEAM_STATUS.FINISHED, TEAM_STATUS.GAME_OVER].includes(targetState.status)
    ) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            activePopup: {
              ...(teamState.activePopup ?? { title: task.title, kind: task.presentation }),
              stage: "detail",
              blockedChoiceMessage: "Dit team is tijdelijk beschermd. Kies een ander team."
            }
          }
        }
      };
    }

    // Schild blokkeert vijandige acties en wordt daarbij verbruikt.
    // team_choice_notify (drankje uitdelen) en share_task (Zuipmaatjes) zijn niet vijandig.
    const hostile = !["team_choice_notify", "share_task"].includes(task.effectType);
    const targetShield = getShieldPowerUp(targetState);
    if (hostile && targetShield) {
      const blockedState = logEvent(
        {
          ...state,
          teams: {
            ...state.teams,
            [teamId]: {
              ...teamState,
              activePopup: {
                ...(teamState.activePopup ?? { title: task.title, kind: task.presentation }),
                stage: "detail",
                blockedChoiceMessage: "Jullie aanval is geblokkeerd. Kies een ander team."
              }
            },
            [targetTeamId]: {
              ...targetState,
              savedPowerUps: removeSavedPowerUp(targetState, targetShield.id),
              activePopup: {
                title: "Geluksvogel",
                body: `${teamState.name} probeerde jullie te raken, maar Geluksvogel heeft de actie geblokkeerd. Deze power-up is nu gebruikt.`,
                kind: "fund",
                stage: "detail"
              }
            }
          }
        },
        `${targetState.name} blokkeerde een aanval met Geluksvogel.`
      );
      return blockedState;
    }

    switch (task.effectType) {
      case "team_choice_notify":
        return resolveTeamChoiceNotify(state, teamId, targetTeamId);
      case "team_choice_move":
        return resolveTeamChoiceMove(state, teamId, targetTeamId);
      case "team_choice_wait":
        return resolveTeamChoiceWait(state, teamId, targetTeamId);
      case "wisselstation":
        return resolveWisselstation(state, teamId, targetTeamId);
      case "swap_positions":
        return resolveSwapPositions(state, teamId, targetTeamId);
      case "uno_reverse":
        return resolveUnoReverse(state, teamId, targetTeamId);
      case "share_task":
        return resolveShareTask(state, teamId, targetTeamId);
      default:
        return state;
    }
  });
}

function resolveTeamChoiceNotify(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];
  const task = teamState.currentTask;

  const resolved = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: advanceTeamAfterResolution(state, {
        ...teamState,
        currentTask: null,
        activePopup: {
          title: "Team gekozen",
          body: task.notifyActorText ?? `Jullie hebben ${targetState.name} gekozen.`,
          kind: task.presentation ?? "start",
          stage: "detail"
        }
      }),
      [targetTeamId]: {
        ...targetState,
        activePopup: {
          title: task.title,
          body: task.notifyTargetText ?? "Een ander team heeft jullie gekozen.",
          kind: task.presentation ?? "start",
          stage: "detail"
        }
      }
    }
  };
  const logged = logEvent(resolved, `${teamState.name} deelt uit aan ${targetState.name}.`);
  return activatePendingTileIfNeeded(logged, teamId);
}

function resolveTeamChoiceMove(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];
  const task = teamState.currentTask;
  const delta = task.delta ?? 0;
  const direction = delta < 0 ? "achteruit" : "vooruit";

  let nextState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: advanceTeamAfterResolution(state, {
        ...teamState,
        currentTask: null,
        activePopup: {
          title: "Team geraakt",
          body: `${targetState.name} is ${Math.abs(delta)} vakjes ${direction} gezet. Jullie kaart is uitgevoerd.`,
          kind: task.presentation ?? "chance",
          stage: "detail"
        }
      }),
      [targetTeamId]: {
        ...targetState,
        // Huidige opdracht en wachtrij van het doelwit vervallen door de verplaatsing.
        currentTask: null,
        waitUntil: null
      }
    }
  };

  nextState = logEvent(
    nextState,
    `${teamState.name} zet ${targetState.name} ${Math.abs(delta)} vakjes ${direction}.`
  );

  nextState = moveTeamByDelta(nextState, targetTeamId, delta, {
    viaEffect: true,
    source: "attack",
    popup: {
      title: "Jullie zijn geraakt",
      body: `${teamState.name} heeft jullie ${Math.abs(delta)} vakjes ${direction} gezet. Jullie oude opdracht vervalt en het nieuwe vakje wordt direct uitgevoerd.`,
      kind: task.presentation ?? "chance",
      stage: "detail"
    }
  });

  return activatePendingTileIfNeeded(nextState, teamId);
}

function resolveTeamChoiceWait(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];
  const task = teamState.currentTask;
  const waitSeconds = task.waitSeconds ?? GAME_CONFIG.attackWaitSeconds;
  const minutes = Math.round(waitSeconds / 60);

  const nextState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: advanceTeamAfterResolution(state, {
        ...teamState,
        currentTask: null,
        activePopup: {
          title: "Team geraakt",
          body: `${targetState.name} moet ${minutes} minuten wachten. Hun huidige opdracht is vervallen.`,
          kind: task.presentation ?? "chance",
          stage: "detail"
        }
      }),
      [targetTeamId]: {
        ...targetState,
        currentTask: null,
        waitUntil: now() + waitSeconds * 1000,
        status: TEAM_STATUS.WAITING_TIMER,
        activePopup: {
          title: "Jullie zijn geraakt",
          body: `${teamState.name} heeft jullie uit de flow getrokken. Jullie huidige opdracht vervalt. Wacht ${minutes} minuten voordat jullie opnieuw mogen gooien.`,
          kind: task.presentation ?? "chance",
          stage: "detail"
        }
      }
    }
  };

  const logged = logEvent(nextState, `${teamState.name} laat ${targetState.name} wachten.`);
  return activatePendingTileIfNeeded(logged, teamId);
}

function resolveWisselstation(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];
  const task = teamState.currentTask;
  const waitSeconds = task.waitSeconds ?? GAME_CONFIG.swapWaitSeconds;
  const minutes = Math.round(waitSeconds / 60);
  const swappedAt = now();
  const actorOldPosition = teamState.position;
  const targetOldPosition = targetState.position;

  const swappedState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: advanceTeamAfterResolution(state, {
        ...teamState,
        position: targetOldPosition,
        positionReachedAt: swappedAt,
        currentTask: null,
        activePopup: {
          title: "Wisselstation gelukt",
          body: `Jullie zijn gewisseld met ${targetState.name}. Jullie mogen direct opnieuw gooien.`,
          kind: "swap",
          stage: "detail"
        }
      }),
      [targetTeamId]: {
        ...targetState,
        position: actorOldPosition,
        positionReachedAt: swappedAt,
        currentTask: null,
        waitUntil: swappedAt + waitSeconds * 1000,
        status: TEAM_STATUS.WAITING_SWAP,
        activePopup: {
          title: "Jullie zijn gewisseld",
          body: `Jullie zijn gewisseld door ${teamState.name}. Jullie huidige opdracht vervalt. Wacht ${minutes} minuten voordat jullie opnieuw mogen gooien.`,
          kind: "swap",
          stage: "detail"
        }
      }
    }
  };

  return logEvent(swappedState, `${teamState.name} wisselde van positie met ${targetState.name}.`);
}

function resolveSwapPositions(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];
  const swappedAt = now();
  const actorOldPosition = teamState.position;
  const targetOldPosition = targetState.position;

  let swappedState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        position: targetOldPosition,
        positionReachedAt: swappedAt,
        currentTask: null,
        activePopup: {
          title: "Wisseltruc gelukt",
          body: `Jullie zijn gewisseld met ${targetState.name}. Jullie voeren nu het nieuwe vakje direct uit.`,
          kind: "fund",
          stage: "detail"
        }
      },
      [targetTeamId]: {
        ...targetState,
        position: actorOldPosition,
        positionReachedAt: swappedAt,
        currentTask: null,
        waitUntil: null,
        activePopup: {
          title: "Jullie zijn gewisseld",
          body: `${teamState.name} heeft Wisseltruc gebruikt. Jullie oude opdracht vervalt en jullie voeren het nieuwe vakje direct uit.`,
          kind: "fund",
          stage: "detail"
        }
      }
    }
  };

  swappedState = logEvent(
    swappedState,
    `${teamState.name} gebruikte Wisseltruc op ${targetState.name}.`
  );

  swappedState = arriveAtTile(swappedState, teamId, { viaEffect: true, keepPopup: true });
  swappedState = arriveAtTile(swappedState, targetTeamId, { viaEffect: true, keepPopup: true });
  return swappedState;
}

function resolveUnoReverse(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];

  const bonusTask = {
    title: "Uno Reverse!",
    body: `${teamState.name} heeft de power-up Uno Reverse op jullie gebruikt. Ieder actief teamlid doet direct een adje wodka-Red Bull. Pas daarna mogen jullie opnieuw gooien.`,
    placeholder: false,
    presentation: "task",
    effectType: "task",
    skippable: true,
    timerSeconds: TASK_TIMERS.bar
  };

  const targetIsIdle = targetState.status === TEAM_STATUS.CAN_ROLL && !targetState.currentTask;

  const nextState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: advanceTeamAfterResolution(state, {
        ...teamState,
        currentTask: null,
        activePopup: {
          title: "Uno Reverse gebruikt",
          body: `${targetState.name} moet nu zelf aan de wodka-Red Bull. Karma is prachtig.`,
          kind: "fund",
          stage: "detail"
        }
      }),
      [targetTeamId]: targetIsIdle
        ? {
            ...targetState,
            currentTask: { ...bonusTask, startedAt: now() },
            status: TEAM_STATUS.TASK_ACTIVE,
            activePopup: {
              title: bonusTask.title,
              body: bonusTask.body,
              kind: "chance",
              stage: "detail"
            }
          }
        : {
            ...targetState,
            pendingTasks: [...(targetState.pendingTasks ?? []), { kind: "task", task: bonusTask }],
            activePopup: {
              title: bonusTask.title,
              body: `${bonusTask.body}\n\nDe opdracht verschijnt zodra jullie huidige actie is afgerond.`,
              kind: "chance",
              stage: "detail"
            }
          }
    }
  };

  return logEvent(nextState, `${teamState.name} gebruikte Uno Reverse op ${targetState.name}.`);
}

// Zuipmaatjes: eigen team behoudt de lopende opdracht, gekozen team krijgt
// een kopie van dezelfde opdracht (of zodra hun huidige actie klaar is).
function resolveShareTask(state, teamId, targetTeamId) {
  const teamState = state.teams[teamId];
  const targetState = state.teams[targetTeamId];
  const [restoredTask, ...restPending] = teamState.pendingTasks ?? [];
  const sharedTask = restoredTask?.task ?? null;

  if (!sharedTask) {
    return state;
  }

  const clonedTask = { ...sharedTask, startedAt: now() };
  const targetIsIdle = targetState.status === TEAM_STATUS.CAN_ROLL && !targetState.currentTask;

  const nextState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        currentTask: { ...sharedTask, startedAt: now() },
        pendingTasks: restPending,
        status: TEAM_STATUS.TASK_ACTIVE,
        activePopup: {
          title: "Zuipmaatjes gekozen",
          body: `${targetState.name} voert nu dezelfde opdracht uit als jullie.`,
          kind: "fund",
          stage: "detail"
        }
      },
      [targetTeamId]: targetIsIdle
        ? {
            ...targetState,
            currentTask: clonedTask,
            status: TEAM_STATUS.TASK_ACTIVE,
            activePopup: {
              title: "Zuipmaatjes",
              body: `${teamState.name} heeft jullie gekozen als Zuipmaatjes. Voer dezelfde opdracht uit: ${clonedTask.body}`,
              kind: "fund",
              stage: "detail"
            }
          }
        : {
            ...targetState,
            pendingTasks: [...(targetState.pendingTasks ?? []), { kind: "task", task: clonedTask }],
            activePopup: {
              title: "Zuipmaatjes",
              body: `${teamState.name} heeft jullie gekozen als Zuipmaatjes. Jullie krijgen dezelfde opdracht zodra jullie huidige actie is afgerond.`,
              kind: "fund",
              stage: "detail"
            }
          }
    }
  };

  return logEvent(nextState, `${teamState.name} deelt de opdracht met ${targetState.name} (Zuipmaatjes).`);
}

// Escape als er geen enkel team kiesbaar is (cel/bescherming/gefinisht):
// de teamkeuze vervalt zonder effect.
export function resolveChoiceWithoutTarget(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (
      teamState?.status !== TEAM_STATUS.CHOOSING_TEAM ||
      getChoosableTeams(state, teamId).length > 0
    ) {
      return state;
    }
    const resolved = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: advanceTeamAfterResolution(state, {
          ...teamState,
          currentTask: null,
          activePopup: {
            title: "Geen team kiesbaar",
            body: "Er was geen team beschikbaar om te kiezen. De actie vervalt zonder effect.",
            kind: "info",
            stage: "detail"
          }
        })
      }
    };
    return activatePendingTileIfNeeded(resolved, teamId);
  });
}

/* ------------------------------------------------------------------ */
/* Power-ups                                                           */
/* ------------------------------------------------------------------ */

export function usePowerUp(teamId, powerUpId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const powerUp = teamState ? getSavedPowerUps(teamState).find((item) => item.id === powerUpId) : null;
    if (!teamState || !powerUp || teamState.awaitingApproval) {
      return state;
    }

    if (["skip_task", "skip_free"].includes(powerUp.type)) {
      // Wordt via skipTask ingezet (skip zonder straf).
      return state;
    }

    if (powerUp.type === "jail_free" && teamState.status === TEAM_STATUS.IN_JAIL) {
      const freed = logEvent(
        {
          ...state,
          teams: {
            ...state.teams,
            [teamId]: advanceTeamAfterResolution(state, {
              ...teamState,
              savedPowerUps: removeSavedPowerUp(teamState, powerUp.id),
              jailUntil: null,
              currentTask: null,
              activePopup: {
                title: "Celvrij gebruikt",
                body: "Jullie zijn direct uit de cel. Geen wachttijd en geen strafopdracht.",
                kind: "fund",
                stage: "detail"
              }
            })
          }
        },
        `${teamState.name} kocht zich vrij uit de cel.`
      );
      return freed;
    }

    if (
      powerUp.type === "uno_reverse" &&
      [TEAM_STATUS.CAN_ROLL, TEAM_STATUS.TASK_ACTIVE].includes(teamState.status)
    ) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUps: removeSavedPowerUp(teamState, powerUp.id),
            pendingTasks: teamState.currentTask
              ? [{ kind: "task", task: teamState.currentTask }, ...(teamState.pendingTasks ?? [])]
              : teamState.pendingTasks,
            currentTask: {
              title: "Uno Reverse",
              body: "Kies het team dat de wodka-Red Bull-opdracht krijgt.",
              presentation: "fund",
              effectType: "uno_reverse",
              skippable: false,
              timerSeconds: 0,
              startedAt: now()
            },
            status: TEAM_STATUS.CHOOSING_TEAM
          }
        }
      };
    }

    if (
      powerUp.type === "share_task" &&
      teamState.status === TEAM_STATUS.TASK_ACTIVE &&
      teamState.currentTask
    ) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUps: removeSavedPowerUp(teamState, powerUp.id),
            pendingTasks: [{ kind: "task", task: teamState.currentTask }, ...(teamState.pendingTasks ?? [])],
            currentTask: {
              title: "Zuipmaatjes",
              body: "Kies het team dat dezelfde opdracht met jullie mee moet doen.",
              presentation: "fund",
              effectType: "share_task",
              skippable: false,
              timerSeconds: 0,
              startedAt: now()
            },
            status: TEAM_STATUS.CHOOSING_TEAM
          }
        }
      };
    }

    // Shield werkt automatisch en is niet handmatig inzetbaar.
    return state;
  });
}

/* ------------------------------------------------------------------ */
/* Popups                                                              */
/* ------------------------------------------------------------------ */

export function dismissPopup(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState?.activePopup) {
      return state;
    }
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: { ...teamState, activePopup: null }
      }
    };
  });
}

export function revealPopupCard(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState?.activePopup) {
      return state;
    }
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          activePopup: { ...teamState.activePopup, stage: "detail" }
        }
      }
    };
  });
}

/* ------------------------------------------------------------------ */
/* Speciale opdrachtflows (Dock 17 & Café Van Ouds)                    */
/* ------------------------------------------------------------------ */

// Dock 17 om beurten: de speler die aan de beurt is (eerste zonder getal) kiest
// een nog vrij getal en ziet direct zijn drankje. De volgorde en het "geen
// dubbele getallen" worden hier afgedwongen, niet alleen in de UI.
export function pickDock17Number(teamId, number) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (
      !teamState ||
      teamState.status !== TEAM_STATUS.TASK_ACTIVE ||
      task?.specialFlow !== "dock17" ||
      task.dock17Revealed ||
      !Array.isArray(task.dock17Choices)
    ) {
      return state;
    }
    const picked = Number(number);
    if (!Number.isInteger(picked) || picked < 1 || picked > 17) {
      return state;
    }
    const current = task.dock17Choices.find((choice) => !choice.number);
    if (!current || task.dock17Choices.some((choice) => choice.number === picked)) {
      return state;
    }
    const choices = task.dock17Choices.map((choice) =>
      choice.id === current.id ? { ...choice, number: picked, drink: dock17DrinkFor(picked) } : choice
    );
    const allDone = choices.every((choice) => choice.number);
    const nextTeam = {
      ...teamState,
      currentTask: { ...task, dock17Choices: choices, dock17Revealed: allDone }
    };
    if (allDone) {
      nextTeam.activePopup = {
        title: "Dock17 onthuld",
        body: choices.map((choice) => `${choice.name}: ${choice.number} = ${choice.drink}`).join(" | "),
        kind: "task",
        stage: "detail"
      };
    }
    return { ...state, teams: { ...state.teams, [teamId]: nextTeam } };
  });
}

export function spinVanOudsWheel(teamId, choiceId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!teamState || task?.specialFlow !== "vanOuds") {
      return state;
    }
    const usedResults = new Set(task.vanOudsChoices.map((choice) => choice.result).filter(Boolean));
    const availableOptions = CAFE_VAN_OUDS_WHEEL_OPTIONS.filter((item) => !usedResults.has(item));
    const pool = availableOptions.length ? availableOptions : CAFE_VAN_OUDS_WHEEL_OPTIONS;
    const result = pool[Math.floor(Math.random() * pool.length)] ?? "Pils";
    const resultIndex = Math.max(CAFE_VAN_OUDS_WHEEL_OPTIONS.indexOf(result), 0);
    const choices = task.vanOudsChoices.map((choice) =>
      choice.id === choiceId && !choice.result ? { ...choice, result, resultIndex } : choice
    );
    const complete = choices.every((choice) => choice.result);
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: { ...task, vanOudsChoices: choices, vanOudsComplete: complete }
        }
      }
    };
  });
}

/* ------------------------------------------------------------------ */
/* Eindstand                                                           */
/* ------------------------------------------------------------------ */

export function getRanking(state) {
  return Object.values(state?.teams ?? {})
    .map((teamState) => ({ teamState }))
    .sort((a, b) => {
      if (b.teamState.completedRounds !== a.teamState.completedRounds) {
        return b.teamState.completedRounds - a.teamState.completedRounds;
      }
      if (b.teamState.position !== a.teamState.position) {
        return b.teamState.position - a.teamState.position;
      }
      return a.teamState.positionReachedAt - b.teamState.positionReachedAt;
    });
}

export function getTeamColorHex(teamState) {
  return findTeamColor(teamState?.colorId)?.hex ?? "#F0EEF4";
}

/* ------------------------------------------------------------------ */
/* Testmodus (demo): direct spelen met alle functies, zonder tweede    */
/* toestel. Draait volledig lokaal, sync wordt overgeslagen.           */
/* ------------------------------------------------------------------ */

const DEMO_ROOM_CODE = "TEST1";

const DEMO_OPPONENTS = [
  { name: "Team Tapstoring", colorId: "paars" },
  { name: "De Biermeesters", colorId: "ijsblauw" },
  { name: "Kelder & Co", colorId: "groen" }
];

export function startDemoGame() {
  const teamId = createId("team");
  const sessionId = createId("session");
  const startedAt = now();

  let state = createRoomState({
    roomCode: DEMO_ROOM_CODE,
    modeId: DEFAULT_MODE_ID,
    starterTeamId: teamId
  });
  state.isDemo = true;
  state.phase = GAME_PHASE.RUNNING;
  state.countdownStartedAt = startedAt - GAME_CONFIG.countdownSeconds * 1000;
  state.gameStartedAt = startedAt;

  const ownTeam = createTeamState({ id: teamId, name: "Testteam", colorId: "geel", playerCount: 3 });
  ownTeam.activeSessionId = sessionId;
  ownTeam.status = TEAM_STATUS.CAN_ROLL;
  state.teams[teamId] = ownTeam;

  for (const opponent of DEMO_OPPONENTS) {
    const botId = createId("team");
    const bot = createTeamState({ id: botId, name: opponent.name, colorId: opponent.colorId, playerCount: 3 });
    bot.activeSessionId = `bot_${botId}`;
    bot.status = TEAM_STATUS.CAN_ROLL;
    bot.position = 1 + Math.floor(Math.random() * 39);
    bot.normalTurnsUsed = 2 + Math.floor(Math.random() * 6);
    bot.completedRounds = Math.random() < 0.4 ? 1 : 0;
    state.teams[botId] = bot;
  }

  state = logEvent(state, "Testmodus gestart. Alle functies staan open.");
  window.localStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: DEMO_ROOM_CODE, teamId, sessionId }));
  window.localStorage.setItem(storageKey(DEMO_ROOM_CODE), JSON.stringify(state));
  emit();
  return { ok: true, teamId };
}

function demoOwnTeamId() {
  return getSession()?.teamId ?? null;
}

// Spring direct naar een vak en voer het uit (alsof je er gooit).
export function demoTeleport(tileId) {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    const teamState = state.teams[teamId];
    if (!state.isDemo || !teamState) {
      return state;
    }
    const position = Math.min(Math.max(Number(tileId) || 1, 1), GAME_CONFIG.boardSize);
    const cleared = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          position,
          positionReachedAt: now(),
          currentTask: null,
          pendingTasks: [],
          waitUntil: null,
          jailUntil: null,
          activePopup: null,
          status: TEAM_STATUS.TASK_ACTIVE
        }
      }
    };
    return arriveAtTile(cleared, teamId, { viaEffect: false });
  });
}

// Trek direct een Kans- of Fonds-kaart.
export function demoDrawCard(deckType) {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    const teamState = state.teams[teamId];
    if (!state.isDemo || !teamState) {
      return state;
    }
    const type = deckType === "fund" ? "fund" : "chance";
    const card = drawCardForTeam(type, teamState);
    const task = createTaskFromCard(card, type, teamState);
    const withTask = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: task,
          waitUntil: null,
          jailUntil: null,
          status: TEAM_STATUS.TASK_ACTIVE,
          oncePerTeamCardIds: markOncePerTeamCard(teamState, task),
          activePopup: {
            title: task.title,
            body: task.popup || task.body,
            kind: task.presentation,
            stage: "intro",
            cardId: task.cardId
          }
        }
      }
    };
    return applyImmediateTaskEffect(withTask, teamId);
  });
}

// Laat lopende timers (opdracht, wacht, cel) direct aflopen.
export function demoSkipTimer() {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    const teamState = state.teams[teamId];
    if (!state.isDemo || !teamState) {
      return state;
    }
    const next = { ...teamState };
    if (next.currentTask?.timerSeconds && next.currentTask.startedAt) {
      next.currentTask = {
        ...next.currentTask,
        startedAt: now() - (next.currentTask.timerSeconds + 2) * 1000
      };
    }
    if (next.waitUntil) {
      next.waitUntil = now() - 1000;
    }
    if (next.jailUntil) {
      next.jailUntil = now() - 1000;
    }
    return { ...state, teams: { ...state.teams, [teamId]: next } };
  });
}

// Geef alle power-up-soorten in één keer.
export function demoGivePowerUps() {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    const teamState = state.teams[teamId];
    if (!state.isDemo || !teamState) {
      return state;
    }
    const stamp = now();
    const all = [
      { type: "skip_task", label: "Opdracht overslaan", body: "Sla een opdracht over zonder straf. Daarna een bonusworp." },
      { type: "skip_free", label: "Gratis skip", body: "Skip één opdracht zonder de 2-vakjes-straf." },
      { type: "shield", label: "Geluksvogel", body: "Blokkeert automatisch de eerstvolgende Kans-, Fonds-, Wisselstation- of bonusactie van een ander team." },
      { type: "jail_free", label: "Celvrij", body: "Direct uit de echte cel, zonder wachttijd en strafopdracht." },
      { type: "uno_reverse", label: "Uno Reverse", body: "Wijs een ander team aan voor de wodka-Red Bull-opdracht." },
      { type: "share_task", label: "Zuipmaatjes", body: "Kies een team dat dezelfde opdracht met jullie mee moet doen." }
    ];
    const existing = new Set((teamState.savedPowerUps ?? []).map((powerUp) => powerUp.type));
    const added = all
      .filter((powerUp) => !existing.has(powerUp.type))
      .map((powerUp, index) => ({
        id: `demo-${powerUp.type}-${stamp + index}`,
        cardId: `demo-${powerUp.type}`,
        title: powerUp.label,
        label: powerUp.label,
        body: powerUp.body,
        type: powerUp.type
      }));
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          savedPowerUps: [...(teamState.savedPowerUps ?? []), ...added],
          activePopup: {
            title: "Power-ups ontvangen",
            body: "Alle power-up-soorten staan nu in jullie paneel. Probeer ze uit!",
            kind: "fund",
            stage: "detail"
          }
        }
      }
    };
  });
}

// Geef direct een engeltje (willekeurige power-up + popup), los van beurt 3/18.
export function demoAngel() {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    if (!state.isDemo || !state.teams[teamId]) {
      return state;
    }
    return giveAngelPowerUp(state, teamId, null);
  });
}

// Simuleer dat een ander team jullie raakt (schild blokkeert automatisch).
export function demoIncomingAttack(kind) {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    const teamState = state.teams[teamId];
    if (!state.isDemo || !teamState) {
      return state;
    }

    const shield = getShieldPowerUp(teamState);
    if (shield) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUps: removeSavedPowerUp(teamState, shield.id),
            activePopup: {
              title: "Geluksvogel",
              body: "Een ander team probeerde jullie te raken, maar Geluksvogel heeft de actie geblokkeerd. Deze power-up is nu gebruikt.",
              kind: "fund",
              stage: "detail"
            }
          }
        }
      };
    }

    if (kind === "move") {
      const cleared = {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: { ...teamState, currentTask: null, waitUntil: null }
        }
      };
      return moveTeamByDelta(cleared, teamId, -2, {
        viaEffect: true,
        source: "attack",
        popup: {
          title: "Jullie zijn geraakt",
          body: "Een ander team heeft jullie 2 vakjes achteruit gezet. Jullie oude opdracht vervalt en het nieuwe vakje wordt direct uitgevoerd.",
          kind: "chance",
          stage: "detail"
        }
      });
    }

    if (kind === "swap") {
      const bots = Object.values(state.teams).filter((team) => team.id !== teamId);
      const bot = bots[Math.floor(Math.random() * bots.length)];
      if (!bot) {
        return state;
      }
      const swappedAt = now();
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            position: bot.position,
            positionReachedAt: swappedAt,
            currentTask: null,
            waitUntil: swappedAt + GAME_CONFIG.swapWaitSeconds * 1000,
            status: TEAM_STATUS.WAITING_SWAP,
            activePopup: {
              title: "Jullie zijn gewisseld",
              body: "Jullie zijn gewisseld door een ander team. Jullie huidige opdracht vervalt. Wacht 3 minuten voordat jullie opnieuw mogen gooien.",
              kind: "swap",
              stage: "detail"
            }
          },
          [bot.id]: { ...bot, position: teamState.position, positionReachedAt: swappedAt }
        }
      };
    }

    if (kind === "jail") {
      const jailed = sendTeamToJail(state, teamId);
      return {
        ...jailed,
        teams: {
          ...jailed.teams,
          [teamId]: {
            ...jailed.teams[teamId],
            activePopup: {
              title: "Jullie zijn geraakt",
              body: "Jullie zijn naar de cel gestuurd.",
              kind: "chance",
              stage: "detail"
            }
          }
        }
      };
    }

    // standaard: wachttijd-aanval
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: null,
          waitUntil: now() + GAME_CONFIG.attackWaitSeconds * 1000,
          status: TEAM_STATUS.WAITING_TIMER,
          activePopup: {
            title: "Jullie zijn geraakt",
            body: "Een ander team heeft jullie uit de flow getrokken. Jullie huidige opdracht vervalt. Wacht 3 minuten voordat jullie opnieuw mogen gooien.",
            kind: "chance",
            stage: "detail"
          }
        }
      }
    };
  });
}

// Nog maar 1 normale beurt over (test Gefinisht-flow).
export function demoAlmostDone() {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    const teamState = state.teams[teamId];
    if (!state.isDemo || !teamState) {
      return state;
    }
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: { ...teamState, normalTurnsUsed: maxTurnsForState(state) - 1 }
      }
    };
  });
}

// Alle tegenstanders gefinisht (test eindstand + winnaarbepaling).
export function demoFinishOpponents() {
  return updateState((state) => {
    const teamId = demoOwnTeamId();
    if (!state.isDemo) {
      return state;
    }
    const teams = { ...state.teams };
    for (const [id, team] of Object.entries(teams)) {
      if (id !== teamId) {
        teams[id] = {
          ...team,
          normalTurnsUsed: maxTurnsForState(state),
          currentTask: null,
          pendingTasks: [],
          waitUntil: null,
          jailUntil: null,
          pendingBonusRoll: false,
          status: TEAM_STATUS.FINISHED,
          finishedAt: team.finishedAt ?? now()
        };
      }
    }
    return { ...state, teams };
  });
}

// Testschakelaar: speel de testmodus met of zonder spelleider. Aanzetten kan
// alleen lokaal; uitzetten ruimt wachtend bewijs op.
export function demoSetLeaderMode(enabled) {
  return updateState((state) => {
    if (!state.isDemo) {
      return state;
    }
    const teams = {};
    for (const [id, team] of Object.entries(state.teams)) {
      teams[id] = enabled ? team : { ...team, awaitingApproval: null };
    }
    return { ...state, teams, leaderMode: Boolean(enabled) };
  });
}

window.addEventListener("storage", (event) => {
  if (event.key?.startsWith(ROOM_KEY_PREFIX) || event.key === SESSION_KEY) {
    emit();
  }
});
