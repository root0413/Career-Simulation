/**
 * League Rules Configuration
 *
 * Defines real-world rules for each league: team counts, round counts,
 * European qualification slots, relegation, and match-day constraints.
 */

export interface LeagueRuleConfig {
  leagueId: string;          // unique key
  name: string;              // display name
  totalTeams: number;        // e.g. Bundesliga = 18, Premier League = 20
  totalRounds: number;       // (totalTeams - 1) × 2 for double round-robin
  uclSpots: number[];        // ranks that qualify for UCL
  uelSpots: number[];        // ranks that qualify for UEL
  ueclSpots: number[];       // ranks that qualify for UECL
  relegationSpots: number[]; // ranks that are relegated (not yet used in-game)
  maxSubs: number;           // max substitutions per match
  matchDaySquadSize: number; // players in match-day squad
}

/** All configured leagues.  The real DB has 8 leagues; we map them to real rules. */
export const LEAGUE_RULES: LeagueRuleConfig[] = [
  // ── Germany ──
  {
    leagueId: "Bundesliga",
    name: "德甲",
    totalTeams: 18,
    totalRounds: 34,
    uclSpots: [1, 2, 3, 4],
    uelSpots: [5],
    ueclSpots: [6],
    relegationSpots: [17, 18],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  {
    leagueId: "Bundesliga 2",
    name: "德乙",
    totalTeams: 18,
    totalRounds: 34,
    uclSpots: [],
    uelSpots: [],
    ueclSpots: [],
    relegationSpots: [17, 18],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── England ──
  {
    leagueId: "Premier League",
    name: "英超",
    totalTeams: 20,
    totalRounds: 38,
    uclSpots: [1, 2, 3, 4],
    uelSpots: [5],
    ueclSpots: [6],
    relegationSpots: [18, 19, 20],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── France ──
  {
    leagueId: "Ligue 1 McDonald's",
    name: "法甲",
    totalTeams: 18,
    totalRounds: 34,
    uclSpots: [1, 2, 3],
    uelSpots: [4],
    ueclSpots: [5],
    relegationSpots: [17, 18],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── Italy ──
  {
    leagueId: "Serie A Enilive",
    name: "意甲",
    totalTeams: 20,
    totalRounds: 38,
    uclSpots: [1, 2, 3, 4],
    uelSpots: [5],
    ueclSpots: [6],
    relegationSpots: [18, 19, 20],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── Netherlands ──
  {
    leagueId: "Eredivisie",
    name: "荷甲",
    totalTeams: 18,
    totalRounds: 34,
    uclSpots: [1, 2],
    uelSpots: [3],
    ueclSpots: [4],
    relegationSpots: [17, 18],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── Spain ──
  {
    leagueId: "La Liga",
    name: "西甲",
    totalTeams: 20,
    totalRounds: 38,
    uclSpots: [1, 2, 3, 4],
    uelSpots: [5],
    ueclSpots: [6],
    relegationSpots: [18, 19, 20],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── Turkey ──
  {
    leagueId: "Trendyol Super Lig",
    name: "土超",
    totalTeams: 16,
    totalRounds: 30,
    uclSpots: [1, 2],
    uelSpots: [3],
    ueclSpots: [4],
    relegationSpots: [15, 16],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
  // ── Austria ──
  {
    leagueId: "O. Bundesliga",
    name: "奥甲",
    totalTeams: 12,
    totalRounds: 22,
    uclSpots: [1],
    uelSpots: [2],
    ueclSpots: [3],
    relegationSpots: [12],
    maxSubs: 5,
    matchDaySquadSize: 20,
  },
];

/** Lookup a league config by DB league name (fuzzy match). */
export function getLeagueRules(leagueName: string): LeagueRuleConfig {
  // Exact match
  let r = LEAGUE_RULES.find((r) => r.leagueId === leagueName);
  if (r) return r;

  // Fuzzy: case-insensitive, trim
  const key = leagueName.toLowerCase().trim();
  r = LEAGUE_RULES.find((r) => r.leagueId.toLowerCase() === key);
  if (r) return r;

  // Contains match
  r = LEAGUE_RULES.find(
    (r) => r.leagueId.toLowerCase().includes(key) || key.includes(r.leagueId.toLowerCase()),
  );
  if (r) return r;

  // Fallback: Premier League defaults (20 teams, 38 rounds)
  console.warn(`[leagueRules] No rules found for "${leagueName}" — using Premier League defaults.`);
  return {
    leagueId: leagueName,
    name: leagueName,
    totalTeams: 20,
    totalRounds: 38,
    uclSpots: [1, 2, 3, 4],
    uelSpots: [5],
    ueclSpots: [6],
    relegationSpots: [18, 19, 20],
    maxSubs: 5,
    matchDaySquadSize: 20,
  };
}

/** Build a EuropeanStatus[] mapping for a league's final standings. */
export function buildEuroSlots(rules: LeagueRuleConfig): string[] {
  const max = rules.totalTeams;
  const slots: string[] = new Array(max).fill("NONE");
  for (const r of rules.uclSpots) if (r <= max) slots[r - 1] = "UCL";
  for (const r of rules.uelSpots) if (r <= max) slots[r - 1] = "UEL";
  for (const r of rules.ueclSpots) if (r <= max) slots[r - 1] = "UECL";
  return slots;
}
