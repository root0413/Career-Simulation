import { useEffect, useState } from "react";
import { useGameStore, type CareerMatchPerf } from "../store/useGameStore";
import type { MatchResult, EliteTransferPayload } from "../types/game";
import { formatEuroM } from "../data/careerTransfers";
import { getLeagueRankMeta } from "../utils/leagueRank";
import { CareerPitch } from "./CareerPitch";
import { EuropeanStandingsPanel } from "./EuropeanStandingsPanel";
import { MatchLogList } from "./MatchLogList";
import { RetireModal } from "./RetireModal";
import { SimulationPausedModal } from "./SimulationPausedModal";
import { UclCelebration } from "./UclCelebration";

const POS_ICONS: Record<string, string> = { GK: "🧤", DEF: "🛡️", MID: "⚽", FWD: "🎯" };

export function CareerDashboard() {
  const store = useGameStore;
  const teams = store((s) => s.teams);
  const playerTeamId = store((s) => s.playerTeamId);
  const currentWeek = store((s) => s.currentWeek);
  const standings = store((s) => s.standings);
  const seasonCalendar = store((s) => s.seasonCalendar);
  const currentMatchday = store((s) => s.currentMatchday);
  const isSeasonEnded = store((s) => s.isSeasonEnded);
  const season = store((s) => s.season);
  const seasonResult = store((s) => s.seasonResult);
  const careerPlayer = store((s) => s.careerPlayer);
  const playMatchweek = store((s) => s.playMatchweek);
  const simulateCareerPerformance = store((s) => s.simulateCareerPerformance);
  const generateAILineup = store((s) => s.generateAILineup);
  const startNewSeason = store((s) => s.startNewSeason);
  const careerEvent = store((s) => s.careerEvent);
  const seasonAwards = store((s) => s.seasonAwards);
  const isSimulating = store((s) => s.isSimulating);
  const simulationPaused = store((s) => s.simulationPaused);
  const seasonMatchLog = store((s) => s.seasonMatchLog);
  const startSeasonSimulation = store((s) => s.startSeasonSimulation);
  const dismissCareerEvent = store((s) => s.dismissCareerEvent);
  const acceptCareerEvent = store((s) => s.acceptCareerEvent);
  const simError = store((s) => s.simError);
  const dismissSimError = store((s) => s.dismissSimError);

  const [perfModal, setPerfModal] = useState<CareerMatchPerf | null>(null);
  const [matchModal, setMatchModal] = useState<{ result: MatchResult; homeName: string; awayName: string } | null>(null);
  const [lineupStatus, setLineupStatus] = useState<{ status: "starter"|"bench"|"out"; starterOVR: number } | null>(null);
  const [retireModal, setRetireModal] = useState(false);
  const [uclCelebrated, setUclCelebrated] = useState(false);
  // 新赛季奖项生成时重置欧冠庆祝状态
  useEffect(() => {
    if (!seasonAwards) setUclCelebrated(false);
  }, [seasonAwards]);

  const md = seasonCalendar?.[(currentMatchday ?? 1) - 1];
  const playerTeam = teams.find((t) => t.id === playerTeamId);
  if (!playerTeam || !careerPlayer) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">加载中...</div>;

  const cp = careerPlayer;
  const ratingColor = cp.avgRating >= 8 ? "text-yellow-400" : cp.avgRating >= 7 ? "text-emerald-400" : cp.avgRating >= 6 ? "text-amber-400" : "text-red-400";
  const isStarter = lineupStatus?.status === "starter";

  const handlePlayMatch = () => {
    if (isSeasonEnded) { alert("赛季已结束"); return; }
    const ai = generateAILineup();
    setLineupStatus(ai);
    const pt = store.getState().teams.find(t => t.id === playerTeamId);
    if (!pt || pt.starterIds.length !== 11) { const r = store.getState().generateAILineup(); if (!r || r.status==="out") return; }
    try {
      const result = playMatchweek();
      if (!result) return; // eliminated, match skipped
      const oppId = result.homeTeamId === playerTeamId ? result.awayTeamId : result.homeTeamId;
      const opp = store.getState().teams.find(t => t.id === oppId);
      setMatchModal({ result, homeName: result.homeTeamId===playerTeamId ? playerTeam.name : (opp?.name ?? "对手"), awayName: result.homeTeamId===playerTeamId ? (opp?.name ?? "对手") : playerTeam.name });
      try {
        const perf = simulateCareerPerformance(result, playerTeamId);
        setTimeout(() => { setMatchModal(null); if (perf.rating > 0) setPerfModal(perf); }, 1500);
      } catch {}
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">{playerTeam.name}</span>
          <span className="text-[10px] text-gray-600 font-mono">S{season} W{currentWeek} · 生涯</span>
        </div>
        <button onClick={() => { if (window.confirm("退出并返回主菜单？")) store.getState().returnToMainMenu(); }}
          className="text-[10px] font-bold px-3 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 cursor-pointer select-none">
          🚪 退出
        </button>
      </header>

      {/* ── 3-COLUMN LAYOUT ── */}
      <div className="flex flex-col lg:grid lg:grid-cols-12 gap-0" style={{ minHeight: "calc(100vh - 45px)" }}>

        {/* COL 1: Read-only pitch (span 5) */}
        <div className="lg:col-span-5 p-3 border-r border-gray-800 flex flex-col items-center justify-center min-h-0">
          <div className="flex items-center gap-3 w-full mb-2">
            <span className="text-[11px] text-gray-500 uppercase">🤖 AI 首发 · {playerTeam.starterIds.length}/11</span>
            {lineupStatus && (
              <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded ${isStarter ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
                {isStarter ? "⭐ 首发" : "🪑 替补"}
              </span>
            )}
          </div>
          {/* 战术板：按真实阵型槽位 + 纯函数映射（11 人全程稳定可见，模拟中绝无隐藏逻辑） */}
          <CareerPitch team={playerTeam} cpId={cp?.id ?? null} />
        </div>

        {/* COL 2: League Standings (span 3) */}
        <div className="lg:col-span-3 p-3 border-r border-gray-800 flex flex-col gap-3 lg:overflow-y-auto" style={{ maxHeight: "calc(100vh - 45px)" }}>
          <div className="rounded-xl border border-gray-800 overflow-hidden flex-1">
            <div className="bg-gray-900 px-3 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800">联赛积分榜</div>
            <div className="overflow-auto max-h-[calc(100vh-200px)]">
              <table className="w-full text-[10px] border-collapse">
                <thead className="sticky top-0 bg-gray-900/95">
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="px-1.5 py-1 text-left w-5">#</th><th className="px-1.5 py-1 text-left">球队</th><th className="px-1 py-1 text-center w-5">分</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/30">
                  {standings.map((s,i) => (
                    <tr key={s.teamId} className={s.teamId===playerTeamId ? "bg-purple-500/10 font-bold" : ""}>
                      <td className="px-1.5 py-1 text-gray-500">{i+1}</td>
                      <td className={`px-1.5 py-1 truncate max-w-[140px] ${s.teamId===playerTeamId?"text-purple-300":"text-gray-300"}`}>{teams.find(t=>t.id===s.teamId)?.name??"???"}</td>
                      <td className="px-1 py-1 text-center font-bold text-white">{s.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* COL 3: Career card + Match + Euro (span 4) */}
        <div className="lg:col-span-4 p-3 flex flex-col gap-3 lg:overflow-y-auto" style={{ maxHeight: "calc(100vh - 45px)" }}>
          {/* Career Player Card */}
          <div className="rounded-xl border border-purple-500/30 bg-gradient-to-b from-purple-900/40 to-gray-900 overflow-hidden shrink-0">
            <div className="bg-purple-500/10 px-4 py-2 border-b border-purple-500/20 flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-400 uppercase">🧑 {cp.name}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isStarter ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>{isStarter ? "首发" : "替补"}</span>
            </div>
            <div className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-purple-500/20 border-2 border-purple-500/40 flex items-center justify-center text-xl shrink-0">{POS_ICONS[cp.position]??"⚽"}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-500">{cp.nationality} · {cp.position} · {cp.age}岁</p>
                <div className="grid grid-cols-4 gap-1 mt-1.5">
                  <div><p className="text-xs font-bold text-white">{cp.overall}</p><p className="text-[8px] text-gray-600">OVR</p></div>
                  <div><p className="text-xs font-bold text-yellow-400">{cp.potential}</p><p className="text-[8px] text-gray-600">POT</p></div>
                  <div><p className="text-xs font-bold text-white">{cp.appearances}</p><p className="text-[8px] text-gray-600">出场</p></div>
                  <div><p className={`text-xs font-bold ${ratingColor}`}>{cp.avgRating||"-"}</p><p className="text-[8px] text-gray-600">均分</p></div>
                </div>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  <div><p className="text-[10px] font-bold text-white">{cp.goals}</p><p className="text-[7px] text-gray-600">进球</p></div>
                  <div><p className="text-[10px] font-bold text-white">{cp.assists}</p><p className="text-[7px] text-gray-600">助攻</p></div>
                  <div><p className="text-[10px] font-bold text-white">{cp.stamina}</p><p className="text-[7px] text-gray-600">体能</p></div>
                </div>
                {lineupStatus && (
                  <p className="text-[9px] text-gray-600 mt-1">位置门槛 OVR: {lineupStatus.starterOVR}</p>
                )}
                {/* Honours */}
                {(cp.honours?.length ?? 0) > 0 && (
                  <div className="w-full pt-1.5 mt-1 border-t border-gray-700/50">
                    <div className="flex flex-wrap gap-1">
                      {cp.honours!.map((h, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400" title={`S${h.season} ${h.award}`}>
                          {h.icon}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* 转会/租借状态提示 */}
                {cp.pendingMove && (
                  <p className="text-[9px] text-amber-400 mt-1">
                    📋 {cp.pendingMove.kind === "transfer" ? "转会" : "租借"}已达成：赛季末加盟 {cp.pendingMove.targetClub.name}（{cp.pendingMove.targetClub.leagueName}）
                  </p>
                )}
                {!cp.pendingMove && cp.loanParent && (
                  (() => {
                    const lp = cp.loanParent!;
                    const parentName = lp.kind === "game"
                      ? (teams.find(t => t.id === lp.teamId)?.name ?? "母队")
                      : lp.teamName;
                    return (
                      <p className="text-[9px] text-sky-400 mt-1">🔁 租借中 · 赛季末回归 {parentName}</p>
                    );
                  })()
                )}
                {/* 挂靴退役（二次确认弹窗防误触） */}
                {!isSimulating && (
                  <button
                    onClick={() => setRetireModal(true)}
                    className="w-full mt-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-[10px] font-bold cursor-pointer select-none transition-colors"
                  >
                    🎖️ 挂靴退役 (Retire)
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Match button */}
          <div className={`rounded-xl bg-gradient-to-br border p-3 text-center shrink-0 ${md?.type==="european"?"from-blue-900/60 to-blue-950 border-blue-700":"from-gray-800 to-gray-900 border-gray-700"}`}>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">{md?.name??"联赛"}</div>
            {/* Primary: manual simulation trigger — standby state between segments */}
            {!isSimulating && !simulationPaused && !isSeasonEnded && (
              <button onClick={() => startSeasonSimulation()}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-sm mt-1 transition-all shadow-lg cursor-pointer select-none">
                {currentMatchday > 1 || seasonMatchLog.length > 0 ? "▶ 继续模拟" : "⚡ 一键模拟赛季"}
              </button>
            )}
            {isSimulating && <p className="text-[9px] text-purple-400 text-center mt-1 animate-pulse">⚡ 模拟中...</p>}
            {simulationPaused && (
              <button onClick={() => {
                // Fallback for pause states without a modal (empty match log).
                // This IS the manual main-interface click, so it resumes directly —
                // but if a career event is pending, reveal it, never silently discard it.
                // 淘汰出局（pendingElimination）则走「确认」流转：先结算赛季，绝不续跑。
                const st = store.getState();
                if (st.pendingElimination) {
                  st.confirmSimulationPause();
                } else if (st.careerEvent) {
                  store.setState({ simulationPaused: false });
                } else {
                  store.setState({ simulationPaused: false });
                  setTimeout(() => store.getState().startSeasonSimulation(), 150);
                }
              }}
                className="w-full py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 text-sm font-semibold cursor-pointer select-none">
                ▶ 继续模拟
              </button>
            )}

            {/* Interruption summary — dedicated modal component (always has a bottom action button) */}
            <SimulationPausedModal />
            {retireModal && <RetireModal onCancel={() => setRetireModal(false)} />}

            {/* ⚠️ 一键模拟错误 Toast（阵容异常/模拟中断时明确提示，绝不静默卡死） */}
            {simError && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99] max-w-[90vw] bg-red-900/95 border border-red-500/50 rounded-xl px-4 py-3 text-red-200 text-xs flex items-center gap-3 shadow-2xl">
                <span>⚠️ {simError}</span>
                <button
                  onClick={dismissSimError}
                  className="shrink-0 text-red-300 underline cursor-pointer select-none"
                >
                  知道了
                </button>
              </div>
            )}

            {/* 🏆 欧冠冠军专属全屏庆祝动效（颁奖典礼之上） */}
            {seasonAwards?.euroFinish?.label === "冠军" && !uclCelebrated && (
              <UclCelebration
                compName={seasonAwards.euroFinish.compName}
                onDismiss={() => setUclCelebrated(true)}
              />
            )}
            {isSeasonEnded && <p className="text-sm font-bold text-yellow-400 mt-1">🏆 赛季已结束</p>}
            {/* Secondary: Single match */}
            {!isSimulating && !isSeasonEnded && (
              <button onClick={handlePlayMatch}
                className="mt-2 w-full py-1.5 rounded-lg text-gray-600 hover:text-gray-400 text-[10px] cursor-pointer select-none transition-colors">
                单场推进
              </button>
            )}
            {lineupStatus && <p className="text-[9px] text-gray-500 mt-1">🤖 AI教练已排阵 · {isStarter?"你已首发":"替补待命"}</p>}
          </div>

          {/* European standings */}
          <EuropeanStandingsPanel />
        </div>
      </div>

      {/* Match modal */}
      {matchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 w-[400px] max-w-[90vw] text-center">
            <p className="text-xs text-gray-500 mb-2">终场</p>
            <p className="text-4xl font-black text-white mb-3">{matchModal.result.homeScore} – {matchModal.result.awayScore}</p>
            <p className="text-sm text-gray-400">{matchModal.homeName} vs {matchModal.awayName}</p>
          </div>
        </div>
      )}

      {/* Perf modal */}
      {perfModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
          <div className="bg-gray-900 border border-purple-500/30 rounded-2xl p-8 w-[420px] max-w-[90vw] text-center">
            <p className="text-xs text-gray-500 mb-3">个人表现</p>
            <div className={`text-5xl font-black mb-3 ${perfModal.rating>=8?"text-yellow-400":perfModal.rating>=7?"text-emerald-400":"text-amber-400"}`}>{perfModal.rating.toFixed(1)}</div>
            <p className="text-sm text-gray-300 mb-4">{perfModal.summary}</p>
            <div className="flex justify-center gap-6 mb-4">
              <div><p className="text-2xl font-black text-white">{perfModal.goals}</p><p className="text-[10px] text-gray-500">进球</p></div>
              <div><p className="text-2xl font-black text-white">{perfModal.assists}</p><p className="text-[10px] text-gray-500">助攻</p></div>
            </div>
            {perfModal.growthGains.length>0 && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2 mb-4">
                <p className="text-xs text-emerald-400">📈 {perfModal.growthGains.join("，")}</p>
              </div>
            )}
            <button onClick={() => setPerfModal(null)} className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold cursor-pointer select-none">继续</button>
          </div>
        </div>
      )}

      {/* Career event modal */}
      {careerEvent && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70">
          <div className="bg-gray-900 border border-gray-600 rounded-2xl p-8 w-[420px] max-w-[90vw] text-center shadow-2xl">
            <div className="text-3xl mb-3">
              {careerEvent.type === "contract_renewal" ? "💰" : careerEvent.type === "transfer_offer" ? "🔄" : careerEvent.type === "transfer_rumor" ? "📰" : careerEvent.type === "loan_offer" ? "🤝" : careerEvent.type === "new_signing" ? "✍️" : careerEvent.type === "demotion_warning" ? "⚠️" : "📋"}
            </div>
            <h3 className="text-lg font-black text-white mb-2">{careerEvent.title}</h3>
            <p className="text-sm text-gray-400 mb-2">{careerEvent.body}</p>
            {/* 转会费高亮（豪门求购） */}
            {careerEvent.type === "transfer_offer" && careerEvent.payload && "fee" in careerEvent.payload && (
              <p className="text-2xl font-black text-yellow-400 mb-4">
                {formatEuroM((careerEvent.payload as EliteTransferPayload).fee)}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  try { acceptCareerEvent(); } catch {}
                }}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm cursor-pointer select-none transition-colors">
                {careerEvent.actionLabel}
              </button>
              <button
                onClick={dismissCareerEvent}
                className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 font-semibold text-sm cursor-pointer select-none transition-colors">
                {careerEvent.dismissLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Season end modal */}
      {isSeasonEnded && seasonResult && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center">
          <div className="bg-gray-900 border-2 border-yellow-500 rounded-2xl p-10 max-w-lg w-[95vw] text-center">
            <div className="animate-bounce text-6xl mb-6">🏆</div>
            <h2 className="text-2xl font-black text-white mb-2">第 {season} 赛季圆满结束！</h2>
            <p className="text-sm text-gray-400 mb-4">{cp.name} · {cp.position} · {cp.appearances}出场 · {cp.goals}球{cp.assists}助 · 均分{cp.avgRating}</p>
            <button onClick={() => { try { startNewSeason(); } catch(e) {} }} className="w-full py-4 rounded-xl bg-gradient-to-r from-yellow-600 to-amber-500 text-gray-900 font-black text-lg cursor-pointer select-none">▶ 开启新赛季</button>
            <button onClick={() => { if(window.confirm("返回主菜单？")){ localStorage.removeItem("simple-fm-game"); window.location.reload(); }}} className="mt-3 w-full py-3 rounded-xl border border-gray-700 text-gray-500 hover:text-gray-300 text-sm cursor-pointer select-none">🏠 返回主菜单</button>
          </div>
        </div>
      )}

      {/* Season summary log modal — highest z-index, appears first */}
      {seasonMatchLog.length > 0 && isSeasonEnded && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-lg w-[95vw] max-h-[80vh] overflow-y-auto">
            <div className="text-center mb-4">
              <h2 className="text-xl font-black text-white">📋 赛季复盘</h2>
              <p className="text-xs text-gray-500 mt-1">
                总进球 {seasonMatchLog.reduce((s,e)=>s+e.goals,0)} · 总助攻 {seasonMatchLog.reduce((s,e)=>s+e.assists,0)} ·
                均分 {(seasonMatchLog.reduce((s,e)=>s+e.rating,0)/Math.max(1,seasonMatchLog.filter(e=>e.rating>0).length)).toFixed(1)}
              </p>
            </div>
            <div className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
              <MatchLogList entries={seasonMatchLog} />
            </div>
            <button onClick={() => store.setState({ seasonMatchLog: [] })}
              className="mt-4 w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold text-sm cursor-pointer select-none transition-colors">
              关闭
            </button>
          </div>
        </div>
      )}

      {/* Awards ceremony modal */}
      {seasonAwards && (() => {
        // ── 赛季战绩必须读取 reset 前抓取的快照（seasonAwards.finalStandings）──
        // 活积分榜已在 startNewSeason 重置为全零，直接读会显示 0胜0平0负。
        const teamName = seasonAwards.playerClubName || "?";
        const snapshot = seasonAwards.finalStandings ?? [];
        const myStanding = snapshot.find(s => s.teamId === seasonAwards.playerClubId);
        const sortedSnap = [...snapshot].sort((a,b) => b.points - a.points);
        // 1-based 真实排名：findIndex 返回 0-based 下标，+1 转为真实排名（快照已按积分降序）
        const rank = myStanding
          ? sortedSnap.findIndex(s => s.teamId === seasonAwards.playerClubId) + 1
          : null;
        // 图标与文案绝对一致的排名映射（🥇冠军/🥈亚军/🥉季军/第4+无奖牌）
        const rankMeta = getLeagueRankMeta(rank);
        const leagueLabel = `${rankMeta.icon} ${rankMeta.text}`;
        const w = myStanding?.won ?? 0; const d = myStanding?.drawn ?? 0; const l = myStanding?.lost ?? 0;

        return (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/90">
          <div className="bg-gray-900 border border-yellow-500/40 rounded-2xl p-8 max-w-lg w-[95vw] max-h-[85vh] overflow-y-auto shadow-[0_0_40px_rgba(234,179,8,0.15)]">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3 animate-bounce">🏆</div>
              <h2 className="text-2xl font-black text-yellow-400">赛季颁奖典礼</h2>
              <p className="text-xs text-gray-500 mt-1">第 {season} 赛季 · {teamName}</p>
            </div>

            {/* ── Season Summary ── */}
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-4 mb-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">📊 赛季战绩</p>
              <div className="flex items-center justify-between">
                <span className={`text-lg font-black ${rankMeta.cls}`}>
                  {leagueLabel}
                </span>
                <span className="text-[11px] text-gray-500 font-mono">{w}胜 {d}平 {l}负 · {myStanding?.points ?? 0}分</span>
              </div>
              {/* Trophy animation for champion */}
              {rank === 1 && (
                <div className="mt-2 text-center">
                  <span className="inline-block animate-bounce text-3xl">🏆</span>
                  <p className="text-[10px] text-yellow-400 mt-1">恭喜夺得联赛冠军！</p>
                </div>
              )}
              {/* 欧战成绩（真实赛事最终名次） */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-800/60">
                <span className="text-[11px] text-gray-400 font-semibold">🌍 欧战成绩</span>
                <span className={`text-sm font-black ${seasonAwards.euroFinish ? "text-blue-300" : "text-gray-600"}`}>
                  {seasonAwards.euroFinish
                    ? `${seasonAwards.euroFinish.icon} ${seasonAwards.euroFinish.compName}${seasonAwards.euroFinish.label}`
                    : "— 未参加欧战"}
                </span>
              </div>
            </div>

            {/* ── My Season Stats（玩家生涯球员单赛季真实数据）──
                数据源 = 全赛季真实数据追踪器快照（seasonAwards.playerSeasonStats），
                与金靴/金球面板上的数字绝对一致 */}
            {seasonAwards.playerSeasonStats && (() => {
              const ps = seasonAwards.playerSeasonStats;
              const ratingColor = ps.avgRating >= 8 ? "text-yellow-400" : ps.avgRating >= 7 ? "text-emerald-400" : "text-gray-200";
              return (
                <div className="bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700 rounded-xl p-4 mb-3">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">⚽ 我的赛季数据</p>
                  <div className="grid grid-cols-4 gap-1 text-center">
                    <div>
                      <p className="text-lg font-black text-white">{ps.appearances}</p>
                      <p className="text-[9px] text-gray-500">出场</p>
                    </div>
                    <div>
                      <p className="text-lg font-black text-rose-400">{ps.goals}</p>
                      <p className="text-[9px] text-gray-500">进球</p>
                    </div>
                    <div>
                      <p className="text-lg font-black text-blue-400">{ps.assists}</p>
                      <p className="text-[9px] text-gray-500">助攻</p>
                    </div>
                    <div>
                      <p className={`text-lg font-black ${ratingColor}`}>{ps.avgRating.toFixed(1)}</p>
                      <p className="text-[9px] text-gray-500">场均评分</p>
                    </div>
                  </div>
                  {/* 同源一致性说明：与个人大奖同数据源 */}
                  {seasonAwards.goldenBoot && seasonAwards.goldenBoot.name === ps.name && (
                    <p className="text-[9px] text-amber-400 text-center mt-1.5">👟 本季金靴 · 进球数与下方奖项一致</p>
                  )}
                </div>
              );
            })()}

            {/* ── Individual Awards ── */}
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">🏅 个人大奖</p>

            {/* Golden Ball — 永不空缺（动态降级门槛保证每年必有得主） */}
            <div className={`rounded-xl p-3 mb-2 ${seasonAwards.goldenBall.name === cp.name ? "bg-yellow-500/10 border border-yellow-500/30" : "bg-gray-800"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-yellow-400 font-semibold">🏆 金球奖</p>
                  <p className="text-sm font-black text-white">{seasonAwards.goldenBall.name}</p>
                  <p className="text-[9px] text-gray-500">{seasonAwards.goldenBall.goals} 球 · {seasonAwards.goldenBall.assists} 助</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-yellow-400 font-mono">{seasonAwards.goldenBall.goals + seasonAwards.goldenBall.assists} <span className="text-[9px] text-gray-500 font-normal">G+A</span></p>
                  <p className="text-[10px] text-yellow-400/80 font-mono">评分 {seasonAwards.goldenBall.rating.toFixed(1)}</p>
                </div>
              </div>
            </div>

            {/* Golden Boot + League Best（真实数据，可能空缺） */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-gray-800 rounded-xl p-3">
                <p className="text-[10px] text-gray-500">👟 金靴奖</p>
                {seasonAwards.goldenBoot ? (
                  <>
                    <p className="text-sm font-black text-white truncate">{seasonAwards.goldenBoot.name}</p>
                    <p className="text-[10px] text-gray-500">{seasonAwards.goldenBoot.goals} 球</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-black text-gray-500">空缺</p>
                    <p className="text-[10px] text-gray-600">本赛季无进球记录</p>
                  </>
                )}
              </div>
              <div className="bg-gray-800 rounded-xl p-3">
                <p className="text-[10px] text-gray-500">⭐ 联赛最佳</p>
                {seasonAwards.leagueBest ? (
                  <>
                    <p className="text-sm font-black text-white truncate">{seasonAwards.leagueBest.name}</p>
                    <p className="text-[10px] text-gray-500">{seasonAwards.leagueBest.club}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-black text-gray-500">空缺</p>
                    <p className="text-[10px] text-gray-600">本赛季无比赛记录</p>
                  </>
                )}
              </div>
            </div>

            {/* ── TOTS — strict 4-3-3 formation layout ── */}
            <div className="bg-gray-800 rounded-xl p-3 mb-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">🌟 赛季最佳阵容 · 4-3-3</p>
              {(() => {
                const tile = (t: typeof seasonAwards.teamOfSeason[number], key: number) => (
                  <div key={key} className={`w-[64px] text-[9px] px-1 py-1 rounded text-center ${t.name === cp.name ? "bg-purple-500/20 text-purple-300 font-bold ring-1 ring-purple-500/30" : "text-gray-400"}`}>
                    <p className="text-[7px] text-gray-600 font-mono">{t.slot ?? t.position}</p>
                    <p className="truncate">{t.name.split(" ").pop()}</p>
                  </div>
                );
                const tots = seasonAwards.teamOfSeason;
                return (
                  <div className="flex flex-col gap-1 items-center">
                    {/* FW: LW · ST · RW */}
                    <div className="flex gap-1 justify-center">{tots.slice(8, 11).map((t, i) => tile(t, i))}</div>
                    {/* MF: CDM · CM · CAM */}
                    <div className="flex gap-1 justify-center">{tots.slice(5, 8).map((t, i) => tile(t, i))}</div>
                    {/* DF: LB · CB · CB · RB */}
                    <div className="flex gap-1 justify-center">{tots.slice(1, 5).map((t, i) => tile(t, i))}</div>
                    {/* GK */}
                    <div className="flex gap-1 justify-center">{tots.slice(0, 1).map((t, i) => tile(t, i))}</div>
                  </div>
                );
              })()}
            </div>

            {/* Player's own awards */}
            {seasonAwards.playerWon.length > 0 && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 mb-3 text-center animate-pulse">
                <p className="text-[10px] text-purple-400 uppercase tracking-wider mb-1">🎉 你的荣誉</p>
                <p className="text-sm font-bold text-purple-300">{seasonAwards.playerWon.join(" · ")}</p>
              </div>
            )}

            <button onClick={() => store.setState({ seasonAwards: null })}
              className="w-full py-3 rounded-xl bg-yellow-600 hover:bg-yellow-500 text-gray-900 font-black text-sm cursor-pointer select-none transition-colors">
              太棒了！
            </button>
          </div>
        </div>
        );
      })()}

    </div>
  );
}
