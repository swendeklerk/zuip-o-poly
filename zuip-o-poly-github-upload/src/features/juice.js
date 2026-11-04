// JUICE: effecten, geluid en gevoel.
// - Celebraties op een canvas (confetti, vuurwerk, schuim, beren/bier, vlammen,
//   glitch, gouden sterren), getriggerd door state-wijzigingen van ons team.
// - Proost-knop: kroeggeluiden (alles zelf gesynthetiseerd) + Proost-modus.
// - Schud-om-te-gooien (optioneel) en subtiele trillingen / bord-tikjes.
// Deze module leest alleen de spelstaat en wijzigt hem nooit. Enige "duw":
// een klik op een bestaande, ingeschakelde roll-dice-knop (schudfunctie).

const SOUND_KEY = "zuipopoly.v2.feedback"; // zelfde sleutel als services/feedback.js
const MAX_PARTICLES = 150;
const TAU = Math.PI * 2;
const PALETTE = ["#ffd600", "#e8001d", "#ff2d44", "#00d4ff", "#c800ff", "#00d464", "#f0eef4", "#ffb02e"];
const GOLDS = ["#ffd600", "#ffec8a", "#fff6c9", "#ffb02e", "#ffffff"];
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const VIB = {
  six: [20, 40, 20, 40, 70],
  foam: [12, 30, 12],
  fireworks: [30, 50, 30, 50, 30, 50, 100],
  stars: [10, 25, 10, 25, 50],
  jail: [70, 30, 40, 30, 140],
  finale: [40, 60, 40, 60, 40, 60, 200],
  beers: [15, 40, 15, 40, 15]
};

const SOUNDS = [
  { id: "proost", emoji: "🥂", label: "Proost" },
  { id: "glas", emoji: "🍷", label: "Glas" },
  { id: "blik", emoji: "🥫", label: "Blikje" },
  { id: "tap", emoji: "🍺", label: "Tap" },
  { id: "sirene", emoji: "🚨", label: "Sirene" },
  { id: "trompet", emoji: "🎺", label: "Trompet" },
  { id: "lach", emoji: "😂", label: "Lachen" },
  { id: "toeter", emoji: "📯", label: "Toeter" },
  { id: "drumrol", emoji: "🥁", label: "Drumrol" },
  { id: "boer", emoji: "💨", label: "Boer" }
];

