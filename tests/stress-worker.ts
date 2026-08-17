/**
 * Headless Season Simulation Worker — stress-test payload.
 *
 * Runs in an ISOLATED child process (spawned by stress-season-test.ts) so that a
 * synchronous hang in the game code can be killed and precisely localized by the
 * parent's watchdog. Communicates with the parent via NDJSON lines on stdout.
 *
 * Responsibilities:
 *   1. Auto-run multiple full seasons (league → European → awards → aging → reset).
 *   2. Measure every store action; flag >500ms actions (deadlock suspicion).
 *   3. Audit: standings integrity, award thresholds, age+1, veteran decline,
 *      European fixture/tie integrity, calendar transitions, stalls/livelocks.
 *
 * Event protocol (one JSON object per line):
 *   {"t":"scenario","name":...}                 scenario begin
 *   {"t":"action_start","action":...,...}       before each store action
 *   {"t":"action_end","action":...,"ms":...}    after each store action
 *   {"t":"finding", ...}                        audit finding (see Finding type)
 *   {"t":"season_end",...}                      season boundary summary
 *   {"t":"scenario_end",...}                    scenario summary
 *   {"t":"done"}                                all scenarios finished
 */
import { useGameStore } from "../src/store/useGameStore";
import { Position, type MatchResult } from "../src/types/game";
import { getAllTeams, getLeagueNames } from "../src/data/teamsDatabase";
import { getLeagueRules } from "../src/data/leagueRules";
import { isEliteClub } from "../src/data/careerTransfers";

// ── localStorage polyfill (same as other headless tests) ─────
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
  clear: () => storage.clear(),
};

// ── Silence the game's verbose logging (it would corrupt our NDJSON protocol) ──
const logBuffer: string[] = [];
let suppressedLogs = 0;
console.log = (...args: unknown[]) => {
  suppressedLogs++;
  const line = args.map(String).join(" ");
  logBuffer.push(line);
  if (logBuffer.length > 60) logBuffer.shift(); // ring buffer for deadlock evidence
};
console.warn = (...args: unknown[]) => {
  suppressedLogs++;
  const line = "[warn] " + args.map(String).join(" ");
  logBuffer.push(line);
  if (logBuffer.length > 60) logBuffer.shift();
};
(globalThis as Record<string, unknown>).alert = (msg: string) => {
  suppressedLogs++;
  logBuffer.push("[alert] " + msg);
  if (logBuffer.length > 60) logBuffer.shift();
};

