/**
 * 🏆 欧冠冠军专属全屏庆祝动效——捧杯仪式感拉满：
 * 奖杯升空弹跳 + 金色光束 + 彩带雨 + 冠军文案，玩家点击「捧杯时刻」后进入颁奖典礼。
 */
export function UclCelebration({ compName, onDismiss }: { compName: string; onDismiss: () => void }) {
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    left: (i * 43) % 100,
    delay: (i * 0.3) % 3,
    duration: 3 + ((i * 0.6) % 2.5),
    emoji: ["🎉", "✨", "🏆", "⭐", "🎊", "🥇", "💛"][i % 7],
  }));

  return (
    <div className="fixed inset-0 z-[98] bg-black/95 flex items-center justify-center overflow-hidden">
      {/* 金色光束背景 */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(234,179,8,0.25)_0%,transparent_60%)] pointer-events-none" />

      {/* 彩带雨 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {pieces.map((p, i) => (
          <span
            key={i}
            className="absolute text-2xl"
            style={{
              left: `${p.left}%`,
              top: "-10%",
              animation: `ucl-confetti ${p.duration}s linear ${p.delay}s infinite`,
            }}
          >
            {p.emoji}
          </span>
        ))}
        <style>{`
          @keyframes ucl-confetti {
            0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(115vh) rotate(360deg); opacity: 0; }
          }
        `}</style>
      </div>

      <div className="relative z-10 text-center px-6">
        {/* 大耳朵杯升空 */}
        <div className="text-8xl mb-6" style={{ animation: "ucl-trophy 1.6s cubic-bezier(0.22,1,0.36,1) 0.2s both" }}>
          🏆
        </div>
        <style>{`
          @keyframes ucl-trophy {
            0% { transform: translateY(80px) scale(0.4); opacity: 0; }
            60% { transform: translateY(-14px) scale(1.15); opacity: 1; }
            100% { transform: translateY(0) scale(1); opacity: 1; }
          }
        `}</style>

        <h1 className="text-4xl font-black text-yellow-400 mb-2 drop-shadow-[0_0_25px_rgba(234,179,8,0.6)]">
          {compName}冠军！
        </h1>
        <p className="text-sm text-gray-300 mb-2">你们征服了欧洲之巅，把大耳朵杯带回了家！</p>
        <p className="text-xs text-gray-500 mb-8">⚽ 这一夜，整个足球世界都在为你欢呼</p>

        <button
          onClick={onDismiss}
          className="px-10 py-4 rounded-xl bg-gradient-to-r from-yellow-600 to-amber-500 hover:from-yellow-500 hover:to-amber-400 text-gray-900 font-black text-base cursor-pointer select-none transition-all shadow-[0_0_30px_rgba(234,179,8,0.4)] animate-pulse"
        >
          🏆 捧杯时刻
        </button>
      </div>
    </div>
  );
}
