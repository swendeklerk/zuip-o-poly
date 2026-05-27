export const CHANCE_CARDS = [
  {
    id: "chance-chaos-toast",
    title: "Chaos Toast",
    body: "Maak een korte proostvideo waarin ieder actief teamlid een andere toast uitbrengt. Bewijs via WhatsApp.",
    effectType: "task"
  },
  {
    id: "chance-table-captain",
    title: "Tafelkapitein",
    body: "Vraag een onbekende groep om jullie teamnaam te scanderen. Film het bewijs voor WhatsApp.",
    effectType: "task"
  },
  {
    id: "chance-sabotage-lite",
    title: "Mini Sabotage",
    body: "Kies straks een ander actief team. Zij krijgen later een extra slokopdracht. Teamkeuze komt in een volgende fase.",
    effectType: "future_team_choice"
  },
  {
    id: "chance-backstreet",
    title: "Verdwaald",
    body: "Jullie route is chaos. Doe een gênante overwinningsdans van 10 seconden en stuur bewijs in WhatsApp.",
    effectType: "task"
  },
  {
    id: "chance-cell-warning",
    title: "Bijna Gepakt",
    body: "Maak een mugshot-foto van het hele team. Bewijs via WhatsApp voordat jullie verder mogen.",
    effectType: "task"
  },
  {
    id: "chance-chain",
    title: "Kettingreactie",
    body: "Iedereen zegt om de beurt een drankwoord. Wie hapert neemt een slok. Film de laatste 10 seconden.",
    effectType: "task"
  },
  {
    id: "chance-bar-critic",
    title: "Kroegrecensie",
    body: "Neem een dramatische recensie op van jullie huidige locatie. Minimaal 15 seconden. Bewijs via WhatsApp.",
    effectType: "task"
  },
  {
    id: "chance-red-alert",
    title: "Rood Alarm",
    body: "Zoek iets roods in de buurt en maak er een teamfoto mee. Bewijs via WhatsApp.",
    effectType: "task"
  }
];

export const FUND_CARDS = [
  {
    id: "fund-second-chance",
    title: "Tweede Kans",
    body: "Jullie mogen deze opdracht als power-up zien. Voor nu: maak een overwinningsfoto en stuur bewijs in WhatsApp.",
    effectType: "saved_powerup",
    powerUpLabel: "Tweede Kans"
  },
  {
    id: "fund-skip-token",
    title: "Overslaan?",
    body: "Later kan dit een opdracht overslaan. In deze versie voeren jullie een korte cheers-video uit als testkaart.",
    effectType: "saved_powerup",
    powerUpLabel: "Opdracht overslaan"
  },
  {
    id: "fund-shield",
    title: "Beschermengel",
    body: "Later beschermt dit tegen teamkeuzes. Nu: maak een foto met een beschermend gebaar. Bewijs via WhatsApp.",
    effectType: "saved_powerup",
    powerUpLabel: "Bescherming"
  },
  {
    id: "fund-extra-roll",
    title: "Nog Een Keer",
    body: "Later geeft dit opnieuw gooien. Nu: ieder actief teamlid roept 'nog eentje' in een video.",
    effectType: "saved_powerup",
    powerUpLabel: "Extra worp"
  },
  {
    id: "fund-tactical-chaos",
    title: "Tactische Chaos",
    body: "Later mag je een ander team beïnvloeden. Nu: stuur een mysterieuze teamselfie in WhatsApp.",
    effectType: "saved_powerup",
    powerUpLabel: "Tactische Chaos"
  },
  {
    id: "fund-rescue",
    title: "Redding",
    body: "Later kan dit jullie redden uit ellende. Nu: film een dramatische reddingsscene van 10 seconden.",
    effectType: "saved_powerup",
    powerUpLabel: "Redding"
  }
];

export function drawCard(type) {
  const cards = type === "fund" ? FUND_CARDS : CHANCE_CARDS;
  return cards[Math.floor(Math.random() * cards.length)];
}
