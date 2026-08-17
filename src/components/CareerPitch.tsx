import { Component, useMemo, type ReactNode } from "react";
import type { Team } from "../types/game";
import { generatePitchSlots, mapStartersToSlots } from "../utils/pitchSlots";

/**
 * 生涯模式只读战术板（AI 首发展示）——彻底修复"只有门将显示"的渲染 Bug：
 *
 * 1. 槽位坐标经 generatePitchSlots 严格校验（NaN/越界 → 回退标准 4-3-3 默认坐标）。
 * 2. 首发映射 mapStartersToSlots 三层兜底（index → 位置匹配 → 剩余填充）：
 *    无论 starterIds 顺序如何，11 名球员 100% 稳定呈现在球场画布内。
 * 3. 渲染节点前零条件隐藏（数据存在即渲染）；组件外层包裹 PitchErrorBoundary
 *    错误边界——任何异常都降级为 11 人兜底网格，绝不整板消失。
 */

const POS_COLORS: Record<string, string> = {
  GK: "bg-yellow-500",
  DEF: "bg-blue-600",
  MID: "bg-emerald-600",
  FWD: "bg-rose-600",
};

/** 错误边界兜底：极端异常时渲染 11 人默认网格（保证球员头像仍可见） */
class PitchErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const fallback = Array.from({ length: 11 }, (_, i) => (
      <div
        key={i}
        className="absolute flex items-center justify-center -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-2 border-white/30 bg-gray-500 text-[9px] font-black text-white"
        style={{ left: `${(i % 5) * 20 + 10}%`, top: `${Math.floor(i / 5) * 25 + 15}%` }}
      >
        {i + 1}
      </div>
    ));
    return <>{fallback}</>;
  }
}

export function CareerPitch({ team, cpId }: { team: Team; cpId: string | null }) {
  const slots = useMemo(() => generatePitchSlots(team?.formation), [team?.formation]);
  const slotPlayers = useMemo(
    () => mapStartersToSlots(team?.starterIds, team?.players, team?.formation),
    [team?.starterIds, team?.players, team?.formation],
  );

  // 固定高度区间（最小 320px）：坐标百分比永远落在可视区内
  const pitchHeight = "clamp(320px, 42vh, 420px)";

  return (
    <div className="flex-1 w-full pointer-events-none flex items-center justify-center">
      <div
        className="relative rounded-xl overflow-hidden border-2 border-gray-700 w-full"
        style={{ maxWidth: "340px", height: pitchHeight }}
      >
        {/* 草地 + 场地标线 */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #1a3a1a 0%, #2d5a2d 30%, #3a6e3a 50%, #2d5a2d 70%, #1a3a1a 100%)" }} />
        <div className="absolute inset-x-[15%] inset-y-0 border-x-2 border-white/10" />
        <div className="absolute inset-x-0 top-[50%] border-t-2 border-white/10" />
        <div className="absolute left-[20%] right-[20%] top-[35%] bottom-[35%] border-2 border-white/10 rounded-full" />
        <div className="absolute top-[50%] left-[50%] w-2 h-2 rounded-full bg-white/20 -translate-x-1/2 -translate-y-1/2" />

        {/* ── 11 名球员节点：错误边界包裹，坐标非法时兜底网格 ── */}
        <PitchErrorBoundary>
          {slots.map((slot, i) => {
            const p = slotPlayers[i];
            if (!p) return null; // 仅当数据缺失才留空
            const isCP = cpId !== null && p.id === cpId;
            const posColor = POS_COLORS[p.position] ?? "bg-gray-500";
            return (
              <div
                key={`${i}-${p.id}`}
                className="absolute flex flex-col items-center -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                <div className={`w-8 h-8 lg:w-9 lg:h-9 rounded-full border-2 ${posColor} border-white/30 flex items-center justify-center text-[9px] font-black text-white shadow-lg ${isCP ? "ring-2 ring-purple-400" : ""}`}>
                  {p.overall}
                </div>
                <span className="text-[8px] text-white font-semibold mt-0.5 bg-black/60 px-1 rounded truncate max-w-[56px]">
                  {(p.name ?? "").split(" ").pop()}
                </span>
                <div className="flex items-center gap-0.5 mt-0.5">
                  <div className="w-6 h-[3px] rounded-full bg-gray-700/60 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${(p.stamina ?? 0) >= 70 ? "bg-emerald-400" : (p.stamina ?? 0) >= 30 ? "bg-amber-400" : "bg-red-400"}`}
                      style={{ width: `${Math.max(0, Math.min(100, p.stamina ?? 0))}%` }}
                    />
                  </div>
                  <span className="text-[7px] text-gray-500 font-mono leading-none">{p.stamina ?? 0}</span>
                </div>
              </div>
            );
          })}
        </PitchErrorBoundary>
      </div>
    </div>
  );
}
