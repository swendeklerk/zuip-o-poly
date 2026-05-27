import { GAME_CONFIG } from "../data/gameConfig.js";
import { drawCard } from "../data/cards.js";
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
  return [TEAM_STATUS.TASK_ACTIVE, TEAM_STATUS.WAITING_KROEGRAAD, TEAM_STATUS.REJECTED].includes(status);
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
      !hasTeamReachedTurnLimit(teamState) &&
      [TEAM_STATUS.CAN_ROLL, TEAM_STATUS.APPROVED].includes(teamState?.status);

    if (!canRoll) {
      return state;
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    const rawPosition = teamState.position + roll;
    const roundsGained = Math.floor((rawPosition - 1) / 40);
    const completedRounds = teamState.completedRounds + roundsGained;
    const nextPosition = ((rawPosition - 1) % 40) + 1;
    const tile = findTileById(nextPosition);
    const task = createTaskFromTileBehavior(tile);

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          position: nextPosition,
          currentTileId: nextPosition,
          completedRounds,
          positionReachedAt: now(),
          normalTurnsUsed: teamState.normalTurnsUsed + 1,
          lastRoll: roll,
          currentTask: task,
          activePopup: {
            title: task.title,
            body: task.body,
            kind: task.presentation ?? "task"
          },
          rejectionPenalty: null,
          proofInWhatsapp: false,
          lastMove: {
            roll,
            from: teamState.position,
            to: nextPosition,
            roundsGained,
            crossedStart: roundsGained > 0,
            tileName: tile.name,
            movedAt: now()
          },
          status: TEAM_STATUS.TASK_ACTIVE
        }
      }
    };
  });
}

function createTaskFromTileBehavior(tile) {
  if (tile.type === "Kans") {
    const card = drawCard("chance");
    return {
      title: card.title,
      body: card.body,
      placeholder: card.effectType !== "task",
      presentation: "chance",
      cardId: card.id,
      effectType: card.effectType
    };
  }

  if (tile.type === "Algemeen Fonds") {
    const card = drawCard("fund");
    return {
      title: card.title,
      body: card.body,
      placeholder: true,
      presentation: "fund",
      cardId: card.id,
      effectType: card.effectType,
      powerUpLabel: card.powerUpLabel
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
    const task = {
      title: card.title,
      body: card.body,
      placeholder: card.effectType !== "task",
      presentation: type === "fund" ? "fund" : "chance",
      cardId: card.id,
      effectType: card.effectType,
      powerUpLabel: card.powerUpLabel
    };

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: task,
          activePopup: {
            title: task.title,
            body: task.body,
            kind: task.presentation
          },
          proofInWhatsapp: false,
          rejectionPenalty: null,
          status: TEAM_STATUS.TASK_ACTIVE
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

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          activePopup: {
            title: "Power-up gebruikt",
            body: `${teamState.savedPowerUp.label} is gebruikt. Het echte effect wordt in een volgende fase gekoppeld.`,
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
