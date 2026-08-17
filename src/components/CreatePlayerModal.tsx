import { useState } from "react";
import { Position } from "../types/game";

const POSITIONS = [
  { key: Position.GK,  label: "GK 门将", icon: "🧤", desc: "att 5% / plm 10% / def 85%" },
  { key: Position.DEF, label: "DEF 后卫", icon: "🛡️", desc: "att 10% / plm 20% / def 70%" },
  { key: Position.MID, label: "MID 中场", icon: "⚽", desc: "att 30% / plm 50% / def 20%" },
  { key: Position.FWD, label: "FWD 前锋", icon: "🎯", desc: "att 70% / plm 20% / def 10%" },
];

const NATIONALITIES = ["中国","英格兰","西班牙","德国","意大利","法国","巴西","阿根廷","荷兰","葡萄牙","比利时","克罗地亚","日本","韩国","美国"];

interface Props {
  onCreate: (name: string, nationality: string, position: Position, age: number, attack: number, playmaking: number, defense: number, potential: number) => void;
  onCancel: () => void;
}

function Slider({ label, value, onChange, color }: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  const hex = color === "text-rose-400" ? "#fb7185" : color === "text-emerald-400" ? "#34d399" : color === "text-blue-400" ? "#60a5fa" : "#fbbf24";
  const bgHex = color === "text-rose-400" ? "#3b101b" : color === "text-emerald-400" ? "#052e14" : color === "text-blue-400" ? "#051a33" : "#2e1f05";
  const id = `slider-${label.replace(/\s+/g, "")}`;
  const pct = (value / 99) * 100;
  return (
    <div className="flex flex-col gap-1">
      <style>{`
        #${id}::-webkit-slider-runnable-track { height:8px; border-radius:4px; background:transparent; }
        #${id}::-webkit-slider-thumb {
          -webkit-appearance:none; appearance:none; width:20px; height:20px; border-radius:50%;
          background:${hex}; border:none; margin-top:-6px;
          box-shadow:0 1px 4px rgba(0,0,0,0.5); cursor:pointer; transition:transform .12s;
        }
        #${id}::-webkit-slider-thumb:hover { transform:scale(1.25); }
        #${id}::-moz-range-track { height:8px; border-radius:4px; background:${bgHex}; }
        #${id}::-moz-range-progress { height:8px; border-radius:4px; background:${hex}; }
        #${id}::-moz-range-thumb {
          width:20px; height:20px; border-radius:50%; background:${hex};
          border:none; box-shadow:0 1px 4px rgba(0,0,0,0.5); cursor:pointer;
        }
      `}</style>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-400">{label}</span>
        <span className={`text-sm font-black font-mono ${color}`}>{value}</span>
      </div>
      <input
        id={id}
        type="range" min={1} max={99} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full appearance-none cursor-pointer"
        style={{
          height: "8px",
          borderRadius: "4px",
          background: `linear-gradient(to right, ${hex} 0%, ${hex} ${pct}%, ${bgHex} ${pct}%, ${bgHex} 100%)`,
          accentColor: hex,
        }}
      />
    </div>
  );
}

