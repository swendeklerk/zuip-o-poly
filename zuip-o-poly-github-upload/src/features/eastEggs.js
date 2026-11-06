// Easter eggs & geheimen: 8 verborgen verrassingen voor Zuip-O-Poly Nijmegen.
// Puur sfeer en humor. Deze module leest nooit meer dan de spelstand (voor de
// teamnaam) en wijzigt die nooit. Alle UI hangt aan ctx.root; #app wordt telkens
// opnieuw opgebouwd, dus alle invoer loopt via document-level delegation.

const TOTAL = 8;
const COOLDOWN_MS = 2500; // herhaalde beloning van hetzelfde geheim niet spammen
const LONG_PRESS_MS = 650;
const HOLD_MS = 5000;
const MOVE_TOLERANCE = 12;
const AWAY_MS = 30000;
const SECRET_TEAM_NAMES = new Set(["bernie", "debeer", "omepiet", "mariken", "024"]);

/* ------------------------------------------------------------------ */
/* De 8 geheimen                                                       */
/* ------------------------------------------------------------------ */

const KIND_LABEL = {
  tik: "Tik-geheim",
  houd: "Vasthoud-geheim",
  beweeg: "Beweeg-geheim",
  tekst: "Naam-geheim",
  scroll: "Scroll-geheim",
  gedrag: "Gedrag-geheim",
  tijd: "Kalender-geheim"
};

const ALL_EGGS = [
  { id: "logo7", icon: "🎩", title: "De hoed van de beer", how: "Tik 7x snel op het logo", kind: "tik" },
  { id: "shake", icon: "🍾", title: "Bierfles geschud", how: "Schud je telefoon als een fles", kind: "beweeg" },
  { id: "tileFact", icon: "📜", title: "Kroegweetje", how: "Houd een vakje op het bord ingedrukt", kind: "houd" },
  { id: "tileCollector", icon: "🎓", title: "Kroegprofessor", how: "Lees 10 verschillende vak-weetjes", kind: "houd" },
  { id: "emblem", icon: "🫧", title: "Bierbel-embleem", how: "Dubbeltik op het embleem midden op het bord", kind: "tik" },
  { id: "pawn", icon: "😖", title: "Au, mijn pion!", how: "Tik 3x op je pion", kind: "tik" },
  { id: "dice10", icon: "🎲", title: "Dobbelsteenverslaafd", how: "Tik 10x op de dobbelsteen", kind: "tik" },
  { id: "secretTeam", icon: "🔑", title: "Het wachtwoord", how: "Kies een geheime teamnaam", kind: "tekst" },
  { id: "syncBadge", icon: "📡", title: "Live uit de kroeg", how: "Tik 5x op het LIVE/LOKAAL-badge", kind: "tik" },
  { id: "holdScreen", icon: "🤲", title: "Stevige grip", how: "Houd 5 seconden je vinger stil op het scherm", kind: "houd" },
  { id: "scrollBottom", icon: "🥛", title: "Bodem van het glas", how: "Scroll helemaal naar beneden", kind: "scroll" },
  { id: "konami", icon: "🕹️", title: "Oude gamer", how: "Een beroemde gamecode: omhoog, omhoog, omlaag, omlaag, links, rechts, links, rechts", kind: "beweeg" },
  { id: "roomCode", icon: "🔐", title: "Topgeheim", how: "Tik 3x op de spelcode", kind: "tik" },
  { id: "teamChip", icon: "🪪", title: "Naamdrager", how: "Tik 5x op jullie teamnaam bovenin", kind: "tik" },
  { id: "timer", icon: "⏳", title: "Klokkijker", how: "Tik 5x op de aftelklok van een opdracht", kind: "tik" },
  { id: "ruleZero", icon: "📏", title: "Regel nul", how: "Houd een regel in de regellijst ingedrukt", kind: "houd" },
  { id: "hemel", icon: "😇", title: "Naar de Hemel", how: "Tik 3x op vak 40, De Hemel", kind: "tik" },
  { id: "cel", icon: "⛓️", title: "Achter de tralies", how: "Tik 3x op een celvak (11 of 31)", kind: "tik" },
  { id: "terugVanWeg", icon: "🚰", title: "Waar was je?", how: "Verlaat de app 30 seconden en kom terug", kind: "gedrag" },
  { id: "midnight", icon: "🌙", title: "Spookuur", how: "Open de app rond middernacht (00:00 tot 01:00)", kind: "tijd" },
  { id: "happyHour", icon: "🍻", title: "Happy Hour", how: "Open de app tussen 17:00 en 18:00", kind: "tijd" },
  { id: "vierdaagse", icon: "🌺", title: "Vierdaagse-gevoel", how: "Open de app eind juli (18 tot 31 juli)", kind: "tijd" },
  { id: "elfElf", icon: "🎭", title: "Elfde van de elfde", how: "Open de app op 11 november", kind: "tijd" },
  { id: "sinterklaas", icon: "🎁", title: "Pakjesavond", how: "Open de app op 5 december", kind: "tijd" },
  { id: "koningsdag", icon: "🧡", title: "Oranje boven", how: "Open de app op Koningsdag", kind: "tijd" }
];

// Alleen de lichtste, leukste geheimen blijven actief (de rest liep te zwaar).
const ACTIVE_IDS = new Set(["logo7", "tileFact", "tileCollector", "secretTeam", "happyHour", "elfElf", "sinterklaas", "koningsdag"]);
const EGGS = ALL_EGGS.filter((egg) => ACTIVE_IDS.has(egg.id));

const BY_ID = Object.fromEntries(EGGS.map((egg) => [egg.id, egg]));

