const reviewStatus = "TE KEUREN";
const busyStatuses = ["Opdracht bezig", "Afgekeurd"];
const finishedStatus = "Spel afgelopen";

function getCardStatus(card) {
  const statusNode = card.querySelector(".team-card-top p");
  return statusNode?.textContent?.trim() ?? "";
}

function renderBadge(status) {
  const className = status === reviewStatus
    ? "is-review"
    : busyStatuses.includes(status)
      ? "is-busy"
      : status === finishedStatus
        ? "is-finished"
        : "is-neutral";

  return `<strong class="status-badge ${className}">${status}</strong>`;
}

function enhanceCouncilScreen() {
  const screen = document.querySelector(".council-screen");
  const teamList = screen?.querySelector(".team-list");
  const commandPanel = screen?.querySelector(":scope > .panel");

  if (!screen || !teamList || !commandPanel || commandPanel.dataset.polished === "true") {
    return;
  }

  commandPanel.dataset.polished = "true";
  commandPanel.classList.add("council-command");

  const cards = [...teamList.querySelectorAll(".council-card")];
  const reviewCount = cards.filter((card) => card.classList.contains("needs-review")).length;
  const busyCount = cards.filter((card) => busyStatuses.includes(getCardStatus(card))).length;
  const finishedCount = cards.filter((card) => getCardStatus(card) === finishedStatus).length;

  commandPanel.querySelector("h2")?.insertAdjacentHTML("afterend", `
    <div class="council-live-summary">
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
    <div class="${reviewCount ? "council-alert" : "council-empty-review"}">
      ${
        reviewCount
          ? `Er ${reviewCount === 1 ? "staat" : "staan"} ${reviewCount} ${reviewCount === 1 ? "team" : "teams"} klaar voor keuring.`
          : "Geen open keuringen. Zodra bewijs klaarstaat springt het team bovenaan."
      }
    </div>
  `);

  for (const card of cards) {
    const status = getCardStatus(card);
    const titleBlock = card.querySelector(".team-card-top div");
    if (titleBlock && !card.querySelector(".status-badge")) {
      titleBlock.insertAdjacentHTML("afterend", renderBadge(status));
    }
  }
}

const observer = new MutationObserver(enhanceCouncilScreen);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceCouncilScreen();
