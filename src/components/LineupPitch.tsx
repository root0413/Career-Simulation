import { useState, useMemo } from "react";
import { Position, type Player, type Team } from "../types/game";
import { generatePitchSlots, mapStartersToSlots } from "../utils/pitchSlots";

// ── Visual helpers ────────────────────────────────────────────

const POS_COLORS: Record<string, string> = {
  GK: "bg-yellow-500 border-yellow-400", DEF: "bg-blue-500 border-blue-400",
  MID: "bg-emerald-500 border-emerald-400", FWD: "bg-rose-500 border-rose-400",
};

/** Sort priority: GK → DEF → MID → FWD. */
const posWeight: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };

/** Color the ability badge based on playing POSITION (not overall). */
function getPlayerPositionColor(pos: Position): string {
  switch (pos) {
    case Position.GK:  return "bg-yellow-500 border-yellow-400 text-yellow-50";
    case Position.DEF: return "bg-blue-600 border-blue-400 text-blue-50";
    case Position.MID: return "bg-emerald-600 border-emerald-400 text-emerald-50";
    case Position.FWD: return "bg-rose-600 border-rose-400 text-rose-50";
    default:           return "bg-gray-500 border-gray-400 text-gray-200";
  }
}

/** Color the ability badge based on overall rating (kept for PlayerPicker list). */
function overallCircleColor(ovr: number): string {
  if (ovr >= 80) return "bg-amber-500 border-amber-400 text-amber-50";
  if (ovr >= 70) return "bg-emerald-500 border-emerald-400 text-emerald-50";
  if (ovr >= 60) return "bg-yellow-600 border-yellow-500 text-yellow-50";
  return "bg-gray-500 border-gray-400 text-gray-200";
}

/** Mini stamina bar colour. */
function miniStaminaColor(v: number): string {
  if (v >= 70) return "bg-emerald-400";
  if (v >= 30) return "bg-amber-400";
  return "bg-red-400";
}

function formatMoney(v: number): string {
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}K`;
  return `€${v}`;
}

// ── Composable pitch slot (defensive — never crashes on empty) ──

function PitchSlot({
  slot,
  player,
  isSelected,
  onSelect,
}: {
  slot: { position: Position; x: number; y: number };
  player: Player | null;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const injured = player !== null && (player.injuryWeeks ?? 0) > 0;
  const circleColor = player
    ? getPlayerPositionColor(slot.position)
    : "bg-white/10 border-white/20 text-gray-400";
  const name = player?.name ?? "";
  const stamina = player?.stamina ?? 0;

  return (
    <button
      onClick={onSelect}
      className={`absolute flex flex-col items-center -translate-x-1/2 -translate-y-1/2 transition-all duration-200 cursor-pointer select-none touch-manipulation ${
        isSelected ? "z-20 scale-110" : "z-10 active:scale-105"
      }`}
      style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
    >
      {/* ── Circle ── */}
      <div className="relative">
        <div
          className={`w-8 h-8 lg:w-10 lg:h-10 min-w-[32px] min-h-[32px] rounded-full border-2 ${circleColor} flex items-center justify-center text-[9px] lg:text-[10px] font-black shadow-lg transition-colors ${
            isSelected ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-transparent" : ""
          } ${!player ? "border-dashed opacity-50" : ""}`}
        >
          {player ? (
            player.overall
          ) : (
            <span className="text-base lg:text-lg leading-none font-normal">+</span>
          )}
        </div>

        {/* Injury badge */}
        {injured && (
          <span
            className="absolute -top-1 -right-1 text-[10px] lg:text-xs leading-none z-30 drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]"
            title={`伤停 ${player!.injuryWeeks} 周`}
          >
            🤕
          </span>
        )}
      </div>

      {/* ── Name ── */}
      {player ? (
        <span className="text-[8px] lg:text-[9px] text-white font-semibold mt-0.5 bg-black/60 px-1 rounded truncate max-w-[60px] lg:max-w-[70px] leading-tight">
          {name || "?"}
        </span>
      ) : (
        <span className="text-[8px] lg:text-[9px] text-gray-500 mt-0.5 bg-black/40 px-1 rounded">
          空位
        </span>
      )}

      {/* ── Stamina bar + numeric value ── */}
      {player && (
        <div className="flex items-center gap-1 mt-0.5 w-10 lg:w-12">
          <div className="flex-1 h-1 lg:h-1.5 rounded-full bg-gray-700/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${miniStaminaColor(stamina)}`}
              style={{ width: `${Math.max(0, Math.min(100, stamina))}%` }}
            />
          </div>
          <span className="text-[8px] lg:text-[10px] text-gray-400 font-mono leading-none">
            {stamina}
          </span>
        </div>
      )}
    </button>
  );
}

