import { Position, type Team, type Player, type EuropeanTournament, type EuropeanKnockout, type EuropeanTie, type EuropeanLeaguePhase } from "../types/game";

// ── 36 Virtual European teams ───────────────────────────────

const VIRTUAL_TEAMS: { name: string; league: string; ovr: number }[] = [
  // Top tier (OVR 88-90)
  { name: "曼城蓝月",      league: "英超", ovr: 90 },
  { name: "慕尼黑FC",      league: "德甲", ovr: 89 },
  { name: "马德里红白",    league: "西甲", ovr: 88 },
  // Tier 1 (OVR 85-87)
  { name: "巴塞罗那竞技",  league: "西甲", ovr: 87 },
  { name: "红军利物浦",    league: "英超", ovr: 87 },
  { name: "巴黎圣日耳曼",  league: "法甲", ovr: 87 },
  { name: "米兰红黑",      league: "意甲", ovr: 86 },
  { name: "都灵斑马",      league: "意甲", ovr: 85 },
  { name: "枪手红白",      league: "英超", ovr: 85 },
  // Tier 2 (OVR 82-84)
  { name: "多特黄黑",      league: "德甲", ovr: 84 },
  { name: "切尔西蓝",      league: "英超", ovr: 84 },
  { name: "皇家蓝军",      league: "西甲", ovr: 83 },
  { name: "曼联红魔",      league: "英超", ovr: 83 },
  { name: "那不勒斯蓝",    league: "意甲", ovr: 83 },
  { name: "勒沃库森",      league: "德甲", ovr: 83 },
  { name: "莱比锡红牛",    league: "德甲", ovr: 82 },
  { name: "热刺白",        league: "英超", ovr: 82 },
  { name: "波尔图巨龙",    league: "葡超", ovr: 82 },
  { name: "阿贾克斯",      league: "荷甲", ovr: 82 },
  { name: "亚特兰大",      league: "意甲", ovr: 82 },
  // Tier 3 (OVR 80-81)
  { name: "纽卡斯尔联",    league: "英超", ovr: 81 },
  { name: "罗马红狼",      league: "意甲", ovr: 81 },
  { name: "马赛蓝白",      league: "法甲", ovr: 81 },
  { name: "本菲卡雄鹰",    league: "葡超", ovr: 81 },
  { name: "塞维利亚",      league: "西甲", ovr: 81 },
  { name: "里昂雄狮",      league: "法甲", ovr: 80 },
  { name: "里斯本竞技",    league: "葡超", ovr: 80 },
  { name: "加拉塔萨雷",    league: "土超", ovr: 80 },
  { name: "PSV埃因霍温",   league: "荷甲", ovr: 80 },
  { name: "摩纳哥",        league: "法甲", ovr: 80 },
  // Tier 4 (OVR 78-79)
  { name: "费内巴切",      league: "土超", ovr: 79 },
  { name: "费耶诺德",      league: "荷甲", ovr: 79 },
  { name: "凯尔特人",      league: "苏超", ovr: 79 },
  { name: "顿涅茨克矿工",  league: "乌超", ovr: 78 },
  { name: "萨尔茨堡红牛",  league: "奥甲", ovr: 78 },
  { name: "布鲁日",        league: "比甲", ovr: 78 },
];

// ── Virtual team factory ─────────────────────────────────────

