import { DOCK17_DRINKS, getTileAssignment } from "./tileAssignments.js";

export const REJECTION_PENALTY =
  "Niet door de Kroegraad gekomen. Twee teamleden trekken als straf een koolzuurhoudend drankje van minimaal 330 ml. Stuur eerst bewijs van deze straf. Pas nadat de Kroegraad dit strafbewijs heeft goedgekeurd, doen jullie dezelfde opdracht opnieuw.";

function cleanPlaceholder(value) {
  const text = String(value ?? "").trim();
  return text === "-" ? "" : text;
}

export function createTaskForTile(tile) {
  const assignment = getTileAssignment(tile.id);

  if (assignment) {
    const teamText = cleanPlaceholder(assignment.teamText);
    const popup = cleanPlaceholder(assignment.popup);
    const kroegraadSummary = cleanPlaceholder(assignment.kroegraadSummary);
    const rules = cleanPlaceholder(assignment.rules);
    const location = cleanPlaceholder(assignment.location);
    const safePopup =
      tile.id === 31
        ? "Jullie zitten in de cel. Wacht 4 minuten. Daarna krijgen jullie de Keizer Karelplein-opdracht."
        : popup;

    return {
      title: location || tile.name,
      tileName: tile.name,
      location,
      popup: safePopup,
      body:
        teamText ||
        `${tile.type} is nog niet verder ingevuld. Meld dit even bij de Kroegraad.`,
      reviewBody: kroegraadSummary || teamText || "Geen samenvatting ingevuld.",
      reviewExtra:
        tile.id === 32
          ? `Dock17 lijst: ${DOCK17_DRINKS.map((item) => `${item.id}. ${item.drink}`).join(" | ")}`
          : "",
      actionUrl: "",
      actionLabel: "",
      rules,
      placeholder: !teamText,
      presentation: tile.type === "Snackstation" ? "snack" : tile.id === 21 ? "parking" : "task"
    };
  }

  return {
    title: tile.name,
    tileName: tile.name,
    location: "",
    popup: "",
    body: `${tile.type} is nog niet verder ingevuld. Meld dit even bij de Kroegraad.`,
    reviewBody: "Geen samenvatting ingevuld.",
    rules: "",
    placeholder: true,
    presentation: "task"
  };
}