// ── LineupPitch ────────────────────────────────────────────────

export function LineupPitch({
  team,
  onSwapSlot,
}: {
  team: Team;
  onSwapSlot: (idx: number, playerId: string) => void;
}) {
  const slots = useMemo(() => generatePitchSlots(team?.formation), [team?.formation]);
  const starterSet = useMemo(() => new Set(team?.starterIds ?? []), [team?.starterIds]);
  const players = team?.players ?? [];
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  // Map each visual slot index → Player | null（共享纯函数，三层兜底：
  // index → 位置匹配 → 剩余填充——顺序异常时 11 名球员依然全部渲染）
  const slotPlayers = useMemo(
    () => mapStartersToSlots(team?.starterIds, players, team?.formation),
    [players, team?.starterIds, team?.formation],
  );

  const selectedPos: Position | null =
    selectedSlot !== null ? (slots[selectedSlot]?.position ?? null) : null;

  // All healthy bench players, sorted GK→DEF→MID→FWD then by overall ↓
  const availableSubs = useMemo(() => {
    if (selectedSlot === null) return [];
    return players
      .filter((p) => !starterSet.has(p.id))
      .sort(
        (a, b) =>
          (posWeight[a.position] || 5) - (posWeight[b.position] || 5) || b.overall - a.overall,
      );
  }, [players, starterSet, selectedSlot]);

  const handlePick = (playerId: string) => {
    if (selectedSlot === null) return;
    onSwapSlot(selectedSlot, playerId);
    setSelectedSlot(null);
  };

  const filledCount = slotPlayers.filter(Boolean).length;

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 flex-1 min-h-0">
      {/* ── Pitch (mobile: full width; desktop: flex-1) ── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[11px] lg:text-xs text-gray-500 uppercase tracking-widest">
            首发阵容 · {filledCount}/11
          </span>
          {filledCount === 11 && (
            <span className="text-[10px] text-emerald-500 font-semibold">✓ 阵容完整</span>
          )}
        </div>

        {/* Pitch with aspect-ratio for consistent scaling */}
        <div className="w-full" style={{ aspectRatio: "3/4", maxHeight: "calc(100vh - 280px)" }}>
          <div
            className="w-full h-full relative rounded-xl overflow-hidden border-2 border-gray-700"
            style={{
              background:
                "linear-gradient(180deg, #1a3a1a 0%, #2d5a2d 30%, #3a6e3a 50%, #2d5a2d 70%, #1a3a1a 100%)",
            }}
          >
            {/* Pitch markings */}
            <div className="absolute inset-x-[15%] inset-y-0 border-x-2 border-white/10" />
            <div className="absolute inset-x-0 top-[50%] border-t-2 border-white/10" />
            <div className="absolute left-[20%] right-[20%] top-[35%] bottom-[35%] border-2 border-white/10 rounded-full" />
            <div className="absolute top-[50%] left-[50%] w-2 h-2 rounded-full bg-white/20 -translate-x-1/2 -translate-y-1/2" />

            {/* ── Slots — each rendered by safe PitchSlot sub-component ── */}
            {slots.map((slot, idx) => (
              <PitchSlot
                key={idx}
                slot={slot}
                player={slotPlayers[idx] ?? null}
                isSelected={selectedSlot === idx}
                onSelect={() =>
                  setSelectedSlot((prev) => (prev === idx ? null : idx))
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Player picker: sidebar (desktop) / bottom sheet (mobile) ── */}
      {/* Desktop sidebar */}
      <div className="hidden lg:flex w-64 shrink-0 flex-col min-h-0">
        <PlayerPicker
          selectedPos={selectedPos}
          availableSubs={availableSubs}
          onPick={handlePick}
          onClose={() => setSelectedSlot(null)}
        />
      </div>

      {/* Mobile bottom sheet overlay */}
      {selectedSlot !== null && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSelectedSlot(null)} />
          <div className="relative bg-gray-900 rounded-t-2xl border-t border-gray-700 max-h-[60vh] flex flex-col transition-transform duration-300">
            <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mt-3 mb-1" />
            <PlayerPicker
              selectedPos={selectedPos}
              availableSubs={availableSubs}
              onPick={handlePick}
              onClose={() => setSelectedSlot(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared player picker ─────────────────────────────────────

function PlayerPicker({
  selectedPos,
  availableSubs,
  onPick,
  onClose,
}: {
  selectedPos: string | null;
  availableSubs: Player[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  // ── Empty state: no slot selected ──
  if (selectedPos === null) {
    return (
      <div className="flex-1 rounded-xl border border-gray-800 bg-gray-900/50 flex items-center justify-center">
        <p className="text-xs text-gray-600 text-center px-4">
          点击场上位置槽位
          <br />
          选择或替换首发球员
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden rounded-xl lg:border lg:border-gray-700 lg:bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-gray-300">
          {selectedPos} 位置 · 选择球员
          <span className="text-gray-600 ml-1">({availableSubs.length} 人可用)</span>
        </span>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-sm cursor-pointer touch-manipulation min-w-[32px] min-h-[32px] flex items-center justify-center"
        >
          ✕
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {availableSubs.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-4">没有可用的替补球员</p>
        ) : (
          availableSubs.map((p) => {
            if (!p) return null;
            const stamina = p.stamina ?? 0;
            const name = p.name ?? "?";
            const injured = (p.injuryWeeks ?? 0) > 0;

            return (
              <button
                key={p.id}
                onClick={injured ? undefined : () => onPick(p.id)}
                disabled={injured}
                className={`flex items-center gap-3 px-3 py-3 lg:py-2 rounded-lg transition-colors text-left min-h-[44px] ${
                  injured
                    ? "bg-red-500/5 opacity-50 cursor-not-allowed"
                    : "hover:bg-gray-800 cursor-pointer touch-manipulation"
                }`}
              >
                {/* Overall circle — colour-coded, dimmed if injured */}
                <span
                  className={`w-8 h-8 lg:w-8 lg:h-8 rounded-full border-2 ${
                    injured ? "bg-red-500/30 border-red-500/50" : overallCircleColor(p.overall)
                  } flex items-center justify-center text-[10px] font-black shrink-0`}
                >
                  {p.overall}
                </span>

                <div className="flex-1 min-w-0">
                  {/* Name + position badge + injury tag */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        POS_COLORS[p.position] ?? "bg-gray-500 border-gray-400"
                      } leading-none shrink-0`}
                    >
                      {p.position}
                    </span>
                    <span className="text-sm lg:text-xs font-medium text-gray-200 truncate">
                      {name}
                    </span>
                    {injured && (
                      <span className="text-[10px] text-red-400 font-semibold shrink-0" title={`伤停 ${p.injuryWeeks} 周`}>
                        🩹 {p.injuryWeeks}周
                      </span>
                    )}
                  </div>

                  {/* Sub-info row: age · value · stamina bar */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-500">{p.age}岁</span>
                    <span className="text-[10px] text-gray-500">{formatMoney(p.value)}</span>
                    {/* Mini stamina bar */}
                    <div className="flex items-center gap-1">
                      <div className="w-10 h-1 rounded-full bg-gray-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${miniStaminaColor(stamina)}`}
                          style={{ width: `${Math.max(0, Math.min(100, stamina))}%` }}
                        />
                      </div>
                      <span
                        className={`text-[10px] font-mono font-semibold ${
                          stamina >= 70
                            ? "text-emerald-400"
                            : stamina >= 30
                              ? "text-amber-400"
                              : "text-red-400"
                        }`}
                      >
                        {stamina}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