function makeVirtualTeam(v: typeof VIRTUAL_TEAMS[0], idx: number): Team {
  const squad: Player[] = [];
  const slots = [
    { pos: Position.GK, count: 2 },
    { pos: Position.DEF, count: 6 },
    { pos: Position.MID, count: 6 },
    { pos: Position.FWD, count: 4 },
  ];
  for (const { pos, count } of slots) {
    for (let i = 0; i < count; i++) {
      const base = v.ovr + Math.floor(Math.random() * 8) - 4;
      squad.push({
        id: `v-${idx}-${squad.length}`,
        name: `${v.name} #${squad.length + 1}`,
        age: 22 + Math.floor(Math.random() * 12),
        position: pos,
        attack: Math.min(99, base + Math.floor(Math.random() * 10)),
        defense: Math.min(99, base + Math.floor(Math.random() * 10)),
        stamina: 70 + Math.floor(Math.random() * 20),
        injuryWeeks: 0,
        potential: 80 + Math.floor(Math.random() * 15),
        overall: base,
        value: 1_000_000 + (base - 70) * 500_000,
      });
    }
  }
  return {
    id: `virt-${idx}`,
    name: v.name,
    budget: 0,
    players: squad,
    starterIds: squad.slice(0, 11).map((p) => p.id),
    u21Players: [],
    u18Players: [],
    formation: "4-3-3",
    tactic: "balanced",
    europeanStatus: "NONE",
    league: v.league, // 虚拟队联赛为中文名（如 "英超"/"葡超"）；不进 awards 池，仅保持一致
  };
}

export function getVirtualTeams(): Team[] {
  return VIRTUAL_TEAMS.map((v, i) => makeVirtualTeam(v, i));
}

// ── Helpers ──────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── League Phase ─────────────────────────────────────────────

/**
 * Create the modern-UCL league phase: 36 teams in a single table.
 * Each team plays 8 matches against 8 DIFFERENT opponents (4 home, 4 away).
 *
 * Construction: teams are sorted by average OVR into 4 pots of 9 and
 * interleaved onto a 36-slot circle. 8 rotations of the classic round-robin
 * circle method produce 8 perfect matchings = 18 fixtures per round, 144 total.
 * By construction: every team plays exactly once per round (no double-booking),
 * every pairing is unique and SYMMETRIC (A plays B ⇔ B plays A), and greedy
 * orientation gives every team ≈4 home + ≈4 away games.
 */
export function createLeaguePhase(teams: Team[]): EuropeanLeaguePhase {
  const ids = teams.map((t) => t.id);

  // Sort teams by average OVR into 4 pots of 9, interleaved by rank so each
  // rotation pairs teams of similar standing from different pots.
  const sorted = [...teams].sort((a, b) => {
    const avgA = a.players.reduce((s, p) => s + p.overall, 0) / a.players.length;
    const avgB = b.players.reduce((s, p) => s + p.overall, 0) / b.players.length;
    return avgB - avgA;
  });
  const potSize = 9;
  const pots: string[][] = [];
  for (let p = 0; p < 4; p++) {
    pots.push(sorted.slice(p * potSize, (p + 1) * potSize).map((t) => t.id));
  }
  const circle: string[] = [];
  for (let i = 0; i < potSize; i++) {
    for (let p = 0; p < 4; p++) {
      if (pots[p][i]) circle.push(pots[p][i]);
    }
  }

  // ── Round-robin circle method: 8 rotations, 18 fixtures each ──
  const fixtures: EuropeanLeaguePhase["fixtures"] = [];
  // Spread across the 35 available rotations for opponent variety
  const ROTATIONS = [0, 1, 2, 3, 31, 32, 33, 34];
  // Greedy home/away balancing: give home to the team with fewer home games
  const homeCount = new Map<string, number>(ids.map((id) => [id, 0]));

  for (let k = 0; k < ROTATIONS.length; k++) {
    // Apply `rot` rotations: fix circle[0], rotate the other 35 positions
    const p = [...circle];
    for (let r = 0; r < ROTATIONS[k]; r++) {
      const last = p.pop()!;
      p.splice(1, 0, last);
    }
    for (let i = 0; i < 18; i++) {
      const a = p[i];
      const b = p[35 - i];
      const home = (homeCount.get(a) ?? 0) <= (homeCount.get(b) ?? 0) ? a : b;
      const away = home === a ? b : a;
      homeCount.set(home, (homeCount.get(home) ?? 0) + 1);
      fixtures.push({ homeId: home, awayId: away, round: k + 1, played: false });
    }
  }

  const standings = ids.map((teamId) => ({
    teamId,
    played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, points: 0,
  }));

  // Rebalance pass: swap orientation wherever an over-homed team meets an under-homed one
  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (const f of fixtures) {
      const h = homeCount.get(f.homeId) ?? 0;
      const a = homeCount.get(f.awayId) ?? 0;
      if (h > 4 && a < 4) {
        homeCount.set(f.homeId, h - 1);
        homeCount.set(f.awayId, a + 1);
        const t = f.homeId; f.homeId = f.awayId; f.awayId = t;
        changed = true;
      }
    }
    if (!changed) break;
  }

  console.log(`[europeanEngine] League phase created: 36 teams, ${fixtures.length} fixtures (expected 144)`);
  return { teams: ids, fixtures: fixtures, standings };
}