// Kalender-geheimen: voorwaarde op de (eventueel nagebootste) datum.
const TIME_EGGS = [
  { id: "midnight", test: (d) => d.getHours() === 0 },
  { id: "happyHour", test: (d) => d.getHours() === 17 },
  { id: "vierdaagse", test: (d) => d.getMonth() === 6 && d.getDate() >= 18 },
  { id: "elfElf", test: (d) => d.getMonth() === 10 && d.getDate() === 11 },
  { id: "sinterklaas", test: (d) => d.getMonth() === 11 && d.getDate() === 5 },
  {
    id: "koningsdag",
    // 27 april, of zaterdag 26 april als de 27e op een zondag valt.
    test: (d) => d.getMonth() === 3 && ((d.getDate() === 27 && d.getDay() !== 0) || (d.getDate() === 26 && d.getDay() === 6))
  }
];

// Een weetje per vakje (lang indrukken). Grappig en met een korreltje waarheid.
const TILE_FACTS = {
  1: "Nijmegen noemt zichzelf de oudste stad van Nederland. Dus ja, hier wordt al heel lang bier gedronken.",
  2: "Pater-bier: heilig genoeg om te drinken, zondig genoeg om een tweede te nemen.",
  3: "Het Algemeen Fonds is nooit algemeen. Het is altijd voor net iemand anders.",
  4: "Tiki betekent hier: een parasolletje in je drankje en geen enkel excuus.",
  5: "De Belastingdienst van de beer: niemand ontkomt eraan, ook niet met een BV.",
  6: "Hier wordt de fundering van de avond gelegd. Eén McFlurry per verdieping.",
  7: "Een blauwe hand heb je van een lekkende pen. Of van te lang aan een ijskoud glas hangen.",
  8: "Kans: 100% kans op ellende, 0% garantie op een gelukkige afloop.",
  9: "Ooit lag hier buskruit. Nu vooral gezelligheid, en dat ontploft ook sneller dan je denkt.",
  10: "Rood licht betekent stoppen. In dit spel is het meer een suggestie.",
  11: "Een frikandel speciaal is ook een maaltijd. Ongeveer. Op z'n Nijmeegs.",
  12: "Een Iers klavertje brengt geluk. Het geluk is hier meestal zwart met een witte kraag.",
  13: "Het enige vak dat je dorst echt lest. De beer vindt het stiekem het beste vak.",
  14: "Twee namen, één avond. Allebei zeggen ze 'nog eentje dan' en allebei liegen ze.",
  15: "De plek waar je 'even een flesje water' haalt en met veertien dingen buitenkomt.",
  16: "Wisselen kan hier van alles: stoel, sokken, teams. Alleen je geweten niet.",
  17: "Florijn was ooit een gouden munt. Perfect, want een goeie pint is dat ook.",
  18: "Dit fonds is gevuld met goede bedoelingen en slechte ideeën.",
  19: "Biljart is het enige spel waarbij je gaat zitten wachten en dat sport noemt.",
  20: "Faber is Latijn voor smid. Hier smeed je vooral plannen die morgen niemand meer weet.",
  21: "Bovenste verdieping, mooiste uitzicht van de avond, gratis entree. Alleen niet in de auto stappen straks.",
  22: "Beer + kitchen. Onze mascotte heeft hier stiekem gesolliciteerd.",
  23: "Kans: de enige kaart die bij het omdraaien al gemeen kijkt.",
  24: "Elke kroeg heeft die ene vaste gast die er al sinds 1987 zit. Dit is zijn tweede woonkamer.",
  25: "Het schap met chips is de gevaarlijkste gang van heel Nijmegen.",
  26: "Een kroket uit het luik is dé afsluiter van een goede avond. Dat staat in de wet. Bijna.",
  27: "Ierse pubs hebben één regel: als de band speelt, praat je gewoon harder.",
  28: "Samson had zijn kracht in zijn haar. Jij hebt 'm in je derde biertje.",
  29: "Elektriciteit: ook je telefoon heeft het nu nodig. Check je batterij!",
  30: "In de Derde Kamer wordt vooral gecoaliteerd over wie er nu rondt.",
  31: "Keizer Karel had in Nijmegen een paleis, waarschijnlijk met comfortabelere cellen dan deze.",
  32: "Dock 17: volgens zeebonken het haventje van de laatste ronde. Er komt altijd nog één.",
  33: "Van Ouds, want zo is het altijd gegaan: één rondje wordt er drie.",
  34: "Wie hier een kaart trekt, trekt vooral zijn eigen conclusies.",
  35: "Een wunderkammer is een kast vol rariteiten. Kijk gewoon eens rond, passend.",
  36: "Snel wisselen: van team, van plek of van gedachten. Dat laatste kost niks.",
  37: "Kans: nu met 20% extra drama.",
  38: "Daen: kort, krachtig, precies zoals je het derde rondje bestelt.",
  39: "Zuipbelasting: de belasting waar niemand blij van wordt, behalve de beer.",
  40: "In De Hemel beloof je dat je morgen 'echt' op tijd bent. Dat doe je nooit."
};

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

const BEAR_SVG = `
<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" focusable="false">
  <circle cx="19" cy="40" r="9" fill="#7a4a2a"/><circle cx="61" cy="40" r="9" fill="#7a4a2a"/>
  <circle cx="19" cy="40" r="4.5" fill="#c9905f"/><circle cx="61" cy="40" r="4.5" fill="#c9905f"/>
  <circle cx="40" cy="52" r="24" fill="#8b5a33"/>
  <ellipse cx="40" cy="60" rx="12" ry="9" fill="#d9a977"/>
  <ellipse cx="40" cy="54" rx="4.5" ry="3.2" fill="#2a1a10"/>
  <circle cx="31" cy="46" r="2.6" fill="#111"/><circle cx="49" cy="46" r="2.6" fill="#111"/>
  <circle cx="31.8" cy="45.2" r="0.9" fill="#fff"/><circle cx="49.8" cy="45.2" r="0.9" fill="#fff"/>
  <path d="M40 58 C34 55 24 57 21 64 C29 63 35 63 40 60 C45 63 51 63 59 64 C56 57 46 55 40 58 Z" fill="#1a1008"/>
  <ellipse cx="40" cy="31" rx="22" ry="4.6" fill="#141418" stroke="#ffd600" stroke-width="1"/>
  <rect x="27" y="6" width="26" height="25" rx="2.5" fill="#141418" stroke="#ffd600" stroke-width="1"/>
  <rect x="27" y="22" width="26" height="5" fill="#e8001d"/>
</svg>`;

