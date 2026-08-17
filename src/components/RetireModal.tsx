import { useGameStore } from "../store/useGameStore";

/**
 * 🚨 挂靴退役二次确认弹窗——严防误触：
 * 只有点击「确认退役」才会真正结束职业生涯（retirePlayer → 谢幕页）。
 */
export function RetireModal({ onCancel }: { onCancel: () => void }) {
  const store = useGameStore;
  const careerPlayer = store((s) => s.careerPlayer);
  const retirePlayer = store((s) => s.retirePlayer);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-4">
      <div className="bg-gray-900 border-2 border-red-500/40 rounded-2xl p-8 w-[420px] max-w-[90vw] text-center shadow-[0_0_40px_rgba(239,68,68,0.25)]">
        <div className="text-4xl mb-3">🚨</div>
        <h3 className="text-lg font-black text-white mb-2">挂靴退役</h3>
        <p className="text-sm text-gray-400 mb-1">你确定要结束伟大的职业生涯吗？</p>
        <p className="text-sm text-gray-400 mb-6">此操作不可逆，退役后将进入最终荣誉结算。</p>
        <p className="text-[11px] text-gray-600 mb-6">（{careerPlayer?.name ?? "?"} · 生涯数据与荣誉将被永久封存）</p>
        <div className="flex gap-3">
          <button
            onClick={() => { try { retirePlayer(); } catch { /* ok */ } }}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm cursor-pointer select-none transition-colors"
          >
            🎖️ 确认退役
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 font-semibold text-sm cursor-pointer select-none transition-colors"
          >
            再踢几年
          </button>
        </div>
      </div>
    </div>
  );
}
