const isTurbo = (() => {
  try {
    // ?turbo=1/0 in de URL wint van de opgeslagen waarde (die wordt pas later
    // door de modules weggeschreven).
    const param = new URLSearchParams(window.location.search).get("turbo");
    if (param === "1" || param === "0") {
      return param === "1";
    }
    return window.localStorage.getItem("zuipopoly.turbo") === "1";
  } catch {
    return false;
  }
})();
const rollDurationMs = isTurbo ? 850 : 2200;
let activeRollTeamId = null;

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

    // De uitkomst staat vast zodra je gooit; de steen tolt er naartoe en landt
    // op precies die zijde. De store krijgt dezelfde waarde mee.
    const roll = Math.floor(Math.random() * 6) + 1;
    die.classList.remove("die-1", "die-2", "die-3", "die-4", "die-5", "die-6");
    die.classList.add(`die-${roll}`);

    activeRollTeamId = teamId;
    const originalText = button.textContent;
    button.textContent = "Rollen...";
    button.disabled = true;
    panel.classList.add("is-rolling");
    die.classList.add("is-rolling");

    window.zuipFeedback?.diceStart();
    window.zuipFeedback?.diceRattle();

    // Rammel-ticks versnellen aan het begin en vertragen naar het einde, zodat
    // de steen 'uittolt'. De 3D-kubus tolt zelf via CSS (dieTumble).
    let elapsed = 0;
    let faceTimer = null;
    const tick = () => {
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
        currentButton.dataset.roll = String(roll);
        currentButton.click();
      }

      activeRollTeamId = null;
    }, rollDurationMs);
  },
  true
);
