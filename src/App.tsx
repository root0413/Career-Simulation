import { useState, useMemo } from "react";
import { useGameStore } from "./store/useGameStore";
import { Position, type Player, type Team, type LeagueStandings, type MatchResult, type Formation, type Tactic } from "./types/game";
import { TacticsPanel } from "./components/TacticsPanel";
import { LineupPitch } from "./components/LineupPitch";
import { TeamSelection } from "./components/TeamSelection";
import { CreatePlayerModal } from "./components/CreatePlayerModal";
import { SelectClubView } from "./components/SelectClubView";
import { CareerDashboard } from "./components/CareerDashboard";
import { CareerLegacyScreen } from "./components/CareerLegacyScreen";
import { EuropeanStandingsPanel } from "./components/EuropeanStandingsPanel";

type View = "squad" | "transfer";
type SquadTab = "first" | "u21" | "u18";

// ── Helpers ─────────────────────────────────────────────────

const POSITION_STYLE: Record<Position, string> = {
  [Position.GK]:  "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  [Position.DEF]: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  [Position.MID]: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  [Position.FWD]: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `€${(value / 1_000).toFixed(0)}K`;
  return `€${value}`;
}

function abilityColor(v: number): string {
  if (v >= 85) return "text-emerald-400";
  if (v >= 70) return "text-amber-400";
  return "text-red-400";
}

