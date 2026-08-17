import { Position, type Player, type Team, type Formation, ALL_FORMATIONS, ALL_TACTICS, FORMATION_SLOTS } from "../types/game";
import { getTeamsByLeague, getAllTeams, type RealTeamData } from "../data/teamsDatabase";
import { marketValue } from "./marketValue";
import { generateUUID } from "./uuid";

// ── Name pools ──────────────────────────────────────────────

const FIRST_NAMES = [
  "James", "Lucas", "Ethan", "Oliver", "Leo", "Noah", "Mason", "Liam",
  "Marco", "Hugo", "Felix", "Oscar", "Enzo", "Theo", "Max", "Kai",
  "Adam", "Alex", "Ben", "Chris", "Dan", "Eric", "Finn", "Gabe",
  "Ivan", "Jack", "Kurt", "Leon", "Matt", "Nick", "Paul", "Ryan",
  "Sam", "Tom", "Viktor", "Will", "Zack", "Diego", "Andre", "Bruno",
];

const LAST_NAMES = [
  "Silva", "Müller", "Rossi", "Foster", "Costa", "Kovač", "Berg",
  "Novák", "Hansen", "Ivanov", "Petrov", "Jansen", "Peeters",
  "Torres", "Morales", "Reyes", "Walker", "Harris", "Clark",
  "Lewis", "Young", "King", "Wright", "Scott", "Green", "Baker",
  "Adams", "Hill", "Campbell", "Mitchell", "Carter", "Phillips",
  "Turner", "Parker", "Collins", "Edwards", "Stewart", "Morris",
];

// ── Team name pool ──────────────────────────────────────────

const STARTING_BUDGET = 5_000_000;

// ── Helpers ─────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function calcValue(overall: number): number {
  // Exponential: 50 → ~100k, 70 → ~1M, 90 → ~10M
  return marketValue(overall);
}

// ── Position-based ability generation ───────────────────────

/**
 * Attribute ranges per position — attack / defence / stamina.
 *
 * Design rationale:
 *  - FWD: goal-scorers, so ATT dominates. DEF is an afterthought.
 *  - MID: box-to-box engines. ATT & DEF balanced, STA is their standout trait.
 *  - DEF: stoppers. DEF is king, ATT is minimal (header threat from corners at best).
 *  - GK: shot-stoppers. DEF represents saves/reactions, ATT is irrelevant.
 */

interface StatProfile {
  attMin: number;
  attMax: number;
  defMin: number;
  defMax: number;
  staMin: number;
  staMax: number;
}

const POSITION_PROFILES: Record<Position, StatProfile> = {
  [Position.FWD]: { attMin: 70, attMax: 95, defMin: 20, defMax: 55, staMin: 50, staMax: 85 },
  [Position.MID]: { attMin: 55, attMax: 85, defMin: 55, defMax: 85, staMin: 70, staMax: 95 },
  [Position.DEF]: { attMin: 20, attMax: 55, defMin: 70, defMax: 95, staMin: 50, staMax: 85 },
  [Position.GK]:  { attMin: 10, attMax: 25, defMin: 70, defMax: 95, staMin: 45, staMax: 75 },
};

/**
 * Weighted overall per position.
 *
 * Weights reflect what actually matters for that role:
 *   FWD: attack is everything, stamina for pressing, defence irrelevant.
 *   MID: balanced profile — they contribute at both ends.
 *   DEF: defending and physicality first, attack is a bonus.
 *   GK: "defence" IS their primary job (saves). Attack and stamina barely matter.
 */

type WeightKey = "att" | "def" | "sta";
type Weights = Record<WeightKey, number>;

// Stamina weight = 0 — overall is purely att+def. Stamina is a separate fitness stat.
const POSITION_WEIGHTS: Record<Position, Weights> = {
  [Position.FWD]: { att: 0.75, def: 0.25, sta: 0.00 },
  [Position.MID]: { att: 0.50, def: 0.50, sta: 0.00 },
  [Position.DEF]: { att: 0.25, def: 0.75, sta: 0.00 },
  [Position.GK]:  { att: 0.10, def: 0.90, sta: 0.00 },
};

