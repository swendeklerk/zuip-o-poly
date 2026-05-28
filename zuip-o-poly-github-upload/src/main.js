import { GAME_CONFIG, TEAM_RULES } from "./data/gameConfig.js";
import { getBoardCells } from "./data/board.js";
import { TEAM_STATUS, GAME_PHASE } from "./data/statuses.js";
import { KROEGRAAD_USERS, TEAMS, findTeamById, teamsForKroegraad } from "./data/teams.js";
import { findTileById } from "./data/tiles.js";
import { getTileTheme } from "./data/tileThemes.js";
import { CAFE_VAN_OUDS_WHEEL_OPTIONS } from "./data/tileAssignments.js";
import {
  allTeamsLoggedIn,
  approveTeamTask,
  clearCurrentSession,
  getCountdownRemaining,
  getCurrentSession,
  getState,
  getTeamState,
  getTeamCountdownSeconds,
  loginKroegraad,
  loginTeamWithPassword,
  rejectTeamTask,
  resetPreparation,
  rollDice,
  runClockTick,
  startCountdown,
  startTeamDemo,
  startLobbyDemo,
  startFinishedDemo,
  submitProofInWhatsapp,
  dismissTeamPopup,
  revealTeamPopupCard,
  applyTeamChoiceEffect,
  demoResolveTeamTask,
  demoDrawCard,
  demoDrawTeamChoiceCard,
  demoEnterWisselstation,
  demoEnterDock17,
  demoEnterCafeVanOuds,
  updateDock17Choice,
  addDock17Player,
  revealDock17Choices,
  addCafeVanOudsPlayer,
  spinCafeVanOudsWheel,
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
  notice: "",
  demoToolsVisible: false,
  skipRemoteSync: false,
  syncMode: "connecting"
};
const activeVanOudsSpins = new Map();
const VAN_OUDS_TICKER_ITEM_WIDTH = 150;
const VAN_OUDS_TICKER_ITEM_GAP = 10;
const VAN_OUDS_TICKER_PADDING = 10;
const VAN_OUDS_TICKER_PRE_ITEMS = 15;

function isSyncBlocking() {
  return !ui.skipRemoteSync && ui.syncMode === "connecting";
}

function renderSyncWarning() {
  if (ui.skipRemoteSync || ui.syncMode !== "local") {
    return "";
  }

  return `
    <div class="sync-warning">
      Niet live verbonden. Deze telefoon draait lokaal.
    </div>
  `;
}

function logoMarkup(compact = false) {
  const imageSrc = compact
    ? "./assets/zuipopoly-banner-normalized.svg"
    : "./assets/zuipopoly-logo-full.svg";
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
    ${renderSyncWarning()}
  `;
}

function button(label, className = "primary", attrs = "") {
  return `<button class="button ${className}" ${attrs}>${label}</button>`;
}

function teamBadge(team) {
  return `
    <span class="team-icon" style="--team-accent:${team.accent}" aria-hidden="true">
      <span></span><span></span><span></span>
    </span>
  `;
}

function getSavedPowerUpsForUi(teamState) {
  return teamState.savedPowerUps?.length
    ? teamState.savedPowerUps
    : teamState.savedPowerUp
      ? [teamState.savedPowerUp]
      : [];
}

function getTileName(tileId) {
  return findTileById(tileId)?.name ?? "Onbekend vak";
}

function getRoundLabel(teamState) {
  return `Ronde ${teamState.completedRounds + 1}`;
}

function getTurnLabel(teamState) {
  return `Beurt ${teamState.normalTurnsUsed ?? 0} van ${GAME_CONFIG.maxNormalTurns}`;
}

function formatShortTimer(seconds) {
  const safeSeconds = Math.max(Number(seconds ?? 0), 0);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
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
          <dd>${teamState.proofInWhatsapp ? "Verstuurd" : "-"}</dd>
        </div>
      </dl>
      ${
        getSavedPowerUpsForUi(teamState).length
          ? `<div class="powerup-badge">
              <span>Power-ups</span>
              <strong>${getSavedPowerUpsForUi(teamState).map((powerUp) => powerUp.label).join(" + ")}</strong>
            </div>`
          : ""
      }
      ${extra}
    </article>
  `;
}

function renderBoardShortcut() {
  return `
    <button class="board-shortcut board-nav-button" data-action="tab-board" type="button">Bekijk bord</button>
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
      ${ui.error ? `<p class="form-message error">${ui.error}</p>` : ""}
      ${ui.notice ? `<p class="form-message">${ui.notice}</p>` : ""}
    </section>
  `;
}

