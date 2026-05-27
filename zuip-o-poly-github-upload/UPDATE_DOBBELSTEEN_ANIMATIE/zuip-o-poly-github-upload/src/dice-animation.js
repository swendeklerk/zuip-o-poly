const rollDurationMs = 950;
const tickMs = 72;
let activeRoll = null;

function randomFace() {
  return Math.floor(Math.random() * 6) + 1;
}

function setDieFace(die, face) {
  die.classList.remove("die-1", "die-2", "die-3", "die-4", "die-5", "die-6");
  die.classList.add(`die-${face}`);
}

function findRollElements(button) {
  const panel = button.closest(".dice-panel");
  return {
    panel,
    die: panel?.querySelector(".die")
  };
}

document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest('[data-action="roll-dice"]');
    if (!button || button.disabled) {
      return;
    }

    if (button.dataset.rollAnimationReady === "true") {
      delete button.dataset.rollAnimationReady;
      return;
    }

    const { panel, die } = findRollElements(button);
    if (!panel || !die || activeRoll) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    activeRoll = button;
    const originalText = button.textContent;
    button.textContent = "Rollen...";
    button.disabled = true;
    panel.classList.add("is-rolling");
    die.classList.add("is-rolling");

    const interval = window.setInterval(() => {
      setDieFace(die, randomFace());
    }, tickMs);

    window.setTimeout(() => {
      window.clearInterval(interval);
      setDieFace(die, randomFace());
      panel.classList.remove("is-rolling");
      die.classList.remove("is-rolling");

      if (button.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
        button.dataset.rollAnimationReady = "true";
        button.click();
      }

      activeRoll = null;
    }, rollDurationMs);
  },
  true
);
