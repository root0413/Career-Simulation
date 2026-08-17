import { Position, type Player } from "../types/game";

/**
 * Real-world superstar placeholders for the transfer market.
 */

export const realTransferMarketPlayers: Player[] = [
  {
    id: "real-001",
    name: "K. Mbappé",
    age: 26,
    position: Position.FWD,
    attack: 94, defense: 35, stamina: 85, injuryWeeks: 0,
    potential: 95, overall: 88, value: 18_000_000,
  },
  {
    id: "real-002",
    name: "J. Bellingham",
    age: 22,
    position: Position.MID,
    attack: 82, defense: 78, stamina: 90, injuryWeeks: 0,
    potential: 92, overall: 87, value: 15_000_000,
  },
  {
    id: "real-003",
    name: "V. van Dijk",
    age: 33,
    position: Position.DEF,
    attack: 45, defense: 93, stamina: 78, injuryWeeks: 0,
    potential: 88, overall: 86, value: 8_000_000,
  },
];

/** Full real-player database for future expansion. */
export const realDatabasePlayers: Player[] = [
  ...realTransferMarketPlayers,
  {
    id: "real-004",
    name: "L. Messi",
    age: 38,
    position: Position.FWD,
    attack: 92, defense: 28, stamina: 60, injuryWeeks: 0,
    potential: 99, overall: 82, value: 5_000_000,
  },
  {
    id: "real-005",
    name: "M. ter Stegen",
    age: 33,
    position: Position.GK,
    attack: 18, defense: 90, stamina: 72, injuryWeeks: 0,
    potential: 90, overall: 85, value: 7_000_000,
  },
];