function renderTeamLogin() {
  return `
    <form class="panel auth-panel team-auth-panel" data-form="team-login">
      <div class="auth-panel-heading">
        <p class="eyebrow">Team-login</p>
        <h2>Kies je team</h2>
      </div>
      <div class="team-choice-grid" role="radiogroup" aria-label="Kies je team">
        ${TEAMS.map((team, index) => `
          <label class="team-choice-card" style="--team-accent:${team.accent}">
            <input type="radio" name="teamId" value="${team.id}" ${index === 0 ? "checked" : ""} />
            ${teamBadge(team)}
            <span>
              <strong>${team.name}</strong>
              <small>${team.colorName}</small>
            </span>
          </label>
        `).join("")}
      </div>
      <label>
        Wachtwoord
        <input name="teamPassword" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Wachtwoord" />
      </label>
      ${
        isSyncBlocking()
          ? `<p class="form-message">Live verbinding laden...</p>`
          : ""
      }
      ${button("Team inloggen", "primary", `type="submit" ${isSyncBlocking() ? "disabled" : ""}`)}
    </form>
  `;
}

function renderKroegraadLogin() {
  return `
    <form class="panel auth-panel council-auth-panel" data-form="kroegraad-login">
      <div class="auth-panel-heading">
        <p class="eyebrow">Kroegraad</p>
        <h2>Inloggen</h2>
      </div>
      <label>
        Loginnaam
        <input name="loginName" autocomplete="username" autocapitalize="characters" placeholder="Loginnaam" />
      </label>
      <label>
        Code
        <input name="code" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Code" />
      </label>
      ${
        isSyncBlocking()
          ? `<p class="form-message">Live verbinding laden...</p>`
          : ""
      }
      ${button("Kroegraad inloggen", "primary", `type="submit" ${isSyncBlocking() ? "disabled" : ""}`)}
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
  const isFinished = teamState.status === TEAM_STATUS.FINISHED;
  app.innerHTML = `
    <section class="screen">
      ${logoMarkup(true)}
      ${teamCard(team, teamState)}
      ${isFinished ? "" : renderBoardShortcut()}
      ${isFinished ? "" : renderTurnStrip(teamState)}
      ${state.paused ? renderPauseNotice() : ""}
      ${renderActivePlayCard(teamState, team.id, currentTile)}
      ${renderTeamPopup(teamState, team.id)}
      ${renderDemoTools(team, teamState)}
      ${isFinished ? "" : renderTeamTabs()}
    </section>
  `;
}

function renderTurnStrip(teamState) {
  const lastRoll = teamState.lastRoll ?? teamState.lastMove?.roll ?? null;
  if (!lastRoll) {
    return "";
  }

  return `
    <section class="roll-result-strip" aria-label="Laatste worp ${lastRoll}">
      <span>Je gooide</span>
      <strong>${lastRoll}</strong>
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
  const isCardIntro =
    (kind === "chance" || kind === "fund") && teamState.activePopup.stage === "intro";
  const labelByKind = {
    chance: "Kans",
    fund: "Algemeen Fonds",
    swap: "Wisselstation",
    start: "Grote Markt",
    snack: "Snackstation",
    parking: "Vrij Parkeren",
    rejected: "Afgekeurd",
    task: "Nieuwe opdracht"
  };
  const needsTeamChoice = ["team_choice_wait", "team_choice_move", "swap_positions", "wisselstation", "start_bonus"].includes(
    teamState.currentTask?.effectType
  ) && teamState.activePopup.cardId === teamState.currentTask?.cardId;

  if (isCardIntro) {
    const label = labelByKind[kind] ?? "Kaart";
    const imageSrc = kind === "chance" ? "./assets/kans-normalized.svg" : "./assets/algemeen-fonds-normalized.svg";

    return `
      <div class="modal-backdrop card-reveal-backdrop" role="dialog" aria-modal="true" aria-labelledby="popup-title">
        <section class="popup-card card-reveal-card popup-${kind}">
          <p class="eyebrow">Je landt op</p>
          <div class="card-reveal-visual" aria-hidden="true">
            <span class="card-reveal-glow"></span>
            <img src="${imageSrc}" alt="" />
          </div>
          <h2 id="popup-title">${label}</h2>
          <p class="card-reveal-subtitle">De kaart wordt geopend...</p>
          ${button("Toon kaart", "primary", `data-action="reveal-popup-card" data-team-id="${teamId}"`)}
        </section>
      </div>
    `;
  }

  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="popup-title">
      <section class="popup-card popup-${kind}">
        <p class="eyebrow">${labelByKind[kind] ?? "Nieuwe opdracht"}</p>
        <h2 id="popup-title">${teamState.activePopup.title}</h2>
        <p>${teamState.activePopup.body}</p>
        ${teamState.activePopup.blockedChoiceMessage ? `<p class="choice-warning">${teamState.activePopup.blockedChoiceMessage}</p>` : ""}
        ${
          needsTeamChoice
            ? renderTeamChoiceButtons(teamId)
            : button("Begrepen", "primary", `data-action="dismiss-popup" data-team-id="${teamId}"`)
        }
      </section>
    </div>
  `;
}

function renderTeamChoiceButtons(teamId) {
  const state = getState();
  const otherTeams = TEAMS.filter((team) => team.id !== teamId);

  return `
    <div class="team-choice-actions">
      <p class="choice-title">Kies een team</p>
      ${otherTeams
        .map((team) => {
          const teamState = state.teams[team.id];
          const protectedTeam =
            teamState.status === TEAM_STATUS.IN_JAIL ||
            teamState.status === TEAM_STATUS.FINISHED ||
            getSavedPowerUpsForUi(teamState).some((powerUp) => powerUp.type === "shield");
          const label = protectedTeam ? `${team.name} beschermd` : team.name;

          return `<button
            class="choice-team-button"
            style="--team-accent:${team.accent}"
            data-action="choose-team-target"
            data-team-id="${teamId}"
            data-target-team-id="${team.id}"
            ${protectedTeam ? "disabled" : ""}
            type="button"
          >${teamBadge(team)} <span>${label}</span></button>`;
        })
        .join("")}
    </div>
  `;
}

function renderActivePlayCard(teamState, teamId, currentTile) {
  if (teamState.status === TEAM_STATUS.CAN_ROLL) {
    return `${renderDicePanel(teamState, teamId)}${renderPowerUpPanel(teamState, teamId)}`;
  }

  if (teamState.status === TEAM_STATUS.APPROVED) {
    return `
      <section class="panel play-panel verdict-panel approved-panel approved-ready-panel">
        <p class="eyebrow">Goedgekeurd</p>
        <h2>GOEDGEKEURD</h2>
        <p class="tile-type">De Kroegraad heeft jullie bewijs goedgekeurd. Jullie mogen door naar de volgende worp.</p>
      </section>
      ${renderDicePanel(teamState, teamId)}
      ${renderPowerUpPanel(teamState, teamId)}
    `;
  }

  if (teamState.status === TEAM_STATUS.WAITING_KROEGRAAD) {
    return `
      <section class="panel play-panel verdict-panel waiting-review-panel">
        <div class="verdict-icon" aria-hidden="true">✓</div>
        <div>
          <p class="eyebrow">Bewijs verstuurd</p>
          <h2>Wacht op Kroegraad</h2>
              <p class="tile-type">De toegewezen Kroegraad ziet jullie nu bovenaan als TE KEUREN.</p>
        </div>
        ${renderActionButton(teamState, teamId)}
      </section>
    `;
  }

  if (teamState.status === TEAM_STATUS.REJECTED) {
    return `
      <section class="panel play-panel verdict-panel rejected-panel">
        <p class="eyebrow">Afgekeurd</p>
        <h2>AFGEKEURD</h2>
        <p class="tile-type">Niet door de Kroegraad gekomen. Doe de straf en druk daarna opnieuw op de bewijsknop.</p>
        ${renderTask(teamState)}
        ${renderActionButton(teamState, teamId)}
      </section>
    `;
  }

  if (teamState.status === TEAM_STATUS.FINISHED) {
    return `
      <section class="panel play-panel status-panel end-panel">
        <p class="eyebrow">Spel afgelopen</p>
        <h2>SPEL AFGELOPEN</h2>
        <p class="end-location">Kom naar De Tempelier</p>
        <p class="tile-type">Jullie 25 normale dobbelbeurten zitten erop. Kom naar De Tempelier in Nijmegen. De Kroegraad maakt daar de winnaar bekend.</p>
      </section>
    `;
  }

  return `
    <section class="panel play-panel">
      <p class="eyebrow">Huidige opdracht</p>
      <h2>${currentTile?.name ?? "Onbekend vak"}</h2>
      <p class="tile-type">${currentTile?.type ?? ""}</p>
      ${renderTask(teamState)}
      ${renderSpecialTaskFlow(teamState, teamId)}
      ${renderPowerUpPanel(teamState, teamId)}
      ${renderActionButton(teamState, teamId)}
    </section>
  `;
}

function renderSpecialTaskFlow(teamState, teamId) {
  if (teamState.currentTask?.specialFlow === "dock17") {
    return renderDock17Flow(teamState, teamId);
  }

  if (teamState.currentTask?.specialFlow === "vanOuds") {
    return renderCafeVanOudsFlow(teamState, teamId);
  }

  return "";
}

function renderCafeVanOudsFlow(teamState, teamId) {
  const task = teamState.currentTask;
  const complete = task.vanOudsChoices.every((choice) => choice.result);
  const spinPreview = activeVanOudsSpins.get(teamId);
  const highlightedChoice = task.vanOudsChoices.find((choice) => choice.id === spinPreview?.choiceId);
  const latestChoice = [...task.vanOudsChoices].reverse().find((choice) => choice.result);
  const tickerFocus = highlightedChoice?.result ?? latestChoice?.result ?? "RAD";
  const landedItems = !spinPreview && latestChoice?.result
    ? createVanOudsTickerItems(latestChoice.result)
    : null;
  const tickerItems =
    spinPreview?.items ??
    landedItems ??
    CAFE_VAN_OUDS_WHEEL_OPTIONS.map((item) => ({
      label: item,
      focus: item === tickerFocus
    }));
  const tickerLandingOffset =
    spinPreview?.landingOffset ??
    (landedItems ? getVanOudsTickerLandingOffset(landedItems) : null);
  const tickerClass = spinPreview ? "is-active" : landedItems ? "is-landed" : "";

  return `
    <section class="special-flow van-ouds-flow ${spinPreview ? "is-spinning" : ""}">
      <div class="special-flow-header">
        <span>Rad van Bier en Vertier</span>
        <strong>${task.vanOudsChoices.length} spelers</strong>
      </div>
      <div class="van-ouds-wheel-wrap" aria-hidden="true">
        <div class="van-ouds-pointer"></div>
        <div class="van-ouds-wheel">
          <span>RAD</span>
        </div>
      </div>
      <div class="van-ouds-ticker ${tickerClass}" aria-hidden="true">
        <div ${tickerLandingOffset ? `style="--landing-offset: ${tickerLandingOffset}px"` : ""}>
          ${tickerItems.map((item) => `<span class="${item.focus ? "is-focus" : ""}" title="${item.label}">${item.label}</span>`).join("")}
        </div>
      </div>
      <div class="dock17-player-list">
        ${task.vanOudsChoices
          .map((choice) => `
            <div class="dock17-player van-ouds-player">
              <span>${choice.name}</span>
              ${
                choice.result
                  ? `<strong>${choice.result}</strong>`
                  : button("Draai rad", "ghost small", `data-action="van-ouds-spin" data-team-id="${teamId}" data-choice-id="${choice.id}"`)
              }
            </div>
          `)
          .join("")}
      </div>
      <div class="dock17-actions">
        ${button("+ teamlid", "ghost", `data-action="van-ouds-add-player" data-team-id="${teamId}"`)}
      </div>
      ${
        complete
          ? `<p class="dock17-result-note">Iedereen heeft gedraaid. Druk op de bewijsknop zodra jullie klaar zijn.</p>`
          : `<p class="van-ouds-helper">Draai per actieve speler één keer aan het rad.</p>`
      }
    </section>
  `;
}

function createVanOudsTickerItems(result) {
  const options = CAFE_VAN_OUDS_WHEEL_OPTIONS;
  const resultIndex = Math.max(options.indexOf(result), 0);
  const items = [];
  for (let index = 0; index < VAN_OUDS_TICKER_PRE_ITEMS; index += 1) {
    const option = options[(resultIndex + index + 4) % options.length];
    items.push({ label: option, focus: false });
  }
  items.push({ label: result, focus: true });
  return items;
}

function getVanOudsTickerLandingOffset(items) {
  const focusIndex = Math.max(items.findIndex((item) => item.focus), 0);
  return (
    VAN_OUDS_TICKER_PADDING +
    focusIndex * (VAN_OUDS_TICKER_ITEM_WIDTH + VAN_OUDS_TICKER_ITEM_GAP) +
    VAN_OUDS_TICKER_ITEM_WIDTH / 2
  );
}

function chooseVanOudsResult(teamId) {
  const task = getState().teams[teamId]?.currentTask;
  const usedResults = new Set(task?.vanOudsChoices?.map((choice) => choice.result).filter(Boolean) ?? []);
  const availableOptions = CAFE_VAN_OUDS_WHEEL_OPTIONS.filter((item) => !usedResults.has(item));
  const pool = availableOptions.length ? availableOptions : CAFE_VAN_OUDS_WHEEL_OPTIONS;
  return pool[Math.floor(Math.random() * pool.length)] ?? CAFE_VAN_OUDS_WHEEL_OPTIONS[0];
}

function renderDock17Flow(teamState, teamId) {
  const task = teamState.currentTask;
  const allChosen = task.dock17Choices.every((choice) => choice.number);

  return `
    <section class="special-flow dock17-flow">
      <div class="special-flow-header">
        <span>Dock17 reveal</span>
        <strong>${task.dock17Choices.length} spelers</strong>
      </div>
      <div class="dock17-player-list">
        ${task.dock17Choices
          .map((choice) => `
            <label class="dock17-player">
              <span>${choice.name}</span>
              ${
                task.dock17Revealed
                  ? `<strong>${choice.number} = ${choice.drink}</strong>`
                  : `<select data-action="dock17-choice" data-team-id="${teamId}" data-choice-id="${choice.id}">
                      <option value="">Kies</option>
                      ${Array.from({ length: 17 }, (_, index) => {
                        const number = index + 1;
                        return `<option value="${number}" ${choice.number === number ? "selected" : ""}>${number}</option>`;
                      }).join("")}
                    </select>`
              }
            </label>
          `)
          .join("")}
      </div>
      ${
        task.dock17Revealed
          ? `<p class="dock17-result-note">Uitslag staat klaar voor de Kroegraad. Druk op de bewijsknop zodra jullie klaar zijn.</p>`
          : `<div class="dock17-actions">
              ${button("+ teamlid", "ghost", `data-action="dock17-add-player" data-team-id="${teamId}"`)}
              ${button("Onthul drankjes", "primary", `data-action="dock17-reveal" data-team-id="${teamId}" ${allChosen ? "" : "disabled"}`)}
            </div>`
      }
    </section>
  `;
}

function renderPowerUpPanel(teamState, teamId) {
  const powerUps = getSavedPowerUpsForUi(teamState);
  if (!powerUps.length) {
    return "";
  }

  return `
    <section class="powerup-panel">
      <div class="powerup-panel-header">
        <span>Power-ups klaar</span>
        <strong>${powerUps.length}</strong>
      </div>
      <div class="powerup-list">
        ${powerUps
          .map((powerUp) => `
            <button
              class="powerup-use-button"
              data-action="use-powerup"
              data-team-id="${teamId}"
              data-powerup-id="${powerUp.id}"
              type="button"
            >
              <span>${powerUp.label}</span>
              <strong>Gebruiken</strong>
            </button>
          `)
          .join("")}
      </div>
    </section>
  `;
}

function renderTeamBoard(team, teamState, state) {
  app.innerHTML = `
    <section class="screen">
      ${logoMarkup(true)}
      ${renderTurnStrip(teamState)}
      ${teamCard(team, teamState)}
      <button class="board-back-button board-nav-button" data-action="tab-play" type="button">Terug naar spelen</button>
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
      <p class="helper">Gebruik dit alleen om de teamflow, kaarten en keuringen snel te proberen.</p>
      <div class="demo-card-actions">
        ${button("Test Kans", "ghost", `data-action="demo-card-chance" data-team-id="${team.id}"`)}
        ${button("Test Fonds", "ghost", `data-action="demo-card-fund" data-team-id="${team.id}"`)}
      </div>
      <div class="demo-card-actions">
        ${button("Test teamkeuze", "ghost", `data-action="demo-card-choice" data-team-id="${team.id}"`)}
        ${button("Test fonds-keuze", "ghost", `data-action="demo-card-choice-fund" data-team-id="${team.id}"`)}
      </div>
      <div class="demo-card-actions">
        ${button("Test Wisselstation", "ghost", `data-action="demo-wisselstation" data-team-id="${team.id}"`)}
        ${button("Test Dock17", "ghost", `data-action="demo-dock17" data-team-id="${team.id}"`)}
      </div>
      <div class="demo-card-actions">
        ${button("Test Van Ouds", "ghost", `data-action="demo-van-ouds" data-team-id="${team.id}"`)}
        ${button("Einddemo", "ghost", `data-action="demo-finished" data-team-id="${team.id}"`)}
      </div>
      <div class="demo-card-actions">
        ${button("Lobby demo", "ghost", 'data-action="demo-open-lobby"')}
        ${button("Naar Lars", "ghost", 'data-action="demo-open-lars"')}
        ${button("Naar Swen", "ghost", 'data-action="demo-open-swen"')}
      </div>
      <div class="demo-card-actions">
        ${button("Reset test", "ghost", 'data-action="start-team-demo"')}
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
    </section>
  `;
}

function renderTask(teamState) {
  if (!teamState.currentTask) {
    return `<p class="helper empty-task">Klik op de dobbelsteenknop om naar je eerste opdracht te gaan.</p>`;
  }

  return `
    <article class="task-card ${teamState.currentTask.placeholder ? "is-placeholder" : ""}">
      ${
        teamState.currentTask.location
          ? `<span class="task-location">${teamState.currentTask.location}</span>`
          : ""
      }
      <h3>${teamState.currentTask.title}</h3>
      <p>${teamState.currentTask.body}</p>
      ${
        teamState.currentTask.actionUrl
          ? `<a class="task-link-button" href="${teamState.currentTask.actionUrl}" target="_blank" rel="noopener noreferrer">${teamState.currentTask.actionLabel ?? "Open link"}</a>`
          : ""
      }
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

  const face = 3;
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
    if (teamState.currentTask?.specialFlow === "dock17" && !teamState.currentTask.dock17Revealed) {
      return button("Onthul eerst de drankjes", "disabled", "disabled");
    }

    if (teamState.currentTask?.specialFlow === "vanOuds" && !teamState.currentTask.vanOudsComplete) {
      return button("Draai eerst het rad", "disabled", "disabled");
    }

    return button("Bewijs staat in WhatsApp", "primary proof-button", `data-action="submit-proof" ${teamAttr}`);
  }

  if (teamState.status === TEAM_STATUS.WAITING_KROEGRAAD) {
    return button("Wachten op Kroegraad...", "disabled", "disabled");
  }

  if (teamState.status === TEAM_STATUS.APPROVED) {
    return button("Volgende worp", "primary", `data-action="roll-dice" ${teamAttr}`);
  }

  if (teamState.status === TEAM_STATUS.IN_JAIL) {
    const remaining = getTeamCountdownSeconds(teamState, "jailUntil");
    return button(`Celstraf: ${formatShortTimer(remaining ?? 0)}`, "disabled", 'disabled data-live-team-timer');
  }

  if (teamState.status === TEAM_STATUS.WAITING_SWAP) {
    const remaining = getTeamCountdownSeconds(teamState, "waitUntil");
    return button(`Wachten: ${formatShortTimer(remaining ?? 0)}`, "disabled", 'disabled data-live-team-timer');
  }

  if (teamState.status === TEAM_STATUS.PAUSED) {
    return button("Gepauzeerd", "disabled", "disabled");
  }

  return "";
}

