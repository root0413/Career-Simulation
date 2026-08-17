import { getAllTeams, type RealTeamData } from "./teamsDatabase";

/**
 * 生涯模式转会生态数据与纯函数：
 * 豪门名单（转会目的地 + 金球候选资格）、联赛等级（五大联赛 vs 低级别）、
 * 租借目的地池、转会费计算。
 *
 * 注意：所有目的地一律来自 teamsDatabase 真实球队——
 * 虚拟欧战队（virt-N）绝不可作为转会/租借东家（playerTeamId 不变式）。
 */

// ── 联赛等级 ───────────────────────────────────────────────

/** 五大联赛（数据库中的真实联赛键；西甲/葡超不在数据库中） */
export const TOP5_LEAGUES: readonly string[] = [
  "Premier League",
  "Serie A Enilive",
  "Bundesliga",
  "Ligue 1 McDonald's",
  "La Liga", // 西甲（2026 完整加入数据库）
];

export function isTopFiveLeague(leagueName: string | undefined): boolean {
  return !!leagueName && (TOP5_LEAGUES as readonly string[]).includes(leagueName);
}

// ── 豪门名单（curated，teamsDatabase 真实队名）──────────────

export const ELITE_CLUBS: readonly string[] = [
  // 英超
  "Manchester City", "Arsenal", "Liverpool", "Man Utd", "Chelsea",
  // 意甲
  "Lombardia FC", "Milano FC", "Juventus", "SSC Napoli",
  // 德甲
  "FC Bayern München", "Borussia Dortmund", "Leverkusen", "RB Leipzig",
  // 法甲
  "Paris SG", "AS Monaco",
  // 西甲
  "Real Madrid", "FC Barcelona", "Atlético Madrid",
];

export function isEliteClub(clubName: string): boolean {
  return (ELITE_CLUBS as readonly string[]).includes(clubName);
}

/**
 * 金球奖候选资格：效力于五大联赛 **且** 豪门球队。
 * 低级别联赛（德乙/荷甲/土超/奥甲等）球员任何情况无资格。
 */
export function isBallonEligible(leagueName: string | undefined, clubName: string): boolean {
  return isTopFiveLeague(leagueName) && isEliteClub(clubName);
}

// ── 转会费 ─────────────────────────────────────────────────

/** 转会费倍数区间 */
export const TRANSFER_FEE_MIN_MULTIPLIER = 1.2;
export const TRANSFER_FEE_MAX_MULTIPLIER = 1.6;

/** 转会费 = 身价 × 1.2~1.6，取整到 0.1M（€） */
export function computeTransferFee(value: number, rng: () => number = Math.random): number {
  const multiplier = TRANSFER_FEE_MIN_MULTIPLIER + rng() * (TRANSFER_FEE_MAX_MULTIPLIER - TRANSFER_FEE_MIN_MULTIPLIER);
  return Math.round((value * multiplier) / 100_000) * 100_000;
}

