import { type Formation, type Tactic, ALL_FORMATIONS, FORMATION_SLOTS, Position } from "../types/game";

const TACTICS: { value: Tactic; label: string; icon: string; desc: string }[] = [
  { value: "attacking", label: "全线压上", icon: "⚔️", desc: "进攻 +15% / 防守 −15%" },
  { value: "balanced",  label: "攻守平衡", icon: "⚖️", desc: "无修正" },
  { value: "defensive", label: "摆大巴",   icon: "🛡️", desc: "防守 +15% / 进攻 −15%" },
];

function MiniPitch({ formation }: { formation: Formation }) {
  const slots = FORMATION_SLOTS[formation];
  const rows = [
    { key: Position.GK,  count: slots[Position.GK] },
    { key: Position.DEF, count: slots[Position.DEF] },
    { key: Position.MID, count: slots[Position.MID] },
    { key: Position.FWD, count: slots[Position.FWD] },
  ];

  return (
    <div className="flex flex-col items-center gap-[2px] py-1">
      {rows.map((row) => (
        <div key={row.key} className="flex justify-center gap-[2px]">
          {Array.from({ length: row.count }, (_, i) => (
            <span key={i} className="inline-block w-[5px] h-[5px] rounded-full bg-current opacity-70" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TacticsPanel({
  formation,
  tactic,
  onChangeFormation,
  onChangeTactic,
}: {
  formation: Formation;
  tactic: Tactic;
  onChangeFormation: (f: Formation) => void;
  onChangeTactic: (t: Tactic) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gradient-to-b from-gray-800 to-gray-900 overflow-hidden">
      <div className="bg-gray-900/80 px-5 py-3 text-sm font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-700/50">
        ⚙️ 战术面板
      </div>

      {/* Formation */}
      <div className="px-4 py-4 border-b border-gray-700/30">
        <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">阵型</div>
        <div className="grid grid-cols-2 gap-2">
          {ALL_FORMATIONS.map((f) => {
            const active = formation === f;
            return (
              <button
                key={f}
                onClick={() => onChangeFormation(f)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all duration-200 cursor-pointer select-none ${
                  active
                    ? "border-purple-500/50 bg-purple-500/10 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.15)]"
                    : "border-gray-700/50 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:bg-gray-800 hover:text-gray-200"
                }`}
              >
                <span className={active ? "text-purple-400" : "text-gray-600"}>
                  <MiniPitch formation={f} />
                </span>
                <span className={`text-sm font-mono font-bold ${active ? "text-purple-300" : "text-gray-400"}`}>
                  {f}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mentality */}
      <div className="px-4 py-4">
        <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">战术心态</div>
        <div className="flex flex-col gap-2">
          {TACTICS.map((t) => {
            const active = tactic === t.value;
            return (
              <button
                key={t.value}
                onClick={() => onChangeTactic(t.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all duration-200 cursor-pointer select-none ${
                  active
                    ? t.value === "attacking"
                      ? "border-red-500/40 bg-red-500/10 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.12)]"
                      : t.value === "balanced"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.12)]"
                        : "border-blue-500/40 bg-blue-500/10 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.12)]"
                    : "border-gray-700/50 bg-gray-800/40 text-gray-500 hover:border-gray-600 hover:bg-gray-800 hover:text-gray-300"
                }`}
              >
                <span className="text-lg">{t.icon}</span>
                <div className="flex flex-col">
                  <span className={`text-sm font-semibold ${active ? "" : "text-gray-400"}`}>
                    {t.label}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">{t.desc}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
