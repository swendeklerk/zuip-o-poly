const rollDurationMs = 1100;
let activeRollTeamId = null;

function randomFace() {
  return Math.floor(Math.random() * 6) + 1;
}

function setDieFace(die, face) {
  die.classList.remove("die-1", "die-2", "die-3", "die-4", "die-5", "die-6");
  die.classList.add(`die-${face}`);
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

    const panel = button.closest(".dice-panel");
    const die = panel?.querySelector(".die");
    const teamId = button.dataset.teamId;

    if (!panel || !die || activeRollTeamId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    activeRollTeamId = teamId;
    const originalText = button.textContent;
    button.textContent = "Rollen...";
    button.disabled = true;
    panel.classList.add("is-rolling");
    die.classList.add("is-rolling");

    window.zuipFeedback?.diceStart();
    window.zuipFeedback?.diceRattle();

    // Face-swaps versnellen aan het begin en vertragen naar het einde, zodat
    // de steen 'uittolt' in plaats van mechanisch te knipperen.
    let elapsed = 0;
    let faceTimer = null;
    const tick = () => {
      setDieFace(die, randomFace());
      window.zuipFeedback?.diceRattle();
      const progress = Math.min(elapsed / rollDurationMs, 1);
      const delay = 40 + progress * progress * 150;
      elapsed += delay;
      if (elapsed < rollDurationMs - 80) {
        faceTimer = window.setTimeout(tick, delay);
      }
    };
    tick();

    window.setTimeout(() => {
      window.clearTimeout(faceTimer);
      panel.classList.remove("is-rolling");
      die.classList.remove("is-rolling");
      window.zuipFeedback?.diceLand();

      const currentButton = document.querySelector(
        `[data-action="roll-dice"][data-team-id="${teamId}"]`
      );

      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = originalText;
        currentButton.dataset.rollAnimationReady = "true";
        currentButton.click();
      }

      activeRollTeamId = null;
    }, rollDurationMs);
  },
  true
);