function staminaBarColor(v: number): string {
  if (v >= 70) return "bg-emerald-500";
  if (v >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function staminaTextColor(v: number): string {
  if (v >= 70) return "text-emerald-400";
  if (v >= 40) return "text-amber-400";
  return "text-red-400";
}

// ── Dashboard Shell ─────────────────────────────────────────

function Dashboard({
  playerTeam,
  teams,
  currentWeek,
  standings,
  transferMarketPlayers,
  activeView,
  onChangeView,
  onBuyPlayer,
  onSwapPlayer,
  onAutoRotate,
  onSetStarterSlot,
  onAutoFill,
  onPromotePlayer,
  onSellPlayer,
  onDemotePlayer,
  isSeasonEnded,
  matchdayLabel,
  matchdayType,
  onPlayMatch,
  onReset,
  onChangeFormation,
  onChangeTactic,
  squadTab,
  onChangeSquadTab,
  playerTournament,
}: {
  playerTeam: Team;
  teams: Team[];
  currentWeek: number;
  standings: LeagueStandings[];
  transferMarketPlayers: Player[];
  activeView: View;
  onChangeView: (v: View) => void;
  onBuyPlayer: (p: Player, target: "first" | "u21" | "u18") => void;
  onSwapPlayer: (outId: string, inId: string) => void;
  onAutoRotate: () => void;
  onAutoFill: () => void;
  onSetStarterSlot: (idx: number, playerId: string) => void;
  onPromotePlayer: (id: string, from: "u21" | "u18") => void;
  onSellPlayer: (id: string, from: "first" | "u21" | "u18") => void;
  isSeasonEnded: boolean;
  matchdayLabel: string;
  matchdayType: string;
  onDemotePlayer: (id: string, to: "u21" | "u18") => void;
  onPlayMatch: () => void;
  onReset: () => void;
  onChangeFormation: (f: Formation) => void;
  onChangeTactic: (t: Tactic) => void;
  squadTab: SquadTab;
  onChangeSquadTab: (t: SquadTab) => void;
  playerTournament: import("./types/game").EuropeanTournament | null;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-sans">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 lg:px-8 py-3 lg:py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 lg:gap-3">
          <span className="text-base lg:text-xl font-bold tracking-wide text-white truncate max-w-[140px] lg:max-w-none">
            {playerTeam.name}
          </span>
          <span className="text-[10px] lg:text-xs text-gray-600 font-mono hidden sm:inline">
            {playerTeam.formation} · 第 {currentWeek} 周
          </span>
        </div>
        <div className="flex items-center gap-3 lg:gap-5">
          <button onClick={onReset}
            className="text-[10px] lg:text-xs text-gray-600 hover:text-gray-400 transition-colors cursor-pointer select-none">
            新游戏
          </button>
          <div className="flex items-center gap-1.5 lg:gap-2 text-xs lg:text-sm">
            <span className="text-gray-500">资金</span>
            <span className="text-base lg:text-xl font-bold text-emerald-400 font-mono">
              {formatMoney(playerTeam.budget)}
            </span>
          </div>
        </div>
      </header>

      {/* Main grid — mobile: stack vertically; desktop: side-by-side */}
      <div className="flex flex-col lg:flex-row gap-0" style={{ minHeight: "calc(100vh - 65px)" }}>
        {/* ── LEFT: Squad / Transfer Market ── */}
        <main className="flex-1 p-3 lg:p-6 lg:border-r border-gray-800 flex flex-col min-h-0 order-1">
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-3 lg:mb-5">
            <button
              onClick={() => onChangeView("squad")}
              className={`px-3 lg:px-4 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer select-none ${
                activeView === "squad"
                  ? "bg-gray-800 text-white"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
              }`}
            >
              阵容 · {playerTeam.players.length}
            </button>
            <button
              onClick={() => onChangeView("transfer")}
              className={`px-3 lg:px-4 py-1.5 lg:py-2 text-xs lg:text-sm font-semibold rounded-lg transition-all duration-200 cursor-pointer select-none ${
                activeView === "transfer"
                  ? "bg-gray-800 text-amber-400"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
              }`}
            >
              转会市场 · {transferMarketPlayers.length}
            </button>
            {activeView === "squad" && (
              <span className="ml-auto text-[11px] text-gray-600">
                <span className="text-emerald-500">■</span> 首发
                &nbsp;
                <span className="text-gray-700">■</span> 替补
              </span>
            )}
          </div>

          {activeView === "squad" ? (
            <>
              {/* Sub-tabs */}
              <div className="flex items-center gap-1 mb-3 lg:mb-4">
                {(["first", "u21", "u18"] as SquadTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => onChangeSquadTab(tab)}
                    className={`px-2.5 lg:px-4 py-1 lg:py-1.5 text-[11px] lg:text-xs font-semibold rounded-lg transition-all duration-200 cursor-pointer select-none ${
                      squadTab === tab
                        ? "bg-gray-800 text-white"
                        : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
                    }`}
                  >
                    {tab === "first" ? `一线·${playerTeam.players.length}` : tab === "u21" ? `U21·${playerTeam.u21Players.length}` : `U18·${playerTeam.u18Players.length}`}
                  </button>
                ))}
              </div>
              {squadTab === "first" ? (
                <FirstTeamView
                  team={playerTeam}
                  onSwap={onSwapPlayer}
                  onAutoRotate={onAutoRotate}
                  onAutoFill={onAutoFill}
                  onSetStarterSlot={onSetStarterSlot}
                  onDemote={onDemotePlayer}
                  onSell={onSellPlayer}
                />
              ) : squadTab === "u21" ? (
                <YouthView players={playerTeam.u21Players} onPromote={(id) => onPromotePlayer(id, "u21")} onSell={onSellPlayer} squadType="u21" />
              ) : (
                <YouthView players={playerTeam.u18Players} onPromote={(id) => onPromotePlayer(id, "u18")} onSell={onSellPlayer} squadType="u18" />
              )}
            </>
          ) : (
            <TransferMarketView
              players={transferMarketPlayers}
              budget={playerTeam.budget}
              onBuy={onBuyPlayer}
            />
          )}
        </main>

        {/* ── RIGHT: Sidebar — mobile: full-width bottom; desktop: scrollable side panel ── */}
        <aside className="w-full lg:w-[440px] p-3 lg:p-4 flex flex-col gap-3 shrink-0 order-2 lg:overflow-y-auto" style={{ maxHeight: "calc(100vh - 65px)" }}>
          {/* Tactics board — mobile: compact horizontal; desktop: full vertical */}
          <div className="hidden lg:block">
            <TacticsPanel
              formation={playerTeam.formation}
              tactic={playerTeam.tactic}
              onChangeFormation={onChangeFormation}
              onChangeTactic={onChangeTactic}
            />
          </div>

          {/* Match area */}
          <div className={`rounded-xl bg-gradient-to-br border p-4 lg:p-6 text-center shrink-0 lg:w-auto w-40 ${
            matchdayType === "european"
              ? "from-blue-900/60 to-blue-950 border-blue-700"
              : "from-gray-800 to-gray-900 border-gray-700"
          }`}>
            <div className="text-xs uppercase tracking-widest mb-1 text-gray-500">
              {matchdayType === "european" && playerTournament?.currentStage === "done"
                ? "欧战征程已结束"
                : matchdayLabel}
            </div>
            {matchdayType === "european" && playerTournament && playerTournament.currentStage !== "done" && (
              <div className="text-[10px] font-semibold mb-2 text-blue-400">
                {playerTournament.type === "UCL" ? "🏆 UCL" :
                 playerTournament.type === "UEL" ? "🥈 UEL" : "🥉 UECL"}
                {" · "}
                {playerTournament.currentStage === "league" ? "联赛阶段" :
                 playerTournament.currentStage === "playoff" ? "淘汰赛附加赛" :
                 playerTournament.currentStage === "r16" ? "16强" :
                 playerTournament.currentStage === "qtr" ? "8强" :
                 playerTournament.currentStage === "semi" ? "半决赛" :
                 playerTournament.currentStage === "final" ? "决赛" : "已结束"}
              </div>
            )}
            <button
              onClick={onPlayMatch}
              disabled={isSeasonEnded}
              className={`w-full py-3 rounded-xl text-white font-bold text-lg
                         transition-all duration-200 shadow-lg cursor-pointer select-none
                         disabled:opacity-30 disabled:cursor-not-allowed ${
                           matchdayType === "european"
                             ? "bg-gradient-to-r from-blue-600 to-indigo-500 hover:from-blue-500 hover:to-indigo-400 active:from-blue-700 active:to-indigo-600 shadow-indigo-500/20 hover:shadow-indigo-500/40"
                             : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 active:from-emerald-700 active:to-emerald-600 shadow-emerald-500/20 hover:shadow-emerald-500/40"
                         }`}
            >
              {isSeasonEnded ? "🏆 赛季已结束"
                : matchdayType === "european" && playerTournament?.currentStage === "done" ? "🏁 欧战已结束"
                : matchdayType === "european" ? "⭐ 踢下一场比赛" : "⚽ 踢下一场比赛"}
            </button>
          </div>

          {/* Standings — always visible, min-height to prevent collapse */}
          <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ minHeight: "180px" }}>
            <div className="bg-gray-900 px-3 lg:px-5 py-2 lg:py-3 text-xs lg:text-sm font-semibold text-gray-500 uppercase tracking-widest sticky top-0 z-10">
              联赛积分榜
            </div>
            <div className="max-h-[260px] overflow-auto">
              <StandingsTable standings={standings} teams={teams} highlightId={playerTeam.id} />
            </div>
          </div>

          {/* European standings */}
          <EuropeanStandingsPanel />
        </aside>
      </div>
    </div>
  );
}

// ── Standings Table ─────────────────────────────────────────

