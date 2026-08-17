import type { CareerMatchLogEntry } from "../types/game";
import { COMPETITION_NAMES, groupMatchLogEntries } from "../utils/matchLog";

/**
 * 比赛记录列表（分组版）— 供暂停汇报弹窗与赛季复盘共用。
 *
 * - 按赛段分组：连续相同 phase 的记录归入一组，用分组 Header 明确隔开
 *   「🏟️ 本土联赛」与「🏆 欧战 · 欧冠」，联赛/欧战绝不混排。
 * - 每行左侧为语义化轮次标签（如 "联赛第 29 轮" / "欧冠 1/8 决赛 首回合"），
 *   固定列宽不挤压；右侧 G/A/评分采用等宽占位，所有行严格对齐。
 */

function rowBackground(e: CareerMatchLogEntry): string {
  if (e.injured) return "bg-red-500/10";
  if (e.rating > 7.5) return "bg-emerald-500/5";
  if (e.rating > 0) return "bg-gray-800/50";
  return "bg-gray-800/20";
}

function ratingColor(r: number): string {
  if (r >= 8) return "text-yellow-400";
  if (r >= 7) return "text-emerald-400";
  return "text-gray-400";
}

export function MatchLogList({ entries }: { entries: CareerMatchLogEntry[] }) {
  if (entries.length === 0) return null;

  const groups = groupMatchLogEntries(entries);

  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {/* ── 赛段分组 Header ── */}
          <div className="mt-2 mb-0.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/60 first:mt-0">
            <span className="text-[11px]">{g.phase === "european" ? "🏆" : "🏟️"}</span>
            <span className={`text-[11px] font-bold ${g.phase === "european" ? "text-purple-300" : "text-sky-300"}`}>
              {g.phase === "european"
                ? `欧战 · ${g.competition && g.competition !== "NONE" ? COMPETITION_NAMES[g.competition] : "欧战"}`
                : "本土联赛"}
            </span>
            <span className="ml-auto text-[10px] text-gray-500">{g.entries.length} 场</span>
          </div>

          {g.entries.map((e, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] ${rowBackground(e)}`}
            >
              {/* 语义化轮次标签 — 固定列宽，绝不挤压/截断 */}
              <span
                className={`w-28 shrink-0 text-[10px] font-semibold ${
                  e.phase === "european" ? "text-purple-400" : "text-sky-400"
                }`}
              >
                {e.label}
              </span>
              <span className="flex-1 truncate text-gray-400">{e.opponent}</span>
              {/* 比分列 — 加宽以容纳点球大战拼接，如 "0-0 平 (点球 3-4 负)" */}
              <span className="w-30 shrink-0 text-right font-mono text-white text-[10px]">{e.result}</span>
              {/* 右侧统计区 — 固定总宽度，保证伤缺/未出场行与其他行严格对齐 */}
              {e.injured ? (
                <span className="w-[88px] shrink-0 text-center text-red-400 text-[10px] font-semibold">🩹伤缺</span>
              ) : e.rating > 0 ? (
                <span className="w-[88px] shrink-0 flex items-center justify-end gap-1 font-mono text-[10px]">
                  <span className="w-6 text-center text-rose-400">{e.goals > 0 ? `${e.goals}G` : "-"}</span>
                  <span className="w-6 text-center text-blue-400">{e.assists > 0 ? `${e.assists}A` : "-"}</span>
                  <span className={`w-8 text-right font-bold ${ratingColor(e.rating)}`}>{e.rating.toFixed(1)}</span>
                </span>
              ) : (
                <span className="w-[88px] shrink-0 text-center text-gray-600 text-[10px]">未出场</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
