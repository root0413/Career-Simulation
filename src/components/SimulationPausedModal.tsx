import { useGameStore } from "../store/useGameStore";
import { MatchLogList } from "./MatchLogList";

/**
 * ⏸️ Simulation interruption modal — shown when the one-click season simulation
 * pauses (career event pending, or the league phase just ended).
 *
 * List display rules:
 *   - ONLY the current simulation segment is rendered (slice from
 *     `simulationSegmentStart`): at the league→European crossover, league
 *     records are never mixed into a European-only report.
 *   - Matches are grouped by phase with explicit headers (联赛 / 欧战),
 *     each row carries a semantic label like "联赛第 29 轮" or
 *     "欧冠 1/8 决赛 首回合" — the old ambiguous "R1/R2" tags are gone.
 *
 * Layout guarantees the bottom action button is ALWAYS visible:
 *   - outer container capped at max-h-[80vh] with flex-col
 *   - header and footer are shrink-0
 *   - only the match list scrolls internally (flex-1 min-h-0 overflow-y-auto)
 */
export function SimulationPausedModal() {
  const store = useGameStore;
  const simulationPaused = store((s) => s.simulationPaused);
  const seasonMatchLog = store((s) => s.seasonMatchLog);
  const simulationSegmentStart = store((s) => s.simulationSegmentStart);
  const careerEvent = store((s) => s.careerEvent);
  const pendingElimination = store((s) => s.pendingElimination);
  const confirmSimulationPause = store((s) => s.confirmSimulationPause);

  // 当前汇报周期 = 本段模拟的记录（与之前赛段彻底隔离）
  const segStart = Number.isFinite(simulationSegmentStart) ? Math.max(0, simulationSegmentStart) : 0;
  const segment = seasonMatchLog.slice(Math.min(segStart, seasonMatchLog.length));

  if (!simulationPaused || segment.length === 0) return null;

  const handleConfirm = () => {
    // "确认" ONLY closes this modal and stops the simulation state.
    // It must NEVER auto-resume — the player manually clicks the main
    // "继续模拟" button to start the next simulation segment.
    // 唯一例外：淘汰出局汇报（pendingElimination）——确认后系统才结算赛季。
    confirmSimulationPause();
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-900 border border-amber-500/30 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        {/* ── Header (fixed) ── */}
        <div className="px-6 pt-6 pb-3 shrink-0">
          <div className="text-center">
            <p className="text-lg font-black text-amber-400">⏸️ 模拟已暂停</p>
            <p className="text-[10px] text-gray-500 mt-1">本段模拟结果 ({segment.length} 场)</p>
          </div>
        </div>

        {/* ── Match list (internal scroll — never pushes the footer out) ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
          <MatchLogList entries={segment} />
        </div>

        {/* ── Footer (fixed) — the mandatory primary action button ── */}
        <div className="px-6 pb-6 pt-3 border-t border-gray-800 shrink-0 bg-gray-900">
          <button
            onClick={handleConfirm}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-gray-900 font-black text-sm cursor-pointer select-none transition-all shadow-lg"
          >
            ✅ 确认
          </button>
          <p className="text-[10px] text-gray-600 text-center mt-2">
            {pendingElimination
              ? "❌ 欧战出局 — 确认后将进行赛季结算"
              : careerEvent
                ? "有事件等待处理"
                : "模拟已停止 — 点击主界面「继续模拟」开始下一段"}
          </p>
        </div>
      </div>
    </div>
  );
}
