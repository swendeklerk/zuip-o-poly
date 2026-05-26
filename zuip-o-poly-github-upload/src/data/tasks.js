const FIXED_TASKS_BY_TILE_ID = {
  5: "Het team neemt een grote fles ICE. Bewijs via WhatsApp. Na goedkeuring mag het team verder.",
  13: "Jullie hebben niet genoeg energie. Koop voor ieder actief teamlid één Red Bull en shotgun deze. Bewijs via WhatsApp.",
  29: "Koop een flesje water en gooi deze volledig leeg over één teamgenoot. Bewijs via WhatsApp.",
  39: "Fotografeer 5 witte fietsen. De fietsen moeten duidelijk herkenbaar zijn. Bewijs via WhatsApp."
};

export const REJECTION_PENALTY =
  "Niet door de Kroegraad gekomen. Twee teamleden trekken als straf een koolzuurhoudend drankje van minimaal 330 ml. Daarna doen jullie dezelfde opdracht opnieuw.";

const SNACK_TASKS = [
  "Koop evenveel snacks als actieve teamleden en eet alles op. Bewijs via WhatsApp.",
  "Koop voor ieder actief teamlid iets zouts. Alles moet op. Bewijs via WhatsApp.",
  "Koop voor ieder actief teamlid een snack die je niet normaal zou kiezen. Bewijs via WhatsApp."
];

export function createTaskForTile(tile) {
  const fixedText = FIXED_TASKS_BY_TILE_ID[tile.id];
  if (fixedText) {
    return {
      title: tile.name,
      body: fixedText,
      placeholder: false
    };
  }

  if (tile.type === "Snackstation") {
    return {
      title: "Snackstation",
      body: SNACK_TASKS[Math.floor(Math.random() * SNACK_TASKS.length)],
      placeholder: false,
      presentation: "snack"
    };
  }

  if (tile.id === 21) {
    return {
      title: "Vrij Parkeren",
      body: "Loop naar de aangewezen parkeerplek. Maak daar een bewijsfoto en stuur die in WhatsApp.",
      placeholder: true,
      presentation: "parking"
    };
  }

  if (tile.type === "Straatvak") {
    return {
      title: tile.name,
      body: `Placeholder-opdracht voor ${tile.name}. Stuur bewijs in WhatsApp en meld het daarna in de app.`,
      placeholder: true
    };
  }

  return {
    title: tile.name,
    body: `${tile.type} is nog een placeholder in deze fase. Voer een simpele testopdracht uit, stuur bewijs in WhatsApp en meld het daarna in de app.`,
    placeholder: true
  };
}
