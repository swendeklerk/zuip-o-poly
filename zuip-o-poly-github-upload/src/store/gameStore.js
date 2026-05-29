import { GAME_CONFIG } from "../data/gameConfig.js";
import { CARD_DECKS, drawCard } from "../data/cards.js";
import { CAFE_VAN_OUDS_WHEEL_OPTIONS, DOCK17_DRINKS } from "../data/tileAssignments.js";
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
let remotePollInterval = null;
let remoteFocusListenersReady = false;
let lastLocalSaveAt = 0;

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
    savedPowerUps: [],
    rejectionPenalty: null,
    proofInWhatsapp: false,
    pendingBonusRoll: false,
    jailUntil: null,
    waitUntil: null,
    activePlayers: team.defaultActivePlayers ?? team.players,
    lastStreetTileId: null,
    lastMove: null,
    oncePerTeamCardIds: [],
    fundDrawsUsed: 0,
    teamSyncRevision: 0,
    teamSyncUpdatedAt: 0
  };
}

function createDefaultState() {
  return {
    version: 1,
    syncRevision: 0,
    syncUpdatedAt: 0,
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
  state.syncRevision = Number.isFinite(input?.syncRevision) ? input.syncRevision : base.syncRevision;
  state.syncUpdatedAt = Number.isFinite(input?.syncUpdatedAt) ? input.syncUpdatedAt : base.syncUpdatedAt;
  const bankCard = CARD_DECKS.fund.find((card) => card.id === "fund-op-gesprek-bij-de-bank");

  for (const team of TEAMS) {
    const mergedTeamState = {
      ...createTeamState(team),
      ...(input?.teams?.[team.id] ?? {})
    };
    const activePlayers = Array.isArray(mergedTeamState.activePlayers)
      ? mergedTeamState.activePlayers
      : [];
    const oncePerTeamCardIds = Array.isArray(mergedTeamState.oncePerTeamCardIds)
      ? mergedTeamState.oncePerTeamCardIds
      : [];
    const currentTask =
      bankCard && mergedTeamState.currentTask?.cardId === bankCard.id
        ? {
            ...mergedTeamState.currentTask,
            body: bankCard.body,
            popup: bankCard.popup,
            reviewBody: bankCard.reviewBody,
            rules: bankCard.rules
          }
        : mergedTeamState.currentTask;
    const activePopup =
      bankCard && mergedTeamState.activePopup?.cardId === bankCard.id
        ? {
            ...mergedTeamState.activePopup,
            body: bankCard.popup
          }
        : mergedTeamState.activePopup;
    state.teams[team.id] = {
      ...mergedTeamState,
      currentTask,
      activePopup,
      oncePerTeamCardIds,
      fundDrawsUsed: Number.isFinite(mergedTeamState.fundDrawsUsed)
        ? mergedTeamState.fundDrawsUsed
        : 0,
      teamSyncRevision: Number.isFinite(mergedTeamState.teamSyncRevision)
        ? mergedTeamState.teamSyncRevision
        : 0,
      teamSyncUpdatedAt: Number.isFinite(mergedTeamState.teamSyncUpdatedAt)
        ? mergedTeamState.teamSyncUpdatedAt
        : 0,
      activePlayers: activePlayers.every((name) => team.players.includes(name))
        ? activePlayers
        : team.defaultActivePlayers ?? team.players
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

function getTeamComparableState(teamState) {
  const { teamSyncRevision, teamSyncUpdatedAt, ...comparable } = teamState;
  return comparable;
}

function didTeamChange(previousTeamState, nextTeamState) {
  return JSON.stringify(getTeamComparableState(previousTeamState)) !==
    JSON.stringify(getTeamComparableState(nextTeamState));
}

function prepareLocalStateForSave(state, previousState) {
  const normalizedState = normalizeState(state);
  const previous = previousState ? normalizeState(previousState) : normalizeState(getState());
  const updatedAt = now();
  const teams = { ...normalizedState.teams };

  for (const team of TEAMS) {
    const previousTeam = previous.teams[team.id] ?? createTeamState(team);
    const nextTeam = teams[team.id] ?? createTeamState(team);
    if (didTeamChange(previousTeam, nextTeam)) {
      teams[team.id] = {
        ...nextTeam,
        teamSyncRevision: previousTeam.teamSyncRevision + 1,
        teamSyncUpdatedAt: updatedAt
      };
    }
  }

  return {
    ...normalizedState,
    teams,
    syncRevision: Math.max(normalizedState.syncRevision, previous.syncRevision) + 1,
    syncUpdatedAt: updatedAt
  };
}

function saveState(state, previousState = null) {
  const normalizedState = normalizeState(state);
  const normalized = applyingRemoteState
    ? normalizedState
    : prepareLocalStateForSave(normalizedState, previousState);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  if (remoteSyncReady && !applyingRemoteState) {
    lastLocalSaveAt = now();
    saveRemoteGameState(normalized);
  }
  emit();
}

function isEmptyPreparationState(state) {
  return (
    state.phase === GAME_PHASE.PRESTART &&
    state.syncRevision === 0 &&
    TEAMS.every((team) => !state.teams[team.id]?.loggedIn)
  );
}

function shouldApplyRemoteState(remoteNormalized, localNormalized) {
  if (JSON.stringify(remoteNormalized) === JSON.stringify(localNormalized)) {
    return false;
  }

  if (isEmptyPreparationState(localNormalized)) {
    return true;
  }

  if (remoteNormalized.syncRevision > localNormalized.syncRevision) {
    return true;
  }

  if (remoteNormalized.syncRevision < localNormalized.syncRevision) {
    return false;
  }

  return (
    remoteNormalized.syncUpdatedAt > localNormalized.syncUpdatedAt &&
    now() - lastLocalSaveAt > 5000
  );
}

function isRemoteGlobalNewer(remoteNormalized, localNormalized) {
  if (remoteNormalized.syncRevision > localNormalized.syncRevision) {
    return true;
  }

  if (remoteNormalized.syncRevision < localNormalized.syncRevision) {
    return false;
  }

  return (
    remoteNormalized.syncUpdatedAt > localNormalized.syncUpdatedAt &&
    now() - lastLocalSaveAt > 5000
  );
}

function isRemoteTeamNewer(remoteTeamState, localTeamState) {
  if (remoteTeamState.teamSyncRevision > localTeamState.teamSyncRevision) {
    return true;
  }

  if (remoteTeamState.teamSyncRevision < localTeamState.teamSyncRevision) {
    return false;
  }

  return (
    remoteTeamState.teamSyncUpdatedAt > localTeamState.teamSyncUpdatedAt &&
    now() - lastLocalSaveAt > 5000
  );
}

function mergeRemoteState(remoteNormalized, localNormalized) {
  if (isEmptyPreparationState(localNormalized)) {
    return remoteNormalized;
  }

  const useRemoteGlobal = isRemoteGlobalNewer(remoteNormalized, localNormalized);
  const merged = {
    ...(useRemoteGlobal ? remoteNormalized : localNormalized),
    syncRevision: Math.max(remoteNormalized.syncRevision, localNormalized.syncRevision),
    syncUpdatedAt: Math.max(remoteNormalized.syncUpdatedAt, localNormalized.syncUpdatedAt),
    teams: {}
  };

  for (const team of TEAMS) {
    const remoteTeam = remoteNormalized.teams[team.id] ?? createTeamState(team);
    const localTeam = localNormalized.teams[team.id] ?? createTeamState(team);
    merged.teams[team.id] = isRemoteTeamNewer(remoteTeam, localTeam) ? remoteTeam : localTeam;
  }

  return normalizeState(merged);
}

function applyRemoteState(remoteState) {
  if (!hasUsableRemoteState(remoteState)) {
    return false;
  }

  const remoteNormalized = normalizeState(remoteState);
  const localNormalized = normalizeState(getState());
  const mergedState = mergeRemoteState(remoteNormalized, localNormalized);
  const mergedMatchesRemote = JSON.stringify(mergedState) === JSON.stringify(remoteNormalized);
  const mergedMatchesLocal = JSON.stringify(mergedState) === JSON.stringify(localNormalized);

  if (!mergedMatchesRemote && remoteSyncReady && !applyingRemoteState) {
    lastLocalSaveAt = now();
    saveRemoteGameState(mergedState);
  }

  if (mergedMatchesLocal) {
    return false;
  }

  applyingRemoteState = true;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedState));
  applyingRemoteState = false;
  emit();
  return true;
}

async function pullRemoteState() {
  if (!remoteSyncReady || applyingRemoteState || now() - lastLocalSaveAt < 2000) {
    return;
  }

  const remoteState = await loadRemoteGameState();
  applyRemoteState(remoteState);
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

  window.addEventListener?.("focus", () => {
    pullRemoteState();
  });

  if (typeof document !== "undefined") {
    document.addEventListener?.("visibilitychange", () => {
      if (!document.hidden) {
        pullRemoteState();
      }
    });
  }

  remoteFocusListenersReady = true;
}

function updateState(updater) {
  const current = tickState(getState());
  const next = updater(current);
  saveState(next, current);
  return next;
}

function emit() {
  for (const listener of listeners) {
    listener(getState());
  }
}

function tickState(state) {
  if (state.phase === GAME_PHASE.RUNNING) {
    let needsStartStatusRepair = false;
    const repairedTeams = { ...state.teams };

    for (const team of TEAMS) {
      const teamState = repairedTeams[team.id];
      if (teamState?.loggedIn && teamState.status === TEAM_STATUS.WAITING_START) {
        repairedTeams[team.id] = {
          ...teamState,
          status: TEAM_STATUS.CAN_ROLL
        };
        needsStartStatusRepair = true;
      }
    }

    if (needsStartStatusRepair) {
      return {
        ...state,
        teams: repairedTeams
      };
    }
  }

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
                body: "Loop een volledig rondje om het Keizer Karelplein.",
                placeholder: false,
                presentation: "jail"
              },
              activePopup: {
                title: "Strafopdracht",
                body: "Loop een volledig rondje om het Keizer Karelplein.",
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
    saveState(next, current);
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
    applyRemoteState(remoteState);
  } else {
    const didSave = await saveRemoteGameState(getState());
    if (!didSave) {
      return { ok: false, mode: "local" };
    }
  }

  remoteUnsubscribe = await subscribeRemoteGameState((state) => {
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
    team_rode_neus: { completedRounds: 1, position: 27, lastRoll: 4 },
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
      message: "Deze teamcode herken ik niet. Gebruik BRUINEKROEG, ZWARTEPINT, RODENEUS of WITTEBATAVUS."
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

export function getTeamCountdownSeconds(teamState, fieldName) {
  const targetTime = teamState?.[fieldName];
  if (!targetTime) {
    return null;
  }

  return Math.max(Math.ceil((targetTime - now()) / 1000), 0);
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
    position: ((((rawPosition - 1) % 40) + 40) % 40) + 1,
    roundsGained: rawPosition > 40 ? Math.floor((rawPosition - 1) / 40) : 0
  };
}

function createTaskFromCard(card, presentation) {
  return {
    title: card.title,
    body: card.body,
    popup: card.popup,
    reviewBody: card.reviewBody,
    rules: card.rules,
    placeholder: card.effectType !== "task",
    presentation,
    cardId: card.id,
    oncePerTeam: Boolean(card.oncePerTeam),
    effectType: card.effectType,
    delta: card.delta ?? 0,
    waitSeconds: card.waitSeconds ?? null,
    powerUpLabel: card.powerUpLabel,
    savedPowerUpType: card.savedPowerUpType
  };
}

function getSavedPowerUps(teamState) {
  return teamState.savedPowerUps?.length
    ? teamState.savedPowerUps
    : teamState.savedPowerUp
      ? [teamState.savedPowerUp]
      : [];
}

function addSavedPowerUp(teamState, powerUp) {
  return [...getSavedPowerUps(teamState), powerUp];
}

function getActivePlayers(teamState) {
  const team = findTeamById(teamState.teamId);
  return teamState.activePlayers?.length ? teamState.activePlayers : (team?.defaultActivePlayers ?? team?.players ?? []);
}

function getNextActivePlayerName(teamState, nextIndex) {
  const team = findTeamById(teamState.teamId);
  const activePlayers = getActivePlayers(teamState);
  const knownPlayer = team?.players?.find((name) => !activePlayers.includes(name));
  return knownPlayer ?? `Teamlid ${nextIndex}`;
}

function withDock17Meta(task, teamState) {
  if (teamState.currentTileId !== 32) {
    return task;
  }

  return {
    ...task,
    specialFlow: "dock17",
    dock17Choices: getActivePlayers(teamState).map((name, index) => ({
      id: `player_${index + 1}`,
      name,
      number: null,
      drink: ""
    })),
    dock17Revealed: false
  };
}

function withCafeVanOudsMeta(task, teamState) {
  if (teamState.currentTileId !== 33) {
    return task;
  }

  return {
    ...task,
    specialFlow: "vanOuds",
    vanOudsChoices: getActivePlayers(teamState).map((name, index) => ({
      id: `player_${index + 1}`,
      name,
      result: ""
    })),
    vanOudsComplete: false
  };
}

function withSpecialTaskMeta(task, teamState) {
  return withCafeVanOudsMeta(withDock17Meta(task, teamState), teamState);
}

function drawCardForTeam(type, teamState) {
  const deckType = type === "fund" ? "fund" : "chance";
  const deck = CARD_DECKS[deckType] ?? CARD_DECKS.chance;
  const usedOnceCards = teamState.oncePerTeamCardIds ?? [];

  if (deckType === "fund") {
    const bankCard = deck.find((card) => card.id === "fund-op-gesprek-bij-de-bank");
    if (bankCard && !usedOnceCards.includes(bankCard.id) && (teamState.fundDrawsUsed ?? 0) >= 1) {
      return bankCard;
    }
  }

  const eligibleCards = deck.filter((card) => !card.oncePerTeam);
  return eligibleCards[Math.floor(Math.random() * eligibleCards.length)] ?? drawCard(deckType);
}

function markOncePerTeamCard(teamState, task) {
  if (!task?.oncePerTeam || !task.cardId) {
    return teamState.oncePerTeamCardIds ?? [];
  }

  return Array.from(new Set([...(teamState.oncePerTeamCardIds ?? []), task.cardId]));
}

function getTaskTrackingFields(teamState, task) {
  return {
    oncePerTeamCardIds: markOncePerTeamCard(teamState, task),
    fundDrawsUsed: (teamState.fundDrawsUsed ?? 0) + (task?.presentation === "fund" ? 1 : 0)
  };
}

function getVanOudsSummary(choices) {
  return choices
    .filter((choice) => choice.result)
    .map((choice) => `${choice.name}: ${choice.result}`)
    .join(" | ");
}

function createStartBonusTask() {
  return {
    title: "Grote Markt Nijmegen",
    tileName: "Grote Markt Nijmegen",
    location: "Grote Markt",
    popup: "Bordje rond! Klasse. En als je langs Start komt, hoor daar uiteraard een beloning bij...",
    body:
      "Kies een team. Bel het team dat je gekozen hebt en meld dit aan de Kroegraad.",
    reviewBody: "Team deelt een drankje uit aan elke actieve speler van een gekozen actief team.",
    rules: "Bel het gekozen team en meld de keuze aan de Kroegraad.",
    placeholder: false,
    presentation: "start",
    cardId: "grote-markt-bonus",
    effectType: "start_bonus"
  };
}

function moveTeamByDelta(state, teamId, delta, options = {}) {
  const teamState = state.teams[teamId];
  const rawPosition = teamState.position + delta;
  const { position, roundsGained } = normalizeBoardPosition(rawPosition);
  const tile = findTileById(position);
  const crossedStart = roundsGained > 0 || position === 1;
  const baseTask = crossedStart ? createStartBonusTask() : createTaskFromTileBehavior(tile, teamState);
  const task = withSpecialTaskMeta(baseTask, { ...teamState, currentTileId: position });
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
        activePopup: crossedStart
          ? {
              title: task.title,
              body: task.popup,
              kind: task.presentation,
              stage: "detail",
              cardId: task.cardId
            }
          : options.keepPopup ? teamState.activePopup : null,
        rejectionPenalty: null,
        proofInWhatsapp: false,
        ...getTaskTrackingFields(teamState, task),
        lastStreetTileId: tile.type === "Straatvak" ? position : teamState.lastStreetTileId,
        lastMove: {
          roll: teamState.lastMove?.roll ?? teamState.lastRoll,
          from: teamState.position,
          to: position,
          roundsGained,
          crossedStart,
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
  const task = withSpecialTaskMeta(createTaskFromTileBehavior(tile, teamState), {
    ...teamState,
    currentTileId: position
  });
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
        ...getTaskTrackingFields(teamState, task),
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
  return createTaskFromTileBehavior(findTileById(teamState.currentTileId), teamState);
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
    return moveTeamToTile(state, teamId, teamState.lastMove?.from ?? teamState.lastStreetTileId ?? teamState.position, {
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
          savedPowerUp: null,
          savedPowerUps: addSavedPowerUp(teamState, {
            id: `${task.cardId}-${now()}`,
            cardId: task.cardId,
            title: task.title,
            label: task.powerUpLabel ?? task.title,
            body: task.body,
            type: task.savedPowerUpType
          }),
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
    getSavedPowerUps(teamState).some((powerUp) => powerUp.type === "shield")
  );
}

function getShieldPowerUp(teamState) {
  return getSavedPowerUps(teamState).find((powerUp) => powerUp.type === "shield") ?? null;
}

function consumeShieldPowerUp(teamState, message) {
  const shield = getShieldPowerUp(teamState);
  if (!shield) {
    return teamState;
  }

  return {
    ...teamState,
    savedPowerUp: null,
    savedPowerUps: removeSavedPowerUp(teamState, shield.id),
    activePopup: {
      title: "Hong Beschermt",
      body: message,
      kind: "fund",
      stage: "detail"
    }
  };
}

export function getTeamState(teamId, state = getState()) {
  const team = findTeamById(teamId);
  if (!team) {
    return null;
  }

  return state.teams[teamId];
}

export function rollDice(teamId, forcedRoll = null) {
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
    const roll = Number.isInteger(forcedRoll) && forcedRoll >= 1 && forcedRoll <= 6
      ? forcedRoll
      : Math.floor(Math.random() * 6) + 1;
    const rawPosition = teamState.position + roll;
    const { position: nextPosition, roundsGained } = normalizeBoardPosition(rawPosition);
    const completedRounds = teamState.completedRounds + roundsGained;
    const tile = findTileById(nextPosition);
    const crossedStart = roundsGained > 0 || nextPosition === 1;
    const baseTask = crossedStart ? createStartBonusTask() : createTaskFromTileBehavior(tile, teamState);
    const task = withSpecialTaskMeta(baseTask, { ...teamState, currentTileId: nextPosition });
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
          activePopup: task.popup || ["chance", "fund", "swap", "start"].includes(task.presentation)
            ? {
                title: task.title,
                body: task.popup || task.body,
                kind: task.presentation,
                stage: "intro",
                cardId: task.cardId
              }
            : null,
          rejectionPenalty: null,
          proofInWhatsapp: false,
          ...getTaskTrackingFields(teamState, task),
          lastStreetTileId: tile.type === "Straatvak" ? nextPosition : teamState.lastStreetTileId,
          lastMove: {
            roll,
            from: teamState.position,
            to: nextPosition,
            roundsGained,
            crossedStart,
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

function createTaskFromTileBehavior(tile, teamState = null) {
  if (tile.type === "Kans") {
    const card = teamState ? drawCardForTeam("chance", teamState) : drawCard("chance");
    return createTaskFromCard(card, "chance");
  }

  if (tile.type === "Algemeen Fonds") {
    const card = teamState ? drawCardForTeam("fund", teamState) : drawCard("fund");
    return createTaskFromCard(card, "fund");
  }

  if (tile.type === "Wisselstation") {
    const task = createTaskForTile(tile);
    return {
      ...task,
      title: "Wisselstation",
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

    if (targetState.status === TEAM_STATUS.IN_JAIL || targetState.status === TEAM_STATUS.FINISHED) {
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

    const targetShield = getShieldPowerUp(targetState);
    if (targetShield) {
      const targetName = findTeamById(targetTeamId)?.name ?? "Het gekozen team";
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            activePopup: {
              ...teamState.activePopup,
              stage: "detail",
              blockedChoiceMessage: `${targetName} had Hong Beschermt. Kies een ander team.`
            }
          },
          [targetTeamId]: consumeShieldPowerUp(
            targetState,
            "Een ander team probeerde jullie te raken, maar Hong Beschermt heeft de actie geblokkeerd. Deze bescherming is nu gebruikt."
          )
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

    if (task.effectType === "start_bonus") {
      const targetName = findTeamById(targetTeamId)?.name ?? "het gekozen team";
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            currentTask: null,
            proofInWhatsapp: false,
            rejectionPenalty: null,
            status: getApprovedNextStatus(state, teamState),
            activePopup: {
              title: "Grote Markt gemeld",
              body: `Bel ${targetName} en meld aan de Kroegraad dat jullie dit team hebben gekozen voor de Grote Markt-beloning.`,
              kind: "start",
              stage: "detail"
            }
          },
          [targetTeamId]: {
            ...targetState,
            activePopup: {
              title: "Grote Markt-beloning",
              body: "Een ander team heeft jullie gekozen voor de Grote Markt-beloning. Wacht op hun belletje en volg wat de Kroegraad zegt.",
              kind: "start",
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
      const actorTask = withSpecialTaskMeta(createTaskFromTileBehavior(actorTile, teamState), {
        ...teamState,
        currentTileId: targetState.position
      });
      const targetTask = withSpecialTaskMeta(createTaskFromTileBehavior(targetTile, targetState), {
        ...targetState,
        currentTileId: teamState.position
      });
      const swappedAt = now();
      const targetName = findTeamById(targetTeamId)?.name ?? "Het gekozen team";

      const swappedState = {
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
            ...getTaskTrackingFields(teamState, actorTask),
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
            ...getTaskTrackingFields(targetState, targetTask),
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

      return applyImmediateTaskEffect(
        applyImmediateTaskEffect(swappedState, teamId),
        targetTeamId
      );
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

    if (teamState.currentTask?.specialFlow === "dock17" && !teamState.currentTask.dock17Revealed) {
      return state;
    }

    if (teamState.currentTask?.specialFlow === "vanOuds" && !teamState.currentTask.vanOudsComplete) {
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

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          proofInWhatsapp: false,
          activePopup: null,
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

    const deckType = type === "fund" ? "fund" : "chance";
    const card = drawCardForTeam(deckType, teamState);
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
          ...getTaskTrackingFields(teamState, task),
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

export function demoEnterDock17(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }

    const tile = findTileById(32);
    const task = withSpecialTaskMeta(createTaskFromTileBehavior(tile), {
      ...teamState,
      currentTileId: 32
    });

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          position: 32,
          currentTileId: 32,
          positionReachedAt: now(),
          currentTask: task,
          proofInWhatsapp: false,
          rejectionPenalty: null,
          status: TEAM_STATUS.TASK_ACTIVE,
          activePopup: {
            title: task.title,
            body: task.popup || task.body,
            kind: task.presentation,
            stage: "detail",
            cardId: task.cardId
          }
        }
      }
    };
  });
}

export function demoEnterCafeVanOuds(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    if (!teamState) {
      return state;
    }

    const tile = findTileById(33);
    const task = withSpecialTaskMeta(createTaskFromTileBehavior(tile), {
      ...teamState,
      currentTileId: 33
    });

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          position: 33,
          currentTileId: 33,
          positionReachedAt: now(),
          currentTask: task,
          proofInWhatsapp: false,
          rejectionPenalty: null,
          status: TEAM_STATUS.TASK_ACTIVE,
          activePopup: {
            title: task.title,
            body: task.popup || task.body,
            kind: task.presentation,
            stage: "detail"
          }
        }
      }
    };
  });
}

export function updateDock17Choice(teamId, choiceId, number) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!teamState || task?.specialFlow !== "dock17" || task.dock17Revealed) {
      return state;
    }

    const safeNumber = Math.min(Math.max(Number(number) || 1, 1), 17);
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: {
            ...task,
            dock17Choices: task.dock17Choices.map((choice) =>
              choice.id === choiceId ? { ...choice, number: safeNumber } : choice
            )
          }
        }
      }
    };
  });
}