// ── Knockout Draw ────────────────────────────────────────────

/** Pair 16 teams (ranks 9-24) into 8 two-legged playoff ties. Higher seed hosts leg 2. */
export function createKnockoutPlayoffs(
  rankedTeamIds: string[],  // indices 0-15 = ranks 9-24
): EuropeanKnockout {
  const ties: EuropeanTie[] = [];
  for (let i = 0; i < 8; i++) {
    const highSeed = rankedTeamIds[i];          // rank 9+i
    const lowSeed = rankedTeamIds[15 - i];       // rank 24-i
    ties.push({
      homeId: lowSeed,     // leg 1: lower seed at home
      awayId: highSeed,    // leg 1: higher seed away
      homeScore: 0, awayScore: 0,
      homeScore2: 0, awayScore2: 0,
      played: false, played2: false,
      winnerId: null,
    });
  }
  return { round: "playoff", ties };
}

/** Create knockout round from a list of qualified team IDs (16 for R16, 8 for QF, 4 for SF). */
export function createKnockoutRound(
  round: "r16" | "qtr" | "semi" | "final",
  teamIds: string[],
): EuropeanKnockout {
  const clean = teamIds.filter((id): id is string => !!id);
  const shuffled = shuffle(clean);
  const ties: EuropeanTie[] = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    ties.push({
      homeId: shuffled[i], awayId: shuffled[i + 1],
      homeScore: 0, awayScore: 0,
      homeScore2: 0, awayScore2: 0,
      played: false, played2: false,
      singleLeg: round === "final",   // final is a single match
      winnerId: null,
    });
  }
  if (shuffled.length % 2 === 1) {
    console.warn(`[europeanEngine] ⚠️ Odd team count (${shuffled.length}) for ${round} — one team left without a tie.`);
  }
  return { round, ties };
}

// ── League Phase Rankings ────────────────────────────────────

function sortStandings(a: { points: number; goalsFor: number; goalsAgainst: number },
  b: { points: number; goalsFor: number; goalsAgainst: number }): number {
  const pa = isNaN(a.points) ? 0 : a.points;
  const pb = isNaN(b.points) ? 0 : b.points;
  if (pb !== pa) return pb - pa;
  const gdA = (isNaN(a.goalsFor) ? 0 : a.goalsFor) - (isNaN(a.goalsAgainst) ? 0 : a.goalsAgainst);
  const gdB = (isNaN(b.goalsFor) ? 0 : b.goalsFor) - (isNaN(b.goalsAgainst) ? 0 : b.goalsAgainst);
  if (gdB !== gdA) return gdB - gdA;
  return (isNaN(b.goalsFor) ? 0 : b.goalsFor) - (isNaN(a.goalsFor) ? 0 : a.goalsFor);
}

/** Return ranked team IDs (1st → 36th) from league phase standings. */
export function getLeaguePhaseRanking(lp: EuropeanLeaguePhase): string[] {
  return [...lp.standings].sort(sortStandings).map((s) => s.teamId);
}

// ── Tournament Creation ──────────────────────────────────────

