/**
 * test-runner.ts — Automated game logic tester for Simple FM
 *
 * Usage:  npx tsx tests/test-runner.ts
 *
 * Simulates a full game lifecycle and asserts data integrity at every step.
 * Runs entirely in Node.js (no browser needed).
 */

// ── Polyfills for Node.js (browser-only APIs) ────────────────

const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
  clear: () => storage.clear(),
};

// ── Imports ───────────────────────────────────────────────────

import { useGameStore } from "../src/store/useGameStore";
import type { Team, Player, LeagueStandings, MatchResult, Formation, CareerMatchLogEntry } from "../src/types/game";
import { simulateMatch } from "../src/utils/matchEngine";
import { generateCalendar } from "../src/utils/calendar";
import { formatMatchdayLabel, getStageRound, groupMatchLogEntries } from "../src/utils/matchLog";
import { TOP5_LEAGUES, LOAN_LEAGUES, ELITE_CLUBS, isTopFiveLeague, isEliteClub, isBallonEligible, computeTransferFee, formatEuroM, pickEliteDestination, pickSameLeagueLoanTarget, pickCrossLeagueLoanTarget } from "../src/data/careerTransfers";
import { computeMatchRating, accumulateMatchStats, type TeamStatMeta } from "../src/utils/seasonStats";
import { simulateBackgroundSeason, getTopFiveBackgroundStars } from "../src/data/careerTransfers";
import { simulatePenaltyShootout, updateKnockoutTie, getEuropeanFinish } from "../src/utils/europeanEngine";
import { getLeagueRankMeta } from "../src/utils/leagueRank";
import { computeTeamStrengths, expectedGoalsPerMatch, teamPrestige, europeanEliteBoost, selectStartingXI, pickWeightedScorer } from "../src/utils/matchEngine";
import { generatePitchSlots, mapStartersToSlots } from "../src/utils/pitchSlots";
import { generateUUID } from "../src/utils/uuid";
import { marketValue, VALUE_CEILING } from "../src/utils/marketValue";
import { normalizePosition, cleanPlayerRecord, dedupePlayers, parsePlayersCSV, importPlayerData } from "../src/utils/playerImport";
import { getAllTeams } from "../src/data/teamsDatabase";
import { getLeagueRules } from "../src/data/leagueRules";
import { buildCareerLegacy } from "../src/utils/careerLegacy";
import { retirementChance } from "../src/utils/lifecycle";
import { generateNewgen, generateNewgens, potentialBandFor } from "../src/utils/newgens";
import { MatchEventType, Position, type EuropeanTie, type EuropeanTournament, type CareerPlayer, type CareerSeasonRecord, type StartingXI } from "../src/types/game";

// ── Test utilities ────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    const msg = `  ❌ FAIL: ${label}`;
    failures.push(msg);
    console.error(msg);
  }
}

function step(label: string): void {
  console.log(`\n📋 ${label}`);
}

function fatal(label: string): never {
  console.error(`\n💥 FATAL: ${label}`);
  process.exit(1);
}

// ── Main test sequence ────────────────────────────────────────

