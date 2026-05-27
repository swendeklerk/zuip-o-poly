import { GAME_CONFIG } from "../data/gameConfig.js";
import { CARD_DECKS, drawCard } from "../data/cards.js";
import { createTaskForTile, REJECTION_PENALTY } from "../data/tasks.js";
import { TEAMS, findKroegraad, findTeamByCode, findTeamById, findTeamByLogin } from "../data/teams.js";
import { findTileById } from "../data/tiles.js";
import { GAME_PHASE, TEAM_STATUS } from "../data/statuses.js";
import {
  loadRemoteGameState,
  saveRemoteGameState,
  subscribeRemoteGameState
} from "../services/remoteGameState.js";

const STORAGE_KEY = "zuipopoly.mvp1.gameState";
const SESSION_KEY = "zuipopoly.mvp1.currentSession";
const listeners = new Set();
let remoteSyncReady = false;
let applyingRemoteState = false;
let remoteUnsubscribe = null;

function hasUsableRemoteState(state) {
  return Boolean(
    state?.teams &&
      state?.phase &&
      TEAMS.every((team) => state.teams[team.id])
  );
}

function now() {
  return Date.now();
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `session_${Math.random().toString(36).slice(2)}_${now()}`;
}

function createTeamState(team) {
  return {
    teamId: team.id,
    loggedIn: false,
    activeSessionId: null,
    loggedInAt: null,
    status: TEAM_STATUS.WAITING_START,
    position: GAME_CONFIG.startTileId,
    currentTileId: GAME_CONFIG.startTileId,
    completedRounds: 0,
    positionReachedAt: now(),
    normalTurnsUsed: 0,
    lastRoll: null,
    currentTask: null,
    activePopup: null,
    savedPowerUp: null,
    rejectionPenalty: null,
    proofInWhatsapp: false,
    pendingBonusRoll: false,
    jailUntil: null,
    waitUntil: null,
    lastStreetTileId: null,
    lastMove: null
  };
}

function createDefaultState() {
  return {
    version: 1,
    phase: GAME_PHASE.PRESTART,
    countdownStartedAt: null,
    gameStartedAt: null,
    timerFinishedAt: null,
    paused: false,
    pausedAt: null,
    totalPausedMs: 0,
    teams: Object.fromEntries(TEAMS.map((team) => [team.id, createTeamState(team)]))
  };
}

function normalizeState(input) {
  const base = createDefaultState();
  const state = {
    ...base,
    ...input,
    teams: {}
  };

  for (const team of TEAMS) {
    state.teams[team.id] = {
      ...createTeamState(team),
      ...(input?.teams?.[team.id] ?? {})
    };
  }

  return state;
}

export function getState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createDefaultState();
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  if (remoteSyncReady && !applyingRemoteState) {
    saveRemoteGameState(normalizeState(state));
  }
  emit();
}

function updateState(updater) {
  const current = tickState(getState());
  const next = updater(current);
  saveState(next);
  return next;
}

function emit() {
  for (const listener of listeners) {
    listener(getState());
  }
}

function tickState(state) {
  if (state.phase === GAME_PHASE.RUNNING && isTurnLimitGameComplete(state) && !state.timerFinishedAt) {
    const finishedState = {
      ...state,
      timerFinishedAt: now(),
      teams: { ...state.teams }
    };

    for (const team of TEAMS) {
      const teamState = finishedState.teams[team.id];
      finishedState.teams[team.id] = {
        ...teamState,
        status: TEAM_STATUS.FINISHED,
        activePopup: {
          title: "Spel afgelopen",
          body: "De speeltijd zit erop. Kom naar De Tempelier in Nijmegen. De Kroegraad maakt daar de winnaar bekend.",
          kind: "finished"
        }
      };
    }

    return finishedState;
  }

  if (state.phase === GAME_PHASE.COUNTDOWN && state.countdownStartedAt) {
    const elapsedSeconds = Math.floor((now() - state.countdownStartedAt) / 1000);
    if (elapsedSeconds < GAME_CONFIG.countdownSeconds) {
      return state;
    }

    const startedState = {
      ...state,
      phase: GAME_PHASE.RUNNING,
      gameStartedAt: state.countdownStartedAt + GAME_CONFIG.countdownSeconds * 1000,
      teams: { ...state.teams }
    };

    for (const team of TEAMS) {
      const teamState = startedState.teams[team.id];
      startedState.teams[team.id] = {
        ...teamState,
        status:
          teamState.status === TEAM_STATUS.WAITING_START
            ? TEAM_STATUS.CAN_ROLL
            : teamState.status
      };
    }

    return startedState;
  }

  if (state.phase === GAME_PHASE.RUNNING) {
    let nextState = state;

    for (const team of TEAMS) {
      const teamState = nextState.teams[team.id];

      if (
        teamState.status === TEAM_STATUS.WAITING_SWAP &&
        teamState.waitUntil &&
        now() >= teamState.waitUntil
      ) {
        nextState = {
          ...nextState,
          teams: {
            ...nextState.teams,
            [team.id]: {
              ...teamState,
              waitUntil: null,
              currentTask: null,
              status: getApprovedNextStatus(nextState, teamState)
            }
          }
        };
      }

      if (
        teamState.status === TEAM_STATUS.IN_JAIL &&
        teamState.jailUntil &&
        now() >= teamState.jailUntil
      ) {
        nextState = {
          ...nextState,
          teams: {
            ...nextState.teams,
            [team.id]: {
              ...teamState,
              jailUntil: null,
              currentTask: {
                title: "Strafopdracht cel",
                body: "Loop een volledig rondje om het Keizer Karelplein. Bewijs via WhatsApp.",
                placeholder: false,
                presentation: "jail"
              },
              activePopup: {
                title: "Strafopdracht",
                body: "Loop een volledig rondje om het Keizer Karelplein. Bewijs via WhatsApp.",
                kind: "task",
                stage: "detail"
              },
              status: TEAM_STATUS.TASK_ACTIVE
            }
          }
        };
      }
    }

    if (nextState !== state) {
      return nextState;
    }
  }

  return state;
}