export function createTournament(type: "UCL" | "UEL" | "UECL", teams: Team[]): EuropeanTournament {
  // Dedup: if any virtual team's name conflicts with a real team, append "(欧战)" suffix
  const deduped = teams.map(t => {
    if (t.id.startsWith("virt-") && teams.some(rt => !rt.id.startsWith("virt-") && rt.name === t.name)) {
      return { ...t, name: t.name + " (欧战)", id: t.id + "-dedup" };
    }
    return t;
  });
  return {
    type,
    leaguePhase: createLeaguePhase(deduped),
    knockoutPlayoffs: null,
    roundOf16: null,
    quarterFinals: null,
    semiFinals: null,
    final: null,
    currentStage: "league",
  };
}

// ── Opponent Picker ──────────────────────────────────────────

/**
 * Resolve the correct European opponent for a given matchday.
 *
 * euroRound: 1-17 (1-8 league phase, 9-10 playoffs, 11-12 R16, 13-14 QF, 15-16 SF, 17 Final).
 */
export function pickEuropeanOpponent(
  playerTeamId: string,
  tournament: EuropeanTournament | null,
  virtualTeams: Team[],
  euroRound: number,
): { opponent: Team; stage: string; isHome: boolean } | null {
  if (!tournament) return null;

  const allTeams = new Map(virtualTeams.map((t) => [t.id, t]));

  const resolveOpponent = (tie: EuropeanTie, leg: 1 | 2): { opponent: Team; isHome: boolean } | null => {
    const isHome = (leg === 1 ? tie.homeId : tie.awayId) === playerTeamId;
    const oppId = isHome
      ? (leg === 1 ? tie.awayId : tie.homeId)
      : (leg === 1 ? tie.homeId : tie.awayId);
    const opp = oppId ? allTeams.get(oppId) : undefined;
    return opp ? { opponent: opp, isHome } : null;
  };

  // ── League phase (rounds 1-8) ──
  if (tournament.currentStage === "league" && euroRound >= 1 && euroRound <= 8) {
    const fixture = tournament.leaguePhase.fixtures.find(
      (f) => !f.played && f.round === euroRound && (f.homeId === playerTeamId || f.awayId === playerTeamId),
    );
    if (fixture) {
      const isHome = fixture.homeId === playerTeamId;
      const oppId = isHome ? fixture.awayId : fixture.homeId;
      const opponent = oppId ? allTeams.get(oppId) : undefined;
      if (opponent) {
        fixture.played = true; // mark ONLY after successful resolution — never burn a fixture
        console.log(`[europeanEngine] League R${euroRound}: ${isHome ? "vs" : "@"} ${opponent.name}`);
        return { opponent, stage: "联赛阶段", isHome };
      }
    }
  }

  // ── Knockout Playoffs (rounds 9-10) ──
  if (tournament.currentStage === "playoff" && tournament.knockoutPlayoffs) {
    const leg = (euroRound === 9 ? 1 : 2) as 1 | 2;
    const tie = tournament.knockoutPlayoffs.ties.find(
      (t) => (t.homeId === playerTeamId || t.awayId === playerTeamId) && (leg === 1 ? !t.played : !t.played2),
    );
    if (tie) {
      const result = resolveOpponent(tie, leg);
      if (result) {
        if (leg === 1) tie.played = true; else tie.played2 = true;
        console.log(`[europeanEngine] Playoff leg ${leg}: ${result.isHome ? "vs" : "@"} ${result.opponent.name}`);
        return { ...result, stage: "淘汰赛附加赛" };
      }
    }
  }

  // ── R16 (rounds 11-12), QF (13-14), SF (15-16), Final (17) ──
  const stageMap: [string, EuropeanKnockout | null, number, number][] = [
    ["r16", tournament.roundOf16, 11, 12],
    ["qtr", tournament.quarterFinals, 13, 14],
    ["semi", tournament.semiFinals, 15, 16],
    ["final", tournament.final, 17, 17],
  ];

  for (const [stageKey, knockouts, round1, round2] of stageMap) {
    if (knockouts && euroRound >= round1 && euroRound <= round2) {
      const leg = (euroRound === round1 ? 1 : 2) as 1 | 2;
      const playedKey = leg === 1 ? "played" : "played2";
      const tie = knockouts.ties.find(
        (t) => (t.homeId === playerTeamId || t.awayId === playerTeamId) && !t[playedKey],
      );
      if (tie) {
        const result = resolveOpponent(tie, leg);
        if (result) {
          (tie as unknown as Record<string, boolean>)[playedKey] = true;
          const stageLabels: Record<string, string> = { r16: "16强", qtr: "8强", semi: "半决赛", final: "决赛" };
          console.log(`[europeanEngine] ${stageLabels[stageKey]} leg ${leg}: ${result.isHome ? "vs" : "@"} ${result.opponent.name}`);
          return { ...result, stage: stageLabels[stageKey] ?? stageKey };
        }
      }
    }
  }

  // ── No fixture this round: eliminated, or a bye week ──
  if (isPlayerEliminated(tournament, playerTeamId)) {
    console.log(`[europeanEngine] ❌ Player eliminated — no further European fixtures.`);
    return null;
  }
  // Bye week (e.g. top-8 teams during playoff rounds 9-10): the caller skips this matchday.
  console.log(`[europeanEngine] ⏸️ R${euroRound}: bye round — no fixture for the player.`);
  return null;
}

