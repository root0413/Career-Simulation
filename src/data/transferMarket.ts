import { Position, type Player } from "../types/game";

/**
 * Transfer market player pool (25 players).
 *
 * Categories:
 *   🌟 Elite (24-29) — high OVR, high value
 *   🧓 Veteran (30+)  — decent OVR, bargain price
 *   💎 Wonderkid (16-19) — low OVR, 85+ potential, medium value
 */

export const initialMarketPlayers: Player[] = [
  // ═══════════════ Goalkeepers ═══════════════
  { id: "mkt-gk-01", name: "G. Donnarumma",  age: 26, position: Position.GK, attack: 15, defense: 88, stamina: 78, injuryWeeks: 0, potential: 92, overall: 85, value: 6_500_000 },
  { id: "mkt-gk-02", name: "A. Restes",      age: 19, position: Position.GK, attack: 12, defense: 72, stamina: 70, injuryWeeks: 0, potential: 89, overall: 67, value: 1_200_000 },
  { id: "mkt-gk-03", name: "K. Navas",       age: 37, position: Position.GK, attack: 14, defense: 82, stamina: 68, injuryWeeks: 0, potential: 85, overall: 79, value: 800_000 },
  { id: "mkt-gk-04", name: "D. Costa",       age: 33, position: Position.GK, attack: 13, defense: 84, stamina: 72, injuryWeeks: 0, potential: 86, overall: 81, value: 2_200_000 },

  // ═══════════════ Defenders ═══════════════
  { id: "mkt-def-01", name: "A. Bastoni",     age: 25, position: Position.DEF, attack: 52, defense: 90, stamina: 82, injuryWeeks: 0, potential: 91, overall: 85, value: 7_000_000 },
  { id: "mkt-def-02", name: "J. Gvardiol",    age: 23, position: Position.DEF, attack: 55, defense: 88, stamina: 84, injuryWeeks: 0, potential: 93, overall: 84, value: 6_800_000 },
  { id: "mkt-def-03", name: "L. Yoro",        age: 18, position: Position.DEF, attack: 38, defense: 74, stamina: 72, injuryWeeks: 0, potential: 94, overall: 66, value: 2_500_000 },
  { id: "mkt-def-04", name: "S. Ramos",       age: 38, position: Position.DEF, attack: 58, defense: 79, stamina: 55, injuryWeeks: 0, potential: 92, overall: 74, value: 400_000 },
  { id: "mkt-def-05", name: "E. Mendy",       age: 28, position: Position.DEF, attack: 48, defense: 86, stamina: 80, injuryWeeks: 0, potential: 87, overall: 82, value: 4_500_000 },
  { id: "mkt-def-06", name: "J. Koundé",      age: 26, position: Position.DEF, attack: 50, defense: 87, stamina: 81, injuryWeeks: 0, potential: 89, overall: 83, value: 5_200_000 },

  // ═══════════════ Midfielders ═══════════════
  { id: "mkt-mid-01", name: "P. González",    age: 17, position: Position.MID, attack: 68, defense: 55, stamina: 75, injuryWeeks: 0, potential: 96, overall: 65, value: 3_000_000 },
  { id: "mkt-mid-02", name: "E. Camavinga",   age: 22, position: Position.MID, attack: 72, defense: 80, stamina: 88, injuryWeeks: 0, potential: 92, overall: 82, value: 5_500_000 },
  { id: "mkt-mid-03", name: "D. Riquelme",    age: 29, position: Position.MID, attack: 85, defense: 62, stamina: 76, injuryWeeks: 0, potential: 86, overall: 80, value: 4_200_000 },
  { id: "mkt-mid-04", name: "T. Kroos",       age: 35, position: Position.MID, attack: 80, defense: 74, stamina: 58, injuryWeeks: 0, potential: 94, overall: 78, value: 1_500_000 },
  { id: "mkt-mid-05", name: "N. Barella",     age: 27, position: Position.MID, attack: 78, defense: 76, stamina: 86, injuryWeeks: 0, potential: 88, overall: 83, value: 6_000_000 },
  { id: "mkt-mid-06", name: "W. Zaïre-Emery", age: 18, position: Position.MID, attack: 65, defense: 68, stamina: 78, injuryWeeks: 0, potential: 93, overall: 68, value: 2_800_000 },

  // ═══════════════ Forwards ═══════════════
  { id: "mkt-fwd-01", name: "E. Haaland",     age: 25, position: Position.FWD, attack: 94, defense: 30, stamina: 82, injuryWeeks: 0, potential: 95, overall: 89, value: 20_000_000 },
  { id: "mkt-fwd-02", name: "L. Yamal",       age: 16, position: Position.FWD, attack: 74, defense: 22, stamina: 68, injuryWeeks: 0, potential: 97, overall: 64, value: 4_500_000 },
  { id: "mkt-fwd-03", name: "V. Osimhen",     age: 27, position: Position.FWD, attack: 90, defense: 28, stamina: 84, injuryWeeks: 0, potential: 90, overall: 87, value: 16_000_000 },
  { id: "mkt-fwd-04", name: "Luís Díaz",      age: 28, position: Position.FWD, attack: 86, defense: 35, stamina: 78, injuryWeeks: 0, potential: 87, overall: 83, value: 5_800_000 },
  { id: "mkt-fwd-05", name: "M. Doku",        age: 22, position: Position.FWD, attack: 82, defense: 25, stamina: 80, injuryWeeks: 0, potential: 91, overall: 79, value: 3_800_000 },
  { id: "mkt-fwd-06", name: "K. Mbappé",      age: 26, position: Position.FWD, attack: 94, defense: 35, stamina: 85, injuryWeeks: 0, potential: 95, overall: 88, value: 18_000_000 },
  { id: "mkt-fwd-07", name: "E. Ferguson",    age: 19, position: Position.FWD, attack: 78, defense: 25, stamina: 72, injuryWeeks: 0, potential: 91, overall: 70, value: 3_200_000 },
  { id: "mkt-fwd-08", name: "A. Griezmann",   age: 33, position: Position.FWD, attack: 82, defense: 45, stamina: 70, injuryWeeks: 0, potential: 90, overall: 79, value: 3_500_000 },
];