function StandingsTable({
  standings,
  teams,
  highlightId,
}: {
  standings: LeagueStandings[];
  teams: { id: string; name: string }[];
  highlightId: string;
}) {
  const nameOf = (id: string) => teams.find((t) => t.id === id)?.name ?? "???";

  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-gray-500 border-b border-gray-800">
          <th className="px-3 py-2 text-left font-medium w-5">#</th>
          <th className="px-2 py-2 text-left font-medium">球队</th>
          <th className="px-2 py-2 text-center font-medium w-6">赛</th>
          <th className="px-2 py-2 text-center font-medium w-6">胜</th>
          <th className="px-2 py-2 text-center font-medium w-6">平</th>
          <th className="px-2 py-2 text-center font-medium w-6">负</th>
          <th className="px-2 py-2 text-center font-medium w-8">分</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800/50">
        {standings.map((s, i) => {
          const isPlayer = s.teamId === highlightId;
          return (
            <tr
              key={s.teamId}
              className={`${isPlayer ? "bg-emerald-500/5 font-semibold" : ""} hover:bg-gray-900/50 transition-colors`}
            >
              <td className="px-3 py-2 text-gray-500">{i + 1}</td>
              <td className={`px-2 py-2 truncate max-w-[110px] ${isPlayer ? "text-emerald-400" : "text-gray-300"}`}>
                {nameOf(s.teamId)}
              </td>
              <td className="px-2 py-2 text-center text-gray-500">{s.played}</td>
              <td className="px-2 py-2 text-center text-gray-400">{s.won}</td>
              <td className="px-2 py-2 text-center text-gray-500">{s.drawn}</td>
              <td className="px-2 py-2 text-center text-gray-500">{s.lost}</td>
              <td className="px-2 py-2 text-center font-bold text-white">{s.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── First Team View (Pitch + List toggle) ───────────────────

function FirstTeamView({
  team,
  onSwap,
  onAutoRotate,
  onAutoFill,
  onSetStarterSlot,
  onDemote,
  onSell,
}: {
  team: Team;
  onSwap: (outId: string, inId: string) => void;
  onAutoRotate: () => void;
  onAutoFill: () => void;
  onSetStarterSlot: (idx: number, playerId: string) => void;
  onDemote: (id: string, to: "u21" | "u18") => void;
  onSell: (id: string, from: "first") => void;
}) {
  const [viewMode, setViewMode] = useState<"pitch" | "list">("pitch");

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Toggle + actions */}
      <div className="flex items-center gap-2">
        <button onClick={() => setViewMode("pitch")}
          className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer select-none ${
            viewMode === "pitch" ? "bg-emerald-500/20 text-emerald-400" : "text-gray-500 hover:text-gray-300"
          }`}>
          ⚽ 阵型视图
        </button>
        <button onClick={() => setViewMode("list")}
          className={`px-3 py-1 text-[11px] font-semibold rounded-lg transition-all cursor-pointer select-none ${
            viewMode === "list" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
          }`}>
          📋 列表视图
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={onAutoFill}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all cursor-pointer select-none">
            🔧 一键补齐
          </button>
          <button onClick={onAutoRotate}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all cursor-pointer select-none">
            🔄 自动轮换
          </button>
        </div>
      </div>

      {viewMode === "pitch" ? (
        <LineupPitch team={team} onSwapSlot={onSetStarterSlot} />
      ) : (
        <SquadView team={team} onSwap={onSwap} onAutoRotate={onAutoRotate} onAutoFill={onAutoFill} onDemote={onDemote} onSell={onSell} />
      )}
    </div>
  );
}

// ── Squad View (Starters + Subs with two-click swap) ────────

function SquadView({
  team,
  onSwap,
  onAutoRotate,
  onAutoFill,
  onDemote,
  onSell,
}: {
  team: Team;
  onSwap: (outId: string, inId: string) => void;
  onAutoRotate: () => void;
  onAutoFill: () => void;
  onDemote: (id: string, to: "u21" | "u18") => void;
  onSell: (id: string, from: "first") => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const starterSet = new Set(team.starterIds);

  const posWeight: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };

  const starters = team.players
    .filter((p) => starterSet.has(p.id))
    .sort((a, b) => (posWeight[a.position] || 5) - (posWeight[b.position] || 5) || b.overall - a.overall);

  const subs = team.players
    .filter((p) => !starterSet.has(p.id))
    .sort((a, b) => (posWeight[a.position] || 5) - (posWeight[b.position] || 5) || b.overall - a.overall);

  const handleSelect = (playerId: string) => {
    if (selectedId === null) {
      setSelectedId(playerId);
    } else if (selectedId === playerId) {
      setSelectedId(null);
    } else {
      const selectedIsStarter = starterSet.has(selectedId);
      const clickedIsStarter = starterSet.has(playerId);
      if (selectedIsStarter !== clickedIsStarter) {
        const outId = selectedIsStarter ? selectedId : playerId;
        const inId = selectedIsStarter ? playerId : selectedId;
        onSwap(outId, inId);
      }
      setSelectedId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto">
      {selectedId && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2 flex items-center gap-2">
          <span>👆</span>
          <span>
            已选中：<strong>{team.players.find((p) => p.id === selectedId)?.name}</strong>
          </span>
          <span className="text-gray-500">
            — 请在另一区域点击要交换的球员
          </span>
          <button
            onClick={() => setSelectedId(null)}
            className="ml-auto text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          >
            ✕ 取消
          </button>
        </div>
      )}

      {/* Starters */}
      <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
        <div className="bg-emerald-500/10 px-5 py-2 text-xs font-semibold text-emerald-400 uppercase tracking-widest flex items-center justify-between">
          <span>⚡ 首发阵容 · {starters.length}</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); onAutoFill(); }}
              className="text-[10px] font-bold px-2.5 py-1 rounded-lg
                         bg-amber-500/20 text-amber-300 border border-amber-500/30
                         hover:bg-amber-500/30 hover:border-amber-500/50
                         active:bg-amber-500/40
                         transition-all duration-200 cursor-pointer select-none"
              title="从替补中补齐首发至 11 人"
            >
              🔧 一键补齐
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAutoRotate(); }}
              className="text-[10px] font-bold px-2.5 py-1 rounded-lg
                         bg-emerald-500/20 text-emerald-300 border border-emerald-500/30
                         hover:bg-emerald-500/30 hover:border-emerald-500/50
                         active:bg-emerald-500/40
                         transition-all duration-200 cursor-pointer select-none"
            >
              🔄 自动轮换
            </button>
          </div>
        </div>
        <PlayerTable
          players={starters}
          isStarterSection
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>

      {/* Substitutes */}
      <div className="rounded-xl border border-gray-700 overflow-hidden">
        <div className="bg-gray-800 px-5 py-2 text-xs font-semibold text-gray-500 uppercase tracking-widest">
          🪑 替补席 · {subs.length}
        </div>
        <PlayerTable
          players={subs}
          isStarterSection={false}
          selectedId={selectedId}
          onSelect={handleSelect}
          onDemote={onDemote}
          onSell={(id) => onSell(id, "first")}
        />
      </div>
    </div>
  );
}

// ── Player Table ────────────────────────────────────────────

function PlayerTable({
  players,
  isStarterSection,
  selectedId,
  onSelect,
  onDemote,
  onSell,
}: {
  players: Player[];
  isStarterSection: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDemote?: (id: string, to: "u21" | "u18") => void;
  onSell?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="bg-gray-900 text-gray-500 text-[11px] uppercase tracking-wider">
            <th className="px-4 py-2 font-medium">球员</th>
            <th className="px-2 py-2 font-medium w-12 text-center">年龄</th>
            <th className="px-2 py-2 font-medium w-[80px] text-center">体能</th>
            <th className="px-2 py-2 font-medium w-10 text-center">进攻</th>
            <th className="px-2 py-2 font-medium w-10 text-center">防守</th>
            <th className="px-2 py-2 font-medium w-10 text-center">总评</th>
            <th className="px-2 py-2 font-medium w-10 text-center">潜力</th>
            <th className="px-3 py-2 font-medium w-20 text-right">身价</th>
            <th className="px-2 py-2 font-medium w-[80px] text-center"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {players.map((p) => {
            if (!p) return null;
            return (
            <PlayerRow
              key={p.id}
              player={p}
              isStarter={isStarterSection}
              isSelected={selectedId === p.id}
              crossSelected={selectedId !== null && selectedId !== p.id}
              onSelect={() => onSelect(p.id)}
              onDemote={onDemote}
              onSell={onSell}
            />
          );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Player Row ──────────────────────────────────────────────

function PlayerRow({
  player: p,
  isStarter,
  isSelected,
  crossSelected,
  onSelect,
  onDemote,
  onSell,
}: {
  player: Player;
  isStarter: boolean;
  isSelected: boolean;
  crossSelected: boolean;
  onSelect: () => void;
  onDemote?: (id: string, to: "u21" | "u18") => void;
  onSell?: (id: string) => void;
}) {
  // Defensive: if somehow a null/undefined player leaks in, render nothing
  if (!p) return null;

  const style = POSITION_STYLE[p.position] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30";
  const injured = (p.injuryWeeks ?? 0) > 0;

  const rowBg = injured
    ? "bg-red-500/5 hover:bg-red-500/10 cursor-pointer"
    : isSelected
      ? "bg-amber-500/10 border-l-2 border-amber-500"
      : crossSelected
        ? "hover:bg-gray-900/30 cursor-pointer"
        : "hover:bg-gray-900/50 cursor-pointer";

  return (
    <tr className={`transition-all duration-150 ${rowBg}`} onClick={onSelect}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {isStarter ? (
            <span className="text-[10px] font-black text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded leading-none shrink-0">
              XI
            </span>
          ) : (
            <span className="w-[26px] shrink-0" />
          )}
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${style} w-9 text-center shrink-0`}>
            {p.position}
          </span>
          <span className={`font-medium text-sm truncate ${
            injured ? "text-red-400" : isStarter ? "text-gray-100" : "text-gray-400"
          }`}>
            {p.name}
          </span>
          {injured && (
            <span className="text-[10px] text-red-400 font-semibold whitespace-nowrap shrink-0">
              🩹 {p.injuryWeeks}周
            </span>
          )}
        </div>
      </td>
      <td className={`px-2 py-2.5 text-center text-xs ${isStarter ? "text-gray-400" : "text-gray-600"}`}>
        {p.age}
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${staminaBarColor(p.stamina)}`}
              style={{ width: `${p.stamina}%` }}
            />
          </div>
          <span className={`text-[11px] font-mono font-semibold w-7 text-right ${staminaTextColor(p.stamina)}`}>
            {p.stamina}
          </span>
        </div>
      </td>
      <td className={`px-2 py-2.5 text-center text-xs font-mono font-semibold ${abilityColor(p.attack)}`}>
        {p.attack}
      </td>
      <td className={`px-2 py-2.5 text-center text-xs font-mono font-semibold ${abilityColor(p.defense)}`}>
        {p.defense}
      </td>
      <td className="px-2 py-2.5 text-center">
        <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-[11px] font-bold font-mono ${
          isStarter ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-800 text-gray-500"
        }`}>
          {p.overall}
        </span>
      </td>
      <td className="px-2 py-2.5 text-center">
        <span className="text-[11px] font-mono text-gray-600">
          {p.potential}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-500">
        {formatMoney(p.value)}
      </td>
      <td className="px-2 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1">
          {injured ? (
            <span className="text-[10px] text-red-400 font-semibold">🩹</span>
          ) : isSelected ? (
            <span className="text-xs text-amber-400 font-bold animate-pulse">◀ ▶</span>
          ) : crossSelected ? (
            <span className="text-[10px] text-gray-600">↔</span>
          ) : (
            <span className="text-[10px] text-gray-700">·</span>
          )}
          {!isStarter && onDemote && !injured && p.age <= 21 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDemote(p.id, p.age <= 18 ? "u18" : "u21"); }}
              className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors cursor-pointer"
              title={`下放至 ${p.age <= 18 ? "U18" : "U21"}`}
            >
              ⬇️
            </button>
          )}
          {!isStarter && onSell && (
            <button
              onClick={(e) => { e.stopPropagation(); onSell(p.id); }}
              className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              title={`出售（回收 €${Math.round(p.value * 0.8).toLocaleString()}）`}
            >
              💰
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Youth View ──────────────────────────────────────────────

function YouthView({
  players,
  onPromote,
  onSell,
  squadType,
}: {
  players: Player[];
  onPromote: (id: string) => void;
  onSell: (id: string, from: "u21" | "u18") => void;
  squadType: "u21" | "u18";
}) {
  // Sort: GK → DEF → MID → FWD, then overall ↓
  const posWeight: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
  const sorted = useMemo(
    () =>
      [...players].sort(
        (a, b) =>
          (posWeight[a.position] || 5) - (posWeight[b.position] || 5) || b.overall - a.overall,
      ),
    [players],
  );

  if (sorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
        <p className="text-gray-600 text-sm italic">暂无青年球员。</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 flex-1">
      <table className="w-full text-left text-sm border-collapse">
        <thead>
          <tr className="bg-gray-900 text-gray-500 text-[11px] uppercase tracking-wider">
            <th className="px-4 py-2 font-medium">球员</th>
            <th className="px-2 py-2 font-medium w-12 text-center">年龄</th>
            <th className="px-2 py-2 font-medium w-[80px] text-center">体能</th>
            <th className="px-2 py-2 font-medium w-10 text-center">进攻</th>
            <th className="px-2 py-2 font-medium w-10 text-center">防守</th>
            <th className="px-2 py-2 font-medium w-10 text-center">总评</th>
            <th className="px-2 py-2 font-medium w-10 text-center">潜力</th>
            <th className="px-3 py-2 font-medium w-20 text-right">身价</th>
            <th className="px-3 py-2 font-medium w-24 text-center">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {sorted.map((p) => {
            if (!p) return null;
            return (
            <tr key={p.id} className="hover:bg-gray-900/50 transition-colors cursor-pointer">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${POSITION_STYLE[p.position] ?? "bg-gray-500/15 text-gray-400 border-gray-500/30"} w-9 text-center shrink-0`}>
                    {p.position}
                  </span>
                  <span className="font-medium text-sm text-gray-300">{p.name ?? "?"}</span>
                </div>
              </td>
              <td className="px-2 py-2.5 text-center text-xs text-gray-400">{p.age}</td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div className={`h-full rounded-full ${staminaBarColor(p.stamina)}`} style={{ width: `${p.stamina}%` }} />
                  </div>
                  <span className={`text-[11px] font-mono font-semibold w-7 text-right ${staminaTextColor(p.stamina)}`}>{p.stamina}</span>
                </div>
              </td>
              <td className={`px-2 py-2.5 text-center text-xs font-mono font-semibold ${abilityColor(p.attack)}`}>{p.attack}</td>
              <td className={`px-2 py-2.5 text-center text-xs font-mono font-semibold ${abilityColor(p.defense)}`}>{p.defense}</td>
              <td className="px-2 py-2.5 text-center">
                <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[11px] font-bold font-mono bg-gray-800 text-gray-400">{p.overall}</span>
              </td>
              <td className="px-2 py-2.5 text-center">
                <span className="text-[11px] font-mono text-purple-400 font-semibold">{p.potential}</span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-500">{formatMoney(p.value)}</td>
              <td className="px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <button
                    onClick={() => onPromote(p.id)}
                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg
                               bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
                               hover:bg-emerald-500/25 hover:border-emerald-500/50
                               active:bg-emerald-500/35
                               transition-all duration-200 cursor-pointer select-none"
                  >
                    ⬆️ 提拔
                  </button>
                  <button
                    onClick={() => onSell(p.id, squadType)}
                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg
                               bg-red-500/10 text-red-400 border border-red-500/20
                               hover:bg-red-500/20 hover:border-red-500/40
                               active:bg-red-500/30
                               transition-all duration-200 cursor-pointer select-none"
                    title={`出售（回收 €${Math.round(p.value * 0.8).toLocaleString()}）`}
                  >
                    💰 出售
                  </button>
                </div>
              </td>
            </tr>
          );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Transfer Market View ────────────────────────────────────

const POSITION_FILTERS = [
  { key: "all", label: "全部" },
  { key: Position.GK, label: "GK" },
  { key: Position.DEF, label: "DEF" },
  { key: Position.MID, label: "MID" },
  { key: Position.FWD, label: "FWD" },
] as const;

const AGE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "young", label: "妖人 ≤20" },
  { key: "peak", label: "巅峰 21-29" },
  { key: "veteran", label: "老将 ≥30" },
] as const;

function TransferMarketView({
  players,
  budget,
  onBuy,
}: {
  players: Player[];
  budget: number;
  onBuy: (p: Player, target: "first" | "u21" | "u18") => void;
}) {
  const [posFilter, setPosFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const posWeight: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };
    return players
      .filter((p) => {
        if (posFilter !== "all" && p.position !== posFilter) return false;
        if (ageFilter === "young" && p.age > 20) return false;
        if (ageFilter === "peak" && (p.age < 21 || p.age > 29)) return false;
        if (ageFilter === "veteran" && p.age < 30) return false;
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort(
        (a, b) =>
          (posWeight[a.position] || 5) - (posWeight[b.position] || 5) || b.overall - a.overall,
      );
  }, [players, posFilter, ageFilter, search]);

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Budget */}
        <div className="flex items-center gap-2 text-sm bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 shrink-0">
          <span className="text-gray-500">资金</span>
          <span className="text-lg font-bold text-emerald-400 font-mono">{formatMoney(budget)}</span>
        </div>

        {/* Position filter */}
        <div className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-lg p-0.5">
          {POSITION_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setPosFilter(f.key)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all duration-150 cursor-pointer select-none ${
                posFilter === f.key
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Age filter */}
        <div className="flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-lg p-0.5">
          {AGE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setAgeFilter(f.key)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all duration-150 cursor-pointer select-none ${
                ageFilter === f.key
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="搜索姓名…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 outline-none focus:border-gray-500 transition-colors w-36"
        />

        {/* Result count */}
        <span className="text-[11px] text-gray-600 ml-auto">
          {filtered.length} / {players.length} 人
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
          <p className="text-gray-600 text-sm italic">
            {players.length === 0 ? "当前市场暂无挂牌球员。" : "没有符合条件的球员。"}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 flex-1">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gray-900 text-gray-500 text-[11px] uppercase tracking-wider">
                <th className="px-4 py-2.5 font-medium">球员</th>
                <th className="px-2 py-2.5 font-medium w-12 text-center">年龄</th>
                <th className="px-2 py-2.5 font-medium w-10 text-center">总评</th>
                <th className="px-2 py-2.5 font-medium w-10 text-center">潜力</th>
                <th className="px-2 py-2.5 font-medium w-[72px] text-center">体能</th>
                <th className="px-3 py-2.5 font-medium w-24 text-right">身价</th>
                <th className="px-3 py-2.5 font-medium w-[200px] text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filtered.map((p) => {
                if (!p) return null;
                const canAfford = budget >= (p.value ?? Infinity);
                const canU21 = (p.age ?? 99) <= 21;
                const canU18 = p.age <= 18;
                return (
                  <tr key={p.id} className="hover:bg-gray-900/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${POSITION_STYLE[p.position]} w-9 text-center shrink-0`}>
                          {p.position}
                        </span>
                        <span className="font-medium text-sm text-gray-100">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center text-xs text-gray-400">{p.age}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span className="inline-flex items-center justify-center w-7 h-5 rounded text-[11px] font-bold font-mono bg-gray-800 text-white">
                        {p.overall}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <span className="text-[11px] font-mono text-purple-400 font-semibold">{p.potential}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1 rounded-full bg-gray-800 overflow-hidden">
                          <div className={`h-full rounded-full ${staminaBarColor(p.stamina)}`} style={{ width: `${p.stamina}%` }} />
                        </div>
                        <span className={`text-[10px] font-mono w-6 text-right ${staminaTextColor(p.stamina)}`}>{p.stamina}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-300">
                      {formatMoney(p.value)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {canAfford ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => onBuy(p, "first")}
                            className="px-3 py-1 text-[10px] font-bold rounded-lg
                                       bg-amber-500/15 text-amber-400 border border-amber-500/30
                                       hover:bg-amber-500/25 hover:border-amber-500/50
                                       active:bg-amber-500/35 transition-all duration-200 cursor-pointer select-none">
                            一线队
                          </button>
                          <button onClick={() => onBuy(p, "u21")} disabled={!canU21}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all duration-200 cursor-pointer select-none ${
                              canU21
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50"
                                : "bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed"
                            }`}
                            title={!canU21 ? "年龄超过 U21 上限" : "签约至 U21 梯队"}>
                            U21
                          </button>
                          <button onClick={() => onBuy(p, "u18")} disabled={!canU18}
                            className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border transition-all duration-200 cursor-pointer select-none ${
                              canU18
                                ? "bg-blue-500/15 text-blue-400 border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50"
                                : "bg-gray-800 text-gray-600 border-gray-700 cursor-not-allowed"
                            }`}
                            title={!canU18 ? "年龄超过 U18 上限" : "签约至 U18 梯队"}>
                            U18
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-600 font-semibold"
                          title={`需要 ${formatMoney(p.value)}（当前 ${formatMoney(budget)}）`}>
                          资金不足
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Match Result Modal ──────────────────────────────────────

function MatchModal({
  result,
  homeName,
  awayName,
  playerIsHome,
  onClose,
}: {
  result: MatchResult;
  homeName: string;
  awayName: string;
  playerIsHome: boolean;
  onClose: () => void;
}) {
  // Compute the player's result from their perspective
  const playerScore = playerIsHome ? result.homeScore : result.awayScore;
  const opponentScore = playerIsHome ? result.awayScore : result.homeScore;
  const isWin = playerScore > opponentScore;
  const isDraw = playerScore === opponentScore;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-[520px] max-w-[95vw] max-h-[85vh] flex flex-col rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
        <div
          className={`px-6 py-10 text-center ${
            isWin
              ? "bg-gradient-to-b from-emerald-500/20 to-transparent"
              : isDraw
                ? "bg-gradient-to-b from-amber-500/20 to-transparent"
                : "bg-gradient-to-b from-red-500/20 to-transparent"
          }`}
        >
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">终场</div>
          <div className="flex flex-nowrap items-center justify-center gap-4">
            {/* Home team (left) — always gets homeScore next to it */}
            <span className={`text-xl font-bold truncate max-w-[150px] ${
              playerIsHome ? "text-white" : "text-gray-400"
            }`}>
              {homeName}
            </span>
            {/* Score: always homeScore – awayScore, aligning with the names */}
            <span
              className={`shrink-0 text-5xl font-black tabular-nums whitespace-nowrap ${
                isWin ? "text-emerald-400" : isDraw ? "text-amber-400" : "text-red-400"
              }`}
            >
              {result.homeScore} – {result.awayScore}
            </span>
            {/* Away team (right) — always gets awayScore next to it */}
            <span className={`text-xl font-bold truncate max-w-[150px] ${
              playerIsHome ? "text-gray-400" : "text-white"
            }`}>
              {awayName}
            </span>
          </div>
          <div className="mt-4 text-sm font-semibold text-gray-400">
            {isWin ? "🏆 胜利！" : isDraw ? "🤝 平局" : "😞 失利"}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2 min-h-0">
          {result.events.length === 0 ? (
            <p className="text-gray-600 text-center py-8 italic">一场平淡的比赛，双方均无建树。</p>
          ) : (
            result.events.map((ev, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2 rounded-lg bg-gray-800/50 border border-gray-800">
                <span className="text-xs font-mono font-bold text-gray-500 shrink-0 mt-0.5">
                  {String(ev.minute).padStart(2, "0")}′
                </span>
                <span className="text-sm text-gray-300">{ev.text}</span>
              </div>
            ))
          )}
        </div>

        <div className="px-6 py-5 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-gray-800 hover:bg-gray-700 active:bg-gray-750
                       text-white font-semibold transition-all duration-200 cursor-pointer select-none"
          >
            确认并继续
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Entry Point ─────────────────────────────────────────────

// ── Main Game Component (all hooks live here) ──────────────

function MainGame() {
  const teams = useGameStore((s) => s.teams);
  const virtualEuroTeams = useGameStore((s) => s.virtualEuroTeams);
  const playerTeamId = useGameStore((s) => s.playerTeamId);
  const currentWeek = useGameStore((s) => s.currentWeek);
  const standings = useGameStore((s) => s.standings);
  const playMatchweek = useGameStore((s) => s.playMatchweek);
  const setPlayerFormation = useGameStore((s) => s.setPlayerFormation);
  const setPlayerTactic = useGameStore((s) => s.setPlayerTactic);
  const transferMarketPlayers = useGameStore((s) => s.transferMarketPlayers);
  const buyPlayer = useGameStore((s) => s.buyPlayer);
  const swapPlayer = useGameStore((s) => s.swapPlayer);
  const autoRotateSquad = useGameStore((s) => s.autoRotateSquad);
  const autoFillSquad = useGameStore((s) => s.autoFillSquad);
  const setStarterSlot = useGameStore((s) => s.setStarterSlot);
  const promotePlayer = useGameStore((s) => s.promotePlayer);
  const demotePlayer = useGameStore((s) => s.demotePlayer);
  const sellPlayer = useGameStore((s) => s.sellPlayer);
  const season = useGameStore((s) => s.season);
  const isSeasonEnded = useGameStore((s) => s.isSeasonEnded);
  const seasonResult = useGameStore((s) => s.seasonResult);
  const startNewSeason = useGameStore((s) => s.startNewSeason);
  const seasonCalendar = useGameStore((s) => s.seasonCalendar);
  const currentMatchday = useGameStore((s) => s.currentMatchday);
  const playerTournament = useGameStore((s) => s.playerTournament);

  const safeMatchday = seasonCalendar?.[(currentMatchday ?? 1) - 1] ?? { id: 1, type: "league" as const, round: 1, name: "联赛" };
  const safeMatchdayLabel = safeMatchday.name;
  const safeMatchdayType = safeMatchday.type;

  const [activeView, setActiveView] = useState<View>("squad");
  const [squadTab, setSquadTab] = useState<SquadTab>("first");
  const [matchModal, setMatchModal] = useState<{
    result: MatchResult;
    homeName: string;
    awayName: string;
    playerIsHome: boolean;
  } | null>(null);

  const playerTeam = teams.find((t) => t.id === playerTeamId);
  if (!playerTeam) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <button onClick={() => { localStorage.removeItem("simple-fm-game"); window.location.reload(); }}
          className="px-10 py-5 rounded-xl bg-red-600 text-white font-bold cursor-pointer">
          🔄 数据异常，点击重置
        </button>
      </div>
    );
  }

  const handlePlayMatch = () => {
    if (isSeasonEnded) { alert("本赛季已结束！"); return; }
    const count = playerTeam.starterIds.length;
    if (count !== 11) {
      alert(`首发阵容人数不足！当前首发只有 ${count} 人，必须填满 11 人才能开始比赛！`);
      return;
    }
    try {
      const result = playMatchweek();
      if (!result) return; // eliminated from European, match skipped
      const playerIsHome = result.homeTeamId === playerTeamId;
      const opponentId = playerIsHome ? result.awayTeamId : result.homeTeamId;
      // Search both league teams AND virtual European teams for the opponent
      const allKnownTeams = [...teams, ...(virtualEuroTeams ?? [])];
      const opponent = allKnownTeams.find((t) => t.id === opponentId);
      const oppName = opponent?.name ?? "未知对手";
      setMatchModal({
        result,
        homeName: playerIsHome ? playerTeam.name : oppName,
        awayName: playerIsHome ? oppName : playerTeam.name,
        playerIsHome,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleReset = () => {
    if (window.confirm("确定要开启全新世界吗？")) {
      localStorage.removeItem("simple-fm-game");
      window.location.reload();
    }
  };

  return (
    <>
      <Dashboard
        playerTeam={playerTeam} teams={teams} currentWeek={currentWeek}
        standings={standings} transferMarketPlayers={transferMarketPlayers}
        activeView={activeView} onChangeView={setActiveView}
        onBuyPlayer={buyPlayer} onSwapPlayer={swapPlayer}
        onAutoRotate={autoRotateSquad} onAutoFill={autoFillSquad}
        onSetStarterSlot={setStarterSlot}
        onPromotePlayer={promotePlayer} onSellPlayer={sellPlayer}
        isSeasonEnded={isSeasonEnded} matchdayLabel={safeMatchdayLabel}
        matchdayType={safeMatchdayType} onDemotePlayer={demotePlayer}
        onPlayMatch={handlePlayMatch} onReset={handleReset}
        onChangeFormation={setPlayerFormation} onChangeTactic={setPlayerTactic}
        squadTab={squadTab} onChangeSquadTab={setSquadTab}
        playerTournament={playerTournament}
      />
      {matchModal && (
        <MatchModal result={matchModal.result} homeName={matchModal.homeName}
          awayName={matchModal.awayName} playerIsHome={matchModal.playerIsHome}
          onClose={() => setMatchModal(null)} />
      )}
      {isSeasonEnded && seasonResult && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center">
          <div className="bg-gray-900 border-2 border-yellow-500 rounded-2xl p-10 max-w-lg w-[95vw] text-center shadow-[0_0_60px_rgba(234,179,8,0.3)]">
            <div className="animate-bounce text-6xl mb-6">🏆</div>
            <h2 className="text-2xl font-black text-white mb-2">第 {season} 赛季圆满结束！</h2>
            {seasonResult.rank === 1
              ? <div className="animate-pulse text-yellow-400 text-xl font-black my-4">🎉 恭喜！你的球队夺得了联赛冠军！ 🎉</div>
              : <div className="my-4 text-gray-300">
                  <p className="text-lg">本赛季冠军：<span className="text-yellow-400 font-bold">{seasonResult.champion}</span></p>
                  <p className="text-base mt-1">你的最终排名：<span className="text-white font-bold">第 {seasonResult.rank} 名</span></p>
                </div>
            }
            <div className="bg-gray-800 rounded-xl px-6 py-3 my-5 inline-block">
              <span className="text-gray-400 text-sm">转会费奖金</span>
              <div className="text-2xl font-black text-emerald-400">+ €{(seasonResult.prizeMoney / 1_000_000).toFixed(1)}M</div>
            </div>
            {/* European qualification badge */}
            <div className="my-4">
              {seasonResult.europeanQualification !== "NONE" ? (
                <div
                  className={`rounded-xl px-6 py-3 inline-block ${
                    seasonResult.europeanQualification === "UCL"
                      ? "bg-yellow-500/10 border border-yellow-500/40"
                      : seasonResult.europeanQualification === "UEL"
                        ? "bg-blue-500/10 border border-blue-500/40"
                        : "bg-emerald-500/10 border border-emerald-500/40"
                  }`}
                >
                  <span className="text-gray-400 text-sm block">下赛季欧战资格</span>
                  <div
                    className={`text-xl font-black mt-1 ${
                      seasonResult.europeanQualification === "UCL"
                        ? "text-yellow-400"
                        : seasonResult.europeanQualification === "UEL"
                          ? "text-blue-400"
                          : "text-emerald-400"
                    }`}
                  >
                    {seasonResult.europeanQualification === "UCL"
                      ? "🏆 欧冠联赛 (UCL)"
                      : seasonResult.europeanQualification === "UEL"
                        ? "🥈 欧联杯 (UEL)"
                        : "🥉 欧协联 (UECL)"}
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">未能获得下赛季欧战资格</p>
              )}
            </div>
            <button
              onClick={() => {
                try { startNewSeason(); } catch (e) {
                  console.error("[seasonEnd] startNewSeason error:", e);
                  alert("新赛季初始化失败，请返回主菜单重试。");
                }
              }}
              className="mt-4 w-full py-4 rounded-xl bg-gradient-to-r from-yellow-600 to-amber-500 hover:from-yellow-500 hover:to-amber-400 text-gray-900 font-black text-lg transition-all duration-300 shadow-lg cursor-pointer select-none">
              ▶ 领取奖金并开启新赛季
            </button>
            <button
              onClick={() => {
                if (window.confirm("确定要返回主菜单吗？当前进度将保留。")) {
                  useGameStore.getState().setGameMode("manager");
                  // Force re-render by going back to SETUP and then to team selection
                  localStorage.removeItem("simple-fm-game");
                  window.location.reload();
                }
              }}
              className="mt-3 w-full py-3 rounded-xl border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 text-sm font-semibold transition-colors cursor-pointer select-none">
              🏠 返回主菜单（开启全新游戏）
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── App Router (single hook, clean routing) ─────────────────

export default function App() {
  const gameStatus = useGameStore((s) => s.gameStatus);
  const gameMode = useGameStore((s) => s.gameMode);
  const careerPlayer = useGameStore((s) => s.careerPlayer);
  const initGame = useGameStore((s) => s.initGame);
  const setGameMode = useGameStore((s) => s.setGameMode);
  const createCareerPlayer = useGameStore((s) => s.createCareerPlayer);
  const joinCareerClub = useGameStore((s) => s.joinCareerClub);

  const [careerStep, setCareerStep] = useState<"mode" | "create" | "selectClub">("mode");

  // ── 挂靴退役：生涯荣誉总结谢幕页（最高优先级路由）──
  if (gameStatus === "RETIRED") {
    return <CareerLegacyScreen />;
  }

  // ── Mode selection & career creation flow ──
  if (gameStatus === "SETUP" && !careerPlayer?.teamId && gameMode !== "manager") {
    if (careerStep === "mode") {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-3xl font-black text-white mb-2">⚽ Simple FM</h1>
            <p className="text-sm text-gray-500 mb-10">选择你的游戏模式</p>
            <div className="flex gap-4 justify-center">
              <button onClick={() => { setGameMode("manager"); }}
                className="px-10 py-5 rounded-xl bg-gray-800 border border-gray-700 hover:border-gray-600 text-white font-bold text-lg transition-all cursor-pointer select-none">
                🏟️ 经理模式<br /><span className="text-xs text-gray-500 font-normal">掌控全队 · 战术 · 转会</span>
              </button>
              <button onClick={() => setCareerStep("create")}
                className="px-10 py-5 rounded-xl bg-purple-500/20 border border-purple-500/40 hover:border-purple-400 text-purple-300 font-bold text-lg transition-all cursor-pointer select-none shadow-[0_0_20px_rgba(168,85,247,0.15)]">
                🧑 生涯模式<br /><span className="text-xs text-purple-400/70 font-normal">扮演一名球员 · 成长 · 成为传奇</span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (careerStep === "create") {
      return (
        <CreatePlayerModal
          onCreate={(name, nat, pos, age, att, plm, def, pot) => {
            createCareerPlayer(name, nat, pos, age, att, plm, def, pot);
            setCareerStep("selectClub");
          }}
          onCancel={() => setCareerStep("mode")}
        />
      );
    }
  }

  // Career player created but no club yet
  if (gameStatus === "SETUP" && careerPlayer && !careerPlayer.teamId) {
      return (
        <SelectClubView
          playerName={careerPlayer.name}
          playerPosition={careerPlayer.position}
          playerOVR={careerPlayer.overall}
          onJoin={(teamId) => joinCareerClub(teamId)}
        />
      );
    }

  // ── Manager mode (existing) ──
  if (gameStatus === "SETUP") {
    return (
      <div className="min-h-screen bg-gray-950">
        {/* Quick mode switch banner */}
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={() => setGameMode("career")}
            className="text-[10px] px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors cursor-pointer select-none"
          >
            🧑 切换到生涯模式
          </button>
        </div>
        <TeamSelection onStart={(teamId, teamName, budget) => initGame(teamId, teamName, budget)} />
      </div>
    );
  }

  // ── Career mode dashboard ──
  if (gameMode === "career" && careerPlayer?.teamId) {
    return <CareerDashboard />;
  }

  // ── Manager mode dashboard (existing) ──
  return <MainGame />;
}