export function runClockTick() {
  const current = getState();
  const next = tickState(current);
  if (next !== current) {
    saveState(next);
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(getState());

  return () => {
    listeners.delete(listener);
  };
}

export async function initializeRemoteSync() {
  if (remoteSyncReady) {
    return { ok: true, mode: "remote" };
  }

  const remoteState = await loadRemoteGameState();
  if (hasUsableRemoteState(remoteState)) {
    applyingRemoteState = true;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(remoteState)));
    applyingRemoteState = false;
    emit();
  } else {
    const didSave = await saveRemoteGameState(getState());
    if (!didSave) {
      return { ok: false, mode: "local" };
    }
  }

  remoteUnsubscribe = await subscribeRemoteGameState((state) => {
    applyingRemoteState = true;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
    applyingRemoteState = false;
    emit();
  });

  remoteSyncReady = true;
  return { ok: true, mode: "remote" };
}

export function stopRemoteSync() {
  if (remoteUnsubscribe) {
    remoteUnsubscribe();
  }
  remoteUnsubscribe = null;
  remoteSyncReady = false;
}

export function getCurrentSession() {
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setCurrentSession(session) {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emit();
}

export function clearCurrentSession() {
  window.sessionStorage.removeItem(SESSION_KEY);
  emit();
}

export function startTeamDemo(teamId = "team_bruine_kroeg") {
  const team = findTeamById(teamId);
  if (!team) {
    return { ok: false, message: "Onbekend demoteam." };
  }

  const sessionId = createId();
  const startedAt = now();
  const teamEntries = Object.fromEntries(
    TEAMS.map((item) => [
      item.id,
      {
        ...createTeamState(item),
        loggedIn: true,
        activeSessionId: item.id === team.id ? sessionId : `demo_${item.id}`,
        loggedInAt: startedAt,
        status: TEAM_STATUS.CAN_ROLL
      }
    ])
  );

  saveState({
    ...createDefaultState(),
    phase: GAME_PHASE.RUNNING,
    countdownStartedAt: startedAt - GAME_CONFIG.countdownSeconds * 1000,
    gameStartedAt: startedAt,
    teams: teamEntries
  });
  setCurrentSession({ role: "team", teamId: team.id, sessionId, demo: true });

  return { ok: true, team };
}

export function startLobbyDemo(teamId = "team_bruine_kroeg") {
  const team = findTeamById(teamId);
  if (!team) {
    return { ok: false, message: "Onbekend demoteam." };
  }

  const sessionId = createId();
  const loggedInAt = now();
  const teamEntries = Object.fromEntries(
    TEAMS.map((item) => [
      item.id,
      {
        ...createTeamState(item),
        loggedIn: true,
        activeSessionId: item.id === team.id ? sessionId : `demo_lobby_${item.id}`,
        loggedInAt,
        status: TEAM_STATUS.WAITING_START
      }
    ])
  );

  saveState({
    ...createDefaultState(),
    phase: GAME_PHASE.PRESTART,
    teams: teamEntries
  });
  setCurrentSession({ role: "team", teamId: team.id, sessionId, demo: true });

  return { ok: true, team };
}

export function startFinishedDemo(teamId = "team_bruine_kroeg") {
  const team = findTeamById(teamId);
  if (!team) {
    return { ok: false, message: "Onbekend demoteam." };
  }

  const sessionId = createId();
  const endedAt = now();
  const demoPositions = {
    team_bruine_kroeg: { completedRounds: 2, position: 14, lastRoll: 5 },
    team_zwarte_pint: { completedRounds: 1, position: 39, lastRoll: 3 },
    team_witte_batavus: { completedRounds: 2, position: 8, lastRoll: 6 }
  };
  const teamEntries = Object.fromEntries(
    TEAMS.map((item) => {
      const demo = demoPositions[item.id] ?? { completedRounds: 0, position: GAME_CONFIG.startTileId, lastRoll: null };
      return [
        item.id,
        {
          ...createTeamState(item),
          loggedIn: true,
          activeSessionId: item.id === team.id ? sessionId : `demo_finished_${item.id}`,
          loggedInAt: endedAt - 30 * 60 * 1000,
          status: TEAM_STATUS.FINISHED,
          position: demo.position,
          currentTileId: demo.position,
          completedRounds: demo.completedRounds,
          positionReachedAt: endedAt - demo.position * 1000,
          normalTurnsUsed: GAME_CONFIG.maxNormalTurns,
          lastRoll: demo.lastRoll,
          activePopup: {
            title: "Spel afgelopen",
            body: "Kom naar De Tempelier in Nijmegen. De Kroegraad maakt daar de winnaar bekend.",
            kind: "finished"
          }
        }
      ];
    })
  );

  saveState({
    ...createDefaultState(),
    phase: GAME_PHASE.RUNNING,
    countdownStartedAt: endedAt - GAME_CONFIG.countdownSeconds * 1000,
    gameStartedAt: endedAt - 2 * 60 * 60 * 1000,
    timerFinishedAt: endedAt,
    teams: teamEntries
  });
  setCurrentSession({ role: "team", teamId: team.id, sessionId, demo: true });

  return { ok: true, team };
}

export function loginTeam(code) {
  const team = findTeamByCode(code);
  if (!team) {
    return {
      ok: false,
      message: "Deze teamcode herken ik niet. Gebruik BRUINEKROEG, ZWARTEPINT of WITTEBATAVUS."
    };
  }

  const state = getState();
  const teamState = state.teams[team.id];
  if (teamState?.activeSessionId) {
    return {
      ok: false,
      message:
        "Dit team is al ingelogd. Voor lokaal testen: open opnieuw met ?reset=1. Tijdens de echte avond kan de Kroegraad de sessie vrijgeven."
    };
  }

  const sessionId = createId();
  updateState((draft) => ({
    ...draft,
    teams: {
      ...draft.teams,
      [team.id]: {
        ...draft.teams[team.id],
        loggedIn: true,
        activeSessionId: sessionId,
        loggedInAt: draft.teams[team.id].loggedInAt ?? now()
      }
    }
  }));

  setCurrentSession({ role: "team", teamId: team.id, sessionId });
  return { ok: true, team };
}

export function loginTeamWithPassword(teamId, password) {
  const selectedTeam = findTeamById(teamId);
  if (!selectedTeam) {
    return { ok: false, message: "Kies eerst een team." };
  }

  const team = findTeamByLogin(teamId, password);
  if (!team) {
    return { ok: false, message: "Verkeerd wachtwoord. Gebruik 0000." };
  }

  const state = getState();
  const teamState = state.teams[team.id];
  if (teamState?.activeSessionId) {
    return {
      ok: false,
      message:
        "Dit team is al ingelogd. Voor lokaal testen: open opnieuw met ?reset=1. Tijdens de echte avond kan de Kroegraad de sessie vrijgeven."
    };
  }

  const sessionId = createId();
  updateState((draft) => ({
    ...draft,
    teams: {
      ...draft.teams,
      [team.id]: {
        ...draft.teams[team.id],
        loggedIn: true,
        activeSessionId: sessionId,
        loggedInAt: draft.teams[team.id].loggedInAt ?? now()
      }
    }
  }));

  setCurrentSession({ role: "team", teamId: team.id, sessionId });
  return { ok: true, team };
}

export function loginKroegraad(loginName, code) {
  const user = findKroegraad(loginName, code);
  if (!user) {
    return { ok: false, message: "Loginnaam of code klopt niet." };
  }

  setCurrentSession({ role: "kroegraad", kroegraadId: user.id });
  return { ok: true, user };
}

export function resetPreparation(options = {}) {
  return updateState((state) => {
    if (!options.force && state.phase !== GAME_PHASE.PRESTART) {
      return state;
    }

    return createDefaultState();
  });
}

export function allTeamsLoggedIn(state = getState()) {
  return TEAMS.every((team) => state.teams[team.id]?.loggedIn);
}

export function startCountdown() {
  return updateState((state) => {
    if (state.phase !== GAME_PHASE.PRESTART || !allTeamsLoggedIn(state)) {
      return state;
    }

    return {
      ...state,
      phase: GAME_PHASE.COUNTDOWN,
      countdownStartedAt: now()
    };
  });
}

export function getCountdownRemaining(state = getState()) {
  if (state.phase !== GAME_PHASE.COUNTDOWN || !state.countdownStartedAt) {
    return null;
  }

  const elapsedSeconds = Math.floor((now() - state.countdownStartedAt) / 1000);
  return Math.max(GAME_CONFIG.countdownSeconds - elapsedSeconds, 0);
}

export function getGameRemainingSeconds(state = getState()) {
  if (!state.gameStartedAt) {
    return GAME_CONFIG.gameDurationSeconds;
  }

  const activePausedMs = state.paused && state.pausedAt ? now() - state.pausedAt : 0;
  const elapsedSeconds = Math.floor(
    (now() - state.gameStartedAt - state.totalPausedMs - activePausedMs) / 1000
  );
  return Math.max(GAME_CONFIG.gameDurationSeconds - elapsedSeconds, 0);
}

export function isGameTimeUp(state = getState()) {
  return state.phase === GAME_PHASE.RUNNING && Boolean(state.timerFinishedAt);
}

function isOpenTaskStatus(status) {
  return [
    TEAM_STATUS.TASK_ACTIVE,
    TEAM_STATUS.WAITING_KROEGRAAD,
    TEAM_STATUS.REJECTED,
    TEAM_STATUS.IN_JAIL,
    TEAM_STATUS.WAITING_SWAP
  ].includes(status);
}

function hasTeamReachedTurnLimit(teamState) {
  return (teamState?.normalTurnsUsed ?? 0) >= GAME_CONFIG.maxNormalTurns;
}

function isTurnLimitGameComplete(state) {
  if (state.phase !== GAME_PHASE.RUNNING) {
    return false;
  }

  return TEAMS.every((team) => {
    const teamState = state.teams[team.id];
    return hasTeamReachedTurnLimit(teamState) && !isOpenTaskStatus(teamState.status);
  });
}

function getApprovedNextStatus(state, teamState) {
  if (state.timerFinishedAt || hasTeamReachedTurnLimit(teamState)) {
    return TEAM_STATUS.FINISHED;
  }

  return TEAM_STATUS.APPROVED;
}

function normalizeBoardPosition(rawPosition) {
  return {
    position: ((rawPosition - 1) % 40) + 1,
    roundsGained: Math.floor((rawPosition - 1) / 40)
  };
}

function createTaskFromCard(card, presentation) {
  return {
    title: card.title,
    body: card.body,
    placeholder: card.effectType !== "task",
    presentation,
    cardId: card.id,
    effectType: card.effectType,
    delta: card.delta ?? 0,
    waitSeconds: card.waitSeconds ?? null,
    powerUpLabel: card.powerUpLabel,
    savedPowerUpType: card.savedPowerUpType
  };
}

function moveTeamByDelta(state, teamId, delta, options = {}) {
  const teamState = state.teams[teamId];
  const rawPosition = teamState.position + delta;
  const { position, roundsGained } = normalizeBoardPosition(rawPosition);
  const tile = findTileById(position);
  const task = createTaskFromTileBehavior(tile);
  const movedAt = now();

  const movedState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        position,
        currentTileId: position,
        completedRounds: teamState.completedRounds + roundsGained,
        positionReachedAt: movedAt,
        currentTask: task,
        activePopup: options.keepPopup ? teamState.activePopup : null,
        rejectionPenalty: null,
        proofInWhatsapp: false,
        lastStreetTileId: tile.type === "Straatvak" ? position : teamState.lastStreetTileId,
        lastMove: {
          roll: teamState.lastMove?.roll ?? teamState.lastRoll,
          from: teamState.position,
          to: position,
          roundsGained,
          crossedStart: roundsGained > 0,
          tileName: tile.name,
          movedAt,
          source: options.source ?? "card"
        },
        status: TEAM_STATUS.TASK_ACTIVE
      }
    }
  };

  if (position === 11 || position === 31) {
    return sendTeamToJail(movedState, teamId);
  }

  return movedState;
}