export function addCafeVanOudsPlayer(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!teamState || task?.specialFlow !== "vanOuds") {
      return state;
    }

    const nextIndex = task.vanOudsChoices.length + 1;
    const nextName = getNextActivePlayerName(teamState, nextIndex);
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          activePlayers: [...getActivePlayers(teamState), nextName],
          currentTask: {
            ...task,
            vanOudsComplete: false,
            vanOudsChoices: [
              ...task.vanOudsChoices,
              {
                id: `player_${nextIndex}`,
                name: nextName,
                result: ""
              }
            ]
          }
        }
      }
    };
  });
}

export function spinCafeVanOudsWheel(teamId, choiceId, forcedResult = "") {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!teamState || task?.specialFlow !== "vanOuds") {
      return state;
    }

    const usedResults = new Set(task.vanOudsChoices.map((choice) => choice.result).filter(Boolean));
    const availableOptions = CAFE_VAN_OUDS_WHEEL_OPTIONS.filter((item) => !usedResults.has(item));
    const fallbackPool = availableOptions.length ? availableOptions : CAFE_VAN_OUDS_WHEEL_OPTIONS;
    const result =
      CAFE_VAN_OUDS_WHEEL_OPTIONS.includes(forcedResult) && !usedResults.has(forcedResult)
        ? forcedResult
        : fallbackPool[Math.floor(Math.random() * fallbackPool.length)] ?? "Pils";
    const resultIndex = Math.max(CAFE_VAN_OUDS_WHEEL_OPTIONS.indexOf(result), 0);
    const choices = task.vanOudsChoices.map((choice) =>
      choice.id === choiceId && !choice.result ? { ...choice, result, resultIndex } : choice
    );
    const complete = choices.every((choice) => choice.result);
    const summary = getVanOudsSummary(choices);

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: {
            ...task,
            vanOudsChoices: choices,
            vanOudsComplete: complete,
            reviewBody: complete
              ? `Café Van Ouds rad-uitslag: ${summary}`
              : "Café Van Ouds: nog niet ieder actief teamlid heeft aan het rad gedraaid.",
            reviewExtra: `Rad-opties: ${CAFE_VAN_OUDS_WHEEL_OPTIONS.join(" | ")}`
          },
          activePopup: complete
            ? {
                title: "Rad compleet",
                body: `${summary}. Druk op de bewijsknop zodra jullie klaar zijn.`,
                kind: "task",
                stage: "detail"
              }
            : teamState.activePopup
        }
      }
    };
  });
}