const CONFETTI_COLORS = ["#ffd600", "#e8001d", "#00d4ff", "#c800ff", "#00d464", "#ff7a00", "#f0eef4"];

export function init(ctx) {
  const disposers = [];
  const timeouts = new Set();
  const reduced = () => {
    try {
      return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return false;
    }
  };

  const esc = ctx.esc ?? ((v) => String(v ?? ""));
  const safe = (fn) => {
    try {
      return fn();
    } catch (error) {
      console.warn("[eastEggs]", error);
      return undefined;
    }
  };

  try {
    ctx.loadCss(new URL("./eastEggs.css", import.meta.url));
  } catch (error) {
    console.warn("[eastEggs] css niet geladen", error);
  }

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      safe(fn);
    }, ms);
    timeouts.add(id);
    return id;
  }

  function cancel(id) {
    if (id) {
      window.clearTimeout(id);
      timeouts.delete(id);
    }
  }

  function listen(target, type, handler, options) {
    if (!target?.addEventListener) {
      return;
    }
    const wrapped = (event) => {
      try {
        handler(event);
      } catch (error) {
        console.warn(`[eastEggs] ${type}`, error);
      }
    };
    target.addEventListener(type, wrapped, options);
    disposers.push(() => target.removeEventListener(type, wrapped, options));
  }

  // Testhulp: ?eggtime=2026-12-05T17:30 bootst een andere datum na (alleen voor deze module).
  const clockOffset = (() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("eggtime");
      if (!raw) {
        return 0;
      }
      const t = new Date(raw).getTime();
      return Number.isNaN(t) ? 0 : t - Date.now();
    } catch {
      return 0;
    }
  })();
  const nowDate = () => new Date(Date.now() + clockOffset);

  /* ---------------- verzameling ---------------- */

  const eggStore = ctx.store("eggs", []);
  const tileStore = ctx.store("eggs.tiles", []);
  const found = new Set(
    (() => {
      const raw = eggStore.get();
      return Array.isArray(raw) ? raw.filter((id) => BY_ID[id]) : [];
    })()
  );
  const lastFire = {};

  function saveFound() {
    eggStore.set([...found]);
  }

  /* ---------------- effecten ---------------- */

  const layers = new Set();
  let particleBudget = 0;

  function makeLayer(className, ms) {
    const layer = document.createElement("div");
    layer.className = `egg-layer ${className ?? ""}`;
    layer.setAttribute("aria-hidden", "true");
    ctx.root.appendChild(layer);
    layers.add(layer);
    later(() => {
      layer.remove();
      layers.delete(layer);
    }, ms);
    return layer;
  }

  // Confetti: "burst" spat vanaf een punt, "rise" laat dingen omhoog zweven.
  function confetti({ count = 36, glyphs = null, x = 0.5, y = 0.45, spread = 1, mode = "burst" } = {}) {
    if (reduced() || particleBudget > 160) {
      return;
    }
    const n = Math.min(count, 60);
    particleBudget += n;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const layer = makeLayer("egg-layer-fx", 3400);
    later(() => {
      particleBudget = Math.max(0, particleBudget - n);
    }, 3400);
    for (let i = 0; i < n; i += 1) {
      const p = document.createElement("span");
      const glyph = glyphs && glyphs.length ? glyphs[Math.floor(Math.random() * glyphs.length)] : null;
      p.className = `egg-p egg-p-${mode}${glyph ? " is-glyph" : ""}`;
      const angle = Math.random() * Math.PI * 2;
      const dist = (70 + Math.random() * 190) * spread;
      if (mode === "rise") {
        p.style.setProperty("--x", `${Math.round((Math.random() - 0.5) * 120)}px`);
        p.style.setProperty("--y", `${-Math.round(h * (0.3 + Math.random() * 0.35))}px`);
      } else {
        p.style.setProperty("--x", `${Math.round(Math.cos(angle) * dist)}px`);
        p.style.setProperty("--y", `${Math.round(Math.sin(angle) * dist - 70)}px`);
      }
      p.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.setProperty("--d", `${1300 + Math.round(Math.random() * 1300)}ms`);
      p.style.left = `${Math.round(x * w + (mode === "rise" ? (Math.random() - 0.5) * 80 : 0))}px`;
      p.style.top = `${Math.round(y * h)}px`;
      if (glyph) {
        p.textContent = glyph;
        p.style.fontSize = `${14 + Math.round(Math.random() * 14)}px`;
      } else {
        p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      }
      layer.appendChild(p);
    }
  }

  // Dingen die van boven naar beneden vallen (regen van bier, bloemen, cadeautjes).
  function rain(glyphs, count = 28) {
    if (reduced() || particleBudget > 160) {
      return;
    }
    const n = Math.min(count, 44);
    particleBudget += n;
    const layer = makeLayer("egg-layer-fx", 6400);
    later(() => {
      particleBudget = Math.max(0, particleBudget - n);
    }, 6400);
    for (let i = 0; i < n; i += 1) {
      const p = document.createElement("span");
      p.className = "egg-p egg-p-fall is-glyph";
      p.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      p.style.left = `${Math.round(Math.random() * 100)}%`;
      p.style.fontSize = `${16 + Math.round(Math.random() * 16)}px`;
      p.style.setProperty("--d", `${2600 + Math.round(Math.random() * 1800)}ms`);
      p.style.setProperty("--delay", `${Math.round(Math.random() * 1600)}ms`);
      p.style.setProperty("--sway", `${Math.round((Math.random() - 0.5) * 120)}px`);
      layer.appendChild(p);
    }
  }

  function floatText(text, x, y) {
    const el = document.createElement("div");
    el.className = "egg-float";
    el.textContent = text;
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    ctx.root.appendChild(el);
    later(() => el.remove(), 1300);
  }

  function wobble(el, className = "egg-wobble", ms = 900) {
    if (!el || !el.classList) {
      return;
    }
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    later(() => {
      if (el.isConnected) {
        el.classList.remove(className);
      }
    }, ms);
  }

  // Zachte kleurwas over het hele scherm (geen interactie).
  function wash(theme, ms = 3200) {
    const el = document.createElement("div");
    el.className = `egg-wash egg-wash-${theme}`;
    el.style.setProperty("--wash-ms", `${ms}ms`);
    el.setAttribute("aria-hidden", "true");
    ctx.root.appendChild(el);
    layers.add(el);
    later(() => {
      el.remove();
      layers.delete(el);
    }, ms + 100);
  }

  // Tijdelijke kleurwissel van de huisstijl (alleen CSS-variabelen, altijd teruggezet).
  let varsSaved = null;
  let varsTimer = 0;
  function restoreVars() {
    cancel(varsTimer);
    varsTimer = 0;
    if (varsSaved) {
      const style = document.documentElement.style;
      for (const [key, prev] of Object.entries(varsSaved)) {
        if (prev) {
          style.setProperty(key, prev);
        } else {
          style.removeProperty(key);
        }
      }
      varsSaved = null;
    }
  }
  function themeVars(map, ms = 12000) {
    restoreVars();
    const style = document.documentElement.style;
    varsSaved = {};
    for (const [key, value] of Object.entries(map)) {
      varsSaved[key] = style.getPropertyValue(key);
      style.setProperty(key, value);
    }
    varsTimer = later(restoreVars, ms);
  }

  /* ---- beer-mascotte met praatwolk ---- */

  let bearEl = null;
  let bearTimer = 0;
  function dismissBear() {
    cancel(bearTimer);
    bearTimer = 0;
    const el = bearEl;
    bearEl = null;
    if (el) {
      el.classList.add("is-leaving");
      later(() => el.remove(), 380);
    }
  }
  function bearSay({ title = "", text = "", ms } = {}) {
    dismissBear();
    const el = document.createElement("div");
    el.className = "egg-bear";
    el.setAttribute("role", "status");
    el.innerHTML = `
      <div class="egg-bear-art" aria-hidden="true">${BEAR_SVG}</div>
      <div class="egg-bubble">
        ${title ? `<strong>${esc(title)}</strong>` : ""}
        <p>${esc(text)}</p>
      </div>`;
    el.addEventListener("click", dismissBear);
    ctx.root.appendChild(el);
    bearEl = el;
    bearTimer = later(dismissBear, ms ?? Math.min(9000, 3200 + String(text).length * 48));
  }

  /* ---- speelse schermvullende overlay ---- */

  let overlayEl = null;
  let overlayTimer = 0;
  function closeOverlay() {
    cancel(overlayTimer);
    overlayTimer = 0;
    const el = overlayEl;
    overlayEl = null;
    if (el) {
      el.classList.add("is-leaving");
      later(() => el.remove(), 380);
    }
  }
  function showOverlay({ icon = "🎉", title = "", text = "", theme = "gold", ms = 5000, big = "" } = {}) {
    closeOverlay();
    const el = document.createElement("div");
    el.className = `egg-overlay egg-theme-${theme}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", title);
    el.innerHTML = `
      <div class="egg-overlay-fx" aria-hidden="true"></div>
      <div class="egg-overlay-card">
        <div class="egg-overlay-icon" aria-hidden="true">${esc(icon)}</div>
        ${big ? `<div class="egg-overlay-big">${esc(big)}</div>` : ""}
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <small>Tik om te sluiten</small>
      </div>`;
    el.addEventListener("click", closeOverlay);
    ctx.root.appendChild(el);
    overlayEl = el;
    overlayTimer = later(closeOverlay, ms);
  }

  /* ---------------- beloningen ---------------- */

  const REWARDS = {
    logo7(info) {
      wobble(info.el, "egg-spin-once", 1100);
      confetti({ glyphs: ["🍺", "🍻", "🎩", "✨"], count: 34 });
      bearSay({
        title: "Zeven keer!",
        text: "Je hebt me aan mijn hoed getrokken. Mag ik even? Rechtgezet, snor gekamd. Zullen we nu verder spelen?"
      });
    },
    shake() {
      ctx.vibrate?.([40, 30, 40, 30, 90]);
      showOverlay({
        icon: "🍾",
        title: "Niet schudden!",
        text: "Het schuimt over de rand. Wie dit opruimt? Niet de beer, die heeft een hoed op.",
        theme: "foam",
        ms: 4200
      });
    },
    tileFact(info) {
      const tileId = info.tileId;
      const tile = ctx.findTileById?.(tileId);
      const name = String(tile?.name ?? `Vak ${tileId}`).replace(/\s*\n\s*/g, " ");
      const fact = TILE_FACTS[tileId] ?? "Over dit plekje wil de beer niets kwijt. Verdacht.";
      const seen = tileStore.get();
      bearSay({ title: `Weetje: ${name}`, text: `${fact} (${Array.isArray(seen) ? seen.length : 1}/40 gelezen)`, ms: 6500 });
    },
    tileCollector() {
      confetti({ glyphs: ["🎓", "📚", "🍺", "✨"], count: 40 });
      showOverlay({
        icon: "🎓",
        title: "Kroegprofessor",
        text: "Je kent al tien Nijmeegse plekjes beter dan de gemeente. Je diploma is een bierviltje, zeg maar.",
        theme: "purple",
        ms: 5200
      });
    },
    emblem(info) {
      const img = document.querySelector(".board-center img");
      if (img) {
        const r = img.getBoundingClientRect();
        if (r.width > 0) {
          const clone = new Image();
          clone.src = img.currentSrc || img.src;
          clone.alt = "";
          clone.className = "egg-clone";
          clone.style.left = `${Math.round(r.left)}px`;
          clone.style.top = `${Math.round(r.top)}px`;
          clone.style.width = `${Math.round(r.width)}px`;
          clone.style.height = `${Math.round(r.height)}px`;
          ctx.root.appendChild(clone);
          later(() => clone.remove(), 1600);
          confetti({
            glyphs: ["🫧", "🫧", "🍺", "✨"],
            count: 26,
            mode: "rise",
            x: (r.left + r.width / 2) / window.innerWidth,
            y: (r.top + r.height / 2) / window.innerHeight
          });
        }
      }
      bearSay({ text: "Bubbels! Dit embleem is eigenlijk een bierviltje dat een carrière wilde. Ik ken de manager." });
    },
    pawn(info) {
      wobble(info.el, "egg-pawn-wobble", 900);
      floatText("Au!", info.x ?? window.innerWidth / 2, (info.y ?? window.innerHeight / 2) - 12);
      bearSay({ text: "Hé, niet in je pion prikken. Hij loopt al de hele avond voor jullie. Een vakje meer of minder, hij klaagt niet." });
    },
    dice10(info) {
      const stage = info.el?.closest?.(".dice-stage") ?? info.el;
      wobble(stage, "egg-dice-spin", 1300);
      confetti({ glyphs: ["🎲", "🎲", "🍀", "✨"], count: 36 });
      bearSay({
        title: "Tien keer tikken?",
        text: "Dat verandert niks aan je worp. Wel aan je zelfbeeld. Gooi gewoon en zie wat het wordt."
      });
    },
    secretTeam() {
      confetti({ glyphs: ["🔑", "🍺", "✨", "🪙"], count: 36 });
      showOverlay({
        icon: "🚪",
        big: "PSST",
        title: "Welkom in de Geheime Bar",
        text: "Vanavond geschonken: Heilig Water (gratis), Alcoholvrij (ook gratis) en één rondje respect (onbetaalbaar).",
        theme: "purple",
        ms: 6000
      });
    },
    syncBadge() {
      wash("ice", 2600);
      confetti({ glyphs: ["📡", "📶", "🍺"], count: 24, mode: "rise", y: 0.2 });
      bearSay({ text: "Ja ja, ik ben ook LIVE. Verbonden met de bar sinds 1998, signaal vol hoed." });
    },
    holdScreen() {
      ctx.vibrate?.([30, 40, 30, 40, 80]);
      wash("gold", 3000);
      bearSay({ text: "Wat een grip! Je houdt dat scherm vast alsof het je laatste frikandel is. Respect, maar adem even door." });
    },
    scrollBottom() {
      showOverlay({
        icon: "🥛",
        title: "De bodem van het glas",
        text: "Je hebt de onderkant van de app gezien. Er staat verder niks. Wel een goed moment voor een glas water.",
        theme: "ice",
        ms: 4500
      });
    },
    konami() {
      confetti({ glyphs: ["🕹️", "👾", "⭐", "🍄", "🍺"], count: 44 });
      rain(["👾", "⭐", "🍄", "🪙"], 26);
      themeVars({ "--red": "#00d464", "--red-bright": "#7dffb3", "--gold": "#ff7ae0" }, 9000);
      showOverlay({
        icon: "🕹️",
        big: "+30",
        title: "Extra levens",
        text: "Helaas geldt dat niet voor dit spel. Alleen in de echte wereld mag je er best wat aan doen: drink af en toe water.",
        theme: "rainbow",
        ms: 5600
      });
    },
    roomCode(info) {
      wobble(info.el, "egg-wobble", 900);
      confetti({ glyphs: ["🔐", "🤫", "🍺"], count: 24 });
      bearSay({ text: "Spelcode? Topgeheim! Behalve dat je 'm net naar heel Nijmegen hebt gestuurd. Typisch." });
    },
    teamChip(info) {
      const name = ctx.myTeam?.()?.name;
      wobble(info.el, "egg-wobble", 900);
      confetti({ glyphs: ["🪪", "⭐", "✨"], count: 26 });
      bearSay({
        title: name ? `${name}!` : "Mooie naam!",
        text: "Wat een naam. Ik zou 'm laten tatoeëren, maar ik heb alleen een snor."
      });
    },
    timer(info) {
      wobble(info.el, "egg-wobble", 900);
      rain(["⏳", "⌛", "⏱️"], 18);
      bearSay({ text: "Naar de klok kijken maakt 'm niet sneller, alleen gespannener. Drink wat, kijk de ander eens aan." });
    },
    ruleZero() {
      confetti({ glyphs: ["📏", "📜", "🍺"], count: 28 });
      showOverlay({
        icon: "📏",
        big: "REGEL 0",
        title: "De beer heeft altijd gelijk",
        text: "Regel 00: wie tussendoor water drinkt, is stiekem de echte winnaar. Regel 000: niemand rijdt nog.",
        theme: "gold",
        ms: 5600
      });
    },
    hemel() {
      showOverlay({
        icon: "😇",
        title: "Je staat in De Hemel",
        text: "Hemelse lichtstralen op vak 40. Eerlijk is eerlijk: een engel zou nu water drinken en naar huis fietsen.",
        theme: "rays",
        ms: 5200
      });
      rain(["😇", "✨", "☁️"], 22);
    },
    cel() {
      ctx.vibrate?.([60, 40, 60]);
      showOverlay({
        icon: "⛓️",
        title: "Achter de tralies",
        text: "Goed gedrag? Dat is lastig, zeker in deze cel. Gelukkig mag je er gewoon weer uit zodra de timer afloopt.",
        theme: "bars",
        ms: 4600
      });
    },
    terugVanWeg() {
      rain(["💧", "🚰", "💦"], 22);
      bearSay({
        title: "Daar ben je weer!",
        text: "Waar was je? Plassen? Water halen? Ik hoop het laatste. Even bijtanken en we gaan weer."
      });
    },
    midnight() {
      wash("night", 4200);
      rain(["🦇", "🌙", "⭐"], 18);
      bearSay({
        title: "Het spookuur",
        text: "Middernacht en jij speelt nog. Alleen water, een tosti en je bed kunnen je nu nog redden. In die volgorde."
      });
    },
    happyHour() {
      wash("gold", 3600);
      rain(["🍻", "🍺", "🍹"], 28);
      bearSay({
        title: "Happy Hour!",
        text: "Het is vijf uur ergens, en nu ook in Nijmegen. Proost, en vergeet je water niet."
      });
    },
    vierdaagse() {
      rain(["🌺", "🌸", "🏅", "👟"], 30);
      themeVars({ "--red": "#ff4f9a", "--red-bright": "#ff7ab8" }, 10000);
      bearSay({
        title: "Vierdaagse!",
        text: "Blaren, gladiolen en bier. De Via Gladiola is niks voor watjes, al mag water natuurlijk best."
      });
    },
    elfElf() {
      confetti({ glyphs: ["🎭", "🎺", "🎉", "🥳"], count: 44 });
      wash("rainbow", 3200);
      bearSay({
        title: "11-11!",
        text: "De elfde van de elfde: de narren zijn los en de beer zet zijn hoed schuin. Alaaf, of hoe je dat hier ook zegt."
      });
    },
    sinterklaas() {
      rain(["🎁", "🍬", "🥜", "🎅"], 30);
      themeVars({ "--gold": "#ffb3b3" }, 10000);
      bearSay({
        title: "Pakjesavond!",
        text: "Wie een gedichtje heeft voorgelezen, krijgt van mij een compliment. Of een pepernoot. De pepernoot is sneller op."
      });
    },
    koningsdag() {
      wash("orange", 3600);
      themeVars({ "--red": "#ff7a00", "--red-bright": "#ff9a3d" }, 14000);
      rain(["🧡", "👑", "🍊", "🍺"], 28);
      bearSay({
        title: "Oranje boven!",
        text: "Vrijmarkt in de binnenstad en de beer verkoopt zijn snor. Aanbieding: tweede snor gratis."
      });
    }
  };

  /* ---------------- ontdekken, toasts, teller ---------------- */

  const toastQueue = [];
  let toastBusy = false;
  function pumpToasts() {
    if (toastBusy) {
      return;
    }
    const next = toastQueue.shift();
    if (!next) {
      return;
    }
    toastBusy = true;
    safe(() =>
      ctx.toast(
        `<span class="egg-toast-head">Geheim gevonden! (${next.n}/${TOTAL})</span>` +
          `<span class="egg-toast-title">${esc(next.egg.icon)} ${esc(next.egg.title)}</span>`,
        { ms: 3200, className: "egg-toast" }
      )
    );
    later(() => {
      toastBusy = false;
      pumpToasts();
    }, 3700);
  }

  let counterEl = null;
  function updateCounter(bump) {
    if (!counterEl) {
      return;
    }
    counterEl.hidden = found.size === 0;
    const n = counterEl.querySelector(".egg-counter-n");
    if (n) {
      n.textContent = `${found.size}/${TOTAL}`;
    }
    counterEl.setAttribute("aria-label", `Geheimen: ${found.size} van ${TOTAL} gevonden. Tik voor het overzicht.`);
    counterEl.classList.toggle("is-complete", found.size >= TOTAL);
    if (bump && !reduced()) {
      counterEl.classList.remove("is-bump");
      void counterEl.offsetWidth;
      counterEl.classList.add("is-bump");
    }
  }

  function finale() {
    ctx.feedback?.win?.();
    confetti({ glyphs: ["🏆", "🍺", "🎉", "⭐", "🎩"], count: 56, spread: 1.4 });
    rain(["🏆", "🍻", "⭐", "🎩"], 40);
    showOverlay({
      icon: "🏆",
      big: `${TOTAL}/${TOTAL}`,
      title: "Geheimenmeester!",
      text: "Alle geheimen gevonden. Je hebt óf te veel tijd, óf te veel dorst. De beer zet zijn hoed voor je af en schenkt je een eeuwig glas water.",
      theme: "rainbow",
      ms: 9000
    });
  }

  function discover(id, info = {}) {
    const egg = BY_ID[id];
    if (!egg) {
      return;
    }
    const now = Date.now();
    if (now - (lastFire[id] ?? 0) < COOLDOWN_MS) {
      return;
    }
    lastFire[id] = now;
    const isNew = !found.has(id);
    if (isNew) {
      found.add(id);
      saveFound();
      updateCounter(true);
      toastQueue.push({ egg, n: found.size });
      pumpToasts();
      safe(() => ctx.feedback?.powerup?.());
      safe(() => ctx.vibrate?.([30, 40, 60]));
    } else {
      safe(() => ctx.feedback?.tap?.());
    }
    safe(() => REWARDS[id]?.(info, isNew));
    if (isNew && found.size === TOTAL) {
      later(finale, 2600);
    }
  }

  /* ---------------- overzicht (teller + lijst) ---------------- */

  let sheetEl = null;
  function closeSheet() {
    if (sheetEl) {
      sheetEl.remove();
      sheetEl = null;
      counterEl?.focus?.({ preventScroll: true });
    }
  }
  function openSheet() {
    closeSheet();
    const pct = Math.round((found.size / TOTAL) * 100);
    const items = EGGS.map((egg) =>
      found.has(egg.id)
        ? `<li class="egg-item is-found"><span class="egg-item-icon" aria-hidden="true">${esc(egg.icon)}</span><div><strong>${esc(egg.title)}</strong><small>${esc(egg.how)}</small></div></li>`
        : `<li class="egg-item is-locked"><span class="egg-item-icon" aria-hidden="true">❓</span><div><strong>???</strong><small>${esc(KIND_LABEL[egg.kind] ?? "Geheim")}</small></div></li>`
    ).join("");
    const el = document.createElement("div");
    el.className = "egg-sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Geheimen-overzicht");
    el.innerHTML = `
      <div class="egg-sheet-panel">
        <header class="egg-sheet-head">
          <div>
            <h2>Geheimen</h2>
            <p>${found.size} van ${TOTAL} gevonden</p>
          </div>
          <button type="button" class="egg-sheet-close" aria-label="Sluiten">×</button>
        </header>
        <div class="egg-progress" aria-hidden="true"><span style="width:${pct}%"></span></div>
        <ul class="egg-list">${items}</ul>
        <p class="egg-sheet-foot">Tip: tik overal op, houd dingen vast en kom op gekke tijden terug. En drink af en toe een glas water.</p>
      </div>`;
    el.addEventListener("click", (event) => {
      if (event.target === el || event.target.closest(".egg-sheet-close")) {
        closeSheet();
      }
    });
    ctx.root.appendChild(el);
    sheetEl = el;
    el.querySelector(".egg-sheet-close")?.focus?.({ preventScroll: true });
  }

  counterEl = document.createElement("button");
  counterEl.type = "button";
  counterEl.className = "egg-counter";
  counterEl.hidden = true;
  counterEl.innerHTML = '<span class="egg-counter-icon" aria-hidden="true">🥚</span><span class="egg-counter-n">0/8</span>';
  counterEl.addEventListener("click", () => {
    safe(() => ctx.feedback?.tap?.());
    if (sheetEl) {
      closeSheet();
    } else {
      openSheet();
    }
  });
  (ctx.dock ?? ctx.root).appendChild(counterEl);
  updateCounter(false);

  /* ---------------- tikken, lang indrukken, vasthouden ---------------- */

  const taps = {};
  function tapCount(key, gapMs) {
    const now = Date.now();
    const state = taps[key] ?? (taps[key] = { n: 0, t: 0 });
    state.n = now - state.t > gapMs ? 1 : state.n + 1;
    state.t = now;
    return state.n;
  }
  function tapReset(key) {
    if (taps[key]) {
      taps[key].n = 0;
    }
  }

  // Wat zit er onder de vinger? Wordt bij pointerdown vastgelegd, want #app kan
  // tussen indrukken en loslaten opnieuw worden opgebouwd.
  function classify(target, x, y) {
    if (!(target instanceof Element) || ctx.root.contains(target)) {
      return null;
    }
    const info = { x, y, el: target };
    info.interactive = Boolean(target.closest("button, a, input, textarea, select, summary, label, [data-action]"));
    const logo = target.closest(".brand-logo");
    if (logo) {
      info.logo = true;
      info.el = logo;
    }
    const die = target.closest(".die, .dice-stage");
    if (die) {
      info.die = true;
      info.el = die;
    }
    const pawn = target.closest(".board-pawn");
    if (pawn) {
      info.pawn = true;
      info.el = pawn;
    }
    const cell = target.closest(".board-cell[data-tile-id]");
    if (cell) {
      info.tileId = Number(cell.dataset.tileId);
      info.cellIsHere = cell.classList.contains("is-here");
      info.cell = true;
    } else if (target.closest(".board-grid")) {
      const center = document.querySelector(".board-center");
      if (center) {
        const r = center.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          info.emblem = true;
        }
      }
    }
    const sync = target.closest(".sync-badge");
    if (sync) {
      info.sync = true;
      info.el = sync;
    }
    const chip = target.closest(".team-chip");
    if (chip && !target.closest(".lobby-team-list")) {
      info.chip = true;
      info.el = chip;
    }
    const timer = target.closest(".task-timer, .timer-label");
    if (timer) {
      info.timer = true;
      info.el = timer;
    }
    const code = target.closest(".room-code");
    if (code) {
      info.code = true;
      info.el = code;
    }
    const rule = target.closest(".rules-list li");
    if (rule) {
      info.rule = true;
    }
    return info;
  }

  let gesture = null;
  function clearGesture() {
    if (gesture) {
      cancel(gesture.longTimer);
      cancel(gesture.holdTimer);
      gesture = null;
    }
  }

  function onLongPress(info) {
    if (info.tileId) {
      const seen = tileStore.get();
      const list = Array.isArray(seen) ? seen : [];
      if (!list.includes(info.tileId)) {
        list.push(info.tileId);
        tileStore.set(list);
      }
      // Altijd het weetje tonen; het geheim zelf telt alleen de eerste keer als nieuw.
      lastFire.tileFact = 0;
      discover("tileFact", info);
      if (list.length >= 10 && !found.has("tileCollector")) {
        later(() => discover("tileCollector", info), 2400);
      }
      return true;
    }
    if (info.rule) {
      discover("ruleZero", info);
      return true;
    }
    return false;
  }

  function onTap(info) {
    if (info.logo) {
      const n = tapCount("logo", 1400);
      if (n >= 7) {
        tapReset("logo");
        discover("logo7", info);
      } else if (n >= 4) {
        safe(() => ctx.vibrate?.(8));
      }
    }
    if (info.die) {
      const n = tapCount("die", 1500);
      if (n >= 10) {
        tapReset("die");
        discover("dice10", info);
      } else if (n >= 6) {
        safe(() => ctx.vibrate?.(6));
      }
    }
    if (info.pawn || (info.cell && info.cellIsHere)) {
      const n = tapCount("pawn", 1500);
      if (n >= 3) {
        tapReset("pawn");
        discover("pawn", info);
      } else if (info.pawn) {
        wobble(info.el, "egg-pawn-wobble", 500);
      }
    }
    if (info.emblem) {
      const n = tapCount("emblem", 1200);
      if (n >= 2) {
        tapReset("emblem");
        discover("emblem", info);
      }
    }
    if (info.tileId === 40) {
      if (tapCount("hemel", 1500) >= 3) {
        tapReset("hemel");
        discover("hemel", info);
      }
    }
    if (info.tileId === 11 || info.tileId === 31) {
      if (tapCount("cel", 1500) >= 3) {
        tapReset("cel");
        discover("cel", info);
      }
    }
    if (info.sync && tapCount("sync", 1500) >= 5) {
      tapReset("sync");
      discover("syncBadge", info);
    }
    if (info.chip && tapCount("chip", 1500) >= 5) {
      tapReset("chip");
      discover("teamChip", info);
    }
    if (info.timer && tapCount("timer", 1500) >= 5) {
      tapReset("timer");
      discover("timer", info);
    }
    if (info.code && tapCount("code", 1500) >= 3) {
      tapReset("code");
      discover("roomCode", info);
    }
  }

  listen(
    document,
    "pointerdown",
    (event) => {
      if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      clearGesture();
      const info = classify(event.target, event.clientX, event.clientY);
      if (!info) {
        return;
      }
      const g = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        t0: performance.now(),
        info,
        moved: false,
        longFired: false,
        holdFired: false,
        longTimer: 0,
        holdTimer: 0
      };
      if (info.tileId || info.rule) {
        g.longTimer = later(() => {
          if (gesture === g && !g.moved) {
            g.longFired = onLongPress(info);
          }
        }, LONG_PRESS_MS);
      }
      gesture = g;
    },
    { capture: true, passive: true }
  );

  listen(
    document,
    "pointermove",
    (event) => {
      if (!gesture || event.pointerId !== gesture.id || gesture.moved) {
        return;
      }
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MOVE_TOLERANCE) {
        gesture.moved = true;
        cancel(gesture.longTimer);
        cancel(gesture.holdTimer);
      }
    },
    { capture: true, passive: true }
  );

  listen(
    document,
    "pointerup",
    (event) => {
      const g = gesture;
      if (!g || event.pointerId !== g.id) {
        return;
      }
      cancel(g.longTimer);
      cancel(g.holdTimer);
      gesture = null;
      if (g.moved || g.longFired || g.holdFired || performance.now() - g.t0 > 700) {
        return;
      }
      onTap(g.info);
    },
    { capture: true, passive: true }
  );

  for (const type of ["pointercancel", "visibilitychange", "blur"]) {
    listen(type === "blur" ? window : document, type, clearGesture, { capture: true, passive: true });
  }
  listen(document, "scroll", clearGesture, { capture: true, passive: true });

  // Lang indrukken op een vakje of regel mag geen contextmenu openen.
  listen(document, "contextmenu", (event) => {
    const t = event.target;
    if (t instanceof Element && !ctx.root.contains(t) && t.closest(".board-grid, .rules-list li, .brand-logo, .die")) {
      event.preventDefault();
    }
  });

  /* ---------------- geheime teamnaam ---------------- */

  let secretShown = false;

  function checkName(name, allowReplay) {
    const key = String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!SECRET_TEAM_NAMES.has(key)) {
      return;
    }
    if (!secretShown && (allowReplay || !found.has("secretTeam"))) {
      secretShown = true;
      discover("secretTeam");
    }
  }

  listen(
    document,
    "input",
    (event) => {
      const t = event.target;
      if (t instanceof HTMLInputElement && t.name === "teamName") {
        checkName(t.value, true);
      }
    },
    { capture: true, passive: true }
  );

  let lastTeamName = null;
  const unsubscribe = safe(() =>
    ctx.subscribe?.(() => {
      safe(() => {
        const name = ctx.myTeam?.()?.name ?? null;
        if (name !== lastTeamName) {
          lastTeamName = name;
          if (name) {
            checkName(name, false);
          }
        }
      });
    })
  );
  if (typeof unsubscribe === "function") {
    disposers.push(unsubscribe);
  }

  /* ---------------- kalender- en klokgeheimen ---------------- */

  function checkTime() {
    if (document.hidden) {
      return;
    }
    const date = nowDate();
    const due = TIME_EGGS.filter((entry) => !found.has(entry.id) && safe(() => entry.test(date)));
    due.forEach((entry, index) => {
      if (index === 0) {
        discover(entry.id);
      } else {
        later(() => discover(entry.id), index * 7000);
      }
    });
  }

  later(checkTime, 3500);
  const clockInterval = window.setInterval(() => safe(checkTime), 20000);
  disposers.push(() => window.clearInterval(clockInterval));

  /* ---------------- opruimen ---------------- */

  function dispose() {
    restoreVars();
    disposers.splice(0).forEach((fn) => safe(fn));
    timeouts.forEach((id) => window.clearTimeout(id));
    timeouts.clear();
    clearGesture();
    layers.forEach((layer) => layer.remove());
    layers.clear();
    bearEl?.remove();
    overlayEl?.remove();
    sheetEl?.remove();
    counterEl?.remove();
  }
  // Geen opruiming bij pagehide: bij terugkeer uit de bfcache moet alles blijven werken.
  return dispose;
}