/**
 * Is the player definitively out of this tournament?
 * True when: the tournament finished, the player ranked 25-36 in the league phase,
 * lost a completed two-legged tie, or the tournament advanced past a stage they were not part of.
 */
export function isPlayerEliminated(tournament: EuropeanTournament | null, playerTeamId: string): boolean {
  if (!tournament) return true;
  if (tournament.currentStage === "done") return true;

  const ranking = getLeaguePhaseRanking(tournament.leaguePhase);
  const rank = ranking.indexOf(playerTeamId) + 1;
  if (rank === 0) return true;   // not in this tournament at all
  // League-phase elimination only counts once the league phase is OVER —
  // mid-phase standings are provisional and must not eliminate anyone early.
  if (tournament.currentStage !== "league" && rank > 24) return true;

  const tieOf = (ko: EuropeanKnockout | null) =>
    ko?.ties.find((t) => t.homeId === playerTeamId || t.awayId === playerTeamId);

  // Lost a completed tie?
  for (const ko of [tournament.knockoutPlayoffs, tournament.roundOf16, tournament.quarterFinals, tournament.semiFinals, tournament.final]) {
    const tie = tieOf(ko);
    if (tie && tie.played2 && tie.winnerId !== null && tie.winnerId !== playerTeamId) return true;
  }

  // Tournament advanced past a stage the player was not part of?
  const cur = tournament.currentStage;
  if (cur === "r16" && !tieOf(tournament.roundOf16)) return true;
  if (cur === "qtr" && !tieOf(tournament.quarterFinals)) return true;
  if (cur === "semi" && !tieOf(tournament.semiFinals)) return true;
  if (cur === "final" && !tieOf(tournament.final)) return true;

  return false;
}

// ── European finish display ──────────────────────────────────

/**
 * 欧战最终名次（赛季结算面板展示用）：根据赛事的真实最终状态推导
 * 玩家球队止步的阶段与对应文案/图标。
 * 返回 null = 本赛季未参加欧战。
 */