// ── NDJSON protocol ───────────────────────────────────────────
function out(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ── Finding model ─────────────────────────────────────────────
type Severity = "DEADLOCK" | "LIVELOCK" | "CORRUPTION" | "TRANSITION" | "LOGIC" | "PERF" | "DESIGN";

interface Finding {
  severity: Severity;
  scenario: string;
  season: number;
  matchday: number;
  where: string;    // function / source location
  evidence: string; // observed values
  expected: string; // what should have happened
  fix: string;      // suggested fix
}

const findings: Finding[] = [];
let currentScenario = "?";
let currentSeason = 1;

function finding(sev: Severity, where: string, evidence: string, expected: string, fix: string): void {
  const s = useGameStore.getState();
  const f: Finding = {
    severity: sev, scenario: currentScenario, season: currentSeason,
    matchday: s.currentMatchday ?? 0, where, evidence, expected, fix,
  };
  findings.push(f);
  out({ t: "finding", ...f });
}

// ── Config from argv ──────────────────────────────────────────
interface ScenarioConfig {
  name: string;
  mode: "career" | "manager";
  league: string;                 // league display name ("" = first league)
  teamTier: "strong" | "mid" | "weak";
  seasons: number;
  injectElimination?: boolean;    // deterministically simulate "eliminated in Europe"
}
const rawCfg = process.argv[2] ?? "{}";
const SCENARIOS: ScenarioConfig[] = JSON.parse(rawCfg).scenarios ?? [];
const SOFT_TIMEOUT_MS = 500; // user requirement: >500ms per action = deadlock suspicion

// ── Timed action wrapper (yields event loop so the parent can enforce timeouts) ──
async function timedAction<T>(action: string, where: string, fn: () => T): Promise<T | undefined> {
  return await new Promise<T | undefined>((resolve) => {
    setImmediate(() => {
      out({ t: "action_start", action, where, scenario: currentScenario, season: currentSeason,
        matchday: useGameStore.getState().currentMatchday ?? 0 });
      const t0 = performance.now();
      let result: T | undefined;
      let err: string | undefined;
      try {
        result = fn();
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const ms = performance.now() - t0;
      out({ t: "action_end", action, ms: Math.round(ms * 10) / 10, err });
      if (ms > SOFT_TIMEOUT_MS) {
        finding("PERF", `${action} (${where})`, `took ${ms.toFixed(0)}ms`,
          `should complete in < ${SOFT_TIMEOUT_MS}ms`,
          "Profile this action; likely a synchronous busy-loop or an O(n²) scan of the whole world state.");
      }
      resolve(result);
    });
  });
}

// ── Store reset between scenarios ─────────────────────────────
function resetStore(): void {
  storage.clear();
  useGameStore.setState({
    gameStatus: "SETUP", gameMode: "manager", careerPlayer: null,
    teams: [], otherLeaguesTeams: [], playerTeamId: "",
    currentWeek: 1, currentMatchday: 1, season: 1,
    isSeasonEnded: false, seasonResult: null, seasonCalendar: [],
    standings: [], virtualEuroTeams: [], playerTournament: null,
    transferMarketPlayers: [], currentLeagueName: "", leagueRules: null,
    seasonAwards: null, careerEvent: null, seasonMatchLog: [],
    simulationSegmentStart: 0, seasonPlayerStats: {}, pendingElimination: false,
    careerLegacy: null, simError: null,
    isSimulating: false, simulationPaused: false,
  });
}

// ── Snapshot for cross-season audits ──────────────────────────
interface Snapshot { season: number; ages: Map<string, number>; overalls: Map<string, number>; }
function snapshotSeason(): Snapshot {
  const s = useGameStore.getState();
  const ages = new Map<string, number>();
  const overalls = new Map<string, number>();
  for (const t of [...s.teams, ...(s.otherLeaguesTeams ?? [])]) {
    for (const p of [...t.players, ...t.u21Players, ...t.u18Players]) {
      ages.set(p.id, p.age);
      overalls.set(p.id, p.overall);
    }
  }
  return { season: s.season, ages, overalls };
}

// ══════════════════════════════════════════════════════════════
// ── AUDITS ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function auditStandings(leagueRoundsTotal: number): void {
  const s = useGameStore.getState();
  const st = s.standings;
  if (!st.length) return;
  const ctx = `standings (${st.length} rows)`;

  for (const r of st) {
    for (const k of ["points", "goalsFor", "goalsAgainst", "won", "drawn", "lost", "played"] as const) {
      if (isNaN(r[k])) {
        finding("CORRUPTION", "sortStandings/updateRow", `row ${r.teamId.slice(0, 8)}... ${k}=NaN`,
          "no NaN anywhere in standings", "Sanitize every row field before sorting (already attempted — verify all code paths).");
      }
    }
    if (r.points !== r.won * 3 + r.drawn) {
      finding("CORRUPTION", "updateRow", `${r.teamId.slice(0, 8)}... points=${r.points} but 3W+D=${r.won * 3 + r.drawn}`,
        "points === 3*won + drawn", "Fix the row update arithmetic.");
    }
    if (r.played !== r.won + r.drawn + r.lost) {
      finding("CORRUPTION", "updateRow", `${r.teamId.slice(0, 8)}... played=${r.played} ≠ W+D+L=${r.won + r.drawn + r.lost}`,
        "played === won+drawn+lost", "Fix the row update arithmetic.");
    }
  }

  const gf = st.reduce((a, r) => a + r.goalsFor, 0);
  const ga = st.reduce((a, r) => a + r.goalsAgainst, 0);
  if (gf !== ga) {
    finding("CORRUPTION", "updateRow", `ΣgoalsFor=${gf} ≠ ΣgoalsAgainst=${ga}`,
      "league-wide goals scored must equal goals conceded", "A match result was applied to only one side, or duplicated.");
  }

  // Sorted order: points desc → GD desc → GF desc (the store's documented rule)
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i];
    const gdA = a.goalsFor - a.goalsAgainst, gdB = b.goalsFor - b.goalsAgainst;
    if (a.points < b.points ||
      (a.points === b.points && gdA < gdB) ||
      (a.points === b.points && gdA === gdB && a.goalsFor < b.goalsFor)) {
      finding("LOGIC", "sortStandings", `row #${i}: ${a.points}pts/${gdA}gd vs #${i + 1}: ${b.points}pts/${gdB}gd — out of order`,
        "points → GD → GF descending", "Centralize sorting; the league table is displayed unsorted to the user.");
      break;
    }
  }

  // Played-count consistency across teams (only meaningful mid-league-phase)
  const playedSet = new Set(st.map((r) => r.played));
  if (playedSet.size > 1 && st[0].played < leagueRoundsTotal) {
    finding("LOGIC", "playMatchweek (league fixtures)", `${ctx}: teams have played ${[...playedSet].join("/")} games`,
      `all teams should have played the same number of league games mid-season`,
      "Pairwise shuffle must cover all teams exactly once per matchday (odd team counts?).");
  }
}

