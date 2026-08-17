import type { CareerPlayer, CareerSeasonRecord } from "../types/game";

/**
 * 生涯荣誉总结（退役谢幕页数据）——纯函数构建，绝不现场编造数据：
 * 所有数字来自 careerPlayer 的生涯累计统计 + 赛季结算时记录的 careerTrophies/honours。
 */

export interface CareerLegacy {
  totals: {
    seasons: number; // 效力赛季数（由奖杯/荣誉的最晚赛季近似 = 当前赛季）
    appearances: number;
    goals: number;
    assists: number;
    avgRating: number;
  };
  /** 赛季生涯时间轴（逐年效力回顾） */
  seasons: CareerSeasonRecord[];
  /** 生涯峰值 */
  peaks: {
    highestOVR: number;
    peakValue: number;
    bestSeasonGoals: number;
    bestSeasonGoalsSeason: number | null;
  };
  /** 团队冠军墙（分组计数） */
  trophies: { label: string; icon: string; count: number }[];
  /** 个人荣誉室（分组计数） */
  honours: { label: string; icon: string; count: number }[];
  /** 生涯最终评价（传奇评级） */
  rating: { tier: string; icon: string; message: string };
}

/** 奖杯/荣誉的展示顺序与图标 */
const TROPHY_ORDER: { key: string; label: string; icon: string }[] = [
  { key: "联赛冠军", label: "联赛冠军", icon: "🏆" },
  { key: "欧冠冠军", label: "欧冠冠军", icon: "🏆" },
  { key: "欧联冠军", label: "欧联冠军", icon: "🥇" },
  { key: "欧协联冠军", label: "欧协联冠军", icon: "🥇" },
];

const HONOUR_ORDER: { key: string; label: string; icon: string }[] = [
  { key: "金球奖", label: "金球奖", icon: "🏆" },
  { key: "金靴奖", label: "金靴奖", icon: "👟" },
  { key: "联赛最佳球员", label: "联赛最佳球员", icon: "⭐" },
  { key: "最佳阵容", label: "最佳阵容", icon: "🌟" },
];

/** 传奇评级分档（综合权重评分） */
const RATING_TIERS: { min: number; tier: string; icon: string; message: string }[] = [
  { min: 150, tier: "GOAT 历史最佳", icon: "🐐", message: "你重新定义了这项运动。整个足坛为你让路，你的名字将与这项运动永存。" },
  { min: 100, tier: "时代球王", icon: "👑", message: "一个时代只配得上一个球王——而你，就是这个时代的答案。" },
  { min: 60, tier: "世界级传奇巨星", icon: "🌟", message: "世界足坛的传奇行列里有你的位置，你的高光时刻将被永远铭记。" },
  { min: 25, tier: "一流球星", icon: "⭐", message: "你是一位值得尊敬的顶级职业球员，绿茵场上留下了你的足迹。" },
  { min: 0, tier: "平凡的职业生涯", icon: "⚽", message: "你为热爱奔跑过每一场比赛——平凡的坚守，同样值得掌声。" },
];

function buildCareerLegacyScore(cp: CareerPlayer, counts: Record<string, number>): number {
  const ballon = counts["金球奖"] ?? 0;
  const boot = counts["金靴奖"] ?? 0;
  const best = counts["联赛最佳球员"] ?? 0;
  const tots = counts["最佳阵容"] ?? 0;
  const league = counts["联赛冠军"] ?? 0;
  const ucl = counts["欧冠冠军"] ?? 0;
  const uel = counts["欧联冠军"] ?? 0;
  const uecl = counts["欧协联冠军"] ?? 0;
  return (
    cp.goals * 0.15 + cp.assists * 0.10 + cp.appearances * 0.02
    + ballon * 25 + boot * 8 + best * 6 + tots * 3
    + league * 10 + ucl * 18 + uel * 10 + uecl * 6
  );
}

/** 构建生涯荣誉总结（退役时调用一次并持久化展示） */
export function buildCareerLegacy(cp: CareerPlayer, careerSeason: number): CareerLegacy {
  // ── 团队冠军墙（分组计数，按固定顺序）──
  const trophyCounts = new Map<string, number>();
  for (const t of cp.careerTrophies ?? []) {
    trophyCounts.set(t.name, (trophyCounts.get(t.name) ?? 0) + 1);
  }
  const trophies = TROPHY_ORDER
    .filter((o) => (trophyCounts.get(o.key) ?? 0) > 0)
    .map((o) => ({ label: o.label, icon: o.icon, count: trophyCounts.get(o.key)! }));

  // ── 个人荣誉室（分组计数，按固定顺序）──
  const honourCounts = new Map<string, number>();
  for (const h of cp.honours ?? []) {
    honourCounts.set(h.award, (honourCounts.get(h.award) ?? 0) + 1);
  }
  const honours = HONOUR_ORDER
    .filter((o) => (honourCounts.get(o.key) ?? 0) > 0)
    .map((o) => ({ label: o.label, icon: o.icon, count: honourCounts.get(o.key)! }));

  // ── 生涯最终评价（奖杯 + 个人荣誉合并计数参与评分）──
  const allCounts: Record<string, number> = {};
  for (const [k, v] of trophyCounts) allCounts[k] = v;
  for (const [k, v] of honourCounts) allCounts[k] = v;
  const score = buildCareerLegacyScore(cp, allCounts);
  const rating = RATING_TIERS.find((t) => score >= t.min)!;

  // ── 生涯峰值（来自逐年记录；旧存档无记录时以生涯累计兜底）──
  const seasons = cp.careerSeasons ?? [];
  const bestGoalSeason = seasons.reduce<CareerSeasonRecord | null>(
    (best, s) => (s.goals > (best?.goals ?? -1) ? s : best), null,
  );
  const peaks = {
    highestOVR: Math.max(cp.overall, ...seasons.map((s) => s.ovr)),
    peakValue: Math.max(cp.value, ...seasons.map((s) => s.value)),
    bestSeasonGoals: Math.max(0, ...seasons.map((s) => s.goals)),
    bestSeasonGoalsSeason: bestGoalSeason?.season ?? null,
  };

  return {
    totals: {
      seasons: careerSeason,
      appearances: cp.appearances,
      goals: cp.goals,
      assists: cp.assists,
      avgRating: cp.avgRating,
    },
    seasons,
    peaks,
    trophies,
    honours,
    rating,
  };
}