function moveTeamToTile(state, teamId, position, options = {}) {
  const teamState = state.teams[teamId];
  const tile = findTileById(position);
  const task = createTaskFromTileBehavior(tile);
  const movedAt = now();

  return {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        position,
        currentTileId: position,
        positionReachedAt: movedAt,
        currentTask: task,
        activePopup: options.keepPopup ? teamState.activePopup : null,
        rejectionPenalty: null,
        proofInWhatsapp: false,
        lastStreetTileId: tile.type === "Straatvak" ? position : teamState.lastStreetTileId,
        lastMove: {
          roll: teamState.lastMove?.roll ?? teamState.lastRoll,
          from: teamState.position,
          to: position,
          roundsGained: 0,
          crossedStart: false,
          tileName: tile.name,
          movedAt,
          source: options.source ?? "card"
        },
        status: TEAM_STATUS.TASK_ACTIVE
      }
    }
  };
}

function sendTeamToJail(state, teamId) {
  const teamState = state.teams[teamId];
  const jailUntil = now() + 4 * 60 * 1000;

  return {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        position: 11,
        currentTileId: 11,
        positionReachedAt: now(),
        jailUntil,
        proofInWhatsapp: false,
        rejectionPenalty: null,
        activePopup: teamState.activePopup,
        currentTask: {
          title: "Echte cel",
          body: "Jullie zitten in de cel. Wacht 4 minuten. Daarna krijgen jullie je strafopdracht.",
          placeholder: false,
          presentation: "jail"
        },
        status: TEAM_STATUS.IN_JAIL
      }
    }
  };
}