function auditEuropean(): void {
  const s = useGameStore.getState();
  const t = s.playerTournament;
  if (!t) return;

  const lp = t.leaguePhase;
  const perTeam = new Map<string, number>();
  const seenPairs = new Set<string>();
  const perRoundTeams = new Map<number, Set<string>>();
  for (const f of lp.fixtures) {
    if (!f.homeId || !f.awayId || f.homeId === f.awayId) {
      finding("CORRUPTION", "createLeaguePhase", `fixture round ${f.round}: ${f.homeId} vs ${f.awayId}`,
        "every fixture pairs two distinct valid team ids",
        "Guard fixture generation against self-pairing / undefined ids.");
    }
    perTeam.set(f.homeId, (perTeam.get(f.homeId) ?? 0) + 1);
    perTeam.set(f.awayId, (perTeam.get(f.awayId) ?? 0) + 1);
    const key = [f.homeId, f.awayId].sort().join("|");
    if (seenPairs.has(key)) {
      finding("CORRUPTION", "createLeaguePhase", `duplicate pairing ${f.homeId} vs ${f.awayId} (round ${f.round})`,
        "each team plays 8 DIFFERENT opponents", "Dedup opponents during fixture generation.");
    }
    seenPairs.add(key);
    // Double-booking: a team must not play twice in one round
    const roundSet = perRoundTeams.get(f.round) ?? new Set<string>();
    for (const tid of [f.homeId, f.awayId]) {
      if (roundSet.has(tid)) {
        finding("CORRUPTION", "createLeaguePhase", `team ${tid.slice(0, 10)}... double-booked in round ${f.round}`,
          "each team plays at most once per round (18 fixtures/round)",
          "Round-assignment fallback should find a round where both teams are free; repair pass needed.");
      }
      roundSet.add(tid);
    }
    perRoundTeams.set(f.round, roundSet);
  }
  if (lp.fixtures.length !== 144) {
    finding("CORRUPTION", "createLeaguePhase", `total fixtures = ${lp.fixtures.length} (expected 144: 36 teams × 8 rounds / 2)`,
      "exactly 144 league-phase fixtures", "Fix opponent-pool padding: every team needs exactly 8 unique opponents.");
  }
  for (const [id, n] of perTeam) {
    if (n !== 8) {
      finding("CORRUPTION", "createLeaguePhase", `team ${id.slice(0, 10)}... has ${n}/8 fixtures`,
        "every team plays exactly 8 league-phase matches",
        "The own-pot rotation currently yields only 1 own-pot opponent and cross-pot picks cluster on 2 teams per pot.");
    }
  }

  // League-phase standings sanity
  for (const row of lp.standings) {
    if (row.played > 8) {
      finding("CORRUPTION", "updateLeagueStandings", `team ${row.teamId.slice(0, 10)}... played ${row.played} league-phase games`,
        "never more than 8", "Double-counting via duplicate fixtures in one round.");
    }
    // Once the league phase is over, every team must have played exactly 8
    if (t.currentStage !== "league" && row.played !== 8) {
      finding("CORRUPTION", "updateLeagueStandings/createLeaguePhase", `team ${row.teamId.slice(0, 10)}... played ${row.played}/8 league-phase games`,
        "all 36 teams play exactly 8 league-phase games",
        "Some fixtures never got simulated (missing opponents, dropped fixtures, or double-booking).");
    }
  }
  if (t.currentStage !== "league" && t.currentStage !== "playoff") {
    const expected = { r16: 8, qtr: 4, semi: 2, final: 1 } as const;
    for (const [stage, expect] of Object.entries(expected) as [keyof typeof expected, number][]) {
      const ko = stage === "r16" ? t.roundOf16 : stage === "qtr" ? t.quarterFinals : stage === "semi" ? t.semiFinals : t.final;
      if (!ko) {
        if (t.currentStage === stage) {
          finding("TRANSITION", "advanceKnockoutStage", `stage "${t.currentStage}" reached but ${stage} is null`,
            "each progressed stage holds its knockout bracket", "Stage advancement skipped — ties never resolved.");
        }
        continue;
      }
      if (ko.ties.length !== expect) {
        finding("CORRUPTION", "advanceFromPlayoffs/advanceKnockoutStage", `${stage}: ${ko.ties.length} ties (expected ${expect})`,
          `exactly ${expect} ties in ${stage}`,
          "Only the player's tie is ever simulated; other ties have no winner. Auto-resolve unplayed ties by league-phase ranking.");
      }
      for (const tie of ko.ties) {
        if (!tie.homeId || !tie.awayId || tie.homeId === tie.awayId) {
          finding("CORRUPTION", "createKnockoutRound", `${stage}: tie with ids ${tie.homeId ?? "∅"} vs ${tie.awayId ?? "∅"}`,
            "all knockout ties pair two distinct teams", "Guard createKnockoutRound against odd team counts / missing ids.");
        }
      }
    }
  }
}

