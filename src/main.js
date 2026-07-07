import { getBoardCells } from "./data/board.js";
import { getTileTheme } from "./data/tileThemes.js";
import { findTileById } from "./data/tiles.js";
import {
  DEFAULT_MODE_ID,
  findGameMode,
  findTeamColor,
  GAME_CONFIG,
  GAME_MODES,
  TEAM_COLORS,
  TEAM_RULES
} from "./data/gameConfig.js";
import { GAME_PHASE, STATUS_META, TEAM_STATUS } from "./data/statuses.js";
import { feedback, getFeedbackSettings, setFeedbackSetting } from "./services/feedback.js";
import {
  chooseTeam,
  clearSession,
  confirmTask,
  createRoom,
  dismissPopup,
  fetchRoom,
  getChoosableTeams,
  getCountdownRemaining,
  getRanking,
  getSession,
  getState,
  getTaskConfirmRemaining,
  getTeamCountdownSeconds,
  initializeRemoteSync,
  isSessionActive,
  joinRoom,
  normalizeRoomCode,
  resolveChoiceWithoutTarget,
  revealDock17Choices,
  revealPopupCard,
  rollDice,
  runClockTick,
  setPlayerCount,
  skipTask,
  spinVanOudsWheel,
  startDemoGame,
  startGame,
  subscribe,
  takeoverTeam,
  updateDock17Choice,
  usePowerUp,
  demoAlmostDone,
  demoDrawCard,
  demoFinishOpponents,
  demoGivePowerUps,
  demoIncomingAttack,
  demoSkipTimer,
  demoTeleport
} from "./store/gameStore.js";
import { TILES } from "./data/tiles.js";

const app = document.getElementById("app");

/* ------------------------------------------------------------------ */
/* Lokale UI-status (geen spelstand — die leeft in de store)           */
/* ------------------------------------------------------------------ */

