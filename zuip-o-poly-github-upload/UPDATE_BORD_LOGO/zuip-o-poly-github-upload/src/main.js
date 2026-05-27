import { GAME_CONFIG, TEAM_RULES } from "./data/gameConfig.js";
import { getBoardCells } from "./data/board.js";
import { TEAM_STATUS, GAME_PHASE } from "./data/statuses.js";
import { KROEGRAAD_USERS, TEAMS, findTeamById, teamsForKroegraad } from "./data/teams.js";
import { findTileById } from "./data/tiles.js";
import { getTileTheme } from "./data/tileThemes.js";
import {
  allTeamsLoggedIn,
  approveTeamTask,
  clearCurrentSession,
  getCountdownRemaining,
  getCurrentSession,
  getState,
  getTeamState,
  loginKroegraad,
  loginTeam,
  rejectTeamTask,
  resetPreparation,
  rollDice,
  runClockTick,
  startCountdown,
  startTeamDemo,
  submitProofInWhatsapp,
  dismissTeamPopup,
  demoResolveTeamTask,
  demoDrawCard,
  useSavedPowerUp,
  initializeRemoteSync,
  togglePause,
  releaseTeamSession,
  getRanking,
  subscribe
} from "./store/gameStore.js";

const app = document.querySelector("#app");
const ui = {
  loginMode: "team",
  teamTab: "play",
  error: "",
  notice: ""
};

function logoMarkup(compact = false) {
  const imageSrc = compact
    ? "./assets/zuipopoly-banner-normalized.svg"
    : "./assets/zuipopoly-logo-full.png";
  const imageAlt = compact ? "Zuip-O-Poly" : "Zuip-O-Poly Camping van Eck Nijmegen";

  return `
    <div class="${compact ? "brand brand-compact" : "brand brand-full"}">
      <img
        class="brand-image ${compact ? "brand-image-banner" : "brand-image-full"}"
        src="${imageSrc}"
        alt="${imageAlt}"
        onload="this.closest('.brand').classList.add('has-brand-image')"
        onerror="this.closest('.brand').classList.remove('has-brand-image')"
      />
      <div class="brand-fallback">
        ${
          compact
            ? `<div class="fallback-banner">Zuip-O-Poly</div>`
            : `
              <div class="fallback-logo">
                <div class="fallback-logo-top">Camping van Eck</div>
                <div class="fallback-logo-main">Zuip-O-Poly</div>
                <div class="fallback-logo-bottom">Nijmegen</div>
              </div>
            `
        }
      </div>
    </div>
  `;
}

function button(label, className = "primary", attrs = "") {
  return `<button class="button ${className}" ${attrs}>${label}</button>`;
}

function teamBadge(team) {
  return `<span class="team-icon" style="--team-accent:${team.accent}" aria-hidden="true">●●●</span>`;
}

function getTileName(tileId) {
  return findTileById(tileId)?.name ?? "Onbekend vak";
}

function getRoundLabel(teamState) {
  const currentRound = Math.min(teamState.completedRounds + 1, GAME_CONFIG.displayRounds);
  return `Ronde ${currentRound} van ${GAME_CONFIG.displayRounds}`;
}

function getTurnLabel(teamState) {
  return `Beurt ${teamState.normalTurnsUsed ?? 0} van ${GAME_CONFIG.maxNormalTurns}`;
}

function teamCard(team, teamState, extra = "") {
  return `
    <article class="team-card" style="--team-accent:${team.accent}">
      <div class="team-card-top">
        ${teamBadge(team)}
        <div>
          <h2>${team.name}</h2>
          <p>${getTurnLabel(teamState)} <span>|</span> Positie: ${teamState.position} <span>|</span> ${getTileName(teamState.currentTileId)}</p>
        </div>
        <strong class="round-pill">${getRoundLabel(teamState)}</strong>
      </div>
      <dl class="team-summary-grid">
        <div>
          <dt>Status</dt>
          <dd>${teamState.status}</dd>
        </div>
        <div>
          <dt>Positie</dt>
          <dd>${teamState.position}</dd>
        </div>
        <div>
          <dt>Vak</dt>
          <dd>${getTileName(teamState.currentTileId)}</dd>
        </div>
        <div>
          <dt>Laatste worp</dt>
          <dd>${teamState.lastRoll ?? "-"}</dd>
        </div>
        <div>
          <dt>Bewijs</dt>
          <dd>${teamState.proofInWhatsapp ? "WhatsApp" : "-"}</dd>
        </div>
      </dl>
      ${
        teamState.savedPowerUp
          ? `<div class="powerup-badge">
              <span>Power-up</span>
              <strong>${teamState.savedPowerUp.label}</strong>
            </div>`
          : ""
      }
      ${extra}
    </article>
  `;
}