function auditAwards(): void {
  const s = useGameStore.getState();
  const a = s.seasonAwards;
  if (!a) return;

  const gb = a.goldenBall;
  if (!gb) {
    // 金球奖绝不空缺——出现 null 即逻辑违规
    finding("LOGIC", "generateSeasonAwards (goldenBall)",
      "Ballon d'Or is vacant (null) — every year must have exactly one winner",
      "Dynamic threshold fallback must always find a winner; the vacancy branch is forbidden",
      "Remove any code path returning null; add a last-resort fallback to the global best player.");
    return;
  }
  if (!isEliteClub(gb.club)) {
    finding("LOGIC", "generateSeasonAwards (goldenBall)",
      `Ballon d'Or → ${gb.name} from non-elite club ${gb.club}`,
      "Winner must play for a curated elite club (五大联赛豪门名单)",
      "League-tier restriction must filter every candidate, career player included.");
  }
  // 动态降级门槛：任何档位得主都不得低于最低档（G+A≥25 · 评分≥8.0）
  if (gb.goals + gb.assists < 25 || gb.rating < 8.0) {
    finding("LOGIC", "generateSeasonAwards (goldenBall)",
      `Ballon d'Or → ${gb.name} (${gb.club}) with ${gb.goals}G ${gb.assists}A (G+A ${gb.goals + gb.assists}), rating ${gb.rating}`,
      "Ballon winner must meet at least the lowest fallback tier: G+A ≥ 25, rating ≥ 8.0 (top tier: G+A≥35/R≥8.5)",
      "Background simulation of top-5 league stars must populate the eligible pool so a tier is always reached.");
  }

  const boot = a.goldenBoot;
  if (boot) {
    // 真实数据一致性：金靴 = 真实进球王，进球数不可能低于金球奖得主
    if (boot.goals < gb.goals) {
      finding("LOGIC", "generateSeasonAwards (goldenBoot)",
        `Golden Boot ${boot.name} (${boot.goals}G) has fewer goals than Ballon winner ${gb.name} (${gb.goals}G)`,
        "Golden Boot must be the true top scorer — all awards read the same season stats pool",
        "Never fabricate per-award stats; the tracker guarantees the same player shows identical numbers everywhere.");
    }
  }

  const tots = a.teamOfSeason;
  if (tots.length !== 11) {
    finding("LOGIC", "generateSeasonAwards", `Team of Season has ${tots.length} players`,
      "exactly 11 (GK×1 DEF×4 MID×3 FWD×3)", "Gap-filling loop can stop early or duplicate; enforce the 11-player invariant.");
  }
  if (new Set(tots.map((t) => t.name)).size !== tots.length) {
    finding("LOGIC", "generateSeasonAwards", "Team of Season contains duplicate players",
      "11 unique players", "The dedup `used` set isn't applied to the gap-fill path.");
  }
  // Strict 4-3-3 position distribution — no defender may leak into attacking slots
  const posCount: Record<string, number> = {};
  for (const t of tots) posCount[t.position] = (posCount[t.position] ?? 0) + 1;
  const expected = { GK: 1, DEF: 4, MID: 3, FWD: 3 };
  for (const [pos, count] of Object.entries(expected)) {
    if (posCount[pos] !== count) {
      finding("LOGIC", "generateSeasonAwards (TOTS)", `Team of Season ${pos} slots = ${posCount[pos] ?? 0} (expected ${count}) — actual: ${JSON.stringify(posCount)}`,
        "strict 4-3-3: GK×1, DEF×4 (LB/CB/CB/RB), MID×3 (CDM/CM/CAM), FWD×3 (LW/ST/RW)",
        "Fill every slot ONLY with players of that position — never cross-position gap-fill.");
    }
  }
}