function generateAttack(position: Position): number {
  const p = POSITION_PROFILES[position];
  return rand(p.attMin, p.attMax);
}

function generateDefense(position: Position): number {
  const p = POSITION_PROFILES[position];
  return rand(p.defMin, p.defMax);
}

function generateStamina(position: Position): number {
  const p = POSITION_PROFILES[position];
  return rand(p.staMin, p.staMax);
}

function calcOverall(position: Position, attack: number, defense: number, stamina: number): number {
  const w = POSITION_WEIGHTS[position];
  return Math.round(attack * w.att + defense * w.def + stamina * w.sta);
}

/** Generate potential (50-99), skewed by age. */
/**
 * Generate potential based on age AND current overall.
 * - Age ≤ 25: wide gap — potential can be much higher (growth years).
 * - Age 26–28: narrowing — potential ≥ overall, but won't skyrocket.
 * - Age ≥ 29: anchored — potential = overall + 0~2 (already peaked).
 */
function generatePotential(age: number, overall: number): number {
  if (age >= 29) {
    // Veteran: potential is anchored to current overall
    return clamp(overall + rand(0, 2), overall, 99);
  }

  if (age >= 26) {
    // Late peak: potential won't drop below overall, modest ceiling
    const base = clamp(rand(overall, Math.min(99, overall + 6)), 55, 99);
    return Math.max(overall, base);
  }

  // Age ≤ 25: growth years — random ceiling
  const roll = Math.random();
  let base: number;
  if (roll < 0.15)       base = rand(85, 99);
  else if (roll < 0.45)  base = rand(70, 84);
  else if (roll < 0.80)  base = rand(55, 69);
  else                   base = rand(50, 54);

  if (age <= 21) base = Math.min(99, base + rand(0, 8));

  return clamp(base, overall, 99);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Player generation ───────────────────────────────────────

function generatePlayer(position: Position): Player {
  const attack = generateAttack(position);
  const defense = generateDefense(position);
  const stamina = generateStamina(position);
  const overall = calcOverall(position, attack, defense, stamina);
  const age = rand(18, 35);

  return {
    id: generateUUID(),
    name: generateName(),
    age,
    position,
    attack,
    defense,
    stamina,
    injuryWeeks: 0,
    potential: generatePotential(age, overall),
    overall,
    value: calcValue(overall),
  };
}

function generateSquad(): Player[] {
  const players: Player[] = [];

  const slots: { position: Position; count: number }[] = [
    { position: Position.GK, count: 2 },
    { position: Position.DEF, count: 6 },
    { position: Position.MID, count: 6 },
    { position: Position.FWD, count: 4 },
  ];

  for (const { position, count } of slots) {
    for (let i = 0; i < count; i++) {
      players.push(generatePlayer(position));
    }
  }

  return players;
}

/** Pick the top-N players by overall for each position slot in the formation. */
function computeStarterIds(players: Player[], formation: Formation): string[] {
  const slots = FORMATION_SLOTS[formation];
  const ids: string[] = [];

  const top = (pos: Position, n: number) =>
    players
      .filter((p) => p.position === pos)
      .sort((a, b) => b.overall - a.overall)
      .slice(0, n)
      .map((p) => p.id);

  ids.push(...top(Position.GK, slots[Position.GK]));
  ids.push(...top(Position.DEF, slots[Position.DEF]));
  ids.push(...top(Position.MID, slots[Position.MID]));
  ids.push(...top(Position.FWD, slots[Position.FWD]));
  return ids;
}

// ── Youth squad generation ──────────────────────────────────

function generateYouthPlayer(
  position: Position,
  ageMin: number,
  ageMax: number,
  overallMin: number,
  overallMax: number,
): Player {
  const age = rand(ageMin, ageMax);
  // Scale stats down to match target overall range
  const scale = overallMin / 65; // baseline scaling
  const attack = clamp(Math.round(generateAttack(position) * scale + rand(-5, 5)), 10, 70);
  const defense = clamp(Math.round(generateDefense(position) * scale + rand(-5, 5)), 10, 70);
  const stamina = clamp(Math.round(generateStamina(position) * scale + rand(-5, 5)), 20, 75);
  const overall = clamp(calcOverall(position, attack, defense, stamina), overallMin, overallMax);
  const potential = rand(65, 95); // youth always have good potential

  return {
    id: generateUUID(),
    name: generateName(),
    age,
    position,
    attack,
    defense,
    stamina,
    injuryWeeks: 0,
    potential,
    overall,
    value: marketValue(overall, potential, age),
  };
}

function generateYouthSquad(
  count: number,
  ageMin: number,
  ageMax: number,
  overallMin: number,
  overallMax: number,
): Player[] {
  const players: Player[] = [];
  // Balanced position distribution for youth
  const slots: { position: Position; count: number }[] = [
    { position: Position.GK, count: Math.ceil(count * 0.15) },
    { position: Position.DEF, count: Math.ceil(count * 0.35) },
    { position: Position.MID, count: Math.ceil(count * 0.30) },
    { position: Position.FWD, count: Math.ceil(count * 0.20) },
  ];
  // Adjust to hit exact count
  const total = slots.reduce((s, sl) => s + sl.count, 0);
  if (total > count) slots[3].count -= total - count;

  for (const { position, count: c } of slots) {
    for (let i = 0; i < c; i++) {
      players.push(generateYouthPlayer(position, ageMin, ageMax, overallMin, overallMax));
    }
  }
  return players;
}

// ── Team generation ─────────────────────────────────────────

// ── Public API ──────────────────────────────────────────────

/** Convert a RealTeamData to a game Team object. */
function realToGameTeam(rt: RealTeamData, isPlayerTeam: boolean): Team {
  const formation = isPlayerTeam ? "4-3-3" as Formation : pick(ALL_FORMATIONS);
  const u21Count = rand(10, 15);
  const u18Count = rand(10, 15);
  // Remap players first, THEN compute starter IDs from the new IDs.
  // Recompute overall with the SAME position-weighted formula used by all growth/
  // decline paths — otherwise the raw database overall drifts the moment a player
  // ages (and "declines" could even raise OVR for GK/DEF with high stamina).
  const remapped = rt.players.map(p => ({
    ...p,
    id: generateUUID(),
    overall: calcOverall(p.position, p.attack, p.defense, p.stamina),
  }));
  return {
    id: generateUUID(),
    name: rt.name,
    budget: isPlayerTeam ? rt.budget : 0,
    players: remapped,
    starterIds: computeStarterIds(remapped, formation),
    u21Players: generateYouthSquad(u21Count, 18, 21, 50, 65),
    u18Players: generateYouthSquad(u18Count, 15, 18, 40, 55),
    formation,
    tactic: isPlayerTeam ? "balanced" : pick(ALL_TACTICS),
    europeanStatus: isPlayerTeam ? "UCL" : "NONE",
    league: rt.league, // 保留联赛信息（金球奖资格/租借目的地判定用）
  };
}

export function generateWorld(selectedTeamId: string, _selectedTeamName: string, playerBudget: number): {
  teams: Team[];
  otherLeaguesTeams: Team[];
} {
  const leaguesMap = getTeamsByLeague();
  const allTeams = getAllTeams();

  // Find the selected team and its league
  const selectedReal = allTeams.find(t => t.id === selectedTeamId) ?? allTeams[0];
  // Override budget with what TeamSelection passed
  selectedReal.budget = playerBudget;

  // Find which league the selected team belongs to
  let playerLeagueName = selectedReal.league;
  const playerLeagueTeams = leaguesMap.get(playerLeagueName) ?? [];

  // Build the player's league (18-20 teams) from real data
  const teams: Team[] = [];
  for (const rt of playerLeagueTeams) {
    teams.push(realToGameTeam(rt, rt.id === selectedTeamId));
  }

  // Build background teams from all OTHER leagues
  const otherLeaguesTeams: Team[] = [];
  for (const [leagueName, leagueTeams] of leaguesMap) {
    if (leagueName === playerLeagueName) continue;
    for (const rt of leagueTeams) {
      otherLeaguesTeams.push(realToGameTeam(rt, false));
    }
  }

  console.log(`[worldGenerator] Generated ${teams.length} teams for ${playerLeagueName} + ${otherLeaguesTeams.length} background teams`);
  return { teams, otherLeaguesTeams };
}

