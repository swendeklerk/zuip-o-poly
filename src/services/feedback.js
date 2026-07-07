// Geluid + trilling. Alle geluidjes worden zelf gegenereerd via de Web Audio
// API — geen bestanden nodig. Instellingen (aan/uit) staan in localStorage.
// dice-animation.js is een classic script en gebruikt window.zuipFeedback.

const SETTINGS_KEY = "zuipopoly.v2.feedback";

let ctx = null;
let settings = loadSettings();

function loadSettings() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}");
    return { sound: true, vibration: true, ...stored };
  } catch {
    return { sound: true, vibration: true };
  }
}

export function getFeedbackSettings() {
  return { ...settings };
}

export function setFeedbackSetting(key, value) {
  settings = { ...settings, [key]: Boolean(value) };
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (key === "sound" && value) {
    // Even een tik zodat de browser de audiocontext ontgrendelt.
    feedback.tap();
  }
}

function audioContext() {
  if (!settings.sound) {
    return null;
  }
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// Eén toon met optionele frequentiesweep en volume-envelope.
function tone({ freq = 440, freqEnd = null, dur = 0.15, type = "sine", vol = 0.18, delay = 0, attack = 0.005 }) {
  const audio = audioContext();
  if (!audio) {
    return;
  }
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), start + dur);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Korte ruispuls voor 'klik'/'rammel'-achtige geluiden.
function noiseBurst({ dur = 0.06, vol = 0.15, delay = 0, filterFreq = 1800 }) {
  const audio = audioContext();
  if (!audio) {
    return;
  }
  const start = audio.currentTime + delay;
  const frames = Math.floor(audio.sampleRate * dur);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start(start);
  src.stop(start + dur + 0.02);
}

export function vibrate(pattern) {
  if (settings.vibration && typeof navigator !== "undefined" && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // sommige browsers gooien bij ongeldige patronen
    }
  }
}

export const feedback = {
  // UI-tik
  tap() {
    noiseBurst({ dur: 0.03, vol: 0.08, filterFreq: 2600 });
  },

  // Rammelende dobbelsteen (per tick tijdens de worp-animatie; alleen geluid)
  diceRattle() {
    noiseBurst({ dur: 0.045, vol: 0.1, filterFreq: 1400 + Math.random() * 900 });
  },

  // Start van de worp (één korte buzz)
  diceStart() {
    vibrate(18);
  },

  // Dobbelsteen landt
  diceLand() {
    tone({ freq: 180, freqEnd: 90, dur: 0.18, type: "square", vol: 0.16 });
    noiseBurst({ dur: 0.08, vol: 0.14, filterFreq: 900 });
    vibrate(30);
  },

  // Stap van de pion over het bord
  step() {
    tone({ freq: 520, dur: 0.05, type: "triangle", vol: 0.09 });
  },

  // Kaart wordt getrokken/omgedraaid
  cardFlip(kind = "chance") {
    noiseBurst({ dur: 0.14, vol: 0.12, filterFreq: 2400 });
    const base = kind === "fund" ? 300 : 240;
    tone({ freq: base, freqEnd: base * 2.4, dur: 0.22, type: "sawtooth", vol: 0.12, delay: 0.05 });
    vibrate(20);
  },

  // Opdracht bevestigd
  confirm() {
    tone({ freq: 523, dur: 0.1, type: "sine", vol: 0.16 });
    tone({ freq: 784, dur: 0.14, type: "sine", vol: 0.16, delay: 0.09 });
    vibrate(25);
  },

  // Geraakt door een ander team
  hit() {
    tone({ freq: 300, freqEnd: 70, dur: 0.35, type: "sawtooth", vol: 0.2 });
    noiseBurst({ dur: 0.2, vol: 0.18, filterFreq: 500 });
    vibrate([60, 40, 120]);
  },

  // Power-up verdiend/ingezet
  powerup() {
    tone({ freq: 660, dur: 0.09, type: "square", vol: 0.14 });
    tone({ freq: 880, dur: 0.09, type: "square", vol: 0.14, delay: 0.08 });
    tone({ freq: 1320, dur: 0.14, type: "square", vol: 0.14, delay: 0.16 });
    vibrate(30);
  },

  // Naar de cel
  jail() {
    tone({ freq: 160, dur: 0.25, type: "square", vol: 0.18 });
    tone({ freq: 120, dur: 0.3, type: "square", vol: 0.18, delay: 0.12 });
    vibrate([40, 30, 40]);
  },

  // Countdown-tik
  countdownTick(last = false) {
    tone({ freq: last ? 880 : 440, dur: last ? 0.25 : 0.08, type: "square", vol: 0.14 });
  },

  // Winnaar
  win() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, index) => {
      tone({ freq, dur: 0.18, type: "square", vol: 0.16, delay: index * 0.14 });
    });
    vibrate([50, 40, 50, 40, 120]);
  }
};

if (typeof window !== "undefined") {
  window.zuipFeedback = feedback;
}