/** 豪门统治力审计：玩家所在联赛的 curated 豪门绝不允许陷入保级泥潭
 *  （曾修复：曼城 95+ 阵容 25 轮仅 23 分垫底的引擎 Bug）。 */
function auditEliteLeagueClubs(): void {
  const s = useGameStore.getState();
  if (!s.isSeasonEnded) return;
  const sorted = [...s.standings].sort((a, b) => b.points - a.points);
  for (const t of s.teams) {
    if (!isEliteClub(t.name)) continue;
    const row = s.standings.find((r) => r.teamId === t.id);
    if (!row) continue;
    const rank = sorted.findIndex((r) => r.teamId === t.id) + 1;
    if (row.points < 35) {
      finding("LOGIC", "matchEngine (elite club form)",
        `豪门 ${t.name} 仅 ${row.points} 分（联赛第 ${rank} 名）`,
        "elite clubs must dominate: ≥ 35 points (relegation form is forbidden; typical 80-100 for the strongest)",
        "The OVR-driven engine must never let top clubs collapse into relegation form.");
    }
  }
}

function auditCareerPlayer(): void {
  const s = useGameStore.getState();
  const cp = s.careerPlayer;
  if (!cp) return;
  if (cp.goals < 0 || cp.assists < 0 || cp.appearances < 0 || isNaN(cp.avgRating)) {
    finding("CORRUPTION", "simulateCareerPerformance", `stats corrupted: ${cp.appearances}app ${cp.goals}G ${cp.assists}A avg=${cp.avgRating}`,
      "all career stats non-negative and finite", "Validate before committing career state.");
  }
  if (cp.avgRating > 10 || cp.avgRating < 0) {
    finding("CORRUPTION", "simulateCareerPerformance", `avgRating ${cp.avgRating} out of range`,
      "0 ≤ avgRating ≤ 10", "Clamp rating accumulation.");
  }
  if (cp.appearances > 0 && cp.totalRatings === 0) {
    finding("CORRUPTION", "simulateCareerPerformance", "appearances > 0 but totalRatings = 0",
      "totalRatings accumulates every played match", "Inconsistent career stat commit.");
  }
  // ── 转会/租借一致性 ──
  if (cp.teamId && !s.teams.some((t) => t.id === cp.teamId)) {
    finding("LOGIC", "career transfer/loan",
      `cp.teamId ${cp.teamId.slice(0, 8)}... not in the player's league (teams)`,
      "playerTeamId/careerPlayer.teamId must always point at a team inside `teams`",
      "Never move the career player to virtual euro teams — roster moves and world rebuilds only.");
  }
  if (cp.loanParent?.kind === "game" && !s.teams.some((t) => t.id === cp.loanParent.teamId)) {
    finding("LOGIC", "career loan", `loanParent game-teamId ${cp.loanParent.teamId.slice(0, 8)}... not in teams`,
      "same-league loan parent must be a live team in the current world",
      "Rehydrate/migration must clean stale loanParent references.");
  }
  if (cp.pendingMove?.kind === "transfer" && cp.pendingMove.targetClub.leagueName === s.currentLeagueName) {
    finding("LOGIC", "career transfer", `same-league transfer "${cp.pendingMove.targetClub.name}" went through pendingMove`,
      "same-league transfers must apply immediately via roster move, never pendingMove",
      "acceptCareerEvent must compare payload.leagueName with currentLeagueName.");
  }
}