/** € 格式化："€45.0M" */
export function formatEuroM(v: number): string {
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}K`;
  return `€${v}`;
}

// ── 五大联赛后台数据推演（金球奖候选池充实）────────────────

/** 后台推演出的"虚拟赛季累计数据"（非玩家世界球员从未出赛，此处一次性生成、全奖项共用） */
export interface BackgroundSeasonStats {
  goals: number;
  assists: number;
  rating: number;
}

export interface BackgroundStarSim {
  name: string;
  club: string;
  league: string;
  position: string;
  ovr: number;
  stats: BackgroundSeasonStats;
}

/**
 * 五大联赛球星后台赛季推演：根据 OVR 动态且合理地生成赛季数据。
 * 高 OVR（88+）前锋/中场有合理概率达成 G+A≥35、评分≥8.5 的顶级表现；
 * OVR 85 左右的球星通常落在 25-35 G+A / 8.0-8.4 区间（供动态降级档使用）。
 * rng 可注入（测试确定性）。
 */
export function simulateBackgroundSeason(
  ovr: number, position: string, rng: () => number = Math.random,
): BackgroundSeasonStats {
  const ovrF = Math.max(0, (ovr - 85) / 10); // OVR 85 → 0，OVR 91 → 0.6
  const rint = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  let goals = 0;
  let assists = 0;
  if (position === "FWD") {
    goals = rint(Math.round(18 + 8 * ovrF), Math.round(27 + 9 * ovrF));
    assists = rint(4, Math.round(11 + 6 * ovrF));
  } else if (position === "MID") {
    goals = rint(Math.round(9 + 4 * ovrF), Math.round(15 + 5 * ovrF));
    assists = rint(Math.round(11 + 6 * ovrF), Math.round(20 + 8 * ovrF));
  } else if (position === "DEF") {
    goals = rint(2, 6);
    assists = rint(3, 8);
  } else {
    // GK：无进球数据，评分稳定在中高位
    return { goals: 0, assists: 0, rating: Math.min(9.0, 6.9 + ovrF * 0.5) };
  }
  const ga = goals + assists;
  const rating = Math.min(9.5, Math.max(6.8, 7.4 + ga * 0.028 + ovrF * 0.6 + (rng() - 0.5) * 0.4));
  return { goals, assists, rating };
}

/**
 * 收集五大联赛 OVR≥85 的真实球星并推演赛季数据。
 * @param skipNames 已有真实追踪数据的球员名（玩家所在世界真实出赛者），跳过不推演。
 */
export function getTopFiveBackgroundStars(
  skipNames: Set<string>,
  rng: () => number = Math.random,
): BackgroundStarSim[] {
  const out: BackgroundStarSim[] = [];
  for (const t of getAllTeams()) {
    if (!isTopFiveLeague(t.league)) continue;
    for (const p of t.players) {
      if (p.overall < 85) continue;
      if (skipNames.has(p.name)) continue;
      out.push({
        name: p.name, club: t.name, league: t.league, position: p.position, ovr: p.overall,
        stats: simulateBackgroundSeason(p.overall, p.position, rng),
      });
    }
  }
  return out;
}

// ── 事件触发阈值（生涯事件生成用，便于调参）────────────────

/** 豪门转会申请：近5场均分下限 / G+A 下限 / 身价下限 / 年龄上限 / 每场触发概率 */
export const TRANSFER_OFFER_MIN_AVG_RATING = 7.5;
export const TRANSFER_OFFER_MIN_GA = 10;
export const TRANSFER_OFFER_MIN_VALUE = 8_000_000;
export const TRANSFER_OFFER_MAX_AGE = 28;
export const TRANSFER_OFFER_CHANCE = 0.15;

/** 租借申请：低迷均分阈值 / 潜力下限 / 年龄上限 / 出场率上限（相对 currentWeek）/ 每场触发概率 */
export const LOAN_OFFER_POOR_AVG = 6.5;
export const LOAN_OFFER_MIN_POTENTIAL = 85;
export const LOAN_OFFER_MAX_AGE = 23;
export const LOAN_OFFER_APPEARANCE_RATIO = 0.4;
export const LOAN_OFFER_CHANCE = 0.25;

// ── 豪门转会目的地 ─────────────────────────────────────────

export interface EliteDestination {
  clubName: string;
  clubDbId: string;   // teamsDatabase 真实队 id
  leagueName: string; // DB 联赛名
}

/** 从豪门名单随机取一支（排除当前俱乐部） */
export function pickEliteDestination(
  currentClubName: string,
  rng: () => number = Math.random,
): EliteDestination | null {
  const candidates = getAllTeams().filter(
    (t) => isEliteClub(t.name) && t.name !== currentClubName,
  );
  if (candidates.length === 0) return null;
  const t = candidates[Math.floor(rng() * candidates.length)];
  return { clubName: t.name, clubDbId: t.id, leagueName: t.league };
}

// ── 租借目的地 ─────────────────────────────────────────────

/** 跨联赛租借池：荷甲/德乙/土超/奥甲（数据库无葡超） */
export const LOAN_LEAGUES: readonly string[] = [
  "Eredivisie",
  "Bundesliga 2",
  "Trendyol Süper Lig",
  "Ö. Bundesliga",
];

function avgOvr(players: { overall: number }[]): number {
  if (players.length === 0) return 0;
  return players.reduce((s, p) => s + p.overall, 0) / players.length;
}

/**
 * 同联赛弱队：当前世界（除当前队）中场均 OVR 最低的 3 支中随机。
 * 返回游戏内 teamId（同联赛租借立即生效，无世界重建）。
 */
export function pickSameLeagueLoanTarget(
  currentTeams: { id: string; name: string; players: { overall: number }[] }[],
  currentTeamId: string,
  rng: () => number = Math.random,
): { clubName: string; gameTeamId: string } | null {
  const weak = currentTeams
    .filter((t) => t.id !== currentTeamId)
    .sort((a, b) => avgOvr(a.players) - avgOvr(b.players))
    .slice(0, 3);
  if (weak.length === 0) return null;
  const t = weak[Math.floor(rng() * weak.length)];
  return { clubName: t.name, gameTeamId: t.id };
}

/**
 * 跨联赛弱队：LOAN_LEAGUES 每个联赛取 DB 场均 OVR 最低的 1 队组成池随机。
 * 按 RealTeamData.players 现场计算，不硬编码队名。
 */
export function pickCrossLeagueLoanTarget(
  excludeLeagueName: string,
  rng: () => number = Math.random,
): { clubName: string; clubDbId: string; leagueName: string } | null {
  const byLeague = new Map<string, RealTeamData[]>();
  for (const t of getAllTeams()) {
    if (!(LOAN_LEAGUES as readonly string[]).includes(t.league)) continue;
    if (t.league === excludeLeagueName) continue;
    const list = byLeague.get(t.league) ?? [];
    list.push(t);
    byLeague.set(t.league, list);
  }
  const pool = [...byLeague.values()]
    .map((list) => list.sort((a, b) => avgOvr(a.players) - avgOvr(b.players))[0]);
  if (pool.length === 0) return null;
  const t = pool[Math.floor(rng() * pool.length)];
  return { clubName: t.name, clubDbId: t.id, leagueName: t.league };
}