function renderKroegraadApp(session, state) {
  const user = KROEGRAAD_USERS.find((item) => item.id === session.kroegraadId);
  const displayName = user?.displayName ?? session.kroegraadId;

  if (state.phase === GAME_PHASE.COUNTDOWN) {
    app.innerHTML = `
      <section class="screen council-screen">
        ${logoMarkup(true)}
        <div class="panel council-countdown-panel">
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
      <div class="panel council-lobby-panel">
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
        <div class="lobby-actions">
          ${button("Spel starten", "primary", `data-action="start-game" ${canStart ? "" : "disabled"}`)}
          ${button("Reset voorbereiding", "ghost", 'data-action="reset-prep"')}
          ${button("Uitloggen", "ghost", 'data-action="logout"')}
        </div>
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
  const reviewTeams = assigned.filter(({ teamState }) => teamState.status === TEAM_STATUS.WAITING_KROEGRAAD);
  const otherTeams = assigned.filter(({ teamState }) => teamState.status !== TEAM_STATUS.WAITING_KROEGRAAD);

  app.innerHTML = `
    <section class="screen council-screen">
      ${logoMarkup(true)}
      <div class="panel council-command">
        <div class="council-command-top">
          <div>
            <p class="eyebrow">Zuip-O-Poly Kroegraad</p>
            <h2>Ingelogd als ${displayName}</h2>
          </div>
          <strong class="status-badge ${state.paused ? "is-paused" : "is-live"}">${state.paused ? "Gepauzeerd" : "Actief"}</strong>
        </div>
        ${
          reviewCount
            ? `<div class="council-alert">Nu keuren: ${reviewTeams.map(({ team }) => team.name).join(", ")}.</div>`
            : `<div class="council-empty-review">Geen open keuringen. Je hoeft nu niets te doen.</div>`
        }
        <div class="council-actions">
          ${button(state.paused ? "Spel hervatten" : "Spel pauzeren", "ghost", 'data-action="toggle-pause"')}
          ${button("Uitloggen", "ghost small", 'data-action="logout"')}
        </div>
      </div>
      <section class="council-section">
        <div class="section-title-row">
          <h2>Nu keuren</h2>
          <span>${reviewCount}</span>
        </div>
        ${
          reviewTeams.length
            ? reviewTeams.map(({ team, teamState }) => renderCouncilTeamCard(team, teamState, true)).join("")
            : `<div class="council-empty-review">Er staat nog geen keuring klaar.</div>`
        }
      </section>
      <section class="council-section">
        <div class="section-title-row">
          <h2>Teamoverzicht</h2>
          <span>${assigned.length}</span>
        </div>
        ${otherTeams.map(({ team, teamState }) => renderCouncilTeamCard(team, teamState)).join("")}
      </section>
      ${state.timerFinishedAt ? renderRankingPanel(state) : ""}
    </section>
  `;
}

function renderCouncilTeamCard(team, teamState, focus = false) {
  const needsReview = teamState.status === TEAM_STATUS.WAITING_KROEGRAAD;
  const isBusy = teamState.status === TEAM_STATUS.TASK_ACTIVE || teamState.status === TEAM_STATUS.REJECTED;
  const isFinished = teamState.status === TEAM_STATUS.FINISHED;
  const hasSession = Boolean(teamState.activeSessionId);
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
    <article class="team-card council-card ${needsReview ? "needs-review" : ""} ${focus ? "is-focus-card" : ""}" style="--team-accent:${team.accent}" data-status="${teamState.status}">
      <div class="team-card-top">
        ${teamBadge(team)}
        <div>
          <h2>${team.name}</h2>
          <p class="council-team-meta">Beurt ${teamState.normalTurnsUsed ?? 0}/${GAME_CONFIG.maxNormalTurns} · ${hasSession ? "sessie actief" : "geen sessie"}</p>
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
            <p class="council-status is-hot">Check het bewijs en kies daarna hieronder.</p>
            <article class="task-card review-task">
              <span class="review-label">Opdracht</span>
              <h3>${teamState.currentTask.title}</h3>
              <p>${teamState.currentTask.reviewBody ?? teamState.currentTask.body}</p>
              ${
                teamState.currentTask.rules
                  ? `<p class="review-rules">${teamState.currentTask.rules}</p>`
                  : ""
              }
              ${
                teamState.currentTask.reviewExtra
                  ? `<p class="review-extra">${teamState.currentTask.reviewExtra}</p>`
                  : ""
              }
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

function transitionRender() {
  const currentScreen = app.querySelector(".screen");
  if (!currentScreen) {
    render();
    return;
  }

  currentScreen.classList.add("is-leaving");
  window.setTimeout(render, 130);
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
    transitionRender();
  }

  if (action === "mode-kroegraad") {
    ui.loginMode = "kroegraad";
    transitionRender();
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
    ui.demoToolsVisible = true;
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

  if (action === "reveal-popup-card") {
    revealTeamPopupCard(actionTarget.dataset.teamId);
    render();
  }

  if (action === "choose-team-target") {
    applyTeamChoiceEffect(actionTarget.dataset.teamId, actionTarget.dataset.targetTeamId);
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

  if (action === "demo-card-choice") {
    demoDrawTeamChoiceCard(actionTarget.dataset.teamId, "chance");
    render();
  }

  if (action === "demo-card-choice-fund") {
    demoDrawTeamChoiceCard(actionTarget.dataset.teamId, "fund");
    render();
  }

  if (action === "demo-wisselstation") {
    demoEnterWisselstation(actionTarget.dataset.teamId);
    render();
  }

  if (action === "demo-dock17") {
    demoEnterDock17(actionTarget.dataset.teamId);
    render();
  }

  if (action === "demo-van-ouds") {
    demoEnterCafeVanOuds(actionTarget.dataset.teamId);
    render();
  }

  if (action === "dock17-add-player") {
    addDock17Player(actionTarget.dataset.teamId);
    render();
  }

  if (action === "dock17-reveal") {
    actionTarget.disabled = true;
    actionTarget.closest(".dock17-flow")?.classList.add("is-revealing");
    window.setTimeout(() => {
      revealDock17Choices(actionTarget.dataset.teamId);
      render();
    }, 850);
  }

  if (action === "van-ouds-add-player") {
    addCafeVanOudsPlayer(actionTarget.dataset.teamId);
    render();
  }

  if (action === "van-ouds-spin") {
    const result = chooseVanOudsResult(actionTarget.dataset.teamId);
    const tickerItems = createVanOudsTickerItems(result);
    actionTarget.disabled = true;
    activeVanOudsSpins.set(actionTarget.dataset.teamId, {
      choiceId: actionTarget.dataset.choiceId,
      result,
      items: tickerItems,
      landingOffset: getVanOudsTickerLandingOffset(tickerItems)
    });
    render();
    window.setTimeout(() => {
      spinCafeVanOudsWheel(actionTarget.dataset.teamId, actionTarget.dataset.choiceId, result);
      activeVanOudsSpins.delete(actionTarget.dataset.teamId);
      render();
    }, 2800);
  }

  if (action === "demo-open-lars") {
    clearCurrentSession();
    loginKroegraad("LARS", "0311");
    render();
  }

  if (action === "demo-open-swen") {
    clearCurrentSession();
    loginKroegraad("SWEN", "0805");
    render();
  }

  if (action === "demo-open-lobby") {
    startLobbyDemo(actionTarget.dataset.teamId ?? "team_bruine_kroeg");
    clearCurrentSession();
    loginKroegraad("LARS", "0311");
    render();
  }

  if (action === "demo-finished") {
    startFinishedDemo(actionTarget.dataset.teamId ?? "team_bruine_kroeg");
    render();
  }

  if (action === "use-powerup") {
    const powerupPanel = actionTarget.closest(".powerup-panel");
    actionTarget.disabled = true;
    powerupPanel?.classList.add("is-activating");
    window.setTimeout(() => {
      useSavedPowerUp(actionTarget.dataset.teamId, actionTarget.dataset.powerupId);
      render();
    }, 900);
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.action !== "dock17-choice") {
    return;
  }

  updateDock17Choice(target.dataset.teamId, target.dataset.choiceId, target.value);
  render();
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  ui.error = "";
  ui.notice = "";

  if (form.dataset.form === "team-login") {
    const formData = new FormData(form);
    const result = loginTeamWithPassword(
      String(formData.get("teamId") ?? ""),
      String(formData.get("teamPassword") ?? "")
    );
    if (!result.ok) {
      ui.error = result.message;
    }
    transitionRender();
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
    transitionRender();
  }
});

function consumeLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const shouldCleanUrl = params.has("demo") || params.has("logout") || params.has("reset");

  if (params.has("reset")) {
    ui.skipRemoteSync = true;
    resetPreparation({ force: true });
    ui.demoToolsVisible = false;
  }

  if (params.has("logout") || params.has("reset")) {
    clearCurrentSession();
  }

  if (params.get("demo") === "team") {
    ui.skipRemoteSync = true;
    ui.demoToolsVisible = params.get("tools") === "1";
    startTeamDemo();
  }

  if (params.get("demo") === "council") {
    ui.skipRemoteSync = true;
    ui.demoToolsVisible = false;
    startTeamDemo("team_bruine_kroeg");
    demoDrawCard("team_bruine_kroeg", "fund");
    submitProofInWhatsapp("team_bruine_kroeg");
    clearCurrentSession();
    loginKroegraad("LARS", "0311");
  }

  if (params.get("demo") === "approval") {
    ui.skipRemoteSync = true;
    ui.demoToolsVisible = false;
    const view = params.get("as") ?? "lars";
    const teamByView = {
      bruine: "team_bruine_kroeg",
      zwarte: "team_zwarte_pint",
      witte: "team_witte_batavus"
    };
    const teamId = teamByView[view] ?? "team_bruine_kroeg";
    startTeamDemo(teamId);
    TEAMS.forEach((team, index) => {
      demoDrawCard(team.id, index === 1 ? "chance" : "fund");
      submitProofInWhatsapp(team.id);
    });

    if (view === "lars" || view === "swen") {
      clearCurrentSession();
      loginKroegraad(view.toUpperCase(), view === "swen" ? "0805" : "0311");
    }
  }

  if (params.get("demo") === "lobby") {
    ui.skipRemoteSync = true;
    ui.demoToolsVisible = false;
    const view = params.get("as") ?? "lars";
    const teamByView = {
      bruine: "team_bruine_kroeg",
      zwarte: "team_zwarte_pint",
      witte: "team_witte_batavus"
    };
    const teamId = teamByView[view] ?? "team_bruine_kroeg";
    startLobbyDemo(teamId);

    if (view === "lars" || view === "swen") {
      clearCurrentSession();
      loginKroegraad(view.toUpperCase(), view === "swen" ? "0805" : "0311");
    }
  }

  if (params.get("demo") === "countdown") {
    ui.skipRemoteSync = true;
    ui.demoToolsVisible = false;
    const view = params.get("as") ?? "lars";
    const teamByView = {
      bruine: "team_bruine_kroeg",
      zwarte: "team_zwarte_pint",
      witte: "team_witte_batavus"
    };
    const teamId = teamByView[view] ?? "team_bruine_kroeg";
    startLobbyDemo(teamId);

    if (view === "lars" || view === "swen") {
      clearCurrentSession();
      loginKroegraad(view.toUpperCase(), view === "swen" ? "0805" : "0311");
    }

    startCountdown();
  }

  if (params.get("demo") === "finished") {
    ui.skipRemoteSync = true;
    ui.demoToolsVisible = false;
    const view = params.get("as") ?? "bruine";
    const teamByView = {
      bruine: "team_bruine_kroeg",
      zwarte: "team_zwarte_pint",
      witte: "team_witte_batavus"
    };
    const teamId = teamByView[view] ?? "team_bruine_kroeg";
    startFinishedDemo(teamId);

    if (view === "lars" || view === "swen") {
      clearCurrentSession();
      loginKroegraad(view.toUpperCase(), view === "swen" ? "0805" : "0311");
    }
  }

  if (shouldCleanUrl) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

consumeLaunchParams();
subscribe(render);
if (ui.skipRemoteSync) {
  ui.syncMode = "demo";
  console.info("Zuip-O-Poly draait in lokale demo-modus.");
} else {
  initializeRemoteSync().then((result) => {
    ui.syncMode = result.mode;
    if (result.mode === "remote") {
      console.info("Zuip-O-Poly draait met Supabase realtime sync.");
    } else {
      console.info("Zuip-O-Poly draait lokaal. Supabase is nog niet actief.");
    }
    render();
  });
}
setInterval(() => {
  runClockTick();
  updateLiveClockText();
}, 1000);

function updateLiveClockText() {
  const state = getState();
  const countdownNodes = document.querySelectorAll(".js-countdown, .council-count");
  if (countdownNodes.length) {
    const remaining = String(getCountdownRemaining(state) ?? GAME_CONFIG.countdownSeconds);
    countdownNodes.forEach((node) => {
      node.textContent = remaining;
    });
  }

  const session = getCurrentSession();
  if (session?.role === "team") {
    const teamState = getTeamState(session.teamId, state);
    const timerNode = document.querySelector("[data-live-team-timer]");
    if (timerNode && teamState?.status === TEAM_STATUS.IN_JAIL) {
      timerNode.textContent = `Celstraf: ${formatShortTimer(getTeamCountdownSeconds(teamState, "jailUntil") ?? 0)}`;
    }
    if (timerNode && teamState?.status === TEAM_STATUS.WAITING_SWAP) {
      timerNode.textContent = `Wachten: ${formatShortTimer(getTeamCountdownSeconds(teamState, "waitUntil") ?? 0)}`;
    }
  }

}