export function init(ctx) {
  ctx.loadCss(new URL("./juice.css", import.meta.url));

  const mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => Boolean(mqReduce && mqReduce.matches);

  const layer = document.createElement("div");
  layer.className = "juice-layer";
  layer.setAttribute("aria-hidden", "true");
  ctx.root.appendChild(layer);

  function later(ms, fn) {
    return window.setTimeout(() => {
      try {
        if (!document.hidden) fn();
      } catch (error) {
        console.warn("[juice]", error);
      }
    }, Math.max(0, ms));
  }

  function overlay(className, ms, html = "") {
    const el = document.createElement("div");
    el.className = className;
    if (html) el.innerHTML = html;
    layer.appendChild(el);
    window.setTimeout(() => el.remove(), ms);
    return el;
  }

  function softPop(emoji) {
    overlay("juice-soft", 1500, ctx.esc(emoji));
  }

  /* ================================================================ */
  /* Audio (eigen synth; start pas na een gebruikersgebaar)             */
  /* ================================================================ */

  let ac = null;
  let master = null;
  let noiseBuf = null;
  let unlocked = false;

  function soundOn() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(SOUND_KEY) || "{}");
      return stored.sound !== false;
    } catch {
      return true;
    }
  }

  // Voor expliciete knoppen (na gebaar): maakt de context aan en hervat hem.
  function audio() {
    if (!soundOn()) return null;
    if (!ac) {
      if (!unlocked) return null;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        ac = new Ctor();
        master = ac.createGain();
        master.gain.value = 0.9;
        const comp = ac.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ac.destination);
      } catch {
        ac = null;
        return null;
      }
    }
    if (ac.state === "suspended") ac.resume().catch(() => {});
    return ac;
  }

  // Voor achtergrondgeluidjes: alleen als de context al draait.
  function ambient() {
    if (!ac || ac.state !== "running" || !soundOn()) return null;
    return ac;
  }

  function onGesture() {
    unlocked = true;
    if (soundOn() && (!ac || ac.state !== "running")) audio();
  }
  ["pointerdown", "touchend", "click", "keydown"].forEach((name) => {
    document.addEventListener(name, onGesture, { capture: true, passive: true });
  });

  function noiseBuffer(a) {
    if (!noiseBuf) {
      const frames = Math.floor(a.sampleRate * 2.6);
      noiseBuf = a.createBuffer(1, frames, a.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // Eén oscillatortoon met envelope, optioneel filter en vibrato.
  function osc(a, T, o) {
    const t = T + (o.t || 0);
    const dur = o.dur || 0.2;
    const src = a.createOscillator();
    src.type = o.type || "sine";
    src.frequency.setValueAtTime(o.f, t);
    if (o.f2) src.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
    const gn = a.createGain();
    const att = Math.min(o.att ?? 0.005, dur * 0.5);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(o.vol ?? 0.15, t + att);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = src;
    if (o.filt) {
      const flt = a.createBiquadFilter();
      flt.type = o.filt.type;
      flt.frequency.setValueAtTime(o.filt.f, t);
      if (o.filt.f2) flt.frequency.exponentialRampToValueAtTime(o.filt.f2, t + dur * (o.filt.span || 1));
      flt.Q.value = o.filt.q || 1;
      src.connect(flt);
      node = flt;
    }
    node.connect(gn);
    gn.connect(master);
    if (o.vib) {
      const lfo = a.createOscillator();
      const lg = a.createGain();
      lfo.frequency.value = o.vib.rate;
      lg.gain.value = o.vib.depth;
      lfo.connect(lg);
      lg.connect(src.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Gefilterde ruispuls (hiss, tikjes, bekkens).
  function noise(a, T, o) {
    const t = T + (o.t || 0);
    const dur = o.dur || 0.1;
    const buf = noiseBuffer(a);
    const src = a.createBufferSource();
    src.buffer = buf;
    const flt = a.createBiquadFilter();
    flt.type = o.type || "bandpass";
    flt.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    flt.Q.value = o.q || 1;
    const gn = a.createGain();
    const att = Math.min(o.att ?? 0.003, dur * 0.5);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(o.vol ?? 0.15, t + att);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(gn);
    gn.connect(master);
    const offset = Math.random() * Math.max(0, buf.duration - dur - 0.1);
    src.start(t, offset);
    src.stop(t + dur + 0.03);
  }

  function glassClink(a, T, t, base, vol) {
    [[1, 1], [2.32, 0.55], [4.25, 0.35], [6.63, 0.2]].forEach(([m, w], i) => {
      osc(a, T, { t, type: "sine", f: base * m * rand(0.99, 1.01), dur: 1 / (i * 0.9 + 1) + 0.15, vol: vol * w, att: 0.001 });
    });
    noise(a, T, { t, dur: 0.025, vol: vol * 1.5, type: "highpass", f: 5500 });
  }

  const sfx = {
    proost() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      glassClink(a, T, 0, 2300, 0.16);
      glassClink(a, T, 0.05, 2750, 0.12);
      glassClink(a, T, 0.36, 2500, 0.07);
    },
    glas() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      osc(a, T, { type: "sine", f: 190, f2: 60, dur: 0.12, vol: 0.2 });
      noise(a, T, { dur: 0.4, vol: 0.22, type: "highpass", f: 3200, f2: 7000 });
      for (let i = 0; i < 11; i += 1) {
        osc(a, T, { t: rand(0.02, 0.6), type: "sine", f: rand(2400, 9000), dur: rand(0.08, 0.22), vol: rand(0.03, 0.07), att: 0.001 });
      }
    },
    blik() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      noise(a, T, { dur: 0.04, vol: 0.28, type: "bandpass", f: 2800, q: 2 });
      osc(a, T, { type: "square", f: 950, f2: 240, dur: 0.07, vol: 0.09 });
      noise(a, T, { t: 0.08, dur: 0.6, vol: 0.14, type: "highpass", f: 3500, f2: 6500, att: 0.02 });
      for (let i = 0; i < 9; i += 1) {
        osc(a, T, { t: 0.14 + rand(0, 0.6), type: "sine", f: rand(2800, 5200), dur: 0.025, vol: 0.03, att: 0.001 });
      }
    },
    tap() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      noise(a, T, { dur: 1.1, vol: 0.17, type: "bandpass", f: 3400, f2: 1900, q: 0.8, att: 0.09 });
      let t = 0.1;
      for (let i = 0; i < 7; i += 1) {
        const f = rand(250, 480);
        osc(a, T, { t, type: "sine", f, f2: f * 1.6, dur: 0.07, vol: 0.08 });
        t += rand(0.08, 0.15);
      }
    },
    sirene() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      const src = a.createOscillator();
      src.type = "sawtooth";
      const flt = a.createBiquadFilter();
      flt.type = "lowpass";
      flt.frequency.value = 2200;
      const gn = a.createGain();
      gn.gain.setValueAtTime(0.0001, T);
      gn.gain.linearRampToValueAtTime(0.12, T + 0.06);
      gn.gain.setValueAtTime(0.12, T + 2.0);
      gn.gain.linearRampToValueAtTime(0.0001, T + 2.4);
      src.frequency.setValueAtTime(640, T);
      for (let i = 0; i < 7; i += 1) {
        src.frequency.linearRampToValueAtTime(i % 2 === 0 ? 960 : 640, T + 0.05 + i * 0.33 + 0.28);
      }
      src.connect(flt);
      flt.connect(gn);
      gn.connect(master);
      src.start(T);
      src.stop(T + 2.45);
      if (!reduced()) overlay("juice-siren", 2500);
    },
    trompet() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      [[392, 0, 0.13], [523, 0.15, 0.13], [659, 0.3, 0.13], [784, 0.45, 0.75]].forEach(([f, t, d], i) => {
        const filt = { type: "lowpass", f: 700, f2: 2600, q: 2, span: 0.3 };
        osc(a, T, { type: "sawtooth", f, t, dur: d + 0.05, vol: 0.13, att: 0.02, filt, vib: i === 3 ? { rate: 5.5, depth: f * 0.012 } : null });
        osc(a, T, { type: "square", f: f * 1.005, t, dur: d + 0.05, vol: 0.045, att: 0.02, filt });
      });
    },
    lach() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      for (let i = 0; i < 7; i += 1) {
        const t = i * 0.125;
        const f0 = 360 - i * 14 + rand(-6, 6);
        const vol = 0.2 - i * 0.015;
        osc(a, T, { t, type: "sawtooth", f: f0, f2: f0 * 0.8, dur: 0.1, vol, att: 0.01, filt: { type: "bandpass", f: 900, q: 3 } });
        osc(a, T, { t, type: "sawtooth", f: f0, f2: f0 * 0.8, dur: 0.1, vol: vol * 0.5, att: 0.01, filt: { type: "bandpass", f: 2100, q: 3 } });
        noise(a, T, { t, dur: 0.08, vol: 0.05, type: "bandpass", f: 1500 });
      }
    },
    toeter() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      [[0, 0.2], [0.27, 0.42]].forEach(([t, d]) => {
        [349, 440].forEach((f) => {
          osc(a, T, { t, type: "square", f, f2: f * 0.97, dur: d, vol: 0.075, att: 0.01, filt: { type: "lowpass", f: 1800, q: 1 } });
        });
      });
    },
    drumrol() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      let t = 0;
      let gap = 0.09;
      let n = 0;
      while (t < 1.5) {
        const vol = 0.05 + (t / 1.5) * 0.12;
        noise(a, T, { t, dur: 0.06, vol, type: "bandpass", f: 220, q: 0.8 });
        osc(a, T, { t, type: "sine", f: 150, f2: 90, dur: 0.07, vol: vol * 0.6 });
        gap = Math.max(0.03, gap - 0.0022);
        t += gap;
        n += 1;
        if (n > 60) break;
      }
      noise(a, T, { t: 1.55, dur: 1.1, vol: 0.2, type: "highpass", f: 5500 });
      osc(a, T, { t: 1.55, type: "sine", f: 120, f2: 40, dur: 0.28, vol: 0.34 });
    },
    boer() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.03;
      osc(a, T, {
        type: "sawtooth", f: 115, f2: 58, dur: 0.65, vol: 0.3, att: 0.03,
        filt: { type: "lowpass", f: 420, q: 2 }, vib: { rate: 26, depth: 16 }
      });
      noise(a, T, { dur: 0.5, vol: 0.09, type: "lowpass", f: 320 });
    }
  };

  // Zachte achtergrondgeluidjes bij effecten (alleen als audio al draait).
  const amb = {
    whoosh() {
      const a = ambient();
      if (!a) return;
      noise(a, a.currentTime + 0.01, { dur: 0.45, vol: 0.04, type: "bandpass", f: 500, f2: 2600, q: 1, att: 0.1 });
    },
    pop() {
      const a = ambient();
      if (!a) return;
      const T = a.currentTime + 0.01;
      noise(a, T, { dur: 0.1, vol: 0.09, type: "bandpass", f: 1400, q: 0.7 });
      osc(a, T, { type: "sine", f: 130, f2: 50, dur: 0.14, vol: 0.1 });
      for (let i = 0; i < 4; i += 1) {
        osc(a, T, { t: 0.08 + rand(0, 0.35), type: "sine", f: rand(2500, 6500), dur: 0.04, vol: 0.02, att: 0.001 });
      }
    },
    shimmer() {
      const a = ambient();
      if (!a) return;
      const T = a.currentTime + 0.01;
      [2093, 2637, 3136, 4186].forEach((f, i) => {
        osc(a, T, { t: i * 0.07, type: "sine", f, dur: 0.5, vol: 0.035 });
      });
    },
    fizz() {
      const a = ambient();
      if (!a) return;
      noise(a, a.currentTime + 0.01, { dur: 0.8, vol: 0.07, type: "highpass", f: 3500, f2: 6000, att: 0.05 });
    },
    glitch() {
      const a = ambient();
      if (!a) return;
      const T = a.currentTime + 0.01;
      for (let i = 0; i < 7; i += 1) {
        const t = rand(0, 0.55);
        osc(a, T, { t, type: "square", f: rand(90, 1800), dur: 0.045, vol: 0.04, att: 0.001 });
        noise(a, T, { t, dur: 0.03, vol: 0.05, type: "highpass", f: 3000 });
      }
    },
    tick() {
      const a = ambient();
      if (!a) return;
      const T = a.currentTime + 0.005;
      noise(a, T, { dur: 0.02, vol: 0.06, type: "bandpass", f: 3600, q: 1.5 });
      osc(a, T, { type: "sine", f: 1800, f2: 1200, dur: 0.025, vol: 0.025, att: 0.001 });
    },
    clinkSoft() {
      const a = audio();
      if (!a) return;
      const T = a.currentTime + 0.01;
      glassClink(a, T, 0, rand(1900, 3200), 0.08);
      if (Math.random() < 0.3) glassClink(a, T, 0.07, rand(2100, 3300), 0.06);
    }
  };

  /* ================================================================ */
  /* Canvas-deeltjes                                                    */
  /* ================================================================ */

  let canvas = null;
  let g = null;
  let W = 0;
  let H = 0;
  let scale = 1;
  let raf = 0;
  let lastT = 0;
  const parts = [];
  const emitters = [];

  function resize() {
    if (!canvas) return;
    scale = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
  }

  function ensureCanvas() {
    if (canvas) return true;
    try {
      const el = document.createElement("canvas");
      el.className = "juice-canvas";
      el.hidden = true;
      const context2d = el.getContext("2d");
      if (!context2d) return false;
      canvas = el;
      g = context2d;
      layer.appendChild(canvas);
      resize();
      return true;
    } catch {
      canvas = null;
      g = null;
      return false;
    }
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => window.setTimeout(resize, 250));

  function wake() {
    if (!ensureCanvas() || document.hidden) return;
    if (canvas.width !== Math.round(window.innerWidth * scale)) resize();
    canvas.hidden = false;
    if (!raf) {
      lastT = performance.now();
      raf = window.requestAnimationFrame(frame);
    }
  }

  function add(p) {
    if (!ensureCanvas() || document.hidden) return;
    p.age = 0;
    p.life = p.life || 2;
    p.x0 = p.x;
    if (parts.length >= MAX_PARTICLES) {
      // Vol: vervang het oudste niet-raket-deeltje.
      const idx = parts.findIndex((q) => q.kind !== "rocket");
      if (idx < 0) return;
      parts[idx] = p;
    } else {
      parts.push(p);
    }
    wake();
  }

  function emit({ dur, rate, fn, until }) {
    if (!ensureCanvas() || document.hidden) return;
    emitters.push({ t: 0, acc: 0, dur, rate, fn, until });
    wake();
  }

  function starPath(r) {
    g.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(ang) * rad;
      const py = Math.sin(ang) * rad;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  }

  function update(p, dt) {
    if (p.drag != null) {
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy *= k;
    }
    if (p.g) p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.sway) p.x += Math.sin(p.age * p.swayF + p.ph) * p.sway * dt;
    if (p.vr) p.rot += p.vr * dt;
    if (p.fv) p.flip += p.fv * dt;
    if (p.grow) p.size += p.grow * dt;
  }

  function draw(p) {
    const rem = (p.life - p.age) / p.life;
    const fade = p.fade == null ? 0.35 : p.fade;
    let a = fade > 0 && rem < fade ? rem / fade : 1;
    a *= p.alpha == null ? 1 : p.alpha;
    if (a <= 0.01) return;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = a;
    switch (p.kind) {
      case "rect":
        g.fillStyle = p.color;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(1, Math.cos(p.flip));
        g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        g.restore();
        break;
      case "circle":
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.5, p.size), 0, TAU);
        g.fill();
        break;
      case "bubble":
        g.globalAlpha = a * 0.9;
        g.strokeStyle = "rgba(255,243,196,0.9)";
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, TAU);
        g.stroke();
        g.fillStyle = "rgba(255,236,160,0.2)";
        g.fill();
        g.fillStyle = "rgba(255,255,255,0.8)";
        g.beginPath();
        g.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, Math.max(0.8, p.size * 0.2), 0, TAU);
        g.fill();
        break;
      case "spark":
      case "rocket": {
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.lineCap = "round";
        const tail = p.kind === "rocket" ? 0.09 : 0.05;
        g.beginPath();
        g.moveTo(p.x - p.vx * tail, p.y - p.vy * tail);
        g.lineTo(p.x, p.y);
        g.stroke();
        break;
      }
      case "star": {
        const tw = 0.75 + 0.25 * Math.sin(p.age * 14 + p.ph);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = "rgba(255,214,0,0.28)";
        starPath(p.size * 1.5 * tw);
        g.fill();
        g.fillStyle = p.color;
        starPath(p.size * tw);
        g.fill();
        g.restore();
        break;
      }
      case "emoji":
        g.font = `${p.size}px ${EMOJI_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillText(p.text, 0, 0);
        g.restore();
        break;
      case "ember": {
        g.globalCompositeOperation = "lighter";
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.5, p.size * (1 - (p.age / p.life) * 0.6)), 0, TAU);
        g.fill();
        break;
      }
      case "smoke":
        g.fillStyle = "rgba(70,66,78,1)";
        g.globalAlpha = a * 0.14;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(1, p.size), 0, TAU);
        g.fill();
        break;
      case "glitter": {
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = a * (0.45 + 0.55 * Math.abs(Math.sin(p.age * p.tf + p.ph)));
        g.fillStyle = p.color;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        g.restore();
        break;
      }
      default:
        break;
    }
  }

  function frame(t) {
    raf = 0;
    if (!g) return;
    const dt = Math.min(0.05, Math.max(0.001, (t - lastT) / 1000));
    lastT = t;

    for (let i = emitters.length - 1; i >= 0; i -= 1) {
      const e = emitters[i];
      e.t += dt;
      if (e.t >= e.dur || (e.until && !e.until())) {
        emitters.splice(i, 1);
        continue;
      }
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        try {
          e.fn(e.t / e.dur);
        } catch (error) {
          console.warn("[juice]", error);
        }
      }
    }

    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life || p.y > H + 60 || p.y < -240 || p.x < -90 || p.x > W + 90) {
        parts[i] = parts[parts.length - 1];
        parts.pop();
        if (p.then) {
          try {
            p.then(p);
          } catch (error) {
            console.warn("[juice]", error);
          }
        }
        continue;
      }
      update(p, dt);
      draw(p);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;

    if (parts.length || emitters.length) {
      raf = window.requestAnimationFrame(frame);
    } else {
      g.clearRect(0, 0, W, H);
      canvas.hidden = true;
    }
  }

  function clearAll() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    parts.length = 0;
    emitters.length = 0;
    if (canvas) {
      if (g) g.clearRect(0, 0, W, H);
      canvas.hidden = true;
    }
  }

  /* ================================================================ */
  /* Effecten                                                           */
  /* ================================================================ */

  function accentColors() {
    try {
      const el = ctx.app && ctx.app.firstElementChild;
      const v = el ? getComputedStyle(el).getPropertyValue("--team-accent").trim() : "";
      if (/^#[0-9a-f]{3,8}$/i.test(v)) return [v, v, v];
    } catch {
      /* geen accentkleur: negeren */
    }
    return [];
  }

  function confettiPiece(colors, x, y, vx, vy, life, g0 = 300) {
    add({
      kind: "rect", x, y, vx, vy, g: g0, drag: 0.18, life,
      size: rand(7, 12), color: pick(colors), rot: rand(0, TAU), vr: rand(-9, 9),
      flip: rand(0, TAU), fv: rand(6, 14), fade: 0.12
    });
  }

  function confetti({ cannon = true, rain = true, power = 1 } = {}) {
    if (reduced()) return softPop("🎉");
    if (!ensureCanvas()) return;
    const colors = PALETTE.concat(accentColors());
    if (cannon) {
      for (const side of [-1, 1]) {
        const n = Math.round(22 * power);
        for (let i = 0; i < n; i += 1) {
          // Linker kanon schiet schuin rechtsomhoog, rechter schuin linksomhoog.
          const deg = side < 0 ? rand(-82, -48) : rand(-132, -98);
          const ang = (deg * Math.PI) / 180;
          const sp = rand(480, 920);
          confettiPiece(colors, side < 0 ? -6 : W + 6, H + 6, Math.cos(ang) * sp, Math.sin(ang) * sp, rand(1.8, 2.6));
        }
      }
    }
    if (rain) {
      emit({
        dur: 0.8, rate: 20 * power,
        fn: () => confettiPiece(colors, rand(0, W), -14, rand(-40, 40), rand(20, 120), rand(2.2, 3), 260)
      });
    }
  }

  // Bevestigd: een officieel zegel "GEZWOREN" slaat op het scherm, met gouden vonken.
  function stamp() {
    ctx.vibrate([18, 30, 40]);
    if (reduced()) return softPop("✔️");
    overlay(
      "juice-stamp",
      2000,
      '<div class="juice-stamp-seal"><span class="juice-stamp-big">GEZWOREN</span>' +
        "<small>Zuip-O-Poly Nijmegen · notarieel vastgelegd</small></div>"
    );
    later(170, () => {
      try {
        window.zuipFeedback?.diceLand?.();
      } catch {
        /* geluid is optioneel */
      }
      if (!ensureCanvas()) return;
      const cx = W / 2;
      const cy = H * 0.46;
      for (let i = 0; i < 34; i += 1) {
        const ang = rand(0, TAU);
        const sp = rand(120, 360);
        add({
          kind: "spark", x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 220, drag: 0.2,
          life: rand(0.7, 1.3), size: rand(1.8, 3), color: Math.random() < 0.7 ? "#ffd600" : "#ffffff", fade: 0.5
        });
      }
    });
  }
  const foam = stamp;

  function explode(x, y) {
    amb.pop();
    const c1 = pick(PALETTE);
    const c2 = Math.random() < 0.5 ? "#ffffff" : pick(PALETTE);
    const ring = Math.random() < 0.4;
    const n = 24;
    for (let i = 0; i < n; i += 1) {
      const ang = (i / n) * TAU + rand(-0.08, 0.08);
      const sp = ring ? rand(190, 215) : rand(110, 270);
      add({
        kind: "spark", x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 130, drag: 0.12,
        life: rand(0.9, 1.5), size: 2.2, color: i % 2 === 0 ? c1 : c2, fade: 0.5
      });
    }
    add({ kind: "circle", x, y, vx: 0, vy: 0, life: 0.2, size: 16, color: "rgba(255,255,255,0.8)", fade: 1 });
  }

  function launchRocket() {
    if (!ensureCanvas()) return;
    const grav = 380;
    const x = rand(W * 0.15, W * 0.85);
    const y0 = H + 8;
    const ty = rand(H * 0.14, H * 0.42);
    const vy = -Math.sqrt(2 * grav * (y0 - ty));
    amb.whoosh();
    add({
      kind: "rocket", x, y: y0, vx: rand(-30, 30), vy, g: grav, life: -vy / grav, size: 2.6,
      color: "#fff3c4", fade: 0, then: (p) => explode(p.x, p.y)
    });
  }

  function fireworks({ count = 5, spread = 1700, withConfetti = true } = {}) {
    if (reduced()) return softPop("🎆");
    ctx.vibrate(VIB.fireworks);
    const step = count > 1 ? spread / (count - 1) : 0;
    for (let i = 0; i < count; i += 1) later(i * step + rand(0, 150), launchRocket);
    if (withConfetti) later(Math.min(900, spread * 0.5), () => confetti({ cannon: false, rain: true, power: 0.7 }));
  }

  function finale() {
    ctx.vibrate(VIB.finale);
    if (reduced()) return softPop("🏆");
    fireworks({ count: 12, spread: 5200, withConfetti: false });
    confetti({ cannon: true, rain: false, power: 1 });
    later(1200, () => confetti({ cannon: false, rain: true, power: 0.8 }));
    later(3000, () => confetti({ cannon: true, rain: false, power: 0.8 }));
    later(4200, () => confetti({ cannon: false, rain: true, power: 0.8 }));
  }

  function beersRain() {
    ctx.vibrate(VIB.beers);
    if (reduced()) return softPop("🐻");
    if (!ensureCanvas()) return;
    const list = ["🐻", "🍺", "🍻", "🐻", "🍺"];
    emit({
      dur: 2.4, rate: 11,
      fn: () => add({
        kind: "emoji", text: pick(list), x: rand(10, W - 10), y: -30, vx: rand(-20, 20), vy: rand(130, 230),
        sway: rand(10, 25), swayF: rand(2, 4), ph: rand(0, TAU), size: rand(26, 42), rot: rand(-0.5, 0.5),
        vr: rand(-2, 2), life: 7, fade: 0
      })
    });
  }

  function stars() {
    ctx.vibrate(VIB.stars);
    amb.shimmer();
    if (reduced()) return softPop("⭐");
    if (!ensureCanvas()) return;
    overlay("juice-gold", 1100);
    const cx = W / 2;
    const cy = H * 0.42;
    for (let i = 0; i < 20; i += 1) {
      const ang = rand(0, TAU);
      const sp = rand(140, 340);
      add({
        kind: "star", x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 150, drag: 0.22,
        life: rand(1.2, 2.0), size: rand(7, 15), color: pick(GOLDS), rot: rand(0, TAU), vr: rand(-4, 4), ph: rand(0, TAU)
      });
    }
    for (let i = 0; i < 16; i += 1) {
      const ang = rand(0, TAU);
      const sp = rand(60, 260);
      add({
        kind: "glitter", x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 90, drag: 0.3,
        life: rand(0.9, 1.6), size: rand(2, 4), color: pick(GOLDS), rot: Math.PI / 4, tf: rand(14, 24), ph: rand(0, TAU)
      });
    }
  }

  function flames() {
    if (!ensureCanvas()) return;
    overlay("juice-fire", 2900);
    const colors = ["#ff3d00", "#ff7a00", "#ffb02e", "#e8001d"];
    emit({
      dur: 2.2, rate: 45,
      fn: () => add({
        kind: "ember", x: rand(0, W), y: H + 5, vx: rand(-30, 30), vy: -rand(120, 340), drag: 0.6,
        life: rand(0.7, 1.5), size: rand(5, 13), color: pick(colors), fade: 0.5
      })
    });
    emit({
      dur: 1.6, rate: 5,
      fn: () => add({
        kind: "smoke", x: rand(0, W), y: rand(H * 0.6, H), vx: rand(-15, 15), vy: -rand(40, 90),
        life: rand(1.2, 1.8), size: 12, grow: 20, fade: 0.6
      })
    });
  }

  function jailFx() {
    ctx.vibrate(VIB.jail);
    amb.glitch();
    if (reduced()) {
      overlay("juice-fire", 2900);
      softPop("🔒");
      return;
    }
    const colors = ["rgba(255,45,68,0.55)", "rgba(0,212,255,0.45)", "rgba(255,255,255,0.25)"];
    let bars = "";
    for (let i = 0; i < 7; i += 1) {
      const dx = Math.round(rand(10, 40)) * (Math.random() < 0.5 ? -1 : 1);
      bars += `<i class="juice-glitch-bar" style="--y:${rand(0, 95).toFixed(1)}%;--h:${rand(2, 9).toFixed(1)}%;--dx:${dx}px;--c:${pick(colors)};--d:${rand(0, 0.6).toFixed(2)}s"></i>`;
    }
    overlay(
      "juice-glitch",
      1700,
      `${bars}<div class="juice-glitch-text">GA NAAR DE CEL<small>SIGNAAL VERLOREN · KEIZER KARELPLEIN</small></div>`
    );
    later(450, flames);
  }

  function emojiBurst(x, y, emojis, n = 10) {
    if (reduced()) return;
    if (!ensureCanvas()) return;
    for (let i = 0; i < n; i += 1) {
      const ang = rand(0, TAU);
      const sp = rand(160, 380);
      add({
        kind: "emoji", text: pick(emojis), x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 90, g: 520, drag: 0.35,
        size: rand(20, 32), rot: rand(-0.6, 0.6), vr: rand(-4, 4), life: rand(0.9, 1.4), fade: 0.4
      });
    }
  }

  /* ================================================================ */
  /* Proost-knop + menu                                                 */
  /* ================================================================ */

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "juice-btn";
  btn.textContent = "🍻";
  btn.setAttribute("aria-label", "Proost-knop: tik voor kroeggeluiden, houd ingedrukt voor Proost-modus");
  btn.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "juice-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Kroeggeluiden");

  const motionSupported = typeof window.DeviceMotionEvent !== "undefined";
  const touchDevice = (navigator.maxTouchPoints || 0) > 0 || Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const shakeAvailable = motionSupported && touchDevice;

  panel.innerHTML = `
    <div class="juice-panel-head"><strong>Kroeggeluiden</strong><button type="button" class="juice-x" data-juice="close" aria-label="Sluiten">×</button></div>
    <div class="juice-grid">
      ${SOUNDS.map((s, i) => `<button type="button" class="juice-snd" data-sound="${s.id}" style="--i:${i}"><span class="juice-snd-emoji">${s.emoji}</span><span class="juice-snd-label">${ctx.esc(s.label)}</span></button>`).join("")}
    </div>
    ${shakeAvailable ? `
    <div class="juice-row">
      <span>📳 Schud om te gooien</span>
      <button type="button" class="juice-switch" role="switch" aria-checked="false" aria-label="Schud om te gooien" data-juice="shake"><i></i></button>
    </div>` : ""}
    <p class="juice-hint">Houd 🍻 ingedrukt voor <b>Proost-modus</b>.</p>
    <p class="juice-hint juice-mute" hidden>🔇 Geluid staat uit. Zet het aan bij instellingen.</p>
  `;
  // De kroeggeluiden-knop (🍻) en het geluidsmenu staan bewust niet meer in de app:
  // btn en panel worden niet aan de pagina gehangen. De schud-uitnodiging werkt los daarvan.

  const muteHint = panel.querySelector(".juice-mute");
  const shakeSwitch = panel.querySelector('[data-juice="shake"]');
  let menuOpen = false;

  function setMenu(open) {
    menuOpen = open;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      if (muteHint) muteHint.hidden = soundOn();
      syncShakeUi();
    }
  }
  function toggleMenu() {
    onGesture();
    setMenu(!menuOpen);
    if (menuOpen) {
      const r = btn.getBoundingClientRect();
      emojiBurst(r.left + r.width / 2, r.top + r.height / 2, ["🍻", "🍺", "🥂"], 7);
      ctx.vibrate(10);
    }
  }

  function playSound(id, fromEl) {
    onGesture();
    const fn = sfx[id];
    if (typeof fn === "function") {
      try {
        fn();
      } catch (error) {
        console.warn("[juice] geluid mislukt", error);
      }
    }
    ctx.vibrate(12);
    if (muteHint) muteHint.hidden = soundOn();
    const def = SOUNDS.find((s) => s.id === id);
    if (fromEl && def) {
      const r = fromEl.getBoundingClientRect();
      emojiBurst(r.left + r.width / 2, r.top + r.height / 2, [def.emoji, def.emoji, "✨"], 9);
    }
  }

  panel.addEventListener("click", (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const snd = target.closest("[data-sound]");
    if (snd) {
      playSound(snd.dataset.sound, snd);
      return;
    }
    if (target.closest('[data-juice="close"]')) {
      setMenu(false);
      return;
    }
    if (target.closest('[data-juice="shake"]')) {
      setShake(shakeStore.get() !== "on");
    }
  });

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (menuOpen && !panel.contains(event.target) && !btn.contains(event.target)) setMenu(false);
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuOpen) setMenu(false);
  });

  // Proost-modus: vasthouden = gouden glitter + klinkgeluiden.
  let proostOn = false;
  let holdTimer = 0;
  let holding = false;
  let proostTimer = 0;
  let proostRun = 0;

  function startProost() {
    if (proostOn) return;
    proostOn = true;
    setMenu(false);
    btn.classList.add("is-holding");
    layer.classList.add("is-proost");
    ctx.vibrate(15);
    amb.clinkSoft();
    proostTimer = window.setInterval(() => {
      amb.clinkSoft();
      ctx.vibrate(8);
    }, 300);
    const run = ++proostRun;
    if (!reduced()) {
      emit({
        dur: 60, rate: 55, until: () => proostOn && proostRun === run,
        fn: () => add({
          kind: "glitter", x: rand(0, W), y: rand(-10, H * 0.25), vx: rand(-25, 25), vy: rand(120, 320),
          sway: rand(6, 20), swayF: rand(2, 5), ph: rand(0, TAU), size: rand(3, 7), color: pick(GOLDS),
          rot: Math.PI / 4, vr: rand(-3, 3), tf: rand(10, 22), life: 1.8, fade: 0.3
        })
      });
    }
    // Veiligheidsstop als loslaten ooit gemist wordt.
    window.setTimeout(() => {
      if (proostOn) stopProost();
    }, 30000);
  }

  function stopProost() {
    if (!proostOn) return;
    proostOn = false;
    window.clearInterval(proostTimer);
    proostTimer = 0;
    btn.classList.remove("is-holding");
    layer.classList.remove("is-proost");
  }

  btn.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    onGesture();
    try {
      btn.setPointerCapture(event.pointerId);
    } catch {
      /* geen pointer capture: loslaten buiten de knop kan dan gemist worden; veiligheidsstop vangt dat op */
    }
    holding = false;
    window.clearTimeout(holdTimer);
    btn.classList.add("is-down");
    holdTimer = window.setTimeout(() => {
      holding = true;
      startProost();
    }, 420);
  });
  const release = (cancelled) => {
    window.clearTimeout(holdTimer);
    btn.classList.remove("is-down");
    if (holding) {
      holding = false;
      stopProost();
      return;
    }
    if (!cancelled) toggleMenu();
  };
  btn.addEventListener("pointerup", () => release(false));
  btn.addEventListener("pointercancel", () => release(true));
  btn.addEventListener("click", (event) => {
    if (event.detail === 0) toggleMenu(); // toetsenbord (Enter/spatie)
  });
  btn.addEventListener("contextmenu", (event) => event.preventDefault());

  /* ================================================================ */
  /* Schud om te gooien                                                 */
  /* ================================================================ */

  const shakeStore = ctx.store("shake", null); // "on" | "off" | null (nog niet gekozen)
  const askedStore = ctx.store("shakeAsked", false);
  let shakeListening = false;
  let spikes = [];
  let lastSpike = 0;
  let lastShakeAt = 0;

  function tryRoll() {
    if (document.hidden) return;
    const team = ctx.myTeam();
    if (!team || team.status !== ctx.TEAM_STATUS.CAN_ROLL) return;
    if (document.querySelector(".popup-overlay")) return;
    if (ctx.root.querySelector(".aw-overlay,.egg-overlay,.egg-sheet")) return;
    const rollBtn = document.querySelector('[data-action="roll-dice"]');
    if (!rollBtn || rollBtn.disabled || rollBtn.offsetParent === null) return;
    if (rollBtn.dataset.teamId && String(rollBtn.dataset.teamId) !== String(team.id)) return;
    ctx.vibrate(25);
    rollBtn.click();
  }

  function onMotion(event) {
    let m;
    const lin = event.acceleration;
    if (lin && lin.x != null) {
      m = Math.hypot(lin.x, lin.y, lin.z);
    } else {
      const grav = event.accelerationIncludingGravity;
      if (!grav || grav.x == null) return;
      m = Math.abs(Math.hypot(grav.x, grav.y, grav.z) - 9.81);
    }
    const now = Date.now();
    if (m > 14 && now - lastSpike > 120) {
      lastSpike = now;
      spikes.push(now);
    }
    spikes = spikes.filter((t) => now - t < 1000);
    if (spikes.length >= 4 && now - lastShakeAt > 3000) {
      spikes = [];
      lastShakeAt = now;
      tryRoll();
    }
  }

  function attachShake() {
    if (shakeListening) return;
    window.addEventListener("devicemotion", onMotion);
    shakeListening = true;
  }
  function detachShake() {
    window.removeEventListener("devicemotion", onMotion);
    shakeListening = false;
    spikes = [];
  }

  function syncShakeUi() {
    if (!shakeSwitch) return;
    const on = shakeStore.get() === "on";
    shakeSwitch.setAttribute("aria-checked", on ? "true" : "false");
    shakeSwitch.classList.toggle("is-on", on);
  }

  // Let op: requestPermission moet synchroon in de klik worden aangeroepen.
  async function setShake(on) {
    if (!on) {
      detachShake();
      shakeStore.set("off");
      syncShakeUi();
      return false;
    }
    if (!shakeAvailable) {
      ctx.toast("📳 Dit toestel heeft geen bewegingssensor.");
      return false;
    }
    if (typeof window.DeviceMotionEvent.requestPermission === "function") {
      try {
        const answer = await window.DeviceMotionEvent.requestPermission();
        if (answer !== "granted") {
          shakeStore.set("off");
          syncShakeUi();
          ctx.toast("📳 Geen toestemming. Gooi gewoon met de knop.");
          return false;
        }
      } catch {
        shakeStore.set("off");
        syncShakeUi();
        return false;
      }
    }
    attachShake();
    shakeStore.set("on");
    syncShakeUi();
    ctx.vibrate(20);
    ctx.toast("📳 Schud je telefoon om te gooien!");
    return true;
  }

  if (shakeAvailable && shakeStore.get() === "on") attachShake();

  // Eenmalige, weigerbare uitnodiging zodra er voor het eerst gegooid mag worden.
  let inviteEl = null;
  function maybeInvite(team) {
    if (inviteEl || !shakeAvailable || shakeStore.get() !== null || askedStore.get()) return;
    if (!team || team.status !== ctx.TEAM_STATUS.CAN_ROLL) return;
    askedStore.set(true);
    later(900, () => {
      inviteEl = document.createElement("div");
      inviteEl.className = "juice-invite";
      inviteEl.innerHTML = `
        <p>📳 Zin om te <b>schudden</b> in plaats van tikken? Schud je telefoon om te gooien.</p>
        <div class="juice-invite-actions">
          <button type="button" class="juice-yes" data-invite="yes">Ja, schud!</button>
          <button type="button" class="juice-no" data-invite="no">Nee, dank</button>
        </div>`;
      ctx.root.appendChild(inviteEl);
      const close = () => {
        if (!inviteEl) return;
        inviteEl.remove();
        inviteEl = null;
      };
      inviteEl.addEventListener("click", (event) => {
        const t = event.target.closest && event.target.closest("[data-invite]");
        if (!t) return;
        if (t.dataset.invite === "yes") setShake(true);
        else {
          shakeStore.set("off");
          syncShakeUi();
        }
        close();
      });
      window.setTimeout(close, 15000);
    });
  }

  /* ================================================================ */
  /* Bord-tik + bevestiging                                             */
  /* ================================================================ */

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      if (target.closest(".board-cell")) {
        amb.tick();
        ctx.vibrate(6);
        return;
      }
      const confirmBtn = target.closest('[data-action="confirm-task"],[data-action="confirm-task-bonus"]');
      if (confirmBtn && !confirmBtn.disabled && /gedaan/i.test(confirmBtn.textContent || "")) {
        later(60, foam);
      }
    },
    true
  );

  /* ================================================================ */
  /* Momenten uit de spelstaat                                          */
  /* ================================================================ */

  const WALK_STEP_MS = ctx.TURBO ? 160 : 520; // gelijk aan main.js (bij benadering)
  const DICE_REVEAL_MS = ctx.TURBO ? 450 : 1700;

  function walkDelay(move) {
    const steps = Math.abs(Number(move && move.steps));
    if (!Number.isFinite(steps) || steps === 0) return 150;
    const reveal = move.source === "roll" || move.source === "bonus_roll" ? DICE_REVEAL_MS : 0;
    return reveal + steps * WALK_STEP_MS + 150;
  }

  const finaleDone = new Set();
  function finaleOnce() {
    const s = ctx.getState();
    const key = `${s && s.roomCode}:${s && s.endedAt}`;
    if (finaleDone.has(key)) return;
    finaleDone.add(key);
    later(450, finale);
  }

  let prev = null;
  function snapshot(state, team) {
    return {
      room: (state && state.roomCode) || null,
      teamId: (team && team.id) || null,
      phase: (state && state.phase) || null,
      status: (team && team.status) || null,
      movedAt: (team && team.lastMove && team.lastMove.movedAt) || 0,
      rounds: (team && team.completedRounds) || 0,
      powerIds: new Set(((team && team.savedPowerUps) || []).map((p) => p.id))
    };
  }

  function onState(state) {
    try {
      const team = ctx.myTeam();
      const cur = snapshot(state, team);
      if (!prev || prev.room !== cur.room || prev.teamId !== cur.teamId) {
        prev = cur; // basislijn: niets nabootsen bij laden/hervatten
        maybeInvite(team);
        return;
      }
      const before = prev;
      prev = cur;
      if (!team) return;

      const move = team.lastMove;
      const newMove = Boolean(move) && cur.movedAt > before.movedAt;
      const delay = newMove ? walkDelay(move) : 150;

      if (newMove && (move.source === "roll" || move.source === "bonus_roll") && (move.roll ?? team.lastRoll) === 6) {
        later(350, () => {
          ctx.vibrate(VIB.six);
          confetti({ cannon: true, rain: true, power: 1 });
        });
      }

      const crossed = (newMove && (move.crossedStart || move.roundsGained > 0)) || cur.rounds > before.rounds;
      if (crossed) later(delay + 200, () => fireworks({ count: 4, spread: 1500 }));

      if (newMove && move.source !== "attack") {
        const tile = ctx.findTileById(move.to);
        if (tile && tile.type === "Vast speciaal vak") later(delay + 100, beersRain);
      }

      if (cur.status === ctx.TEAM_STATUS.IN_JAIL && before.status !== ctx.TEAM_STATUS.IN_JAIL) {
        later(newMove ? delay : 120, jailFx);
      }

      for (const id of cur.powerIds) {
        if (!before.powerIds.has(id)) {
          later(newMove ? delay : 100, stars);
          break;
        }
      }

      const ended =
        (cur.phase === ctx.GAME_PHASE.ENDED && before.phase !== ctx.GAME_PHASE.ENDED) ||
        (cur.status === ctx.TEAM_STATUS.GAME_OVER && before.status !== ctx.TEAM_STATUS.GAME_OVER);
      if (ended) finaleOnce();

      maybeInvite(team);
    } catch (error) {
      console.warn("[juice] state-detectie mislukt", error);
    }
  }

  // Vangnet: eindscherm verschijnt (ook bij laden in een afgelopen spel).
  if (ctx.app && typeof MutationObserver !== "undefined") {
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        try {
          if (ctx.app.querySelector(".screen-ended")) finaleOnce();
        } catch {
          /* negeren */
        }
      });
    });
    observer.observe(ctx.app, { childList: true });
  }

  // Geladen in een al afgelopen spel: toch even feest.
  later(900, () => {
    if (ctx.app && ctx.app.querySelector(".screen-ended")) finaleOnce();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopProost();
      clearAll();
    }
  });
  window.addEventListener("blur", stopProost);

  /* ================================================================ */
  /* Testhaakjes                                                        */
  /* ================================================================ */

  window.zuipFx = window.zuipFx || {};
  // Schud-om-te-gooien: de instellingen van de app (⚙) laten dit aan- en uitzetten.
  window.zuipFx.shake = {
    available: shakeAvailable,
    isOn: () => shakeStore.get() === "on",
    set: (on) => setShake(Boolean(on))
  };
  Object.assign(window.zuipFx, {
    fireworks: (opts) => fireworks(opts),
    confetti: (opts) => confetti(opts),
    foam: () => foam(),
    beers: () => beersRain(),
    jail: () => jailFx(),
    stars: () => stars(),
    finale: () => finale(),
    sound: (id) => {
      unlocked = true;
      playSound(id, null);
    }
  });

  ctx.subscribe(onState);
}