function createTaskForCurrentTile(teamState) {
  return createTaskFromTileBehavior(findTileById(teamState.currentTileId));
}

function setTargetNotification(state, teamId, title, body, kind = "chance") {
  const teamState = state.teams[teamId];
  return {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: {
        ...teamState,
        activePopup: {
          title,
          body,
          kind,
          stage: "detail"
        }
      }
    }
  };
}

function applyImmediateTaskEffect(state, teamId) {
  const teamState = state.teams[teamId];
  const task = teamState?.currentTask;
  if (!task) {
    return state;
  }

  if (teamState.currentTileId === 31) {
    return sendTeamToJail(state, teamId);
  }

  if (task.effectType === "move_self") {
    return moveTeamByDelta(state, teamId, task.delta, { keepPopup: true, source: task.presentation });
  }

  if (task.effectType === "return_previous_street") {
    return moveTeamToTile(state, teamId, teamState.lastStreetTileId ?? teamState.position, {
      keepPopup: true,
      source: task.presentation
    });
  }

  if (task.effectType === "jail_self") {
    return sendTeamToJail(state, teamId);
  }

  if (task.effectType === "bonus_roll") {
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          pendingBonusRoll: true,
          proofInWhatsapp: false,
          status: TEAM_STATUS.APPROVED
        }
      }
    };
  }

  if (task.effectType === "saved_powerup") {
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          savedPowerUp: {
            id: task.cardId,
            title: task.title,
            label: task.powerUpLabel ?? task.title,
            body: task.body,
            type: task.savedPowerUpType
          },
          proofInWhatsapp: false,
          status: TEAM_STATUS.APPROVED
        }
      }
    };
  }

  return state;
}