/** Cross-season audit: every player ages +1; veterans must decline, never improve. */
function auditAging(prev: Snapshot | null): void {
  if (!prev) return;
  const s = useGameStore.getState();
  const cur = snapshotSeason();
  let aged = 0, notAged = 0, notAgedSample = "";
  let vetImproved = 0, vetSample = "";
  for (const t of [...s.teams, ...(s.otherLeaguesTeams ?? [])]) {
    for (const p of [...t.players, ...t.u21Players, ...t.u18Players]) {
      const oldAge = prev.ages.get(p.id);
      if (oldAge === undefined) continue; // new generation (u21 promotions etc.)
      aged++;
      if (p.age !== oldAge + 1) {
        notAged++;
        if (!notAgedSample) notAgedSample = `${t.name}/${p.name}: ${oldAge} → ${p.age}`;
      }
      const oldOvr = prev.overalls.get(p.id);
      if (oldOvr !== undefined && p.age >= 34 && p.overall > oldOvr) {
        vetImproved++;
        if (!vetSample) vetSample = `${t.name}/${p.name} (age ${p.age}): OVR ${oldOvr} → ${p.overall}`;
      }
    }
  }
  if (notAged > 0) {
    finding("LOGIC", "startNewSeason (age +1)", `${notAged}/${aged} known players did not age exactly +1 (e.g. ${notAgedSample})`,
      "every player ages exactly +1 per season",
      "startNewSeason only ages `teams` (the player's league) — `otherLeaguesTeams` (background leagues) are never aged.");
  }
  if (vetImproved > 0) {
    finding("LOGIC", "startNewSeason (veteran decline)", `${vetImproved} player(s) aged ≥34 IMPROVED overall (e.g. ${vetSample})`,
      "players ≥32 must only decline (documented 非线性衰退)",
      "Growth paths must be age-gated; verify the ≥34 branch is unreachable.");
  }
}

/** Transition audit: last matchday of the season must reach season end. */
function auditSeasonEnd(calendarLength: number): void {
  const s = useGameStore.getState();
  if (s.isSeasonEnded) {
    if (!s.seasonResult) {
      finding("TRANSITION", "playMatchweek (season end)", "isSeasonEnded=true but seasonResult=null",
        "every ended season carries a seasonResult (rank/champion/prize) — the UI's end-of-season modal REQUIRES it",
        "Set seasonResult in EVERY season-ending path (European final, elimination, no-euro skip).");
    }
    if (s.seasonResult && s.seasonResult.rank < 1) {
      finding("CORRUPTION", "playMatchweek (season end)", `seasonResult.rank = ${s.seasonResult.rank}`,
        "rank ≥ 1", "Rank computation off-by-one.");
    }
  }
  if (s.currentMatchday > calendarLength && !s.isSeasonEnded) {
    finding("TRANSITION", "playMatchweek", `currentMatchday=${s.currentMatchday} past calendar (${calendarLength}) but season not ended`,
      "past-the-calendar ⇒ season ended", "Clamp/branch mismatch in matchday advancement.");
  }
}

// ══════════════════════════════════════════════════════════════
// ── SEASON SIMULATION DRIVERS ─────────────────────────────────
// ══════════════════════════════════════════════════════════════

/** Simulate one season by mirroring the UI's 一键模拟 loop (without its 80ms UI delay).
 *  Returns the number of played matchdays. Aborts on stall/livelock. */
