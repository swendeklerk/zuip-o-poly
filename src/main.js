import { getBoardCells, BOARD_SIZE } from "./data/board.js";
import { getTileTheme } from "./data/tileThemes.js";
import { getTileImage } from "./data/tileImages.js";
import { findTileById } from "./data/tiles.js";
import {
  DEFAULT_MODE_ID,
  findGameMode,
  findTeamColor,
  GAME_CONFIG,
  GAME_MODES,
  setTurbo,
  TEAM_COLORS,
  TEAM_RULES,
  TURBO
} from "./data/gameConfig.js";
import { GAME_PHASE, STATUS_META, TEAM_STATUS } from "./data/statuses.js";
import { CAFE_VAN_OUDS_WHEEL_OPTIONS } from "./data/tileAssignments.js";
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
  copied: false,
  cardFlipped: false
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

// Herkent uitsluitend de pop-up van het GERAAKTE team (niet van de aanvaller).
function isHitPopup(popup) {
  if (!popup || popup.stage !== "detail") {
    return false;
  }
  const title = (popup.title ?? "").toLowerCase();
  return (
    title.startsWith("jullie zijn geraakt") ||
    title.startsWith("jullie zijn gewisseld") ||
    title === "uno reverse!"
  );
}

function hitStampLabel(popup) {
  const title = (popup.title ?? "").toLowerCase();
  if (title.startsWith("jullie zijn gewisseld")) {
    return "GEWISSELD";
  }
  return "GERAAKT";
}

// Korte schermbrede rode flits + shake bij een inkomende klap.
function flashHit() {
  document.body.classList.remove("hit-flash");
  // reflow forceren zodat de animatie opnieuw start
  void document.body.offsetWidth;
  document.body.classList.add("hit-flash");
  window.setTimeout(() => document.body.classList.remove("hit-flash"), 650);
}

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
    if (popupSig && popupSig !== sfxPrev.popupSig && isHitPopup(popup)) {
      feedback.hit();
      flashHit();
    }
  }

  sfxPrev = { inited: true, phase, status, popupSig, powerupCount };
}

let lastCountdownValue = null;

// Stap-voor-stap pion-animatie. De store verplaatst de pion direct naar de
// eindpositie; de UI laat 'm zichtbaar vak voor vak lopen via lastMove.steps.
const WALK_STEP_MS = TURBO ? 160 : 520;
const DICE_REVEAL_MS = TURBO ? 450 : 1700;
let walk = { active: false, reveal: false, cells: [], index: 0, timer: null, revealTimer: null, movedAt: 0, roll: null };
let walkInited = false;

function boardWrap(n) {
  const size = GAME_CONFIG.boardSize;
  return ((((n - 1) % size) + size) % size) + 1;
}

/* ------------------------------------------------------------------ */
/* Rad van Bier en Vertier (Café Van Ouds)                             */
/* ------------------------------------------------------------------ */

let wheelSpin = { active: false, rotation: 0, lastIndex: null, timer: null };
const WHEEL_COLORS = ["#e8001d", "#ffd600", "#c800ff", "#00d4ff", "#00d464", "#ff7a00"];