function isProtectedFromTeamChoice(teamState) {
  return (
    teamState?.status === TEAM_STATUS.IN_JAIL ||
    teamState?.status === TEAM_STATUS.FINISHED ||
    teamState?.savedPowerUp?.type === "shield"
  );
}

export function getTeamState(teamId, state = getState()) {
  const team = findTeamById(teamId);
  if (!team) {
    return null;
  }

  return state.teams[teamId];
}

export function rollDice(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const canRoll =
      state.phase === GAME_PHASE.RUNNING &&
      !state.paused &&
      !state.timerFinishedAt &&
      (teamState?.pendingBonusRoll || !hasTeamReachedTurnLimit(teamState)) &&
      [TEAM_STATUS.CAN_ROLL, TEAM_STATUS.APPROVED].includes(teamState?.status);

    if (!canRoll) {
      return state;
    }

    const isBonusRoll = Boolean(teamState.pendingBonusRoll);
    const roll = Math.floor(Math.random() * 6) + 1;
    const rawPosition = teamState.position + roll;
    const { position: nextPosition, roundsGained } = normalizeBoardPosition(rawPosition);
    const completedRounds = teamState.completedRounds + roundsGained;
    const tile = findTileById(nextPosition);
    const task = createTaskFromTileBehavior(tile);
    const movedAt = now();
    const nextState = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          position: nextPosition,
          currentTileId: nextPosition,
          completedRounds,
          positionReachedAt: movedAt,
          normalTurnsUsed: teamState.normalTurnsUsed + (isBonusRoll ? 0 : 1),
          pendingBonusRoll: false,
          lastRoll: roll,
          currentTask: task,
          activePopup: ["chance", "fund", "swap"].includes(task.presentation)
            ? {
                title: task.title,
                body: task.body,
                kind: task.presentation,
                stage: "intro",
                cardId: task.cardId
              }
            : null,
          rejectionPenalty: null,
          proofInWhatsapp: false,
          lastStreetTileId: tile.type === "Straatvak" ? nextPosition : teamState.lastStreetTileId,
          lastMove: {
            roll,
            from: teamState.position,
            to: nextPosition,
            roundsGained,
            crossedStart: roundsGained > 0,
            tileName: tile.name,
            movedAt
          },
          status: TEAM_STATUS.TASK_ACTIVE
        }
      }
    };

    return applyImmediateTaskEffect(nextState, teamId);
  });
}

