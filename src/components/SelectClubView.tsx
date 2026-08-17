import { useState, useMemo } from "react";
import { getTeamsByLeague, getLeagueNames } from "../data/teamsDatabase";

interface Props {
  playerName: string;
  playerPosition: string;
  playerOVR: number;
  onJoin: (teamId: string) => void;
}

export function SelectClubView({ playerName, playerPosition, playerOVR, onJoin }: Props) {
  const teamsByLeague = useMemo(() => getTeamsByLeague(), []);
  const leagueNames = useMemo(() => getLeagueNames(), []);
  const [selectedLeague, setSelectedLeague] = useState(leagueNames[0] ?? "");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const leagueTeams = teamsByLeague.get(selectedLeague) ?? [];
  const selectedTeam = leagueTeams.find((t) => t.id === selectedTeamId);

  return (
    // 响应式布局：手机纵向堆叠（联赛横向标签栏在上 + 俱乐部网格在下），
    // lg 及以上恢复经典左右双栏
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col lg:flex-row">
      {/* ── League selector: mobile = horizontal scrollable tabs / lg = vertical sidebar ── */}
      <aside className="lg:w-56 shrink-0 border-b border-gray-800 lg:border-b-0 lg:border-r bg-gray-900/50 flex flex-col">
        <div className="px-5 py-3 lg:py-5 border-b border-gray-800 hidden lg:block">
          <h1 className="text-lg font-black text-white tracking-wide">⚽ 选择俱乐部</h1>
          <p className="text-[11px] text-gray-600 mt-1">为 {playerName} 选择东家</p>
        </div>
        <nav className="flex lg:flex-col gap-1 lg:gap-0 overflow-x-auto lg:overflow-y-auto lg:flex-1 px-2 lg:px-0 py-2">
          {leagueNames.map((name) => {
            const count = teamsByLeague.get(name)?.length ?? 0;
            return (
              <button
                key={name}
                onClick={() => { setSelectedLeague(name); setSelectedTeamId(null); }}
                className={`shrink-0 whitespace-nowrap text-left px-3 py-2 lg:px-5 lg:py-3 lg:w-full text-sm transition-all cursor-pointer select-none rounded-lg lg:rounded-none ${
                  selectedLeague === name
                    ? "bg-gray-800 text-white border-b-2 border-purple-500 lg:border-b-0 lg:border-r-2"
                    : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
                }`}
              >
                <span className="font-semibold">{name}</span>
                <span className="text-[10px] text-gray-600 ml-1 lg:ml-0 lg:block">{count} 队</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 flex flex-col min-h-0">
        <header className="px-4 lg:px-8 py-4 lg:py-5 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg lg:text-xl font-bold text-white break-words">{selectedLeague}</h2>
            <p className="text-xs text-gray-600">{leagueTeams.length} 支球队</p>
          </div>
          {selectedTeam && (
            <div className="sm:text-right">
              <span className="text-sm text-purple-400 font-semibold block break-words">{selectedTeam.name}</span>
              <span className="text-[10px] text-gray-600">
                预算 €{(selectedTeam.budget / 1_000_000).toFixed(1)}M · {selectedTeam.players.length} 人
              </span>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          {/* 手机单列 / 平板双列 / 桌面三列 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            {leagueTeams.map((team) => {
              const active = selectedTeamId === team.id;
              const avgOvr = Math.round(
                team.players.reduce((s, p) => s + p.overall, 0) / Math.max(1, team.players.length),
              );
              return (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeamId(team.id)}
                  className={`text-left px-4 py-3 lg:px-5 lg:py-4 rounded-xl border transition-all cursor-pointer select-none ${
                    active
                      ? "border-purple-500/60 bg-purple-500/10 shadow-[0_0_20px_rgba(168,85,247,0.15)]"
                      : "border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-900"
                  }`}
                >
                  <div className={`text-sm font-bold break-words leading-snug ${active ? "text-purple-300" : "text-gray-300"}`}>
                    {team.name}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1 whitespace-nowrap overflow-hidden text-ellipsis">
                    总评 {avgOvr} · {team.players.length} 人
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="px-4 lg:px-8 py-3 lg:py-4 border-t border-gray-800 bg-gray-900/50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-gray-600">
            球员: {playerName} · {playerPosition} · {playerOVR} OVR
          </span>
          <button
            onClick={() => selectedTeam && onJoin(selectedTeam.id)}
            disabled={!selectedTeam}
            className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-base lg:text-lg transition-all shadow-lg cursor-pointer select-none ${
              selectedTeam
                ? "bg-gradient-to-r from-purple-600 to-indigo-500 text-white hover:from-purple-500 hover:to-indigo-400 shadow-purple-500/30"
                : "bg-gray-800 text-gray-600 cursor-not-allowed"
            }`}
          >
            ⚽ 加入此俱乐部，开启生涯
          </button>
        </footer>
      </main>
    </div>
  );
}
