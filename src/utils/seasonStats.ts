import { MatchEventType, Position, type MatchResult, type Player, type SeasonPlayerStat } from "../types/game";

/**
 * 全赛季真实数据追踪器（True Season Stats Tracker）— 纯函数累加器。
 *
 * 原则：赛季末奖项评选**绝不使用 Math.random() 捏造**进球/助攻/评分；
 * 每一场比赛在 playMatchweek 中实时累加真实数据，赛季末严格读取累计结果。
 *
 * 非生涯球员的单场评分由 `computeMatchRating` **确定性推导**（同一场数据
 * 永远得到同一评分），生涯球员的评分则来自 simulateCareerPerformance 的
 * 真实 perf（与生涯面板显示一致，跳过本累加器）。
 */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 单场评分（确定性，无随机）：与生涯球员评分公式同构——
 * 有 G/A：基础 6.5 + 进球×0.6 + 助攻×0.4 + 梅开二度/帽子戏法奖励 + 赛果修正；
 * 无 G/A：严格封顶 6.8；输球且贡献不足再压到 7.5 以下。
 */
export function computeMatchRating(
  goals: number, assists: number, won: boolean, drew: boolean,
): number {
  const hasGorA = goals > 0 || assists > 0;
  let rating: number;
  if (hasGorA) {
    let base = 6.5 + goals * 0.6 + assists * 0.4;
    if (goals >= 2) base += 0.3;
    if (goals >= 3) base += 0.5;
    if (won) base += 0.5;
    else if (drew) base += 0.1;
    else base -= 0.2;
    rating = clamp(base, 5.5, 10.0);
  } else {
    let base = 6.0;
    if (won) base += 0.3;
    else if (drew) base += 0.1;
    else base -= 0.3;
    rating = clamp(base, 5.5, 6.8);
  }
  if (!won && !drew && goals < 2) rating = clamp(rating, 5.0, 7.5);
  return rating;
}

/** 球队查找表条目（累加时按 teamId 解析球员与俱乐部元数据） */
export interface TeamStatMeta {
  name: string;
  league: string;
  players: Player[];
}

/**
 * 累加一场比赛的真实数据。
 * - 出场：双方首发 + 事件球员（替补进球者等）
 * - 进球/助攻：来自比赛事件的 Goal / Assist 事件（真实引擎产出）
 * - 评分：computeMatchRating 确定性推导，累加 ratingSum
 * @param skipPlayerId 生涯球员 id — 其数据由 simulateCareerPerformance 的
 *                     真实 perf 单独合并（保证与生涯面板一致），此处跳过避免双计。
 * @returns 新的统计对象（不修改入参）
 */
export function accumulateMatchStats(
  stats: Record<string, SeasonPlayerStat>,
  result: MatchResult,
  teamLookup: Map<string, TeamStatMeta>,
  skipPlayerId?: string,
): Record<string, SeasonPlayerStat> {
  const next: Record<string, SeasonPlayerStat> = { ...stats };

  const ensure = (playerId: string, teamId: string): SeasonPlayerStat => {
    const existing = next[playerId];
    if (existing) {
      // 写时克隆：绝不修改调用方持有的旧条目对象
      const clone: SeasonPlayerStat = { ...existing };
      next[playerId] = clone;
      return clone;
    }
    const team = teamLookup.get(teamId);
    const player = team?.players.find((p) => p.id === playerId);
    const entry: SeasonPlayerStat = {
      name: player?.name ?? `球员 ${playerId.slice(0, 6)}`,
      position: player?.position ?? Position.MID,
      clubId: teamId,
      clubName: team?.name ?? "?",
      league: team?.league ?? "",
      ovr: player?.overall ?? 60,
      appearances: 0, goals: 0, assists: 0, ratingSum: 0,
    };
    next[playerId] = entry;
    return entry;
  };

  // 本场每人进球/助攻计数（评分用）
  const matchGA = new Map<string, { goals: number; assists: number }>();

  // ── 出场累加 ──
  const homeIds = new Set(result.homeStarters);
  const awayIds = new Set(result.awayStarters);
  for (const pid of [...homeIds, ...awayIds]) {
    if (pid === skipPlayerId) continue;
    const entry = ensure(pid, homeIds.has(pid) ? result.homeTeamId : result.awayTeamId);
    entry.appearances++;
  }

  // ── 事件累加（真实进球/助攻）──
  for (const ev of result.events) {
    if (!ev.playerId || ev.playerId === skipPlayerId) continue;
    const homeSide = homeIds.has(ev.playerId);
    const teamId = homeSide ? result.homeTeamId : result.awayTeamId;
    const entry = ensure(ev.playerId, teamId);
    const ga = matchGA.get(ev.playerId) ?? { goals: 0, assists: 0 };
    if (ev.type === MatchEventType.Goal) {
      entry.goals++;
      ga.goals++;
    } else if (ev.type === MatchEventType.Assist) {
      entry.assists++;
      ga.assists++;
    }
    matchGA.set(ev.playerId, ga);
  }

  // ── 评分累加（确定性）──
  const homeWon = result.homeScore > result.awayScore;
  const awayWon = result.awayScore > result.homeScore;
  const drew = result.homeScore === result.awayScore;
  for (const pid of new Set([...homeIds, ...awayIds])) {
    if (pid === skipPlayerId) continue;
    const ga = matchGA.get(pid) ?? { goals: 0, assists: 0 };
    const homeSide = homeIds.has(pid);
    const entry = ensure(pid, homeSide ? result.homeTeamId : result.awayTeamId);
    const won = homeSide ? homeWon : awayWon;
    entry.ratingSum += computeMatchRating(ga.goals, ga.assists, won, drew);
  }

  return next;
}
