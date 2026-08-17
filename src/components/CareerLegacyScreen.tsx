import { useGameStore } from "../store/useGameStore";

/**
 * 🎖️ 生涯荣誉总结页（挂靴谢幕）——通关画面。
 * 所有数据来自退役时构建的 careerLegacy（真实生涯累计 + 赛季结算奖杯/荣誉记录），
 * 绝不现场编造。撒花特效为纯 CSS 动画。
 */

const CONFETTI = ["🎉", "✨", "🏆", "⭐", "🎊", "🥇", "👏", "💫"];

function formatMoney(v: number): string {
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}K`;
  return `€${v}`;
}

function ConfettiRain() {
  const pieces = Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100,
    delay: (i * 0.35) % 4,
    duration: 3.5 + ((i * 0.7) % 3),
    emoji: CONFETTI[i % CONFETTI.length],
  }));
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute text-xl"
          style={{
            left: `${p.left}%`,
            top: "-8%",
            animation: `confetti-fall ${p.duration}s linear ${p.delay}s infinite`,
          }}
        >
          {p.emoji}
        </span>
      ))}
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export function CareerLegacyScreen() {
  const store = useGameStore;
  const legacy = store((s) => s.careerLegacy);
  const careerPlayer = store((s) => s.careerPlayer);
  const returnToMainMenu = store((s) => s.returnToMainMenu);

  if (!legacy) return null;

  const { totals, trophies, honours, rating } = legacy;

  return (
    <div className="min-h-screen bg-gray-950 relative overflow-hidden">
      <ConfettiRain />

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-14 flex flex-col items-center">
        {/* ── 谢幕标题 ── */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4 animate-bounce">🎖️</div>
          <h1 className="text-3xl font-black text-white">传奇谢幕</h1>
          <p className="text-sm text-gray-400 mt-2">
            {careerPlayer?.name ?? "?"} · {careerPlayer?.nationality ?? ""} · {careerPlayer?.position ?? ""}
          </p>
        </div>

        {/* ── 生涯最终评价 ── */}
        <div className="w-full bg-gradient-to-r from-yellow-500/15 via-amber-500/10 to-yellow-500/15 border border-yellow-500/40 rounded-2xl p-6 mb-6 text-center shadow-[0_0_40px_rgba(234,179,8,0.2)]">
          <div className="text-5xl mb-2">{rating.icon}</div>
          <h2 className="text-2xl font-black text-yellow-400">{rating.tier}</h2>
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">{rating.message}</p>
        </div>

        {/* ── 生涯总数据汇总 ── */}
        <div className="w-full bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-6">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">📊 生涯总数据</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-2xl font-black text-white">{totals.appearances}</p>
              <p className="text-[9px] text-gray-500">总出场</p>
            </div>
            <div>
              <p className="text-2xl font-black text-rose-400">{totals.goals}</p>
              <p className="text-[9px] text-gray-500">总进球</p>
            </div>
            <div>
              <p className="text-2xl font-black text-blue-400">{totals.assists}</p>
              <p className="text-[9px] text-gray-500">总助攻</p>
            </div>
            <div>
              <p className="text-2xl font-black text-emerald-400">{totals.avgRating.toFixed(1)}</p>
              <p className="text-[9px] text-gray-500">生涯均分</p>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 text-center mt-3">效力 {totals.seasons} 个赛季</p>
        </div>

        {/* ── 生涯峰值 ── */}
        <div className="w-full bg-gray-900 border border-amber-500/20 rounded-2xl p-5 mb-6">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">📈 生涯峰值</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-black text-yellow-400">{legacy.peaks.highestOVR}</p>
              <p className="text-[9px] text-gray-500">最高 OVR</p>
            </div>
            <div>
              <p className="text-xl font-black text-yellow-400">{formatMoney(legacy.peaks.peakValue)}</p>
              <p className="text-[9px] text-gray-500">身价巅峰</p>
            </div>
            <div>
              <p className="text-xl font-black text-rose-400">
                {legacy.peaks.bestSeasonGoals}
                {legacy.peaks.bestSeasonGoalsSeason !== null && (
                  <span className="text-[10px] text-gray-500 font-normal"> (S{legacy.peaks.bestSeasonGoalsSeason})</span>
                )}
              </p>
              <p className="text-[9px] text-gray-500">单赛季进球纪录</p>
            </div>
          </div>
        </div>

        {/* ── 赛季生涯时间轴 / 逐年效力回顾 ── */}
        {legacy.seasons.length > 0 && (
          <div className="w-full bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-6">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">🗓️ 赛季生涯时间轴</p>
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
              {[...legacy.seasons].sort((a, b) => a.season - b.season).map((s, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded bg-gray-800/50 text-[11px]">
                  <span className="text-gray-500 font-mono shrink-0 w-8">S{s.season}</span>
                  <span className="text-white font-bold shrink-0 w-28 truncate">{s.clubName}</span>
                  <span className={`shrink-0 w-20 ${s.leagueRank === 1 ? "text-yellow-400 font-black" : "text-gray-400"}`}>
                    {s.leagueRank !== null ? `联赛第 ${s.leagueRank}` : "联赛 —"}
                  </span>
                  <span className={`flex-1 truncate ${s.euroFinishLabel?.includes("冠军") ? "text-yellow-400 font-semibold" : "text-gray-500"}`}>
                    {s.euroFinishLabel ?? "未参加欧战"}
                  </span>
                  <span className="text-gray-500 font-mono shrink-0 text-right">
                    {s.apps}场 {s.goals}球{s.assists}助 · {s.avgRating.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 团队冠军墙 ── */}
        <div className="w-full bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-6">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">🏟️ 团队冠军墙</p>
          {trophies.length > 0 ? (
            <div className="flex flex-wrap gap-2 justify-center">
              {trophies.map((t, i) => (
                <span key={i} className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-bold">
                  {t.icon} {t.label} <span className="font-black text-yellow-300">×{t.count}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600 text-center py-2">尚无团队奖杯 — 遗憾与荣耀共同构成职业生涯</p>
          )}
        </div>

        {/* ── 个人荣誉室 ── */}
        <div className="w-full bg-gray-900 border border-gray-700 rounded-2xl p-5 mb-8">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">🏅 个人荣誉室</p>
          {honours.length > 0 ? (
            <div className="flex flex-wrap gap-2 justify-center">
              {honours.map((h, i) => (
                <span key={i} className="px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-300 text-sm font-bold">
                  {h.icon} {h.label} <span className="font-black text-purple-200">×{h.count}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600 text-center py-2">尚无个人荣誉 — 绿茵场上从不缺少后来者</p>
          )}
        </div>

        {/* ── 返回主菜单 ── */}
        <button
          onClick={() => { try { returnToMainMenu(); } catch { /* ok */ } }}
          className="w-full max-w-sm py-4 rounded-xl bg-gradient-to-r from-gray-800 to-gray-700 hover:from-gray-700 hover:to-gray-600 text-white font-bold text-sm cursor-pointer select-none transition-all shadow-lg"
        >
          🏠 返回主菜单
        </button>
        <p className="text-[10px] text-gray-600 text-center mt-3">感谢你为这座球场付出的一切 ⚽</p>
      </div>
    </div>
  );
}
