import { getSession, getState, subscribe } from "../store/gameStore.js";
import { feedback, vibrate } from "../services/feedback.js";
import { TURBO } from "../data/gameConfig.js";
import { GAME_PHASE, TEAM_STATUS } from "../data/statuses.js";
import { findTileById } from "../data/tiles.js";

// Features zijn losse modules die de app uitbreiden zonder main.js of de
// spellogica aan te raken. Elke module exporteert `init(ctx)`. Een kapotte
// module wordt overgeslagen en breekt de rest van de app nooit.
const FEATURES = ["./eastEggs.js", "./juice.js", "./awards.js"];

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function createRoot() {
  const root = document.createElement("div");
  root.id = "features-root";
  document.body.appendChild(root);
  return root;
}

function loadCss(url) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url instanceof URL ? url.href : url;
  document.head.appendChild(link);
}

function store(key, fallback) {
  const k = `zuipopoly.fx.${key}`;
  return {
    get() {
      try {
        const raw = window.localStorage.getItem(k);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(value) {
      try {
        window.localStorage.setItem(k, JSON.stringify(value));
      } catch {
        /* opslag vol of geblokkeerd: negeren */
      }
    }
  };
}

// Handige vaste helpers voor alle features.
function buildContext() {
  const root = createRoot();
  // Eén balkje onderaan voor de zwevende knoppen (🍻 📊 🥚), zodat ze niet over de inhoud liggen.
  const dock = document.createElement("div");
  dock.id = "features-dock";
  root.appendChild(dock);
  document.body.classList.add("has-dock");
  const myTeam = () => {
    const session = getSession();
    const state = getState();
    return state && session ? state.teams?.[session.teamId] ?? null : null;
  };
  return {
    root, // vaste laag buiten #app; main.js rendert hier nooit in
    dock, // balkje onderaan: hang hier je zwevende knop in
    app: document.getElementById("app"),
    getState,
    getSession,
    myTeam, // het team van dit toestel (of null)
    subscribe, // subscribe(fn): fn(state) bij elke wijziging; geeft unsubscribe terug
    feedback, // geluid + trilling van de app
    vibrate,
    TURBO,
    GAME_PHASE,
    TEAM_STATUS,
    findTileById,
    esc,
    loadCss,
    store, // store("naam", standaard) -> { get(), set(v) } in localStorage
    // Korte melding bovenin beeld (verdwijnt vanzelf).
    // Eén laag tegelijk: een melding wacht tot een open popup of flipkaart weg is (max 20 s).
    toast(html, { ms = 3200, className = "" } = {}) {
      const show = () => {
        const el = document.createElement("div");
        el.className = `fx-toast ${className}`;
        el.innerHTML = html;
        root.appendChild(el);
        window.setTimeout(() => el.classList.add("is-leaving"), ms);
        window.setTimeout(() => el.remove(), ms + 400);
        return el;
      };
      const blocked = () => Boolean(document.querySelector(".popup-overlay"));
      if (!blocked()) {
        return show();
      }
      const waitUntil = Date.now() + 20000;
      const timer = window.setInterval(() => {
        if (!blocked() || Date.now() > waitUntil) {
          window.clearInterval(timer);
          show();
        }
      }, 600);
      return null;
    }
  };
}

async function boot() {
  const ctx = buildContext();
  loadCss(new URL("./base.css", import.meta.url));
  for (const path of FEATURES) {
    try {
      const mod = await import(path);
      await mod.init?.(ctx);
    } catch (error) {
      console.warn(`[features] ${path} overgeslagen:`, error);
    }
  }
}

boot();
