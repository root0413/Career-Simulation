import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Team, LeagueStandings, MatchResult, Formation, Tactic, Player, EuropeanTournament, EuropeanTie, EuropeanKnockout, EuropeanStatus, CareerPlayer, CareerEvent, CareerMatchLogEntry, SeasonPlayerStat, CareerTrophy, CareerSeasonRecord } from "../types/game";
import { ALL_FORMATIONS, ALL_TACTICS, FORMATION_SLOTS, Position } from "../types/game";
import { generateWorld } from "../utils/worldGenerator";
import { simulateMatch, teamPrestige } from "../utils/matchEngine";
import { accumulateMatchStats, type TeamStatMeta } from "../utils/seasonStats";
import { buildCareerLegacy, type CareerLegacy } from "../utils/careerLegacy";
import { retirementChance } from "../utils/lifecycle";
import { generateNewgens } from "../utils/newgens";
import { marketValue, VALUE_CEILING } from "../utils/marketValue";
import { generateUUID } from "../utils/uuid";
import { initialMarketPlayers } from "../data/transferMarket";
import { FREE_AGENTS } from "../data/freeAgentsDatabase";
import { getAllTeams } from "../data/teamsDatabase";
import { getLeagueRules, buildEuroSlots, type LeagueRuleConfig } from "../data/leagueRules";
import { isBallonEligible, isEliteClub, computeTransferFee, formatEuroM, pickEliteDestination, pickSameLeagueLoanTarget, pickCrossLeagueLoanTarget, getTopFiveBackgroundStars, type EliteDestination,
  TRANSFER_OFFER_MIN_AVG_RATING, TRANSFER_OFFER_MIN_GA, TRANSFER_OFFER_MIN_VALUE, TRANSFER_OFFER_MAX_AGE, TRANSFER_OFFER_CHANCE,
  LOAN_OFFER_POOR_AVG, LOAN_OFFER_MIN_POTENTIAL, LOAN_OFFER_MAX_AGE, LOAN_OFFER_APPEARANCE_RATIO, LOAN_OFFER_CHANCE,
} from "../data/careerTransfers";

// ── Deduplication helpers ───────────────────────────────────

/** Extract the last name (final word) from a player name. */
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
}

/** Extract first-name initial. */
function firstInitial(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").toLowerCase();
}

/** Check if two player names refer to the same real-world person. */
function isSamePlayer(a: string, ageA: number, b: string, ageB: number): boolean {
  // Age must be close (±1 year)
  if (Math.abs(ageA - ageB) > 1) return false;

  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();

  // Exact match
  if (na === nb) return true;

  // One contains the other (e.g. "E. Ferguson" ⊂ "Evan Ferguson")
  if (na.includes(nb) || nb.includes(na)) return true;

  // Last name matches + first initial matches
  const lnA = lastName(a);
  const lnB = lastName(b);
  if (lnA && lnB && lnA === lnB) {
    const fiA = firstInitial(a);
    const fiB = firstInitial(b);
    if (fiA && fiB && fiA === fiB) return true;
    // Last name matches + at least one is a short form (single word or initial)
    if (na.split(/\s+/).length <= 2 || nb.split(/\s+/).length <= 2) return true;
  }

  return false;
}

/**
 * Filter free agents: remove any player who already exists
 * in a team roster (either the player's league or background leagues).
 */
function dedupeFreeAgents(freeAgents: Player[], allTeams: { players: Player[] }[]): Player[] {
  const existing: { name: string; age: number }[] = [];
  for (const t of allTeams) {
    for (const p of t.players) {
      existing.push({ name: p.name, age: p.age });
    }
  }

  const filtered = freeAgents.filter((fa) => {
    const dup = existing.find((ex) => isSamePlayer(fa.name, fa.age, ex.name, ex.age));
    if (dup) {
      console.log(`[store] 🧹 Deduped: "${fa.name}" (age ${fa.age}) — already exists as "${dup.name}" (age ${dup.age})`);
      return false;
    }
    return true;
  });

  if (filtered.length < freeAgents.length) {
    console.log(`[store] 🧹 Removed ${freeAgents.length - filtered.length} duplicate free agents (${freeAgents.length} → ${filtered.length})`);
  }
  return filtered;
}
import { generateCalendar } from "../utils/calendar";
import { formatMatchdayLabel, COMPETITION_NAMES } from "../utils/matchLog";
import { getVirtualTeams, createTournament, pickEuropeanOpponent, updateLeagueStandings, updateKnockoutTie, advanceFromLeaguePhase, advanceFromPlayoffs, advanceKnockoutStage, syncTournamentStage, isPlayerEliminated, getEuropeanFinish } from "../utils/europeanEngine";

// ── State ───────────────────────────────────────────────────

interface SeasonResult {
  rank: number;
  champion: string;
  prizeMoney: number;
  europeanQualification: EuropeanStatus;
}

export interface SeasonAwards {
  goldenBall: { name: string; club: string; goals: number; assists: number; rating: number }; // 永不空缺——动态降级门槛保证每年必有得主
  leagueBest: { name: string; club: string } | null;
  goldenBoot: { name: string; club: string; goals: number } | null;
  teamOfSeason: { name: string; position: string; slot: string }[]; // slot = strict 4-3-3 role (GK/LB/CB/RB/CDM/CM/CAM/LW/ST/RW)
  playerWon: string[]; // awards the career player won
  /** 赛季最终积分榜快照（startNewSeason 重置前抓取，颁奖面板严格读取） */
  finalStandings: LeagueStandings[];
  /** 玩家赛季末效力的俱乐部（颁奖面板用快照行定位战绩） */
  playerClubId: string;
  playerClubName: string;
  /** 欧战最终阶段快照 */
  euroStage: string;
  /** 玩家生涯球员单赛季真实数据快照（追踪器清零前抓取；与金靴/金球面板同源、绝对一致） */
  playerSeasonStats: {
    name: string;
    appearances: number;
    goals: number;
    assists: number;
    avgRating: number;
  } | null;
  /** 欧战最终名次快照（赛季结算面板展示；null = 未参加欧战） */
  euroFinish: { compName: string; label: string; icon: string } | null;
}

export interface CareerMatchPerf {
  rating: number;
  goals: number;
  assists: number;
  summary: string;
  growthGains: string[];
}

type GameStatus = "SETUP" | "PLAYING" | "RETIRED";
type GameMode = "manager" | "career";

interface GameState {
  gameStatus: GameStatus;
  gameMode: GameMode;
  currentLeagueName: string;
  teams: Team[];
  otherLeaguesTeams: Team[];
  playerTeamId: string;
  careerPlayer: CareerPlayer | null;
  leagueRules: LeagueRuleConfig | null;
  currentWeek: number;
  currentMatchday: number;
  seasonCalendar: ReturnType<typeof generateCalendar>;
  virtualEuroTeams: Team[];
  playerTournament: EuropeanTournament | null;
  season: number;
  maxMatchweeks: number;
  isSeasonEnded: boolean;
  seasonResult: SeasonResult | null;
  standings: LeagueStandings[];
  transferMarketPlayers: Player[];
  careerEvent: CareerEvent | null;
  seasonAwards: SeasonAwards | null;

  initGame: (teamId: string, teamName: string, budget: number) => void;
  advanceWeek: () => void;
  playMatchweek: () => MatchResult | undefined; // undefined = bye week / no player fixture this matchday
  startNewSeason: () => void;
  setPlayerFormation: (formation: Formation) => void;
  setPlayerTactic: (tactic: Tactic) => void;
  buyPlayer: (player: Player, targetSquad: "first" | "u21" | "u18") => void;
  sellPlayer: (playerId: string, fromSquad: "first" | "u21" | "u18") => void;
  swapPlayer: (outId: string, inId: string) => void;
  autoRotateSquad: () => void;
  autoFillSquad: () => void;
  setStarterSlot: (slotIndex: number, playerId: string) => void;
  promotePlayer: (playerId: string, from: "u21" | "u18") => void;
  demotePlayer: (playerId: string, to: "u21" | "u18") => void;
  // Career mode
  setGameMode: (mode: GameMode) => void;
  returnToMainMenu: () => void;
  createCareerPlayer: (name: string, nationality: string, position: Position, age: number, attack: number, playmaking: number, defense: number, potential: number) => void;
  joinCareerClub: (teamId: string) => void;
  generateAILineup: () => { status: "starter" | "bench" | "out"; starterOVR: number };
  simulateCareerPerformance: (teamMatchResult: MatchResult, playerTeamId: string) => CareerMatchPerf;
  generateSeasonAwards: () => void;
  // Season simulation
  isSimulating: boolean;
  simulationPaused: boolean;
  seasonMatchLog: CareerMatchLogEntry[];
  /** 当前模拟段的起始下标（赛季日志内）— 汇报弹窗只渲染本段记录，实现联赛/欧战赛段隔离 */
  simulationSegmentStart: number;
  /** 全赛季真实数据追踪器：每场比赛实时累加，赛季末奖项评选严格读取（禁止捏造） */
  seasonPlayerStats: Record<string, SeasonPlayerStat>;
  /** 淘汰出局的汇报已暂停——玩家点「确认」后（confirmSimulationPause）才结算赛季 */
  pendingElimination: boolean;
  /** 退役后的生涯荣誉总结（挂靴谢幕页数据；退役时构建并持久化） */
  careerLegacy: CareerLegacy | null;
  /** 一键模拟错误提示（Toast 展示；null = 无错误） */
  simError: string | null;
  dismissSimError: () => void;
  startSeasonSimulation: () => void;
  dismissCareerEvent: () => void;
  acceptCareerEvent: () => void; // 接受生涯事件（续约/转会/租借）
  confirmSimulationPause: () => void; // 汇报面板「确认」：关闭弹窗；淘汰出局时此刻才触发赛季结算
  retirePlayer: () => void; // 挂靴退役：构建生涯荣誉总结 → 进入谢幕页（RETIRED）
  aiReinforceSquad: () => void; // AI 教练自动引援（转会窗口）：长期伤停/老化核心 → 市场补强 + 新援通知
  endSeasonEarly: () => void; // immediate season settlement (European elimination)
}

// ── Helpers ─────────────────────────────────────────────────

function buildStandings(teams: Team[]): LeagueStandings[] {
  return teams.map((t) => ({
    teamId: t.id, played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, points: 0,
  }));
}