function createTaskFromTileBehavior(tile) {
  if (tile.type === "Kans") {
    const card = drawCard("chance");
    return createTaskFromCard(card, "chance");
  }

  if (tile.type === "Algemeen Fonds") {
    const card = drawCard("fund");
    return createTaskFromCard(card, "fund");
  }

  if (tile.type === "Wisselstation") {
    return {
      title: "Wisselstation",
      body:
        "Kies een ander team om mee te wisselen. Het gekozen team stopt direct met de huidige opdracht, krijgt geen nieuwe opdracht en moet 3 minuten wachten. Jullie mogen daarna direct opnieuw gooien.",
      placeholder: false,
      presentation: "swap",
      cardId: `wisselstation-${tile.id}`,
      effectType: "wisselstation",
      waitSeconds: 180
    };
  }

  return createTaskForTile(tile);
}

export function dismissTeamPopup(teamId) {
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
          activePopup: null
        }
      }
    };
  });
}

export function revealTeamPopupCard(teamId) {
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
          activePopup: {
            ...teamState.activePopup,
            stage: "detail"
          }
        }
      }
    };
  });
}

export function applyTeamChoiceEffect(teamId, targetTeamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const targetState = state.teams[targetTeamId];
    const task = teamState?.currentTask;
    if (!teamState || !targetState || !task || teamId === targetTeamId) {
      return state;
    }

    if (isProtectedFromTeamChoice(targetState)) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            activePopup: {
              ...teamState.activePopup,
              stage: "detail",
              blockedChoiceMessage: "Dit team is tijdelijk beschermd. Kies een ander team."
            }
          }
        }
      };
    }

    if (task.effectType === "team_choice_move") {
      let movedState = moveTeamByDelta(state, targetTeamId, task.delta, {
        keepPopup: false,
        source: task.presentation
      });
      const movedTarget = movedState.teams[targetTeamId];
      movedState = setTargetNotification(
        movedState,
        targetTeamId,
        "Jullie zijn geraakt",
        `Een ander team heeft jullie ${Math.abs(task.delta)} vakjes ${task.delta < 0 ? "terug" : "vooruit"} gezet. Jullie oude opdracht vervalt en het nieuwe vakje wordt direct uitgevoerd.`,
        task.presentation ?? "chance"
      );

      return {
        ...movedState,
        teams: {
          ...movedState.teams,
          [teamId]: {
            ...teamState,
            activePopup: {
              title: "Team geraakt",
              body: `${findTeamById(targetTeamId)?.name ?? "Het gekozen team"} is verplaatst. Jullie kaart is uitgevoerd.`,
              kind: task.presentation ?? "chance",
              stage: "detail"
            },
            currentTask: null,
            proofInWhatsapp: false,
            status: getApprovedNextStatus(state, teamState)
          },
          [targetTeamId]: {
            ...movedState.teams[targetTeamId],
            lastMove: movedTarget.lastMove
          }
        }
      };
    }

    if (task.effectType === "team_choice_wait") {
      const waitUntil = now() + (task.waitSeconds ?? 180) * 1000;
      const targetName = findTeamById(targetTeamId)?.name ?? "Het gekozen team";
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            activePopup: {
              title: "Team geraakt",
              body: `${targetName} moet 3 minuten wachten. Hun huidige opdracht is vervallen.`,
              kind: task.presentation ?? "chance",
              stage: "detail"
            },
            currentTask: null,
            proofInWhatsapp: false,
            status: getApprovedNextStatus(state, teamState)
          },
          [targetTeamId]: {
            ...targetState,
            currentTask: {
              title: "Jullie zijn geraakt",
              body: "Jullie huidige opdracht vervalt. Wacht 3 minuten voordat jullie opnieuw mogen gooien.",
              placeholder: false,
              presentation: "wait"
            },
            waitUntil,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: TEAM_STATUS.WAITING_SWAP,
            activePopup: {
              title: "Jullie zijn geraakt",
              body: "Een ander team heeft jullie uit de flow getrokken. Jullie huidige opdracht vervalt. Wacht 3 minuten voordat jullie opnieuw mogen gooien.",
              kind: task.presentation ?? "chance",
              stage: "detail"
            }
          }
        }
      };
    }

    if (task.effectType === "wisselstation") {
      const waitUntil = now() + (task.waitSeconds ?? 180) * 1000;
      const swappedAt = now();
      const actorOldPosition = teamState.position;
      const targetOldPosition = targetState.position;
      const targetName = findTeamById(targetTeamId)?.name ?? "Het gekozen team";
      const baseState = {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            position: targetOldPosition,
            currentTileId: targetOldPosition,
            positionReachedAt: swappedAt,
            currentTask: null,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: getApprovedNextStatus(state, teamState),
            activePopup: {
              title: "Wisselstation gelukt",
              body: `Jullie zijn gewisseld met ${targetName}. Jullie mogen direct opnieuw gooien.`,
              kind: "swap",
              stage: "detail"
            }
          },
          [targetTeamId]: {
            ...targetState,
            position: actorOldPosition,
            currentTileId: actorOldPosition,
            positionReachedAt: swappedAt,
            currentTask: {
              title: "Gewisseld door Wisselstation",
              body: "Jullie zijn gewisseld door een ander team. Jullie huidige opdracht vervalt. Wacht 3 minuten voordat jullie opnieuw mogen gooien.",
              placeholder: false,
              presentation: "wait"
            },
            waitUntil,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: TEAM_STATUS.WAITING_SWAP,
            activePopup: {
              title: "Jullie zijn gewisseld",
              body: "Jullie zijn gewisseld door een ander team. Jullie huidige opdracht vervalt. Wacht 3 minuten voordat jullie opnieuw mogen gooien.",
              kind: "swap",
              stage: "detail"
            }
          }
        }
      };

      if (actorOldPosition === 31) {
        return sendTeamToJail(baseState, targetTeamId);
      }

      return baseState;
    }

    if (task.effectType === "swap_positions") {
      const actorTile = findTileById(targetState.position);
      const targetTile = findTileById(teamState.position);
      const actorTask = createTaskFromTileBehavior(actorTile);
      const targetTask = createTaskFromTileBehavior(targetTile);
      const swappedAt = now();
      const targetName = findTeamById(targetTeamId)?.name ?? "Het gekozen team";

      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            position: targetState.position,
            currentTileId: targetState.position,
            positionReachedAt: swappedAt,
            currentTask: actorTask,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: TEAM_STATUS.TASK_ACTIVE,
            activePopup: {
              title: "Wisseltruc gelukt",
              body: `Jullie zijn gewisseld met ${targetName}. Jullie voeren nu het nieuwe vakje direct uit.`,
              kind: "fund",
              stage: "detail"
            }
          },
          [targetTeamId]: {
            ...targetState,
            position: teamState.position,
            currentTileId: teamState.position,
            positionReachedAt: swappedAt,
            currentTask: targetTask,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: TEAM_STATUS.TASK_ACTIVE,
            activePopup: {
              title: "Jullie zijn gewisseld",
              body: "Een ander team heeft Wisseltruc gebruikt. Jullie oude opdracht vervalt en jullie voeren nu het nieuwe vakje direct uit.",
              kind: "fund",
              stage: "detail"
            }
          }
        }
      };
    }

    return state;
  });
}