export function addDock17Player(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!teamState || task?.specialFlow !== "dock17" || task.dock17Revealed) {
      return state;
    }

    const nextIndex = task.dock17Choices.length + 1;
    const nextName = getNextActivePlayerName(teamState, nextIndex);
    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          activePlayers: [...getActivePlayers(teamState), nextName],
          currentTask: {
            ...task,
            dock17Choices: [
              ...task.dock17Choices,
              {
                id: `player_${nextIndex}`,
                name: nextName,
                number: null,
                drink: ""
              }
            ]
          }
        }
      }
    };
  });
}

export function revealDock17Choices(teamId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const task = teamState?.currentTask;
    if (!teamState || task?.specialFlow !== "dock17") {
      return state;
    }

    const revealedChoices = task.dock17Choices.map((choice) => {
      const number = Math.min(Math.max(Number(choice.number) || 1, 1), 17);
      return {
        ...choice,
        number,
        drink: DOCK17_DRINKS.find((item) => item.id === number)?.drink ?? "Onbekend drankje"
      };
    });
    const summary = revealedChoices
      .map((choice) => `${choice.name}: ${choice.number} = ${choice.drink}`)
      .join(" | ");

    return {
      ...state,
      teams: {
        ...state.teams,
        [teamId]: {
          ...teamState,
          currentTask: {
            ...task,
            dock17Choices: revealedChoices,
            dock17Revealed: true,
            reviewBody: `Dock17 uitslag: ${summary}`,
            reviewExtra: `Controlelijst: ${DOCK17_DRINKS.map((item) => `${item.id}. ${item.drink}`).join(" | ")}`
          },
          activePopup: {
            title: "Dock17 onthuld",
            body: summary,
            kind: "task",
            stage: "detail"
          }
        }
      }
    };
  });
}