const ui = {
  screen: "home", // home | create | join
  createModeId: DEFAULT_MODE_ID,
  createColorId: TEAM_COLORS[0].id,
  createPlayerCount: 3,
  joinCode: "",
  joinFetchedState: null,
  joinColorId: null,
  joinPlayerCount: 3,
  joinError: "",
  createError: "",
  dialog: null, // {type:"skip"} | {type:"choose", targetId} | {type:"leave"}
  syncMode: "connecting", // connecting | remote | local
  copied: false
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function nl2br(value) {
  return esc(value).replaceAll("\n", "<br />");
}

function fmtTime(totalSeconds) {
  const seconds = Math.max(Number(totalSeconds) || 0, 0);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/* ------------------------------------------------------------------ */
/* Renderloop                                                          */
/* ------------------------------------------------------------------ */

let renderQueued = false;

// Speelt geluid/trilling af bij belangrijke overgangen (geraakt, cel, power-up,
// winst). Vuurt alleen op de overgang zelf, niet elke render.
let sfxPrev = { inited: false, phase: null, status: null, popupSig: null, powerupCount: 0 };

function playTransitionFeedback(state, teamState) {
  const phase = state.phase;
  const status = teamState.status;
  const popup = teamState.activePopup;
  const popupSig = popup ? `${popup.title}|${popup.stage}` : null;
  const powerupCount = (teamState.savedPowerUps ?? []).length;

  if (sfxPrev.inited) {
    if (phase === GAME_PHASE.ENDED && sfxPrev.phase !== GAME_PHASE.ENDED) {
      feedback.win();
    }
    if (status === TEAM_STATUS.IN_JAIL && sfxPrev.status !== TEAM_STATUS.IN_JAIL) {
      feedback.jail();
    }
    if (powerupCount > sfxPrev.powerupCount) {
      feedback.powerup();
    }
    if (popupSig && popupSig !== sfxPrev.popupSig && popup.stage === "detail") {
      const title = (popup.title ?? "").toLowerCase();
      if (title.includes("geraakt") || title.includes("gewisseld") || title.includes("uno reverse")) {
        feedback.hit();
      }
    }
  }

  sfxPrev = { inited: true, phase, status, popupSig, powerupCount };
}

let lastCountdownValue = null;

// Stap-voor-stap pion-animatie. De store verplaatst de pion direct naar de
// eindpositie; de UI laat 'm zichtbaar vak voor vak lopen via lastMove.steps.
const WALK_STEP_MS = 150;
const DICE_REVEAL_MS = 750;
let walk = { active: false, reveal: false, cells: [], index: 0, timer: null, revealTimer: null, movedAt: 0, roll: null };
let walkInited = false;

function boardWrap(n) {
  const size = GAME_CONFIG.boardSize;
  return ((((n - 1) % size) + size) % size) + 1;
}

function maybeStartWalk(state, teamState) {
  const move = teamState.lastMove;
  // Eerste keer in het spel: zet de basislijn op de al bestaande worp (bij
  // hervatten midden in het spel), zodat die niet wordt nagespeeld.
  if (!walkInited) {
    walkInited = true;
    walk.movedAt = move?.movedAt ?? 0;
    return false;
  }
  if (!move || !Number.isFinite(move.steps) || move.steps === 0) {
    return false;
  }
  if (walk.active || move.movedAt <= walk.movedAt) {
    return false;
  }

  walk.movedAt = move.movedAt;
  const dir = Math.sign(move.steps);
  const count = Math.abs(move.steps);
  const cells = [move.from];
  let pos = move.from;
  for (let i = 0; i < count; i += 1) {
    pos = boardWrap(pos + dir);
    cells.push(pos);
  }

  // Alleen bij een echte worp eerst het getal groots onthullen.
  const showReveal = ["roll", "bonus_roll"].includes(move.source);
  walk = { ...walk, active: true, reveal: showReveal, cells, index: 0, roll: move.roll };
  window.clearInterval(walk.timer);
  window.clearTimeout(walk.revealTimer);

  if (showReveal) {
    walk.revealTimer = window.setTimeout(() => {
      walk.reveal = false;
      render();
      walk.timer = window.setInterval(advanceWalk, WALK_STEP_MS);
    }, DICE_REVEAL_MS);
  } else {
    walk.timer = window.setInterval(advanceWalk, WALK_STEP_MS);
  }
  return true;
}

function advanceWalk() {
  walk.index += 1;
  if (walk.index >= walk.cells.length) {
    window.clearInterval(walk.timer);
    walk.timer = null;
    walk.active = false;
    render();
    return;
  }

  const tileId = walk.cells[walk.index];
  const oldCell = app.querySelector(".board-cell.is-here");
  const newCell = app.querySelector(`.board-cell[data-tile-id="${tileId}"]`);
  if (oldCell && newCell) {
    oldCell.classList.remove("is-here");
    oldCell.querySelector(".board-pawn")?.remove();
    newCell.classList.add("is-here");
    const pawn = document.createElement("span");
    pawn.className = "board-pawn";
    newCell.appendChild(pawn);
  }
  feedback.step();
}

function render() {
  // Niet midden in de dobbelsteenanimatie opnieuw renderen.
  if (document.querySelector(".dice-panel.is-rolling")) {
    if (!renderQueued) {
      renderQueued = true;
      window.setTimeout(() => {
        renderQueued = false;
        render();
      }, 950);
    }
    return;
  }

  const session = getSession();
  const state = getState();

  if (!session?.roomCode || !state) {
    renderEntry();
    return;
  }

  const teamState = state.teams[session.teamId];
  if (!teamState) {
    renderEntry("Je team bestaat niet (meer) in deze spelkamer.");
    return;
  }

  playTransitionFeedback(state, teamState);

  if (!isSessionActive(state, session)) {
    renderTakeover(state, session, teamState);
    return;
  }

  if (state.phase === GAME_PHASE.LOBBY) {
    renderLobby(state, teamState);
    return;
  }

  if (state.phase === GAME_PHASE.COUNTDOWN) {
    renderCountdown(state, teamState);
    return;
  }

  if (state.phase === GAME_PHASE.ENDED) {
    renderEnded(state, teamState);
    return;
  }

  maybeStartWalk(state, teamState);
  renderGame(state, teamState);
}

/* ------------------------------------------------------------------ */
/* Bouwstenen                                                          */
/* ------------------------------------------------------------------ */

function brandHeader(subtitle = "Niet zomaar een kroegentocht.") {
  return `
    <header class="brand-header">
      <img class="brand-logo" src="./assets/zuipopoly-logo-full.svg" alt="Zuip-O-Poly" />
      <p class="brand-slogan">${esc(subtitle)}</p>
    </header>
  `;
}

function statusPill(teamState) {
  const meta = STATUS_META[teamState.status] ?? { label: teamState.status, dot: "yellow" };
  return `
    <span class="status-pill dot-${meta.dot}">
      <span class="status-dot"></span>${esc(meta.label)}
    </span>
  `;
}

function syncBadge(state = null) {
  if (state?.isDemo) {
    return '<span class="sync-badge sync-demo">TESTMODUS</span>';
  }
  const labels = { connecting: "VERBINDEN…", remote: "LIVE", local: "LOKAAL" };
  return `<span class="sync-badge sync-${ui.syncMode}">${labels[ui.syncMode] ?? ""}</span>`;
}

function teamChip(teamState) {
  const color = findTeamColor(teamState.colorId);
  return `
    <span class="team-chip" style="--team-accent:${color.hex}">
      <span class="team-chip-dot"></span>${esc(teamState.name)}
    </span>
  `;
}

function colorPicker(selectedId, takenIds, actionName) {
  return `
    <div class="color-grid" role="radiogroup" aria-label="Teamkleur">
      ${TEAM_COLORS.map((color) => {
        const taken = takenIds.includes(color.id);
        const selected = color.id === selectedId;
        return `
          <button
            type="button"
            class="color-swatch ${selected ? "is-selected" : ""} ${taken ? "is-taken" : ""}"
            style="--swatch:${color.hex}"
            data-action="${actionName}"
            data-color-id="${color.id}"
            ${taken ? "disabled" : ""}
            aria-label="${esc(color.name)}${taken ? " (bezet)" : ""}"
          ></button>
        `;
      }).join("")}
    </div>
  `;
}

function playerStepper(count, actionPrefix) {
  return `
    <div class="player-stepper">
      <button type="button" class="stepper-button" data-action="${actionPrefix}-minus" aria-label="Minder spelers">−</button>
      <span class="stepper-value">${count} spelers</span>
      <button type="button" class="stepper-button" data-action="${actionPrefix}-plus" aria-label="Meer spelers">+</button>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Entry: home / aanmaken / meedoen                                    */
/* ------------------------------------------------------------------ */

function renderEntry(notice = "") {
  if (ui.screen === "create") {
    renderCreate();
    return;
  }
  if (ui.screen === "join") {
    renderJoin();
    return;
  }

  app.innerHTML = `
    <div class="screen screen-home">
      ${brandHeader()}
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
      <div class="home-actions">
        <button class="button primary big" data-action="nav-create">Spelkamer aanmaken</button>
        <button class="button ghost big" data-action="nav-join">Meedoen met spelcode</button>
        <button class="button gold big" data-action="start-demo">Testmodus — probeer alles</button>
      </div>
      <section class="panel home-rules">
        <h2>Zo werkt het</h2>
        <ul class="rules-list">
          ${TEAM_RULES.map((rule) => `<li>${esc(rule)}</li>`).join("")}
        </ul>
      </section>
      <button class="button link" data-action="open-settings">🔊 Geluid &amp; trilling</button>
      <p class="home-city">Speelstad: <strong>Nijmegen</strong></p>
      ${renderDialog(null, null)}
    </div>
  `;
}

function renderCreate() {
  app.innerHTML = `
    <div class="screen screen-create">
      ${brandHeader("Nieuwe spelkamer")}
      <form class="panel entry-form" data-form="create-room">
        <label class="field">
          <span class="field-label">Teamnaam</span>
          <input name="teamName" maxlength="24" required placeholder="Bijv. De Natte Neuzen" autocomplete="off" />
        </label>

        <div class="field">
          <span class="field-label">Teamkleur</span>
          ${colorPicker(ui.createColorId, [], "create-color")}
        </div>

        <div class="field">
          <span class="field-label">Actieve teamleden</span>
          ${playerStepper(ui.createPlayerCount, "create-player")}
        </div>

        <div class="field">
          <span class="field-label">Spelstand</span>
          <div class="mode-grid">
            ${GAME_MODES.map((mode) => `
              <button
                type="button"
                class="mode-card ${mode.id === ui.createModeId ? "is-selected" : ""}"
                data-action="create-mode"
                data-mode-id="${mode.id}"
              >
                <strong class="mode-name">${esc(mode.label)}</strong>
                <span class="mode-turns">${mode.turns} worpen</span>
                <span class="mode-tagline">${esc(mode.tagline)}</span>
              </button>
            `).join("")}
          </div>
        </div>

        ${ui.createError ? `<p class="form-error">${esc(ui.createError)}</p>` : ""}
        <button class="button primary big" type="submit">Spelkamer aanmaken</button>
        <button class="button link" type="button" data-action="nav-home">Terug</button>
      </form>
    </div>
  `;
}

function renderJoin() {
  const fetched = ui.joinFetchedState;

  if (!fetched) {
    app.innerHTML = `
      <div class="screen screen-join">
        ${brandHeader("Meedoen")}
        <form class="panel entry-form" data-form="join-fetch">
          <label class="field">
            <span class="field-label">Spelcode</span>
            <input name="roomCode" maxlength="8" required placeholder="Bijv. K7X2P" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase" value="${esc(ui.joinCode)}" />
          </label>
          ${ui.joinError ? `<p class="form-error">${esc(ui.joinError)}</p>` : ""}
          <button class="button primary big" type="submit">Zoek spelkamer</button>
          <button class="button link" type="button" data-action="nav-home">Terug</button>
        </form>
      </div>
    `;
    return;
  }

  const mode = findGameMode(fetched.modeId);
  const teams = Object.values(fetched.teams);
  const takenColorIds = teams.map((team) => team.colorId);
  const selectedColor = ui.joinColorId && !takenColorIds.includes(ui.joinColorId)
    ? ui.joinColorId
    : TEAM_COLORS.find((color) => !takenColorIds.includes(color.id))?.id;
  ui.joinColorId = selectedColor;
  const lobbyOpen = fetched.phase === GAME_PHASE.LOBBY;

  app.innerHTML = `
    <div class="screen screen-join">
      ${brandHeader("Meedoen")}
      <section class="panel">
        <p class="join-room-line">Spelkamer <strong class="room-code">${esc(fetched.roomCode)}</strong> · ${esc(mode.label)} (${mode.turns} worpen)</p>
        <p class="join-room-teams">${teams.length ? `Al aangemeld: ${teams.map((team) => esc(team.name)).join(", ")}` : "Nog geen teams aangemeld."}</p>
      </section>

      ${lobbyOpen ? `
        <form class="panel entry-form" data-form="join-room">
          <label class="field">
            <span class="field-label">Teamnaam</span>
            <input name="teamName" maxlength="24" required placeholder="Bijv. Team Tapstoring" autocomplete="off" />
          </label>
          <div class="field">
            <span class="field-label">Teamkleur</span>
            ${colorPicker(selectedColor, takenColorIds, "join-color")}
          </div>
          <div class="field">
            <span class="field-label">Actieve teamleden</span>
            ${playerStepper(ui.joinPlayerCount, "join-player")}
          </div>
          ${ui.joinError ? `<p class="form-error">${esc(ui.joinError)}</p>` : ""}
          <button class="button primary big" type="submit">Meedoen</button>
        </form>
      ` : `
        <section class="panel">
          <p>Dit spel is al gestart. Nieuw joinen kan niet meer.</p>
        </section>
      `}

      ${teams.length ? `
        <section class="panel">
          <h2>Team hervatten</h2>
          <p class="panel-sub">Nieuwe telefoon of app opnieuw geopend? Neem jullie bestaande team over. De spelstand verandert niet.</p>
          <div class="resume-list">
            ${teams.map((team) => `
              <button class="button ghost resume-button" data-action="resume-team" data-team-id="${team.id}" style="--team-accent:${findTeamColor(team.colorId).hex}">
                <span class="team-chip-dot"></span>${esc(team.name)}
              </button>
            `).join("")}
          </div>
        </section>
      ` : ""}

      <button class="button link" type="button" data-action="join-back">Andere code</button>
    </div>
  `;
}

function renderTakeover(state, session, teamState) {
  app.innerHTML = `
    <div class="screen screen-takeover">
      ${brandHeader()}
      <section class="panel">
        <h2>Team actief op ander toestel</h2>
        <p>${esc(teamState.name)} is al actief op een ander toestel. Herstel de bestaande sessie of vervang het actieve toestel. De spelstand verandert niet.</p>
        <div class="stack-buttons">
          <button class="button primary big" data-action="takeover-session">Dit toestel gebruiken</button>
          <button class="button ghost" data-action="leave-room">Terug naar start</button>
        </div>
      </section>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Lobby & countdown                                                   */
/* ------------------------------------------------------------------ */

function renderLobby(state, teamState) {
  const mode = findGameMode(state.modeId);
  const teams = Object.values(state.teams).sort((a, b) => a.joinedAt - b.joinedAt);
  const isStarter = state.starterTeamId === teamState.id;
  const enoughTeams = teams.length >= GAME_CONFIG.minTeams;
  const color = findTeamColor(teamState.colorId);

  app.innerHTML = `
    <div class="screen screen-lobby" style="--team-accent:${color.hex}">
      ${brandHeader("Speelstad: Nijmegen")}

      <section class="panel room-panel">
        <div class="room-code-row">
          <div>
            <span class="field-label">Spelcode</span>
            <strong class="room-code big-code">${esc(state.roomCode)}</strong>
          </div>
          <button class="button ghost" data-action="copy-code">${ui.copied ? "Gekopieerd!" : "Kopieer"}</button>
        </div>
        <p class="room-meta">Spelstand: <strong>${esc(mode.label)}</strong> · ${mode.turns} worpen per team ${syncBadge(state)}</p>
      </section>

      <section class="panel own-team-panel">
        <h2>Jullie team</h2>
        <div class="own-team-row">
          ${teamChip(teamState)}
          ${playerStepper(teamState.playerCount, "lobby-player")}
        </div>
      </section>

      <section class="panel">
        <h2>Teams in de spelkamer (${teams.length})</h2>
        <ul class="lobby-team-list">
          ${teams.map((team) => `
            <li style="--team-accent:${findTeamColor(team.colorId).hex}">
              <span class="team-chip-dot"></span>
              <span class="lobby-team-name">${esc(team.name)}</span>
              ${team.id === state.starterTeamId ? '<span class="starter-tag">Spelstarter</span>' : ""}
            </li>
          `).join("")}
        </ul>
      </section>

      <section class="panel">
        <h2>Basisregels</h2>
        <ul class="rules-list">
          ${TEAM_RULES.map((rule) => `<li>${esc(rule)}</li>`).join("")}
        </ul>
      </section>

      <section class="panel lobby-wait-panel">
        ${isStarter ? `
          <p>Start het spel zodra alle teams zijn aangemeld. In je eentje testen kan ook — je kunt gewoon starten.</p>
          <button class="button primary big" data-action="start-game" ${enoughTeams ? "" : "disabled"}>Start het spel</button>
        ` : `
          <p>Jullie zitten in de spelkamer van Zuip-O-Poly Nijmegen. Wacht tot alle teams klaar zijn. Zodra het spel start, krijgen jullie de eerste instructie.</p>
        `}
      </section>

      <button class="button link" data-action="ask-leave">Spelkamer verlaten</button>
      ${renderDialog(state, teamState)}
    </div>
  `;
}

function renderCountdown(state, teamState) {
  const remaining = getCountdownRemaining(state) ?? 0;
  app.innerHTML = `
    <div class="screen screen-countdown">
      ${brandHeader("Daar gaan we…")}
      <div class="countdown-stage">
        <span class="countdown-number">${remaining}</span>
        <p class="countdown-sub">Het spel begint zo. Alle teams starten op vak 1.</p>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Spelscherm                                                          */
/* ------------------------------------------------------------------ */

function renderGame(state, teamState) {
  const mode = findGameMode(state.modeId);
  const color = findTeamColor(teamState.colorId);
  const walking = walk.active;
  // Tijdens het lopen staat de pion op het huidige loopvak; anders op de eindpositie.
  const pawnPosition = walking ? walk.cells[walk.index] ?? teamState.lastMove?.from ?? teamState.position : teamState.position;

  app.innerHTML = `
    <div class="screen screen-game" style="--team-accent:${color.hex}">
      <header class="game-header">
        <div class="game-header-top">
          ${teamChip(teamState)}
          <div class="game-header-tools">
            ${syncBadge(state)}
            <button class="icon-button" data-action="open-settings" aria-label="Instellingen">⚙</button>
          </div>
        </div>
        <div class="game-header-bottom">
          ${statusPill(teamState)}
          <span class="turn-counter">Beurt ${Math.min(teamState.normalTurnsUsed, mode.turns)}/${mode.turns}</span>
          <span class="round-counter">Rondes: ${teamState.completedRounds}</span>
        </div>
      </header>

      ${renderBoard(state, teamState, pawnPosition)}

      ${walking ? (walk.reveal ? renderDiceReveal(teamState) : renderWalkingPanel(teamState)) : `
        ${renderActionArea(state, teamState)}
        ${renderPowerUps(state, teamState)}
        ${state.isDemo ? renderDemoPanel(state, teamState) : ""}
      `}
      ${renderEventLog(state)}

      <button class="button link" data-action="ask-leave">Spelkamer verlaten</button>
      ${walking ? "" : renderPopup(state, teamState)}
      ${walking ? "" : renderDialog(state, teamState)}
    </div>
  `;
}

function renderDiceReveal(teamState) {
  const roll = walk.roll ?? teamState.lastRoll ?? 1;
  return `
    <section class="panel action-panel dice-reveal-panel">
      <div class="dice-stage">
        <div class="die die-${roll} die-reveal">
          ${[1, 2, 3, 4, 5, 6].map((pip) => `<span class="pip pip-${pip}"></span>`).join("")}
        </div>
      </div>
      <p class="dice-reveal-text">Gegooid: <strong>${roll}</strong></p>
    </section>
  `;
}

function renderWalkingPanel(teamState) {
  const move = teamState.lastMove;
  const dir = (move?.steps ?? 0) < 0 ? "achteruit" : "vooruit";
  return `
    <section class="panel action-panel walking-panel">
      <span class="field-label">Onderweg</span>
      <p class="walking-text">De pion loopt ${Math.abs(move?.steps ?? 0)} ${Math.abs(move?.steps ?? 0) === 1 ? "vakje" : "vakjes"} ${dir}…</p>
    </section>
  `;
}

function renderActionArea(state, teamState) {
  switch (teamState.status) {
    case TEAM_STATUS.CAN_ROLL:
      return renderDicePanel(state, teamState);
    case TEAM_STATUS.TASK_ACTIVE:
      return renderTaskPanel(state, teamState);
    case TEAM_STATUS.CHOOSING_TEAM:
      return renderTeamChoicePanel(state, teamState);
    case TEAM_STATUS.WAITING_TIMER:
    case TEAM_STATUS.WAITING_SWAP:
      return renderWaitPanel(state, teamState);
    case TEAM_STATUS.IN_JAIL:
      return renderJailPanel(state, teamState);
    case TEAM_STATUS.FINISHED:
      return renderFinishedPanel(state, teamState);
    default:
      return `
        <section class="panel action-panel">
          <p>${esc(STATUS_META[teamState.status]?.screenText ?? "")}</p>
        </section>
      `;
  }
}

function renderDicePanel(state, teamState) {
  const face = teamState.lastRoll ?? 6;
  return `
    <section class="panel action-panel dice-panel">
      ${teamState.pendingBonusRoll ? '<p class="bonus-roll-tag">Bonusworp — telt niet als normale beurt</p>' : ""}
      <div class="dice-stage">
        <div class="die die-${face}">
          ${[1, 2, 3, 4, 5, 6].map((pip) => `<span class="pip pip-${pip}"></span>`).join("")}
        </div>
      </div>
      ${teamState.lastRoll ? `
        <div class="roll-result-strip">
          <span>Laatste worp</span>
          <strong>${teamState.lastRoll}</strong>
        </div>
      ` : ""}
      <button class="button primary big" data-action="roll-dice" data-team-id="${teamState.id}">
        Gooi dobbelsteen
      </button>
    </section>
  `;
}

function renderTaskPanel(state, teamState) {
  const task = teamState.currentTask;
  if (!task) {
    return "";
  }

  if (task.pendingTileId) {
    return `
      <section class="panel action-panel">
        <p>Volgende vak wordt geladen…</p>
        <button class="button primary big" data-action="confirm-task">Verder</button>
      </section>
    `;
  }

  const remaining = getTaskConfirmRemaining(teamState);
  const timerBusy = remaining > 0;
  const specialBlock = renderSpecialFlow(task);
  const specialIncomplete =
    (task.specialFlow === "dock17" && !task.dock17Revealed) ||
    (task.specialFlow === "vanOuds" && !task.vanOudsComplete);
  const kindClass = task.presentation === "chance" ? "card-chance" : task.presentation === "fund" ? "card-fund" : "";

  return `
    <section class="panel action-panel task-panel ${kindClass}">
      <span class="field-label">${esc(task.presentation === "chance" ? "Kans" : task.presentation === "fund" ? "Algemeen Fonds" : "Opdracht")}</span>
      <h2 class="task-title">${esc(task.title)}</h2>
      ${task.location && task.location !== task.title ? `<p class="task-location">${esc(task.location)}</p>` : ""}
      <div class="task-body">${nl2br(task.body)}</div>
      ${task.rules ? `<details class="task-rules"><summary>Regels</summary><p>${nl2br(task.rules)}</p></details>` : ""}
      ${specialBlock}
      ${timerBusy ? `<p class="task-timer">Opdracht bezig: <strong>${fmtTime(remaining)}</strong></p>` : ""}

      <div class="task-actions">
        ${task.bonusPowerUp ? `
          <button class="button primary big" data-action="confirm-task" ${timerBusy || specialIncomplete ? "disabled" : ""}>Gedaan, wij zweren het</button>
          <button class="button gold big" data-action="confirm-task-bonus" ${timerBusy || specialIncomplete ? "disabled" : ""}>Gedaan mét bonus (${esc(task.bonusPowerUp.label)})</button>
        ` : `
          <button class="button primary big" data-action="confirm-task" ${timerBusy || specialIncomplete ? "disabled" : ""}>Gedaan, wij zweren het</button>
        `}
        ${task.skippable !== false ? `
          <button class="button ghost" data-action="ask-skip">Opdracht skippen (−${GAME_CONFIG.skipPenaltySteps} vakjes)</button>
        ` : ""}
      </div>
    </section>
  `;
}

function renderSpecialFlow(task) {
  if (task.specialFlow === "dock17") {
    return `
      <div class="special-flow">
        <p class="special-flow-title">Kies per speler een getal (1–17):</p>
        ${task.dock17Choices.map((choice) => `
          <div class="special-row">
            <span>${esc(choice.name)}</span>
            ${task.dock17Revealed
              ? `<strong>${choice.number} = ${esc(choice.drink)}</strong>`
              : `<select data-change="dock17-number" data-choice-id="${choice.id}">
                  <option value="">Kies…</option>
                  ${Array.from({ length: 17 }, (_, index) => index + 1)
                    .map((number) => `<option value="${number}" ${choice.number === number ? "selected" : ""}>${number}</option>`)
                    .join("")}
                </select>`}
          </div>
        `).join("")}
        ${!task.dock17Revealed ? `
          <button
            class="button gold"
            data-action="dock17-reveal"
            ${task.dock17Choices.every((choice) => choice.number) ? "" : "disabled"}
          >Onthul de drankjes</button>
        ` : ""}
      </div>
    `;
  }

  if (task.specialFlow === "vanOuds") {
    return `
      <div class="special-flow">
        <p class="special-flow-title">Rad van Bier en Vertier — iedereen draait één keer:</p>
        ${task.vanOudsChoices.map((choice) => `
          <div class="special-row">
            <span>${esc(choice.name)}</span>
            ${choice.result
              ? `<strong>${esc(choice.result)}</strong>`
              : `<button class="button gold small" data-action="vanouds-spin" data-choice-id="${choice.id}">Draai</button>`}
          </div>
        `).join("")}
      </div>
    `;
  }

  return "";
}

function renderTeamChoicePanel(state, teamState) {
  const task = teamState.currentTask;
  if (!task) {
    return "";
  }
  const choosable = getChoosableTeams(state, teamState.id);

  return `
    <section class="panel action-panel choice-panel">
      <span class="field-label">Team kiezen</span>
      <h2 class="task-title">${esc(task.title)}</h2>
      <div class="task-body">${nl2br(task.body)}</div>
      ${choosable.length ? `
        <div class="choice-list">
          ${choosable.map((team) => `
            <button class="button ghost choice-button" data-action="ask-choose" data-team-id="${team.id}" style="--team-accent:${findTeamColor(team.colorId).hex}">
              <span class="team-chip-dot"></span>${esc(team.name)}
            </button>
          `).join("")}
        </div>
      ` : `
        <p class="notice">Er is nu geen team kiesbaar (cel, bescherming of gefinisht).</p>
        <button class="button primary" data-action="choice-none">Verder zonder effect</button>
      `}
    </section>
  `;
}

function renderWaitPanel(state, teamState) {
  const remaining = getTeamCountdownSeconds(teamState, "waitUntil") ?? 0;
  const meta = STATUS_META[teamState.status];
  return `
    <section class="panel action-panel wait-panel">
      <span class="field-label">${esc(meta.label)}</span>
      <div class="wait-timer">${fmtTime(remaining)}</div>
      <p>${esc(meta.screenText)}</p>
    </section>
  `;
}

function renderJailPanel(state, teamState) {
  const remaining = getTeamCountdownSeconds(teamState, "jailUntil") ?? 0;
  const jailFree = (teamState.savedPowerUps ?? []).find((powerUp) => powerUp.type === "jail_free");
  return `
    <section class="panel action-panel jail-panel">
      <span class="field-label">In de cel</span>
      <div class="wait-timer">${fmtTime(remaining)}</div>
      <p>Jullie zitten in de cel. Na de wachttijd volgt de strafopdracht.</p>
      ${jailFree ? `
        <button class="button gold big" data-action="use-powerup" data-powerup-id="${jailFree.id}">Gebruik Celvrij</button>
      ` : ""}
    </section>
  `;
}

function renderFinishedPanel(state, teamState) {
  const waitingOn = Object.values(state.teams).filter(
    (team) => ![TEAM_STATUS.FINISHED, TEAM_STATUS.GAME_OVER].includes(team.status)
  );
  return `
    <section class="panel action-panel finished-panel">
      <span class="field-label">Gefinisht</span>
      <h2 class="task-title">Beurten op — lekker gespeeld!</h2>
      <p>Rondes: <strong>${teamState.completedRounds}</strong> · Eindvak: <strong>${teamState.position}</strong></p>
      <p>${waitingOn.length ? `Nog bezig: ${waitingOn.map((team) => esc(team.name)).join(", ")}.` : "Alle teams zijn klaar…"}</p>
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/* Power-ups                                                           */
/* ------------------------------------------------------------------ */

function renderPowerUps(state, teamState) {
  const powerUps = teamState.savedPowerUps ?? [];
  if (!powerUps.length) {
    return "";
  }

  return `
    <section class="panel powerup-panel">
      <h2>Power-ups</h2>
      <div class="powerup-list">
        ${powerUps.map((powerUp) => {
          const usable = isPowerUpUsable(teamState, powerUp);
          return `
            <div class="powerup-card">
              <div class="powerup-info">
                <strong>${esc(powerUp.label)}</strong>
                <p>${esc(powerUp.body ?? "")}</p>
              </div>
              ${powerUp.type === "shield"
                ? '<span class="powerup-auto">Automatisch</span>'
                : powerUp.type === "skip_task" || powerUp.type === "skip_free"
                  ? `<button class="button gold small" data-action="skip-with-powerup" data-powerup-id="${powerUp.id}" ${usable ? "" : "disabled"}>Inzetten</button>`
                  : `<button class="button gold small" data-action="use-powerup" data-powerup-id="${powerUp.id}" ${usable ? "" : "disabled"}>Inzetten</button>`}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function isPowerUpUsable(teamState, powerUp) {
  switch (powerUp.type) {
    case "skip_task":
    case "skip_free":
      return teamState.status === TEAM_STATUS.TASK_ACTIVE && teamState.currentTask?.skippable !== false;
    case "jail_free":
      return teamState.status === TEAM_STATUS.IN_JAIL;
    case "uno_reverse":
      return [TEAM_STATUS.CAN_ROLL, TEAM_STATUS.TASK_ACTIVE].includes(teamState.status);
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Testpaneel (alleen in testmodus)                                    */
/* ------------------------------------------------------------------ */

function renderDemoPanel(state, teamState) {
  return `
    <details class="panel demo-panel" open>
      <summary>Testpaneel</summary>
      <div class="demo-section">
        <span class="field-label">Forceer worp (alleen bij "Mag gooien")</span>
        <div class="demo-row">
          ${[1, 2, 3, 4, 5, 6].map((n) => `
            <button class="button ghost small demo-roll" data-action="demo-roll" data-roll="${n}">${n}</button>
          `).join("")}
        </div>
      </div>

      <div class="demo-section">
        <span class="field-label">Spring naar vak (voert het vak direct uit)</span>
        <div class="demo-row demo-teleport-row">
          <select id="demo-tile-select">
            ${TILES.map((tile) => `<option value="${tile.id}" ${tile.id === teamState.position ? "selected" : ""}>${tile.id}. ${esc(tile.name)} — ${esc(tile.type)}</option>`).join("")}
          </select>
          <button class="button gold small" data-action="demo-teleport">Ga</button>
        </div>
        <div class="demo-row">
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="8">Kans</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="3">Fonds</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="16">Wisselstation</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="6">Snack</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="11">Cel (bezoek)</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="31">Naar de cel</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="32">Dock 17</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="33">Van Ouds (rad)</button>
          <button class="button ghost small" data-action="demo-teleport-to" data-tile="29">Elektriciteit (bonus)</button>
        </div>
      </div>

      <div class="demo-section">
        <span class="field-label">Kaarten & power-ups</span>
        <div class="demo-row">
          <button class="button ghost small" data-action="demo-chance">Trek Kans</button>
          <button class="button ghost small" data-action="demo-fund">Trek Fonds</button>
          <button class="button ghost small" data-action="demo-powerups">Geef alle power-ups</button>
        </div>
      </div>

      <div class="demo-section">
        <span class="field-label">Simuleer aanval op jullie (schild blokkeert!)</span>
        <div class="demo-row">
          <button class="button ghost small" data-action="demo-attack" data-kind="move">2 achteruit</button>
          <button class="button ghost small" data-action="demo-attack" data-kind="wait">Wachttijd</button>
          <button class="button ghost small" data-action="demo-attack" data-kind="swap">Gewisseld</button>
          <button class="button ghost small" data-action="demo-attack" data-kind="jail">Naar cel</button>
        </div>
      </div>

      <div class="demo-section">
        <span class="field-label">Tijd & einde</span>
        <div class="demo-row">
          <button class="button ghost small" data-action="demo-skip-timer">Sla timer over</button>
          <button class="button ghost small" data-action="demo-almost-done">Nog 1 beurt</button>
          <button class="button ghost small" data-action="demo-finish-bots">Tegenstanders klaar</button>
          <button class="button ghost small" data-action="demo-restart">Herstart testmodus</button>
        </div>
      </div>
    </details>
  `;
}

/* ------------------------------------------------------------------ */
/* Bord (alleen eigen pion zichtbaar)                                  */
/* ------------------------------------------------------------------ */

function renderBoard(state, teamState, pawnPosition = teamState.position) {
  const cells = getBoardCells();
  const tile = findTileById(pawnPosition);
  const centerLabel = walk.active ? "Onderweg…" : esc(tile?.name ?? `Vak ${pawnPosition}`);
  return `
    <section class="panel board-panel">
      <div class="board-grid">
        ${cells.map((cell) => {
          if (!cell.tileId) {
            return '<div class="board-cell board-cell-empty"></div>';
          }
          const cellTile = findTileById(cell.tileId);
          const theme = getTileTheme(cellTile);
          const isHere = cell.tileId === pawnPosition;
          return `
            <div class="board-cell ${theme.className} ${isHere ? "is-here" : ""}" data-tile-id="${cell.tileId}" style="--tile-color:${theme.color}" title="${esc(cellTile.name)}">
              <span class="board-cell-label">${esc(theme.label)}</span>
              ${isHere ? '<span class="board-pawn"></span>' : ""}
            </div>
          `;
        }).join("")}
        <div class="board-center">
          <img src="./assets/zuipopoly-board-logo.svg" alt="" />
          <span class="board-center-pos">${centerLabel}</span>
        </div>
      </div>
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/* Eventlog                                                            */
/* ------------------------------------------------------------------ */

function renderEventLog(state) {
  const events = (state.eventLog ?? []).slice(-8).reverse();
  if (!events.length) {
    return "";
  }
  return `
    <section class="panel eventlog-panel">
      <h2>Live</h2>
      <ul class="eventlog-list">
        ${events.map((event) => `<li>${esc(event.text)}</li>`).join("")}
      </ul>
    </section>
  `;
}

/* ------------------------------------------------------------------ */
/* Popups en dialogen                                                  */
/* ------------------------------------------------------------------ */

function renderPopup(state, teamState) {
  const popup = teamState.activePopup;
  if (!popup || ui.dialog) {
    return "";
  }

  const kindClass = `popup-${popup.kind ?? "info"}`;

  if (popup.stage === "intro") {
    return `
      <div class="popup-overlay">
        <div class="popup-card ${kindClass}">
          <span class="popup-kind">${esc(popupKindLabel(popup.kind))}</span>
          <h2>${esc(popup.title)}</h2>
          <button class="button primary big" data-action="reveal-popup">Draai de kaart om</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="popup-overlay">
      <div class="popup-card ${kindClass}">
        <span class="popup-kind">${esc(popupKindLabel(popup.kind))}</span>
        <h2>${esc(popup.title)}</h2>
        <div class="popup-body">${nl2br(popup.body ?? "")}</div>
        ${popup.blockedChoiceMessage ? `<p class="popup-blocked">${esc(popup.blockedChoiceMessage)}</p>` : ""}
        <button class="button primary big" data-action="dismiss-popup">Oké</button>
      </div>
    </div>
  `;
}

function popupKindLabel(kind) {
  const labels = {
    chance: "Kans",
    fund: "Algemeen Fonds",
    swap: "Wisselstation",
    start: "Ronde-bonus",
    task: "Opdracht",
    snack: "Snackstation",
    parking: "Vrij Parkeren",
    jail: "Cel",
    finished: "Einde",
    info: "Melding"
  };
  return labels[kind] ?? "Melding";
}

function renderDialog(state, teamState) {
  if (!ui.dialog) {
    return "";
  }

  if (ui.dialog.type === "skip") {
    return `
      <div class="popup-overlay">
        <div class="popup-card popup-chance">
          <span class="popup-kind">Skippen</span>
          <h2>Weet je het zeker?</h2>
          <div class="popup-body">Weet je zeker dat jullie deze opdracht willen skippen? Jullie gaan ${GAME_CONFIG.skipPenaltySteps} vakjes achteruit.</div>
          <div class="stack-buttons">
            <button class="button primary big" data-action="skip-confirm">Ja, skip (−${GAME_CONFIG.skipPenaltySteps})</button>
            ${skipPowerUpButtons(teamState)}
            <button class="button ghost" data-action="dialog-cancel">Toch maar niet</button>
          </div>
        </div>
      </div>
    `;
  }

  if (ui.dialog.type === "choose") {
    const target = state.teams[ui.dialog.targetId];
    if (!target) {
      return "";
    }
    return `
      <div class="popup-overlay">
        <div class="popup-card popup-swap">
          <span class="popup-kind">Team kiezen</span>
          <h2>Bevestigen</h2>
          <div class="popup-body">Weet je zeker dat jullie <strong>${esc(target.name)}</strong> willen kiezen?</div>
          <div class="stack-buttons">
            <button class="button primary big" data-action="choose-confirm" data-team-id="${target.id}">Ja, kies ${esc(target.name)}</button>
            <button class="button ghost" data-action="dialog-cancel">Annuleren</button>
          </div>
        </div>
      </div>
    `;
  }

  if (ui.dialog.type === "settings") {
    const fb = getFeedbackSettings();
    return `
      <div class="popup-overlay">
        <div class="popup-card popup-task">
          <span class="popup-kind">Instellingen</span>
          <h2>Geluid &amp; trilling</h2>
          <div class="settings-list">
            <button class="settings-toggle ${fb.sound ? "is-on" : ""}" data-action="toggle-sound">
              <span>🔊 Geluid</span>
              <span class="toggle-pill">${fb.sound ? "AAN" : "UIT"}</span>
            </button>
            <button class="settings-toggle ${fb.vibration ? "is-on" : ""}" data-action="toggle-vibration">
              <span>📳 Trillen</span>
              <span class="toggle-pill">${fb.vibration ? "AAN" : "UIT"}</span>
            </button>
          </div>
          <button class="button primary big" data-action="dialog-cancel">Klaar</button>
        </div>
      </div>
    `;
  }

  if (ui.dialog.type === "leave") {
    return `
      <div class="popup-overlay">
        <div class="popup-card">
          <span class="popup-kind">Spelkamer verlaten</span>
          <h2>Weet je het zeker?</h2>
          <div class="popup-body">Dit toestel verlaat de spelkamer. Jullie team blijft bestaan en kan later worden hervat met de spelcode.</div>
          <div class="stack-buttons">
            <button class="button primary big" data-action="leave-room">Ja, verlaten</button>
            <button class="button ghost" data-action="dialog-cancel">Blijven</button>
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function skipPowerUpButtons(teamState) {
  const skipPowerUps = (teamState?.savedPowerUps ?? []).filter((powerUp) =>
    ["skip_task", "skip_free"].includes(powerUp.type)
  );
  return skipPowerUps
    .map(
      (powerUp) => `
        <button class="button gold" data-action="skip-with-powerup" data-powerup-id="${powerUp.id}">
          Skip met ${esc(powerUp.label)} (geen straf)
        </button>
      `
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* Eindstand                                                           */
/* ------------------------------------------------------------------ */

function renderEnded(state, teamState) {
  const ranking = getRanking(state);
  const winner = ranking[0]?.teamState;
  const color = findTeamColor(teamState.colorId);

  app.innerHTML = `
    <div class="screen screen-ended" style="--team-accent:${color.hex}">
      ${brandHeader("Spel afgelopen")}

      ${winner ? `
        <section class="panel winner-panel" style="--team-accent:${findTeamColor(winner.colorId).hex}">
          <span class="field-label">Winnaar</span>
          <h2 class="winner-name">${esc(winner.name)}</h2>
          <p>${winner.completedRounds} rondes · vak ${winner.position}</p>
        </section>
      ` : ""}

      <section class="panel">
        <h2>Eindstand</h2>
        <ol class="ranking-list">
          ${ranking.map(({ teamState: team }, index) => `
            <li class="${team.id === teamState.id ? "is-own" : ""}" style="--team-accent:${findTeamColor(team.colorId).hex}">
              <span class="ranking-place">${index + 1}</span>
              <span class="team-chip-dot"></span>
              <span class="ranking-name">${esc(team.name)}</span>
              <span class="ranking-stats">${team.completedRounds} rondes · vak ${team.position}</span>
            </li>
          `).join("")}
        </ol>
        <p class="panel-sub">Winnaar = meeste rondes, dan hoogste vak, dan wie daar het eerst was.</p>
      </section>

      <button class="button primary big" data-action="leave-room">Terug naar start</button>
      ${renderPopup(state, teamState)}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) {
    return;
  }
  const action = target.dataset.action;
  const session = getSession();

  switch (action) {
    case "nav-home":
      ui.screen = "home";
      ui.createError = "";
      ui.joinError = "";
      render();
      break;
    case "nav-create":
      ui.screen = "create";
      render();
      break;
    case "nav-join":
      ui.screen = "join";
      ui.joinFetchedState = null;
      render();
      break;
    case "join-back":
      ui.joinFetchedState = null;
      ui.joinError = "";
      render();
      break;
    case "create-mode":
      ui.createModeId = target.dataset.modeId;
      render();
      break;
    case "create-color":
      ui.createColorId = target.dataset.colorId;
      render();
      break;
    case "join-color":
      ui.joinColorId = target.dataset.colorId;
      render();
      break;
    case "create-player-minus":
      ui.createPlayerCount = Math.max(1, ui.createPlayerCount - 1);
      render();
      break;
    case "create-player-plus":
      ui.createPlayerCount = Math.min(8, ui.createPlayerCount + 1);
      render();
      break;
    case "join-player-minus":
      ui.joinPlayerCount = Math.max(1, ui.joinPlayerCount - 1);
      render();
      break;
    case "join-player-plus":
      ui.joinPlayerCount = Math.min(8, ui.joinPlayerCount + 1);
      render();
      break;
    case "lobby-player-minus":
      setPlayerCount(session.teamId, (getState()?.teams[session.teamId]?.playerCount ?? 2) - 1);
      break;
    case "lobby-player-plus":
      setPlayerCount(session.teamId, (getState()?.teams[session.teamId]?.playerCount ?? 2) + 1);
      break;
    case "resume-team": {
      const result = takeoverTeam(ui.joinFetchedState?.roomCode ?? ui.joinCode, target.dataset.teamId, ui.joinFetchedState);
      if (result.ok) {
        ui.joinFetchedState = null;
        connectSync();
      } else {
        ui.joinError = result.message;
      }
      render();
      break;
    }
    case "takeover-session":
      takeoverTeam(session.roomCode, session.teamId);
      render();
      break;
    case "copy-code": {
      const state = getState();
      if (state?.roomCode && navigator.clipboard) {
        navigator.clipboard.writeText(state.roomCode).catch(() => {});
        ui.copied = true;
        window.setTimeout(() => {
          ui.copied = false;
          render();
        }, 1600);
      }
      render();
      break;
    }
    case "start-game":
      startGame(session.teamId);
      break;
    case "roll-dice":
      rollDice(session.teamId);
      break;
    case "confirm-task":
      feedback.confirm();
      confirmTask(session.teamId);
      break;
    case "confirm-task-bonus":
      feedback.confirm();
      confirmTask(session.teamId, { withBonus: true });
      break;
    case "ask-skip":
      ui.dialog = { type: "skip" };
      render();
      break;
    case "skip-confirm":
      ui.dialog = null;
      skipTask(session.teamId);
      break;
    case "skip-with-powerup":
      ui.dialog = null;
      skipTask(session.teamId, { powerUpId: target.dataset.powerupId });
      break;
    case "ask-choose":
      ui.dialog = { type: "choose", targetId: target.dataset.teamId };
      render();
      break;
    case "choose-confirm":
      ui.dialog = null;
      chooseTeam(session.teamId, target.dataset.teamId);
      break;
    case "choice-none":
      resolveChoiceWithoutTarget(session.teamId);
      break;
    case "dialog-cancel":
      ui.dialog = null;
      render();
      break;
    case "open-settings":
      ui.dialog = { type: "settings" };
      render();
      break;
    case "toggle-sound":
      setFeedbackSetting("sound", !getFeedbackSettings().sound);
      render();
      break;
    case "toggle-vibration": {
      const next = !getFeedbackSettings().vibration;
      setFeedbackSetting("vibration", next);
      if (next) feedback.tap();
      render();
      break;
    }
    case "ask-leave":
      ui.dialog = { type: "leave" };
      render();
      break;
    case "leave-room":
      ui.dialog = null;
      ui.screen = "home";
      clearSession();
      break;
    case "use-powerup":
      feedback.powerup();
      usePowerUp(session.teamId, target.dataset.powerupId);
      break;
    case "dock17-reveal":
      revealDock17Choices(session.teamId);
      break;
    case "vanouds-spin":
      spinVanOudsWheel(session.teamId, target.dataset.choiceId);
      break;
    case "dismiss-popup":
      dismissPopup(session.teamId);
      break;
    case "reveal-popup": {
      const kind = getState()?.teams?.[session.teamId]?.activePopup?.kind;
      feedback.cardFlip(kind === "fund" ? "fund" : "chance");
      revealPopupCard(session.teamId);
      break;
    }
    case "start-demo":
    case "demo-restart":
      startDemoGame();
      break;
    case "demo-roll":
      rollDice(session.teamId, Number(target.dataset.roll));
      break;
    case "demo-teleport": {
      const select = document.getElementById("demo-tile-select");
      demoTeleport(select?.value);
      break;
    }
    case "demo-teleport-to":
      demoTeleport(target.dataset.tile);
      break;
    case "demo-chance":
      demoDrawCard("chance");
      break;
    case "demo-fund":
      demoDrawCard("fund");
      break;
    case "demo-powerups":
      demoGivePowerUps();
      break;
    case "demo-attack":
      demoIncomingAttack(target.dataset.kind);
      break;
    case "demo-skip-timer":
      demoSkipTimer();
      break;
    case "demo-almost-done":
      demoAlmostDone();
      break;
    case "demo-finish-bots":
      demoFinishOpponents();
      break;
    default:
      break;
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) {
    return;
  }
  event.preventDefault();
  const data = new FormData(form);

  if (form.dataset.form === "create-room") {
    const result = createRoom({
      modeId: ui.createModeId,
      teamName: data.get("teamName"),
      colorId: ui.createColorId,
      playerCount: ui.createPlayerCount
    });
    if (!result.ok) {
      ui.createError = result.message;
      render();
      return;
    }
    ui.createError = "";
    connectSync();
    render();
    return;
  }

  if (form.dataset.form === "join-fetch") {
    ui.joinCode = normalizeRoomCode(data.get("roomCode"));
    ui.joinError = "";
    render();
    const result = await fetchRoom(ui.joinCode);
    if (!result.ok) {
      ui.joinError = result.message;
    } else {
      ui.joinFetchedState = result.state;
    }
    render();
    return;
  }

  if (form.dataset.form === "join-room") {
    const result = joinRoom({
      roomCode: ui.joinFetchedState?.roomCode ?? ui.joinCode,
      teamName: data.get("teamName"),
      colorId: ui.joinColorId,
      playerCount: ui.joinPlayerCount,
      roomState: ui.joinFetchedState
    });
    if (!result.ok) {
      ui.joinError = result.message;
      render();
      return;
    }
    ui.joinError = "";
    ui.joinFetchedState = null;
    connectSync();
    render();
  }
});

app.addEventListener("change", (event) => {
  const target = event.target.closest("[data-change]");
  if (!target) {
    return;
  }
  const session = getSession();
  if (target.dataset.change === "dock17-number") {
    updateDock17Choice(session.teamId, target.dataset.choiceId, target.value);
  }
});

/* ------------------------------------------------------------------ */
/* Sync & klok                                                         */
/* ------------------------------------------------------------------ */

async function connectSync() {
  ui.syncMode = "connecting";
  const result = await initializeRemoteSync();
  ui.syncMode = result.ok ? "remote" : "local";
  render();
}

subscribe(() => {
  render();
});

// Werk alleen de zichtbare timer-getallen bij, zonder het scherm te herbouwen.
// Zo knippert de kaart niet meer elke seconde. Structurele wijzigingen
// (timer afgelopen, status verandert) lopen via runClockTick -> subscribe -> render.
function updateVisibleTimers() {
  const state = getState();
  const session = getSession();

  if (state?.phase === GAME_PHASE.COUNTDOWN) {
    const el = document.querySelector(".countdown-number");
    const remaining = getCountdownRemaining(state);
    if (el && remaining != null) {
      el.textContent = remaining;
      if (remaining !== lastCountdownValue) {
        lastCountdownValue = remaining;
        feedback.countdownTick(remaining <= 1);
      }
    }
    return;
  }
  lastCountdownValue = null;

  const teamState = state?.teams?.[session?.teamId];
  if (!teamState) {
    return;
  }

  if (teamState.status === TEAM_STATUS.TASK_ACTIVE && teamState.currentTask?.timerSeconds) {
    const remaining = getTaskConfirmRemaining(teamState);
    const el = document.querySelector(".task-timer strong");
    if (remaining > 0) {
      if (el) {
        el.textContent = fmtTime(remaining);
      }
    } else if (el) {
      // Timer net op 0: één keer volledig renderen zodat de knop actief wordt
      // en de timerregel verdwijnt. Daarna is er geen .task-timer meer, dus
      // geen herhaalde renders.
      render();
    }
    return;
  }

  if ([TEAM_STATUS.WAITING_TIMER, TEAM_STATUS.WAITING_SWAP].includes(teamState.status)) {
    const el = document.querySelector(".wait-timer");
    const remaining = getTeamCountdownSeconds(teamState, "waitUntil");
    if (el && remaining != null) {
      el.textContent = fmtTime(remaining);
    }
    return;
  }

  if (teamState.status === TEAM_STATUS.IN_JAIL) {
    const el = document.querySelector(".wait-timer");
    const remaining = getTeamCountdownSeconds(teamState, "jailUntil");
    if (el && remaining != null) {
      el.textContent = fmtTime(remaining);
    }
  }
}

window.setInterval(() => {
  runClockTick();
  updateVisibleTimers();
}, 1000);

if (new URLSearchParams(window.location.search).get("reset") === "1") {
  clearSession();
}

// ?demo=1 start de testmodus direct.
if (new URLSearchParams(window.location.search).get("demo") === "1" && !getSession()?.roomCode) {
  startDemoGame();
}

if (getSession()?.roomCode && !getState()?.isDemo) {
  connectSync();
}

render();