export function getEuropeanFinish(
  tournament: EuropeanTournament | null,
  playerTeamId: string,
): { label: string; icon: string } | null {
  if (!tournament) return null;

  const tieOf = (ko: EuropeanKnockout | null) =>
    ko?.ties.find((t) => t.homeId === playerTeamId || t.awayId === playerTeamId);

  // 决赛打完：冠军或亚军
  const finalTie = tieOf(tournament.final);
  if (tournament.currentStage === "done" && finalTie) {
    return finalTie.winnerId === playerTeamId
      ? { label: "冠军", icon: "🏆" }
      : { label: "亚军", icon: "🥈" };
  }

  // 淘汰赛止步阶段（赛季结束时赛事可能已推进到更后阶段，按 tie 存在性判断）
  if (tieOf(tournament.semiFinals)) return { label: "四强 (半决赛)", icon: "🏅" };
  if (tieOf(tournament.quarterFinals)) return { label: "八强 (1/4决赛)", icon: "🏅" };
  if (tieOf(tournament.roundOf16)) return { label: "十六强 (1/8决赛)", icon: "🏅" };
  if (tieOf(tournament.knockoutPlayoffs)) return { label: "附加赛出局", icon: "🏅" };

  // 联赛阶段出局（36 队联赛阶段未进前 24）
  return { label: "联赛阶段出局", icon: "📉" };
}

// ── Standings Update ─────────────────────────────────────────

export function updateLeagueStandings(
  lp: EuropeanLeaguePhase,
  homeId: string,
  awayId: string,
  homeScore: number,
  awayScore: number,
  maxPlayed?: number,
): void {
  const update = (teamId: string, scored: number, conceded: number) => {
    const row = lp.standings.find((s) => s.teamId === teamId);
    if (!row) return;
    // Anti-double-count: never exceed the expected max round
    if (maxPlayed !== undefined && row.played >= maxPlayed) {
      console.warn(`[europeanEngine] ⚠️ Skipping double-update for ${teamId.slice(0,8)}... (already played ${row.played}, max=${maxPlayed})`);
      return;
    }
    const won = scored > conceded ? 1 : 0;
    const drawn = scored === conceded ? 1 : 0;
    row.played += 1;
    row.won += won;
    row.drawn += drawn;
    row.lost += scored < conceded ? 1 : 0;
    row.goalsFor += scored;
    row.goalsAgainst += conceded;
    row.points += won * 3 + drawn;
  };
  update(homeId, homeScore, awayScore);
  update(awayId, awayScore, homeScore);
}

// ── Stage advancement helpers ────────────────────────────────

/** Rank map (teamId → 1-based league-phase rank) for resolving unplayed ties. */
function rankMapOf(tournament: EuropeanTournament): Map<string, number> {
  return new Map(getLeaguePhaseRanking(tournament.leaguePhase).map((id, i) => [id, i + 1]));
}

/**
 * Only the player's ties are ever simulated. Other ties (virtual vs virtual)
 * are auto-resolved by league-phase ranking so every bracket is complete —
 * otherwise `advanceFromPlayoffs`/`advanceKnockoutStage` would create brackets
 * with missing teams and `undefined` tie ids.
 */
function resolveUnplayedTies(tournament: EuropeanTournament, ko: EuropeanKnockout | null): void {
  if (!ko) return;
  const ranks = rankMapOf(tournament);
  for (const tie of ko.ties) {
    if (tie.winnerId !== null) continue;
    if (!tie.homeId || !tie.awayId) continue; // legacy corruption — leave unresolved
    const homeRank = ranks.get(tie.homeId) ?? 999;
    const awayRank = ranks.get(tie.awayId) ?? 999;
    tie.winnerId = homeRank <= awayRank ? tie.homeId : tie.awayId;
    tie.played = true;
    tie.played2 = true;
    console.log(`[europeanEngine] 🎲 Unplayed ${ko.round} tie auto-resolved by ranking: ${tie.homeId} vs ${tie.awayId} → ${tie.winnerId}`);
  }
}

/**
 * Keep the tournament's bracket in sync with the calendar round.
 * Called at the start of every European matchday: if the calendar has moved
 * into a new stage but the bracket hasn't advanced yet (e.g. the player had
 * bye rounds 9-10 as a top-8 qualifier), advance it now.
 */