function renderBoardShortcut() {
  return `
    <button class="board-shortcut" data-action="tab-board">
      <span class="shortcut-icon" aria-hidden="true"></span>
      <strong>Bekijk bord</strong>
      <span class="shortcut-arrow" aria-hidden="true">›</span>
    </button>
  `;
}

function renderLoggedOut() {
  app.innerHTML = `
    <section class="screen auth-screen">
      ${logoMarkup()}
      <div class="mode-switch" role="tablist" aria-label="Login type">
        <button class="${ui.loginMode === "team" ? "active" : ""}" data-action="mode-team">Team</button>
        <button class="${ui.loginMode === "kroegraad" ? "active" : ""}" data-action="mode-kroegraad">Kroegraad</button>
      </div>
      ${ui.loginMode === "team" ? renderTeamLogin() : renderKroegraadLogin()}
      <section class="panel demo-panel">
        <p class="eyebrow">Testomgeving</p>
        <h2>Even rondklikken als team</h2>
        <p class="helper">Start direct als Bruine Kroeg met alle teams al ingelogd en het spel al gestart.</p>
        ${button("Start test als Bruine Kroeg", "ghost", 'data-action="start-team-demo"')}
      </section>
      ${ui.error ? `<p class="form-message error">${ui.error}</p>` : ""}
      ${ui.notice ? `<p class="form-message">${ui.notice}</p>` : ""}
    </section>
  `;
}

function renderTeamLogin() {
  return `
    <form class="panel auth-panel" data-form="team-login">
      <label>
        Teamcode
        <input name="teamCode" autocomplete="off" autocapitalize="characters" placeholder="BRUINEKROEG" />
      </label>
      ${button("Team inloggen", "primary", 'type="submit"')}
      <p class="helper">Geldige teams staan in de configuratie. Teamcodes zijn hoofdlettergevoelig.</p>
    </form>
  `;
}

function renderKroegraadLogin() {
  return `
    <form class="panel auth-panel" data-form="kroegraad-login">
      <label>
        Loginnaam
        <input name="loginName" autocomplete="username" autocapitalize="characters" placeholder="SWEN" />
      </label>
      <label>
        Code
        <input name="code" type="password" inputmode="numeric" autocomplete="current-password" placeholder="0805" />
      </label>
      ${button("Kroegraad inloggen", "primary", 'type="submit"')}
      <p class="helper">Beschikbaar: ${KROEGRAAD_USERS.map((user) => user.loginName).join(" / ")}.</p>
    </form>
  `;
}

function renderTeamApp(session, state) {
  const team = findTeamById(session.teamId);
  const teamState = getTeamState(session.teamId, state);

  if (!team || !teamState || teamState.activeSessionId !== session.sessionId) {
    clearCurrentSession();
    render();
    return;
  }

  if (state.phase === GAME_PHASE.COUNTDOWN) {
    renderCountdown(team);
    return;
  }

  if (state.phase === GAME_PHASE.RUNNING) {
    renderTeamRunning(team, teamState, state);
    return;
  }

  app.innerHTML = `
    <section class="screen">
      ${logoMarkup()}
      ${teamCard(team, teamState)}
      <section class="panel rules-panel">
        <h2>Wachtkamer</h2>
        <p class="status-line">Wacht tot de Kroegraad het spel start.</p>
        <ul>
          ${TEAM_RULES.map((rule) => `<li>${rule}</li>`).join("")}
        </ul>
      </section>
    </section>
  `;
}

