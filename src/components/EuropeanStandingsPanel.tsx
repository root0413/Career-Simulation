import { useState, useMemo } from "react";
import { useGameStore } from "../store/useGameStore";
import type { LeagueStandings } from "../types/game";

// ── Colours per zone ─────────────────────────────────────────

const ZONE_COLORS = {
  direct:   "bg-emerald-500/10 border-l-emerald-400 text-emerald-400",
  playoff:  "bg-amber-500/10 border-l-amber-400 text-amber-400",
  out:      "bg-red-500/5 border-l-red-500/30 text-red-500",
};

function zoneLabel(rank: number): { label: string; cls: string } {
  if (rank <= 8) return { label: "直通16强", cls: ZONE_COLORS.direct };
  if (rank <= 24) return { label: "附加赛", cls: ZONE_COLORS.playoff };
  return { label: "淘汰", cls: ZONE_COLORS.out };
}

// ── Component ─────────────────────────────────────────────────

export function EuropeanStandingsPanel() {
  const playerTournament = useGameStore((s) => s.playerTournament);
  const playerTeamId = useGameStore((s) => s.playerTeamId);
  const virtualEuroTeams = useGameStore((s) => s.virtualEuroTeams);
  const teams = useGameStore((s) => s.teams);

  const [tab, setTab] = useState<"UCL" | "UEL" | "UECL">("UCL");

  // Build a name lookup from all known teams + player team
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.name);
    for (const t of virtualEuroTeams ?? []) m.set(t.id, t.name);
    return m;
  }, [teams, virtualEuroTeams]);

  const tournament = playerTournament;

  // Sort standings
  const sorted: LeagueStandings[] = useMemo(() => {
    if (!tournament?.leaguePhase?.standings) return [];
    // Standard 3-tier: Points↓ → GD↓ → GF↓.  Sanitize NaN first.
    const arr = tournament.leaguePhase.standings.map(s => ({
      ...s,
      points: isNaN(s.points) || s.points === undefined ? 0 : s.points,
      goalsFor: isNaN(s.goalsFor) || s.goalsFor === undefined ? 0 : s.goalsFor,
      goalsAgainst: isNaN(s.goalsAgainst) || s.goalsAgainst === undefined ? 0 : s.goalsAgainst,
    }));
    return arr.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const gdB = b.goalsFor - b.goalsAgainst;
      const gdA = a.goalsFor - a.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      return b.goalsFor - a.goalsFor;
    });
  }, [tournament]);

  // Find scores for a fixture (approximation — we don't store results separately,
  // but we can show the fixture pair as a "match played" indicator)
  // For now, just show the fixture pairing and played status

  if (!tournament) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 text-center">
        <p className="text-xs text-gray-600">暂无欧战数据</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      {/* Tabs */}
      <div className="bg-gray-900 px-4 py-2 flex items-center gap-1 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest mr-3">
          🏆 欧战赛事
        </span>
        {(["UCL", "UEL", "UECL"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer select-none ${
              tab === t
                ? t === "UCL"
                  ? "bg-yellow-500/15 text-yellow-400"
                  : t === "UEL"
                    ? "bg-blue-500/15 text-blue-400"
                    : "bg-emerald-500/15 text-emerald-400"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            {t === "UCL" ? "🏆 UCL" : t === "UEL" ? "🥈 UEL" : "🥉 UECL"}
          </button>
        ))}
      </div>

      {/* Zone legend — compact horizontal strip */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800/50">
        <span className={`text-[10px] px-2 py-0.5 rounded ${ZONE_COLORS.direct}`}>1-8 直通</span>
        <span className={`text-[10px] px-2 py-0.5 rounded ${ZONE_COLORS.playoff}`}>9-24 附加赛</span>
        <span className={`text-[10px] px-2 py-0.5 rounded ${ZONE_COLORS.out}`}>25-36 淘汰</span>
      </div>

      {/* Standings table — full width, compact columns */}
      <div className="overflow-auto max-h-[340px]">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 bg-gray-900/95 z-10">
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="px-2 py-1.5 text-left w-6">#</th>
              <th className="px-2 py-1.5 text-left">球队</th>
              <th className="px-1 py-1.5 text-center w-7">赛</th>
              <th className="px-1 py-1.5 text-center w-8">GD</th>
              <th className="px-1 py-1.5 text-center font-bold w-7">分</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {sorted.map((s, i) => {
              const rank = i + 1;
              const zone = zoneLabel(rank);
              const isPlayer = s.teamId === playerTeamId;
              const name = nameMap.get(s.teamId) ?? "???";
              const gd = s.goalsFor - s.goalsAgainst;

              return (
                <tr
                  key={s.teamId}
                  className={`${isPlayer ? "bg-purple-500/10 font-bold" : ""} hover:bg-gray-900/50 transition-colors`}
                >
                  <td className={`px-2 py-1 border-l-2 ${zone.cls.split(" ")[1] ?? ""}`}>
                    <span className={isPlayer ? "text-purple-400" : "text-gray-500"}>{rank}</span>
                  </td>
                  <td className={`px-2 py-1 truncate max-w-[180px] ${isPlayer ? "text-purple-300" : "text-gray-300"}`}>
                    {name}
                    <span className={`ml-1.5 text-[9px] ${zone.cls.split(" ")[2] ?? ""}`}>({zone.label})</span>
                  </td>
                  <td className="px-1 py-1 text-center text-gray-500">{s.played}</td>
                  <td className={`px-1 py-1 text-center font-mono ${gd > 0 ? "text-emerald-400" : gd < 0 ? "text-red-400" : "text-gray-500"}`}>
                    {gd > 0 ? "+" : ""}{gd}
                  </td>
                  <td className="px-1 py-1 text-center font-bold text-white">{s.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
