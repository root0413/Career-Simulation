import { Position } from "../types/game";

/**
 * 外部球员数据导入管线（纯函数）：
 * 位置映射（LWF→FWD 等）、OVR/POT 校验、JSON/CSV 解析、按名去重（保留 OVR 更高者）。
 * 供 bundled 数据集（laLigaTeams.json）与 scripts/import-players.ts 共用。
 */

/** 外部位置名 → 游戏标准位置（GK/DEF/MID/FWD） */
export const POSITION_MAP: Record<string, Position> = {
  // 游戏标准位置（必须存在，否则自身数据也会被清洗掉）
  GK: Position.GK, DEF: Position.DEF, MID: Position.MID, FWD: Position.FWD,
  // 常见外部数据位置（FIFA/FC 风格）
  LWF: Position.FWD, RWF: Position.FWD, LW: Position.FWD, RW: Position.FWD,
  ST: Position.FWD, CF: Position.FWD, SS: Position.FWD, LF: Position.FWD, RF: Position.FWD,
  CAM: Position.MID, CM: Position.MID, CDM: Position.MID, LM: Position.MID, RM: Position.MID,
  AMF: Position.MID, DMF: Position.MID,
  CB: Position.DEF, LB: Position.DEF, RB: Position.DEF, LWB: Position.DEF, RWB: Position.DEF, SW: Position.DEF,
};

export interface ImportedPlayerRecord {
  name: string;
  position: Position;
  age: number;
  overall: number;
  potential: number;
  club: string; // 归属俱乐部名（用于关联）
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** 位置归一化：无法识别返回 null（该记录被丢弃） */
export function normalizePosition(raw: string): Position | null {
  const key = String(raw ?? "").trim().toUpperCase();
  if (key === "") return null;
  return POSITION_MAP[key] ?? null;
}

/**
 * 清洗单条外部记录：
 * - 位置映射（LWF/RW/CAM 等 → 游戏标准位置；无法识别 → null 丢弃）
 * - OVR/POT 校验并钳制到 40-99；POT 不得低于 OVR
 * - 年龄钳制 15-45；姓名为空 → null
 */
export function cleanPlayerRecord(raw: Record<string, unknown>): ImportedPlayerRecord | null {
  const name = String(raw.name ?? raw.Name ?? "").trim();
  if (!name) return null;

  const rawPos = String(raw.position ?? raw.Position ?? raw.pos ?? "");
  const position = normalizePosition(rawPos);
  if (!position) return null;

  const age = Number(raw.age ?? raw.Age ?? 25);
  const overall = Number(raw.overall ?? raw.Overall ?? raw.ovr ?? 50);
  const potential = Number(raw.potential ?? raw.Potential ?? raw.pot ?? overall);
  if (!Number.isFinite(age) || !Number.isFinite(overall)) return null;

  const ovr = clampInt(overall, 40, 99);
  const pot = clampInt(Math.max(potential, overall), 40, 99);
  const club = String(raw.club ?? raw.Club ?? raw.team ?? "").trim();

  return {
    name,
    position,
    age: clampInt(age, 15, 45),
    overall: ovr,
    potential: Math.max(ovr, pot),
    club,
  };
}

/**
 * 按名去重（仅 incoming 与 existing 之间）：
 * - incoming 球员名与 existing 冲突时，保留 OVR 更高者；
 *   OVR 相同则保留潜力更高者，或仅更新俱乐部信息。
 * - existing 内部同名球员（不同俱乐部的同名者）互不折叠。
 */
export function dedupePlayers(
  existing: ImportedPlayerRecord[],
  incoming: ImportedPlayerRecord[],
): ImportedPlayerRecord[] {
  const out = [...existing];
  const index = new Map<string, number>(); // name(lower) → out 下标（首个）
  existing.forEach((p, i) => {
    const key = p.name.toLowerCase().trim();
    if (!index.has(key)) index.set(key, i);
  });

  for (const p of incoming) {
    const key = p.name.toLowerCase().trim();
    const idx = index.get(key);
    if (idx === undefined) {
      out.push(p);
      index.set(key, out.length - 1);
      continue;
    }
    const cur = out[idx];
    if (p.overall > cur.overall || (p.overall === cur.overall && p.potential > cur.potential)) {
      out[idx] = p; // 更高 OVR 的新数据顶替旧记录
    } else if (p.overall === cur.overall && p.club !== cur.club && p.club !== "") {
      out[idx] = { ...cur, club: p.club }; // 仅更新俱乐部信息
    }
  }
  return out;
}

/** 解析 JSON 文本（顶层数组 或 { players: [...] }） */
export function parsePlayersJSON(text: string): Record<string, unknown>[] {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object" && Array.isArray((data as { players?: unknown }).players)) {
    return (data as { players: unknown[] }).players as Record<string, unknown>[];
  }
  return [];
}

/** 解析 CSV 文本（首行为表头：name,position,age,overall,potential,club） */
export function parsePlayersCSV(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, unknown>[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    rows.push(row);
  }
  return rows;
}

/**
 * 完整导入管线：解析 → 清洗 → 去重（与已有球员按名合并，保留 OVR 更高者）。
 */
export function importPlayerData(
  text: string,
  format: "json" | "csv",
  existing: ImportedPlayerRecord[] = [],
): ImportedPlayerRecord[] {
  const rawRows = format === "json" ? parsePlayersJSON(text) : parsePlayersCSV(text);
  const cleaned = rawRows
    .map((r) => cleanPlayerRecord(r))
    .filter((p): p is ImportedPlayerRecord => p !== null);
  return dedupePlayers(existing, cleaned);
}