export function syncTournamentStage(tournament: EuropeanTournament | null, euroRound: number): EuropeanTournament | null {
  if (!tournament || tournament.currentStage === "done") return tournament;
  if (euroRound >= 9 && tournament.currentStage === "league") return advanceFromLeaguePhase(tournament);
  if (euroRound >= 11 && tournament.currentStage === "playoff") return advanceFromPlayoffs(tournament);
  if (euroRound >= 13 && tournament.currentStage === "r16") return advanceKnockoutStage(tournament, "r16");
  if (euroRound >= 15 && tournament.currentStage === "qtr") return advanceKnockoutStage(tournament, "qtr");
  if (euroRound >= 17 && tournament.currentStage === "semi") return advanceKnockoutStage(tournament, "semi");
  return tournament;
}

/**
 * 点球大战模拟：双方各罚 5 轮（每轮 75% 命中），仍平则突然死亡，
 * 直到分出胜负——比分合理（如 3-2、4-3、5-4、6-5），绝不打出不合理的悬殊比分。
 */
export function simulatePenaltyShootout(rng: () => number = Math.random): { home: number; away: number } {
  const kick = () => (rng() < 0.75 ? 1 : 0);
  let home = 0;
  let away = 0;
  for (let i = 0; i < 5; i++) {
    home += kick();
    away += kick();
  }
  // 突然死亡：先罚方得分即终结（经典规则）；
  // 安全上限 20 轮，防病态 rng 造成死循环（真实 Math.random 不会触发）
  let sudden = 0;
  while (home === away && sudden < 20) {
    sudden++;
    home += kick();
    if (home !== away) break;
    away += kick();
  }
  // 极端兜底：上限耗尽仍平 → 主场 +1 强制分出胜负
  if (home === away) home += 1;
  return { home, away };
}

/**
 * Update a knockout tie with a single-leg result.
 * Returns the tie's winnerId once it is decided, or null.
 *
 * 点球决胜规则：两回合总比分打平（或单场决赛常规时间打平）时，
 * 自动触发点球大战（penaltyHome/penaltyAway 记录比分），由点球结果判定晋级方。
 *
 * NOTE: the old "single-match fallback" (`played && !played2 → winner`) fired
 * after the FIRST leg of every two-legged tie — it decided the tie early and
 * marked played2, so leg 2 became a bye and the aggregate was never counted.
 * Single-match ties (the final) are now marked with `singleLeg` instead.
 */
export function updateKnockoutTie(
  tie: EuropeanTie,
  isFirstLeg: boolean,
  homeScore: number,
  awayScore: number,
): string | null {
  if (isFirstLeg) {
    tie.homeScore = homeScore;
    tie.awayScore = awayScore;
    tie.played = true;
  } else {
    tie.homeScore2 = homeScore;
    tie.awayScore2 = awayScore;
    tie.played2 = true;
  }

  // Single-match tie (final): decided on the one leg played — drawn finals go to penalties
  if (tie.singleLeg && tie.played) {
    if (tie.homeScore === tie.awayScore) {
      const pens = simulatePenaltyShootout();
      tie.penaltyHome = pens.home;
      tie.penaltyAway = pens.away;
      tie.winnerId = pens.home > pens.away ? tie.homeId : tie.awayId;
      console.log(`[europeanEngine] 🥅 Final drawn ${tie.homeScore}-${tie.awayScore} → penalties ${pens.home}-${pens.away}, winner: ${tie.winnerId}`);
    } else {
      tie.winnerId = tie.homeScore > tie.awayScore ? tie.homeId : tie.awayId;
    }
    return tie.winnerId;
  }

  // Two-legged: aggregate after BOTH legs — drawn aggregates go to penalties.
  // Scores are stored in TIE-side terms (the sim always puts the player at match
  // home, so leg venues never flip in the result), therefore each team's total is
  // simply the sum of its own two scores — the old cross-terms (homeScore+awayScore2)
  // double-counted one team's goals and wiped the other's.
  if (tie.played && tie.played2) {
    const agg1 = tie.homeScore + tie.homeScore2;  // tie-home team total
    const agg2 = tie.awayScore + tie.awayScore2;  // tie-away team total
    if (agg1 === agg2) {
      const pens = simulatePenaltyShootout();
      tie.penaltyHome = pens.home;
      tie.penaltyAway = pens.away;
      tie.winnerId = pens.home > pens.away ? tie.homeId : tie.awayId;
      console.log(`[europeanEngine] 🥅 Aggregate drawn ${agg1}-${agg2} → penalties ${pens.home}-${pens.away}, winner: ${tie.winnerId}`);
    } else {
      tie.winnerId = agg1 > agg2 ? tie.homeId : agg2 > agg1 ? tie.awayId : tie.homeId;
    }
    return tie.winnerId;
  }
  return null;
}