function polarPoint(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

// Tekstkleur per segmentkleur (donker op de lichte vlakken, wit op rood/paars).
const WHEEL_TEXT_COLORS = ["#ffffff", "#080809", "#ffffff", "#080809", "#080809", "#080809"];
const WHEEL_SHORT_LABELS = { "Wisseltap / speciaalbier van de maand": "Wisseltap" };

function wheelLabel(name) {
  return WHEEL_SHORT_LABELS[name] ?? name;
}

function wheelSliceState(i) {
  if (wheelSpin.lastIndex === null) {
    return { opacity: 1, stroke: "#080809", strokeWidth: 1.4 };
  }
  return wheelSpin.lastIndex === i
    ? { opacity: 1, stroke: "#ffffff", strokeWidth: 3 }
    : { opacity: 0.5, stroke: "#080809", strokeWidth: 1.4 };
}

// SVG van het rad: één gekleurd taartpunt per drankje, met de naam er
// leesbaar op (van het midden naar buiten).
function wheelSvg() {
  const n = CAFE_VAN_OUDS_WHEEL_OPTIONS.length;
  const seg = 360 / n;
  const cx = 100;
  const cy = 100;
  const r = 98;
  const slices = CAFE_VAN_OUDS_WHEEL_OPTIONS
    .map((name, i) => {
      const start = i * seg;
      const end = (i + 1) * seg;
      const mid = start + seg / 2;
      const [x1, y1] = polarPoint(cx, cy, r, start);
      const [x2, y2] = polarPoint(cx, cy, r, end);
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
      const textColor = WHEEL_TEXT_COLORS[i % WHEEL_TEXT_COLORS.length];
      const path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      const label = wheelLabel(name);
      const fontSize = Math.min(9, 70 / (label.length * 0.56)).toFixed(1);
      const s = wheelSliceState(i);
      return `<g class="wheel-slice" data-index="${i}" opacity="${s.opacity}">
        <path d="${path}" fill="${color}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" />
        <text transform="rotate(${(mid - 90).toFixed(2)} ${cx} ${cy})" x="${cx + 90}" y="${cy}" text-anchor="end" dominant-baseline="central" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="${fontSize}" fill="${textColor}">${esc(label)}</text>
      </g>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 200 200" class="wheel-svg" xmlns="http://www.w3.org/2000/svg">
      ${slices}
      <circle cx="${cx}" cy="${cy}" r="99" fill="none" stroke="#f0eef4" stroke-width="2" />
      <circle cx="${cx}" cy="${cy}" r="16" fill="#111116" stroke="#f0eef4" stroke-width="2.5" />
      <circle cx="${cx}" cy="${cy}" r="5" fill="#f0eef4" />
    </svg>
  `;
}

function wheelReadoutText() {
  if (wheelSpin.lastIndex === null) {
    return "Draai aan het rad";
  }
  return CAFE_VAN_OUDS_WHEEL_OPTIONS[wheelSpin.lastIndex];
}

// Welk segment staat nu onder de wijzer (bovenaan)? Gelezen uit de echte
// draaihoek van het element, zodat het ook tijdens de CSS-transitie klopt.
function wheelIndexUnderPointer(spinner) {
  const matrix = getComputedStyle(spinner).transform;
  if (!matrix || matrix === "none") {
    return wheelSpin.lastIndex ?? 0;
  }
  const [a, b] = matrix.slice(matrix.indexOf("(") + 1, -1).split(",").map(Number);
  const angle = (Math.atan2(b, a) * 180) / Math.PI;
  const n = CAFE_VAN_OUDS_WHEEL_OPTIONS.length;
  const seg = 360 / n;
  const underPointer = (((-angle) % 360) + 360) % 360;
  return Math.min(Math.floor(underPointer / seg), n - 1);
}

// Laat het rad naar het gekozen segment draaien (altijd voorwaarts, meerdere
// volledige slagen voor het effect).
function startWheelSpin(index) {
  const n = CAFE_VAN_OUDS_WHEEL_OPTIONS.length;
  const seg = 360 / n;
  // Segmentmidden moet onder de wijzer (boven) komen: rotatie ≡ -(i*seg + seg/2).
  const landAt = (((-(index * seg + seg / 2)) % 360) + 360) % 360;
  const from = wheelSpin.rotation;
  const target = Math.ceil((from + 1) / 360) * 360 + 360 * 4 + landAt;

  wheelSpin.lastIndex = index;
  wheelSpin.active = true;
  wheelSpin.rotation = target;
  feedback.diceRattle();

  // CSS-transitie op het bestaande element; de render-guard houdt het element
  // intact tijdens de draai zodat de transitie niet gebroken wordt.
  const spinner = document.querySelector(".wheel-spinner");
  const spinBtn = document.querySelector('[data-action="vanouds-spin"]');
  const readout = document.querySelector(".wheel-readout");
  const spinSeconds = TURBO ? 1.2 : 3.4;
  if (spinBtn) {
    spinBtn.disabled = true;
  }
  if (readout) {
    readout.classList.remove("is-result");
    readout.classList.add("is-spinning");
  }
  if (spinner) {
    spinner.style.transition = "none";
    spinner.style.transform = `rotate(${from}deg)`;
    void spinner.offsetWidth; // commit begintoestand (reflow)
    spinner.style.transition = `transform ${spinSeconds}s cubic-bezier(0.12, 0.8, 0.2, 1)`;
    spinner.style.transform = `rotate(${target}deg)`;

    // Live meelezen welk drankje onder de wijzer door gaat, met een tik per segment.
    let shownIndex = -1;
    let lastTick = 0;
    const follow = () => {
      if (!wheelSpin.active) {
        return;
      }
      const index = wheelIndexUnderPointer(spinner);
      if (index !== shownIndex) {
        shownIndex = index;
        if (readout) {
          readout.textContent = CAFE_VAN_OUDS_WHEEL_OPTIONS[index];
        }
        const nowMs = performance.now();
        if (nowMs - lastTick > 70) {
          feedback.diceRattle();
          lastTick = nowMs;
        }
      }
      window.requestAnimationFrame(follow);
    };
    window.requestAnimationFrame(follow);
  }

  window.clearTimeout(wheelSpin.timer);
  wheelSpin.timer = window.setTimeout(() => {
    wheelSpin.active = false;
    if (readout) {
      readout.textContent = CAFE_VAN_OUDS_WHEEL_OPTIONS[index];
      readout.classList.remove("is-spinning");
      readout.classList.add("is-result");
    }
    feedback.confirm();
    // Geen volledige her-render (dat zou het scherm laten flitsen doordat
    // entree-animaties opnieuw starten). Patch alleen wat veranderde.
    patchVanOudsAfterSpin();
  }, spinSeconds * 1000 + 50);
}

// Werkt na een raddraai alleen de spelerslijst, de knop en de winnaar-highlight
// bij — zonder het hele scherm te herbouwen (voorkomt de zwarte flits).
function patchVanOudsAfterSpin() {
  const session = getSession();
  const teamState = getState()?.teams?.[session?.teamId];
  const task = teamState?.currentTask;
  if (task?.specialFlow !== "vanOuds") {
    render();
    return;
  }

  const rows = app.querySelectorAll(".vanouds-players .special-row");
  task.vanOudsChoices.forEach((choice, index) => {
    const row = rows[index];
    if (row && choice.result) {
      row.innerHTML = `<span>${esc(choice.name)}</span><strong>${esc(choice.result)}</strong>`;
    }
  });

  // Winnaar-segment markeren.
  app.querySelectorAll(".wheel-slice").forEach((slice) => {
    const s = wheelSliceState(Number(slice.dataset.index));
    slice.setAttribute("opacity", s.opacity);
    const path = slice.querySelector("path");
    path.setAttribute("stroke", s.stroke);
    path.setAttribute("stroke-width", s.strokeWidth);
  });

  const next = task.vanOudsChoices.find((choice) => !choice.result);
  const spinBtn = app.querySelector('[data-action="vanouds-spin"]');
  if (next) {
    if (spinBtn) {
      spinBtn.disabled = false;
      spinBtn.dataset.choiceId = next.id;
      spinBtn.textContent = `Draai voor ${next.name}`;
    }
  } else if (spinBtn) {
    // Iedereen heeft gedraaid: knop vervangen en bevestigen vrijgeven als de
    // minimumtimer voorbij is.
    spinBtn.outerHTML = '<p class="vanouds-done">Iedereen heeft gedraaid! 🍻</p>';
    if (getTaskConfirmRemaining(teamState) <= 0) {
      app.querySelectorAll('[data-action="confirm-task"], [data-action="confirm-task-bonus"]').forEach((btn) => {
        btn.disabled = false;
        btn.classList.add("cta-pulse");
      });
    }
  }
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
  // Niet opnieuw renderen terwijl het rad draait; dat zou het element
  // vervangen en de draai-animatie breken. De settle-timer rendert daarna.
  if (wheelSpin.active) {
    return;
  }

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

// Nieuwe hero-banner met terugval naar het oude logo zolang het bestand nog
// niet is toegevoegd.
const HERO_IMG =
  '<img class="brand-logo" src="./assets/zuipopoly-hero.jpg" alt="Zuip-O-Poly" ' +
  "onerror=\"this.onerror=null;this.src='./assets/zuipopoly-logo-full.svg';\" />";

function brandHeader(subtitle = "") {
  return `
    <header class="brand-header">
      ${HERO_IMG}
      ${subtitle ? `<p class="brand-slogan">${esc(subtitle)}</p>` : ""}
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
        <button class="button ghost turbo-toggle ${TURBO ? "is-on" : ""}" data-action="toggle-turbo">
          ⚡ Turbo-test: ${TURBO ? "AAN — timers ~15x korter" : "uit — timers in echte tijd"}
        </button>
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
        <span class="tape tape-tr"></span>
        <p class="room-hint hand">Deel deze code met je maten 👇</p>
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

function renderDie(face, extraClass = "") {
  const pips = [1, 2, 3, 4, 5, 6].map((pip) => `<span class="pip pip-${pip}"></span>`).join("");
  const faces = [1, 2, 3, 4, 5, 6]
    .map((n) => `<div class="face face-${n}">${pips}</div>`)
    .join("");
  return `<div class="die die-${face} ${extraClass}"><div class="die-cube">${faces}</div></div>`;
}

function renderDiceReveal(teamState) {
  const roll = walk.roll ?? teamState.lastRoll ?? 1;
  return `
    <section class="panel action-panel dice-reveal-panel">
      <div class="dice-stage">
        ${renderDie(roll, "die-reveal")}
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
        ${renderDie(face)}
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

// Kleur + bierviltje-icoon + label per vaktype.
const TASK_THEMES = {
  Straatvak: { tag: "Kroeg", key: "beer", accent: "#ffb02e" },
  Snackstation: { tag: "Snackstation", key: "snack", accent: "#ff7a00" },
  "Vast strafvak": { tag: "Strafvak", key: "warning", accent: "#e8001d" },
  "Vast speciaal vak": { tag: "Speciaal vak", key: "bolt", accent: "#00d4ff" },
  "Parkeeropdracht / chillvak": { tag: "Vrij Parkeren", key: "park", accent: "#00d464" },
  Celstraf: { tag: "Celstraf", key: "lock", accent: "#e8001d" },
  "Cel Bezoekvak": { tag: "Op bezoek", key: "camera", accent: "#ffd600" }
};

function getTaskTheme(task, teamState) {
  if (task.presentation === "chance") return { tag: "Kans", key: "dice", accent: "#ff2d44" };
  if (task.presentation === "fund") return { tag: "Algemeen Fonds", key: "coin", accent: "#c800ff" };
  const type = findTileById(teamState?.position)?.type ?? "";
  return TASK_THEMES[type] ?? { tag: "Opdracht", key: "target", accent: "var(--team-accent)" };
}

// Symbool binnen het viltje per type (donker glyph op accent-tint).
function coasterGlyph(key) {
  const glyphs = {
    beer: '<path d="M25 24h11v18a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4V24z"/><path d="M36 28h4a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-4"/><path d="M25 24c0-4 11-4 11 0" stroke-width="3" fill="none"/>',
    snack: '<path d="M23 30h18l-2 16a2 2 0 0 1-2 2H27a2 2 0 0 1-2-2l-2-16z"/><path d="M27 30l1-8M32 30v-9M37 30l-1-8" stroke-width="2.4" fill="none"/>',
    warning: '<path d="M32 20l14 24H18z"/><rect x="30.5" y="30" width="3" height="8" rx="1.5" fill="#080809"/><circle cx="32" cy="41" r="1.8" fill="#080809"/>',
    bolt: '<path d="M35 18L22 37h8l-3 11 14-21h-9l3-9z"/>',
    park: '<path d="M26 20h9a8 8 0 0 1 0 16h-4v10h-5V20zm5 6v6h4a3 3 0 0 0 0-6h-4z"/>',
    lock: '<rect x="23" y="31" width="18" height="15" rx="2.5"/><path d="M27 31v-4a5 5 0 0 1 10 0v4" fill="none" stroke-width="3.2"/>',
    camera: '<rect x="20" y="26" width="24" height="17" rx="3"/><circle cx="32" cy="34.5" r="5" fill="#080809"/><rect x="27" y="22" width="10" height="5" rx="2"/>',
    dice: '<rect x="22" y="22" width="20" height="20" rx="4"/><circle cx="28" cy="28" r="2" fill="#080809"/><circle cx="36" cy="28" r="2" fill="#080809"/><circle cx="32" cy="32" r="2" fill="#080809"/><circle cx="28" cy="36" r="2" fill="#080809"/><circle cx="36" cy="36" r="2" fill="#080809"/>',
    coin: '<circle cx="32" cy="32" r="12"/><path d="M36 27c-5-3-9 0-9 5s4 8 9 5" fill="none" stroke="#080809" stroke-width="2.6"/><path d="M25 31h9M25 35h9" stroke="#080809" stroke-width="2.2"/>',
    target: '<circle cx="32" cy="32" r="12" fill="none" stroke-width="3.2"/><circle cx="32" cy="32" r="5"/>'
  };
  return glyphs[key] ?? glyphs.target;
}

// Rond bierviltje met dubbele ring en symbool.
function coasterIcon(key, accent, className = "coaster") {
  return `
    <svg viewBox="0 0 64 64" class="${className}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="30" fill="#111116" stroke="${accent}" stroke-width="2.5" />
      <circle cx="32" cy="32" r="30" fill="${accent}" fill-opacity="0.18" />
      <circle cx="32" cy="32" r="25" fill="none" stroke="${accent}" stroke-width="1.4" stroke-dasharray="3 3" opacity="0.7" />
      <g fill="${accent}" stroke="${accent}" stroke-linejoin="round" stroke-linecap="round">${coasterGlyph(key)}</g>
    </svg>
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
  const theme = getTaskTheme(task, teamState);
  const ready = !timerBusy && !specialIncomplete;

  // Refresh-proof timerbalk: CSS-animatie met negatieve delay = verstreken tijd.
  const total = task.timerSeconds || 0;
  const elapsed = total - remaining;
  const timerBar = timerBusy
    ? `
      <div class="task-timer" role="timer">
        <div class="timer-track">
          <div class="timer-fill" style="animation: taskTimerFill ${total}s linear ${-elapsed}s forwards;"></div>
        </div>
        <span class="timer-label">${fmtTime(remaining)}</span>
      </div>
    `
    : "";

  return `
    <section class="panel action-panel task-panel task-themed" style="--task-accent:${theme.accent}">
      <div class="task-emblem" aria-hidden="true">${coasterIcon(theme.key, theme.accent, "coaster coaster-lg")}</div>
      <div class="task-head">
        <span class="task-tag">${coasterIcon(theme.key, theme.accent, "coaster coaster-sm")} ${esc(theme.tag)}</span>
        <h2 class="task-title">${esc(task.title)}</h2>
      </div>
      <div class="task-body">${nl2br(task.body)}</div>
      ${task.rules ? `<details class="task-rules"><summary>Regels</summary><p>${nl2br(task.rules)}</p></details>` : ""}
      ${specialBlock}
      ${timerBar}

      <div class="task-actions">
        ${task.bonusPowerUp ? `
          <button class="button primary big ${ready ? "cta-pulse" : ""}" data-action="confirm-task" ${ready ? "" : "disabled"}>Gedaan, wij zweren het</button>
          <button class="button gold big" data-action="confirm-task-bonus" ${ready ? "" : "disabled"}>Gedaan mét bonus (${esc(task.bonusPowerUp.label)})</button>
        ` : `
          <button class="button primary big ${ready ? "cta-pulse" : ""}" data-action="confirm-task" ${ready ? "" : "disabled"}>Gedaan, wij zweren het</button>
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
    const next = task.vanOudsChoices.find((choice) => !choice.result);
    return `
      <div class="special-flow vanouds-flow">
        <p class="special-flow-title">Rad van Bier en Vertier — iedereen draait één keer:</p>
        <div class="wheel-wrap">
          <div class="wheel-pointer" aria-hidden="true"></div>
          <div class="wheel-spinner" style="transform: rotate(${wheelSpin.rotation}deg);">
            ${wheelSvg()}
          </div>
        </div>
        <div class="wheel-readout ${wheelSpin.lastIndex === null ? "" : "is-result"}" aria-live="polite">${esc(wheelReadoutText())}</div>
        <div class="vanouds-players">
          ${task.vanOudsChoices.map((choice) => `
            <div class="special-row">
              <span>${esc(choice.name)}</span>
              ${choice.result ? `<strong>${esc(choice.result)}</strong>` : '<span class="row-muted">nog niet gedraaid</span>'}
            </div>
          `).join("")}
        </div>
        ${next
          ? `<button class="button gold" data-action="vanouds-spin" data-choice-id="${next.id}" ${wheelSpin.active ? "disabled" : ""}>Draai voor ${esc(next.name)}</button>`
          : '<p class="vanouds-done">Iedereen heeft gedraaid! 🍻</p>'}
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
    case "share_task":
      return teamState.status === TEAM_STATUS.TASK_ACTIVE && Boolean(teamState.currentTask);
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
          const tileImage = getTileImage(cell.tileId);
          let cellIcon = "";
          if (tileImage) {
            cellIcon = `<img class="board-cell-tile-icon" src="${tileImage}" alt="${esc(cellTile.name)}" />`;
          } else if (theme.className === "theme-station") {
            cellIcon = '<img class="board-cell-ns-logo" src="./assets/ns-logo-station.svg" alt="NS" />';
          }
          const edgeSide = cell.row === 0
            ? "bottom"
            : cell.row === BOARD_SIZE - 1
              ? "top"
              : cell.col === 0
                ? "right"
                : "left";
          return `
            <div class="board-cell edge-${edgeSide} ${theme.className} ${tileImage ? "has-tile-image" : ""} ${isHere ? "is-here" : ""}" data-tile-id="${cell.tileId}" style="--tile-color:${theme.color}" title="${esc(cellTile.name)}">
              ${cellIcon}
              ${isHere ? '<span class="board-pawn"></span>' : ""}
            </div>
          `;
        }).join("")}
        <div class="board-center">
          <img src="./assets/zuipopoly-emblem.png" alt="" onerror="this.onerror=null;this.src='./assets/zuipopoly-board-logo.svg';" />
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
  const art = popupArt(popup, teamState);
  const artImg = (cls) => (art ? `<img class="${cls}" src="${art.src}" alt="${esc(art.alt)}" />` : "");

  // Kans/Fonds: echte 3D-flipkaart (achterkant -> tik -> effect).
  if (popup.stage === "intro" && (popup.kind === "chance" || popup.kind === "fund")) {
    const label = popupKindLabel(popup.kind);
    return `
      <div class="popup-overlay">
        <div class="flip-card ${kindClass} ${ui.cardFlipped ? "flipped" : ""}" data-action="flip-card">
          <div class="flip-inner">
            <div class="flip-face flip-back">
              <span class="flip-kind">${esc(label)}</span>
              ${art ? artImg("flip-art") : '<span class="flip-mark">?</span>'}
              <span class="flip-hint">Tik om te draaien</span>
            </div>
            <div class="flip-face flip-front">
              ${artImg("popup-art popup-art-small")}
              <span class="popup-kind">${esc(label)}</span>
              <h2>${esc(popup.title)}</h2>
              <div class="popup-body">${nl2br(popup.body ?? "")}</div>
              <button class="button primary big" data-action="dismiss-popup">Oké</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Sfeer-intro bij aankomst op een vak: naam groot + sfeertekst, één tik verder.
  if (popup.stage === "intro") {
    const btnText = ["task", "snack", "parking"].includes(popup.kind) ? "Naar de opdracht" : "Verder";
    return `
      <div class="popup-overlay">
        <div class="popup-card sfeer-card ${kindClass}">
          <span class="tape tape-tl"></span>
          ${artImg("popup-art")}
          <span class="popup-kind">${esc(sfeerEyebrow(popup, teamState))}</span>
          <h2 class="sfeer-name">${esc(popup.title)}</h2>
          ${popup.body ? `<div class="popup-body sfeer-body">${nl2br(popup.body)}</div>` : ""}
          <button class="button primary big" data-action="dismiss-popup">${btnText}</button>
        </div>
      </div>
    `;
  }

  const hit = isHitPopup(popup);
  return `
    <div class="popup-overlay">
      <div class="popup-card ${kindClass} ${hit ? "popup-hit" : ""}">
        ${hit ? `<div class="hit-stamp">${hitStampLabel(popup)}</div>` : artImg("popup-art popup-art-small")}
        <span class="popup-kind">${esc(popupKindLabel(popup.kind))}</span>
        <h2>${esc(popup.title)}</h2>
        <div class="popup-body">${nl2br(popup.body ?? "")}</div>
        ${popup.blockedChoiceMessage ? `<p class="popup-blocked">${esc(popup.blockedChoiceMessage)}</p>` : ""}
        <button class="button primary big" data-action="dismiss-popup">Oké</button>
      </div>
    </div>
  `;
}

// Illustratie voor een pop-up: Kans/Fonds/Wisselstation krijgen hun eigen plaatje,
// de aankomst-intro van andere vakken de illustratie van het vak waar je staat.
function popupArt(popup, teamState) {
  const byKind = {
    chance: { src: "./assets/tiles/kans.png", alt: "Kans" },
    fund: { src: "./assets/tiles/algemeen-fonds.png", alt: "Algemeen Fonds" },
    swap: { src: "./assets/ns-logo-station.svg", alt: "Wisselstation" }
  };
  if (byKind[popup.kind]) {
    return byKind[popup.kind];
  }
  if (popup.stage !== "intro") {
    return null;
  }
  const tile = findTileById(teamState?.position);
  const src = tile ? getTileImage(tile.id) : null;
  return src ? { src, alt: tile.name } : null;
}

// Passend eyebrow-label voor de sfeer-intro, afgeleid van het vaktype.
function sfeerEyebrow(popup, teamState) {
  if (["chance", "fund", "swap", "start"].includes(popup.kind)) {
    return popupKindLabel(popup.kind);
  }
  const type = findTileById(teamState?.position)?.type ?? "";
  if (type.includes("Straatvak")) return "Kroeg";
  if (type.includes("Snackstation")) return "Snackstation";
  if (type.includes("Parkeer") || type.includes("chill")) return "Vrij Parkeren";
  if (type.includes("straf")) return "Strafvak";
  if (type.includes("speciaal")) return "Speciaal vak";
  if (type.includes("Cel")) return "Cel";
  return "Aangekomen";
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
      ${winner ? `
        <section class="certificate" style="--team-accent:${findTeamColor(winner.colorId).hex}">
          <span class="tape tape-tl"></span>
          <span class="tape tape-tr"></span>
          <p class="cert-eyebrow">Zuip-O-Poly Nijmegen · Oorkonde</p>
          <div class="cert-stamp stamp">Winnaar</div>
          <p class="cert-intro">Hierbij wordt plechtig verklaard dat</p>
          <h2 class="cert-name hand">${esc(winner.name)}</h2>
          <p class="cert-desc">de kroegentocht met verve heeft volbracht en zich kroont tot kampioen van de avond.</p>
          <p class="cert-stats">${winner.completedRounds} ${winner.completedRounds === 1 ? "ronde" : "rondes"} · vak ${winner.position}</p>
          <p class="cert-sign hand">Namens Nijmegen — proost! 🍻</p>
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
      rollDice(session.teamId, Number(target.dataset.roll) || null);
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
    case "vanouds-spin": {
      if (wheelSpin.active) {
        break;
      }
      const choiceId = target.dataset.choiceId;
      // Blokkeer de her-render die de store-update zou triggeren (voorkomt de
      // zwarte flits). Het rad-element blijft staan en gaat direct draaien.
      wheelSpin.active = true;
      spinVanOudsWheel(session.teamId, choiceId);
      const spunChoice = getState()?.teams?.[session.teamId]?.currentTask?.vanOudsChoices?.find(
        (choice) => choice.id === choiceId
      );
      startWheelSpin(spunChoice?.resultIndex ?? 0);
      break;
    }
    case "flip-card": {
      const card = target.closest(".flip-card");
      if (card && !card.classList.contains("flipped")) {
        const kind = getState()?.teams?.[session.teamId]?.activePopup?.kind;
        feedback.cardFlip(kind === "fund" ? "fund" : "chance");
        card.classList.add("flipped");
        ui.cardFlipped = true; // consistent bij een eventuele her-render
      }
      break;
    }
    case "dismiss-popup":
      ui.cardFlipped = false;
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
    case "toggle-turbo":
      setTurbo(!TURBO);
      window.location.reload();
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
    const el = document.querySelector(".task-timer .timer-label");
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

// ?reset=1 en ?turbo=1 beginnen altijd met een schoon spel (geen oud spel hervatten).
const startParams = new URLSearchParams(window.location.search);
if (startParams.get("reset") === "1" || startParams.get("turbo") === "1") {
  clearSession();
}

if (TURBO) {
  document.documentElement.classList.add("turbo");
  const badge = document.createElement("div");
  badge.className = "turbo-badge";
  badge.textContent = "⚡ TURBO";
  document.body.appendChild(badge);
}

// ?demo=1 start de testmodus direct.
if (new URLSearchParams(window.location.search).get("demo") === "1" && !getSession()?.roomCode) {
  startDemoGame();
}

if (getSession()?.roomCode && !getState()?.isDemo) {
  connectSync();
}

render();
