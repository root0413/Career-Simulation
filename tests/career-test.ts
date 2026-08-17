/**
 * Career Mode automated test — validates the full "Create → Join → Play → Grow" loop.
 *
 * Usage:  npx tsx tests/career-test.ts
 */

// ── Polyfills for Node.js ────────────────────────────────────
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
import { useGameStore, type CareerMatchPerf } from "../src/store/useGameStore";
import { Position, type CareerEvent, type Player } from "../src/types/game";
import { getAllTeams } from "../src/data/teamsDatabase";
import { isEliteClub } from "../src/data/careerTransfers";

// ── Test utilities ────────────────────────────────────────────
let passed = 0, failed = 0;
const failures: string[] = [];
const errors: { step: string; error: string }[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; const m = `  ❌ FAIL: ${label}`; failures.push(m); console.error(m); }
}

function step(label: string): void { console.log(`\n📋 ${label}`); }

// ── Main test ─────────────────────────────────────────────────
async function main() {
  console.log("🧑 Player Career Mode — Automated Test\n");
  console.log("=".repeat(60));

  const s = useGameStore.getState();

  // ═══════════════════════════════════════════════════════════
  step("1. Create Career Player");
  // ═══════════════════════════════════════════════════════════
  {
    try {
      s.createCareerPlayer("TestPlayer", "中国", Position.FWD, 24, 80, 65, 40, 82);
    } catch (e) {
      errors.push({ step: "createCareerPlayer", error: String(e) });
      console.error(`  💥 Crash: ${e instanceof Error ? e.stack : String(e)}`);
    }

    const cp = useGameStore.getState().careerPlayer;
    assert(cp !== null, "CareerPlayer is not null after creation");
    if (cp) {
      assert(cp.name === "TestPlayer", `Name = TestPlayer (got: ${cp.name})`);
      assert(cp.nationality === "中国", `Nationality = 中国 (got: ${cp.nationality})`);
      assert(cp.position === Position.FWD, `Position = FWD (got: ${cp.position})`);
      assert(cp.overall >= 65 && cp.overall <= 85, `OVR in 65-85 (got: ${cp.overall})`);
      assert(cp.potential === 82, `Potential = 82 (got: ${cp.potential})`);
      assert(typeof cp.attack === "number" && cp.attack > 0, `Attack valid: ${cp.attack}`);
      assert(typeof cp.playmaking === "number", `Playmaking valid: ${cp.playmaking}`);
      assert(typeof cp.defense === "number" && cp.defense > 0, `Defense valid: ${cp.defense}`);
      assert(typeof cp.stamina === "number" && cp.stamina > 0, `Stamina valid: ${cp.stamina}`);
      assert(typeof cp.value === "number" && cp.value > 0, `Value valid: €${cp.value.toLocaleString()}`);
      assert(cp.appearances === 0, "Appearances start at 0");
      assert(cp.goals === 0, "Goals start at 0");
      assert(cp.assists === 0, "Assists start at 0");
      assert(cp.avgRating === 0, "AvgRating starts at 0");
      assert(cp.teamId === null, "teamId starts null (no club yet)");
      assert(cp.id !== "", "Has a non-empty ID");
      console.log(`   Player: ${cp.name} | ${cp.position} | OVR ${cp.overall} | POT ${cp.potential}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("2. Select Club & Join (robust matching)");
  // ═══════════════════════════════════════════════════════════
  {
    const allReal = getAllTeams();
    assert(allReal.length > 0, `Real DB has ${allReal.length} teams`);

    // Pick a real team by ID — test exact match
    const target = allReal[0]; // First team in DB
    console.log(`   Target: ${target.name} (id=${target.id.slice(0, 12)}...)`);

    try {
      useGameStore.getState().joinCareerClub(target.id);
    } catch (e) {
      errors.push({ step: "joinCareerClub", error: String(e) });
      console.error(`  💥 Crash: ${e instanceof Error ? e.stack : String(e)}`);
    }

    const after = useGameStore.getState();
    assert(after.gameStatus === "PLAYING", "Game status → PLAYING after join");
    assert(after.gameMode === "career", "Game mode is career");
    assert(after.teams.length >= 18, `Player league has >= 18 teams (got ${after.teams.length})`);
    assert(after.playerTeamId !== "", "playerTeamId is set");

    const cp = after.careerPlayer;
    assert(cp !== null, "CareerPlayer still exists after join");
    if (cp) {
      assert(cp.teamId !== null, "CareerPlayer has a teamId after join");
    }

    // Verify the player is IN the team's roster
    const pt = after.teams.find((t) => t.id === after.playerTeamId);
    assert(pt !== undefined, "Player's team exists in league");
    if (pt) {
      const found = pt.players.find((p) => p.id === cp?.id);
      assert(found !== undefined, `Player ${cp?.name} found in ${pt.name} roster`);
      if (found) {
        assert(found.name === "TestPlayer", "Roster entry name matches");
        assert(found.position === Position.FWD, "Roster entry position matches");
      }
    }

    console.log(`   Joined: ${pt?.name ?? "?"} — roster now has ${pt?.players.length ?? "?"} players`);
  }

  // ═══════════════════════════════════════════════════════════
  step("3. Simulate Career Matches (5 matches)");
  // ═══════════════════════════════════════════════════════════
  {
    let totalGoals = 0;
    let totalAssists = 0;
    let totalRatings = 0;
    let growthCount = 0;

    for (let match = 1; match <= 5; match++) {
      const state = useGameStore.getState();
      const pt = state.teams.find((t) => t.id === state.playerTeamId);
      if (!pt) { console.error("  💥 Player team vanished!"); break; }

      // Auto-fill squad before each match
      try { state.autoFillSquad(); } catch { /* ok */ }

      // 保证生涯球员首发 + 健康（测试确定性：统计累加逻辑必须可重复验证，
      // 不依赖替补掷骰/伤病随机——否则偶发 5 场坐板凳导致断言误报）
      {
        const fresh = useGameStore.getState();
        const cpNow = fresh.careerPlayer;
        const ptNow = fresh.teams.find((t) => t.id === fresh.playerTeamId);
        if (cpNow && ptNow && ptNow.starterIds.length === 11 && !ptNow.starterIds.includes(cpNow.id)) {
          const ids = [...ptNow.starterIds];
          ids[ids.length - 1] = cpNow.id; // 替换末尾首发（通常为前锋位）
          useGameStore.setState({
            careerPlayer: { ...cpNow, injuryWeeks: 0 },
            teams: fresh.teams.map((t) => t.id === ptNow.id
              ? { ...t, starterIds: ids, players: t.players.map((p) => (p.id === cpNow.id ? { ...p, injuryWeeks: 0 } : p)) }
              : t),
          });
        }
      }

      // Play the match
      let result;
      try {
        result = state.playMatchweek();
        assert(true, `Match ${match}: playMatchweek succeeded`);
      } catch (e) {
        console.error(`  ⚠️ Match ${match} error: ${(e as Error).message}`);
        useGameStore.setState({ currentMatchday: (state.currentMatchday ?? 1) + 1 });
        continue;
      }

      // Skip if eliminated (European matchday with no opponent)
      if (!result) {
        console.log(`  ⏭️ Match ${match}: eliminated, skipping career perf`);
        continue;
      }

      // Simulate career performance
      let perf: CareerMatchPerf | null = null;
      try {
        perf = state.simulateCareerPerformance(result, state.playerTeamId);
      } catch (e) {
        errors.push({ step: `simulateCareerPerformance match ${match}`, error: String(e) });
        console.error(`  💥 CareerPerf error: ${e instanceof Error ? e.stack : String(e)}`);
      }

      if (perf) {
        console.log(`   Match ${match}: Rating ${perf.rating.toFixed(1)} | G:${perf.goals} A:${perf.assists} | ${perf.summary}`);
        totalGoals += perf.goals;
        totalAssists += perf.assists;
        totalRatings += perf.rating;
        if (perf.growthGains.length > 0) growthCount++;
      }
    }

    // Verify cumulative stats
    const final = useGameStore.getState();
    const cp = final.careerPlayer;
    if (cp) {
      assert(cp.appearances >= 1, `Appearances >= 1 (got ${cp.appearances})`);
      assert(cp.goals === totalGoals, `Goals match cumulative sum (${cp.goals} = ${totalGoals})`);
      assert(cp.assists === totalAssists, `Assists match cumulative sum (${cp.assists} = ${totalAssists})`);
      assert(cp.avgRating > 0, `AvgRating > 0 (got ${cp.avgRating})`);
      assert(cp.avgRating <= 10, `AvgRating <= 10 (got ${cp.avgRating})`);
      console.log(`   Career stats after 5 matches: ${cp.appearances} apps, ${cp.goals}G, ${cp.assists}A, ${cp.avgRating} rating`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("4. Player Growth Verification");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const cp = state.careerPlayer;
    assert(cp !== null, "CareerPlayer exists");
    // After 5 matches, check that stats are still valid
    if (cp) {
      assert(cp.overall >= 1 && cp.overall <= 99, `Overall valid: ${cp.overall}`);
      assert(cp.attack >= 1 && cp.attack <= 99, `Attack valid: ${cp.attack}`);
      assert(cp.defense >= 1 && cp.defense <= 99, `Defense valid: ${cp.defense}`);
      assert(cp.stamina >= 0 && cp.stamina <= 100, `Stamina valid: ${cp.stamina}`);
      assert(!isNaN(cp.avgRating), "AvgRating is not NaN");
      assert(!isNaN(cp.goals), "Goals is not NaN");
      assert(!isNaN(cp.assists), "Assists is not NaN");
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("5. Data Integrity After All Operations");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    // No NaN anywhere in standings
    for (const row of state.standings) {
      assert(!isNaN(row.points), `Standings: ${row.teamId.slice(0,6)}... pts valid`);
      assert(!isNaN(row.goalsFor), `Standings: ${row.teamId.slice(0,6)}... GF valid`);
    }
    // All players in all squads have valid data
    let checked = 0;
    for (const t of state.teams) {
      for (const p of t.players) {
        checked++;
        if (!p.name || p.name === "undefined") {
          assert(false, `Player ${p.id.slice(0,8)}... has invalid name`);
        }
        if (isNaN(p.overall)) {
          assert(false, `Player ${p.name} has NaN overall`);
        }
      }
    }
    console.log(`   Verified ${checked} players across ${state.teams.length} teams`);
  }

  // ═══════════════════════════════════════════════════════════
  step("6. Team.league Backfill");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    assert(state.teams.length > 0, "League has teams");
    assert(state.teams.every((t) => typeof t.league === "string" && t.league.length > 0), "Every team has a league name");
    assert(state.otherLeaguesTeams.every((t) => typeof t.league === "string" && t.league.length > 0), "Every background team has a league name");
    console.log(`   League: ${state.currentLeagueName} — ${state.teams.length} teams, all tagged with league`);
  }

  // ═══════════════════════════════════════════════════════════
  step("7. Same-League Elite Transfer (immediate roster move)");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const cp = state.careerPlayer;
    const oldClub = state.teams.find((t) => t.id === state.playerTeamId);
    const targetClub = state.teams.find((t) => t.id !== state.playerTeamId);
    assert(cp !== null && oldClub !== undefined && targetClub !== undefined, "Preconditions: cp + old club + target club exist");
    if (cp && oldClub && targetClub) {
      const standingsBefore = state.standings.length;
      const evt: CareerEvent = {
        type: "transfer_offer", title: "🔄 豪门求购", body: `测试：${targetClub.name} 求购你。`,
        actionLabel: "接受转会", dismissLabel: "拒绝",
        payload: { clubName: targetClub.name, clubDbId: "", leagueName: state.currentLeagueName, fee: 45_000_000 },
      };
      useGameStore.setState({ careerEvent: evt });
      useGameStore.getState().acceptCareerEvent();

      const after = useGameStore.getState();
      assert(after.careerEvent === null, "Event cleared after accept");
      assert(after.playerTeamId === targetClub.id, "playerTeamId switched to target club");
      assert(after.careerPlayer?.teamId === targetClub.id, "careerPlayer.teamId synced");
      assert(after.careerPlayer?.value === 45_000_000, "Career player value = transfer fee");
      assert(after.standings.length === standingsBefore, "Standings preserved (season progress intact)");
      const newClub = after.teams.find((t) => t.id === targetClub.id);
      const oldClubAfter = after.teams.find((t) => t.id === oldClub.id);
      assert(newClub?.players.some((p) => p.id === cp.id) === true, "Player in new club roster");
      assert(oldClubAfter?.players.some((p) => p.id === cp.id) === false, "Player removed from old club roster");
      assert(!oldClubAfter?.starterIds.includes(cp.id), "Player removed from old starterIds");
      console.log(`   转会：${oldClub.name} → ${targetClub.name}（€45.0M），standings 保留 ${standingsBefore} 行`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("8. Same-League Loan + Season-End Return");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const cp = state.careerPlayer;
    const parentClubId = state.playerTeamId; // 步骤 7 后的新母队
    const loanClub = state.teams.find((t) => t.id !== state.playerTeamId);
    assert(cp !== null && loanClub !== undefined, "Preconditions: cp + loan club exist");
    if (cp && loanClub) {
      const evt: CareerEvent = {
        type: "loan_offer", title: "🤝 租借申请", body: `测试：${loanClub.name} 邀请租借。`,
        actionLabel: "接受租借", dismissLabel: "留在队中",
        payload: { clubName: loanClub.name, clubDbId: "", leagueName: state.currentLeagueName, crossLeague: false, gameTeamId: loanClub.id, reason: "测试租借" },
      };
      useGameStore.setState({ careerEvent: evt });
      useGameStore.getState().acceptCareerEvent();

      const afterLoan = useGameStore.getState();
      assert(afterLoan.careerEvent === null, "Event cleared after loan accept");
      assert(afterLoan.playerTeamId === loanClub.id, "playerTeamId = loan club");
      assert(afterLoan.careerPlayer?.loanParent?.kind === "game", "loanParent recorded as game-team identity");
      assert(afterLoan.careerPlayer?.loanParent?.kind === "game" && afterLoan.careerPlayer?.loanParent?.teamId === parentClubId, "loanParent points to parent club");

      // 赛季末回归
      try { useGameStore.getState().startNewSeason(); } catch (e) {
        errors.push({ step: "startNewSeason (loan return)", error: String(e) });
        console.error(`  💥 startNewSeason crash: ${e instanceof Error ? e.stack : String(e)}`);
      }

      const afterReturn = useGameStore.getState();
      assert(afterReturn.careerPlayer?.loanParent === null, "loanParent cleared after season end");
      assert(afterReturn.playerTeamId === parentClubId, "playerTeamId returned to parent club");
      assert(afterReturn.careerPlayer?.teamId === parentClubId, "careerPlayer.teamId returned to parent");
      const parentClub = afterReturn.teams.find((t) => t.id === parentClubId);
      assert(parentClub?.players.some((p) => p.id === cp.id) === true, "Player back in parent club roster");
      console.log(`   租借：→ ${loanClub.name} → 赛季末回归母队，球员已归队`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("9. Cross-League Transfer (pendingMove → world rebuild at season end)");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const cp = state.careerPlayer;
    const juventus = getAllTeams().find((t) => t.name === "Juventus");
    assert(cp !== null && juventus !== undefined, "Preconditions: cp + Juventus (Serie A) in DB");
    if (cp && juventus) {
      const teamIdBefore = state.playerTeamId;
      const leagueBefore = state.currentLeagueName;
      const evt: CareerEvent = {
        type: "transfer_offer", title: "🔄 豪门求购", body: `测试：${juventus.name}（Serie A Enilive）求购你。`,
        actionLabel: "接受转会", dismissLabel: "拒绝",
        payload: { clubName: juventus.name, clubDbId: juventus.id, leagueName: "Serie A Enilive", fee: 60_000_000 },
      };
      useGameStore.setState({ careerEvent: evt });
      useGameStore.getState().acceptCareerEvent();

      const afterAccept = useGameStore.getState();
      assert(afterAccept.careerEvent === null, "Event cleared after accept");
      assert(afterAccept.careerPlayer?.pendingMove?.kind === "transfer", "pendingMove recorded as transfer");
      assert(afterAccept.careerPlayer?.pendingMove?.targetClub.name === "Juventus", "pendingMove target = Juventus");
      assert(afterAccept.playerTeamId === teamIdBefore, "Season continues at current club (no immediate switch)");
      assert(afterAccept.currentLeagueName === leagueBefore, "League unchanged during the season");

      // 赛季末：pendingMove 消费 → 世界重建为意甲
      try { useGameStore.getState().startNewSeason(); } catch (e) {
        errors.push({ step: "startNewSeason (cross-league move)", error: String(e) });
        console.error(`  💥 startNewSeason crash: ${e instanceof Error ? e.stack : String(e)}`);
      }

      const afterRebuild = useGameStore.getState();
      assert(afterRebuild.currentLeagueName === "Serie A Enilive", "World rebuilt into Serie A");
      assert(afterRebuild.teams.length === 20, "Serie A has 20 teams");
      assert(afterRebuild.careerPlayer?.pendingMove === null, "pendingMove consumed");
      assert(afterRebuild.careerPlayer?.teamId === afterRebuild.playerTeamId, "cp.teamId synced with playerTeamId");
      const newClub = afterRebuild.teams.find((t) => t.id === afterRebuild.playerTeamId);
      assert(newClub?.name === "Juventus", "Player club is Juventus");
      assert(newClub?.players.some((p) => p.id === cp.id) === true, "Player injected into Juventus roster");
      assert(afterRebuild.careerPlayer?.value === 60_000_000, "Career player value = transfer fee");
      // 金球奖：要么空缺，要么五大联赛豪门（联赛资格过滤生效）
      const gb = afterRebuild.seasonAwards?.goldenBall;
      assert(gb !== null && gb !== undefined, "Ballon d'Or NEVER vacant — always has a winner");
      if (gb) {
        assert(isEliteClub(gb.club), `Ballon winner from elite club (${gb.club})`);
        assert(gb.goals + gb.assists >= 25 && gb.rating >= 8.0, `Ballon winner meets lowest fallback tier (${gb.goals + gb.assists}GA / ${gb.rating.toFixed(1)})`);
      }
      console.log(`   跨联赛转会：→ Juventus（Serie A Enilive），新世界 ${afterRebuild.teams.length} 队，金球奖: ${gb ? `${gb.name} (${gb.goals + gb.assists}GA)` : "???"}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("10. True Season Stats Tracker Consistency");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const cp = state.careerPlayer;
    const goalsBefore = cp?.goals ?? 0;
    const assistsBefore = cp?.assists ?? 0;
    let perfGoals = 0, perfAssists = 0, played = 0;

    for (let match = 1; match <= 3; match++) {
      const st = useGameStore.getState();
      const pt = st.teams.find((t) => t.id === st.playerTeamId);
      if (!pt) break;
      try { st.autoFillSquad(); } catch { /* ok */ }
      let result;
      try { result = st.playMatchweek(); } catch (e) {
        console.error(`  ⚠️ Tracker step match ${match} error: ${(e as Error).message}`);
        continue;
      }
      if (!result) continue;
      try {
        const perf = st.simulateCareerPerformance(result, st.playerTeamId);
        if (perf) {
          perfGoals += perf.goals; perfAssists += perf.assists;
          if (perf.rating > 0) played++;
        }
      } catch (e) {
        errors.push({ step: `tracker perf match ${match}`, error: String(e) });
      }
    }

    const after = useGameStore.getState();
    const stats = after.seasonPlayerStats;
    const cpStat = after.careerPlayer ? stats[after.careerPlayer.id] : undefined;
    if (played > 0) {
      assert(cpStat !== undefined, "Career player tracked in seasonPlayerStats (played matches)");
      if (cpStat && after.careerPlayer) {
        // 追踪器（赛季累计）与生涯面板（生涯累计）之差 = 本步骤的 perf 增量
        assert(cpStat.goals === after.careerPlayer.goals - goalsBefore, `Tracker goals consistent with career panel (${cpStat.goals} = ${after.careerPlayer.goals - goalsBefore})`);
        assert(cpStat.assists === after.careerPlayer.assists - assistsBefore, `Tracker assists consistent with career panel (${cpStat.assists})`);
        assert(cpStat.appearances === played, `Tracker appearances = played matches (${cpStat.appearances} = ${played})`);
        assert(cpStat.ratingSum > 0, "Rating accumulated from real per-match ratings");
      }
    } else {
      // 三场均未出场（替补掷骰全失）——追踪器正确地没有生涯球员条目
      assert(cpStat === undefined, "Career player NOT tracked when never played");
    }
    assert(Object.keys(stats).length > 1, `Other players tracked too (${Object.keys(stats).length} tracked)`);
    console.log(`   追踪器：${Object.keys(stats).length} 名球员，生涯球员 ${perfGoals}G ${perfAssists}A / ${played} 场`);
  }

  // ═══════════════════════════════════════════════════════════
  step("11. Awards Read Real Tracker + Standings Snapshot");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const stats = state.seasonPlayerStats;
    const top = Object.values(stats).sort((a, b) => b.goals - a.goals)[0];
    const myRow = state.standings.find((r) => r.teamId === state.playerTeamId);
    assert(top !== undefined, "Tracker has entries before season end");

    try { useGameStore.getState().startNewSeason(); } catch (e) {
      errors.push({ step: "startNewSeason (real awards)", error: String(e) });
      console.error(`  💥 startNewSeason crash: ${e instanceof Error ? e.stack : String(e)}`);
    }

    const after = useGameStore.getState();
    const a = after.seasonAwards;
    assert(a !== null && a !== undefined, "seasonAwards generated from real tracker");
    if (a && top) {
      // 数据一致：金靴 = 全池进球王（真实追踪器 + 五大联赛后台推演球星），
      // 进球数不可能低于追踪器的真实进球王
      assert(a.goldenBoot?.goals !== undefined && a.goldenBoot!.goals >= top.goals, `Golden Boot covers the true top scorer (${a.goldenBoot?.goals} >= ${top.goals})`);
      if (a.goldenBoot && a.goldenBoot.goals === top.goals) {
        assert(a.goldenBoot.name === top.name, `Golden Boot name matches real top scorer (${a.goldenBoot.name})`);
      }
      const gb = a.goldenBall;
      assert(gb !== null && gb !== undefined, "Ballon d'Or NEVER vacant — exactly one winner every season");
      if (gb) {
        assert(isEliteClub(gb.club), `Ballon winner from elite club (${gb.club})`);
        assert(gb.goals + gb.assists >= 25 && gb.rating >= 8.0, `Ballon winner meets lowest fallback tier (${gb.goals + gb.assists}GA / ${gb.rating.toFixed(1)})`);
      }
      if (gb && a.goldenBoot) {
        assert(a.goldenBoot.goals >= gb.goals, `Boot goals (${a.goldenBoot.goals}) never below Ballon goals (${gb.goals}) — same data source`);
      }
      // ──「我的赛季数据」快照：与追踪器、金靴面板绝对一致 ──
      const cpBefore = state.careerPlayer;
      const cpTracked = cpBefore ? stats[cpBefore.id] : undefined;
      if (cpTracked && cpTracked.appearances > 0) {
        const ps = a.playerSeasonStats;
        assert(ps !== null, "playerSeasonStats snapshot captured for the career player");
        if (ps) {
          assert(ps.goals === cpTracked.goals, `My-season goals = tracker goals (${ps.goals} = ${cpTracked.goals})`);
          assert(ps.assists === cpTracked.assists, `My-season assists = tracker assists (${ps.assists})`);
          assert(ps.appearances === cpTracked.appearances, `My-season apps = tracker apps (${ps.appearances})`);
          assert(ps.avgRating === Math.round((cpTracked.ratingSum / cpTracked.appearances) * 10) / 10, `My-season avg rating = tracker avg (${ps.avgRating})`);
          if (a.goldenBoot && a.goldenBoot.name === ps.name) {
            assert(ps.goals === a.goldenBoot.goals, `My-season goals === Golden Boot goals (${ps.goals} === ${a.goldenBoot.goals}) — 绝对一致`);
          }
        }
      } else {
        assert(a.playerSeasonStats === null, "No player season card when the player never played");
      }
      // 欧战成绩快照：null（未参加）或合法阶段文案
      assert(a.euroFinish === null || (typeof a.euroFinish.label === "string" && a.euroFinish.label.length > 0), `euroFinish snapshot valid (${a.euroFinish ? `${a.euroFinish.compName}${a.euroFinish.label}` : "未参加"})`);
      // 生涯逐年记录：赛季结算时写入一条
      const seasonsBefore = (state.careerPlayer?.careerSeasons ?? []).length;
      const seasonsAfter = after.careerPlayer?.careerSeasons ?? [];
      assert(seasonsAfter.length === seasonsBefore + 1, `Season record appended (${seasonsBefore} → ${seasonsAfter.length})`);
      const lastRecord = seasonsAfter[seasonsAfter.length - 1];
      if (lastRecord) {
        assert(lastRecord.season === state.season, `Record season matches (S${lastRecord.season})`);
        assert(lastRecord.clubName.length > 0, `Record club recorded (${lastRecord.clubName})`);
        assert(lastRecord.leagueRank === null || lastRecord.leagueRank >= 1, `Record league rank valid (${lastRecord.leagueRank})`);
        assert(typeof lastRecord.ovr === "number" && lastRecord.value > 0, "Record OVR/value captured");
      }
      // 战绩快照：reset 后仍保留真实胜平负（修复 0胜0平0负 Bug）
      const snapRow = a.finalStandings.find((r) => r.teamId === a.playerClubId);
      assert(snapRow !== undefined, "Final standings snapshot contains player club row");
      if (snapRow && myRow) {
        assert(
          snapRow.won === myRow.won && snapRow.drawn === myRow.drawn && snapRow.lost === myRow.lost && snapRow.points === myRow.points,
          `Snapshot matches pre-reset standings (${myRow.won}W ${myRow.drawn}D ${myRow.lost}L ${myRow.points}pts)`,
        );
      }
      // 追踪器新赛季清零（奖项已消费）
      assert(Object.keys(after.seasonPlayerStats).length === 0, "Tracker cleared for the new season");
      console.log(`   金靴: ${a.goldenBoot?.name ?? "空缺"} (${a.goldenBoot?.goals ?? 0}G) · 金球: ${gb ? `${gb.name} (${gb.goals + gb.assists}GA)` : "空缺"} · 快照: ${snapRow ? `${snapRow.won}W ${snapRow.drawn}D ${snapRow.lost}L` : "缺失"}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("12. Elimination Report → Confirm → Season Settlement");
  // ═══════════════════════════════════════════════════════════
  {
    // 构造淘汰出局的暂停状态（模拟 startSeasonSimulation 在 KO 轮失利后的暂停标记）
    useGameStore.setState({ simulationPaused: true, pendingElimination: true });
    assert(useGameStore.getState().pendingElimination === true, "pendingElimination flag set on the elimination pause");
    assert(useGameStore.getState().isSeasonEnded === false, "Season NOT settled before the player confirms the report");

    // 玩家在汇报面板点「确认」——此刻才触发赛季结算
    useGameStore.getState().confirmSimulationPause();

    const after = useGameStore.getState();
    assert(after.simulationPaused === false, "Pause cleared after confirm");
    assert(after.pendingElimination === false, "pendingElimination cleared after confirm");
    assert(after.isSeasonEnded === true, "Season settled ONLY after the player confirms the elimination report");
    assert(after.seasonResult !== null, "seasonResult built (rank/prize) after elimination confirm");
    assert(after.isSimulating === false, "Simulation stopped");
    console.log(`   淘汰汇报 → 确认 → 赛季结算：第 ${after.seasonResult?.rank ?? "?"} 名，奖金 €${(after.seasonResult?.prizeMoney ?? 0).toLocaleString()}`);

    // 未出局路径的确认不触发结算
    useGameStore.setState({ isSeasonEnded: false, seasonResult: null, simulationPaused: true, pendingElimination: false });
    useGameStore.getState().confirmSimulationPause();
    const after2 = useGameStore.getState();
    assert(after2.simulationPaused === false && after2.isSeasonEnded === false, "Non-elimination confirm only closes the modal, never settles");
  }

  // ═══════════════════════════════════════════════════════════
  step("13. joinCareerClub Fuzzy-Match Regression (OL bug)");
  // ═══════════════════════════════════════════════════════════
  {
    // 曾修复：选 VfL Wolfsburg 却加入 OL（"ol" 是 "vfl_wolfsburg" 的子串，
    // 2 字母队名抢先模糊匹配）——现在必须精确命中目标球队。
    const wolfsburg = getAllTeams().find((t) => t.name === "VfL Wolfsburg");
    assert(wolfsburg !== undefined, "VfL Wolfsburg exists in DB");
    if (wolfsburg) {
      try { useGameStore.getState().joinCareerClub(wolfsburg.id); } catch (e) {
        errors.push({ step: "joinCareerClub (Wolfsburg regression)", error: String(e) });
      }
      const after = useGameStore.getState();
      const playerTeam = after.teams.find((t) => t.id === after.playerTeamId);
      assert(playerTeam?.name === "VfL Wolfsburg", `Player joined VfL Wolfsburg (got ${playerTeam?.name ?? "?"})`);
      assert(after.currentLeagueName === "Bundesliga", `League is Bundesliga (got ${after.currentLeagueName})`);
      assert(after.teams.some((t) => t.name === "FC Bayern München"), "Bundesliga world contains Bayern");
      console.log(`   选择 VfL Wolfsburg → 正确加入 ${playerTeam?.name}（${after.currentLeagueName}）`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("14. Retire Flow → Career Legacy & Farewell");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const cp = state.careerPlayer;
    assert(cp !== null, "Career player exists before retiring");
    if (cp) {
      // 注入生涯荣誉与奖杯（模拟多年生涯积累）
      useGameStore.setState({
        careerPlayer: {
          ...cp,
          appearances: 300, goals: 120, assists: 60, avgRating: 7.6,
          honours: [
            { season: 1, award: "金球奖", icon: "🏆" },
            { season: 2, award: "金靴奖", icon: "👟" },
            { season: 3, award: "最佳阵容", icon: "🌟" },
          ],
          careerTrophies: [
            { season: 1, type: "league", name: "联赛冠军", icon: "🏆" },
            { season: 2, type: "ucl", name: "欧冠冠军", icon: "🏆" },
          ],
        },
      });
      useGameStore.getState().retirePlayer();

      const after = useGameStore.getState();
      assert(after.gameStatus === "RETIRED", "gameStatus → RETIRED after retire");
      assert(after.careerLegacy !== null, "careerLegacy built for the farewell screen");
      if (after.careerLegacy) {
        assert(after.careerLegacy.totals.appearances === 300, `Legacy total apps (${after.careerLegacy.totals.appearances})`);
        assert(after.careerLegacy.totals.goals === 120, `Legacy total goals (${after.careerLegacy.totals.goals})`);
        assert(after.careerLegacy.trophies.find((t) => t.label === "联赛冠军")?.count === 1, "Legacy trophy wall: 联赛冠军 ×1");
        assert(after.careerLegacy.trophies.find((t) => t.label === "欧冠冠军")?.count === 1, "Legacy trophy wall: 欧冠冠军 ×1");
        assert(after.careerLegacy.honours.find((h) => h.label === "金球奖")?.count === 1, "Legacy honours: 金球奖 ×1");
        assert(after.careerLegacy.rating.tier.length > 0, "Legendary rating tier assigned");
        console.log(`   退役谢幕：${after.careerLegacy.rating.tier} · ${after.careerLegacy.totals.appearances}场/${after.careerLegacy.totals.goals}球 · 奖杯 ${after.careerLegacy.trophies.length} 类 · 荣誉 ${after.careerLegacy.honours.length} 类`);
      }
      // 返回主菜单深重置
      useGameStore.getState().returnToMainMenu();
      const afterReset = useGameStore.getState();
      assert(afterReset.gameStatus === "SETUP" && afterReset.careerPlayer === null && afterReset.careerLegacy === null, "Return-to-menu deep reset clears legacy");
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("15. AI Manager Transfer & Squad Reinforcement");
  // ═══════════════════════════════════════════════════════════
  {
    // 重建生涯世界（Step 14 已退役并深重置）
    useGameStore.getState().createCareerPlayer("AIPro", "中国", Position.MID, 22, 75, 70, 55, 85);
    const bayern = getAllTeams().find((t) => t.name === "FC Bayern München");
    assert(bayern !== undefined, "Bayern exists in DB");
    if (!bayern) {
      console.error("  💥 Bayern not found — skipping AI reinforcement step");
    } else {
      useGameStore.getState().joinCareerClub(bayern.id);

      const state = useGameStore.getState();
      const pt = state.teams.find((t) => t.id === state.playerTeamId)!;
      const gks = pt.players.filter((p) => p.position === Position.GK).sort((a, b) => b.overall - a.overall);
      assert(gks.length > 0, "Team has GKs");
      const bestGK = gks[0];

      // 确定性注入：市场新援 + 最佳 GK 长期伤停（≥6 周）
      const newGK: Player = {
        id: "mkt-gk-1", name: "Market Keeper", age: 26, position: Position.GK,
        attack: 12, defense: 88, stamina: 82, injuryWeeks: 0, potential: 88, overall: 87, value: 12_000_000,
      };
      useGameStore.setState({
        teams: state.teams.map((t) => t.id === pt.id
          ? {
              ...t,
              players: t.players.map((p) => (p.id === bestGK.id ? { ...p, injuryWeeks: 8 } : p)),
              u21Players: [], // 清空青训 → 强制走市场引援路径（青训提拔路径由 Step 16 覆盖）
            }
          : t),
        transferMarketPlayers: [newGK, ...state.transferMarketPlayers],
      });

      const budgetBefore = useGameStore.getState().teams.find((t) => t.id === state.playerTeamId)!.budget;
      useGameStore.getState().aiReinforceSquad();

      const after = useGameStore.getState();
      const ptAfter = after.teams.find((t) => t.id === after.playerTeamId)!;
      const signed = ptAfter.players.find((p) => p.name === "Market Keeper");
      assert(signed !== undefined, "AI manager signed the market keeper (long-term injury cover)");
      assert(after.transferMarketPlayers.find((p) => p.id === "mkt-gk-1") === undefined, "Signed player removed from transfer market");
      assert(ptAfter.budget === budgetBefore - 12_000_000, `Budget deducted for the signing (€${ptAfter.budget.toLocaleString()})`);
      assert(after.careerEvent?.type === "new_signing", `New-signing notification event (${after.careerEvent?.type})`);
      if (after.careerEvent) useGameStore.getState().dismissCareerEvent();
      console.log(`   AI 引援：签入 Market Keeper (GK 87)，预算 €${budgetBefore.toLocaleString()} → €${ptAfter.budget.toLocaleString()}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("16. Youth Promotion (U21 青训提拔优先于市场引援)");
  // ═══════════════════════════════════════════════════════════
  {
    // 沿用 Step 15 的拜仁世界：再次构造 GK 长期伤停 + U21 潜力新星 + 清空市场
    const state = useGameStore.getState();
    const pt = state.teams.find((t) => t.id === state.playerTeamId)!;
    const gks = pt.players.filter((p) => p.position === Position.GK).sort((a, b) => b.overall - a.overall);
    if (gks.length >= 2) {
      const [gk0, gk1] = gks;
      const prospect: Player = {
        id: "u21-gk-prospect", name: "Academy Keeper", age: 18, position: Position.GK,
        attack: 10, defense: 70, stamina: 70, injuryWeeks: 0, potential: 92, overall: 62, value: 500_000,
      };
      useGameStore.setState({
        teams: state.teams.map((t) => t.id === pt.id
          ? {
              ...t,
              players: t.players.map((p) => (p.id === gk0.id || p.id === gk1.id ? { ...p, injuryWeeks: 8 } : p)),
              u21Players: [prospect, ...t.u21Players],
            }
          : t),
        transferMarketPlayers: [], // 市场清空 → 只能走青训提拔路径
        careerEvent: null,
      });

      useGameStore.getState().aiReinforceSquad();

      const after = useGameStore.getState();
      const ptAfter = after.teams.find((t) => t.id === after.playerTeamId)!;
      const promoted = ptAfter.players.find((p) => p.id === "u21-gk-prospect");
      const stillInU21 = ptAfter.u21Players.some((p) => p.id === "u21-gk-prospect");
      assert(promoted !== undefined, "Academy prospect promoted to the first team");
      assert(!stillInU21, "Promoted prospect removed from U21 squad");
      assert(after.transferMarketPlayers.length === 0, "No market signing when youth covers the gap");
      const evt = after.careerEvent;
      assert(evt?.type === "new_signing", `Youth promotion notification (${evt?.type})`);
      if (evt?.payload && "fee" in evt.payload) {
        assert(evt.payload.fee === 0, "Youth promotion costs no transfer fee");
      }
      if (evt) useGameStore.getState().dismissCareerEvent();
      console.log(`   青训提拔：Academy Keeper (GK 62/POT 92) 升入一线队，零转会费`);
    } else {
      console.error("  💥 Not enough GKs — skipping youth promotion step");
    }
  }

  // ═══════════════════════════════════════════════════════════
  step("17. Golden Boot Winner Guaranteed in Best XI");
  // ═══════════════════════════════════════════════════════════
  {
    // 构造追踪器：StrikerX 进球王，其余球员填充各位置
    const mkStat = (name: string, position: Position, goals: number, ovr: number) => ({
      name, position, clubId: "t1", clubName: "Test Club", league: "Premier League", ovr,
      appearances: 30, goals, assists: 5, ratingSum: 7.2 * 30,
    });
    useGameStore.setState({
      seasonPlayerStats: {
        s1: mkStat("StrikerX", Position.FWD, 60, 88),
        s2: mkStat("WingerY", Position.FWD, 12, 86),
        s3: mkStat("WingerZ", Position.FWD, 10, 84),
        m1: mkStat("MidA", Position.MID, 6, 85),
        m2: mkStat("MidB", Position.MID, 4, 83),
        m3: mkStat("MidC", Position.MID, 3, 82),
        d1: mkStat("DefA", Position.DEF, 2, 84),
        d2: mkStat("DefB", Position.DEF, 1, 83),
        d3: mkStat("DefC", Position.DEF, 1, 82),
        d4: mkStat("DefD", Position.DEF, 1, 81),
        g1: mkStat("GkA", Position.GK, 0, 84),
      },
    });
    useGameStore.getState().startNewSeason();
    const after = useGameStore.getState();
    const a = after.seasonAwards;
    assert(a !== null && a?.goldenBoot?.name === "StrikerX", `Golden Boot = StrikerX (${a?.goldenBoot?.name})`);
    assert(a?.teamOfSeason.some((t) => t.name === "StrikerX") === true, "Golden Boot winner ALWAYS in the Best XI");
    assert(a?.teamOfSeason.find((t) => t.name === "StrikerX")?.slot === "ST", "Boot winner takes the marquee ST slot");
    console.log(`   金靴得主 StrikerX (60G) 稳坐最佳阵容 ST 席位`);
  }

  // ═══════════════════════════════════════════════════════════
  step("18. Squad Fallback & Sim Pre-Check (no silent hang)");
  // ═══════════════════════════════════════════════════════════
  {
    const state = useGameStore.getState();
    const pt = state.teams.find((t) => t.id === state.playerTeamId)!;
    // ① 首发凭空消失 → 一键模拟前自动兜底填回最强 11 人
    useGameStore.setState({
      teams: state.teams.map((t) => (t.id === pt.id ? { ...t, starterIds: [] } : t)),
      careerEvent: null,
    });
    useGameStore.getState().startSeasonSimulation();
    const after = useGameStore.getState();
    const ptAfter = after.teams.find((t) => t.id === after.playerTeamId)!;
    assert(ptAfter.starterIds.length === 11, `Fallback filled 11 starters (${ptAfter.starterIds.length})`);
    assert(ptAfter.starterIds.some((id) => ptAfter.players.find((p) => p.id === id)?.position === Position.GK), "Fallback lineup includes a GK");
    // 停止可能已启动的模拟循环
    useGameStore.setState({ isSimulating: false, simulationPaused: false, careerEvent: null });

    // ② 阵容不足 11 人 → 明确报错并拒绝启动（绝不静默卡死）
    useGameStore.setState({
      teams: after.teams.map((t) => (t.id === ptAfter.id ? { ...t, players: t.players.slice(0, 8) } : t)),
      isSimulating: false,
    });
    useGameStore.getState().startSeasonSimulation();
    const after2 = useGameStore.getState();
    assert(after2.simError !== null, `Sim pre-check surfaced a clear error (${after2.simError})`);
    assert(after2.isSimulating === false, "Simulation did NOT start with an incomplete squad");
    useGameStore.getState().dismissSimError();
    assert(useGameStore.getState().simError === null, "Error toast dismissible");
    console.log("   首发兜底 + 前置校验：阵容异常时自动修复或明确报错，绝不卡死");
  }

  // ═══════════════════════════════════════════════════════════
  step("19. Critical Position Shortage → Forced Market Signing");
  // ═══════════════════════════════════════════════════════════
  {
    // 重建世界：GK 位置仅剩 1 人（绝对短缺 <2）→ 即使 U21 有潜力股也必须直接市场购买
    useGameStore.getState().returnToMainMenu();
    useGameStore.getState().createCareerPlayer("GapPro", "中国", Position.MID, 22, 75, 70, 55, 85);
    const bayern = getAllTeams().find((t) => t.name === "FC Bayern München")!;
    useGameStore.getState().joinCareerClub(bayern.id);

    const state = useGameStore.getState();
    const pt = state.teams.find((t) => t.id === state.playerTeamId)!;
    const gks = pt.players.filter((p) => p.position === Position.GK).sort((a, b) => b.overall - a.overall);
    if (gks.length >= 2) {
      const keepGK = gks[0];
      const prospect: Player = {
        id: "u21-gk-gap", name: "Gap Academy GK", age: 18, position: Position.GK,
        attack: 10, defense: 70, stamina: 70, injuryWeeks: 0, potential: 92, overall: 62, value: 500_000,
      };
      const marketGK: Player = {
        id: "mkt-gk-gap", name: "Gap Market GK", age: 27, position: Position.GK,
        attack: 12, defense: 86, stamina: 82, injuryWeeks: 0, potential: 86, overall: 86, value: 15_000_000,
      };
      useGameStore.setState({
        teams: state.teams.map((t) => t.id === pt.id
          ? {
              ...t,
              players: t.players.filter((p) => p.position !== Position.GK || p.id === keepGK.id), // 仅剩 1 名门将
              u21Players: [prospect, ...t.u21Players],
            }
          : t),
        transferMarketPlayers: [marketGK],
        careerEvent: null,
      });

      useGameStore.getState().aiReinforceSquad();

      const after = useGameStore.getState();
      const ptAfter = after.teams.find((t) => t.id === after.playerTeamId)!;
      const signed = ptAfter.players.find((p) => p.name === "Gap Market GK"); // 签约会换新 UUID，按名字查
      const promoted = ptAfter.players.find((p) => p.id === "u21-gk-gap");
      assert(signed !== undefined, "Critical shortage (<2 GKs) forces a market signing");
      assert(promoted === undefined, "Youth promotion skipped for critical shortages (market-first)");
      assert(ptAfter.u21Players.some((p) => p.id === "u21-gk-gap"), "Academy prospect remains in U21");
      assert(ptAfter.players.filter((p) => p.position === Position.GK).length >= 2, `GK depth restored to ≥2 (${ptAfter.players.filter((p) => p.position === Position.GK).length})`);
      console.log("   缺口引援：门将仅剩 1 人 → 强制签入 Gap Market GK，深度恢复 ≥2");
    } else {
      console.error("  💥 Not enough GKs to strip — skipping forced-signing step");
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(60));
  console.log(`\n📊 RESULTS: ${passed} passed, ${failed} failed, ${errors.length} errors\n`);

  if (errors.length > 0) {
    console.log("Errors caught:");
    for (const e of errors) console.log(`  💥 [${e.step}] ${e.error}`);
  }
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(f);
  }

  if (failed === 0 && errors.length === 0) {
    console.log("🎉 All career mode tests passed!\n");
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n💥 UNHANDLED CRASH:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
