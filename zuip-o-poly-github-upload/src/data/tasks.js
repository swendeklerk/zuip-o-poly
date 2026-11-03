import { TASK_TIMERS } from "./gameConfig.js";
import { getTileAssignment } from "./tileAssignments.js";

function cleanPlaceholder(value) {
  const text = String(value ?? "").trim();
  return text === "-" ? "" : text;
}

export function getTimerSeconds(timerType) {
  return TASK_TIMERS[timerType] ?? 0;
}

export function createTaskForTile(tile) {
  const assignment = getTileAssignment(tile.id);

  if (assignment) {
    const teamText = cleanPlaceholder(assignment.teamText);
    const popup = cleanPlaceholder(assignment.popup);
    const rules = cleanPlaceholder(assignment.rules);
    const location = cleanPlaceholder(assignment.location);

    return {
      title: location || tile.name,
      tileName: tile.name,
      location,
      popup,
      body: teamText || `${tile.type} heeft nog geen opdrachttekst.`,
      rules,
      placeholder: !teamText,
      timerSeconds: getTimerSeconds(assignment.timerType),
      bonusPowerUp: assignment.bonusPowerUp ?? null,
      skippable: true,
      presentation:
        tile.type === "Snackstation" ? "snack" : tile.id === 21 ? "parking" : "task"
    };
  }

  return {
    title: tile.name,
    tileName: tile.name,
    location: "",
    popup: "",
    body: `${tile.type} heeft nog geen opdrachttekst.`,
    rules: "",
    placeholder: true,
    timerSeconds: 0,
    bonusPowerUp: null,
    skippable: true,
    presentation: "task"
  };
}