// ── Stage Advancement ────────────────────────────────────────

/** After league phase (round 8), create playoffs and return the updated tournament. */
export function advanceFromLeaguePhase(tournament: EuropeanTournament): EuropeanTournament {
  const ranking = getLeaguePhaseRanking(tournament.leaguePhase);
  const playoffTeams = ranking.slice(8, 24); // ranks 9-24
  // ranks 25-36 eliminated silently

  const playoffs = createKnockoutPlayoffs(playoffTeams);
  console.log(`[europeanEngine] League phase done. Top 8 → R16, 9-24 → playoffs, 25-36 out.`);

  return {
    ...tournament,
    knockoutPlayoffs: playoffs,
    currentStage: "playoff",
  };
}

/** After playoffs (round 10), create R16 draw and return updated tournament. */
export function advanceFromPlayoffs(tournament: EuropeanTournament): EuropeanTournament {
  const ranking = getLeaguePhaseRanking(tournament.leaguePhase);
  const directR16 = ranking.slice(0, 8);

  // Auto-resolve every playoff tie the player wasn't involved in
  resolveUnplayedTies(tournament, tournament.knockoutPlayoffs);
  const playoffWinners = (tournament.knockoutPlayoffs?.ties ?? [])
    .map((t) => t.winnerId)
    .filter((id): id is string => id != null);

  // Guarantee a full 16-team bracket (pad from ranking as a safety net)
  const r16Teams = [...directR16, ...playoffWinners];
  for (const id of ranking) {
    if (r16Teams.length >= 16) break;
    if (!r16Teams.includes(id)) r16Teams.push(id);
  }

  const r16 = createKnockoutRound("r16", r16Teams.slice(0, 16));
  console.log(`[europeanEngine] Playoffs done. ${playoffWinners.length} winners → R16 (${r16.ties.length} ties).`);

  return {
    ...tournament,
    roundOf16: r16,
    currentStage: "r16",
  };
}

/** After any knockout round, promote winners to the next stage. */
export function advanceKnockoutStage(
  tournament: EuropeanTournament,
  fromStage: "r16" | "qtr" | "semi",
): EuropeanTournament {
  const from = fromStage === "r16" ? tournament.roundOf16
    : fromStage === "qtr" ? tournament.quarterFinals
    : tournament.semiFinals;
  if (!from) return tournament;

  // Auto-resolve ties the player wasn't involved in
  resolveUnplayedTies(tournament, from);

  const winners = from.ties.map((t) => t.winnerId).filter((id): id is string => id != null);

  if (fromStage === "r16") {
    return { ...tournament, quarterFinals: createKnockoutRound("qtr", winners), currentStage: "qtr" };
  }
  if (fromStage === "qtr") {
    return { ...tournament, semiFinals: createKnockoutRound("semi", winners), currentStage: "semi" };
  }
  // fromStage === "semi"
  return { ...tournament, final: createKnockoutRound("final", winners), currentStage: "final" };
}