export function submitProofInWhatsapp(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (state.paused || ![TEAM_STATUS.TASK_ACTIVE, TEAM_STATUS.REJECTED].includes(teamState?.status)) {
      return state;
    }

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          proofInWhatsapp: true,
          activePopup: null,
          status: TEAM_STATUS.WAITING_KROEGRAAD
        }
      }
    };
  });
}

export function approveTeamTask(kroegraadId, teamId) {
  return updateState((state) => {
    const team = findTeamById(teamId);
    const teamState = state.teams[teamId];
    if (team?.kroegraadId !== kroegraadId || teamState?.status !== TEAM_STATUS.WAITING_KROEGRAAD) {
      return state;
    }

    const approvedPowerUp =
      teamState.currentTask?.presentation === "fund" &&
      teamState.currentTask?.effectType === "saved_powerup"
        ? {
            id: teamState.currentTask.cardId,
            title: teamState.currentTask.title,
            label: teamState.currentTask.powerUpLabel ?? teamState.currentTask.title,
            body: teamState.currentTask.body
          }
        : teamState.savedPowerUp;

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          proofInWhatsapp: false,
          activePopup: null,
          savedPowerUp: approvedPowerUp,
          rejectionPenalty: null,
          status: getApprovedNextStatus(state, teamState)
        }
      }
    };
  });
}

export function rejectTeamTask(kroegraadId, teamId) {
  return updateState((state) => {
    const team = findTeamById(teamId);
    const teamState = state.teams[teamId];
    if (team?.kroegraadId !== kroegraadId || teamState?.status !== TEAM_STATUS.WAITING_KROEGRAAD) {
      return state;
    }

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          proofInWhatsapp: false,
          activePopup: {
            title: "Afgekeurd",
            body: REJECTION_PENALTY,
            kind: "rejected"
          },
          rejectionPenalty: REJECTION_PENALTY,
          status: TEAM_STATUS.REJECTED
        }
      }
    };
  });
}

export function togglePause(kroegraadId) {
  if (!["SWEN", "LARS"].includes(kroegraadId)) {
    return getState();
  }

  return updateState((state) => {
    if (state.phase !== GAME_PHASE.RUNNING || state.timerFinishedAt) {
      return state;
    }

    if (state.paused) {
      return {
        ...state,
        paused: false,
        totalPausedMs: state.totalPausedMs + (state.pausedAt ? now() - state.pausedAt : 0),
        pausedAt: null
      };
    }

    return {
      ...state,
      paused: true,
      pausedAt: now()
    };
  });
}