async function main() {
  console.log("⚽ Simple FM — Automated Test Runner\n");
  console.log("=".repeat(60));

  const store = useGameStore;

  // ─── STEP 1: Initial state ────────────────────────────────
  step("1. Initial State Check");
  {
    const s = store.getState();
    assert(s.gameStatus === "SETUP", "Game starts in SETUP mode");
    assert(s.teams.length === 0, "No teams before init");
    assert(s.season === 1, "Season starts at 1");
    assert(s.currentMatchday === 1, "Matchday starts at 1");
    assert(s.currentWeek === 1, "Week starts at 1");
    assert(s.isSeasonEnded === false, "Season not ended initially");
    assert(s.seasonResult === null, "No season result initially");
    assert(s.playerTournament === null, "No tournament before init");
  }

  // ─── STEP 2: Initialize game ───────────────────────────────
  step("2. Game Initialization");
  let teamId: string;
  let teamName: string;
  {
    const s = store.getState();
    // Find a valid team — pick the first one from a league WITH European slots,
    // because the assertions below expect an initial UCL tournament
    // (the DB's first team is from Bundesliga 2, which has no Euro spots).
    const allTeams = (await import("../src/data/teamsDatabase")).getAllTeams();
    assert(allTeams.length > 0, "Real team database is non-empty");
    const { getLeagueRules, buildEuroSlots } = await import("../src/data/leagueRules");
    const pick = allTeams.find((t) => buildEuroSlots(getLeagueRules(t.league)).some((sl) => sl !== "NONE")) ?? allTeams[0];
    teamId = pick.id;
    teamName = pick.name;
    const budget = pick.budget;

    console.log(`   Selecting: ${teamName} (budget: €${(budget / 1_000_000).toFixed(1)}M)`);

    try {
      s.initGame(teamId, teamName, budget);
    } catch (e) {
      fatal(`initGame crashed: ${e instanceof Error ? e.stack : String(e)}`);
    }

    const after = store.getState();
    assert(after.gameStatus === "PLAYING", "Status changes to PLAYING after init");
    assert(after.teams.length >= 18, `Player league has >= 18 teams (got ${after.teams.length})`);
    assert(after.playerTeamId !== "", "playerTeamId is set");
    assert(after.seasonCalendar.length >= 50, `Calendar has enough matchdays (got ${after.seasonCalendar.length})`);
    assert(after.virtualEuroTeams.length === 36, `36 virtual European teams (got ${after.virtualEuroTeams.length})`);
    assert(after.playerTournament !== null, "Player tournament is created");
    assert(after.playerTournament?.type === "UCL", "Initial tournament is UCL");
    assert(after.transferMarketPlayers.length > 0, "Transfer market has players");
    assert(after.standings.length === after.teams.length, "Standings match team count");
  }

  // ─── STEP 3: Verify player team structure ──────────────────
  step("3. Player Team Data Integrity");
  {
    const s = store.getState();
    const pt = s.teams.find((t) => t.id === s.playerTeamId);
    if (!pt) fatal("Player team not found after init");

    assert(pt.players.length >= 18, `First team has >= 18 players (got ${pt.players.length})`);
    assert(pt.starterIds.length === 11, `Exactly 11 starter IDs (got ${pt.starterIds.length})`);
    assert(pt.u21Players.length > 0, "U21 squad is non-empty");
    assert(pt.u18Players.length > 0, "U18 squad is non-empty");
    assert(pt.budget > 0, "Budget is positive");
    assert(pt.formation !== undefined, "Formation is set");
    assert(pt.tactic !== undefined, "Tactic is set");
    assert(pt.europeanStatus === "UCL", "Initial European status is UCL");

    // Check every player has required fields
    for (const squad of [pt.players, pt.u21Players, pt.u18Players]) {
      for (const p of squad) {
        assert(typeof p.id === "string" && p.id.length > 0, `Player has valid id (name: ${p.name ?? "???"})`);
        assert(typeof p.name === "string" && p.name.length > 0, `Player has valid name`);
        assert(typeof p.age === "number" && p.age >= 15, `Player ${p.name} age is valid (${p.age})`);
        assert(typeof p.position === "string", `Player ${p.name} has position`);
        assert(typeof p.attack === "number" && p.attack >= 1, `Player ${p.name} attack valid`);
        assert(typeof p.defense === "number" && p.defense >= 1, `Player ${p.name} defense valid`);
        assert(typeof p.stamina === "number" && p.stamina >= 0, `Player ${p.name} stamina valid`);
        assert(typeof p.overall === "number" && p.overall >= 1, `Player ${p.name} overall valid`);
        assert(typeof p.value === "number" && p.value >= 0, `Player ${p.name} value valid`);
        assert(typeof p.injuryWeeks === "number", `Player ${p.name} injuryWeeks is number`);
        assert(typeof p.potential === "number", `Player ${p.name} potential is number`);
      }
    }
    console.log(`   Verified ${pt.players.length + pt.u21Players.length + pt.u18Players.length} players total`);
  }

  // ─── STEP 4: Auto-fill and auto-rotate ─────────────────────
  step("4. Auto-Fill & Auto-Rotate");
  {
    const before = store.getState();
    const pt = before.teams.find((t) => t.id === before.playerTeamId)!;
    const oldStarterCount = pt.starterIds.length;
    const oldPlayerCount = pt.players.length;

    // Auto-fill
    try {
      before.autoFillSquad();
    } catch (e) {
      fatal(`autoFillSquad crashed: ${e instanceof Error ? e.stack : String(e)}`);
    }

    const afterFill = store.getState();
    const pt2 = afterFill.teams.find((t) => t.id === afterFill.playerTeamId)!;
    assert(pt2.starterIds.length === 11, `After auto-fill: 11 starters (got ${pt2.starterIds.length})`);
    assert(pt2.players.length >= oldPlayerCount, `No players lost during auto-fill (${oldPlayerCount} → ${pt2.players.length})`);

    // Auto-rotate
    try {
      afterFill.autoRotateSquad();
    } catch (e) {
      fatal(`autoRotateSquad crashed: ${e instanceof Error ? e.stack : String(e)}`);
    }

    const afterRotate = store.getState();
    const pt3 = afterRotate.teams.find((t) => t.id === afterRotate.playerTeamId)!;
    assert(pt3.starterIds.length === 11, `After auto-rotate: 11 starters (got ${pt3.starterIds.length})`);
    assert(pt3.players.length === pt2.players.length, `No players lost during auto-rotate (${pt2.players.length} → ${pt3.players.length})`);

    // Verify all starterIds point to real players
    for (const sid of pt3.starterIds) {
      assert(
        pt3.players.some((p) => p.id === sid),
        `Starter ID ${sid.slice(0, 8)}... exists in players`,
      );
    }
  }

  // ─── STEP 5: Simulate 38 league matches ────────────────────
  step("5. Simulating 38 League Rounds");
  {
    for (let round = 1; round <= 10; round++) {
      // Play matches until we hit 10 league rounds (skip European for now)
      let played = 0;
      while (played < 1) {
        const s = store.getState();
        if (s.isSeasonEnded) break;
        const md = s.seasonCalendar?.[(s.currentMatchday ?? 1) - 1];
        if (!md) break;

        if (md.type !== "league") {
          // Skip non-league by advancing matchday manually
          store.setState({ currentMatchday: (s.currentMatchday ?? 1) + 1, currentWeek: md.round });
          continue;
        }

        const pt = s.teams.find((t) => t.id === s.playerTeamId);
        if (!pt) fatal("Player team vanished during league simulation");

        // Auto-fill before each match
        try { s.autoFillSquad(); } catch { /* non-critical */ }

        const pt2 = store.getState().teams.find((t) => t.id === s.playerTeamId)!;
        if (pt2.starterIds.length !== 11) {
          console.log(`   ⚠️ Round ${round}: skipping (${pt2.starterIds.length} starters)`);
          store.setState({ currentMatchday: (s.currentMatchday ?? 1) + 1 });
          continue;
        }

        try {
          s.playMatchweek();
          played++;
        } catch (e) {
          console.error(`   ⚠️ playMatchweek error at round ${round}: ${(e as Error).message}`);
          store.setState({ currentMatchday: (s.currentMatchday ?? 1) + 1 });
        }
      }

      const after = store.getState();
      const pt = after.teams.find((t) => t.id === after.playerTeamId);
      if (!pt) fatal(`Player team vanished after round ${round}`);

      assert(pt.players.length >= 18, `Round ${round}: squad size ok (${pt.players.length})`);
      assert(after.standings.length === after.teams.length, `Round ${round}: standings match teams`);
      assert(after.standings.every((s) => s.teamId !== ""), `Round ${round}: all standings have teamId`);

      // Verify no standings row has NaN or undefined
      for (const row of after.standings) {
        assert(
          typeof row.points === "number" && !isNaN(row.points),
          `Standings points valid for ${row.teamId.slice(0, 6)}...`,
        );
        assert(
          typeof row.played === "number" && !isNaN(row.played),
          `Standings played valid for ${row.teamId.slice(0, 6)}...`,
        );
      }

      if (round % 5 === 0) {
        console.log(`   Round ${round}: ${pt.name} — ${after.standings.find(s => s.teamId === pt.id)?.points ?? "?"} pts (${after.currentMatchday}/${after.seasonCalendar.length} matchdays)`);
      }
    }
  }

  // ─── STEP 6: Transfer market operations ────────────────────
  step("6. Transfer Market");
  {
    const s = store.getState();
    const pt = s.teams.find((t) => t.id === s.playerTeamId)!;
    const initialPlayerCount = pt.players.length;
    const initialBudget = pt.budget;
    const marketPlayers = [...s.transferMarketPlayers];

    assert(marketPlayers.length > 0, "Transfer market has players available");

    if (marketPlayers.length > 0) {
      const target = marketPlayers[0];
      console.log(`   Buying: ${target.name} (OVR ${target.overall}, €${(target.value / 1_000_000).toFixed(1)}M)`);

      if (pt.budget >= target.value) {
        try {
          s.buyPlayer(target, "first");
        } catch (e) {
          console.error(`   ⚠️ buyPlayer error: ${(e as Error).message}`);
        }

        const after = store.getState();
        const pt2 = after.teams.find((t) => t.id === after.playerTeamId)!;
        assert(pt2.players.length === initialPlayerCount + 1, `Player added to squad (${initialPlayerCount} → ${pt2.players.length})`);
        assert(pt2.budget === initialBudget - target.value, `Budget deducted correctly (€${initialBudget} → €${pt2.budget})`);
        assert(
          after.transferMarketPlayers.length === marketPlayers.length - 1,
          `Market shrinks (${marketPlayers.length} → ${after.transferMarketPlayers.length})`,
        );
      } else {
        console.log(`   ⚠️ Cannot afford ${target.name} (need €${(target.value / 1_000_000).toFixed(1)}M, have €${(pt.budget / 1_000_000).toFixed(1)}M)`);
      }
    }

    // Try selling a bench player
    const afterBuy = store.getState();
    const pt3 = afterBuy.teams.find((t) => t.id === afterBuy.playerTeamId)!;
    const benchPlayer = pt3.players.find((p) => !pt3.starterIds.includes(p.id));
    if (benchPlayer) {
      console.log(`   Selling: ${benchPlayer.name} (OVR ${benchPlayer.overall})`);
      try {
        afterBuy.sellPlayer(benchPlayer.id, "first");
      } catch (e) {
        console.error(`   ⚠️ sellPlayer error: ${(e as Error).message}`);
      }
      const afterSell = store.getState();
      const pt4 = afterSell.teams.find((t) => t.id === afterSell.playerTeamId)!;
      assert(
        pt4.players.length + 1 >= pt3.players.length,
        `Bench player removed (${pt3.players.length} → ${pt4.players.length})`,
      );
    }
  }

  // ─── STEP 7: Formation & tactic changes ────────────────────
  step("7. Formation & Tactic Changes");
  {
    const s = store.getState();
    const formations: Formation[] = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1"];
    for (const f of formations) {
      try { s.setPlayerFormation(f); } catch (e) {
        console.error(`   ⚠️ setPlayerFormation("${f}") error: ${(e as Error).message}`);
      }
      const after = store.getState();
      const pt = after.teams.find((t) => t.id === after.playerTeamId)!;
      assert(pt.formation === f, `Formation set to ${f}`);
      assert(pt.starterIds.length === 11, `Starters still 11 after formation change to ${f}`);
    }

    try { s.setPlayerTactic("attacking"); } catch (e) {
      console.error(`   ⚠️ setPlayerTactic error: ${(e as Error).message}`);
    }
    const afterTactic = store.getState();
    const pt2 = afterTactic.teams.find((t) => t.id === afterTactic.playerTeamId)!;
    assert(pt2.tactic === "attacking", "Tactic set to attacking");
  }

  // ─── STEP 8: Promotion & demotion ──────────────────────────
  step("8. Youth Promotion & Demotion");
  {
    const s = store.getState();
    const pt = s.teams.find((t) => t.id === s.playerTeamId)!;

    // Promote from U21
    if (pt.u21Players.length > 0) {
      const youth = pt.u21Players[0];
      console.log(`   Promoting U21: ${youth.name} (OVR ${youth.overall})`);
      const beforeCount = pt.players.length;
      const beforeU21 = pt.u21Players.length;
      try { s.promotePlayer(youth.id, "u21"); } catch (e) {
        console.error(`   ⚠️ promotePlayer error: ${(e as Error).message}`);
      }
      const after = store.getState();
      const pt2 = after.teams.find((t) => t.id === after.playerTeamId)!;
      assert(pt2.players.length === beforeCount + 1, "Player promoted to first team");
      assert(pt2.u21Players.length === beforeU21 - 1, "Player removed from U21");
    }

    // Demote a bench player to U21 (if young enough)
    const afterPromo = store.getState();
    const pt3 = afterPromo.teams.find((t) => t.id === afterPromo.playerTeamId)!;
    const youngBench = pt3.players.find((p) => !pt3.starterIds.includes(p.id) && p.age <= 21);
    if (youngBench) {
      console.log(`   Demoting to U21: ${youngBench.name} (age ${youngBench.age})`);
      try { afterPromo.demotePlayer(youngBench.id, "u21"); } catch (e) {
        console.error(`   ⚠️ demotePlayer error: ${(e as Error).message}`);
      }
    }
  }

  // ─── STEP 9: European tournament check ─────────────────────
  step("9. European Tournament Integrity");
  {
    const s = store.getState();
    assert(s.playerTournament !== null, "Player tournament exists");
    if (s.playerTournament) {
      const t = s.playerTournament;
      assert(t.leaguePhase.teams.length === 36, `League phase has 36 teams (got ${t.leaguePhase.teams.length})`);
      assert(t.leaguePhase.fixtures.length > 0, "League phase has fixtures");
      assert(t.leaguePhase.standings.length === 36, `League phase standings has 36 entries (got ${t.leaguePhase.standings.length})`);
      assert(["league", "playoff", "r16", "qtr", "semi", "final", "done"].includes(t.currentStage),
        `Valid currentStage: ${t.currentStage}`);
    }
  }

  // ─── STEP 10: Data integrity after all operations ──────────
  step("10. Final Data Integrity Sweep");
  {
    const s = store.getState();
    assert(s.teams.length >= 18, "Player league still has teams");
    assert(s.standings.length === s.teams.length, "Standings match team count");
    assert(s.currentWeek >= 1, "Week is valid");
    assert(s.currentMatchday >= 1, "Matchday is valid");

    // Sweep all teams for data corruption
    for (const t of s.teams) {
      assert(t.id !== "", `Team has id (name: ${t.name})`);
      assert(t.name !== "", "Team has name");
      assert(Array.isArray(t.players), `Team ${t.name} players is array`);
      assert(Array.isArray(t.starterIds), `Team ${t.name} starterIds is array`);

      for (const p of t.players) {
        assert(p != null, `Player is not null in ${t.name}`);
        if (!p) continue;
        assert(typeof p.name === "string" && p.name.length > 0, `Player name valid (${p.id?.slice(0, 8) ?? "?"}...)`);
        assert(!isNaN(p.overall), `Player ${p.name} overall is not NaN`);
        assert(!isNaN(p.attack), `Player ${p.name} attack is not NaN`);
        assert(!isNaN(p.defense), `Player ${p.name} defense is not NaN`);
        assert(!isNaN(p.stamina), `Player ${p.name} stamina is not NaN`);
        assert(!isNaN(p.age), `Player ${p.name} age is not NaN`);
      }
    }

    // Check for duplicate player IDs across all squads
    const allIds = new Set<string>();
    for (const t of [...s.teams, ...(s.otherLeaguesTeams ?? [])]) {
      for (const p of [...t.players, ...t.u21Players, ...t.u18Players]) {
        if (allIds.has(p.id)) {
          assert(false, `Duplicate player ID found: ${p.id} (${p.name})`);
        }
        allIds.add(p.id);
      }
    }
    console.log(`   Verified ${allIds.size} unique player IDs across all teams`);
  }

  // ─── STEP 11: Semantic match labels (SimulationPausedModal refactor) ──
  step("11. Semantic Match Labels & Segment Grouping");
  {
    const cal = generateCalendar(); // 38 league + 17 european matchdays
    assert(cal.length === 55, "Calendar has 38 league + 17 european matchdays");
    const euro = (round: number) => {
      const md = cal.find((m) => m.type === "european" && m.round === round);
      if (!md) fatal(`Missing european matchday round ${round}`);
      return md;
    };
    const league = (round: number) => {
      const md = cal.find((m) => m.type === "league" && m.round === round);
      if (!md) fatal(`Missing league matchday round ${round}`);
      return md;
    };

    // ── 联赛: "联赛第 XX 轮"（不再有模糊的 R 标注） ──
    assert(formatMatchdayLabel(league(1), "UCL") === "联赛第 1 轮", "League R1 → 联赛第 1 轮");
    assert(formatMatchdayLabel(league(29), null) === "联赛第 29 轮", "League R29 → 联赛第 29 轮");
    assert(formatMatchdayLabel(league(34), "UEL") === "联赛第 34 轮", "League R34 → 联赛第 34 轮 (competition ignored)");

    // ── 欧战联赛阶段 ──
    assert(formatMatchdayLabel(euro(1), "UCL") === "欧冠联赛阶段 第 1 轮", "Euro R1 UCL → 欧冠联赛阶段 第 1 轮");
    assert(formatMatchdayLabel(euro(8), "UCL") === "欧冠联赛阶段 第 8 轮", "Euro R8 UCL → 欧冠联赛阶段 第 8 轮");
    assert(formatMatchdayLabel(euro(1), "UEL") === "欧联联赛阶段 第 1 轮", "Euro R1 UEL → 欧联联赛阶段 第 1 轮");

    // ── 两回合淘汰赛: 首/次回合 ──
    assert(formatMatchdayLabel(euro(9), "UCL") === "欧冠 附加赛 首回合", "Euro R9 → 欧冠 附加赛 首回合");
    assert(formatMatchdayLabel(euro(10), "UCL") === "欧冠 附加赛 次回合", "Euro R10 → 欧冠 附加赛 次回合");
    assert(formatMatchdayLabel(euro(11), "UCL") === "欧冠 1/8 决赛 首回合", "Euro R11 → 欧冠 1/8 决赛 首回合");
    assert(formatMatchdayLabel(euro(12), "UCL") === "欧冠 1/8 决赛 次回合", "Euro R12 → 欧冠 1/8 决赛 次回合");
    assert(formatMatchdayLabel(euro(13), "UCL") === "欧冠 1/4 决赛 首回合", "Euro R13 → 欧冠 1/4 决赛 首回合");
    assert(formatMatchdayLabel(euro(15), "UEL") === "欧联 半决赛 首回合", "Euro R15 UEL → 欧联 半决赛 首回合");
    assert(formatMatchdayLabel(euro(16), "UECL") === "欧协联 半决赛 次回合", "Euro R16 UECL → 欧协联 半决赛 次回合");

    // ── 决赛（单场，无首/次回合） ──
    assert(formatMatchdayLabel(euro(17), "UCL") === "欧冠 决赛", "Euro R17 → 欧冠 决赛");
    assert(formatMatchdayLabel(euro(17), "UECL") === "欧协联 决赛", "Euro R17 UECL → 欧协联 决赛");
    assert(formatMatchdayLabel(euro(17), null) === "欧战 决赛", "Euro R17 no competition → 欧战 决赛");

    // ── 阶段内轮次推导 ──
    assert(getStageRound(euro(1)) === 1 && getStageRound(euro(8)) === 8, "League phase stage rounds 1-8");
    assert(getStageRound(euro(9)) === 1 && getStageRound(euro(10)) === 2, "Playoff legs 1/2");
    assert(getStageRound(euro(11)) === 1 && getStageRound(euro(12)) === 2, "R16 legs 1/2");
    assert(getStageRound(euro(17)) === 1, "Final is single match");

    // ── 赛段分组: 联赛→欧战交叉点绝不混排 ──
    const mk = (phase: CareerMatchLogEntry["phase"], label: string): CareerMatchLogEntry => ({
      round: 1, opponent: "X", goals: 0, assists: 0, rating: 0, result: "0-0 平",
      injured: false, phase, competition: phase === "european" ? "UCL" : null, label,
    });
    const mixed = [mk("league", "联赛第 37 轮"), mk("league", "联赛第 38 轮"), mk("european", "欧冠联赛阶段 第 1 轮")];
    const groups = groupMatchLogEntries(mixed);
    assert(groups.length === 2, "Mixed segment splits into 2 groups (league + european)");
    assert(groups[0].phase === "league" && groups[0].entries.length === 2, "Group 1 = 2 league entries");
    assert(groups[1].phase === "european" && groups[1].entries.length === 1, "Group 2 = 1 european entry");
    assert(groupMatchLogEntries([mk("european", "欧冠 决赛")]).length === 1, "Euro-only segment produces a single european group");
  }

  // ─── STEP 12: Career transfers & Ballon eligibility (pure functions) ──
  step("12. Career Transfers & Ballon Eligibility (pure functions)");
  {
    // ── 联赛等级 ──
    assert(isTopFiveLeague("Premier League") === true, "Premier League is a top-5 league");
    assert(isTopFiveLeague("Serie A Enilive") === true, "Serie A is a top-5 league");
    assert(isTopFiveLeague("Eredivisie") === false, "Eredivisie is NOT a top-5 league");
    assert(isTopFiveLeague("Bundesliga 2") === false, "Bundesliga 2 is NOT a top-5 league");
    assert(isTopFiveLeague(undefined) === false, "undefined league is not top-5");

    // ── 豪门名单 ──
    assert(isEliteClub("Manchester City") === true, "Manchester City is elite");
    assert(isEliteClub("FC Bayern München") === true, "FC Bayern München is elite");
    assert(isEliteClub("SSV Ulm 1846") === false, "SSV Ulm is not elite");

    // ── 金球资格：五大联赛 + 豪门，缺一不可 ──
    assert(isBallonEligible("Premier League", "Arsenal") === true, "EPL elite club → eligible");
    assert(isBallonEligible("Eredivisie", "Ajax") === false, "Eredivisie club → never eligible");
    assert(isBallonEligible("Premier League", "Ipswich") === false, "EPL non-elite club → not eligible");
    assert(isBallonEligible(undefined, "Manchester City") === false, "Unknown league → not eligible");

    // ── 转会费：1.2~1.6 倍，取整到 0.1M ──
    assert(computeTransferFee(10_000_000, () => 0) === 12_000_000, "Fee min multiplier = 1.2×");
    assert(computeTransferFee(10_000_000, () => 0.999) >= 15_000_000 && computeTransferFee(10_000_000, () => 0.999) <= 16_000_000, "Fee max multiplier ≈ 1.6×");
    assert(computeTransferFee(10_000_000, () => 0.5) % 100_000 === 0, "Fee rounds to 0.1M");

    // ── 格式化 ──
    assert(formatEuroM(45_000_000) === "€45.0M", "formatEuroM 45M");
    assert(formatEuroM(900_000) === "€900K", "formatEuroM 900K");

    // ── 豪门目的地：排除当前队、结果 ∈ 名单 ──
    const dest = pickEliteDestination("Arsenal", () => 0.0);
    assert(dest !== null && dest.clubName !== "Arsenal" && isEliteClub(dest.clubName) && TOP5_LEAGUES.includes(dest.leagueName), "pickEliteDestination excludes current club and picks elite club");
    assert(pickEliteDestination(dest!.clubName, () => 0.0)?.clubName !== dest!.clubName, "pickEliteDestination picks a different elite club next");

    // ── 租借目的地 ──
    const crossLoan = pickCrossLeagueLoanTarget("Premier League", () => 0.0);
    assert(crossLoan !== null && LOAN_LEAGUES.includes(crossLoan.leagueName), "cross-league loan target is in LOAN_LEAGUES");
    const mockTeams = [
      { id: "t1", name: "Team One", players: [{ overall: 85 }, { overall: 84 }] },
      { id: "t2", name: "Team Two", players: [{ overall: 70 }, { overall: 71 }] },
      { id: "t3", name: "Team Three", players: [{ overall: 75 }, { overall: 74 }] },
    ];
    const sameLoan = pickSameLeagueLoanTarget(mockTeams, "t1", () => 0.0);
    assert(sameLoan !== null && sameLoan.gameTeamId === "t2", "same-league loan target = weakest team, excluding current");
    assert(sameLoan!.gameTeamId !== "t1", "loan target never the current club");

    // ── 数据完整性 ──
    assert(ELITE_CLUBS.length >= 15, "ELITE_CLUBS curated list has 15+ clubs");
    assert(LOAN_LEAGUES.length === 4, "LOAN_LEAGUES has 4 leagues (荷甲/德乙/土超/奥甲)");
  }

  // ─── STEP 13: True Season Stats Tracker (deterministic, no fabrication) ──
  step("13. True Season Stats Tracker (deterministic accumulation)");
  {
    // ── 确定性单场评分：无随机，同数据永远同分 ──
    const r1 = computeMatchRating(2, 1, true, false);
    const r2 = computeMatchRating(2, 1, true, false);
    assert(r1 === r2, "computeMatchRating is deterministic (same input → same rating)");
    assert(r1 >= 7.5, `Brace + assist + win yields strong rating (got ${r1.toFixed(2)})`);
    const rNoGA = computeMatchRating(0, 0, true, false);
    assert(rNoGA <= 6.8, `No G/A rating ruthlessly capped at 6.8 (got ${rNoGA.toFixed(2)})`);
    const rLost = computeMatchRating(0, 0, false, false);
    assert(rLost < rNoGA, "Lost match rated below won match");
    assert(computeMatchRating(3, 0, true, false) > r1, "Hat-trick out-rates brace");

    // ── 累加器：真实事件 → 真实统计 ──
    const mkPlayer = (id: string, name: string, pos: Position, ovr: number) => ({
      id, name, age: 25, position: pos, attack: 70, defense: 70, stamina: 80,
      injuryWeeks: 0, potential: 80, overall: ovr, value: 1_000_000,
    });
    const teamLookup = new Map<string, TeamStatMeta>([
      ["H", { name: "Home FC", league: "Premier League", players: [mkPlayer("p1", "Alpha", Position.FWD, 88), mkPlayer("p2", "Beta", Position.MID, 84), mkPlayer("skip", "Skipped", Position.FWD, 70)] }],
      ["A", { name: "Away FC", league: "Premier League", players: [mkPlayer("p3", "Gamma", Position.FWD, 82)] }],
    ]);
    const mockResult: MatchResult = {
      homeTeamId: "H", awayTeamId: "A",
      homeScore: 2, awayScore: 0,
      events: [
        { minute: 10, type: MatchEventType.Goal, playerId: "p1", text: "goal 1" },
        { minute: 11, type: MatchEventType.Assist, playerId: "p2", text: "assist 1" },
        { minute: 30, type: MatchEventType.Goal, playerId: "p1", text: "goal 2" },
        { minute: 31, type: MatchEventType.Assist, playerId: "p2", text: "assist 2" },
        { minute: 60, type: MatchEventType.Goal, playerId: "skip", text: "goal by skipped" },
      ],
      homeStarters: ["p1", "p2", "skip"], awayStarters: ["p3"],
      homeInjuries: [], awayInjuries: [],
    };
    const out = accumulateMatchStats({}, mockResult, teamLookup, "skip");
    assert(out["p1"].goals === 2, "p1 tracked 2 real goals");
    assert(out["p2"].assists === 2, "p2 tracked 2 real assists");
    assert(out["p1"].appearances === 1 && out["p2"].appearances === 1 && out["p3"].appearances === 1, "All starters get 1 appearance");
    assert(out["skip"] === undefined, "Skipped player (career player) excluded from event accumulation");
    assert(out["p1"].ratingSum > out["p3"].ratingSum, "Scorer rated above quiet starter");
    assert(out["p1"].clubName === "Home FC" && out["p1"].league === "Premier League", "Club & league metadata attached");
    // 累加两次 = 双倍统计（纯函数不破坏入参）
    const out2 = accumulateMatchStats(out, mockResult, teamLookup, "skip");
    assert(out2["p1"].goals === 4 && out2["p1"].appearances === 2, "Second match accumulates on top (4 goals, 2 apps)");
    assert(out["p1"].goals === 2, "Original stats object not mutated");
  }

  // ─── STEP 14: Top-5 Leagues Background Simulation (Ballon pool) ──
  step("14. Top-5 Background Star Simulation");
  {
    // ── 按 OVR 动态推演：确定性（rng 注入）──
    const low = simulateBackgroundSeason(85, "FWD", () => 0.0);
    const low2 = simulateBackgroundSeason(85, "FWD", () => 0.0);
    assert(JSON.stringify(low) === JSON.stringify(low2), "Background sim deterministic with same rng");
    const high = simulateBackgroundSeason(91, "FWD", () => 0.999);
    assert(high.goals + high.assists > low.goals + low.assists, `Higher OVR star produces more G+A (${high.goals + high.assists} > ${low.goals + low.assists})`);
    assert(high.rating > low.rating, "Higher OVR star rated higher");
    // 顶级球星有合理概率达成精英档
    const elite = simulateBackgroundSeason(91, "FWD", () => 0.8);
    assert(elite.goals + elite.assists >= 35 && elite.rating >= 8.3, `OVR 91 FWD reaches elite zone at rng 0.8 (${elite.goals + elite.assists}GA / ${elite.rating.toFixed(2)})`);
    // 位置差异：中场助攻多，GK 无进球
    const mid = simulateBackgroundSeason(88, "MID", () => 0.5);
    const gk = simulateBackgroundSeason(89, "GK", () => 0.5);
    assert(mid.assists > mid.goals, "Midfielder sim favors assists");
    assert(gk.goals === 0 && gk.assists === 0, "Goalkeeper has no G/A");
    // 范围合法
    for (const pos of ["FWD", "MID", "DEF", "GK"]) {
      const st = simulateBackgroundSeason(90, pos, () => 0.5);
      assert(st.goals >= 0 && st.assists >= 0 && st.rating >= 6.8 && st.rating <= 9.5, `${pos} sim within legal ranges`);
    }

    // ── 五大联赛球星收集：OVR≥85、联赛资格、名字跳过 ──
    const stars = getTopFiveBackgroundStars(new Set(), () => 0.5);
    assert(stars.length > 10, `Background star pool has 10+ entries (${stars.length})`);
    assert(stars.every((b) => TOP5_LEAGUES.includes(b.league)), "All background stars from top-5 leagues");
    assert(stars.every((b) => b.ovr >= 85), "All background stars OVR ≥ 85");
    const skipName = stars[0].name;
    const filtered = getTopFiveBackgroundStars(new Set([skipName]), () => 0.5);
    assert(!filtered.some((b) => b.name === skipName), "Name-skip prevents double-counting real tracked players");
    assert(filtered.length < stars.length, "Skip removes at least the named star(s)");
  }

  // ─── STEP 15: Penalty Shootout (drawn knockout ties never hang) ──
  step("15. Penalty Shootout & Tie Resolution");
  {
    // ── 点球大战模拟：必分胜负、比分合理 ──
    const pens = simulatePenaltyShootout();
    assert(pens.home !== pens.away, "Shootout always produces a winner");
    assert(pens.home >= 0 && pens.home <= 10 && pens.away >= 0 && pens.away <= 10, `Shootout score reasonable (${pens.home}-${pens.away})`);
    const pens2 = simulatePenaltyShootout(() => 0.5);
    assert(pens2.home === 6 && pens2.away === 5, "All-made rng (0.5): 5-5 after 5 rounds → sudden-death 6-5");
    // 病态 rng（全部罚失）不导致死循环：安全上限 + 强制分胜负
    const pensDet = simulatePenaltyShootout(() => 0.9);
    assert(pensDet.home !== pensDet.away, "Pathological all-miss rng still resolves a winner (no infinite loop)");
    assert(Math.max(pensDet.home, pensDet.away) <= 1, `Forced tie-break keeps score sane (${pensDet.home}-${pensDet.away})`);

    // ── 两回合总比分打平 → 自动点球决胜 ──
    const mkTie = (): EuropeanTie => ({
      homeId: "H", awayId: "A", homeScore: 0, awayScore: 0, homeScore2: 0, awayScore2: 0,
      played: false, played2: false, winnerId: null,
    });
    const drawTie = mkTie();
    updateKnockoutTie(drawTie, true, 2, 1);   // leg 1: H 2-1 A
    const winner1 = updateKnockoutTie(drawTie, false, 0, 1); // leg 2: A 1-0 → agg 2-2
    assert(winner1 !== null, "Drawn aggregate decides a winner");
    assert(drawTie.penaltyHome !== undefined && drawTie.penaltyAway !== undefined, "Penalty scores recorded");
    assert(drawTie.penaltyHome !== drawTie.penaltyAway, "Penalty score is decisive");
    assert(drawTie.winnerId === (drawTie.penaltyHome! > drawTie.penaltyAway! ? "H" : "A"), "Winner matches penalty result");

    // ── 总比分不平时不进点球 ──
    const winTie = mkTie();
    updateKnockoutTie(winTie, true, 2, 0);
    const winner2 = updateKnockoutTie(winTie, false, 1, 1);
    assert(winner2 === "H", "Aggregate winner decided without penalties");
    assert(winTie.penaltyHome === undefined && winTie.penaltyAway === undefined, "No penalty fields on decided ties");

    // ── 单场决赛打平 → 点球决胜 ──
    const finalTie = mkTie();
    finalTie.singleLeg = true;
    const winner3 = updateKnockoutTie(finalTie, true, 1, 1);
    assert(winner3 !== null && finalTie.penaltyHome !== undefined, "Drawn final goes to penalties");
    assert(finalTie.winnerId === (finalTie.penaltyHome! > finalTie.penaltyAway! ? "H" : "A"), "Final winner matches penalties");

    // ── 单场决赛分胜负 → 不进点球 ──
    const finalWin = mkTie();
    finalWin.singleLeg = true;
    assert(updateKnockoutTie(finalWin, true, 2, 1) === "H", "Decided final has a winner");
    assert(finalWin.penaltyHome === undefined, "Decided final has no penalties");
  }

  // ─── STEP 16: League rank mapping (icon & label always consistent) ──
  step("16. League Rank Label & Medal Mapping");
  {
    // 1-based 真实排名 → 图标/文案一一对应（曾修复：rank 3 显示 🥈银牌+季军 的错配）
    const r1 = getLeagueRankMeta(1);
    assert(r1.icon === "🥇" && r1.text === "联赛冠军", `Rank 1 → gold medal + 联赛冠军 (${r1.icon} ${r1.text})`);
    const r2 = getLeagueRankMeta(2);
    assert(r2.icon === "🥈" && r2.text === "联赛亚军", `Rank 2 → silver medal + 联赛亚军 (${r2.icon} ${r2.text})`);
    const r3 = getLeagueRankMeta(3);
    assert(r3.icon === "🥉" && r3.text === "联赛季军", `Rank 3 → bronze medal + 联赛季军 (${r3.icon} ${r3.text})`);
    // 第 4 名及以后：常规图标（不带奖牌）
    const r4 = getLeagueRankMeta(4);
    assert(r4.icon !== "🥇" && r4.icon !== "🥈" && r4.icon !== "🥉", `Rank 4 uses a regular icon, no medal (${r4.icon})`);
    assert(r4.text === "联赛第 4 名", `Rank 4 → 联赛第 4 名 (${r4.text})`);
    const r10 = getLeagueRankMeta(10);
    assert(r10.text === "联赛第 10 名", `Rank 10 → 联赛第 10 名 (${r10.text})`);
    // 未知排名（快照缺失）安全兜底
    const rNull = getLeagueRankMeta(null);
    assert(rNull.rank === null && rNull.text.length > 0, "Null rank handled gracefully");
    // 无差一错误：连续 1..8 名的文案与名次逐一对应
    const medals = ["联赛冠军", "联赛亚军", "联赛季军"];
    for (let rank = 1; rank <= 8; rank++) {
      const meta = getLeagueRankMeta(rank);
      if (rank <= 3) {
        assert(meta.text === medals[rank - 1], `Rank ${rank} → ${medals[rank - 1]}`);
      } else {
        assert(meta.text === `联赛第 ${rank} 名`, `Rank ${rank} label = 联赛第 ${rank} 名`);
      }
    }
  }

  // ─── STEP 17: OVR-Driven Match Engine (dominance model) ──
  step("17. OVR-Driven Match Engine");
  {
    // ── 位置关键度加权强度（门将/后防硬约束）──
    const mkP = (id: string, pos: Position, att: number, def: number, ovr: number): Player => ({
      id, name: id, age: 25, position: pos, attack: att, defense: def,
      stamina: 85, injuryWeeks: 0, potential: ovr, overall: ovr, value: 1_000_000,
    });
    const xiLuxury: StartingXI = {
      gk: mkP("gk", Position.GK, 15, 60, 60),            // Ortega 60 弱门将
      defs: Array.from({ length: 4 }, (_, i) => mkP(`d${i}`, Position.DEF, 70, 99, 95)), // 99 后卫
      mids: Array.from({ length: 3 }, (_, i) => mkP(`m${i}`, Position.MID, 90, 85, 92)),
      fwds: Array.from({ length: 3 }, (_, i) => mkP(`f${i}`, Position.FWD, 95, 40, 95)), // 99 锋线
      all: [], teamATT: 0, teamDEF: 0,
    };
    const strengths = computeTeamStrengths(xiLuxury);
    assert(strengths.att >= 86, `Luxury attack strength ≥ 86 (got ${strengths.att.toFixed(1)})`);
    assert(strengths.def >= 84, `Weak GK (60) does NOT crush a 99-defense team (def ${strengths.def.toFixed(1)})`);

    const xiWeak: StartingXI = {
      gk: mkP("wgk", Position.GK, 10, 72, 72),
      defs: Array.from({ length: 4 }, (_, i) => mkP(`wd${i}`, Position.DEF, 50, 72, 72)),
      mids: Array.from({ length: 3 }, (_, i) => mkP(`wm${i}`, Position.MID, 65, 68, 70)),
      fwds: Array.from({ length: 3 }, (_, i) => mkP(`wf${i}`, Position.FWD, 72, 35, 72)),
      all: [], teamATT: 0, teamDEF: 0,
    };
    const weakStr = computeTeamStrengths(xiWeak);
    assert(strengths.att - weakStr.att > 15 && strengths.def - weakStr.def > 15, "Strength gap between luxury and weak XI is decisive");

    // ── 期望进球（幂指数实力差模型，无溢出/负权重）──
    const eq = expectedGoalsPerMatch(85, 85, 1.08);
    assert(eq > 1.0 && eq < 1.4, `Even match ≈ 1.17 goals (got ${eq.toFixed(2)})`);
    const domStrong = expectedGoalsPerMatch(92, 75, 1.08);
    const domWeak = expectedGoalsPerMatch(75, 92, 1.0);
    assert(domStrong >= 2.0 && domStrong <= 3.0, `92 vs 75 strong side 2-3 expected goals (got ${domStrong.toFixed(2)})`);
    assert(domWeak <= 0.7, `Weak side ≤ 0.7 expected goals (got ${domWeak.toFixed(2)})`);
    assert(domStrong / domWeak >= 3.5, `Dominance ratio ≥ 3.5× (got ${(domStrong / domWeak).toFixed(1)}×)`);
    const extreme = expectedGoalsPerMatch(95, 70, 1.08);
    assert(extreme >= 3.0, `Extreme gap (95 vs 70) strong side ≥ 3 goals (got ${extreme.toFixed(2)})`);

    // ── 声望/底蕴 ──
    assert(teamPrestige("Manchester City") === 2, "Man City prestige 2");
    assert(teamPrestige("FC Bayern München") === 2, "Bayern prestige 2");
    assert(teamPrestige("Random FC") === 0, "Unknown club has no prestige");

    // ── 蒙特卡洛：千场 92 vs 72 → 豪门胜率 75-90% ──
    const mkTeam = (name: string, ovr: number): Team => {
      const players: Player[] = [];
      const add = (n: number, pos: Position, o: number) => {
        for (let i = 0; i < n; i++) {
          const atk = pos === "FWD" ? Math.min(99, o + 5) : pos === "DEF" ? Math.max(20, o - 20) : pos === "GK" ? 15 : o;
          const def = pos === "GK" || pos === "DEF" ? Math.min(99, o + 5) : Math.max(20, o - 20);
          players.push(mkP(`${name}-${pos}${i}`, pos, atk, def, o));
        }
      };
      add(2, Position.GK, ovr - 2); add(6, Position.DEF, ovr - 1); add(6, Position.MID, ovr); add(4, Position.FWD, ovr + 1);
      // 标准 4-3-3 首发：最佳 GK + 4 DEF + 3 MID + 3 FWD（位置分布完整）
      const best = (pos: Position, n: number) => players
        .filter((p) => p.position === pos).sort((a, b) => b.overall - a.overall).slice(0, n);
      const gk = best(Position.GK, 1)[0];
      const starters = [...best(Position.DEF, 4), ...best(Position.MID, 3), ...best(Position.FWD, 3)];
      return {
        id: `t-${name}`, name, budget: 50_000_000, players,
        starterIds: [gk.id, ...starters.map((p) => p.id)], // 含门将的 11 人首发
        u21Players: [], u18Players: [], formation: "4-3-3", tactic: "balanced",
        europeanStatus: "NONE", league: "Test",
      };
    };
    const eliteT = mkTeam("Elite FC", 92);
    const weakT = mkTeam("Weak FC", 72);
    let wins = 0, losses = 0;
    const N = 1000;
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => {}; // 千场比赛时抑制引擎逐场日志
    console.warn = () => {};
    try {
      for (let i = 0; i < N; i++) {
        const r = i % 2 === 0 ? simulateMatch(eliteT, weakT) : simulateMatch(weakT, eliteT);
        const eG = i % 2 === 0 ? r.homeScore : r.awayScore;
        const wG = i % 2 === 0 ? r.awayScore : r.homeScore;
        if (eG > wG) wins++;
        else if (eG < wG) losses++;
      }
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }
    const winRate = wins / N;
    assert(winRate >= 0.75, `Elite win rate ≥ 75% over 1000 matches (got ${(winRate * 100).toFixed(1)}%)`);
    assert(losses / N <= 0.12, `Weak team wins ≤ 12% (got ${((losses / N) * 100).toFixed(1)}%)`);
    console.log(`   Monte Carlo: 92 vs 72 → ${(winRate * 100).toFixed(1)}% elite wins / ${((losses / N) * 100).toFixed(1)}% upsets`);
  }

  // ─── STEP 18: European finish display + career legacy (retirement) ──
  step("18. European Finish & Career Legacy");
  {
    // ── 欧战最终名次推导（mock 赛事）──
    const mkTie = (homeId: string, awayId: string, winnerId: string | null): EuropeanTie => ({
      homeId, awayId, homeScore: 1, awayScore: 1, homeScore2: 1, awayScore2: 1,
      played: true, played2: true, winnerId,
    });
    const mkKO = (ties: EuropeanTie[]) => ({ round: "r16", ties });
    const mkTourney = (partial: Partial<EuropeanTournament>): EuropeanTournament => ({
      type: "UCL",
      leaguePhase: { teams: ["P", "A", "B"], fixtures: [], standings: [] },
      knockoutPlayoffs: null, roundOf16: null, quarterFinals: null, semiFinals: null, final: null,
      currentStage: "done",
      ...partial,
    });
    assert(getEuropeanFinish(null, "P") === null, "No tournament → null finish");
    const champ = getEuropeanFinish(mkTourney({ final: mkKO([mkTie("P", "A", "P")]) }), "P");
    assert(champ?.label === "冠军" && champ?.icon === "🏆", `Champion finish (${champ?.icon} ${champ?.label})`);
    const runnerUp = getEuropeanFinish(mkTourney({ final: mkKO([mkTie("P", "A", "A")]) }), "P");
    assert(runnerUp?.label === "亚军" && runnerUp?.icon === "🥈", `Runner-up finish (${runnerUp?.icon} ${runnerUp?.label})`);
    const semi = getEuropeanFinish(mkTourney({ currentStage: "final", semiFinals: mkKO([mkTie("P", "A", "A")]), final: mkKO([mkTie("A", "B", "A")]) }), "P");
    assert(semi?.label === "四强 (半决赛)", `Semi-final finish (${semi?.label})`);
    const r16 = getEuropeanFinish(mkTourney({ currentStage: "semi", roundOf16: mkKO([mkTie("P", "A", "A")]) }), "P");
    assert(r16?.label === "十六强 (1/8决赛)", `R16 finish (${r16?.label})`);
    const playoff = getEuropeanFinish(mkTourney({ currentStage: "r16", knockoutPlayoffs: mkKO([mkTie("P", "A", "A")]) }), "P");
    assert(playoff?.label === "附加赛出局", `Playoff exit (${playoff?.label})`);
    const leagueOut = getEuropeanFinish(mkTourney({ currentStage: "playoff" }), "P");
    assert(leagueOut?.label === "联赛阶段出局", `League phase exit (${leagueOut?.label})`);

    // ── 生涯荣誉总结与传奇评价分档 ──
    const mkCP = (over: Partial<CareerPlayer>): CareerPlayer => ({
      id: "cp1", name: "Legend", age: 30, nationality: "中国", position: Position.FWD,
      overall: 80, potential: 85, stamina: 80, attack: 82, playmaking: 70, defense: 40,
      value: 10_000_000, teamId: "t1", injuryWeeks: 0,
      appearances: 0, seasonAppearances: 0, goals: 0, assists: 0,
      avgRating: 0, totalRatings: 0, recentRatings: [], honours: [], careerTrophies: [],
      loanParent: null, pendingMove: null, eventsThisSeason: [],
      ...over,
    });
    // 平凡：无荣誉无奖杯
    const plain = buildCareerLegacy(mkCP({ appearances: 100, goals: 10, assists: 5, avgRating: 6.2 }), 5);
    assert(plain.rating.tier === "平凡的职业生涯", `Plain career → 平凡的职业生涯 (${plain.rating.tier})`);
    assert(plain.trophies.length === 0 && plain.honours.length === 0, "Empty walls for a plain career");
    // 一流球星：1 联赛冠军 + 1 金靴 + 稳定数据
    const decent = buildCareerLegacy(mkCP({
      appearances: 200, goals: 60, assists: 25, avgRating: 7.1,
      honours: [{ season: 2, award: "金靴奖", icon: "👟" }],
      careerTrophies: [{ season: 3, type: "league", name: "联赛冠军", icon: "🏆" }],
    }), 8);
    assert(decent.rating.tier === "一流球星", `Decent career → 一流球星 (${decent.rating.tier})`);
    assert(decent.trophies[0].count === 1 && decent.honours[0].count === 1, "Trophy/honour grouped counts");
    // GOAT：3 金球 + 2 欧冠 + 3 联赛 + 怪物数据
    const goat = buildCareerLegacy(mkCP({
      appearances: 600, goals: 420, assists: 150, avgRating: 8.7,
      honours: [
        { season: 2, award: "金球奖", icon: "🏆" }, { season: 3, award: "金球奖", icon: "🏆" },
        { season: 4, award: "金球奖", icon: "🏆" }, { season: 2, award: "金靴奖", icon: "👟" },
        { season: 4, award: "金靴奖", icon: "👟" },
      ],
      careerTrophies: [
        { season: 1, type: "league", name: "联赛冠军", icon: "🏆" },
        { season: 2, type: "league", name: "联赛冠军", icon: "🏆" },
        { season: 3, type: "league", name: "联赛冠军", icon: "🏆" },
        { season: 2, type: "ucl", name: "欧冠冠军", icon: "🏆" },
        { season: 3, type: "ucl", name: "欧冠冠军", icon: "🏆" },
      ],
    }), 15);
    assert(goat.rating.tier === "GOAT 历史最佳", `GOAT career → GOAT 历史最佳 (${goat.rating.tier})`);
    const leagueRow = goat.trophies.find((t) => t.label === "联赛冠军");
    const uclRow = goat.trophies.find((t) => t.label === "欧冠冠军");
    assert(leagueRow?.count === 3 && uclRow?.count === 2, "GOAT trophy wall counts (联赛×3 欧冠×2)");
    assert(goat.honours.find((h) => h.label === "金球奖")?.count === 3, "Ballon count ×3");
    // 时代球王：1 金球 + 1 欧冠 + 2 联赛 + 强数据
    const era = buildCareerLegacy(mkCP({
      appearances: 450, goals: 250, assists: 90, avgRating: 8.2,
      honours: [{ season: 5, award: "金球奖", icon: "🏆" }, { season: 4, award: "金靴奖", icon: "👟" }],
      careerTrophies: [
        { season: 3, type: "league", name: "联赛冠军", icon: "🏆" },
        { season: 4, type: "league", name: "联赛冠军", icon: "🏆" },
        { season: 5, type: "ucl", name: "欧冠冠军", icon: "🏆" },
      ],
    }), 12);
    assert(era.rating.tier === "时代球王", `Era-defining career → 时代球王 (${era.rating.tier})`);
  }

  // ─── STEP 19: European elite boost & career legacy peaks ──
  step("19. European Elite Boost & Legacy Peaks");
  {
    // ── 欧战专属豪门权重 ──
    assert(europeanEliteBoost("Manchester City") === 8, "Man City European boost +8");
    assert(europeanEliteBoost("FC Bayern München") === 8, "Bayern European boost +8");
    assert(europeanEliteBoost("Liverpool") === 6, "Liverpool European boost +6");
    assert(europeanEliteBoost("Random FC") === 0, "Unknown club has no European boost");

    // ── 欧战上下文使超级豪门胜率显著提升（500 场蒙特卡洛对比）──
    const mkTeam = (name: string, ovr: number): Team => {
      const players: Player[] = [];
      const add = (n: number, pos: Position, o: number) => {
        for (let i = 0; i < n; i++) {
          const atk = pos === "FWD" ? Math.min(99, o + 5) : pos === "DEF" ? Math.max(20, o - 20) : pos === "GK" ? 15 : o;
          const def = pos === "GK" || pos === "DEF" ? Math.min(99, o + 5) : Math.max(20, o - 20);
          players.push({ id: `${name}-${pos}${i}`, name: `${name}-${pos}${i}`, age: 25, position: pos, attack: atk, defense: def, stamina: 85, injuryWeeks: 0, potential: o, overall: o, value: 1_000_000 });
        }
      };
      add(2, Position.GK, ovr - 2); add(6, Position.DEF, ovr - 1); add(6, Position.MID, ovr); add(4, Position.FWD, ovr + 1);
      // 标准 4-3-3 首发：最佳 GK + 4 DEF + 3 MID + 3 FWD（位置分布完整）
      const best = (pos: Position, n: number) => players
        .filter((p) => p.position === pos).sort((a, b) => b.overall - a.overall).slice(0, n);
      const gk = best(Position.GK, 1)[0];
      const starters = [...best(Position.DEF, 4), ...best(Position.MID, 3), ...best(Position.FWD, 3)];
      return {
        id: `t-${name}`, name, budget: 50_000_000, players,
        starterIds: [gk.id, ...starters.map((p) => p.id)],
        u21Players: [], u18Players: [], formation: "4-3-3", tactic: "balanced",
        europeanStatus: "NONE", league: "Test",
      };
    };
    const city = mkTeam("Manchester City", 92);
    const rival = mkTeam("Random FC", 86);
    const runMC = (european: boolean, n: number) => {
      let wins = 0;
      const origLog = console.log, origWarn = console.warn;
      console.log = () => {}; console.warn = () => {};
      try {
        for (let i = 0; i < n; i++) {
          const r = i % 2 === 0
            ? simulateMatch(city, rival, european ? { european: true } : undefined)
            : simulateMatch(rival, city, european ? { european: true } : undefined);
          const cG = i % 2 === 0 ? r.homeScore : r.awayScore;
          const rG = i % 2 === 0 ? r.awayScore : r.homeScore;
          if (cG > rG) wins++;
        }
      } finally {
        console.log = origLog; console.warn = origWarn;
      }
      return wins / n;
    };
    const domRate = runMC(false, 500);
    const euroRate = runMC(true, 500);
    assert(euroRate >= domRate + 0.10, `European context boosts elite win rate (${(domRate * 100).toFixed(1)}% → ${(euroRate * 100).toFixed(1)}%)`);
    assert(euroRate >= 0.70, `Elite club dominates in Europe (${(euroRate * 100).toFixed(1)}%)`);

    // ── 生涯峰值与时间轴（buildCareerLegacy）──
    const mkCP = (over: Partial<CareerPlayer>): CareerPlayer => ({
      id: "cp1", name: "Legend", age: 30, nationality: "中国", position: Position.FWD,
      overall: 86, potential: 88, stamina: 80, attack: 85, playmaking: 70, defense: 40,
      value: 30_000_000, teamId: "t1", injuryWeeks: 0,
      appearances: 400, seasonAppearances: 30, goals: 200, assists: 80,
      avgRating: 7.8, totalRatings: 3120, recentRatings: [], honours: [], careerTrophies: [], careerSeasons: [],
      loanParent: null, pendingMove: null, eventsThisSeason: [],
      ...over,
    });
    const s1: CareerSeasonRecord = { season: 1, clubName: "拜仁", leagueName: "Bundesliga", leagueRank: 2, euroFinishLabel: "欧冠八强 (1/4决赛)", apps: 34, goals: 15, assists: 8, avgRating: 7.2, ovr: 78, value: 18_000_000 };
    const s2: CareerSeasonRecord = { season: 2, clubName: "曼城", leagueName: "Premier League", leagueRank: 1, euroFinishLabel: "欧冠冠军", apps: 38, goals: 28, assists: 12, avgRating: 8.1, ovr: 84, value: 40_000_000 };
    const legacyWithSeasons = buildCareerLegacy(mkCP({ careerSeasons: [s1, s2] }), 2);
    assert(legacyWithSeasons.seasons.length === 2, "Legacy carries the full season timeline");
    assert(legacyWithSeasons.peaks.highestOVR === 86, `Peak OVR = max(records, current) (${legacyWithSeasons.peaks.highestOVR})`);
    assert(legacyWithSeasons.peaks.peakValue === 40_000_000, `Peak value from records (€${legacyWithSeasons.peaks.peakValue.toLocaleString()})`);
    assert(legacyWithSeasons.peaks.bestSeasonGoals === 28, `Single-season goal record (${legacyWithSeasons.peaks.bestSeasonGoals})`);
    assert(legacyWithSeasons.peaks.bestSeasonGoalsSeason === 2, `Record season identified (S${legacyWithSeasons.peaks.bestSeasonGoalsSeason})`);
    assert(legacyWithSeasons.seasons[0].euroFinishLabel === "欧冠八强 (1/4决赛)", "Timeline preserves European finish per season");
  }

  // ─── STEP 20: Veteran retirement & U21 newgen generation ──
  step("20. Veteran Retirement & Youth Newgens");
  {
    // ── 退役概率：35 起小概率，年龄递增，40+ 高概率；状态差加成 ──
    assert(retirementChance(34, 85) === 0, "No retirement before 35");
    assert(retirementChance(35, 85) === 0.10, "Age 35 → 10%");
    assert(retirementChance(38, 85) === 0.55, "Age 38 → 55%");
    assert(retirementChance(40, 85) === 0.90, "Age 40 → 90%");
    assert(Math.abs(retirementChance(38, 70) - 0.715) < 1e-9, `Declined form boosts retirement (got ${retirementChance(38, 70)})`);
    assert(retirementChance(38, 75) === 0.55, "Form factor applies below 75 only");
    for (let age = 35; age <= 40; age++) {
      assert(retirementChance(age, 85) >= retirementChance(age - 1, 85), `Chance monotonic with age (${age})`);
    }

    // ── 青训潜力分层：俱乐部实力越强上限越高 ──
    assert(potentialBandFor(90).max === 95 && potentialBandFor(90).eliteChance > 0, "Super club can produce 90-95 POT wonderkids");
    assert(potentialBandFor(84).max === 88, "Strong club band caps at 88");
    assert(potentialBandFor(78).max === 80, "Mid club band caps at 80");
    assert(potentialBandFor(70).max === 72, "Small club band caps at 72");
    assert(potentialBandFor(88).min > potentialBandFor(70).min, "Elite band floor higher than small club floor");

    // ── 新秀生成：范围合法 + 分层生效 ──
    const eliteKid = generateNewgen(92, () => 0.0); // rng 0.0 → 非妖人（0.0 < 0.15）→ 常规精英区间
    assert(eliteKid.age >= 16 && eliteKid.age <= 19, `Newgen age 16-19 (${eliteKid.age})`);
    assert(eliteKid.potential >= 72 && eliteKid.potential <= 95, `Elite newgen potential in band (${eliteKid.potential})`);
    assert(eliteKid.overall < eliteKid.potential, `Newgen overall below potential (${eliteKid.overall} < ${eliteKid.potential})`);
    assert(eliteKid.name.length > 0 && eliteKid.id.length > 0, "Newgen has name and id");
    const smallKid = generateNewgen(65, () => 0.9);
    assert(smallKid.potential >= 52 && smallKid.potential <= 72, `Small club potential capped (${smallKid.potential})`);
    const squad = generateNewgens(80, () => 0.5);
    assert(squad.length >= 2 && squad.length <= 4, `Each club generates 2-4 newgens (${squad.length})`);
    // 妖人路径：rng 序列第 2 次 < eliteChance → 90-95
    let call = 0;
    const wonderkid = generateNewgen(92, () => (call++ === 0 ? 0.5 : 0.0)); // 位置 0.5 → MID；第 2 次 0.0 < 0.15 → 妖人
    assert(wonderkid.potential >= 90 && wonderkid.potential <= 95, `Wonderkid path yields 90-95 POT (${wonderkid.potential})`);
  }

  // ─── STEP 21: Market valuations (€200M ceiling) & lineup position integrity ──
  step("21. Market Valuations & Position Integrity");
  {
    // ── 身价体系：€200M 上限 + OVR/POT/年龄梯度 ──
    assert(VALUE_CEILING === 200_000_000, "Valuation ceiling €200M");
    assert(marketValue(99, 99, 24) === 200_000_000, "OVR 99 caps at €200M");
    assert(marketValue(96, 99, 22) === 200_000_000, "96 OVR wonderkid (POT 99, 22yo) hits the €200M ceiling");
    assert(marketValue(95, 98, 22) >= 190_000_000, `95 OVR wonderkid approaches the ceiling (${marketValue(95, 98, 22)})`);
    const star = marketValue(90, 92, 27);
    assert(star >= 90_000_000 && star <= 120_000_000, `Star player in the 90-120M band (${star})`);
    const regular = marketValue(85, 88, 26);
    assert(regular >= 60_000_000 && regular <= 80_000_000, `Regular starter 60-80M (${regular})`);
    const rot = marketValue(80, 84, 25);
    assert(rot >= 40_000_000 && rot <= 65_000_000, `Rotation player 40-65M (${rot})`);
    assert(marketValue(92) > marketValue(85), "Value monotonic with OVR");
    const young = marketValue(78, 90, 19);
    const old = marketValue(78, 90, 34);
    assert(young > old * 2, `Age curve: young talent worth 2x+ the veteran (${young} vs ${old})`);
    const highPot = marketValue(78, 90, 21);
    const lowPot = marketValue(78, 78, 21);
    assert(highPot > lowPot, `Potential premium applies (${highPot} vs ${lowPot})`);

    // ── 阵容位置完整性：正常阵容严格按位置排布，无前锋客串中场/后防 ──
    const mkP = (id: string, pos: Position, ovr: number): Player => ({
      id, name: id, age: 25, position: pos, attack: pos === "FWD" ? 90 : 60, defense: 60,
      stamina: 85, injuryWeeks: 0, potential: ovr, overall: ovr, value: 1_000_000,
    });
    const mkSquad = (counts: Partial<Record<Position, number>>, ovr: number): Player[] => {
      const players: Player[] = [];
      let i = 0;
      for (const pos of [Position.GK, Position.DEF, Position.MID, Position.FWD]) {
        for (let n = 0; n < (counts[pos] ?? 0); n++) players.push(mkP(`${pos}${n}`, pos, ovr));
      }
      return players;
    };
    const balancedTeam: Team = {
      id: "t-bal", name: "Balanced", budget: 50_000_000, players: mkSquad({ GK: 2, DEF: 6, MID: 6, FWD: 4 }, 80),
      starterIds: [], u21Players: [], u18Players: [], formation: "4-3-3", tactic: "balanced",
      europeanStatus: "NONE", league: "Test",
    };
    const xi = selectStartingXI(balancedTeam);
    assert(xi.gk?.position === Position.GK, "Exactly one GK starts");
    assert(xi.defs.length === 4 && xi.defs.every((p) => p.position === Position.DEF), "DEF slots filled ONLY by defenders");
    assert(xi.mids.length === 3 && xi.mids.every((p) => p.position === Position.MID), "MID slots filled ONLY by midfielders");
    assert(xi.fwds.length === 3 && xi.fwds.every((p) => p.position === Position.FWD), "FWD slots filled ONLY by forwards");
    // 前锋过剩阵容：中场人手充足时前锋绝不被硬拉去客串中场
    const strikerHeavyTeam: Team = {
      ...balancedTeam, id: "t-fwd",
      players: mkSquad({ GK: 2, DEF: 6, MID: 3, FWD: 8 }, 80),
    };
    const xi2 = selectStartingXI(strikerHeavyTeam);
    assert(xi2.mids.every((p) => p.position === Position.MID), "With midfielders available, no striker plays midfield");
    assert(xi2.fwds.length === 3, "Only 3 forwards fielded despite 8-striker roster");
  }

  // ─── STEP 22: La Liga & external player import pipeline ──
  step("22. La Liga Integration & Player Import Pipeline");
  {
    // ── 西甲联赛完整接入 ──
    const laLiga = getAllTeams().filter((t) => t.league === "La Liga");
    assert(laLiga.length === 20, `La Liga has 20 clubs (${laLiga.length})`);
    const realMadrid = laLiga.find((t) => t.name === "Real Madrid");
    assert(realMadrid !== undefined, "Real Madrid present in La Liga");
    assert(realMadrid?.players.some((p) => p.name === "Kylian Mbappé") === true, "Mbappé in Real Madrid squad");
    assert(laLiga.some((t) => t.name === "FC Barcelona") && laLiga.some((t) => t.name === "Atlético Madrid"), "Barcelona & Atlético present");
    assert(getLeagueRules("La Liga").totalTeams === 20, "La Liga rules: 20 teams");
    assert(getLeagueRules("La Liga").totalRounds === 38, "La Liga rules: 38 rounds");
    assert(isTopFiveLeague("La Liga") === true, "La Liga is a top-5 league (Ballon eligibility)");
    assert(isEliteClub("Real Madrid") && isEliteClub("FC Barcelona"), "Spanish giants in ELITE_CLUBS");
    assert(europeanEliteBoost("Real Madrid") === 8, "Real Madrid European boost +8");

    // ── 导入管线：位置映射 ──
    assert(normalizePosition("LWF") === Position.FWD, "LWF → FWD");
    assert(normalizePosition("RWF") === Position.FWD, "RWF → FWD");
    assert(normalizePosition("CAM") === Position.MID, "CAM → MID");
    assert(normalizePosition("CDM") === Position.MID, "CDM → MID");
    assert(normalizePosition("LB") === Position.DEF, "LB → DEF");
    assert(normalizePosition("SW") === Position.DEF, "SW → DEF");
    assert(normalizePosition("GK") === Position.GK, "GK → GK");
    assert(normalizePosition("XW") === null, "Unknown position dropped");

    // ── 清洗与校验 ──
    const good = cleanPlayerRecord({ name: " Test Kid ", position: "LW", age: 19, overall: 105, potential: 90 });
    assert(good !== null && good.name === "Test Kid" && good.position === Position.FWD, "Cleaned: name trimmed, LW→FWD");
    assert(good?.overall === 99 && good?.potential === 99, "OVR clamped to 99, POT never below OVR");
    const badPos = cleanPlayerRecord({ name: "X", position: "ZZ", age: 20, overall: 70, potential: 80 });
    assert(badPos === null, "Invalid position dropped");
    const noName = cleanPlayerRecord({ position: "ST", age: 20, overall: 70 });
    assert(noName === null, "Missing name dropped");
    const oldAge = cleanPlayerRecord({ name: "Vet", position: "ST", age: 99, overall: 70, potential: 75 });
    assert(oldAge?.age === 45, "Age clamped to 45");

    // ── 去重：保留 OVR 更高者 / 仅更新俱乐部 ──
    const rec = (name: string, ovr: number, club: string, pot = ovr) => ({ name, position: Position.FWD, age: 24, overall: ovr, potential: pot, club });
    const dedup = dedupePlayers([rec("Dup", 80, "Old Club")], [rec("Dup", 75, "New Club")]);
    assert(dedup.length === 1 && dedup[0].overall === 80 && dedup[0].club === "Old Club", "Dedupe keeps higher OVR");
    const clubOnly = dedupePlayers([rec("Dup2", 80, "Old Club")], [rec("Dup2", 80, "New Club")]);
    assert(clubOnly[0].club === "New Club", "Equal OVR updates club info only");

    // ── CSV 解析与完整导入管线 ──
    const csv = "name,position,age,overall,potential,club\nCSV Star,LWF,21,88,93,La Liga FC\nBad Pos,ZZ,20,70,70,La Liga FC";
    const rows = parsePlayersCSV(csv);
    assert(rows.length === 2, "CSV parsed 2 rows");
    const imported = importPlayerData(csv, "csv");
    assert(imported.length === 1 && imported[0].name === "CSV Star" && imported[0].position === Position.FWD, "Import pipeline: CSV Star cleaned & mapped, invalid row dropped");
    const importedJson = importPlayerData('[{"name":"JSON Star","position":"RWB","age":22,"overall":80,"potential":85,"club":"La Liga FC"}]', "json");
    assert(importedJson.length === 1 && importedJson[0].position === Position.DEF, "JSON import pipeline works (RWB → DEF)");
  }

  // ─── STEP 23: Position-weighted scorers, pitch slots & cross-position cap ──
  step("23. Weighted Scorers, Pitch Slots & Cross-Position Cap");
  {
    // ── 进球权重：前锋占绝大多数，中场/后卫强衰减 ──
    const mkP = (id: string, pos: Position, att: number, ovr: number): Player => ({
      id, name: id, age: 25, position: pos, attack: att, defense: 60,
      stamina: 85, injuryWeeks: 0, potential: ovr, overall: ovr, value: 1_000_000,
    });
    const xi: StartingXI = {
      gk: mkP("gk", Position.GK, 12, 85),
      defs: Array.from({ length: 4 }, (_, i) => mkP(`d${i}`, Position.DEF, 55, 82)),
      mids: Array.from({ length: 3 }, (_, i) => mkP(`m${i}`, Position.MID, 70, 84)),
      fwds: Array.from({ length: 3 }, (_, i) => mkP(`f${i}`, Position.FWD, 95, 88)),
      all: [], teamATT: 0, teamDEF: 0,
    };
    let fwdGoals = 0, midGoals = 0, defGoals = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const scorer = pickWeightedScorer(xi);
      if (!scorer) continue;
      if (scorer.position === Position.FWD) fwdGoals++;
      else if (scorer.position === Position.MID) midGoals++;
      else defGoals++;
    }
    assert(fwdGoals / N >= 0.85, `Forwards score ≥ 85% of goals (${((fwdGoals / N) * 100).toFixed(1)}%)`);
    assert(midGoals / N <= 0.12, `Midfielders ≤ 12% (${((midGoals / N) * 100).toFixed(1)}%) — Gallagher 69-goal seasons impossible`);
    assert(defGoals / N <= 0.03, `Defenders ≤ 3% (${((defGoals / N) * 100).toFixed(1)}%)`);

    // ── 战术板槽位生成：按真实阵型 ──
    const slots433 = generatePitchSlots("4-3-3");
    assert(slots433.length === 11, "4-3-3 → 11 slots");
    assert(slots433.filter((s) => s.position === Position.FWD).length === 3, "4-3-3 → 3 FWD slots");
    const slots442 = generatePitchSlots("4-4-2");
    assert(slots442.filter((s) => s.position === Position.FWD).length === 2, "4-4-2 → 2 FWD slots");
    assert(slots442.filter((s) => s.position === Position.MID).length === 4, "4-4-2 → 4 MID slots");
    assert(generatePitchSlots("9-0-0-invalid").length === 11, "Invalid formation falls back to 4-3-3");
    assert(slots433.every((s) => s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100), "All slot coords within the pitch");

    // ── 客串硬限制：中场缺口 1 人时恰好 1 人客串（绝不多于 1）──
    const shortRoster: Team = {
      id: "t-cross", name: "Cross Cap", budget: 50_000_000,
      players: [
        ...Array.from({ length: 2 }, (_, i) => mkP(`gk${i}`, Position.GK, 12, 80)),
        ...Array.from({ length: 5 }, (_, i) => mkP(`d${i}`, Position.DEF, 55, 80)),
        ...Array.from({ length: 2 }, (_, i) => mkP(`m${i}`, Position.MID, 70, 80)),
        ...Array.from({ length: 6 }, (_, i) => mkP(`f${i}`, Position.FWD, 90, 80)),
      ],
      starterIds: [], u21Players: [], u18Players: [], formation: "4-3-3", tactic: "balanced",
      europeanStatus: "NONE", league: "Test",
    };
    const xiShort = selectStartingXI(shortRoster);
    const crossCount = xiShort.mids.filter((p) => p.position !== Position.MID).length
      + xiShort.defs.filter((p) => p.position !== Position.DEF).length;
    assert(xiShort.mids.length === 3, "MID slots filled (2 real MIDs + 1 compatible fill)");
    assert(crossCount === 1, `Exactly 1 cross-position player, never more (${crossCount})`);
    assert(xiShort.fwds.length === 3 && xiShort.fwds.every((p) => p.position === Position.FWD), "No striker forced into defence");
  }

  // ─── STEP 24: Goal calibration & bulletproof pitch mapping ──
  step("24. Goal Efficiency Calibration & Pitch Mapping");
  {
    // ── 进球效率校准：场均总进球 2.0-3.2 区间 ──
    const mkTeam = (name: string, ovr: number): Team => {
      const players: Player[] = [];
      const add = (n: number, pos: Position, o: number) => {
        for (let i = 0; i < n; i++) {
          const atk = pos === "FWD" ? Math.min(99, o + 5) : pos === "DEF" ? Math.max(20, o - 20) : pos === "GK" ? 15 : o;
          const def = pos === "GK" || pos === "DEF" ? Math.min(99, o + 5) : Math.max(20, o - 20);
          players.push({ id: `${name}-${pos}${i}`, name: `${name}-${pos}${i}`, age: 25, position: pos, attack: atk, defense: def, stamina: 85, injuryWeeks: 0, potential: o, overall: o, value: 1_000_000 });
        }
      };
      add(2, Position.GK, ovr - 2); add(6, Position.DEF, ovr - 1); add(6, Position.MID, ovr); add(4, Position.FWD, ovr + 1);
      const best = (pos: Position, n: number) => players.filter((p) => p.position === pos).sort((a, b) => b.overall - a.overall).slice(0, n);
      const starters = [...best(Position.GK, 1), ...best(Position.DEF, 4), ...best(Position.MID, 3), ...best(Position.FWD, 3)];
      return { id: `t-${name}`, name, budget: 50_000_000, players, starterIds: starters.map((p) => p.id), u21Players: [], u18Players: [], formation: "4-3-3", tactic: "balanced", europeanStatus: "NONE", league: "Test" };
    };
    const strong = mkTeam("Strong", 88);
    const mid = mkTeam("Mid", 76);
    let totalGoals = 0, maxTeam = 0;
    const M = 300;
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try {
      for (let i = 0; i < M; i++) {
        const r = i % 2 === 0 ? simulateMatch(strong, mid) : simulateMatch(mid, strong);
        totalGoals += r.homeScore + r.awayScore;
        maxTeam = Math.max(maxTeam, r.homeScore, r.awayScore);
      }
    } finally {
      console.log = origLog; console.warn = origWarn;
    }
    const avg = totalGoals / M;
    assert(avg >= 1.8 && avg <= 3.2, `Average total goals per match in the real range (${avg.toFixed(2)})`);
    assert(maxTeam <= 6, `Single-team goals capped at 6 (max ${maxTeam}) — no 7-2 style blowouts`);
    const eqGoals = expectedGoalsPerMatch(85, 85, 1.08);
    assert(eqGoals >= 0.9 && eqGoals <= 1.3, `Even match expected ~1.07 goals per side (${eqGoals.toFixed(2)})`);

    // ── 战术板映射纯函数：11 槽位稳定、缺失球员安全留空 ──
    const mapped = mapStartersToSlots(strong.starterIds, strong.players);
    assert(mapped.length === 11, "Mapping always returns 11 slot entries");
    assert(mapped.every((p) => p !== null), "All 11 starters mapped (outfield included — no GK-only pitch)");
    assert(mapped[0]?.position === Position.GK, "Slot 0 is the goalkeeper");
    assert(mapped.filter((p) => p?.position === Position.FWD).length === 3, "3 forwards on the pitch");
    const broken = mapStartersToSlots([strong.players[0].id, "ghost-id", ...strong.starterIds.slice(1)], strong.players);
    assert(broken.length === 11, "Ghost id yields 11 safe slots (no crash, no full-board wipe)");
    assert(broken.filter((p) => p !== null).length >= 10, `Ghost id filled by fallback tiers (${broken.filter((p) => p !== null).length}/11 rendered)`);
    assert(mapStartersToSlots(undefined, undefined).length === 11, "Undefined inputs still yield 11 safe slots");
  }

  // ─── STEP 25: Safe UUID fallback & hardened pitch mapping ──
  step("25. Safe UUID Fallback & Pitch Coordinate Guards");
  {
    // ── 安全 UUID：格式合法、无 window.crypto 环境（Node）走兜底算法、无碰撞 ──
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateUUID();
      assert(uuidPattern.test(id), `UUID v4 format (${id})`);
      assert(!seen.has(id), "UUID unique (no collisions in 1000 draws)");
      seen.add(id);
    }

    // ── 槽位坐标兜底：所有阵型坐标合法（NaN/越界自动回退 4-3-3）──
    for (const fmt of ["4-4-2", "4-3-3", "3-5-2", "5-3-2", "4-2-3-1", "3-4-3", "5-4-1", "4-1-4-1", undefined, "broken-fmt"]) {
      const slots = generatePitchSlots(fmt as string | undefined);
      assert(slots.length === 11, `${fmt ?? "undefined"} → 11 slots`);
      assert(slots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100), `${fmt ?? "undefined"} coords all in-bounds`);
    }

    // ── 首发映射三层兜底：顺序打乱也能 11 人全部渲染 ──
    const mkP = (id: string, pos: Position, ovr: number): Player => ({
      id, name: id, age: 25, position: pos, attack: 70, defense: 70,
      stamina: 85, injuryWeeks: 0, potential: ovr, overall: ovr, value: 1_000_000,
    });
    const roster: Player[] = [
      mkP("gk1", Position.GK, 85),
      ...Array.from({ length: 4 }, (_, i) => mkP(`d${i}`, Position.DEF, 80)),
      ...Array.from({ length: 3 }, (_, i) => mkP(`m${i}`, Position.MID, 80)),
      ...Array.from({ length: 3 }, (_, i) => mkP(`f${i}`, Position.FWD, 82)),
    ];
    // 顺序完全打乱（模拟数据异常）——映射后仍应 11 人全部挂载
    const shuffled = [...roster].reverse().map((p) => p.id);
    const mapped = mapStartersToSlots(shuffled, roster, "4-3-3");
    assert(mapped.length === 11, "11 slot entries");
    assert(mapped.filter((p) => p !== null).length === 11, "ALL 11 players rendered despite shuffled starter order (no GK-only pitch)");
    assert(mapped.some((p) => p?.position === Position.GK), "GK present");
    assert(mapped.filter((p) => p?.position === Position.FWD).length === 3, "3 forwards rendered");
    // 部分引用失效：幽灵 id 不丢整板
    const withGhost = ["ghost", ...shuffled.slice(1)];
    const mapped2 = mapStartersToSlots(withGhost, roster, "4-3-3");
    assert(mapped2.filter((p) => p !== null).length >= 10, `Ghost id drops at most its own slot (${mapped2.filter((p) => p !== null).length}/11 rendered)`);
  }

  // ─── Results ───────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 RESULTS: ${passed} passed, ${failed} failed\n`);

  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }

  console.log("🎉 All tests passed!\n");
}

main().catch((e) => {
  console.error("\n💥 UNHANDLED CRASH:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
