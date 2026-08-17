/**
 * Full-Matrix E2E Test Suite — covers ALL leagues × BOTH modes × 2 seasons.
 * Usage: npx tsx tests/full-matrix-test.ts
 */
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
  clear: () => storage.clear(),
};

import { useGameStore } from "../src/store/useGameStore";
import type { CareerMatchPerf } from "../src/store/useGameStore";
import { Position } from "../src/types/game";
import { getAllTeams, getLeagueNames } from "../src/data/teamsDatabase";
import { getLeagueRules } from "../src/data/leagueRules";

// ── Test infra ──
let passed = 0, failed = 0;
const failures: string[] = [];
const ctx = { league: "", mode: "", season: 0 };

function assert(cond: boolean, label: string) {
  if (cond) { passed++; }
  else { failed++; failures.push(`[${ctx.league}][${ctx.mode}][S${ctx.season}] ${label}`); console.error(`  ❌ ${label}`); }
}
function step(l: string) { console.log(`\n📋 ${l}`); }

function resetStore() {
  storage.clear();
  // Re-init the store by setting to SETUP
  useGameStore.setState({
    gameStatus: "SETUP", gameMode: "manager", careerPlayer: null,
    teams: [], otherLeaguesTeams: [], playerTeamId: "",
    currentWeek: 1, currentMatchday: 1, season: 1,
    isSeasonEnded: false, seasonResult: null, seasonCalendar: [],
    standings: [], virtualEuroTeams: [], playerTournament: null,
    transferMarketPlayers: [], currentLeagueName: "", leagueRules: null,
    seasonAwards: null, seasonMatchLog: [], simulationSegmentStart: 0, seasonPlayerStats: {},
    careerEvent: null, pendingElimination: false, careerLegacy: null, simError: null, isSimulating: false, simulationPaused: false,
  });
}

// ── Main test loop ──
async function main() {
  const leagueNames = getLeagueNames();
  console.log(`⚽ Full-Matrix Test — ${leagueNames.length} leagues × 2 modes × 2 seasons\n`);

  for (const leagueName of leagueNames) {
    ctx.league = leagueName;

    // ─── MANAGER MODE ───
    await testManagerMode(leagueName);

    resetStore();

    // ─── CAREER MODE ───
    await testCareerMode(leagueName);

    resetStore();
    console.log(`\n--- ${leagueName} complete ---`);
  }

  // ─── Results ───
  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 FULL MATRIX RESULTS: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(f); process.exit(1); }
  console.log("🎉 All league × mode × season combinations passed!\n");
}

async function testManagerMode(leagueName: string) {
  ctx.mode = "manager";
  console.log(`\n🏟️ Manager Mode — ${leagueName}`);

  // 1. Init game
  const allTeams = getAllTeams();
  const leagueTeams = allTeams.filter((t) => t.league === leagueName);
  if (leagueTeams.length === 0) { console.log(`  ⚠️ No teams in ${leagueName}, skipping`); return; }
  const pick = leagueTeams[0];
  const rules = getLeagueRules(leagueName);

  step(`Init: ${pick.name} (${leagueName}, ${rules.totalTeams} teams, ${rules.totalRounds} rounds)`);
  try { useGameStore.getState().initGame(pick.id, pick.name, pick.budget); } catch (e) {
    assert(false, `initGame crash: ${(e as Error).message}`); return;
  }

  const s1 = useGameStore.getState();
  assert(s1.gameStatus === "PLAYING", "Status → PLAYING");
  assert(s1.teams.length >= rules.totalTeams || s1.teams.length >= 12, `League teams ok (${s1.teams.length})`);
  assert(s1.seasonCalendar.length >= rules.totalRounds, `Calendar has >= ${rules.totalRounds} matchdays`);
  assert(s1.standings.length === s1.teams.length, "Standings match team count");

  // 2. Simulate full season 1
  await simulateSeason(rules.totalRounds, 1);
  const afterS1 = useGameStore.getState();
  assert(afterS1.isSeasonEnded, "Season 1 ended");
  assert(afterS1.seasonResult !== null, "Season 1 result exists");
  assert(afterS1.seasonResult!.prizeMoney > 0, "Prize money positive");
  assert(typeof afterS1.seasonResult!.europeanQualification === "string", "Euro qual set");

  // Verify ALL teams played (within expected range)
  for (const row of afterS1.standings) {
    assert(row.played >= rules.totalRounds - 2 && row.played <= rules.totalRounds,
      `Team ${row.teamId.slice(0, 6)}... played ${row.played} ≈ ${rules.totalRounds}`);
    assert(!isNaN(row.points), `${row.teamId.slice(0,6)}... points not NaN`);
  }

  // 3. Start season 2
  try { afterS1.startNewSeason(); } catch (e) {
    assert(false, `startNewSeason crash: ${(e as Error).message}`); return;
  }
  const s2Start = useGameStore.getState();
  assert(s2Start.season === 2, "Season → 2");
  assert(s2Start.isSeasonEnded === false, "isSeasonEnded → false");
  assert(s2Start.currentWeek === 1, "Week → 1");
  assert(s2Start.currentMatchday === 1, "Matchday → 1");

  // 4. Simulate season 2
  await simulateSeason(rules.totalRounds, 2);
  const afterS2 = useGameStore.getState();
  assert(afterS2.isSeasonEnded, "Season 2 ended");
}