export function releaseTeamSession(kroegraadId, teamId) {
  return updateState((state) => {
    const team = findTeamById(teamId);
    const teamState = state.teams[teamId];
    if (!teamState || team?.kroegraadId !== kroegraadId) {
      return state;
    }

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          loggedIn: false,
          activeSessionId: null
        }
      }
    };
  });
}

export function getRanking(state = getState()) {
  return TEAMS.map((team) => ({
    team,
    teamState: state.teams[team.id]
  })).sort((a, b) => {
    if (b.teamState.completedRounds !== a.teamState.completedRounds) {
      return b.teamState.completedRounds - a.teamState.completedRounds;
    }

    if (b.teamState.position !== a.teamState.position) {
      return b.teamState.position - a.teamState.position;
    }

    return a.teamState.positionReachedAt - b.teamState.positionReachedAt;
  });
}

export function demoResolveTeamTask(teamId, outcome) {
  const team = findTeamById(teamId);
  if (!team) {
    return getState();
  }

  if (outcome === "reject") {
    return rejectTeamTask(team.kroegraadId, teamId);
  }

  return approveTeamTask(team.kroegraadId, teamId);
}

export function demoDrawCard(teamId, type) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }

    const card = drawCard(type === "fund" ? "fund" : "chance");
    const task = createTaskFromCard(card, type === "fund" ? "fund" : "chance");

    const nextState = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: task,
          activePopup: {
            title: task.title,
            body: task.body,
            kind: task.presentation,
            stage: "intro",
            cardId: task.cardId
          },
          proofInWhatsapp: false,
          rejectionPenalty: null,
          status: TEAM_STATUS.TASK_ACTIVE
        }
      }
    };

    return applyImmediateTaskEffect(nextState, teamId);
  });
}

export function demoDrawTeamChoiceCard(teamId, type = "chance") {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }

    const deckType = type === "fund" ? "fund" : "chance";
    const card = CARD_DECKS[deckType].find((item) =>
      ["team_choice_wait", "team_choice_move", "swap_positions"].includes(item.effectType)
    );
    if (!card) {
      return state;
    }

    const task = createTaskFromCard(card, deckType);
    const nextState = {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: task,
          activePopup: {
            title: task.title,
            body: task.body,
            kind: task.presentation,
            stage: "intro",
            cardId: task.cardId
          },
          proofInWhatsapp: false,
          rejectionPenalty: null,
          status: TEAM_STATUS.TASK_ACTIVE
        }
      }
    };

    return applyImmediateTaskEffect(nextState, teamId);
  });
}

export function demoEnterWisselstation(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }

    const tile = findTileById(16);
    const task = createTaskFromTileBehavior(tile);
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          position: 16,
          currentTileId: 16,
          positionReachedAt: now(),
          currentTask: task,
          proofInWhatsapp: false,
          rejectionPenalty: null,
          status: TEAM_STATUS.TASK_ACTIVE,
          activePopup: {
            title: task.title,
            body: task.body,
            kind: task.presentation,
            stage: "detail",
            cardId: task.cardId
          }
        }
      }
    };
  });
}

export function useSavedPowerUp(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState?.savedPowerUp) {
      return state;
    }

    if (teamState.savedPowerUp.type === "skip_task") {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            currentTask: null,
            savedPowerUp: null,
            pendingBonusRoll: true,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: TEAM_STATUS.APPROVED,
            activePopup: {
              title: "Opdracht overgeslagen",
              body: "Jullie hebben de opdracht overgeslagen. De volgende worp is een bonusworp en telt niet mee als normale dobbelbeurt.",
              kind: "fund"
            }
          }
        }
      };
    }

    if (teamState.savedPowerUp.type === "objection" && teamState.status === TEAM_STATUS.REJECTED) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUp: null,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: getApprovedNextStatus(state, teamState),
            activePopup: {
              title: "Bezwaar toegekend",
              body: "Jullie afkeuring is omgezet naar goedgekeurd. Jullie mogen verder.",
              kind: "fund"
            }
          }
        }
      };
    }

    if (teamState.savedPowerUp.type === "jail_free" && teamState.status === TEAM_STATUS.IN_JAIL) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUp: null,
            jailUntil: null,
            currentTask: null,
            status: TEAM_STATUS.APPROVED,
            activePopup: {
              title: "Celvrij gebruikt",
              body: "Jullie zijn direct uit de cel. Geen wachttijd en geen Keizer Karelplein-opdracht.",
              kind: "fund"
            }
          }
        }
      };
    }

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          activePopup: {
            title: "Power-up gebruikt",
            body: `${teamState.savedPowerUp.label} staat nu als gebruikt. De automatische blokkade bij inkomende teamacties koppelen we in de volgende laag.`,
            kind: "fund"
          },
          savedPowerUp: null
        }
      }
    };
  });
}

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    emit();
  }
});