async function simulateSeason(cfg: ScenarioConfig, maxGuard = 200): Promise<{ played: number; aborted: string }> {
  const s0 = useGameStore.getState();
  let played = 0;
  let consecutiveStalls = 0;
  let lastMd = -1;

  for (let guard = 0; guard < maxGuard; guard++) {
    const s = useGameStore.getState();
    if (s.isSeasonEnded) break;
    const md = s.seasonCalendar[(s.currentMatchday ?? 1) - 1];
    if (!md) {
      finding("TRANSITION", "playMatchweek/calendar", `currentMatchday=${s.currentMatchday} but calendar has only ${s.seasonCalendar.length} entries`,
        "every currentMatchday indexes a real calendar entry", "Matchday advancement ran past the calendar without ending the season.");
      return { played, aborted: "calendar-overrun" };
    }

    // ── Livelock detector: same matchday processed repeatedly with no result ──
    if (s.currentMatchday === lastMd) {
      consecutiveStalls++;
      if (consecutiveStalls >= 3) {
        finding("LIVELOCK", "playMatchweek (eliminated-European skip branch)",
          `currentMatchday stuck at ${s.currentMatchday} (${md.name}) for ${consecutiveStalls} consecutive calls — season can never end`,
          "every playMatchweek call must advance the matchday or end the season",
          "The eliminated branch clamps currentMatchday to calendar.length and returns early, so `nextMd > length` can never be reached and isSeasonEnded is never set. Fix: advance past the calendar and end the season (with a seasonResult).");
        return { played, aborted: `livelock@md${s.currentMatchday}` };
      }
    } else {
      consecutiveStalls = 0;
      lastMd = s.currentMatchday;
    }

    if (cfg.mode === "career") {
      await timedAction("generateAILineup", "src/store/useGameStore.ts:1610", () => s.generateAILineup());
      const result = await timedAction("playMatchweek", "src/store/useGameStore.ts:976", () => {
        try { return s.playMatchweek(); } catch (e) {
          finding("TRANSITION", "playMatchweek", `threw: ${e instanceof Error ? e.message : e}`,
            "playMatchweek should never throw during a valid season",
            "Handle the edge case that throws (calendar overrun / missing data).");
          return undefined;
        }
      });
      if (result) {
        played++;
        await timedAction("simulateCareerPerformance", "src/store/useGameStore.ts:1717", () =>
          s.simulateCareerPerformance(result as MatchResult, s.playerTeamId));
      }
      // Auto-dismiss career events (the player clicking "继续模拟")
      if (useGameStore.getState().careerEvent) {
        await timedAction("dismissCareerEvent", "src/store/useGameStore.ts:2071", () => s.dismissCareerEvent());
      }
    } else {
      // Manager mode: mirror the manual flow
      await timedAction("autoFillSquad", "src/store/useGameStore.ts:815", () => {
        try { s.autoFillSquad(); } catch { /* ok */ }
      });
      const result = await timedAction("playMatchweek", "src/store/useGameStore.ts:976", () => {
        try { return s.playMatchweek(); } catch (e) {
          finding("TRANSITION", "playMatchweek", `threw: ${e instanceof Error ? e.message : e}`,
            "playMatchweek should never throw during a valid season",
            "Handle the edge case that throws.");
          return undefined;
        }
      });
      if (result) played++;
    }

    auditStandings(getLeagueRules(cfg.league).totalRounds);
    auditEuropean();
    auditCareerPlayer();
    await new Promise((r) => setImmediate(r)); // yield between matchdays
  }

  const end = useGameStore.getState();
  if (!end.isSeasonEnded) {
    finding("LIVELOCK", "season loop", `guard exhausted after ${maxGuard} matchday attempts (md=${end.currentMatchday}/${end.seasonCalendar.length}) without isSeasonEnded`,
      "a season must terminate after its calendar is consumed",
      "There is at least one matchday path that neither advances nor ends the season.");
    return { played, aborted: "guard-exhausted" };
  }
  return { played, aborted: "" };
}

/** Calendar-vs-rules audit: the number of league matchdays must follow the league's rules. */
function auditCalendar(rulesRounds: number): void {
  const s = useGameStore.getState();
  const leagueMds = s.seasonCalendar.filter((m) => m.type === "league").length;
  const euroMds = s.seasonCalendar.filter((m) => m.type === "european").length;
  if (leagueMds !== rulesRounds) {
    finding("TRANSITION", "generateCalendar (caller)",
      `calendar has ${leagueMds} league matchdays but league rules say ${rulesRounds} (plus ${euroMds} European)`,
      "league matchdays === leagueRules.totalRounds",
      "Career mode's joinCareerClub calls generateCalendar() with no argument (hard-coded 38). Pass the league's totalRounds.");
  }
  if (euroMds !== 17) {
    finding("TRANSITION", "generateCalendar", `calendar has ${euroMds} European matchdays`,
      "17 European matchdays (8 league-phase + 2 playoff + 2 R16 + 2 QF + 2 SF + 1 final)",
      "European calendar generation out of sync with the 36-team format.");
  }
}

