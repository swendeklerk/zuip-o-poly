export const TEAM_STATUS = {
  WAITING_START: "waiting_start",
  CAN_ROLL: "can_roll",
  TASK_ACTIVE: "task_active",
  WAITING_TIMER: "waiting_timer",
  IN_JAIL: "in_jail",
  WAITING_SWAP: "waiting_swap",
  CHOOSING_POWERUP: "choosing_powerup",
  CHOOSING_TEAM: "choosing_team",
  FINISHED: "finished",
  GAME_OVER: "game_over"
};

// Schermtekst en status-dot per status. dot: green=actief, yellow=wachten,
// red=uitgeschakeld/cel, purple=aanval/teamkeuze.
export const STATUS_META = {
  [TEAM_STATUS.WAITING_START]: {
    label: "Wachten op start",
    dot: "yellow",
    screenText: "Het spel is nog niet gestart. Wacht tot de spelstarter het spel begint."
  },
  [TEAM_STATUS.CAN_ROLL]: {
    label: "Mag gooien",
    dot: "green",
    screenText: "Jullie zijn aan zet. Gooi de dobbelsteen."
  },
  [TEAM_STATUS.TASK_ACTIVE]: {
    label: "Opdracht bezig",
    dot: "green",
    screenText: "Voer de opdracht uit en bevestig zodra jullie klaar zijn."
  },
  [TEAM_STATUS.WAITING_TIMER]: {
    label: "Wachten door timer",
    dot: "yellow",
    screenText: "Even geduld. Jullie mogen verder zodra de timer afloopt."
  },
  [TEAM_STATUS.IN_JAIL]: {
    label: "In de cel",
    dot: "red",
    screenText: "Jullie zitten in de cel. Wacht de celtijd af."
  },
  [TEAM_STATUS.WAITING_SWAP]: {
    label: "Wachten door Wisselstation",
    dot: "yellow",
    screenText: "Jullie zijn gewisseld. Wacht tot de timer afloopt."
  },
  [TEAM_STATUS.CHOOSING_POWERUP]: {
    label: "Power-up kiezen",
    dot: "purple",
    screenText: "Kies welke power-up jullie willen gebruiken."
  },
  [TEAM_STATUS.CHOOSING_TEAM]: {
    label: "Team kiezen",
    dot: "purple",
    screenText: "Kies een ander team om deze actie op uit te voeren."
  },
  [TEAM_STATUS.FINISHED]: {
    label: "Gefinisht",
    dot: "red",
    screenText: "Jullie beurten zijn op. Wacht tot alle teams klaar zijn."
  },
  [TEAM_STATUS.GAME_OVER]: {
    label: "Spel afgelopen",
    dot: "red",
    screenText: "Het spel is afgelopen. Bekijk de eindstand."
  }
};

export const GAME_PHASE = {
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  RUNNING: "running",
  ENDED: "ended"
};