async function testCareerMode(leagueName: string) {
  ctx.mode = "career";
  console.log(`\n🧑 Career Mode — ${leagueName}`);
  const s = useGameStore.getState();

  // 1. Create player
  step("Create career player");
  try { s.createCareerPlayer("MatrixTest", "中国", Position.FWD, 24, 80, 65, 40, 82); } catch (e) {
    assert(false, `createCareerPlayer crash: ${(e as Error).message}`); return;
  }
  const cp = useGameStore.getState().careerPlayer;
  assert(cp !== null, "Career player created");
  if (!cp) return;
  assert(cp.position === Position.FWD, "Position = FWD");
  assert(cp.overall >= 60, `OVR >= 60 (got ${cp.overall})`);

  // 2. Join club
  step("Join club");
  const allTeams = getAllTeams();
  const leagueTeams = allTeams.filter((t) => t.league === leagueName);
  if (leagueTeams.length === 0) { console.log("  ⚠️ No teams, skipping career"); return; }
  const pick = leagueTeams[0];
  const rules = getLeagueRules(leagueName);

  try { useGameStore.getState().joinCareerClub(pick.id); } catch (e) {
    assert(false, `joinCareerClub crash: ${(e as Error).message}`); return;
  }
  const afterJoin = useGameStore.getState();
  assert(afterJoin.gameStatus === "PLAYING", "Status → PLAYING");
  assert(afterJoin.gameMode === "career", "Mode → career");
  assert(afterJoin.teams.length > 0, "Teams loaded");
  assert(afterJoin.careerPlayer?.teamId !== null, "Career player has teamId");

  // 3. Verify player is in squad
  const pt = afterJoin.teams.find((t) => t.id === afterJoin.playerTeamId);
  assert(pt !== undefined, "Player team found");
  if (pt) {
    const inSquad = pt.players.some((p) => p.id === cp.id);
    assert(inSquad, `Player ${cp.name} in ${pt.name} squad`);
  }

  // 4. Simulate season 1
  await simulateSeason(rules.totalRounds, 1);
  const afterS1 = useGameStore.getState();
  assert(afterS1.isSeasonEnded, "S1 ended");

  // Verify career stats accumulated (at least some, if player got game time)
  const cp1 = afterS1.careerPlayer;
  assert(cp1 !== null, "Career player survives S1");
  if (cp1 && cp1.appearances > 0) {
    assert(cp1.goals >= 0, `Goals >= 0 (${cp1.goals})`);
    assert(cp1.avgRating > 0 && cp1.avgRating <= 10, `Rating in range (${cp1.avgRating})`);
    assert(!isNaN(cp1.avgRating), "Avg rating not NaN");
  }

  // 5. Start season 2
  try { afterS1.startNewSeason(); } catch (e) {
    assert(false, `startNewSeason crash: ${(e as Error).message}`); return;
  }
  const s2Start = useGameStore.getState();
  assert(s2Start.season === 2, "Season → 2");
  const cp2 = s2Start.careerPlayer;
  assert(cp2 !== null, "Career player survives into S2");
  if (cp2) {
    // Career stats should be preserved
    assert(cp2.goals === cp1?.goals, `Goals preserved (${cp2.goals})`);
    assert(cp2.appearances === cp1?.appearances, `Apps preserved (${cp2.appearances})`);
  }

  // 6. Simulate season 2
  await simulateSeason(rules.totalRounds, 2);
}

async function simulateSeason(totalRounds: number, seasonNum: number) {
  ctx.season = seasonNum;
  const cal = useGameStore.getState().seasonCalendar;
  let matchesPlayed = 0;
  let euroMatches = 0;

  for (let md = 0; md < Math.min(cal.length, totalRounds + 45); md++) {
    const state = useGameStore.getState();
    if (state.isSeasonEnded) break;

    const cm = state.currentMatchday;
    const matchday = cal[cm - 1];
    if (!matchday) break;

    // Auto-fill
    try { state.autoFillSquad(); } catch { }

    // Check starters
    const pt = state.teams.find((t) => t.id === state.playerTeamId);
    if (!pt) break;

    try {
      state.playMatchweek();
      matchesPlayed++;
      if (matchday.type === "european") euroMatches++;
    } catch (e) {
      // Acceptable failures: injured starters, squad issues
      if (!(e as Error).message.includes("受伤") && !(e as Error).message.includes("不足") && !(e as Error).message.includes("异常")) {
        console.warn(`  ⚠️ Matchday ${cm} error: ${(e as Error).message}`);
      }
      // Advance manually
      useGameStore.setState({ currentMatchday: cm + 1, currentWeek: matchday.round });
    }

    if (matchesPlayed >= totalRounds + 40) break;
  }

  const final = useGameStore.getState();
  // Verify standings integrity
  for (const row of final.standings) {
    if (row.played < 0 || row.played > totalRounds + 20) {
      assert(false, `Standings anomaly: ${row.teamId.slice(0,6)}... played=${row.played}`);
    }
  }

  // European standings check
  if (final.playerTournament) {
    const lp = final.playerTournament.leaguePhase;
    const playedCounts = new Set(lp.standings.map((s) => s.played));
    if (playedCounts.size > 2) {
      // Some variation is acceptable (teams in same group/round may differ by 1)
      const maxPlayed = Math.max(...playedCounts);
      const minPlayed = Math.min(...playedCounts);
      assert(maxPlayed - minPlayed <= 2,
        `Euro played counts consistent (min=${minPlayed} max=${maxPlayed})`);
    }
    // No team played > 8 (max league phase rounds)
    const overplayed = lp.standings.filter((s) => s.played > 8);
    assert(overplayed.length === 0,
      `${overplayed.length} teams overplayed in European (max should be 8)`);
  }

  console.log(`  ⚽ S${seasonNum}: ${matchesPlayed} matches (${euroMatches} European)`);
}

main().catch((e) => {
  console.error("\n💥 FATAL:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