function updateRow(row: LeagueStandings, scored: number, conceded: number): LeagueStandings {
  const won = scored > conceded ? 1 : 0;
  const drawn = scored === conceded ? 1 : 0;
  return {
    ...row, played: row.played + 1,
    won: row.won + won, drawn: row.drawn + drawn,
    lost: row.lost + (scored < conceded ? 1 : 0),
    goalsFor: row.goalsFor + scored,
    goalsAgainst: row.goalsAgainst + conceded,
    points: row.points + won * 3 + drawn,
  };
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Career transfer/loan helpers ───────────────────────────

/** 生涯球员快照为 roster Player（team.players 注入用，与 joinCareerClub 同构） */
function cpToRosterPlayer(cp: CareerPlayer): Player {
  return {
    id: cp.id, name: cp.name, age: cp.age, position: cp.position,
    attack: cp.attack, defense: cp.defense, stamina: cp.stamina,
    overall: cp.overall, potential: cp.potential, value: cp.value,
    injuryWeeks: cp.injuryWeeks,
  };
}

/**
 * 同联赛换队：把生涯球员快照从 fromTeam 移到 toTeam（双方阵容同步）。
 * 新队首发由 generateAILineup 每轮按 OVR 决定，无需手动改 starterIds。
 */
function moveCareerPlayerBetweenTeams(
  teams: Team[], cp: CareerPlayer, fromTeamId: string, toTeamId: string,
): Team[] {
  return teams.map((t) => {
    if (t.id === fromTeamId) {
      return {
        ...t,
        players: t.players.filter((p) => p.id !== cp.id),
        starterIds: t.starterIds.filter((id) => id !== cp.id),
      };
    }
    if (t.id === toTeamId) {
      return { ...t, players: [...t.players, cpToRosterPlayer(cp)] };
    }
    return t;
  });
}

/** 欧战 bracket 内把 oldId 全部替换为 newId，保留欧战进度 */
function remapTournamentTeamId(
  tourney: EuropeanTournament, oldId: string, newId: string,
): EuropeanTournament {
  const remapId = (id: string) => (id === oldId ? newId : id);
  const remapTie = (tie: EuropeanTie): EuropeanTie => ({
    ...tie,
    homeId: remapId(tie.homeId),
    awayId: remapId(tie.awayId),
    winnerId: tie.winnerId ? remapId(tie.winnerId) : tie.winnerId,
  });
  const remapKO = (ko: EuropeanKnockout | null): EuropeanKnockout | null =>
    ko ? { ...ko, ties: ko.ties.map(remapTie) } : null;
  return {
    ...tourney,
    leaguePhase: {
      ...tourney.leaguePhase,
      teams: tourney.leaguePhase.teams.map(remapId),
      fixtures: tourney.leaguePhase.fixtures.map((f) => ({ ...f, homeId: remapId(f.homeId), awayId: remapId(f.awayId) })),
      standings: tourney.leaguePhase.standings.map((st) => ({ ...st, teamId: remapId(st.teamId) })),
    },
    knockoutPlayoffs: remapKO(tourney.knockoutPlayoffs),
    roundOf16: remapKO(tourney.roundOf16),
    quarterFinals: remapKO(tourney.quarterFinals),
    semiFinals: remapKO(tourney.semiFinals),
    final: remapKO(tourney.final),
  };
}

/** 按日历欧战轮次定位玩家所在的淘汰赛 tie（9-10附加赛/11-12十六强/13-14八强/15-16半决赛/17决赛） */
function findPlayerTie(
  tourney: EuropeanTournament | null, playerTeamId: string, euroRound: number,
): EuropeanTie | null {
  if (!tourney) return null;
  const ko = euroRound <= 10 ? tourney.knockoutPlayoffs
    : euroRound <= 12 ? tourney.roundOf16
    : euroRound <= 14 ? tourney.quarterFinals
    : euroRound <= 16 ? tourney.semiFinals
    : tourney.final;
  return ko?.ties.find((t) => t.homeId === playerTeamId || t.awayId === playerTeamId) ?? null;
}

/** 当前队的 DB 层身份（生成队名与 DB 一致，按名字可靠匹配） */
function getCurrentClubDbIdentity(s: {
  teams: Team[]; playerTeamId: string; currentLeagueName: string;
}): { dbId: string; name: string; leagueName: string } {
  const team = s.teams.find((t) => t.id === s.playerTeamId);
  const dbTeam = team ? getAllTeams().find((rt) => rt.name === team.name) : undefined;
  return {
    dbId: dbTeam?.id ?? "",
    name: team?.name ?? "",
    leagueName: dbTeam?.league ?? s.currentLeagueName,
  };
}

/** 世界重建结果（buildWorldForMove 返回值） */
interface BuiltWorld {
  teams: Team[];
  otherLeaguesTeams: Team[];
  playerTeamId: string;
  leagueName: string;
  rules: LeagueRuleConfig;
  calendar: ReturnType<typeof generateCalendar>;
  euroStatus: EuropeanStatus;
}

/**
 * 重建世界到目标俱乐部所在联赛（提取自 joinCareerClub Step 2 引导流程）。
 * generateWorld 会换新 UUID → 必须按名字找队注入生涯球员快照。
 * 目标找不到时 throw，由调用方 try/catch 兜底（绝不崩溃）。
 */
function buildWorldForMove(
  target: { dbId: string; name: string; leagueName: string },
  cp: CareerPlayer,
): BuiltWorld {
  const allReal = getAllTeams();
  // 与 joinCareerClub 同款匹配规则：子串匹配要求被包含字符串 ≥ 4 字符
  const fuzzyMatch = (a: string, b: string) => {
    const la = a.toLowerCase().trim();
    const lb = b.toLowerCase().trim();
    return (la.includes(lb) && lb.length >= 4) || (lb.includes(la) && la.length >= 4);
  };
  const real = allReal.find((rt) => rt.id === target.dbId && target.dbId !== "")
    ?? allReal.find((rt) => rt.name.toLowerCase().trim() === target.name.toLowerCase().trim())
    ?? allReal.find((rt) => fuzzyMatch(rt.name, target.name));
  if (!real) throw new Error(`Transfer/loan target club "${target.name}" not found in teams database`);

  const { teams: generated, otherLeaguesTeams: background } = generateWorld(real.id, real.name, real.budget);

  const rules = getLeagueRules(real.league);
  const calendar = generateCalendar(rules.totalRounds);
  const euroSlots = buildEuroSlots(rules);
  const euroStatus: EuropeanStatus = euroSlots.some((sl) => sl !== "NONE")
    ? (euroSlots[0] as EuropeanStatus) ?? "NONE"
    : "NONE";

  // generateWorld 换 UUID → 按名字找玩家新队并注入生涯球员快照
  const finalTeams = generated.map((t) =>
    t.name === real.name
      ? { ...t, players: [...t.players, cpToRosterPlayer(cp)], europeanStatus: euroStatus }
      : { ...t, europeanStatus: "NONE" as EuropeanStatus },
  );
  const playerTeam = finalTeams.find((t) => t.name === real.name);
  if (!playerTeam) throw new Error(`Player team "${real.name}" not found after world generation`);

  return {
    teams: finalTeams,
    otherLeaguesTeams: background,
    playerTeamId: playerTeam.id,
    leagueName: real.league,
    rules,
    calendar,
    euroStatus,
  };
}

/** 事件冷却：同类型事件每赛季至多 1 次 */
function eventCooldown(cp: CareerPlayer, type: CareerEvent["type"]): boolean {
  return (cp.eventsThisSeason ?? []).includes(type);
}

/** 统一市场球员身价：硬编码转会市场/自由球员的旧值 → €200M 上限梯度体系 */
function normalizeMarketValues(players: Player[]): Player[] {
  return players.map((p) => ({ ...p, value: marketValue(p.overall, p.potential, p.age) }));
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 首发阵容健壮兜底：自动构建一套最强 11 人（最佳 GK + 最佳 10 外场；
 * 人数不足时以全队最优补齐）——赛季过渡/转会/退役/加载后首发绝不凭空消失。
 */
function buildFallbackStarters(team: Team): string[] {
  const players = [...(team.players ?? [])].sort((a, b) => b.overall - a.overall);
  const gk = players.find((p) => p.position === Position.GK);
  const outfield = players.filter((p) => p.position !== Position.GK);
  const ids: string[] = [];
  if (gk) ids.push(gk.id);
  for (const p of outfield) {
    if (ids.length >= 11) break;
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  for (const p of players) {
    if (ids.length >= 11) break;
    if (!ids.includes(p.id)) ids.push(p.id);
  }
  return ids.slice(0, 11);
}

/** 校验首发是否有效（恰好 11 人、全部存在、含至少 1 名门将）；无效则自动兜底修复 */
function ensureValidStarters(team: Team): Team {
  const valid = (team.starterIds ?? []).length === 11
    && team.starterIds.every((id) => team.players.some((p) => p.id === id))
    && team.starterIds.some((id) => team.players.find((p) => p.id === id)?.position === Position.GK);
  if (valid) return team;
  console.warn(`[store] 🛠️ 首发阵容异常（${team.name}，${team.starterIds?.length ?? 0} 人）— 自动填回最强 11 人`);
  return { ...team, starterIds: buildFallbackStarters(team) };
}

/** 租借目的地选择：50% 同联赛弱队 → 跨联赛（荷甲/德乙/土超/奥甲）→ 兜底同联赛 */
function pickLoanDestination(s: {
  teams: Team[]; playerTeamId: string; currentLeagueName: string;
}): { clubName: string; clubDbId: string; leagueName: string; crossLeague: boolean; gameTeamId: string | null } | null {
  if (Math.random() < 0.5) {
    const same = pickSameLeagueLoanTarget(s.teams, s.playerTeamId);
    if (same) {
      return { clubName: same.clubName, clubDbId: "", leagueName: s.currentLeagueName, crossLeague: false, gameTeamId: same.gameTeamId };
    }
  }
  const cross = pickCrossLeagueLoanTarget(s.currentLeagueName);
  if (cross) {
    return { clubName: cross.clubName, clubDbId: cross.clubDbId, leagueName: cross.leagueName, crossLeague: true, gameTeamId: null };
  }
  const same = pickSameLeagueLoanTarget(s.teams, s.playerTeamId);
  if (same) {
    return { clubName: same.clubName, clubDbId: "", leagueName: s.currentLeagueName, crossLeague: false, gameTeamId: same.gameTeamId };
  }
  return null;
}

/**
 * 生涯事件生成（每场比赛后调用一次）。
 * 顺序判定，第一个命中即返回；pendingMove 挂起期间不再触发换队类事件。
 */
function computeCareerEvent(
  s: { teams: Team[]; playerTeamId: string; currentLeagueName: string; currentWeek: number },
  cp: CareerPlayer,
  avgRecent: number,
  recent: number[],
): CareerEvent | null {
  // 守卫：已有待生效转会/租借 → 不再触发换队类事件
  if (cp.pendingMove) return null;

  const currentClubName = s.teams.find((t) => t.id === s.playerTeamId)?.name ?? "";

  // ① 俱乐部续约（现有逻辑 + 冷却）
  if (avgRecent > 8.0 && recent.length >= 3 && Math.random() < 0.30 && !eventCooldown(cp, "contract_renewal")) {
    return {
      type: "contract_renewal", title: "💰 俱乐部续约",
      body: `你在近期的出色表现（均分 ${avgRecent.toFixed(1)}）引起了管理层注意。俱乐部希望与你续约并提供加薪。`,
      actionLabel: "接受续约 (+2 OVR)", dismissLabel: "暂不考虑",
    };
  }

  // ② 豪门转会申请（Elite Transfer Offer）— 高评分 + 高 G+A + 高身价
  if (
    avgRecent >= TRANSFER_OFFER_MIN_AVG_RATING && recent.length >= 4
    && (cp.goals + cp.assists) >= TRANSFER_OFFER_MIN_GA
    && cp.value >= TRANSFER_OFFER_MIN_VALUE
    && cp.age < TRANSFER_OFFER_MAX_AGE
    && Math.random() < TRANSFER_OFFER_CHANCE
    && !eventCooldown(cp, "transfer_offer")
  ) {
    const dest = pickEliteDestination(currentClubName);
    if (dest) {
      const fee = computeTransferFee(cp.value);
      const sameLeague = dest.leagueName === s.currentLeagueName;
      return {
        type: "transfer_offer", title: "🔄 豪门求购",
        body: `${dest.clubName} 对你在近期的统治级表现印象深刻，开价 ${formatEuroM(fee)} 求购你。${
          sameLeague ? "（同联赛转会，接受后立即生效）" : "（转会将在本赛季结束后完成）"}`,
        actionLabel: "接受转会", dismissLabel: "拒绝",
        payload: { clubName: dest.clubName, clubDbId: dest.clubDbId, leagueName: dest.leagueName, fee },
      };
    }
  }

  // ③ 租借申请（Loan Offer）— 低迷 或 年轻潜力股在豪门坐板凳
  const poorForm = avgRecent < LOAN_OFFER_POOR_AVG && recent.length >= 5;
  const benchedProspect =
    cp.age <= LOAN_OFFER_MAX_AGE
    && cp.potential >= LOAN_OFFER_MIN_POTENTIAL
    && (cp.seasonAppearances ?? 0) < Math.max(1, s.currentWeek) * LOAN_OFFER_APPEARANCE_RATIO
    && isEliteClub(currentClubName);
  if ((poorForm || benchedProspect) && Math.random() < LOAN_OFFER_CHANCE && !eventCooldown(cp, "loan_offer")) {
    const dest = pickLoanDestination(s);
    if (dest) {
      const reason = poorForm
        ? "近期状态低迷，球队希望外租你找回状态。"
        : "队内竞争激烈，出场机会有限，俱乐部建议外租锻炼。";
      return {
        type: "loan_offer", title: "🤝 租借申请",
        body: `${dest.clubName}（${dest.leagueName}）向你发出租借邀请。${reason}${
          dest.crossLeague
            ? "（租借将在本赛季结束后开始，效力一个赛季后回归）"
            : "（同联赛租借，接受后立即生效，赛季末回归）"}`,
        actionLabel: "接受租借", dismissLabel: "留在队中",
        payload: {
          clubName: dest.clubName, clubDbId: dest.clubDbId, leagueName: dest.leagueName,
          crossLeague: dest.crossLeague, gameTeamId: dest.gameTeamId, reason,
        },
      };
    }
  }

  // ④ 教练组警告 / 挂牌（现有逻辑原样保留，不占冷却）
  if (avgRecent < 6.2 && recent.length >= 4) {
    return {
      type: "demotion_warning", title: "⚠️ 教练组警告",
      body: `你近期表现持续低迷（均分 ${avgRecent.toFixed(1)}），教练组对你提出了严厉批评。如果继续低迷，可能被下放或挂牌。`,
      actionLabel: "我会努力改进", dismissLabel: "知道了",
    };
  }
  if (avgRecent < 5.8 && recent.length >= 6 && Math.random() < 0.40) {
    return {
      type: "transfer_listed", title: "📋 被挂牌出售",
      body: `由于长期低迷的表现，俱乐部决定将你放入转会名单。`,
      actionLabel: "接受现实", dismissLabel: "知道了",
    };
  }

  return null;
}

/** 旧存档兜底：transfer_offer 无 payload 时现场随机豪门 + 转会费 */
function buildFallbackTransferPayload(
  s: { teams: Team[]; playerTeamId: string },
  cp: CareerPlayer,
): (EliteDestination & { fee: number }) | null {
  const currentClubName = s.teams.find((t) => t.id === s.playerTeamId)?.name ?? "";
  const dest = pickEliteDestination(currentClubName);
  if (!dest) return null;
  return { ...dest, fee: computeTransferFee(cp.value) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampFloat(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));
}

/** Position-weighted OVR: FWD=attack-heavy, MID=playmaking-heavy, DEF=defense-heavy */
function calculateOVR(att: number, plm: number, def: number, pos: Position): number {
  switch (pos) {
    case Position.FWD: return Math.round(att * 0.70 + plm * 0.20 + def * 0.10);
    case Position.MID: return Math.round(att * 0.30 + plm * 0.50 + def * 0.20);
    case Position.DEF: return Math.round(att * 0.10 + plm * 0.20 + def * 0.70);
    case Position.GK:  return Math.round(att * 0.05 + plm * 0.10 + def * 0.85);
    default:           return Math.round(att * 0.33 + plm * 0.34 + def * 0.33);
  }
}

/** Compute starter IDs by position-sorted overall. Guarantees 11 IDs — falls back to injured players if needed. */
function autoStarterIds(players: Player[], formation: Formation): string[] {
  const slots = FORMATION_SLOTS[formation];
  const ids: string[] = [];

  for (const pos of [Position.GK, Position.DEF, Position.MID, Position.FWD]) {
    const needed = slots[pos];
    const byPos = players.filter((p) => p.position === pos);

    // 1. Healthy first, sorted by overall
    const healthy = byPos.filter((p) => p.injuryWeeks === 0).sort((a, b) => b.overall - a.overall);
    ids.push(...healthy.slice(0, needed).map((p) => p.id));

    // 2. If still short, back-fill with injured (highest overall) — they'll be flagged pre-match
    const short = needed - Math.min(needed, healthy.length);
    if (short > 0) {
      const injured = byPos
        .filter((p) => p.injuryWeeks > 0 && !ids.includes(p.id))
        .sort((a, b) => b.overall - a.overall);
      ids.push(...injured.slice(0, short).map((p) => p.id));
    }
  }

  return ids.slice(0, 11);
}

/** Patch stale localStorage data — handles missing fields from old save formats. */
function migrateTeams(teams: Team[]): void {
  for (const t of teams) {
    // ── Team-level defaults ──
    if (!t.formation || !ALL_FORMATIONS.includes(t.formation as Formation)) {
      (t as { formation: Formation }).formation = "4-4-2";
    }
    if (!t.tactic || !ALL_TACTICS.includes(t.tactic as Tactic)) {
      (t as { tactic: Tactic }).tactic = "balanced";
    }
    if (!t.budget && t.budget !== 0) (t as { budget: number }).budget = 0;
    if (!t.europeanStatus) (t as { europeanStatus: string }).europeanStatus = "NONE";
    if (!t.u21Players) (t as { u21Players: Player[] }).u21Players = [];
    if (!t.u18Players) (t as { u18Players: Player[] }).u18Players = [];

    // ── Filter out null/undefined entries from all player arrays ──
    (t as { players: (Player | null | undefined)[] }).players = (
      t.players ?? []
    ).filter((p): p is Player => p != null);
    (t as { u21Players: (Player | null | undefined)[] }).u21Players = (
      t.u21Players ?? []
    ).filter((p): p is Player => p != null);
    (t as { u18Players: (Player | null | undefined)[] }).u18Players = (
      t.u18Players ?? []
    ).filter((p): p is Player => p != null);

    // ── Player-level defaults for every squad ──
    for (const squad of [t.players, t.u21Players, t.u18Players]) {
      for (const p of squad) {
        if (!p) continue;
        if (p.id === undefined) (p as { id: string }).id = generateUUID();
        if (!p.name) (p as { name: string }).name = "未知球员";
        if (p.age === undefined) (p as { age: number }).age = 22;
        if (p.position === undefined) (p as { position: Position }).position = Position.MID;
        if (p.attack === undefined) (p as { attack: number }).attack = 50;
        if (p.defense === undefined) (p as { defense: number }).defense = 50;
        if (p.stamina === undefined) (p as { stamina: number }).stamina = 80;
        if (p.injuryWeeks === undefined) (p as { injuryWeeks: number }).injuryWeeks = 0;
        if (p.potential === undefined) (p as { potential: number }).potential = randInt(55, 85);
        if (p.overall === undefined) (p as { overall: number }).overall =
          Math.round(p.attack * 0.35 + p.defense * 0.35 + p.stamina * 0.30);
        if (p.value === undefined) (p as { value: number }).value =
          marketValue(p.overall, p.potential, p.age);
      }
    }

    // ── Fix or regenerate starterIds ──
    if (!t.starterIds || !Array.isArray(t.starterIds)) {
      (t as { starterIds: string[] }).starterIds = autoStarterIds(t.players, t.formation);
    } else {
      // Remove stale IDs that don't exist in the current player list
      const validIds = new Set(t.players.map((p) => p.id));
      (t as { starterIds: string[] }).starterIds = t.starterIds.filter((id) =>
        validIds.has(id),
      );
      if (t.starterIds.length !== 11) {
        (t as { starterIds: string[] }).starterIds = autoStarterIds(t.players, t.formation);
      }
    }
  }
}

/** Fisher-Yates shuffle. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Centralized standings sorter — used everywhere.
 * Rules: 1) Points ↓  2) Goal Difference ↓  3) Goals For ↓
 * Also sanitizes NaN values to 0.
 */
function sortStandings(standings: LeagueStandings[]): LeagueStandings[] {
  // Sanitize NaN
  for (const s of standings) {
    if (isNaN(s.points)) s.points = 0;
    if (isNaN(s.goalsFor)) s.goalsFor = 0;
    if (isNaN(s.goalsAgainst)) s.goalsAgainst = 0;
  }
  return [...standings].sort((a, b) => {
    // 1. Points — higher first
    if (b.points !== a.points) return b.points - a.points;
    // 2. Goal difference — higher first
    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    if (gdB !== gdA) return gdB - gdA;
    // 3. Goals scored — higher first
    return b.goalsFor - a.goalsFor;
  });
}

// ── Season-end helpers ─────────────────────────────────────

const PRIZES = [50_000_000, 40_000_000, 30_000_000, 20_000_000, 15_000_000, 10_000_000, 5_000_000, 2_000_000];

/**
 * Build a SeasonResult from current standings. Used by EVERY season-ending path
 * (league end without Europe, European final, European elimination) so the
 * end-of-season UI (which requires a non-null seasonResult) never dead-ends.
 */
function buildSeasonResult(
  standings: LeagueStandings[],
  teams: Team[],
  playerTeamId: string,
  rules?: LeagueRuleConfig | null,
): SeasonResult {
  const sorted = sortStandings(standings);
  const champ = teams.find((t) => t.id === sorted[0]?.teamId)?.name ?? "???";
  const pIdx = sorted.findIndex((s) => s.teamId === playerTeamId);
  const rank = Math.max(1, pIdx + 1);
  const prize = PRIZES[pIdx] ?? 1_000_000;
  const slots = rules ? buildEuroSlots(rules) : [];
  const europeanQualification: EuropeanStatus = (slots[rank - 1] as EuropeanStatus | undefined) ?? "NONE";
  return { rank, champion: champ, prizeMoney: prize, europeanQualification };
}

/**
 * Age a squad by one season: +1 year, growth for youth, prime stability,
 * non-linear decline for veterans. OVR is recomputed with the SAME
 * position-weighted formula used everywhere else (stamina weight 0) —
 * previously the rollover used a 0.35/0.35/0.30 formula that made OVR
 * oscillate wildly from season to season.
 */
function ageSquadPlayers(players: Player[]): Player[] {
  return players.map((p) => {
    const newAge = p.age + 1;
    let { overall, potential, attack, defense, stamina } = p;

    if (newAge <= 26 && overall < potential) {
      // Golden years: rapid growth toward potential
      const gap = potential - overall;
      const boost = gap >= 10 ? randInt(3, 6) : gap >= 5 ? randInt(2, 4) : randInt(1, 2);
      attack = Math.min(99, attack + randInt(0, boost));
      defense = Math.min(99, defense + randInt(0, boost));
      stamina = Math.min(99, stamina + randInt(0, 2));
    } else if (newAge >= 27 && newAge <= 31) {
      // Prime: stable, slight micro-growth or flat
      if (overall < potential && Math.random() < 0.3) {
        attack = Math.min(99, attack + 1);
        defense = Math.min(99, defense + 1);
      }
    } else if (newAge >= 32) {
      // Decline: age-related natural regression
      const decline = newAge >= 35 ? randInt(2, 5) : newAge >= 33 ? randInt(1, 3) : randInt(0, 2);
      attack = Math.max(1, attack - randInt(0, decline));
      defense = Math.max(1, defense - randInt(0, decline));
      stamina = Math.max(1, stamina - randInt(0, Math.floor(decline / 2)));
      // Potential re-anchored downward
      potential = Math.max(overall, potential - randInt(0, 2));
    }

    // Only recompute OVR when attributes actually changed. Unchanged players keep
    // their database overall — recomputing unconditionally made real players' OVR
    // drift at the first rollover (the DB overall was not derived from this formula)
    // and made "veterans" appear to improve.
    if (attack !== p.attack || defense !== p.defense || stamina !== p.stamina) {
      // Position-weighted OVR (stamina does NOT affect overall — see WEIGHTS)
      overall = calcOverall(p.position, attack, defense, stamina);
    }
    const value = marketValue(overall, potential, newAge);

    return { ...p, age: newAge, overall, potential, attack, defense, stamina, value, injuryWeeks: 0 };
  });
}

// ── Growth system ──────────────────────────────────────────

function applyGrowth(teams: Team[], teamId: string, starterIds: string[]): Team[] {
  return teams.map((t) => {
    if (t.id !== teamId) return t;
    const starterSet = new Set(starterIds);

    return {
      ...t,
      players: t.players.map((p) => {
        if (!starterSet.has(p.id) || p.injuryWeeks > 0) return p;

        const potentialFactor = (p.potential - 50) / 49; // 0..1
        const growthChance = 0.25 + potentialFactor * 0.55; // 25%–80%

        // Age multiplier — veterans (≥30) never grow; they only decline (see below)
        let ageMult = 1.0;
        if (p.age <= 23) ageMult = 1.5;
        else if (p.age <= 29) ageMult = 1.0;
        else ageMult = 0.0;

        // ── 潜力天花板硬门槛（曾缺失）：整体不得超过潜力值 ──
        // 旧实现无 overall<potential 门禁，年轻球员每场 +1~2 点直冲 99，
        // 3 个赛季后全联盟集体膨胀到 83-89，豪门差距被抹平（引擎背锅的真相）。
        // gapFactor 越接近潜力成长越慢（递减收益），封顶 1.0。
        const gapToPot = p.potential - p.overall;
        const gapFactor = gapToPot <= 0 ? 0 : Math.min(1, Math.max(0.2, gapToPot / 12));

        if (Math.random() < growthChance * ageMult * gapFactor) {
          // Gain 1-2 points distributed among att/def/sta
          const gains = randInt(1, 2);
          let { attack, defense, stamina } = p;
          for (let i = 0; i < gains; i++) {
            const r = Math.random();
            if (r < 0.4) attack = Math.min(99, attack + 1);
            else if (r < 0.75) defense = Math.min(99, defense + 1);
            else stamina = Math.min(99, stamina + 1);
          }
          // Recalculate overall
          const overall = calcOverall(p.position, attack, defense, stamina);
          return { ...p, attack, defense, stamina, overall,
            value: marketValue(overall, p.potential, p.age) };
        }

        // Old-player decline (30+)
        if (p.age >= 30 && Math.random() < (p.age >= 34 ? 0.15 : 0.05)) {
          const r = Math.random();
          let { attack, defense, stamina } = p;
          if (r < 0.4) attack = Math.max(1, attack - 1);
          else if (r < 0.75) defense = Math.max(1, defense - 1);
          else stamina = Math.max(1, stamina - 1);
          const overall = calcOverall(p.position, attack, defense, stamina);
          return { ...p, attack, defense, stamina, overall,
            value: marketValue(overall, p.potential, p.age) };
        }

        return p;
      }),
    };
  });
}

/** Quick overall calculator (mirrors worldGenerator). */
function calcOverall(pos: Position, att: number, def: number, sta: number): number {
  const w = WEIGHTS[pos];
  return Math.round(att * w.att + def * w.def + sta * w.sta);
}

// Overall weights — stamina does NOT affect overall (it's a separate fitness stat).
// Injury penalty is applied at display time via getDisplayedOverall().
const WEIGHTS: Record<Position, { att: number; def: number; sta: number }> = {
  [Position.FWD]: { att: 0.75, def: 0.25, sta: 0.00 },
  [Position.MID]: { att: 0.50, def: 0.50, sta: 0.00 },
  [Position.DEF]: { att: 0.25, def: 0.75, sta: 0.00 },
  [Position.GK]:  { att: 0.10, def: 0.90, sta: 0.00 },
};


// ── Stamina & injury helpers ────────────────────────────────

const MATCH_DRAIN_MIN = 30;
const MATCH_DRAIN_MAX = 40;
const WEEKLY_RECOVERY = 45;          // all players recover ~45 per round
const STAMINA_CAP = 100;

function applyStaminaEffects(teams: Team[], teamId: string, starterIds: string[], injuries: { playerId: string; weeks: number }[]): Team[] {
  return teams.map((t) => {
    if (t.id !== teamId) return t;

    const starterSet = new Set(starterIds);
    const injuryMap = new Map(injuries.map((i) => [i.playerId, i.weeks]));

    return {
      ...t,
      players: t.players.map((p) => {
        let { stamina, injuryWeeks } = p;

        // 1. Everyone gets weekly recovery (fast natural regen)
        stamina = clamp(stamina + WEEKLY_RECOVERY + randInt(-8, 8), 0, STAMINA_CAP);

        // 2. Starters additionally burn match energy
        if (starterSet.has(p.id)) {
          stamina = clamp(stamina - randInt(MATCH_DRAIN_MIN, MATCH_DRAIN_MAX), 0, STAMINA_CAP);
        }

        // Apply injury if occurred
        let { potential } = p;
        if (injuryMap.has(p.id)) {
          injuryWeeks = injuryMap.get(p.id)!;
          // Major injury (8+ weeks) → permanent potential decline
          if (injuryWeeks >= 6) {
            const penalty = randInt(2, 5);
            potential = Math.max(p.overall, p.potential - penalty);
            console.log(`[store] 🤕 ${p.name} 重伤 ${injuryWeeks}周，潜力永久下降 ${p.potential - potential} 点（${p.potential} → ${potential}）`);
          }
        }

        return { ...p, stamina, injuryWeeks, potential };
      }),
    };
  });
}

// ── Store ───────────────────────────────────────────────────

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      gameStatus: "SETUP",
      gameMode: "manager" as GameMode,
      currentLeagueName: "",
      teams: [],
      otherLeaguesTeams: [],
      playerTeamId: "",
      careerPlayer: null as CareerPlayer | null,
      leagueRules: null as LeagueRuleConfig | null,
      currentWeek: 1,
      currentMatchday: 1,
      seasonCalendar: [],
      virtualEuroTeams: [],
      playerTournament: null,
      season: 1,
      maxMatchweeks: 38,
      isSeasonEnded: false,
      seasonResult: null,
      standings: [],
      transferMarketPlayers: [],
      seasonAwards: null as SeasonAwards | null,
      isSimulating: false,
      simulationPaused: false,
      seasonMatchLog: [],
      simulationSegmentStart: 0,
      seasonPlayerStats: {},
      pendingElimination: false,
      careerLegacy: null,
      simError: null,
      careerEvent: null as CareerEvent | null,

      initGame: (teamId, teamName, budget) => {
        const { teams, otherLeaguesTeams } = generateWorld(teamId, teamName, budget);
        const playerTeam = teams.find((t) => t.name === teamName);
        if (!playerTeam) throw new Error(`球队"${teamName}"未生成，请重试。`);

        // Load league rules for this competition
        const leagueName = getAllTeams().find((t) => t.id === teamId)?.league ?? "";
        const rules = getLeagueRules(leagueName);
        const calendar = generateCalendar(rules.totalRounds);
        const vTeams = getVirtualTeams();

        // Determine European qualification from league rules
        const euroSlots = buildEuroSlots(rules);
        const hasEuroSpot = euroSlots.some(s => s !== "NONE");
        const playerEuroStatus: EuropeanStatus = hasEuroSpot
          ? (euroSlots[0] as EuropeanStatus) ?? "UCL"  // best available tier
          : "NONE";

        const updatedTeams = teams.map((t) =>
          t.id === playerTeam.id
            ? { ...t, europeanStatus: playerEuroStatus }
            : { ...t, europeanStatus: "NONE" as EuropeanStatus },
        );

        set({
          gameStatus: "PLAYING",
          currentLeagueName: leagueName,
          leagueRules: rules,
          teams: updatedTeams,
          otherLeaguesTeams,
          playerTeamId: playerTeam.id,
          currentWeek: 1,
          currentMatchday: 1,
          seasonCalendar: calendar,
          virtualEuroTeams: vTeams,
          playerTournament: playerEuroStatus !== "NONE"
            ? createTournament(playerEuroStatus, [playerTeam, ...vTeams.slice(0, 35)])
            : null,
          maxMatchweeks: rules.totalRounds,
          isSeasonEnded: false,
          seasonResult: null,
          standings: buildStandings(updatedTeams),
          transferMarketPlayers: normalizeMarketValues([
            ...initialMarketPlayers,
            ...dedupeFreeAgents(FREE_AGENTS, [...updatedTeams, ...otherLeaguesTeams]),
          ]),
        });
      },

      advanceWeek: () => {
        set((s) => ({
          currentWeek: s.currentWeek + 1,
          teams: s.teams.map((t) => {
            return {
              ...t,
              players: t.players.map((p) => {
                const injured = p.injuryWeeks > 0;
                // All players recover ~45 per round (natural regen)
                const recovery = WEEKLY_RECOVERY + randInt(-8, 8);
                return {
                  ...p,
                  injuryWeeks: injured ? p.injuryWeeks - 1 : 0,
                  stamina: clamp(p.stamina + recovery, 0, STAMINA_CAP),
                };
              }),
            // Auto-replace any recovered starters; guarantee 11 even if injured fallback needed
            starterIds: (() => {
              const healthy = t.players.filter((p) => p.injuryWeeks === 0);
              const healthyIds = new Set(healthy.map((p) => p.id));
              let current = t.starterIds.filter((id) => healthyIds.has(id));

              if (current.length < 11) {
                const currentSet = new Set(current);
                // Fill with healthy first — POSITION-AWARE: GK NEVER fills outfield
                const gkCount = current.filter(id => t.players.find(p => p.id === id)?.position === "GK").length;
                const needGK = Math.max(0, ((FORMATION_SLOTS as Record<string, Record<string, number>>)[t.formation]?.[Position.GK] ?? 1) - gkCount);
                if (needGK > 0) {
                  const extraGK = healthy.filter(p => p.position === "GK" && !currentSet.has(p.id))
                    .sort((a,b) => b.overall - a.overall).slice(0, needGK).map(p => p.id);
                  for (const id of extraGK) { current.push(id); currentSet.add(id); }
                }
                const stillNeed = 11 - current.length;
                if (stillNeed > 0) {
                  const extraOut = healthy.filter(p => p.position !== "GK" && !currentSet.has(p.id))
                    .sort((a,b) => b.overall - a.overall).slice(0, stillNeed).map(p => p.id);
                  for (const id of extraOut) { current.push(id); }
                }

                // Still short? Back-fill with injured (position-aware)
                if (current.length < 11) {
                  const sNeed = 11 - current.length;
                  const injuredBk = t.players.filter(p => p.injuryWeeks > 0 && !current.includes(p.id))
                    .sort((a,b) => b.overall - a.overall).slice(0, sNeed).map(p => p.id);
                  for (const id of injuredBk) { current.push(id); }
                }
              }
              return current.slice(0, 11);
            })(),
          };
        }),
      }));
      },

      setPlayerFormation: (formation) => {
        set((s) => ({
          teams: s.teams.map((t) => {
            if (t.id !== s.playerTeamId) return t;
            // Recalculate starterIds for new formation
            return { ...t, formation, starterIds: autoStarterIds(t.players, formation) };
          }),
        }));
      },

      setPlayerTactic: (tactic) => {
        set((s) => ({
          teams: s.teams.map((t) =>
            t.id === s.playerTeamId ? { ...t, tactic } : t,
          ),
        }));
      },

      buyPlayer: (player, targetSquad) => {
        const { teams, playerTeamId, transferMarketPlayers } = get();
        const idx = teams.findIndex((t) => t.id === playerTeamId);
        if (idx === -1) return;
        const team = teams[idx];

        // Age validation for youth squads
        if (targetSquad === "u21" && player.age > 21) {
          alert(`${player.name}（${player.age}岁）年龄超过 U21 上限（21岁），无法签约至该梯队。`);
          return;
        }
        if (targetSquad === "u18" && player.age > 18) {
          alert(`${player.name}（${player.age}岁）年龄超过 U18 上限（18岁），无法签约至该梯队。`);
          return;
        }

        // Budget check
        if (team.budget < player.value) {
          alert(`资金不足！需要 €${player.value.toLocaleString()}，当前预算仅 €${team.budget.toLocaleString()}。`);
          return;
        }

        const newPlayer: Player = {
          ...player,
          id: generateUUID(),
          injuryWeeks: 0,
          stamina: clamp(player.stamina, 0, STAMINA_CAP),
        };

        const updated: Team = {
          ...team,
          budget: team.budget - player.value,
          players: targetSquad === "first"
            ? [...team.players, newPlayer]
            : team.players,
          u21Players: targetSquad === "u21"
            ? [...team.u21Players, newPlayer]
            : team.u21Players,
          u18Players: targetSquad === "u18"
            ? [...team.u18Players, newPlayer]
            : team.u18Players,
        };
        const updatedTeams = [...teams];
        updatedTeams[idx] = updated;

        const squadLabel = targetSquad === "first" ? "一线队" : targetSquad === "u21" ? "U21" : "U18";

        set({
          teams: updatedTeams,
          transferMarketPlayers: transferMarketPlayers.filter((p) => p.id !== player.id),
        });

        console.log(`[store] ✅ 签约 "${player.name}" 至 ${squadLabel}，花费 €${player.value.toLocaleString()}，剩余 €${updated.budget.toLocaleString()}`);
      },

      sellPlayer: (playerId, fromSquad) => {
        const { teams, playerTeamId, transferMarketPlayers } = get();
        const idx = teams.findIndex((t) => t.id === playerTeamId);
        if (idx === -1) return;
        const team = teams[idx];

        // Find the player in the correct squad
        const squadKey = fromSquad === "first" ? "players" : fromSquad === "u21" ? "u21Players" : "u18Players";
        const squad = team[squadKey] as Player[];
        const player = squad.find((p) => p.id === playerId);
        if (!player) return;

        // Cannot sell a starter
        if (fromSquad === "first" && team.starterIds.includes(playerId)) {
          alert(`${player.name} 正在首发名单中！请先将其换下至替补席，再尝试出售。`);
          return;
        }

        const sellPrice = Math.round(player.value * 0.8);

        const updated: Team = {
          ...team,
          budget: team.budget + sellPrice,
          [squadKey]: squad.filter((p) => p.id !== playerId),
        };
        const updatedTeams = [...teams];
        updatedTeams[idx] = updated;

        set({
          teams: updatedTeams,
          // Return player to market (with new ID to avoid conflicts)
          transferMarketPlayers: [
            ...transferMarketPlayers,
            { ...player, id: generateUUID() },
          ],
        });

        console.log(`[store] 💰 出售 "${player.name}"，回血 €${sellPrice.toLocaleString()}，当前预算 €${updated.budget.toLocaleString()}`);
      },

      swapPlayer: (outId, inId) => {
        set((s) => ({
          teams: s.teams.map((t) => {
            if (t.id !== s.playerTeamId) return t;
            const ids = [...t.starterIds];
            const pos = ids.indexOf(outId);
            if (pos === -1) return t;
            // Verify both players exist in squad before swapping
            const outPlayer = t.players.find((p) => p.id === outId);
            const inPlayer = t.players.find((p) => p.id === inId);
            if (!outPlayer || !inPlayer) {
              console.error(`[store] ❌ swapPlayer: outId=${outId} or inId=${inId} not found in squad — aborting`);
              return t;
            }
            ids[pos] = inId;
            console.log(`[store] 🔄 Swap: ${outPlayer.name} ↔ ${inPlayer.name}. Squad stays ${t.players.length} players.`);
            return { ...t, starterIds: ids };
          }),
        }));
      },

      autoRotateSquad: () => {
        set((s) => {
          const team = s.teams.find((t) => t.id === s.playerTeamId);
          if (!team) return s;

          const totalBefore = team.players.length;
          const result = [...team.starterIds];
          const currentStarters = new Set(result);
          let changed = false;
          // Track which players were explicitly benched — safety net
          const benchedIds: string[] = [];

          for (let i = 0; i < result.length; i++) {
            const starterId = result[i];
            const starter = team.players.find((p) => p.id === starterId);
            if (!starter) continue;

            // Only rotate if stamina low or injured
            if (starter.stamina >= 50 && starter.injuryWeeks === 0) continue;

            // Candidates: SAME position, healthy, currently NOT a starter
            const samePosHealthy = team.players.filter(
              (p) =>
                !currentStarters.has(p.id) &&
                p.position === starter.position &&
                p.injuryWeeks === 0,
            );

            if (samePosHealthy.length === 0) {
              console.log(
                `[store] ⚠️ Auto-rotate: no healthy ${starter.position} on bench for ${starter.name} — keeping in XI`,
              );
              continue; // ← 绝对不删，原封不动留在首发
            }

            // Priority 1: stamina >= 60 → highest overall
            const tier1 = samePosHealthy.filter((p) => p.stamina >= 60);
            let replacement: Player | undefined;
            if (tier1.length > 0) {
              replacement = tier1.sort((a, b) => b.overall - a.overall)[0];
            } else {
              // Priority 2: any stamina → highest stamina
              replacement = samePosHealthy.sort((a, b) => b.stamina - a.stamina)[0];
            }

            if (!replacement) continue; // ← 保底：找不到就不动

            // ── Safe swap: bench the old starter, promote the replacement ──
            currentStarters.delete(starterId);
            currentStarters.add(replacement.id);
            result[i] = replacement.id;
            benchedIds.push(starterId); // explicitly record benched player
            changed = true;
            console.log(
              `[store] 🔄 Auto-rotate: ${starter.name} → ${replacement.name} (OVR ${replacement.overall} STA ${replacement.stamina})`,
            );
          }

          if (!changed) return s;

          // Safety: result must be exactly 11
          if (result.length !== 11) {
            console.error(`[store] ❌ autoRotateSquad produced ${result.length} starters — aborting`);
            return s;
          }

          // ── Invariant: benched players MUST still be in team.players ──
          const updatedTeam = { ...team, starterIds: result };
          const missingBenched = benchedIds.filter(
            (id) => !updatedTeam.players.some((p) => p.id === id),
          );
          if (missingBenched.length > 0) {
            console.error(
              `[store] ❌ Auto-rotate: ${missingBenched.length} benched player(s) missing from squad! IDs: ${missingBenched.join(", ")}`,
            );
            return s; // abort — would lose players
          }
          console.log(
            `[store] ✅ Auto-rotate: ${benchedIds.length} player(s) moved to bench. Squad total: ${totalBefore} → ${updatedTeam.players.length}`,
          );

          return {
            teams: s.teams.map((t) =>
              t.id === s.playerTeamId ? updatedTeam : t,
            ),
          };
        });
      },

      autoFillSquad: () => {
        set((s) => {
          const team = s.teams.find((t) => t.id === s.playerTeamId);
          if (!team) return s;

          const slots = FORMATION_SLOTS[team.formation];
          const result: string[] = [...team.starterIds];
          let firstTeam = [...team.players];
          let u21 = [...team.u21Players];
          let promoted = 0;

          // Helper: count how many starters we have per position
          const posCount = (pos: Position) =>
            result.filter((id) => firstTeam.find((p) => p.id === id)?.position === pos).length;

          // For each position, fill deficits
          for (const pos of [Position.GK, Position.DEF, Position.MID, Position.FWD] as Position[]) {
            const deficit = (slots[pos] ?? 0) - posCount(pos);
            if (deficit <= 0) continue;

            // ── Step B: first-team bench, same position, stamina >= 60, best OVR ──
            const benchPicks = firstTeam
              .filter((p) => !result.includes(p.id) && p.position === pos && p.injuryWeeks === 0 && p.stamina >= 60)
              .sort((a, b) => b.overall - a.overall)
              .slice(0, deficit);

            result.push(...benchPicks.map((p) => p.id));
            let filled = benchPicks.length;

            // ── Step C: U21 fallback, same position, stamina >= 60, best OVR ──
            const stillNeed = deficit - filled;
            if (stillNeed > 0) {
              const youthPicks = u21
                .filter((p) => !result.includes(p.id) && p.position === pos && p.injuryWeeks === 0 && p.stamina >= 60)
                .sort((a, b) => b.overall - a.overall)
                .slice(0, stillNeed);

              for (const yp of youthPicks) {
                u21 = u21.filter((p) => p.id !== yp.id);
                firstTeam = [...firstTeam, yp];
                result.push(yp.id);
                promoted++;
                filled++;
              }
            }

            // ── Desperate: same position, any stamina, best OVR ──
            const desperate = deficit - filled;
            if (desperate > 0) {
              const dPicks = [...firstTeam.filter((p) => !result.includes(p.id) && p.position === pos && p.injuryWeeks === 0),
                ...u21.filter((p) => !result.includes(p.id) && p.position === pos && p.injuryWeeks === 0)]
                .sort((a, b) => b.overall - a.overall)
                .slice(0, desperate);

              for (const dp of dPicks) {
                if (u21.some((p) => p.id === dp.id)) {
                  u21 = u21.filter((p) => p.id !== dp.id);
                  firstTeam = [...firstTeam, dp];
                  promoted++;
                }
                result.push(dp.id);
              }
            }
          }

          // ── Final hard-clamp ──
          const final = result.slice(0, 11);
          if (final.length !== 11) {
            console.error(`[store] ❌ Auto-fill produced ${final.length} starters — aborting`);
            return s;
          }

          console.log(`[store] 🔧 Auto-fill: ${team.starterIds.length} → 11${promoted > 0 ? ` (${promoted} promoted from U21)` : ""}`);

          return {
            teams: s.teams.map((t) =>
              t.id === s.playerTeamId
                ? { ...t, players: firstTeam, u21Players: u21, starterIds: final }
                : t,
            ),
          };
        });
      },

      setStarterSlot: (slotIndex, playerId) => {
        set((s) => ({
          teams: s.teams.map((t) => {
            if (t.id !== s.playerTeamId) return t;
            // Verify the incoming player exists in the squad
            const incoming = t.players.find((p) => p.id === playerId);
            if (!incoming) {
              console.error(`[store] ❌ setStarterSlot: playerId=${playerId} not found in squad — aborting`);
              return t;
            }
            const ids = [...t.starterIds].slice(0, 11);
            while (ids.length < 11) ids.push("");
            if (slotIndex >= 0 && slotIndex < 11) {
              // Remember who was in this slot before the swap
              const displacedId = ids[slotIndex];
              const existingIdx = ids.indexOf(playerId);
              if (existingIdx !== -1 && existingIdx !== slotIndex) {
                // Player was already in another slot — swap: displaced goes there
                ids[existingIdx] = ids[slotIndex];
              }
              ids[slotIndex] = playerId;
              // Verify displaced player still exists (now on bench)
              if (displacedId && displacedId !== "" && displacedId !== playerId) {
                const stillThere = t.players.some((p) => p.id === displacedId);
                if (!stillThere) {
                  console.error(`[store] ❌ setStarterSlot: displaced player ${displacedId} vanished from squad! Aborting.`);
                  return t;
                }
              }
            }
            return { ...t, starterIds: ids };
          }),
        }));
      },

      promotePlayer: (playerId, from) => {
        set((s) => ({
          teams: s.teams.map((t) => {
            if (t.id !== s.playerTeamId) return t;
            const key = from === "u21" ? "u21Players" : "u18Players";
            const youthSquad = t[key] as Player[];
            const idx = youthSquad.findIndex((p) => p.id === playerId);
            if (idx === -1) return t;
            const player = youthSquad[idx];
            return {
              ...t,
              players: [...t.players, player],
              [key]: youthSquad.filter((p) => p.id !== playerId),
            };
          }),
        }));
      },

      demotePlayer: (playerId, to) => {
        set((s) => ({
          teams: s.teams.map((t) => {
            if (t.id !== s.playerTeamId) return t;
            // Cannot demote a starter
            if (t.starterIds.includes(playerId)) return t;
            const player = t.players.find((p) => p.id === playerId);
            if (!player) return t;
            // Age check
            const key = to === "u21" ? "u21Players" : "u18Players";
            const maxAge = to === "u21" ? 21 : 18;
            if (player.age > maxAge) {
              alert(`${player.name}（${player.age}岁）年龄超过 ${to.toUpperCase()} 上限（${maxAge}岁），无法下放。`);
              return t;
            }
            return {
              ...t,
              players: t.players.filter((p) => p.id !== playerId),
              [key]: [...(t[key] as Player[]), player],
            };
          }),
        }));
      },

      playMatchweek: () => {
        const state = get();
        const { teams, playerTeamId, standings, seasonCalendar, currentMatchday, virtualEuroTeams } = state;
        const md = seasonCalendar?.[(currentMatchday ?? 1) - 1];
        if (!md) throw new Error(`赛历数据异常（当前比赛日：${currentMatchday}），请开启新赛季。`);

        const label = md?.name ?? `比赛日 ${currentMatchday}`;
        console.log(`[store] ⏩ ${label}`);

        if (state.isSeasonEnded) throw new Error("本赛季已结束！");

        const playerTeam = teams.find((t) => t.id === playerTeamId);
        if (!playerTeam) throw new Error("未找到玩家球队数据，请重置游戏。");

        // Auto-fix: if starterIds reference deleted/non-existent players, auto-fill
        const validIds = playerTeam.starterIds.filter((id) =>
          playerTeam.players.some((p) => p.id === id),
        );
        if (validIds.length !== 11) {
          console.warn(`[store] ⚠️ ${playerTeam.starterIds.length - validIds.length} stale starter IDs detected. Auto-filling...`);
          // compute fresh starters
          const healthy = playerTeam.players.filter((p) => p.injuryWeeks === 0);
          const slots = FORMATION_SLOTS[playerTeam.formation];
          const filled: string[] = [];
          for (const pos of [Position.GK, Position.DEF, Position.MID, Position.FWD] as Position[]) {
            const n = slots[pos] ?? 0;
            filled.push(
              ...healthy
                .filter((p) => p.position === pos)
                .sort((a, b) => b.overall - a.overall)
                .slice(0, n)
                .map((p) => p.id),
            );
          }
          // If still short, add injured
          if (filled.length < 11) {
            const rest = playerTeam.players
              .filter((p) => p.injuryWeeks > 0 && !filled.includes(p.id))
              .sort((a, b) => b.overall - a.overall)
              .slice(0, 11 - filled.length);
            filled.push(...rest.map((p) => p.id));
          }
          // Update the team in-place
          const fixedTeams = teams.map((t) =>
            t.id === playerTeamId ? { ...t, starterIds: filled.slice(0, 11) } : t,
          );
          set({ teams: fixedTeams });
          const newCount = get().teams.find((t) => t.id === playerTeamId)!.starterIds.length;
          if (newCount !== 11) throw new Error(`首发阵容修复失败（${newCount}人），请使用一键补齐。`);
        }

        // ── Auto-replace injured starters for ALL teams before match ──
        let patchedTeams = get().teams;
        for (const t of patchedTeams) {
          const ids = [...t.starterIds];
          let replaced = false;
          for (let i = 0; i < ids.length; i++) {
            const p = t.players.find((pl) => pl.id === ids[i]);
            if (p && p.injuryWeeks > 0) {
              // Find healthy same-position replacement
              const replacement = t.players.find(
                (rp) => rp.id !== p.id && rp.position === p.position && rp.injuryWeeks === 0 && !ids.includes(rp.id),
              );
              if (replacement) {
                ids[i] = replacement.id;
                replaced = true;
                console.log(`[store] 🏥 Auto-replace: ${p.name} (injured ${p.injuryWeeks}w) → ${replacement.name} (${t.name})`);
              } else {
                // Fallback: any healthy player, but GK NEVER leaves goal, outfield NEVER goes to GK
                const isGKSlot = i === 0; // slot 0 is always GK
                const anyHealthy = t.players.find(
                  (rp) => rp.injuryWeeks === 0 && !ids.includes(rp.id) &&
                    (isGKSlot ? rp.position === Position.GK : rp.position !== Position.GK),
                );
                if (anyHealthy) {
                  ids[i] = anyHealthy.id;
                  replaced = true;
                  console.log(`[store] 🏥 Auto-replace (cross-pos): ${p.name} → ${anyHealthy.name} (${t.name})`);
                }
              }
            }
          }
          if (replaced) {
            patchedTeams = patchedTeams.map((mt) => (mt.id === t.id ? { ...mt, starterIds: ids } : mt));
          }
        }
        set({ teams: patchedTeams });

        const currentTeam = patchedTeams.find((t) => t.id === playerTeamId)!;
        if (currentTeam.starterIds.length !== 11) throw new Error(`首发人数异常：${currentTeam.starterIds.length}人。`);

        let results: MatchResult[] = [];
        let playerResult: MatchResult | undefined;

        // Compute euroRound ONCE — used by both simulation and post-processing
        const euroRound = md.type === "european"
          ? seasonCalendar.filter((m) => m.type === "european").findIndex((m) => m.id === md.id) + 1
          : 0;

        // Keep the tournament bracket in sync with the calendar BEFORE picking an opponent
        // (a top-8 qualifier has bye rounds 9-10; the bracket must still advance for round 11).
        const syncedTournament = md.type === "european"
          ? syncTournamentStage(state.playerTournament, euroRound)
          : state.playerTournament;

        if (md.type === "league") {
          const shuffled = shuffle(patchedTeams);
          for (let i = 0; i < shuffled.length; i += 2) {
            const home = shuffled[i];
            const away = shuffled[i + 1];
            if (!home || !away) continue;
            try { results.push(simulateMatch(home, away)); } catch (e) {
              results.push({ homeTeamId: home.id, awayTeamId: away.id, homeScore: 0, awayScore: 0, events: [], homeStarters: home.starterIds ?? [], awayStarters: away.starterIds ?? [], homeInjuries: [], awayInjuries: [] });
            }
          }
        } else {
          // European matchday: tournament-driven opponent selection
          const pick = syncedTournament
            ? pickEuropeanOpponent(playerTeamId, syncedTournament, virtualEuroTeams, euroRound)
            : null;

          if (!pick) {
            // No fixture this round (bye week, or eliminated): skip THIS matchday.
            // If it was the last calendar entry, the season ends now — with a
            // seasonResult so the end-of-season UI works. (Previously this branch
            // clamped currentMatchday to calendar.length and returned early, so the
            // season could NEVER end → the one-click sim froze.)
            const skipTo = currentMatchday + 1;
            const finished = skipTo > seasonCalendar.length;
            const skipResult = finished
              ? buildSeasonResult(standings, teams, playerTeamId, state.leagueRules ?? undefined)
              : null;
            console.log(`[store] ⏭️ European R${euroRound}: no fixture for the player — ${finished ? "season ends" : "skipping this matchday"}.`);
            set({
              playerTournament: syncedTournament,
              currentMatchday: skipTo,
              currentWeek: seasonCalendar[Math.min(skipTo, seasonCalendar.length) - 1]?.round ?? md.round,
              isSeasonEnded: finished,
              seasonResult: finished ? skipResult : state.seasonResult,
            });
            return undefined;
          } else {
            const opp = pick.opponent;
            console.log(`[store] ⭐ European R${euroRound} (${pick.stage}): ${currentTeam.name} vs ${opp.name}`);

            try {
              // 欧战上下文：curated 超级豪门获得额外晋级权重（修复豪门长期止步小组赛）
              results.push(simulateMatch(currentTeam, opp, { european: true }));
            } catch (e) {
              results.push({
                homeTeamId: currentTeam.id, awayTeamId: opp?.id ?? "unknown",
                homeScore: 0, awayScore: 0, events: [],
                homeStarters: currentTeam.starterIds ?? [],
                awayStarters: opp?.starterIds ?? [],
                homeInjuries: [], awayInjuries: [],
              });
            }
          }
        }

        // ── Background European fixtures (league phase rounds 1-8) ──
        // Simulate ALL other fixtures in the same round so the full table updates.
        if (md.type === "european" && syncedTournament && euroRound <= 8) {
          const lp = syncedTournament.leaguePhase;
          const sameRoundFixtures = lp.fixtures.filter(
            (f) => f.round === euroRound && !f.played && (f.homeId !== currentTeam.id && f.awayId !== currentTeam.id),
          );
          for (const f of sameRoundFixtures) {
            const home = virtualEuroTeams.find((t) => t.id === f.homeId);
            const away = virtualEuroTeams.find((t) => t.id === f.awayId);
            if (!home || !away) continue;
            f.played = true;
            try {
              const r = simulateMatch(home, away, { european: true });
              results.push(r);
              // Update league phase standings for this background match
              updateLeagueStandings(lp, f.homeId, f.awayId, r.homeScore, r.awayScore, euroRound);
            } catch (e) {
              results.push({ homeTeamId: f.homeId, awayTeamId: f.awayId, homeScore: 0, awayScore: 0, events: [], homeStarters: home.starterIds, awayStarters: away.starterIds, homeInjuries: [], awayInjuries: [] });
              updateLeagueStandings(lp, f.homeId, f.awayId, 0, 0);
            }
          }
          console.log(`[store] 📊 Simulated ${sameRoundFixtures.length} background European fixtures for round ${euroRound}`);
        }

        const found = results.find(r => r.homeTeamId === playerTeamId || r.awayTeamId === playerTeamId);
        if (!found) throw new Error("未找到玩家比赛结果。");
        playerResult = found;

        // ── True Season Stats Tracker：本场全部真实比赛数据实时累加 ──
        // 生涯球员由 simulateCareerPerformance 的真实 perf 合并（保证与生涯面板一致），此处跳过。
        {
          const teamLookup = new Map<string, TeamStatMeta>(
            [...patchedTeams, ...virtualEuroTeams].map((t) => [
              t.id, { name: t.name, league: t.league ?? "", players: t.players },
            ]),
          );
          const cpId = state.careerPlayer?.id;
          set({
            seasonPlayerStats: results.reduce(
              (acc, r) => accumulateMatchStats(acc, r, teamLookup, cpId),
              get().seasonPlayerStats,
            ),
          });
        }

        // Apply effects only to real teams
        let updatedTeams = [...teams];
        for (const r of results) {
          if (teams.some(t => t.id === r.homeTeamId)) {
            updatedTeams = applyStaminaEffects(updatedTeams, r.homeTeamId, r.homeStarters, r.homeInjuries);
            updatedTeams = applyGrowth(updatedTeams, r.homeTeamId, r.homeStarters);
          }
          if (teams.some(t => t.id === r.awayTeamId)) {
            updatedTeams = applyStaminaEffects(updatedTeams, r.awayTeamId, r.awayStarters, r.awayInjuries);
            updatedTeams = applyGrowth(updatedTeams, r.awayTeamId, r.awayStarters);
          }
        }

        // Update league standings (league matches only)
        let newStandings = [...standings];
        if (md.type === "league") {
          for (const r of results) {
            newStandings = newStandings.map(row => {
              if (row.teamId === r.homeTeamId) return updateRow(row, r.homeScore, r.awayScore);
              if (row.teamId === r.awayTeamId) return updateRow(row, r.awayScore, r.homeScore);
              return row;
            });
          }
          newStandings = sortStandings(newStandings);
        }

        // ── League season end: after last league matchday ──
        const leagueMatchdays = seasonCalendar.filter(m => m.type === "league");
        const lastLeagueMd = leagueMatchdays.length > 0 ? leagueMatchdays[leagueMatchdays.length - 1].id : 0;
        const isLeagueEnd = md.type === "league" && md.id === lastLeagueMd;
        let sResult: SeasonResult | null = null;
        let ended = false;
        let finalTeams = updatedTeams;

        let prizeApplied = false;

        if (isLeagueEnd) {
          const rules = state.leagueRules ?? getLeagueRules(state.currentLeagueName || "");
          sResult = buildSeasonResult(newStandings, teams, playerTeamId, rules);
          const euroQual = sResult!.europeanQualification;
          finalTeams = updatedTeams.map(t => t.id === playerTeamId ? { ...t, budget: t.budget + sResult!.prizeMoney } : t);
          prizeApplied = true;
          console.log(`[store] 🏆 League phase ended. Rank #${sResult.rank}/${rules.totalTeams}, Euro: ${euroQual}`);

          // If qualified, create tournament for European phase
          if (euroQual !== "NONE") {
            const vTeams = getVirtualTeams();
            const pt = finalTeams.find(t => t.id === playerTeamId)!;
            const updatedPT = { ...pt, europeanStatus: euroQual };
            finalTeams = finalTeams.map(t => t.id === playerTeamId ? updatedPT : t);
            const euroTeams = [updatedPT, ...vTeams.slice(0, 35)];
            const tourney = createTournament(euroQual as "UCL" | "UEL" | "UECL", euroTeams);
            set({ playerTournament: tourney });
            console.log(`[store] 🏆 European tournament created: ${euroQual}`);
          } else {
            // No European qualification → skip all European matchdays, season ends now
            ended = true;
            // Advance past all remaining European matchdays
            const euroCount = seasonCalendar.filter(m => m.type === "european").length;
            set({ currentMatchday: currentMatchday + euroCount });
            console.log(`[store] 🏆 No Euro qualification → season ended. Skipped ${euroCount} European matchdays.`);
          }
        }

        // Update European tournament after match.
        // Read FRESH state here: the league-end block above may have just created a
        // new tournament — reading the function-start snapshot would clobber it.
        let updatedTournament = get().playerTournament ?? null;
        // The sync at the top of this function advanced the bracket; keep that result.
        if (md.type === "european" && syncedTournament) {
          updatedTournament = syncedTournament;
        }
        if (md.type === "european" && updatedTournament && playerResult) {
          const playerIsHome = playerResult.homeTeamId === playerTeamId;

          // ── League phase (rounds 1-8) → update standings ──
          if (euroRound >= 1 && euroRound <= 8) {
            updateLeagueStandings(
              updatedTournament.leaguePhase,
              playerIsHome ? playerTeamId : (playerResult.awayTeamId),
              playerIsHome ? playerResult.awayTeamId : playerTeamId,
              playerIsHome ? playerResult.homeScore : playerResult.awayScore,
              playerIsHome ? playerResult.awayScore : playerResult.homeScore,
              euroRound,
            );

            // After round 8: advance to knockout phase
            if (euroRound === 8) {
              updatedTournament = advanceFromLeaguePhase(updatedTournament);
              console.log(`[store] 🏆 League phase complete. Top 8 → R16, 9-24 → playoffs.`);
            }
          }

          // ── Knockout playoffs (rounds 9-10) → update ties ──
          if (euroRound >= 9 && euroRound <= 10 && updatedTournament.knockoutPlayoffs) {
            const tie = updatedTournament.knockoutPlayoffs.ties.find(
              (t) => t.homeId === playerTeamId || t.awayId === playerTeamId,
            );
            if (tie) {
              const isLeg1 = euroRound === 9;
              // simulateMatch always puts the PLAYER at home in the match result —
              // so map scores by TIE membership (is the player the tie's home side?),
              // not by match venue. The old playerIsHome-based swap attributed the
              // player's goals to the opponent whenever the player was the tie's away side.
              const isTieHome = tie.homeId === playerTeamId;
              updateKnockoutTie(tie, isLeg1,
                isTieHome ? playerResult.homeScore : playerResult.awayScore,
                isTieHome ? playerResult.awayScore : playerResult.homeScore);

              if (euroRound === 10) {
                updatedTournament = advanceFromPlayoffs(updatedTournament);
              }
            }
          }

          // ── R16 (rounds 11-12) → update ties ──
          if (euroRound >= 11 && euroRound <= 12 && updatedTournament.roundOf16) {
            const tie = updatedTournament.roundOf16.ties.find(
              (t) => t.homeId === playerTeamId || t.awayId === playerTeamId,
            );
            if (tie) {
              const isTieHome = tie.homeId === playerTeamId;
              updateKnockoutTie(tie, euroRound === 11,
                isTieHome ? playerResult.homeScore : playerResult.awayScore,
                isTieHome ? playerResult.awayScore : playerResult.homeScore);
              if (euroRound === 12) updatedTournament = advanceKnockoutStage(updatedTournament, "r16");
            }
          }

          // ── QF (rounds 13-14) ──
          if (euroRound >= 13 && euroRound <= 14 && updatedTournament.quarterFinals) {
            const tie = updatedTournament.quarterFinals.ties.find(
              (t) => t.homeId === playerTeamId || t.awayId === playerTeamId,
            );
            if (tie) {
              const isTieHome = tie.homeId === playerTeamId;
              updateKnockoutTie(tie, euroRound === 13,
                isTieHome ? playerResult.homeScore : playerResult.awayScore,
                isTieHome ? playerResult.awayScore : playerResult.homeScore);
              if (euroRound === 14) updatedTournament = advanceKnockoutStage(updatedTournament, "qtr");
            }
          }

          // ── SF (rounds 15-16) ──
          if (euroRound >= 15 && euroRound <= 16 && updatedTournament.semiFinals) {
            const tie = updatedTournament.semiFinals.ties.find(
              (t) => t.homeId === playerTeamId || t.awayId === playerTeamId,
            );
            if (tie) {
              const isTieHome = tie.homeId === playerTeamId;
              updateKnockoutTie(tie, euroRound === 15,
                isTieHome ? playerResult.homeScore : playerResult.awayScore,
                isTieHome ? playerResult.awayScore : playerResult.homeScore);
              if (euroRound === 16) updatedTournament = advanceKnockoutStage(updatedTournament, "semi");
            }
          }

          // ── Final (round 17) ──
          if (euroRound === 17 && updatedTournament.final) {
            const tie = updatedTournament.final.ties.find(
              (t) => t.homeId === playerTeamId || t.awayId === playerTeamId,
            );
            if (tie) {
              // Single-match final — map by TIE membership (the player is always match home)
              const isTieHome = tie.homeId === playerTeamId;
              const winner = updateKnockoutTie(tie, true,
                isTieHome ? playerResult.homeScore : playerResult.awayScore,
                isTieHome ? playerResult.awayScore : playerResult.homeScore);
              if (winner) {
                updatedTournament = { ...updatedTournament, currentStage: "done" };
                console.log(`[store] 🏆 Tournament complete! Winner: ${winner}`);
              }
            }
          }
        }

        // ── Full season end (all matchdays done, including European) ──
        // Recompute from FRESH state — earlier branches may have jumped the matchday.
        const currentMdNow = get().currentMatchday;
        const nextMd = currentMdNow + 1;
        if (nextMd > seasonCalendar.length) {
          ended = true;
          if (!sResult) {
            sResult = buildSeasonResult(
              newStandings.length ? newStandings : standings,
              teams, playerTeamId, state.leagueRules ?? undefined,
            );
          }
        }

        // Prize money for season-ending paths that bypassed the isLeagueEnd block
        // (European final, …). The end-of-season UI always needs a seasonResult.
        if (ended && sResult && !prizeApplied) {
          finalTeams = finalTeams.map((t) =>
            t.id === playerTeamId ? { ...t, budget: t.budget + sResult!.prizeMoney } : t,
          );
          prizeApplied = true;
        }

        set({
          teams: finalTeams,
          standings: newStandings,
          currentWeek: md.round,
          currentMatchday: nextMd > seasonCalendar.length ? seasonCalendar.length : nextMd,
          isSeasonEnded: ended,
          seasonResult: ended ? sResult : state.seasonResult,
          playerTournament: updatedTournament,
        });

        return playerResult;
      },

      startNewSeason: () => {
        // Generate awards BEFORE state reset (reads current season data)
        get().generateSeasonAwards();

        // ── 赛季间俱乐部移动：pendingMove（跨联赛转会/租借生效）与租借回归 ──
        const s0 = get();
        const cp0 = s0.careerPlayer;
        let rebuilt: BuiltWorld | null = null;
        let baseCP: CareerPlayer | null = cp0;
        let returningFromLoan = false; // 同联赛租借回归（无世界重建，set 内做 roster move）
        let appliedTransferFee: number | null = null; // 转会后身价 = 转会费（不被赛季初重算覆盖）

        if (cp0) {
          if (cp0.pendingMove) {
            try {
              rebuilt = buildWorldForMove(cp0.pendingMove.targetClub, cp0);
              if (cp0.pendingMove.kind === "loan") {
                baseCP = {
                  ...cp0,
                  teamId: rebuilt.playerTeamId,
                  pendingMove: null,
                  loanParent: { kind: "db", teamDbId: cp0.pendingMove.parentClub.dbId, teamName: cp0.pendingMove.parentClub.name, leagueName: cp0.pendingMove.parentClub.leagueName },
                };
                console.log(`[store] 🤝 租借开始：${cp0.name} → ${cp0.pendingMove.targetClub.name}（${cp0.pendingMove.targetClub.leagueName}）`);
              } else {
                baseCP = { ...cp0, teamId: rebuilt.playerTeamId, pendingMove: null, loanParent: null, value: cp0.pendingMove.fee };
                appliedTransferFee = cp0.pendingMove.fee;
                console.log(`[store] 🔄 转会生效：${cp0.name} → ${cp0.pendingMove.targetClub.name}（${formatEuroM(cp0.pendingMove.fee)}）`);
              }
            } catch (e) {
              console.error("[store] ❌ pendingMove world rebuild failed — staying at current club", e);
              baseCP = { ...cp0, pendingMove: null }; // 兜底：不换队，仅清除待生效
            }
          } else if (cp0.loanParent) {
            if (cp0.loanParent.kind === "db") {
              try {
                rebuilt = buildWorldForMove(
                  { dbId: cp0.loanParent.teamDbId, name: cp0.loanParent.teamName, leagueName: cp0.loanParent.leagueName },
                  cp0,
                );
                baseCP = { ...cp0, teamId: rebuilt.playerTeamId, loanParent: null };
                console.log(`[store] 🔁 租借结束回归：${cp0.name} → ${cp0.loanParent.teamName}（${cp0.loanParent.leagueName}）`);
              } catch (e) {
                console.error("[store] ❌ loan return world rebuild failed", e);
                baseCP = { ...cp0, loanParent: null };
              }
            } else {
              returningFromLoan = true; // 同联赛租借：set 内 roster move 回母队
            }
          }
        }

        set((s) => {
          const worldTeams = rebuilt?.teams ?? s.teams;
          const worldBackground = rebuilt?.otherLeaguesTeams ?? s.otherLeaguesTeams;
          const worldPlayerTeamId = rebuilt?.playerTeamId ?? s.playerTeamId;
          const rules = rebuilt?.rules ?? s.leagueRules ?? getLeagueRules(s.currentLeagueName);
          const newCalendar = rebuilt?.calendar ?? generateCalendar(rules.totalRounds);
          const vTeams = getVirtualTeams();

          // European qualification from league rules config
          // （世界重建时欧洲资格已由 buildWorldForMove 设定：玩家队=欧战资格，其余 NONE）
          const finalStandings = sortStandings(s.standings);
          const euroSlots = buildEuroSlots(rules);

          // 阵容进化管线：老化 → 老将自主退役 → 首发重算 → U21 超龄出队 + 青训造血
          const evolveSquad = (t: Team): Team => {
            const aged = ageSquadPlayers(t.players);
            // ── 老将自主退役（35+ 按年龄/状态动态概率；生涯球员由赛后专属判定处理）──
            // 保底：退役最多退到剩 11 人（先退最弱的老将），球队绝不被拆到无法比赛
            const retireCandidates = aged
              .filter((p) => p.id !== cp0?.id && p.age >= 35 && Math.random() < retirementChance(p.age, p.overall))
              .sort((a, b) => a.overall - b.overall);
            const maxRetire = Math.max(0, aged.length - 11);
            const toRetire = new Set(retireCandidates.slice(0, maxRetire).map((p) => p.id));
            const survivors = aged.filter((p) => !toRetire.has(p.id));
            if (toRetire.size > 0) {
              const retiredNames = [...toRetire].map((id) => aged.find((p) => p.id === id)?.name ?? id);
              console.log(`[store] 👋 ${t.name} 老将退役：${retiredNames.join("、")}`);
            }
            // U21 超龄自动出队（22 岁仍未提拔者离开梯队）
            const agedU21 = ageSquadPlayers(t.u21Players).filter((p) => p.age <= 21);
            const agedU18 = ageSquadPlayers(t.u18Players);
            // ── 青训造血：俱乐部实力越强，新秀潜力上限越高 ──
            const clubAvg = survivors.length > 0
              ? survivors.reduce((s, p) => s + p.overall, 0) / survivors.length
              : 70;
            const clubStrength = clubAvg + teamPrestige(t.name);
            const newgens = generateNewgens(clubStrength);
            // ── AI 阵型多样化：每赛季随机阵型/战术（经理模式的玩家队除外，由玩家自主设定）──
            const isPlayerManaged = t.id === worldPlayerTeamId && s.gameMode === "manager";
            const nextFormation = isPlayerManaged ? t.formation : pickRandom(ALL_FORMATIONS);
            const nextTactic = isPlayerManaged ? t.tactic : pickRandom(ALL_TACTICS);
            return {
              ...t,
              formation: nextFormation,
              tactic: nextTactic,
              starterIds: autoStarterIds(survivors, nextFormation),
              players: survivors,
              u21Players: [...agedU21, ...newgens],
              u18Players: agedU18,
            };
          };

          let updatedTeams = worldTeams.map((t) => {
            const rankIdx = finalStandings.findIndex((st) => st.teamId === t.id);
            const euroStatus = rebuilt
              ? t.europeanStatus
              : ((rankIdx >= 0 ? euroSlots[rankIdx] ?? "NONE" : "NONE") as EuropeanStatus);
            return evolveSquad({ ...t, europeanStatus: euroStatus as EuropeanStatus });
          });

          // Background leagues age too — previously they were frozen in time.
          const updatedBackground = worldBackground.map((t) => evolveSquad(t));

          // ── 同联赛租借回归：roster move 回母队 + 锻炼成长奖励 ──
          let nextPlayerTeamId = worldPlayerTeamId;
          if (returningFromLoan && baseCP && cp0?.loanParent?.kind === "game" && !rebuilt) {
            updatedTeams = moveCareerPlayerBetweenTeams(updatedTeams, baseCP, worldPlayerTeamId, cp0.loanParent.teamId);
            nextPlayerTeamId = cp0.loanParent.teamId;
            baseCP.teamId = cp0.loanParent.teamId;
            baseCP.loanParent = null;
            if (baseCP.avgRating >= 7.0) baseCP.overall = Math.min(99, baseCP.overall + 2);
            else if (baseCP.avgRating >= 6.5) baseCP.overall = Math.min(99, baseCP.overall + 1);
            console.log(`[store] 🔁 租借结束回归：${baseCP.name} 回归母队（锻炼成长奖励已应用）`);
          }

          // Create player's European tournament if qualified
          const playerTeam = updatedTeams.find((t) => t.id === nextPlayerTeamId)!;
          let playerTourney: EuropeanTournament | null = null;
          if (playerTeam.europeanStatus !== "NONE") {
            const allEuroTeams = [playerTeam, ...vTeams.slice(0, 35)];
            playerTourney = createTournament(playerTeam.europeanStatus, allEuroTeams);
          }

          // Age + grow/decline the career player too
          let updatedCP = baseCP
            ? { ...baseCP, age: baseCP.age + 1, seasonAppearances: 0, eventsThisSeason: [] }
            : null;
          if (updatedCP) {
            const cp = updatedCP;
            if (cp.age <= 26 && cp.overall < cp.potential) {
              const gap = cp.potential - cp.overall;
              const boost = gap >= 10 ? randInt(3, 6) : gap >= 5 ? randInt(2, 4) : randInt(1, 2);
              cp.attack = Math.min(99, cp.attack + randInt(0, boost));
              cp.playmaking = Math.min(99, cp.playmaking + randInt(0, boost));
              cp.defense = Math.min(99, cp.defense + randInt(0, boost));
            } else if (cp.age >= 32) {
              const decline = cp.age >= 35 ? randInt(2, 5) : randInt(1, 3);
              cp.attack = Math.max(1, cp.attack - randInt(0, decline));
              cp.defense = Math.max(1, cp.defense - randInt(0, decline));
              cp.potential = Math.max(cp.overall, cp.potential - randInt(0, 2));
            }
            cp.overall = calculateOVR(cp.attack, cp.playmaking, cp.defense, cp.position);
            cp.value = appliedTransferFee ?? marketValue(cp.overall, cp.potential, cp.age);
            cp.stamina = 100;
          }

          console.log(`[store] 🌅 Season ${s.season + 1} begins! Player euro: ${playerTeam.europeanStatus}`);

          return {
            ...(updatedCP ? { careerPlayer: updatedCP } : {}),
            season: s.season + 1,
            currentWeek: 1,
            currentMatchday: 1,
            seasonCalendar: newCalendar,
            virtualEuroTeams: vTeams,
            playerTournament: playerTourney,
            playerTeamId: nextPlayerTeamId, // 换队（转会/租借/回归）后同步
            isSeasonEnded: false,
            seasonResult: null,
            standings: buildStandings(updatedTeams),
            teams: updatedTeams,
            otherLeaguesTeams: updatedBackground,
            ...(rebuilt ? {
              currentLeagueName: rebuilt.leagueName,
              leagueRules: rules,
              maxMatchweeks: rules.totalRounds,
              transferMarketPlayers: normalizeMarketValues([...initialMarketPlayers, ...dedupeFreeAgents(FREE_AGENTS, [...worldTeams, ...worldBackground])]),
            } : {}),
            careerEvent: null,
            // 新赛季日志从头开始（避免残留上赛季记录混入复盘/汇报）
            seasonMatchLog: [],
            simulationSegmentStart: 0,
            // 真实数据追踪器每赛季清零（奖项已在 generateSeasonAwards 中消费）
            seasonPlayerStats: {},
          };
        });

        // ── 转会窗口：AI 教练自动评估阵容短板并引援（生涯模式）──
        get().aiReinforceSquad();

        // ── 生涯球员老将自主退役判定（35+ 动态概率，赛季结束结算阶段）──
        const post = get();
        if (post.careerPlayer && post.careerPlayer.age >= 35
          && !post.isSimulating && post.gameStatus === "PLAYING"
          && Math.random() < retirementChance(post.careerPlayer.age, post.careerPlayer.overall)) {
          console.log(`[store] 👋 ${post.careerPlayer.name}（${post.careerPlayer.age}岁）正式挂靴 — 进入生涯荣誉结算`);
          post.retirePlayer();
        }
      },

      // ── Career Mode Actions ──────────────────────────────

      setGameMode: (mode) => set({ gameMode: mode }),

      returnToMainMenu: () => {
        // Deep clear — remove persisted save and reset ALL state
        try { localStorage.removeItem("simple-fm-game"); } catch { /* ok */ }
        set({
          gameStatus: "SETUP", gameMode: "manager",
          careerPlayer: null, leagueRules: null, seasonAwards: null,
          careerEvent: null, seasonMatchLog: [], simulationSegmentStart: 0,
          seasonPlayerStats: {}, pendingElimination: false, careerLegacy: null,
          simError: null,
          isSimulating: false, simulationPaused: false,
          teams: [], otherLeaguesTeams: [], playerTeamId: "",
          currentWeek: 1, currentMatchday: 1, season: 1,
          maxMatchweeks: 38, isSeasonEnded: false, seasonResult: null,
          seasonCalendar: [], standings: [], virtualEuroTeams: [],
          playerTournament: null, transferMarketPlayers: [],
          currentLeagueName: "",
        });
        console.log("[store] 🏠 Deep reset — returned to main menu");
      },

      createCareerPlayer: (name, nationality, position, age, attack, playmaking, defense, potential) => {
        const overall = calculateOVR(attack, playmaking, defense, position);
        const stamina = clamp(overall + randInt(-5, 5), 50, 95);

        const cp: CareerPlayer = {
          id: generateUUID(),
          name, age, nationality, position,
          overall, potential, stamina, attack, playmaking, defense,
          value: marketValue(overall, potential, age),
          teamId: null,
          appearances: 0, seasonAppearances: 0, goals: 0, assists: 0,
          avgRating: 0, totalRatings: 0, injuryWeeks: 0,
          recentRatings: [],
          honours: [],
          careerTrophies: [],
          careerSeasons: [],
          loanParent: null,
          pendingMove: null,
          eventsThisSeason: [],
        };
        set({ careerPlayer: cp });
        console.log(`[store] 🧑 Player: ${name} (${position}, OVR ${overall} = ATT${attack}+PLM${playmaking}+DEF${defense}, POT ${potential})`);
      },

      joinCareerClub: (teamId) => {
        const s = get();
        if (!s.careerPlayer) return;

        // ── Step 1: search existing game state (already-initialized world) ──
        const allExisting = [...s.teams, ...(s.otherLeaguesTeams ?? [])];
        let team = allExisting.find((t) => t.id === teamId);

        // ── Step 2: not found → look up from the REAL database & bootstrap the world ──
        if (!team) {
          const allReal = getAllTeams();
          // Robust matching: 精确 ID → 精确名字 → 长度受限的模糊子串。
          // 子串匹配要求被包含字符串 ≥ 4 字符——否则 2 字母队名 "OL" 会成为
          // "vfl_wolfsburg" 的子串，选沃尔夫斯堡却加入里昂（曾真实发生）。
          const fuzzyMatch = (a: string, b: string) => {
            const la = a.toLowerCase().trim();
            const lb = b.toLowerCase().trim();
            return (la.includes(lb) && lb.length >= 4) || (lb.includes(la) && la.length >= 4);
          };
          team = (allReal.find((rt) => rt.id === teamId)
            ?? allReal.find((rt) => rt.name.toLowerCase().trim() === teamId.toLowerCase().trim())
            ?? allReal.find((rt) => fuzzyMatch(rt.name, teamId))) as Team | undefined;

          if (team) {
            console.log(`[store] 🔍 Bootstrapping world from real DB: "${team.name}" (id=${team.id})`);
            // Bootstrap the game world — generate the player's league
            const { teams: generated, otherLeaguesTeams: background } = generateWorld(
              team.id,
              team.name,
              (team as { budget?: number }).budget ?? 5_000_000,
            );

            // Merge career player into the selected team
            const cp = s.careerPlayer;
            const player: Player = {
              id: cp.id, name: cp.name, age: cp.age, position: cp.position,
              attack: cp.attack, defense: cp.defense, stamina: cp.stamina,
              overall: cp.overall, potential: cp.potential, value: cp.value,
              injuryWeeks: cp.injuryWeeks,
            };

            // generateWorld assigns new UUIDs → find by NAME, not the real DB ID
            const targetName = team!.name;
            const leagueName2 = getAllTeams().find((t) => t.id === teamId)?.league ?? "";
            const rules2 = getLeagueRules(leagueName2);
            // Calendar must follow THIS league's rules (previously hard-coded 38 rounds)
            const calendar = generateCalendar(rules2.totalRounds);
            const vTeams = getVirtualTeams();
            const euroSlots2 = buildEuroSlots(rules2);
            const cpEuroStatus: EuropeanStatus = euroSlots2.some(s => s !== "NONE")
              ? (euroSlots2[0] as EuropeanStatus) ?? "NONE" : "NONE";

            const finalTeams = generated.map((t) =>
              t.name === targetName
                ? { ...t, players: [...t.players, player], europeanStatus: cpEuroStatus }
                : { ...t, europeanStatus: "NONE" as EuropeanStatus },
            );
            const finalPlayerTeam = finalTeams.find((t) => t.name === targetName);
            if (!finalPlayerTeam) {
              console.error(`[store] ❌ After world gen, still couldn't find team "${targetName}". Aborting.`);
              alert(`抱歉，生成游戏世界时未能找到球队 "${targetName}"。请重试。`);
              return;
            }

            set({
              gameStatus: "PLAYING",
              gameMode: "career",
              currentLeagueName: getAllTeams().find((t) => t.id === team!.id)?.league ?? "",
              leagueRules: rules2,
              teams: finalTeams,
              otherLeaguesTeams: background,
              playerTeamId: finalPlayerTeam.id,
              careerPlayer: { ...cp, teamId: finalPlayerTeam.id },
              season: 1,
              currentWeek: 1,
              currentMatchday: 1,
              seasonCalendar: calendar,
              virtualEuroTeams: vTeams,
              playerTournament: cpEuroStatus !== "NONE"
                ? createTournament(cpEuroStatus as "UCL" | "UEL" | "UECL", [finalPlayerTeam, ...vTeams.slice(0, 35)])
                : null,
              maxMatchweeks: rules2.totalRounds,
              isSeasonEnded: false,
              seasonResult: null,
              standings: buildStandings(finalTeams),
              transferMarketPlayers: normalizeMarketValues([
                ...initialMarketPlayers,
                ...dedupeFreeAgents(FREE_AGENTS, [...finalTeams, ...background]),
              ]),
            });
            console.log(`[store] ⚽ Career world bootstrapped. ${cp.name} joined ${finalPlayerTeam.name}`);
            return;
          }
        }

        // ── Step 3: team found in EXISTING game state → just add the player ──
        if (team) {
          const cp = s.careerPlayer;
          const player: Player = {
            id: cp.id, name: cp.name, age: cp.age, position: cp.position,
            attack: cp.attack, defense: cp.defense, stamina: cp.stamina,
            overall: cp.overall, potential: cp.potential, value: cp.value,
            injuryWeeks: cp.injuryWeeks,
          };
          const updatedTeams = s.teams.map((t) =>
            t.id === team!.id ? { ...t, players: [...t.players, player] } : t,
          );
          set({
            teams: updatedTeams,
            playerTeamId: team!.id,
            careerPlayer: { ...cp, teamId: team!.id },
            gameStatus: "PLAYING",
            gameMode: "career",
          });
          console.log(`[store] ⚽ ${cp.name} joined existing team ${team!.name}`);
          return;
        }

        // ── Step 4: truly not found → log + fallback ──
        console.error(`[store] ❌ joinCareerClub: teamId="${teamId}" not found in game state or real DB.`);
        const allRealFallback = getAllTeams();
        console.log(`[store] 💡 Available IDs sample: ${allRealFallback.slice(0, 5).map(t => `${t.name}(${t.id})`).join(", ")}...`);
        alert(`抱歉，未能在数据库中找到球队 "${teamId}"。请重新选择。`);
      },

      // ── AI Coach: auto-generate starting XI ──────────────
      generateAILineup: () => {
        const s = get();
        const pt = s.teams.find((t) => t.id === s.playerTeamId);
        const cp = s.careerPlayer;
        if (!pt) return { status: "out" as const, starterOVR: 0 };

        const allPlayers = [...pt.players];
        const healthy = allPlayers.filter(p => p.injuryWeeks === 0);

        // ── Strict roster split ──
        const GKs = healthy.filter(p => p.position === Position.GK).sort((a,b) => b.overall - a.overall);
        const outfields = healthy.filter(p => p.position !== Position.GK).sort((a,b) => b.overall - a.overall);

        // ── Mandatory: exactly 1 GK + 位置均衡骨架 ──
        if (GKs.length === 0) {
          console.error("[store] ❌ No healthy GK available!");
          return { status: "out", starterOVR: 0 };
        }
        const gk = GKs[0];

        // ── Slot mapping: DEF→DEF slots, MID→MID slots, FWD→FWD slots ──
        const formation = pt.formation;
        const slots = FORMATION_SLOTS[formation];
        const result = new Array<string>(11);

        // ── 均衡骨架优先：按阵型位置数量各取最佳，再以最佳外场补足 ──
        // （旧的 "10 best outfield" 会让 6 个前锋把中场名额全部挤掉）
        const nDef = slots[Position.DEF] ?? 4;
        const nMid = slots[Position.MID] ?? 3;
        const nFwd = slots[Position.FWD] ?? 3;
        const skeleton: Player[] = [
          ...outfields.filter(p => p.position === Position.DEF).slice(0, nDef),
          ...outfields.filter(p => p.position === Position.MID).slice(0, nMid),
          ...outfields.filter(p => p.position === Position.FWD).slice(0, nFwd),
        ];
        const skeletonIds = new Set(skeleton.map(p => p.id));
        const top10 = [
          ...skeleton,
          ...outfields.filter(p => !skeletonIds.has(p.id)).slice(0, Math.max(0, 10 - skeleton.length)),
        ];

        // If not enough healthy outfields, fill from injured (still no GK)
        if (top10.length < 10) {
          const injuredOut = allPlayers.filter(p => p.position !== Position.GK && p.injuryWeeks > 0)
            .sort((a,b) => b.overall - a.overall).slice(0, 10 - top10.length);
          top10.push(...injuredOut);
        }
        // Absolute last resort: if still < 10, pad with the best available player —
        // prefer outfield players so GK isolation survives degenerate squads.
        while (top10.length < 10) {
          const pad = top10[0] ?? allPlayers.find((p) => p.position !== Position.GK) ?? allPlayers[0];
          top10.push(pad);
        }
        result[0] = gk.id; // GK always slot 0

        // Build position pools from top10
        const defs = top10.filter(p => p.position === Position.DEF);
        const mids = top10.filter(p => p.position === Position.MID);
        const fwds = top10.filter(p => p.position === Position.FWD);
        const others = top10.filter(p => p.position !== Position.DEF && p.position !== Position.MID && p.position !== Position.FWD);

        const slotStart: Record<string, [number, number]> = {
          GK: [0, 1], DEF: [1, 1 + (slots[Position.DEF]??4)], MID: [1 + (slots[Position.DEF]??4), 1 + (slots[Position.DEF]??4) + (slots[Position.MID]??3)],
          FWD: [1 + (slots[Position.DEF]??4) + (slots[Position.MID]??3), 11],
        };

        // ── 位置完整性硬约束：严禁大面积客串 ──
        // 每个位置的补位链按兼容度排序：DEF → MID → FWD（前锋最后客串后防/中场）；
        // 仅在真正人手短缺时才允许个别客串（GK 永不离岗）。
        // 客串硬限制：全场"非本职位置客串"球员总数 ≤ 1 人（严禁 6 前锋堆满中场/后防）
        let crossUsed = 0;
        const fillSlot = (primary: Player[], alternatives: Player[][], count: number, startIdx: number) => {
          let cursor = startIdx;
          for (let j = 0; j < count; j++) {
            if (primary.length > 0) {
              result[cursor++] = primary.shift()!.id;
              continue;
            }
            // 同位置无人 → 允许 1 人客串（兼容链按序）
            if (crossUsed < 1) {
              let placed = false;
              for (const list of alternatives) {
                if (list.length > 0) {
                  result[cursor++] = list.shift()!.id;
                  crossUsed++;
                  placed = true;
                  break;
                }
              }
              if (placed) continue;
            }
            // 客串额度耗尽 → 置空，由兜底循环补位（极端残缺阵容）
            result[cursor++] = "";
          }
          return cursor;
        };
        let cursor = slotStart.DEF[0];
        cursor = fillSlot(defs, [mids, fwds, others], (slots[Position.DEF] ?? 4), cursor);
        cursor = fillSlot(mids, [defs, fwds, others], (slots[Position.MID] ?? 3), cursor);
        cursor = fillSlot(fwds, [mids, defs, others], (slots[Position.FWD] ?? 2), cursor);
        // 兜底：置空槽位按最优兼容补位（客串额度已尽仍保证 11 人上场 — 仅极端阵容触发）
        for (let i = 0; i < result.length; i++) {
          if (result[i] !== "") continue;
          if (mids.length > 0) result[i] = mids.shift()!.id;
          else if (defs.length > 0) result[i] = defs.shift()!.id;
          else if (fwds.length > 0) result[i] = fwds.shift()!.id;
          else if (others.length > 0) result[i] = others.shift()!.id;
          else result[i] = gk.id;
        }

        // ── Final validation: exactly 1 GK ──
        const final = result.filter(Boolean).slice(0, 11);
        const gkCount = final.filter(id => allPlayers.find(p=>p.id===id)?.position===Position.GK).length;
        if (gkCount !== 1) {
          console.error(`[store] ❌ CRITICAL: ${gkCount} GKs in lineup! Forcing correction.`);
          // Force: first slot = best GK, remove any other GKs
          const bestGk = GKs[0] ?? allPlayers.find(p=>p.position===Position.GK);
          if (bestGk) {
            final[0] = bestGk.id;
            for (let i = 1; i < final.length; i++) {
              const p = allPlayers.find(pl=>pl.id===final[i]);
              if (p?.position === Position.GK) {
                const sub = outfields.find(o => !final.includes(o.id)) ?? allPlayers.find(pp => !final.includes(pp.id));
                if (sub) final[i] = sub.id;
              }
            }
          }
        }

        // Career player status
        let cpStatus: "starter"|"bench"|"out" = "out";
        let starterOVR = 0;
        if (cp) {
          cpStatus = final.includes(cp.id) ? "starter" : "bench";
          const samePos = allPlayers.filter(p=>p.position===cp.position && p.injuryWeeks===0).sort((a,b)=>b.overall-a.overall);
          starterOVR = samePos.length > 0 ? samePos[Math.min(samePos.length-1, (slots[cp.position]??1)-1)]?.overall ?? 0 : 0;
        }

        set({ teams: s.teams.map(t => t.id === pt.id ? { ...t, starterIds: final } : t) });
        const gkName = allPlayers.find(p=>p.id===final[0])?.name??"?";
        console.log(`[store] 🤖 AI: GK=${gkName} | ${defs.length}DEF ${mids.length}MID ${fwds.length}FWD | ${cp?.name??"?"} → ${cpStatus}`);
        return { status: cpStatus, starterOVR };
      },

      simulateCareerPerformance: (result, playerTeamId) => {
        const s = get();
        const cp = s.careerPlayer;
        if (!cp) return { rating: 0, goals: 0, assists: 0, summary: "", growthGains: [] };

        // ── Participation check: starter OR sub-on ──
        const allStarters = new Set([
          ...(result.homeStarters ?? []),
          ...(result.awayStarters ?? []),
        ]);
        const started = allStarters.has(cp.id);

        // Sub-on dice roll (if not a starter)
        let subbedOn = false;
        if (!started) {
          const subChance = 0.25 + ((cp.overall - 60) / 80); // 25-50% based on OVR
          subbedOn = Math.random() < subChance;
          console.log(`[store] 🪑 ${cp.name} on bench — sub-on chance ${(subChance*100).toFixed(0)}% → ${subbedOn ? "✅ YES" : "❌ NO"}`);
        }

        if (!started && !subbedOn) {
          console.log(`[store] ⏭️ ${cp.name} did not play this match — skipping career stats.`);
          return { rating: 0, goals: 0, assists: 0, summary: "", growthGains: [] };
        }

        // Slight rating bonus for starter vs sub
        const starterBonus = started ? 0.3 : 0;

        const playerIsHome = result.homeTeamId === playerTeamId;
        const teamScore = playerIsHome ? result.homeScore : result.awayScore;
        const oppScore = playerIsHome ? result.awayScore : result.homeScore;

        // ── Scarcity-based rating engine ──
        const ovrFactor = (cp.overall - 60) / 40;
        const won = teamScore > oppScore;
        const drew = teamScore === oppScore;

        // Goals: based on position, OVR, RNG — clamped to teamScore
        let goals = 0;
        if (teamScore > 0) {
          const goalChance = cp.position === "FWD" ? 0.55 : cp.position === "MID" ? 0.25 : cp.position === "DEF" ? 0.08 : 0.01;
          if (Math.random() < goalChance * (1 + ovrFactor)) goals = 1;
          if (goals > 0 && teamScore >= 2 && Math.random() < 0.12 * ovrFactor) goals = 2;
          if (goals >= 2 && teamScore >= 3 && Math.random() < 0.05 * ovrFactor) goals = 3;
          goals = Math.min(goals, teamScore);
        }

        // Assists
        let assists = 0;
        const otherScorers = teamScore - goals;
        if (otherScorers > 0) {
          const assistChance = cp.position === "MID" ? 0.40 : cp.position === "FWD" ? 0.25 : cp.position === "DEF" ? 0.12 : 0.02;
          if (Math.random() < assistChance * (1 + ovrFactor)) { assists = 1; }
          if (assists > 0 && otherScorers >= 2 && Math.random() < 0.08 * ovrFactor) assists = 2;
          assists = Math.min(assists, otherScorers);
        }

        const hasGorA = goals > 0 || assists > 0;

        // Rating calculation — scarcity-focused
        let rating: number;
        if (hasGorA) {
          // Base with attacking contribution
          let base = 6.5;
          base += goals * 0.6;   // each goal +0.6
          base += assists * 0.4; // each assist +0.4
          if (goals >= 2) base += 0.3; // brace bonus
          if (goals >= 3) base += 0.5; // hat-trick bonus
          if (won) base += 0.5;
          else if (drew) base += 0.1;
          else base -= 0.2;
          rating = clampFloat(base + (Math.random() - 0.3) * 2.0, 5.5, 10.0);
        } else {
          // No G/A: rating is RUTHLESSLY capped
          let base = 6.0;
          if (won) base += 0.3;
          else if (drew) base += 0.1;
          else base -= 0.3; // lost without contributing → penalty
          rating = clampFloat(base + (Math.random() - 0.3) * 1.2, 5.5, 6.8);
        }
        rating = clampFloat(rating + starterBonus, 5.0, 10.0);
        // Cap rating if goals but team lost
        if (!won && !drew && goals < 2) rating = clampFloat(rating, 5.0, 7.5);

        // ── Growth with injury destruction ──
        const growthGains: string[] = [];
        const recent = [...(cp.recentRatings ?? []), rating].slice(-5);
        const avgRecent = recent.length > 0 ? recent.reduce((a,b)=>a+b,0)/recent.length : 0;

        if (avgRecent > 7.3 && cp.overall < cp.potential) {
          let ageMul = 1.0;
          if (cp.age <= 23) ageMul = 2.0;        // youth: double growth
          else if (cp.age <= 29) ageMul = 1.0;    // prime: normal
          else if (cp.age <= 33) ageMul = 0.3;    // veteran: slow
          else ageMul = 0.0;                       // 34+: no growth

          // Slowdown approaching potential
          const gapToPot = cp.potential - cp.overall;
          const potFactor = Math.max(0.1, gapToPot / 20); // diminishing returns

          if (Math.random() < 0.25 * ageMul * potFactor) {
            const inc = 1;
            const r = Math.random();
            if (cp.position === "FWD") {
              if (r < 0.5) { cp.attack = Math.min(99, cp.attack + inc); growthGains.push(`+1 进攻`); }
              else if (r < 0.8) { cp.playmaking = Math.min(99, cp.playmaking + inc); growthGains.push(`+1 组织`); }
              else { cp.defense = Math.min(99, cp.defense + inc); growthGains.push(`+1 防守`); }
            } else if (cp.position === "MID") {
              if (r < 0.5) { cp.playmaking = Math.min(99, cp.playmaking + inc); growthGains.push(`+1 组织`); }
              else if (r < 0.8) { cp.attack = Math.min(99, cp.attack + inc); growthGains.push(`+1 进攻`); }
              else { cp.defense = Math.min(99, cp.defense + inc); growthGains.push(`+1 防守`); }
            } else {
              if (r < 0.5) { cp.defense = Math.min(99, cp.defense + inc); growthGains.push(`+1 防守`); }
              else if (r < 0.8) { cp.playmaking = Math.min(99, cp.playmaking + inc); growthGains.push(`+1 组织`); }
              else { cp.attack = Math.min(99, cp.attack + inc); growthGains.push(`+1 进攻`); }
            }
            if (ageMul >= 1 && Math.random() < 0.15) { cp.stamina = Math.min(99, cp.stamina + 1); growthGains.push(`+1 体能`); }
            cp.overall = calculateOVR(cp.attack, cp.playmaking, cp.defense, cp.position);
          }
        }

        // Age decline: over 30 and poor form → irreversible decline
        if (cp.age >= 30 && avgRecent < 6.8 && Math.random() < (cp.age >= 34 ? 0.20 : 0.06)) {
          const dec = 1;
          if (Math.random() < 0.5) { cp.attack = Math.max(1, cp.attack - dec); growthGains.push(`⚠️ 进攻 -1 (年龄衰退)`); }
          else { cp.stamina = Math.max(1, cp.stamina - dec); growthGains.push(`⚠️ 体能 -1 (年龄衰退)`); }
          cp.overall = calculateOVR(cp.attack, cp.playmaking, cp.defense, cp.position);
        }

        // ── Injury destroys potential ──
        if ((cp.injuryWeeks ?? 0) > 0) {
          const wasMajor = (cp.injuryWeeks ?? 0) >= 8;
          const wasMinor = (cp.injuryWeeks ?? 0) > 0 && !wasMajor;
          let potDrop = 0;
          if (wasMajor) {
            potDrop = randInt(2, 3);
            if (cp.age > 28 && Math.random() < 0.5) {
              // Veteran major injury: permanent attribute loss
              cp.attack = Math.max(1, cp.attack - randInt(1, 2));
              cp.playmaking = Math.max(1, cp.playmaking - randInt(1, 2));
              cp.stamina = Math.max(1, cp.stamina - randInt(2, 4));
              growthGains.push(`💔 重伤摧毁了身体！攻/组/体永久下降`);
            }
          } else if (wasMinor && Math.random() < 0.15) {
            potDrop = 1;
          }
          if (potDrop > 0) {
            cp.potential = Math.max(cp.overall, cp.potential - potDrop);
            growthGains.push(`💔 伤病使潜力上限暴跌至 ${cp.potential}`);
          }
        }

        // ── Rating-based evaluation text ──
        const evalText =
          rating >= 9.5 ? "完美发挥，超神表现！👑"
          : rating >= 8.5 ? "统治级表现，绝对核心！🌟"
          : rating >= 7.3 ? "表现出色，是球队的可靠一环。🔥"
          : rating >= 6.6 ? "中规中矩，完成了本职工作。"
          : rating >= 5.5 ? "表现低迷，状态糟糕。😞"
          : "灾难级发挥，完全迷失。💀";

        const parts: string[] = [];
        if (goals > 0) parts.push(`打入 ${goals} 球`);
        if (assists > 0) parts.push(`贡献 ${assists} 次助攻`);
        const flavor = parts.length > 0 ? `（${parts.join("，")}）` : "";
        const motm = rating >= 9.0 ? " 🌟全场最佳！" : "";
        const summary = `评分 ${rating.toFixed(1)} — ${evalText}${flavor}${motm}`;

        const newTotalRatings = cp.totalRatings + rating;
        const newAppearances = cp.appearances + 1;
        const newAvgRating = Math.round((newTotalRatings / newAppearances) * 10) / 10;

        const updatedCP: CareerPlayer = {
          ...cp,
          appearances: newAppearances,
          seasonAppearances: (cp.seasonAppearances ?? 0) + 1,
          goals: cp.goals + goals, assists: cp.assists + assists,
          avgRating: newAvgRating, totalRatings: newTotalRatings,
          recentRatings: recent,
          stamina: Math.max(0, cp.stamina - randInt(8, 15)),
        };

        // ── Career Events Check ──
        // 事件数据存 payload，接受逻辑集中在 acceptCareerEvent（不再挂函数 hack）
        const evt = computeCareerEvent(get(), updatedCP, avgRecent, recent);

        // ── True Season Stats Tracker：生涯球员以真实 perf 合并（与生涯面板数据一致）──
        // rating > 0 表示本场实际出场（未出场时 perf 为零值并提前返回）
        const stats = get().seasonPlayerStats;
        if (rating > 0) {
          const ptNow = get().teams.find((t) => t.id === playerTeamId);
          const prev = stats[cp.id] ?? {
            name: cp.name, position: cp.position, clubId: playerTeamId,
            clubName: ptNow?.name ?? "?", league: ptNow?.league ?? "",
            ovr: cp.overall, appearances: 0, goals: 0, assists: 0, ratingSum: 0,
          };
          stats[cp.id] = {
            ...prev,
            clubId: playerTeamId,
            clubName: ptNow?.name ?? prev.clubName,
            league: ptNow?.league ?? prev.league,
            appearances: prev.appearances + 1,
            goals: prev.goals + goals,
            assists: prev.assists + assists,
            ratingSum: prev.ratingSum + rating,
          };
        }

        set({
          careerPlayer: evt
            ? { ...updatedCP, eventsThisSeason: [...(updatedCP.eventsThisSeason ?? []), evt.type] }
            : updatedCP,
          careerEvent: evt,
          seasonPlayerStats: { ...stats },
        });

        console.log(`[store] ⚽ ${cp.name}: R${rating.toFixed(1)} G${goals} A${assists} | Growth: [${growthGains.join(",") ?? ""}]`);

        return { rating, goals, assists, summary, growthGains };
      },

      generateSeasonAwards: () => {
        const s = get();
        const cp = s.careerPlayer;
        const allTeams = [...s.teams, ...(s.otherLeaguesTeams ?? [])];
        if (allTeams.length === 0) return;

        // ── 赛季最终战绩快照（在 startNewSeason 重置积分榜之前精准抓取）──
        // 颁奖面板必须读取此快照，绝不读活积分榜（重置后全是 0胜0平0负）。
        const finalStandings = sortStandings(s.standings).map((row) => ({ ...row }));
        const playerClubId = s.playerTeamId;
        const playerClubName = s.teams.find((t) => t.id === playerClubId)?.name ?? "?";
        const euroStage = s.playerTournament?.currentStage ?? "";

        // ── 玩家单赛季真实数据快照（追踪器清零前抓取）──
        // 与金靴/金球候选池同源（seasonPlayerStats）——颁奖面板显示的数字
        // 与金靴/金球面板上的数字绝对一致。
        const cpTrackerStat = cp ? s.seasonPlayerStats[cp.id] : undefined;
        const playerSeasonStats = cpTrackerStat && cpTrackerStat.appearances > 0
          ? {
              name: cpTrackerStat.name,
              appearances: cpTrackerStat.appearances,
              goals: cpTrackerStat.goals,
              assists: cpTrackerStat.assists,
              avgRating: Math.round((cpTrackerStat.ratingSum / Math.max(1, cpTrackerStat.appearances)) * 10) / 10,
            }
          : null;

        // ── 欧战最终名次快照（赛季结算面板「欧战成绩」行）──
        const euroFinishRaw = getEuropeanFinish(s.playerTournament, playerClubId);
        const euroFinish = euroFinishRaw && s.playerTournament
          ? { compName: COMPETITION_NAMES[s.playerTournament.type] ?? "欧战", ...euroFinishRaw }
          : null;

        // ── 生涯团队奖杯记录 + 逐年赛季历程记录（赛季结算时写入）──
        let cpSeasonTrophies: CareerTrophy[] = [];
        if (cp) {
          const newTrophies: CareerTrophy[] = [];
          const myRowIdx = finalStandings.findIndex((row) => row.teamId === playerClubId);
          if (myRowIdx === 0 && finalStandings.length > 0) {
            newTrophies.push({ season: s.season, type: "league", name: "联赛冠军", icon: "🏆" });
            console.log(`[store] 🏆 ${cp.name} 随队夺得联赛冠军！(S${s.season})`);
          }
          if (s.playerTournament?.currentStage === "done") {
            const finalTie = s.playerTournament.final?.ties[0];
            if (finalTie?.winnerId === playerClubId) {
              const compName = COMPETITION_NAMES[s.playerTournament.type] ?? "欧战";
              const type = s.playerTournament.type.toLowerCase() as CareerTrophy["type"];
              newTrophies.push({ season: s.season, type, name: `${compName}冠军`, icon: "🏆" });
              console.log(`[store] 🏆 ${cp.name} 随队夺得${compName}冠军！(S${s.season})`);
            }
          }
          // 逐年记录：球队/排名/欧战/单季数据/OVR/身价（真实追踪器数据）
          const seasonRecord: CareerSeasonRecord = {
            season: s.season,
            clubName: playerClubName,
            leagueName: s.currentLeagueName,
            leagueRank: myRowIdx >= 0 ? myRowIdx + 1 : null,
            euroFinishLabel: euroFinish ? `${euroFinish.compName}${euroFinish.label}` : null,
            apps: cpTrackerStat?.appearances ?? 0,
            goals: cpTrackerStat?.goals ?? 0,
            assists: cpTrackerStat?.assists ?? 0,
            avgRating: cpTrackerStat && cpTrackerStat.appearances > 0
              ? Math.round((cpTrackerStat.ratingSum / cpTrackerStat.appearances) * 10) / 10
              : 0,
            ovr: cp.overall,
            value: cp.value,
          };
          cpSeasonTrophies = newTrophies;
          set({
            careerPlayer: {
              ...cp,
              careerTrophies: [...(cp.careerTrophies ?? []), ...newTrophies],
              careerSeasons: [...(cp.careerSeasons ?? []), seasonRecord],
            },
          });
        }

        // ── True Season Stats Tracker：候选池严格读取赛季真实累计数据 ──
        // 绝不在赛季末用 Math.random() 捏造真实出场球员的进球/助攻/评分——
        // 所有数据在每场比赛中已实时累加至 seasonPlayerStats。
        interface AC {
          name: string; club: string; league: string; position: string;
          ovr: number; goals: number; assists: number; rating: number;
          uclChampion: boolean; leagueChampion: boolean; // 重大团队荣誉（金球奖权重）
        }
        const pool: AC[] = Object.values(s.seasonPlayerStats)
          .filter((st) => st.appearances > 0)
          .map((st) => ({
            name: st.name, club: st.clubName, league: st.league, position: st.position,
            ovr: st.ovr, goals: st.goals, assists: st.assists,
            rating: st.ratingSum / Math.max(1, st.appearances),
            uclChampion: false, leagueChampion: false,
          }));
        // 生涯球员兜底：旧存档迁移时追踪器为空，以生涯面板累计数据为准
        if (cp && !pool.some((p) => p.name === cp.name)) {
          pool.push({ name: cp.name, club: allTeams.find(t => t.id === cp.teamId)?.name ?? "?", league: allTeams.find(t => t.id === cp.teamId)?.league ?? "", position: cp.position, ovr: cp.overall, goals: cp.goals, assists: cp.assists, rating: cp.avgRating, uclChampion: false, leagueChampion: false });
        }
        // 生涯球员本赛季重大团队荣誉标记（金球奖权重倾斜）
        if (cp) {
          const cpEntry = pool.find((p) => p.name === cp.name);
          if (cpEntry) {
            cpEntry.uclChampion = cpSeasonTrophies.some((t) => t.type !== "league");
            cpEntry.leagueChampion = cpSeasonTrophies.some((t) => t.type === "league");
          }
        }

        // ── 五大联赛后台数据推演（Top 5 Leagues Background Simulation）──
        // 非玩家世界的五大联赛球星从未出赛，按 OVR 动态推演"虚拟赛季累计数据"，
        // 一次性生成、全奖项共用（同一球员数据绝对一致）。已有真实追踪数据的
        // 球员（玩家所在联赛真实出赛者）按名字跳过，绝不覆盖真实数据。
        const bgStars = getTopFiveBackgroundStars(new Set(pool.map((p) => p.name)));
        for (const b of bgStars) {
          pool.push({
            name: b.name, club: b.club, league: b.league, position: b.position, ovr: b.ovr,
            goals: b.stats.goals, assists: b.stats.assists, rating: b.stats.rating,
            uclChampion: false, leagueChampion: false,
          });
        }

        if (pool.length === 0) {
          // 完全没有数据（世界未生成等异常情况）—— 无法评选，直接返回
          return;
        }

        const sorted = [...pool].sort((a, b) => b.ovr - a.ovr);

        // ── Golden Ball — 永不空缺 + 联赛等级限制 + 权重重构 ──
        // 资格：五大联赛 + curated 豪门名单（isBallonEligible）；低级别联赛球员无资格。
        // 评分权重大幅向真实 G+A、场均评分与重大团队荣誉（欧冠/联赛冠军）倾斜：
        // 断层式表现（G+A≥45 + 评分≥7.7 + 欧冠/联赛冠军）直通当选，绝不让数据平庸者爆冷。
        const eligible = sorted.filter((p) => isBallonEligible(p.league, p.club));
        const ballonScore = (p: AC) =>
          (p.goals + p.assists) * 2.5 + p.rating * 8 + p.ovr * 0.8
          + (p.uclChampion ? 18 : 0) + (p.leagueChampion ? 10 : 0);

        // ① 断层式表现直通：真实 G+A ≥ 45、评分 ≥ 7.7 且随队夺得欧冠/联赛冠军
        const dominant = eligible
          .filter((p) => (p.goals + p.assists) >= 45 && p.rating >= 7.7 && (p.uclChampion || p.leagueChampion))
          .sort((a, b) => b.goals + b.assists - (a.goals + a.assists));

        let goldenBall: { name: string; club: string; goals: number; assists: number; rating: number };
        if (dominant.length > 0) {
          goldenBall = dominant[0];
          console.log(`[store] 🏆 Ballon d'Or 直通：${goldenBall.name}（${goldenBall.goals + goldenBall.assists} G+A + 重大冠军）断层当选`);
        } else {
          // ② 常规路径：门槛逐级降低（精英 → 准精英 → 出色），评分门槛同步放宽
          const BALLON_TIERS = [
            { label: "精英档 (OVR≥85 · G+A≥35 · R≥8.5)", ovr: 85, ga: 35, rating: 8.5 },
            { label: "准精英档 (OVR≥83 · G+A≥30 · R≥8.0)", ovr: 83, ga: 30, rating: 8.0 },
            { label: "出色档 (OVR≥80 · G+A≥25 · R≥7.7)", ovr: 80, ga: 25, rating: 7.7 },
          ];
          let tierCandidates: AC[] = [];
          let tierUsed = -1;
          for (let i = 0; i < BALLON_TIERS.length; i++) {
            const t = BALLON_TIERS[i];
            tierCandidates = eligible.filter((p) => p.ovr >= t.ovr && (p.goals + p.assists) >= t.ga && p.rating >= t.rating);
            if (tierCandidates.length > 0) { tierUsed = i; break; }
          }
          if (tierCandidates.length > 0) {
            goldenBall = [...tierCandidates].sort((a, b) => ballonScore(b) - ballonScore(a))[0];
          } else {
            // 终极安全网：资格池理论上永不落空（五大联赛豪门球星必然入池）
            goldenBall = [...sorted].sort((a, b) => ballonScore(b) - ballonScore(a))[0];
            console.warn("[store] 🏆 Ballon d'Or: no eligible candidate in any tier — awarded to the global best player as last resort.");
          }
          console.log(`[store] 🏆 Ballon tier: ${tierUsed >= 0 ? BALLON_TIERS[tierUsed].label : "终极安全网"} — ${eligible.length} eligible candidates`);
        }

        // ── Golden Boot: 真实赛季进球王（数据来自追踪器，无最低门槛、不捏造）──
        const topScorer = [...pool].sort((a, b) => b.goals - a.goals)[0];
        const goldenBoot: { name: string; club: string; goals: number } | null =
          topScorer && topScorer.goals > 0 ? { name: topScorer.name, club: topScorer.club, goals: topScorer.goals } : null;

        // ── League Best: 真实场均评分最高（OVR ≥ 82 优先，无则全池）──
        const bestPool = sorted.filter(p => p.ovr >= 82).sort((a, b) => b.rating - a.rating);
        const bestAny = [...pool].sort((a, b) => b.rating - a.rating)[0];
        const leagueBest: { name: string; club: string } | null =
          bestPool.length > 0 ? { name: bestPool[0].name, club: bestPool[0].club }
            : bestAny ? { name: bestAny.name, club: bestAny.club } : null;

        // ── Team of Season — STRICT 4-3-3 formation（数据同样来自真实追踪器）──
        // GK×1 · DEF×4 (LB/CB/CB/RB) · MID×3 (CDM/CM/CAM) · FWD×3 (LW/ST/RW).
        // Every slot is filled ONLY by players of that position — a defender can
        // never be pushed into an attacking slot, no matter how thin the pool is.
        // ── Team of Season — STRICT 4-3-3 + 金靴得主硬性入选 ──
        // 绝对规则：本赛季金靴奖（进球最多）得主必须直接入选最佳阵容首发，
        // 占据其位置组的招牌名额（ST/CM/CB/GK），绝不允许被挤出最佳阵。
        const bootWinnerEntry = goldenBoot ? pool.find((p) => p.name === goldenBoot.name) : undefined;
        const bootMarqueeSlot = (position: string) =>
          position === "FWD" ? "ST" : position === "MID" ? "CM" : position === "DEF" ? "CB" : "GK";
        const tots: { name: string; position: string; slot: string }[] = [];
        const used = new Set<string>();
        const layout: { position: string; slots: string[] }[] = [
          { position: "GK",  slots: ["GK"] },
          { position: "DEF", slots: ["LB", "CB", "CB", "RB"] },
          { position: "MID", slots: ["CDM", "CM", "CAM"] },
          { position: "FWD", slots: ["LW", "ST", "RW"] },
        ];
        let bootPlaced = false;
        for (const { position, slots } of layout) {
          // 1) Elite pool first (OVR ≥ 80), same position, best rating
          const elite = sorted.filter(p => p.position === position && p.ovr >= 80 && !used.has(p.name))
            .sort((a, b) => b.rating - a.rating).slice(0, slots.length);
          // 2) Relaxed fill — SAME position only, any OVR (never cross-position)
          let relaxed = elite.length < slots.length
            ? pool.filter(p => p.position === position && !used.has(p.name) && !elite.includes(p))
              .sort((a, b) => b.rating - a.rating).slice(0, slots.length - elite.length)
            : [];
          let picks = [...elite, ...relaxed];
          // 3) 金靴得主硬性入选：同位置组内顶替评分最低者，占据招牌名额
          if (!bootPlaced && bootWinnerEntry && bootWinnerEntry.position === position) {
            if (!picks.some((p) => p.name === bootWinnerEntry.name)) {
              picks = [...picks.slice(0, Math.max(0, picks.length - 1)), bootWinnerEntry];
            }
            bootPlaced = true;
          }
          picks.forEach((p, i) => {
            const slot = p.name === bootWinnerEntry?.name
              ? bootMarqueeSlot(position)
              : (slots[i] ?? p.position);
            tots.push({ name: p.name, position: p.position, slot });
            used.add(p.name);
          });
        }

        const playerWon: string[] = [];
        if (cp && goldenBall.name === cp.name) playerWon.push("金球奖");
        if (cp && goldenBoot?.name === cp.name) playerWon.push("金靴奖");
        if (cp && leagueBest?.name === cp.name) playerWon.push("联赛最佳球员");
        if (cp && tots.some(t => t.name === cp.name)) playerWon.push("最佳阵容");

        if (playerWon.length > 0 && cp) {
          const icons: Record<string, string> = { "金球奖": "🏆", "金靴奖": "👟", "联赛最佳球员": "⭐", "最佳阵容": "🌟" };
          const newHonours = playerWon.map(a => ({ season: s.season, award: a, icon: icons[a] ?? "🏅" }));
          // 基于最新 careerPlayer（包含刚记录的 careerTrophies），避免覆盖奖杯
          const cpWithTrophies = get().careerPlayer ?? cp;
          // 金球奖得主身价地板：登顶金球 → 身价至少 €120M（= 身价上限的 60%，顶级巨星市场地位）
          const BALLON_VALUE_FLOOR = VALUE_CEILING * 0.6;
          if (playerWon.includes("金球奖") && cpWithTrophies.value < BALLON_VALUE_FLOOR) {
            cpWithTrophies.value = BALLON_VALUE_FLOOR;
            console.log(`[store] 💰 ${cpWithTrophies.name} 夺得金球奖 — 身价升至 €${cpWithTrophies.value.toLocaleString()}`);
          }
          set({ careerPlayer: { ...cpWithTrophies, honours: [...(cpWithTrophies.honours ?? []), ...newHonours] } });
        }

        set({ seasonAwards: {
          goldenBall: { ...goldenBall, club: goldenBall.club },
          leagueBest: leagueBest ? { ...leagueBest, club: leagueBest.club } : null,
          goldenBoot: goldenBoot ? { ...goldenBoot, club: goldenBoot.club } : null,
          teamOfSeason: tots, playerWon,
          // 战绩快照（重置前抓取）— 颁奖面板严格读取，保证 胜/平/负 与积分真实
          finalStandings, playerClubId, playerClubName, euroStage,
          // 玩家单赛季真实数据快照 —「我的赛季数据」卡片与金靴/金球同源一致
          playerSeasonStats,
          // 欧战最终名次（赛季结算面板「欧战成绩」行）
          euroFinish,
        } });
        console.log(`[store] 🏆 Ballon: ${goldenBall.name} (${goldenBall.goals + goldenBall.assists}GA/${goldenBall.rating.toFixed(1)}), Boot: ${goldenBoot ? `${goldenBoot.name} (${goldenBoot.goals}G)` : "空缺"}, Best: ${leagueBest?.name ?? "空缺"}, Pool: ${pool.length} players (${bgStars.length} background stars)`);
      },

      startSeasonSimulation: () => {
        // ── 前置校验拦截：阵容异常时明确报错，绝不静默卡死 ──
        const pre = get();
        if (pre.isSeasonEnded) return;
        const preTeam = pre.teams.find((t) => t.id === pre.playerTeamId);
        if (!preTeam) {
          set({ simError: "无法开始模拟：未找到你的球队数据，请返回主菜单重试。" });
          return;
        }
        if (preTeam.players.length < 11) {
          set({ simError: `无法开始模拟：一线队仅 ${preTeam.players.length} 人（至少需要 11 人）。请在转会市场补强或开启新赛季。` });
          return;
        }
        // 首发自动兜底：不足 11 人或引用失效 → 一整套最强 11 人填回
        const fixedTeam = ensureValidStarters(preTeam);
        if (fixedTeam !== preTeam) {
          set({ teams: pre.teams.map((t) => (t.id === preTeam.id ? fixedTeam : t)) });
        }

        const startIdx = get().seasonMatchLog.length; // track where this segment begins
        // 记录本段起点 — 汇报弹窗只渲染 [simulationSegmentStart, ...] 的记录，
        // 联赛/欧战两个赛段的记录绝不混在一个列表里。
        set({ isSimulating: true, simulationPaused: false, simulationSegmentStart: startIdx, pendingElimination: false, simError: null });
        if (startIdx === 0) set({ seasonMatchLog: [] });
        (async () => {
          try {
            for (let i = 0; i < 80 && get().isSimulating && !get().isSeasonEnded; i++) {
              const s = get();
              if (!s.isSimulating || s.isSeasonEnded) break;

              // ── Interruption checks ──
              if (s.careerEvent) { set({ simulationPaused: true }); break; }

              const pt = s.teams.find(t => t.id === s.playerTeamId);
              if (!pt) break;

              // Check if career player is injured
              const cp = s.careerPlayer;
              const cpInjured = cp ? (cp.injuryWeeks ?? 0) > 0 : false;

              // The matchday ABOUT TO BE PLAYED — captured before playing so the
              // pacing checkpoints below know exactly which round just finished.
              const mdPlayed = s.seasonCalendar?.[(s.currentMatchday ?? 1) - 1];

              // Auto-lineup
              s.generateAILineup();

              // Play match
              let result;
              try { result = s.playMatchweek(); } catch (e) {
                // 明确报错并中断，绝不静默循环（曾致"一键模拟"无响应卡死）
                const msg = e instanceof Error ? e.message : String(e);
                console.error("[sim] ❌ playMatchweek 异常：", msg);
                set({ simError: `模拟中断：${msg}`, isSimulating: false, simulationPaused: false });
                break;
              }
              if (!result) {
                // Bye week (European) or season just ended — yield instead of
                // spinning synchronously through the rest of the loop.
                if (get().isSeasonEnded) break;
                await new Promise<void>(r => setTimeout(r, 50));
                continue;
              }

              // Career performance
              const pi = result.homeTeamId === s.playerTeamId;
              const oppId = pi ? result.awayTeamId : result.homeTeamId;
              const opp = [...s.teams, ...(s.virtualEuroTeams ?? [])].find(t => t.id === oppId);
              const ts = pi ? result.homeScore : result.awayScore;
              const os = pi ? result.awayScore : result.homeScore;
              const perf = s.simulateCareerPerformance(result, s.playerTeamId);

              // 赛段与语义化轮次标签（联赛/欧战一目了然）
              const phase: CareerMatchLogEntry["phase"] = mdPlayed?.type === "european" ? "european" : "league";
              const competition: CareerMatchLogEntry["competition"] =
                phase === "european" ? (s.playerTournament?.type ?? null) : null;
              const label = mdPlayed
                ? formatMatchdayLabel(mdPlayed, competition)
                : `第 ${s.currentWeek} 轮`;

              // 日历欧战轮次（决胜轮记录需要点球比分展示）
              const euroRoundPlayed = mdPlayed?.type === "european"
                ? s.seasonCalendar.filter((m) => m.type === "european").findIndex((m) => m.id === mdPlayed.id) + 1
                : 0;

              // ── 欧战决胜轮（次回合/决赛）：总比分打平触发点球大战时，
              // 记录中拼接点球比分，如 "0-0 平 (点球 3-4 负)" ──
              let resultText = `${ts}-${os} ${ts > os ? "胜" : ts === os ? "平" : "负"}`;
              if (mdPlayed?.type === "european" && [10, 12, 14, 16, 17].includes(euroRoundPlayed)) {
                const tie = findPlayerTie(get().playerTournament, s.playerTeamId, euroRoundPlayed);
                if (tie && tie.penaltyHome !== undefined && tie.penaltyAway !== undefined) {
                  const isTieHome = tie.homeId === s.playerTeamId;
                  const pensWon = isTieHome ? tie.penaltyHome > tie.penaltyAway : tie.penaltyAway > tie.penaltyHome;
                  resultText += ` (点球 ${tie.penaltyHome}-${tie.penaltyAway} ${pensWon ? "胜" : "负"})`;
                }
              }

              set({ seasonMatchLog: [...get().seasonMatchLog, {
                round: mdPlayed?.round ?? s.currentWeek, opponent: opp?.name ?? "?",
                goals: perf.goals, assists: perf.assists,
                rating: perf.rating > 0 ? perf.rating : 0,
                result: resultText,
                injured: cpInjured && perf.rating === 0,
                phase, competition, label,
              }] });

              const after = get();
              if (after.isSeasonEnded) break; // natural season end (final / no-euro skip)

              // ── Pacing checkpoints (精细化的模拟节奏) ──
              // ① Domestic league phase just ended.
              // currentMatchday already advanced past the played matchday, so the
              // REMAINING entries start at index currentMatchday - 1 (off-by-one fix:
              // slice(currentMatchday) skipped the next entry and fired one round early).
              const isLeagueEnd = mdPlayed?.type === "league" &&
                !after.seasonCalendar.slice(after.currentMatchday - 1).some((m) => m.type === "league");

              // ② UCL league phase (8 rounds) just completed
              const euroLeaguePhaseDone = mdPlayed?.type === "european" && euroRoundPlayed === 8;

              // ③ A knockout round just completed (both legs of playoffs / R16 / QF / SF)
              const koRoundDone = mdPlayed?.type === "european" && [10, 12, 14, 16].includes(euroRoundPlayed);

              // ── Pause at every pacing checkpoint — ALWAYS, win or lose ──
              // 淘汰出局也不得跳过汇报：先强制暂停、完整列出两回合（含点球）比分；
              // 玩家在汇报面板点「确认」后（confirmSimulationPause），
              // 系统才根据 pendingElimination 触发赛季结算（endSeasonEarly）。
              const eliminatedNow = koRoundDone && isPlayerEliminated(after.playerTournament, s.playerTeamId);
              if (isLeagueEnd || euroLeaguePhaseDone || koRoundDone) {
                set({ simulationPaused: true, pendingElimination: eliminatedNow });
                console.log(`[sim] ⏸️ ${mdPlayed.name} finished${eliminatedNow ? " — ❌ eliminated（汇报确认后结算赛季）" : ""} — paused, awaiting manual continue.`);
                break;
              }

              if (after.careerEvent) { set({ simulationPaused: true }); break; }

              await new Promise<void>(r => setTimeout(r, 80));
            }
          } finally {
            // Keep simulationPaused as-is: the loop breaks WITH the pause flag set
            // and the UI shows the pause modal based on it. Only isSimulating is
            // cleared — the player must manually click "继续模拟" to run again.
            set({ isSimulating: false });
          }
        })();
      },

      /** Immediate season settlement — used when the player is eliminated in Europe. */
      endSeasonEarly: () => {
        const s = get();
        if (s.isSeasonEnded) return;
        const sResult = buildSeasonResult(s.standings, s.teams, s.playerTeamId, s.leagueRules ?? undefined);
        const teams = s.teams.map((t) =>
          t.id === s.playerTeamId ? { ...t, budget: t.budget + sResult.prizeMoney } : t,
        );
        set({
          teams,
          isSeasonEnded: true,
          seasonResult: sResult,
          currentMatchday: s.seasonCalendar.length + 1,
          currentWeek: s.seasonCalendar[s.seasonCalendar.length - 1]?.round ?? s.currentWeek,
          isSimulating: false,
          simulationPaused: false,
        });
        console.log(`[store] 🏁 欧战出局 — 赛季提前结算：第 ${sResult.rank} 名，奖金 €${sResult.prizeMoney.toLocaleString()}`);
      },

      dismissCareerEvent: () => set({ careerEvent: null }),

      dismissSimError: () => set({ simError: null }),

      /**
       * 汇报面板「确认」：关闭弹窗并停止模拟（绝不自动续跑）。
       * 唯一例外：淘汰出局汇报（pendingElimination）——玩家已看到两回合
       * （含点球）的完整死因，此刻才触发赛季结算（endSeasonEarly）。
       */
      confirmSimulationPause: () => {
        const s = get();
        const wasElimination = s.pendingElimination;
        set({ simulationPaused: false, pendingElimination: false });
        if (wasElimination && !s.isSeasonEnded) {
          console.log("[store] 🏁 淘汰汇报已确认 — 触发赛季结算");
          get().endSeasonEarly();
        }
      },

      /**
       * 挂靴退役（二次确认弹窗的最终确认后调用）：
       * 构建生涯荣誉总结（真实累计数据，绝不现场编造）→ 进入谢幕页。
       */
      retirePlayer: () => {
        const s = get();
        if (!s.careerPlayer || s.isSimulating) return;
        const legacy = buildCareerLegacy(s.careerPlayer, s.season);
        set({
          careerLegacy: legacy,
          gameStatus: "RETIRED",
          isSimulating: false,
          simulationPaused: false,
          careerEvent: null,
          seasonAwards: null,
        });
        console.log(`[store] 🎖️ ${s.careerPlayer.name} 挂靴退役 — 生涯评价：${legacy.rating.tier}`);
      },

      /**
       * AI 教练自动转会与引援（转会窗口 = 新赛季开始）：
       * 评估阵容短板——某位置组最强球员长期伤停（≥6 周）或核心老化（≥33 岁）
       * 且该位置健康球员不足 4 人时，从转会市场签入位置匹配、质量相当（OVR ≥ 最强-5）、
       * 年轻（≤29 岁）的新援（扣预算/移出市场/新援加盟通知），单窗口至多 2 笔。
       */
      aiReinforceSquad: () => {
        const s = get();
        if (!s.careerPlayer?.teamId) return; // 仅生涯模式（AI 教练管理球队）
        const pt = s.teams.find((t) => t.id === s.playerTeamId);
        if (!pt || pt.budget <= 0) return;

        const signedIds = new Set<string>();
        const market = [...s.transferMarketPlayers];
        let newEvent: CareerEvent | null = null;

        for (const pos of [Position.GK, Position.DEF, Position.MID, Position.FWD] as Position[]) {
          if (signedIds.size >= 2) break;
          const fresh = get();
          const freshPt = fresh.teams.find((t) => t.id === fresh.playerTeamId);
          if (!freshPt) return;
          const group = freshPt.players.filter((p) => p.position === pos);
          const healthyCount = group.filter((p) => p.injuryWeeks === 0).length;
          if (healthyCount >= 4) continue; // 深度充足，无需补强
          const best = [...group].sort((a, b) => b.overall - a.overall)[0];
          if (!best) continue;
          const longTermInjured = best.injuryWeeks >= 6;
          const agingCore = best.age >= 33;
          const criticallyShort = group.length < 2; // 位置组绝对短缺（如中场/后防无人可用）
          if (!longTermInjured && !agingCore && !criticallyShort) continue;
          const reasonText = longTermInjured
            ? "长期伤停留下的主力空缺"
            : agingCore
              ? "老化核心身后的位置空缺"
              : "人手短缺的位置组";

          // ── 血脉传承优先：U21 潜力小将提拔（免费、不占市场）──
          // 例外：位置组绝对短缺（<2 人）→ 缺口强制引援，跳过青训直接买专职球员
          if (!criticallyShort) {
            const prospect = [...(freshPt.u21Players ?? [])]
              .filter((p) => p.position === pos && p.age >= 17
                && p.potential >= best.overall - 3 && p.overall >= 55)
              .sort((a, b) => b.potential - a.potential)[0];
            if (prospect) {
              signedIds.add(`youth-${pos}`); // 提拔同样计入单窗口 2 笔上限
              set({
                teams: fresh.teams.map((t) => t.id === fresh.playerTeamId
                  ? { ...t, players: [...t.players, prospect], u21Players: t.u21Players.filter((p) => p.id !== prospect.id) }
                  : t),
              });
              console.log(`[store] 🌱 青训提拔：${prospect.name} (${pos} ${prospect.overall}/POT ${prospect.potential}) 从 U21 升入一线队`);
              if (!newEvent) {
                newEvent = {
                  type: "new_signing",
                  title: "🌱 青训小将提拔",
                  body: `教练组将 U21 潜力新星 ${prospect.name}（OVR ${prospect.overall}，潜力 ${prospect.potential}）提拔进一线队，以填补${reasonText}。青训血脉，代代相传。`,
                  actionLabel: "期待新星",
                  dismissLabel: "知道了",
                  payload: { playerName: prospect.name, position: pos, ovr: prospect.overall, fee: 0 },
                };
              }
              continue;
            }
          }

          // 市场寻找同位置、质量匹配、年轻的新援（青训无人时兜底）
          const candidates = market
            .filter((p) => !signedIds.has(p.id)
              && p.position === pos && p.overall >= best.overall - 5
              && p.age <= 29 && p.value <= freshPt.budget)
            .sort((a, b) => b.overall - a.overall);
          const pick = candidates[0];
          if (!pick) continue;

          // 签约：新 UUID 入队 + 扣预算 + 移出市场
          const newPlayer: Player = { ...pick, id: generateUUID(), injuryWeeks: 0 };
          set({
            teams: fresh.teams.map((t) =>
              t.id === fresh.playerTeamId
                ? { ...t, budget: t.budget - pick.value, players: [...t.players, newPlayer] }
                : t),
            transferMarketPlayers: fresh.transferMarketPlayers.filter((p) => p.id !== pick.id),
          });
          signedIds.add(pick.id);
          console.log(`[store] 🤖 AI 引援：${pick.name} (${pos} ${pick.overall}) → ${freshPt.name}，€${pick.value.toLocaleString()}${longTermInjured ? "（补长期伤停）" : "（替代老化核心）"}`);

          if (!newEvent) {
            newEvent = {
              type: "new_signing",
              title: "✍️ 新援加盟",
              body: `教练组在转会窗签下了${pos} ${pick.name}（OVR ${pick.overall}，转会费 ${formatEuroM(pick.value)}），以填补${reasonText}。球队深度得到补强。`,
              actionLabel: "欢迎新援",
              dismissLabel: "知道了",
              payload: { playerName: pick.name, position: pos, ovr: pick.overall, fee: pick.value },
            };
          }
        }

        if (newEvent && !get().careerEvent) {
          set({ careerEvent: newEvent });
        }
      },

      /**
       * 接受生涯事件（续约 / 豪门转会 / 租借）。
       * 转会与租借的同联赛路径为阵容迁移（立即生效，赛季进度保留）；
       * 跨联赛路径写入 pendingMove，由 startNewSeason 重建世界生效。
       */
      acceptCareerEvent: () => {
        const s = get();
        const evt = s.careerEvent;
        const cp = s.careerPlayer;
        if (!evt || !cp) return;

        switch (evt.type) {
          case "contract_renewal": {
            const newOVR = Math.min(99, cp.overall + 2);
            set({ careerPlayer: { ...cp, overall: newOVR, value: Math.round(cp.value * 1.2) }, careerEvent: null });
            return;
          }

          case "transfer_offer": {
            const payload =
              (evt.payload as { clubName: string; clubDbId: string; leagueName: string; fee: number } | null | undefined)
              ?? buildFallbackTransferPayload(s, cp);
            if (!payload) { set({ careerEvent: null }); return; }

            if (payload.leagueName === s.currentLeagueName) {
              // ── 同联赛转会：立即生效（roster move，standings/赛程保留）──
              const target = s.teams.find((t) => t.name === payload.clubName);
              if (!target) { set({ careerEvent: null }); return; }
              const teams = moveCareerPlayerBetweenTeams(s.teams, cp, s.playerTeamId, target.id);
              set({
                teams,
                playerTeamId: target.id,
                playerTournament: s.playerTournament
                  ? remapTournamentTeamId(s.playerTournament, s.playerTeamId, target.id)
                  : null,
                careerPlayer: { ...cp, teamId: target.id, value: payload.fee },
                careerEvent: null,
              });
              console.log(`[store] 🔄 转会生效：${cp.name} → ${target.name}（${formatEuroM(payload.fee)}）`);
            } else {
              // ── 跨联赛转会：赛季末重建世界生效 ──
              set({
                careerPlayer: {
                  ...cp,
                  pendingMove: {
                    kind: "transfer",
                    parentClub: getCurrentClubDbIdentity(s),
                    targetClub: { dbId: payload.clubDbId, name: payload.clubName, leagueName: payload.leagueName },
                    fee: payload.fee,
                  },
                  loanParent: null, // 转会覆盖租借
                },
                careerEvent: null,
              });
              console.log(`[store] 📋 转会达成（赛季末生效）：${cp.name} → ${payload.clubName}（${formatEuroM(payload.fee)}）`);
            }
            return;
          }

          case "loan_offer": {
            const payload = evt.payload as {
              clubName: string; clubDbId: string; leagueName: string;
              crossLeague: boolean; gameTeamId: string | null;
            } | null | undefined;
            if (!payload) { set({ careerEvent: null }); return; }

            if (!payload.crossLeague && payload.gameTeamId) {
              // ── 同联赛租借：立即生效，赛季末回归 ──
              const target = s.teams.find((t) => t.id === payload.gameTeamId);
              if (!target) { set({ careerEvent: null }); return; }
              const teams = moveCareerPlayerBetweenTeams(s.teams, cp, s.playerTeamId, target.id);
              set({
                teams,
                playerTeamId: target.id,
                playerTournament: s.playerTournament
                  ? remapTournamentTeamId(s.playerTournament, s.playerTeamId, target.id)
                  : null,
                careerPlayer: { ...cp, teamId: target.id, loanParent: { kind: "game", teamId: s.playerTeamId } },
                careerEvent: null,
              });
              console.log(`[store] 🤝 租借生效：${cp.name} → ${target.name}（赛季末回归母队）`);
            } else {
              // ── 跨联赛租借：赛季末生效，效力一个赛季后回归 ──
              set({
                careerPlayer: {
                  ...cp,
                  pendingMove: {
                    kind: "loan",
                    parentClub: getCurrentClubDbIdentity(s),
                    targetClub: { dbId: payload.clubDbId, name: payload.clubName, leagueName: payload.leagueName },
                    fee: 0,
                  },
                },
                careerEvent: null,
              });
              console.log(`[store] 🤝 租借达成（赛季末开始）：${cp.name} → ${payload.clubName}（${payload.leagueName}）`);
            }
            return;
          }

          default:
            // demotion_warning / transfer_listed / transfer_rumor — 纯文案，仅关事件
            set({ careerEvent: null });
        }
      },
    }),
    {
      name: "simple-fm-game",
      version: 2,
      onRehydrateStorage: () => (state) => {
        try {
          if (!state || !state.teams || state.teams.length === 0) {
            // No saved data — stay in SETUP, let user pick a team
            if (state) {
              state.gameStatus = "SETUP";
              state.teams = [];
              state.playerTeamId = "";
              state.currentWeek = 1;
            }
            return;
          }

          // Migrate team data
          migrateTeams(state.teams);
          if (state.otherLeaguesTeams?.length) {
            migrateTeams(state.otherLeaguesTeams);
          }

          // ── Team.league 回填：按 teamsDatabase 名字匹配 + currentLeagueName 兜底 ──
          const dbLeagueByName = new Map(getAllTeams().map((t) => [t.name, t.league]));
          for (const t of [...state.teams, ...(state.otherLeaguesTeams ?? [])]) {
            if (!t.league) t.league = dbLeagueByName.get(t.name);
          }
          for (const t of state.teams) {
            if (!t.league) t.league = state.currentLeagueName || undefined;
          }
          // ── 首发阵容修复：加载旧存档后首发不足 11 人/引用失效 → 自动兜底 ──
          for (let i = 0; i < state.teams.length; i++) {
            state.teams[i] = ensureValidStarters(state.teams[i]);
          }

          // ── Season/calendar defaults ──
          if (state.season === undefined) state.season = 1;
          if (state.maxMatchweeks === undefined) state.maxMatchweeks = 38;
          if (state.isSeasonEnded === undefined) state.isSeasonEnded = false;
          if (state.currentMatchday === undefined) state.currentMatchday = state.currentWeek ?? 1;
          if (!state.seasonCalendar || state.seasonCalendar.length === 0) {
            state.seasonCalendar = generateCalendar();
          }
          if (!state.virtualEuroTeams || state.virtualEuroTeams.length === 0) {
            state.virtualEuroTeams = getVirtualTeams();
          }
          if (state.playerTournament === undefined) state.playerTournament = null;
          if (!state.transferMarketPlayers) state.transferMarketPlayers = [];
          if (state.simulationSegmentStart === undefined) state.simulationSegmentStart = 0;
          if (state.pendingElimination === undefined) state.pendingElimination = false;
          if (state.careerLegacy === undefined) state.careerLegacy = null;
          if (state.simError === undefined) state.simError = null;
          if (!state.seasonPlayerStats || typeof state.seasonPlayerStats !== "object") state.seasonPlayerStats = {};
          // 旧存档的"金球空缺"奖项已废止（永不空缺规则）——清除陈旧颁奖面板
          if (state.seasonAwards && !state.seasonAwards.goldenBall) state.seasonAwards = null;
          // 旧存档奖项缺「我的赛季数据」快照 → 默认隐藏该卡片
          if (state.seasonAwards && state.seasonAwards.playerSeasonStats === undefined) {
            state.seasonAwards.playerSeasonStats = null;
          }
          // 迁移旧赛季日志：补充 phase/competition/label 字段（旧格式只有 round）
          if (!Array.isArray(state.seasonMatchLog)) {
            state.seasonMatchLog = [];
          } else {
            state.seasonMatchLog = state.seasonMatchLog
              .filter((e: Partial<CareerMatchLogEntry> | null): e is Partial<CareerMatchLogEntry> & { round: number } =>
                !!e && typeof e.round === "number")
              .map((e) => ({
                ...e,
                // 旧格式 round > 38 必为欧战；≤38 无法区分，按联赛处理（仅影响旧存档的过渡显示）
                phase: e.phase ?? (e.round > 38 ? "european" : "league"),
                competition: e.competition ?? null,
                label: e.label ?? (e.round > 38 ? `欧战 第 ${e.round} 轮` : `联赛第 ${e.round} 轮`),
              }));
          }
          if (state.gameMode === undefined) state.gameMode = "manager";
          if (state.careerPlayer === undefined) state.careerPlayer = null;
          // Migrate old CareerPlayer format (missing playmaking / recentRatings)
          if (state.careerPlayer) {
            const cp = state.careerPlayer as unknown as Record<string, unknown>;
            if (cp.playmaking === undefined) cp.playmaking = Math.round(((cp.attack as number) ?? 50) * 0.5 + ((cp.defense as number) ?? 50) * 0.5);
            if (cp.recentRatings === undefined) (cp as { recentRatings: number[] }).recentRatings = [];
            if (cp.careerTrophies === undefined) cp.careerTrophies = [];
            if (cp.careerSeasons === undefined) cp.careerSeasons = [];
            if (cp.seasonAppearances === undefined) cp.seasonAppearances = (cp.appearances as number) ?? 0;
            if (cp.loanParent === undefined) cp.loanParent = null;
            if (cp.pendingMove === undefined) cp.pendingMove = null;
            if (cp.eventsThisSeason === undefined) cp.eventsThisSeason = [];
          }
          if (state.leagueRules === undefined) state.leagueRules = null;
          if (state.gameStatus === undefined) {
            state.gameStatus = "PLAYING";
          }
          if (!state.currentLeagueName) state.currentLeagueName = "";
          if (!state.otherLeaguesTeams) state.otherLeaguesTeams = [];

          // ── Handle old seasonResult format (missing europeanQualification) ──
          if (state.seasonResult && state.seasonResult.europeanQualification === undefined) {
            const rank = state.seasonResult.rank ?? 8;
            const rules = state.leagueRules;
            const slots = rules ? buildEuroSlots(rules) : [];
            (state.seasonResult as { europeanQualification: string }).europeanQualification =
              (slots[rank - 1] as string | undefined) ?? "NONE";
          }
          if (state.seasonResult === undefined) state.seasonResult = null;

          // ── Validate playerTeamId ──
          if (state.playerTeamId && !state.teams.some((t: Team) => t.id === state.playerTeamId)) {
            console.warn("[store] ⚠️ playerTeamId is stale — resetting to first team");
            state.playerTeamId = state.teams[0]?.id ?? "";
          }

          console.log("[store] ✅ Save rehydrated successfully");
        } catch (e) {
          console.error("[store] ❌ Rehydration failed — resetting data:", e);
          try {
            localStorage.removeItem("simple-fm-game");
          } catch { /* best-effort */ }
          if (state) {
            state.gameStatus = "SETUP";
            state.teams = [];
            state.playerTeamId = "";
            state.currentWeek = 1;
            state.currentMatchday = 1;
            state.season = 1;
            state.isSeasonEnded = false;
            state.seasonResult = null;
            state.seasonCalendar = [];
            state.virtualEuroTeams = [];
            state.playerTournament = null;
            state.standings = [];
            state.transferMarketPlayers = [];
          }
        }
      },
    },
  ),
);
