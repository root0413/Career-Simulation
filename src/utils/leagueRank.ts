/**
 * 联赛排名文案/图标映射（颁奖典礼「赛季战绩」模块）——图标与文案绝对一致：
 *   第 1 名 → 🥇 联赛冠军（金牌/1）
 *   第 2 名 → 🥈 联赛亚军（银牌/2）
 *   第 3 名 → 🥉 联赛季军（铜牌/3）
 *   第 4 名及以后 → ⚽ 联赛第 X 名（常规图标，不带奖牌）
 *
 * 曾修复：旧的 `rank <= 3 ? "🥈 联赛季军"` 把第 2、3 名都渲染成
 * 「银牌(2) + 季军」——排名 3 的文案匹配了排名 2 的图标（差一错误 + 映射缺失）。
 */

export interface LeagueRankMeta {
  icon: string;
  text: string;
  cls: string;        // 文字颜色
  rank: number | null; // 1-based 真实排名；null = 排名未知（快照缺失）
}

export function getLeagueRankMeta(rank: number | null): LeagueRankMeta {
  if (rank === 1) return { icon: "🥇", text: "联赛冠军", cls: "text-yellow-400", rank };
  if (rank === 2) return { icon: "🥈", text: "联赛亚军", cls: "text-slate-300", rank };
  if (rank === 3) return { icon: "🥉", text: "联赛季军", cls: "text-amber-500", rank };
  if (rank !== null && Number.isFinite(rank) && rank >= 4) {
    return { icon: "⚽", text: `联赛第 ${rank} 名`, cls: "text-gray-400", rank };
  }
  return { icon: "⚽", text: "联赛排名未知", cls: "text-gray-500", rank: null };
}