// ── Scenario runner ───────────────────────────────────────────
async function runScenario(cfg: ScenarioConfig): Promise<void> {
  currentScenario = cfg.name;
  currentSeason = 1;
  out({ t: "scenario", name: cfg.name, mode: cfg.mode, league: cfg.league, tier: cfg.teamTier, seasons: cfg.seasons });
  resetStore();

  const allTeams = getAllTeams();
  const leagueTeams = allTeams.filter((t) => t.league === cfg.league);
  const pool = leagueTeams.length ? leagueTeams : allTeams;
  const pick = cfg.teamTier === "strong" ? pool[0] : cfg.teamTier === "weak" ? pool[pool.length - 1] : pool[Math.floor(pool.length / 2)];
  const rules = getLeagueRules(cfg.league);
  out({ t: "scenario", name: cfg.name, team: pick.name, leagueSize: pool.length, rulesRounds: rules.totalRounds });

  let prev: Snapshot | null = null;

  for (let si = 0; si < cfg.seasons; si++) {
    currentSeason = si + 1;
    out({ t: "season_start", season: currentSeason, team: pick.name });

    if (cfg.mode === "career" && si === 0) {
      await timedAction("createCareerPlayer", "src/store/useGameStore.ts:1470", () =>
        useGameStore.getState().createCareerPlayer("StressPro", "中国", Position.FWD, 20, 80, 70, 50, 88));
      await timedAction("joinCareerClub", "src/store/useGameStore.ts:1489", () =>
        useGameStore.getState().joinCareerClub(pick.id));
      prev = snapshotSeason();
    } else if (cfg.mode === "manager" && si === 0) {
      await timedAction("initGame", "src/store/useGameStore.ts:482", () =>
        useGameStore.getState().initGame(pick.id, pick.name, pick.budget));
      prev = snapshotSeason();
    }

    const s = useGameStore.getState();
    auditCalendar(rules.totalRounds);

    // Deterministic reproduction of "eliminated during the European phase":
    // exactly what happens when the player is knocked out / not drawn.
    if (cfg.injectElimination) {
      await simulateSeason(cfg);
      const after = useGameStore.getState();
      if (after.playerTournament && !after.isSeasonEnded) {
        out({ t: "action_start", action: "INJECT-elimination", where: "scenario control", scenario: cfg.name, season: currentSeason, matchday: after.currentMatchday });
        useGameStore.setState({
          playerTournament: { ...after.playerTournament, currentStage: "done" },
        });
        out({ t: "action_end", action: "INJECT-elimination", ms: 0 });
      }
    }

    const { played, aborted } = await simulateSeason(cfg);
    const end = useGameStore.getState();
    out({ t: "season_end", season: currentSeason, played, aborted, ended: end.isSeasonEnded,
      matchday: end.currentMatchday, calendar: end.seasonCalendar.length, euro: end.playerTournament?.currentStage ?? "none" });

    auditStandings(rules.totalRounds);
    auditEuropean();
    auditAwards();
    auditCareerPlayer();
    auditSeasonEnd(end.seasonCalendar.length);
    // NOTE: aging is audited AFTER startNewSeason below (ages change at rollover,
    // not during the season) — comparing here would be a false positive.

    if (!end.isSeasonEnded) {
      out({ t: "scenario_end", name: cfg.name, aborted: aborted || "season-not-ended" });
      return; // livelocked scenario — next
    }

    auditEliteLeagueClubs();

    // Start next season (triggers awards, age+1, growth/decline, new calendar)
    if (si < cfg.seasons - 1) {
      await timedAction("startNewSeason", "src/store/useGameStore.ts:1342", () =>
        useGameStore.getState().startNewSeason());
      const ns = useGameStore.getState();
      if (ns.season !== currentSeason + 1 || ns.currentMatchday !== 1 || ns.isSeasonEnded) {
        finding("TRANSITION", "startNewSeason", `season=${ns.season} md=${ns.currentMatchday} ended=${ns.isSeasonEnded}`,
          "new season: season+1, matchday 1, not ended", "Season reset incomplete.");
      }
      if (!ns.seasonAwards) {
        finding("LOGIC", "startNewSeason", "seasonAwards not generated at season rollover",
          "generateSeasonAwards runs before reset", "Awards pipeline skipped.");
      }
      auditAwards();
      auditAging(prev);
      prev = snapshotSeason();
    }
  }
  out({ t: "scenario_end", name: cfg.name, aborted: "" });
}

// ── Main ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  out({ t: "meta", suppressedLogs, scenarios: SCENARIOS.map((c) => c.name) });
  const t0 = performance.now();
  for (const cfg of SCENARIOS) {
    try {
      await runScenario(cfg);
    } catch (e) {
      finding("DEADLOCK", "scenario runner", `unhandled crash: ${e instanceof Error ? e.stack : String(e)}`,
        "scenario completes", "See stack trace above.");
    }
  }
  const ms = performance.now() - t0;
  out({ t: "done", findings: findings.length, elapsedMs: Math.round(ms), suppressedLogs });
  process.exit(0);
}

main().catch((e) => {
  console.error("worker fatal:", e);
  process.exit(2);
});
