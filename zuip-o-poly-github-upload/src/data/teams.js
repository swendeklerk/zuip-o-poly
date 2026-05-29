export const TEAMS = [
  {
    id: "team_bruine_kroeg",
    name: "Bruine Kroeg",
    players: ["Swen", "Jilke", "Bart", "Fleur"],
    defaultActivePlayers: ["Swen", "Jilke", "Bart"],
    colorName: "Bruin",
    accent: "#8b5a2b",
    code: "BRUINEKROEG",
    password: "0000",
    kroegraadId: "LARS"
  },
  {
    id: "team_zwarte_pint",
    name: "Zwarte Pint",
    players: ["Lars", "Iris", "Sophie", "Jelle D."],
    defaultActivePlayers: ["Lars", "Iris", "Sophie"],
    colorName: "Zwart",
    accent: "#f5f5f5",
    code: "ZWARTEPINT",
    password: "0000",
    kroegraadId: "SWEN"
  },
  {
    id: "team_rode_neus",
    name: "Geel Zucht",
    players: ["Celeste", "Thijs", "Jelle H."],
    defaultActivePlayers: ["Celeste", "Thijs", "Jelle H."],
    colorName: "Geel",
    accent: "#f4bf45",
    code: "GEELZUCHT",
    password: "0000",
    kroegraadId: "SWEN"
  },
  {
    id: "team_witte_batavus",
    name: "Witte Batavus",
    players: ["Rick", "Eva", "Bryan"],
    defaultActivePlayers: ["Rick", "Eva", "Bryan"],
    colorName: "Wit",
    accent: "#e8edf3",
    code: "WITTEBATAVUS",
    password: "0000",
    kroegraadId: "LARS"
  }
];

export const KROEGRAAD_USERS = [
  {
    id: "SWEN",
    displayName: "Swen",
    loginName: "SWEN",
    code: "0805"
  },
  {
    id: "LARS",
    displayName: "Lars",
    loginName: "LARS",
    code: "0311"
  }
];

export function findTeamByCode(code) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  return TEAMS.find((team) => team.code === normalizedCode);
}

export function findTeamById(teamId) {
  return TEAMS.find((team) => team.id === teamId);
}

export function findTeamByLogin(teamId, password) {
  return TEAMS.find(
    (team) => team.id === teamId && team.password === String(password ?? "").trim()
  );
}

export function findKroegraad(loginName, code) {
  return KROEGRAAD_USERS.find(
    (user) => user.loginName === loginName && user.code === code
  );
}

export function teamsForKroegraad(kroegraadId) {
  return TEAMS.filter((team) => team.kroegraadId === kroegraadId);
}