function renderCountdown(team = null) {
  const remaining = getCountdownRemaining(getState()) ?? GAME_CONFIG.countdownSeconds;
  app.innerHTML = `
    <section class="screen countdown-screen">
      ${logoMarkup(true)}
      <div class="countdown-ring" style="${team ? `--team-accent:${team.accent}` : ""}">
        <span class="js-countdown">${remaining}</span>
      </div>
      <h2>Het spel start zo</h2>
      <p>Geen geluid. Hou je telefoon bij de hand.</p>
    </section>
  `;
}

function renderTeamRunning(team, teamState, state) {
  if (ui.teamTab === "board") {
    renderTeamBoard(team, teamState, state);
    return;
  }

  const currentTile = findTileById(teamState.currentTileId);
  app.innerHTML = `
    <section class="screen">
      ${logoMarkup(true)}
      ${teamCard(team, teamState)}
      ${renderBoardShortcut()}
      ${renderTurnStrip(teamState)}
      ${state.paused ? renderPauseNotice() : ""}
      ${renderActivePlayCard(teamState, team.id, currentTile)}
      ${renderDemoTools(team, teamState)}
      ${renderTeamTabs()}
    </section>
  `;
}

function renderTurnStrip(teamState) {
  const lastRoll = teamState.lastRoll ?? teamState.lastMove?.roll ?? null;
  return `
    <section class="timer-strip turn-strip">
      <div>
        <span>Normale dobbelbeurten</span>
        <strong>${teamState.normalTurnsUsed ?? 0}/${GAME_CONFIG.maxNormalTurns}</strong>
      </div>
      ${
        lastRoll
          ? `
            <div class="last-roll-chip" aria-label="Laatste worp ${lastRoll}">
              <span>Worp</span>
              <strong class="last-roll-value">${lastRoll}</strong>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderPauseNotice() {
  return `
    <section class="panel pause-notice">
      <p class="eyebrow">Gepauzeerd</p>
      <h2>Het spel is tijdelijk gepauzeerd door de Kroegraad.</h2>
      <p class="helper">Je opdracht mag je in principe blijven doen, maar je kunt nu niet gooien of bewijs melden.</p>
    </section>
  `;
}

function renderTeamPopup(teamState, teamId) {
  if (!teamState.activePopup) {
    return "";
  }

  const kind = teamState.activePopup.kind ?? "task";
  const labelByKind = {
    chance: "Kans",
    fund: "Algemeen Fonds",
    snack: "Snackstation",
    parking: "Vrij Parkeren",
    rejected: "Afgekeurd",
    task: "Nieuwe opdracht"
  };

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="popup-title">
      <section class="popup-card popup-${kind}">
        <p class="eyebrow">${labelByKind[kind] ?? "Nieuwe opdracht"}</p>
        <h2 id="popup-title">${teamState.activePopup.title}</h2>
        <p>${teamState.activePopup.body}</p>
        ${button("Begrepen", "primary", `data-action="dismiss-popup" data-team-id="${teamId}"`)}
      </section>
    </div>
  `;
}

function renderActivePlayCard(teamState, teamId, currentTile) {
  if ([TEAM_STATUS.CAN_ROLL, TEAM_STATUS.APPROVED].includes(teamState.status)) {
    return `${renderDicePanel(teamState, teamId)}${renderPowerUpPanel(teamState, teamId)}`;
  }

  if (teamState.status === TEAM_STATUS.WAITING_KROEGRAAD) {
    return `
      <section class="panel play-panel status-panel">
        <div class="status-card-icon" aria-hidden="true"></div>
        <div>
          <p class="eyebrow">De Kroegraad beoordeelt jullie bewijs...</p>
          <p class="tile-type">Zodra jullie bewijs is goedgekeurd, mag je opnieuw gooien.</p>
        </div>
        ${renderActionButton(teamState, teamId)}
      </section>
    `;
  }

  if (teamState.status === TEAM_STATUS.FINISHED) {
    return `
      <section class="panel play-panel status-panel">
        <p class="eyebrow">Spel afgelopen</p>
        <h2>Kom naar De Tempelier</h2>
        <p class="tile-type">De Kroegraad maakt daar de winnaar bekend.</p>
      </section>
    `;
  }

  return `
    <section class="panel play-panel">
      <p class="eyebrow">${teamState.status === TEAM_STATUS.REJECTED ? "Afgekeurd" : "Huidige opdracht"}</p>
      <h2>${currentTile?.name ?? "Onbekend vak"}</h2>
      <p class="tile-type">${currentTile?.type ?? ""}</p>
      ${renderTask(teamState)}
      ${renderPowerUpPanel(teamState, teamId)}
      ${renderActionButton(teamState, teamId)}
    </section>
  `;
}

function renderPowerUpPanel(teamState, teamId) {
  if (!teamState.savedPowerUp) {
    return "";
  }

  return `
    <section class="powerup-panel">
      <div>
        <span>Power-up klaar</span>
        <strong>${teamState.savedPowerUp.label}</strong>
      </div>
      ${button("Gebruik power-up", "ghost", `data-action="use-powerup" data-team-id="${teamId}"`)}
    </section>
  `;
}

function renderTeamBoard(team, teamState, state) {
  app.innerHTML = `
    <section class="screen">
      ${logoMarkup(true)}
      ${renderTurnStrip(teamState)}
      ${teamCard(team, teamState)}
      <section class="panel board-panel" style="--team-accent:${team.accent}">
        <div class="board-header">
          <div>
            <p class="eyebrow">Bord</p>
            <h2>${getTileName(teamState.currentTileId)}</h2>
          </div>
          <strong>Vak ${teamState.currentTileId}</strong>
        </div>
        <div class="board-grid" aria-label="Zuip-O-Poly bord">
          <div class="board-center-logo" aria-hidden="true">
            <img src="./assets/zuipopoly-board-logo.svg" alt="" />
          </div>
          ${getBoardCells()
            .map((cell) => renderBoardCell(cell, teamState))
            .join("")}
        </div>
      </section>
      ${renderTeamTabs()}
    </section>
  `;
}

function renderBoardCell(cell, teamState) {
  if (!cell.tileId) {
    return `<div class="board-cell board-cell-empty" aria-hidden="true"></div>`;
  }

  const tile = findTileById(cell.tileId);
  const isCurrent = cell.tileId === teamState.currentTileId;
  const theme = getTileTheme(tile);
  return `
    <div
      class="board-cell ${theme.className} ${isCurrent ? "is-current" : ""}"
      style="--tile-color:${theme.color}"
      title="${tile.name}"
    >
      ${
        theme.className === "theme-station"
          ? `<img class="board-icon ns-logo" src="./assets/ns-logo-normalized.svg" alt="NS station" />`
          : ""
      }
      ${
        theme.className === "theme-chance"
          ? `<img class="board-icon tile-icon tile-icon-chance" src="./assets/kans-normalized.svg" alt="Kans" />`
          : ""
      }
      ${
        theme.className === "theme-fund"
          ? `<img class="board-icon tile-icon tile-icon-fund" src="./assets/algemeen-fonds-normalized.svg" alt="Algemeen Fonds" />`
          : ""
      }
      ${isCurrent ? `<i class="pawn" aria-label="Eigen pion"></i>` : ""}
    </div>
  `;
}

function renderTeamTabs() {
  return `
    <nav class="bottom-tabs" aria-label="Spel navigatie">
      <button class="${ui.teamTab === "play" ? "active" : ""}" data-action="tab-play">Spelen</button>
      <button class="${ui.teamTab === "board" ? "active" : ""}" data-action="tab-board">Bord</button>
    </nav>
  `;
}

function renderMoveFlash(teamState) {
  if (!teamState.lastMove) {
    return "";
  }

  return `
    <section class="move-flash">
      <div>
        <span>Je gooide</span>
        <strong>${teamState.lastMove.roll}</strong>
      </div>
      <p>
        Van vak ${teamState.lastMove.from} naar ${teamState.lastMove.to}.
        ${
          teamState.lastMove.crossedStart
            ? "Je kwam langs Grote Markt Nijmegen: +1 ronde."
            : ""
        }
      </p>
    </section>
  `;
}

function renderDemoTools(team, teamState) {
  const session = getCurrentSession();
  if (!session?.demo) {
    return "";
  }

  return `
    <section class="panel demo-panel">
      <p class="eyebrow">Testmodus</p>
      <h2>${team.name}</h2>
      <p class="helper">Gebruik dit alleen om de teamflow snel te proberen.</p>
      <div class="demo-card-actions">
        ${button("Test Kans", "ghost", `data-action="demo-card-chance" data-team-id="${team.id}"`)}
        ${button("Test Fonds", "ghost", `data-action="demo-card-fund" data-team-id="${team.id}"`)}
      </div>
      <div class="review-actions">
        ${button(
          "Demo goedkeuren",
          "approve",
          `data-action="demo-approve" data-team-id="${team.id}" ${
            teamState.status === TEAM_STATUS.WAITING_KROEGRAAD ? "" : "disabled"
          }`
        )}
        ${button(
          "Demo afkeuren",
          "reject",
          `data-action="demo-reject" data-team-id="${team.id}" ${
            teamState.status === TEAM_STATUS.WAITING_KROEGRAAD ? "" : "disabled"
          }`
        )}
      </div>
      ${button("Reset testomgeving", "ghost", 'data-action="start-team-demo"')}
    </section>
  `;
}

function renderTask(teamState) {
  if (!teamState.currentTask) {
    return `<p class="helper empty-task">Klik op de dobbelsteenknop om naar je eerste opdracht te gaan.</p>`;
  }

  return `
    <article class="task-card ${teamState.currentTask.placeholder ? "is-placeholder" : ""}">
      <h3>${teamState.currentTask.title}</h3>
      <p>${teamState.currentTask.body}</p>
      ${
        teamState.rejectionPenalty
          ? `<p class="penalty">${teamState.rejectionPenalty}</p>`
          : ""
      }
    </article>
  `;
}

function renderDicePanel(teamState, teamId) {
  const canRoll = [TEAM_STATUS.CAN_ROLL, TEAM_STATUS.APPROVED].includes(teamState.status);
  if (!canRoll) {
    return "";
  }

  const face = teamState.lastRoll ?? 3;
  return `
    <section class="panel dice-panel">
      <p class="eyebrow">${teamState.status === TEAM_STATUS.APPROVED ? "Goedgekeurd" : "Mag gooien"}</p>
      <h2>${teamState.status === TEAM_STATUS.APPROVED ? "Volgende worp" : "Gooi de dobbelsteen"}</h2>
      <div class="dice-stage" aria-hidden="true">
        <div class="die die-${face}">
          ${Array.from({ length: 6 }, (_, index) => `<span class="pip pip-${index + 1}"></span>`).join("")}
        </div>
      </div>
      ${renderActionButton(teamState, teamId)}
    </section>
  `;
}

function renderActionButton(teamState, teamId) {
  const teamAttr = `data-team-id="${teamId}"`;
  const state = getState();

  if (state.paused && [TEAM_STATUS.CAN_ROLL, TEAM_STATUS.APPROVED, TEAM_STATUS.TASK_ACTIVE, TEAM_STATUS.REJECTED].includes(teamState.status)) {
    return button("Gepauzeerd", "disabled", "disabled");
  }

  if (teamState.status === TEAM_STATUS.CAN_ROLL) {
    return button("GOOI!", "primary", `data-action="roll-dice" ${teamAttr}`);
  }

  if (teamState.status === TEAM_STATUS.TASK_ACTIVE || teamState.status === TEAM_STATUS.REJECTED) {
    return button("Bewijs staat in WhatsApp", "primary proof-button", `data-action="submit-proof" ${teamAttr}`);
  }

  if (teamState.status === TEAM_STATUS.WAITING_KROEGRAAD) {
    return button("Wachten op Kroegraad...", "disabled", "disabled");
  }

  if (teamState.status === TEAM_STATUS.APPROVED) {
    return button("Volgende worp", "primary", `data-action="roll-dice" ${teamAttr}`);
  }

  if (teamState.status === TEAM_STATUS.IN_JAIL) {
    return button("Celstraf: --:--", "disabled", "disabled");
  }

  if (teamState.status === TEAM_STATUS.WAITING_SWAP) {
    return button("Wachten: --:--", "disabled", "disabled");
  }

  if (teamState.status === TEAM_STATUS.PAUSED) {
    return button("Gepauzeerd", "disabled", "disabled");
  }

  return "";
}

function renderKroegraadApp(session, state) {
  const user = KROEGRAAD_USERS.find((item) => item.id === session.kroegraadId);
  const displayName = user?.loginName ?? session.kroegraadId;

  if (state.phase === GAME_PHASE.COUNTDOWN) {
    app.innerHTML = `
      <section class="screen council-screen">
        ${logoMarkup(true)}
        <div class="panel">
          <p class="eyebrow">Ingelogd als ${displayName}</p>
          <h2>Countdown loopt</h2>
          <div class="council-count">${getCountdownRemaining(state) ?? GAME_CONFIG.countdownSeconds}</div>
        </div>
      </section>
    `;
    return;
  }

  if (state.phase === GAME_PHASE.RUNNING) {
    renderKroegraadRunning(session, state, displayName);
    return;
  }

  const canStart = allTeamsLoggedIn(state);
  app.innerHTML = `
    <section class="screen council-screen">
      ${logoMarkup(true)}
      <div class="panel">
        <p class="eyebrow">Zuip-O-Poly Kroegraad</p>
        <h2>Ingelogd als ${displayName}</h2>
        <div class="checklist">
          ${TEAMS.map((team) => {
            const loggedIn = state.teams[team.id]?.loggedIn;
            return `
              <div class="check-row">
                <span>${teamBadge(team)} ${team.name}</span>
                <strong class="${loggedIn ? "ok" : "missing"}">${loggedIn ? "ingelogd" : "niet ingelogd"}</strong>
              </div>
            `;
          }).join("")}
        </div>
        ${button("Spel starten", "primary", `data-action="start-game" ${canStart ? "" : "disabled"}`)}
        ${button("Reset voorbereiding", "ghost", 'data-action="reset-prep"')}
        ${button("Uitloggen", "ghost", 'data-action="logout"')}
        <p class="helper">Starten kan pas zodra alle ${GAME_CONFIG.totalTeamsRequired} teams ingelogd zijn.</p>
      </div>
    </section>
  `;
}

function renderKroegraadRunning(session, state, displayName) {
  const assigned = teamsForKroegraad(session.kroegraadId)
    .map((team) => ({ team, teamState: state.teams[team.id] }))
    .sort((a, b) => {
      const aNeedsReview = a.teamState.status === TEAM_STATUS.WAITING_KROEGRAAD;
      const bNeedsReview = b.teamState.status === TEAM_STATUS.WAITING_KROEGRAAD;
      return Number(bNeedsReview) - Number(aNeedsReview);
    });
  const reviewCount = assigned.filter(({ teamState }) => teamState.status === TEAM_STATUS.WAITING_KROEGRAAD).length;
  const busyCount = assigned.filter(({ teamState }) =>
    [TEAM_STATUS.TASK_ACTIVE, TEAM_STATUS.REJECTED].includes(teamState.status)
  ).length;
  const finishedCount = assigned.filter(({ teamState }) => teamState.status === TEAM_STATUS.FINISHED).length;

  app.innerHTML = `
    <section class="screen council-screen">
      ${logoMarkup(true)}
      <div class="panel council-command">
        <div class="council-command-top">
          <div>
            <p class="eyebrow">Zuip-O-Poly Kroegraad</p>
            <h2>${displayName}</h2>
          </div>
          <strong class="status-badge ${state.paused ? "is-paused" : "is-live"}">${state.paused ? "Gepauzeerd" : "Actief"}</strong>
        </div>
        <div class="council-metrics" aria-label="Kroegraad overzicht">
          <div class="metric-card is-review">
            <span>Te keuren</span>
            <strong>${reviewCount}</strong>
          </div>
          <div class="metric-card">
            <span>Bezig</span>
            <strong>${busyCount}</strong>
          </div>
          <div class="metric-card">
            <span>Klaar</span>
            <strong>${finishedCount}</strong>
          </div>
        </div>
        ${
          reviewCount
            ? `<div class="council-alert">Er ${reviewCount === 1 ? "staat" : "staan"} ${reviewCount} ${reviewCount === 1 ? "team" : "teams"} klaar voor keuring.</div>`
            : `<div class="council-empty-review">Geen open keuringen. Teams die bezig zijn komen vanzelf bovenaan zodra bewijs klaarstaat.</div>`
        }
        <div class="council-actions">
          ${button(state.paused ? "Spel hervatten" : "Spel pauzeren", "ghost", 'data-action="toggle-pause"')}
          ${button("Uitloggen", "ghost small", 'data-action="logout"')}
        </div>
      </div>
      <section class="team-list">
        ${assigned.map(({ team, teamState }) => renderCouncilTeamCard(team, teamState)).join("")}
      </section>
      ${state.timerFinishedAt ? renderRankingPanel(state) : ""}
    </section>
  `;
}

function renderCouncilTeamCard(team, teamState) {
  const needsReview = teamState.status === TEAM_STATUS.WAITING_KROEGRAAD;
  const isBusy = teamState.status === TEAM_STATUS.TASK_ACTIVE || teamState.status === TEAM_STATUS.REJECTED;
  const isFinished = teamState.status === TEAM_STATUS.FINISHED;
  const statusClass = needsReview
    ? "is-review"
    : isBusy
      ? "is-busy"
      : isFinished
        ? "is-finished"
        : "is-neutral";
  const waitingText = teamState.status === TEAM_STATUS.REJECTED
    ? "Team moet opnieuw bewijs sturen."
    : "Team is bezig met opdracht. Wachten op bewijs.";

  return `
    <article class="team-card council-card ${needsReview ? "needs-review" : ""}" style="--team-accent:${team.accent}" data-status="${teamState.status}">
      <div class="team-card-top">
        ${teamBadge(team)}
        <div>
          <h2>${team.name}</h2>
          <p class="council-team-meta">Beurt ${teamState.normalTurnsUsed ?? 0}/${GAME_CONFIG.maxNormalTurns}</p>
        </div>
        <strong class="status-badge ${statusClass}">${needsReview ? "TE KEUREN" : teamState.status}</strong>
        <details class="team-menu">
          <summary aria-label="Team menu">⋯</summary>
          <button data-action="release-session" data-team-id="${team.id}" type="button">Sessie vrijgeven</button>
        </details>
      </div>
      ${
        isBusy
          ? `<p class="council-status">${waitingText}</p>`
          : ""
      }
      ${
        needsReview && teamState.currentTask
          ? `
            <p class="council-status is-hot">Bewijs staat in WhatsApp. Controleer de groepsapp en keur daarna hier.</p>
            <article class="task-card review-task">
              <h3>${teamState.currentTask.title}</h3>
              <p>${teamState.currentTask.body}</p>
            </article>
            <div class="review-actions">
              ${button("Goedkeuren", "approve", `data-action="approve-task" data-team-id="${team.id}"`)}
              ${button("Afkeuren", "reject", `data-action="reject-task" data-team-id="${team.id}"`)}
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderRankingPanel(state) {
  const ranking = getRanking(state);
  return `
    <section class="panel ranking-panel">
      <p class="eyebrow">Eindstand</p>
      <h2>Winnaar: ${ranking[0].team.name}</h2>
      <ol>
        ${ranking.map(({ team, teamState }) => `
          <li>
            <span>${team.name}</span>
            <strong>${teamState.completedRounds} rondes · vak ${teamState.position}</strong>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function render() {
  runClockTick();
  const state = getState();
  const session = getCurrentSession();

  if (!session) {
    renderLoggedOut();
    return;
  }

  if (session.role === "team") {
    renderTeamApp(session, state);
    return;
  }

  if (session.role === "kroegraad") {
    renderKroegraadApp(session, state);
    return;
  }

  clearCurrentSession();
  renderLoggedOut();
}

app.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  const action = actionTarget?.dataset.action;
  if (!action) {
    return;
  }

  ui.error = "";
  ui.notice = "";

  if (action === "mode-team") {
    ui.loginMode = "team";
    render();
  }

  if (action === "mode-kroegraad") {
    ui.loginMode = "kroegraad";
    render();
  }

  if (action === "tab-play") {
    ui.teamTab = "play";
    render();
  }

  if (action === "tab-board") {
    ui.teamTab = "board";
    render();
  }

  if (action === "start-game") {
    startCountdown();
    render();
  }

  if (action === "reset-prep") {
    resetPreparation();
    ui.notice = "Voorbereiding is gereset.";
    render();
  }

  if (action === "toggle-pause") {
    const session = getCurrentSession();
    togglePause(session?.kroegraadId);
    render();
  }

  if (action === "release-session") {
    const session = getCurrentSession();
    releaseTeamSession(session?.kroegraadId, actionTarget.dataset.teamId);
    render();
  }

  if (action === "logout") {
    clearCurrentSession();
    render();
  }

  if (action === "start-team-demo") {
    ui.teamTab = "play";
    startTeamDemo();
    render();
  }

  if (action === "roll-dice") {
    rollDice(actionTarget.dataset.teamId);
    render();
  }

  if (action === "submit-proof") {
    submitProofInWhatsapp(actionTarget.dataset.teamId);
    render();
  }

  if (action === "dismiss-popup") {
    dismissTeamPopup(actionTarget.dataset.teamId);
    render();
  }

  if (action === "approve-task") {
    const session = getCurrentSession();
    approveTeamTask(session?.kroegraadId, actionTarget.dataset.teamId);
    render();
  }

  if (action === "reject-task") {
    const session = getCurrentSession();
    rejectTeamTask(session?.kroegraadId, actionTarget.dataset.teamId);
    render();
  }

  if (action === "demo-approve") {
    demoResolveTeamTask(actionTarget.dataset.teamId, "approve");
    render();
  }

  if (action === "demo-reject") {
    demoResolveTeamTask(actionTarget.dataset.teamId, "reject");
    render();
  }

  if (action === "demo-card-chance") {
    demoDrawCard(actionTarget.dataset.teamId, "chance");
    render();
  }

  if (action === "demo-card-fund") {
    demoDrawCard(actionTarget.dataset.teamId, "fund");
    render();
  }

  if (action === "use-powerup") {
    useSavedPowerUp(actionTarget.dataset.teamId);
    render();
  }
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  ui.error = "";
  ui.notice = "";

  if (form.dataset.form === "team-login") {
    const formData = new FormData(form);
    const result = loginTeam(String(formData.get("teamCode") ?? ""));
    if (!result.ok) {
      ui.error = result.message;
    }
    render();
  }

  if (form.dataset.form === "kroegraad-login") {
    const formData = new FormData(form);
    const result = loginKroegraad(
      String(formData.get("loginName") ?? ""),
      String(formData.get("code") ?? "")
    );
    if (!result.ok) {
      ui.error = result.message;
    }
    render();
  }
});

function consumeLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const shouldCleanUrl = params.has("demo") || params.has("logout") || params.has("reset");

  if (params.has("reset")) {
    resetPreparation();
  }

  if (params.has("logout") || params.has("reset")) {
    clearCurrentSession();
  }

  if (params.get("demo") === "team") {
    startTeamDemo();
  }

  if (shouldCleanUrl) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

consumeLaunchParams();
subscribe(render);
initializeRemoteSync().then((result) => {
  if (result.mode === "remote") {
    console.info("Zuip-O-Poly draait met Supabase realtime sync.");
  } else {
    console.info("Zuip-O-Poly draait lokaal. Supabase is nog niet actief.");
  }
});
setInterval(() => {
  runClockTick();
  updateLiveClockText();
}, 1000);

function updateLiveClockText() {
  const state = getState();
  const countdownNode = document.querySelector(".js-countdown");
  if (countdownNode) {
    countdownNode.textContent = String(getCountdownRemaining(state) ?? GAME_CONFIG.countdownSeconds);
  }

}