function removeSavedPowerUp(teamState, powerUpId) {
  return getSavedPowerUps(teamState).filter((powerUp) => powerUp.id !== powerUpId);
}

export function useSavedPowerUp(teamId, powerUpId) {
  return updateState((state) => {
    const teamState = state.teams[teamId];
    const powerUps = getSavedPowerUps(teamState);
    const selectedPowerUp = powerUps.find((powerUp) => powerUp.id === powerUpId) ?? powerUps[0];
    if (!teamState || !selectedPowerUp) {
      return state;
    }

    if (selectedPowerUp.type === "skip_task") {
      if (![TEAM_STATUS.TASK_ACTIVE, TEAM_STATUS.REJECTED].includes(teamState.status)) {
        return state;
      }

      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            currentTask: null,
            savedPowerUp: null,
            savedPowerUps: removeSavedPowerUp(teamState, selectedPowerUp.id),
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

    if (selectedPowerUp.type === "objection" && teamState.status === TEAM_STATUS.REJECTED) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUp: null,
            savedPowerUps: removeSavedPowerUp(teamState, selectedPowerUp.id),
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

    if (selectedPowerUp.type === "jail_free" && teamState.status === TEAM_STATUS.IN_JAIL) {
      return {
        ...state,
        teams: {
          ...state.teams,
          [teamId]: {
            ...teamState,
            savedPowerUp: null,
            savedPowerUps: removeSavedPowerUp(teamState, selectedPowerUp.id),
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

    if (selectedPowerUp.type === "shield") {
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
            body: `${selectedPowerUp.label} staat nu als gebruikt. De automatische blokkade bij inkomende teamacties koppelen we in de volgende laag.`,
            kind: "fund"
          },
          savedPowerUp: null,
          savedPowerUps: removeSavedPowerUp(teamState, selectedPowerUp.id)
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