export function CreatePlayerModal({ onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const [nationality, setNationality] = useState("中国");
  const [position, setPosition] = useState<Position>(Position.MID);
  const [age, setAge] = useState(20);
  const [attack, setAttack] = useState(65);
  const [playmaking, setPlaymaking] = useState(65);
  const [defense, setDefense] = useState(65);
  const [potential, setPotential] = useState(80);
  const [customNation, setCustomNation] = useState("");

  const canSubmit = name.trim().length >= 2;

  // Live OVR preview
  const ovr = (() => {
    switch (position) {
      case Position.FWD: return Math.round(attack * 0.70 + playmaking * 0.20 + defense * 0.10);
      case Position.MID: return Math.round(attack * 0.30 + playmaking * 0.50 + defense * 0.20);
      case Position.DEF: return Math.round(attack * 0.10 + playmaking * 0.20 + defense * 0.70);
      case Position.GK:  return Math.round(attack * 0.05 + playmaking * 0.10 + defense * 0.85);
      default: return 0;
    }
  })();

  const ovrColor = ovr >= 85 ? "text-yellow-400" : ovr >= 75 ? "text-emerald-400" : ovr >= 65 ? "text-blue-400" : "text-gray-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-[640px] max-w-[95vw] max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-8 py-6 border-b border-gray-800">
          <h2 className="text-xl font-black text-white">🧑 创建你的球员</h2>
          <p className="text-xs text-gray-500 mt-1">自由定制属性 · 位置加权 OVR · 硬核成长系统</p>
        </div>

        <div className="px-8 py-6 flex flex-col gap-5">
          {/* Name + Age */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">球员姓名</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="输入名字..." maxLength={30}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-600 outline-none focus:border-purple-500 transition-colors" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">年龄 ({age}岁)</label>
              <style>{`
                #slider-age::-webkit-slider-runnable-track { height:8px; border-radius:4px; background:transparent; }
                #slider-age::-webkit-slider-thumb {
                  -webkit-appearance:none; appearance:none; width:20px; height:20px; border-radius:50%;
                  background:#a78bfa; border:none; margin-top:-6px;
                  box-shadow:0 1px 4px rgba(0,0,0,0.5); cursor:pointer; transition:transform .12s;
                }
                #slider-age::-webkit-slider-thumb:hover { transform:scale(1.25); }
                #slider-age::-moz-range-track { height:8px; border-radius:4px; background:#2a1a3a; }
                #slider-age::-moz-range-progress { height:8px; border-radius:4px; background:#a78bfa; }
                #slider-age::-moz-range-thumb {
                  width:20px; height:20px; border-radius:50%; background:#a78bfa;
                  border:none; box-shadow:0 1px 4px rgba(0,0,0,0.5); cursor:pointer;
                }
              `}</style>
              <input id="slider-age" type="range" min={15} max={40} value={age} onChange={(e) => setAge(Number(e.target.value))}
                className="w-full appearance-none cursor-pointer mt-3"
                style={{
                  height: "8px", borderRadius: "4px",
                  background: `linear-gradient(to right, #a78bfa 0%, #a78bfa ${((age - 15) / 25) * 100}%, #2a1a3a ${((age - 15) / 25) * 100}%, #2a1a3a 100%)`,
                }} />
              <div className="flex justify-between text-[9px] text-gray-600 mt-1"><span>15</span><span>40</span></div>
            </div>
          </div>

          {/* Nationality */}
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">国籍</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {NATIONALITIES.map((n) => (
                <button key={n} onClick={() => { setNationality(n); setCustomNation(""); }}
                  className={`px-3 py-1 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer select-none ${
                    nationality === n ? "bg-purple-500/20 border-purple-500/50 text-purple-300" : "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600"}`}>{n}</button>
              ))}
            </div>
            <input type="text" value={customNation} onChange={(e) => { setCustomNation(e.target.value); if (e.target.value) setNationality(e.target.value); }}
              placeholder="或输入自定义国籍..." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400 placeholder-gray-600 outline-none" />
          </div>

          {/* Position */}
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">场上位置</label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((p) => (
                <button key={p.key} onClick={() => setPosition(p.key)}
                  className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl border transition-all cursor-pointer select-none ${
                    position === p.key ? "bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.15)]" : "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600"}`}>
                  <span className="text-lg">{p.icon}</span>
                  <span className="text-[10px] font-bold">{p.label}</span>
                  <span className="text-[8px] text-gray-600">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Attributes */}
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 block">属性分配 (1-99)</label>
            <div className="flex flex-col gap-3">
              <Slider label="⚔️ 进攻 (Attack)" value={attack} onChange={setAttack} color="text-rose-400" />
              <Slider label="🎯 组织盘带 (Playmaking)" value={playmaking} onChange={setPlaymaking} color="text-emerald-400" />
              <Slider label="🛡️ 防守 (Defense)" value={defense} onChange={setDefense} color="text-blue-400" />
              <Slider label="📈 潜力 (Potential)" value={potential} onChange={setPotential} color="text-yellow-400" />
            </div>
          </div>

          {/* Preview */}
          {canSubmit && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">球员预览</p>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-purple-500/20 border-2 border-purple-500/40 flex items-center justify-center text-2xl">
                  {POSITIONS.find((p) => p.key === position)?.icon ?? "⚽"}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">{name || "?"} · <span className="text-purple-400">{position}</span></p>
                  <p className="text-[10px] text-gray-500">{nationality} · {age}岁 · POT {potential}</p>
                  <div className="flex gap-3 mt-1 text-[10px] font-mono">
                    <span className="text-rose-400">ATT {attack}</span>
                    <span className="text-emerald-400">PLM {playmaking}</span>
                    <span className="text-blue-400">DEF {defense}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-500">总评 OVR</p>
                  <p className={`text-3xl font-black ${ovrColor}`}>{ovr}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-8 py-5 border-t border-gray-800 flex items-center gap-3">
          <button onClick={onCancel} className="px-6 py-2.5 rounded-xl border border-gray-700 text-gray-500 hover:text-gray-300 text-sm font-semibold transition-colors cursor-pointer select-none">返回</button>
          <button onClick={() => canSubmit && onCreate(name.trim(), nationality, position, age, attack, playmaking, defense, potential)} disabled={!canSubmit}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all cursor-pointer select-none ${
              canSubmit ? "bg-gradient-to-r from-purple-600 to-indigo-500 text-white hover:from-purple-500 hover:to-indigo-400 shadow-lg shadow-purple-500/20" : "bg-gray-800 text-gray-600 cursor-not-allowed"}`}>
            创建并继续 →
          </button>
        </div>
      </div>
    </div>
  );
}
