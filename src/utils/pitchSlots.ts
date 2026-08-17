import { Position, FORMATION_SLOTS, type Player } from "../types/game";

/**
 * 战术板槽位生成器（共享）：按球队真实阵型生成 11 个槽位的
 * 百分比坐标（GK→DEF→MID→FWD 顺序，与 autoStarterIds 的输出顺序一致）。
 * 阵型缺失/非法时回退 4-3-3。曾修复：生涯只读战术板硬编码 4-3-3 坐标，
 * 阵型变化时外场球员渲染错位/消失（"只剩门将"）。
 */

const Y_MAP: Record<Position, number> = {
  [Position.GK]: 88,
  [Position.DEF]: 70,
  [Position.MID]: 45,
  [Position.FWD]: 22,
};

export interface PitchSlot {
  position: Position;
  x: number; // 百分比 0-100
  y: number; // 百分比 0-100
}

export function generatePitchSlots(formation: string | undefined): PitchSlot[] {
  const build = (fmt: string): PitchSlot[] => {
    const slots = (FORMATION_SLOTS as Record<string, Record<Position, number>>)[fmt]
      ?? FORMATION_SLOTS["4-3-3"];
    const result: PitchSlot[] = [];
    for (const pos of [Position.GK, Position.DEF, Position.MID, Position.FWD] as Position[]) {
      const count = slots?.[pos] ?? 0;
      for (let i = 0; i < count; i++) {
        const x = count === 1 ? 50 : 10 + (80 / (count - 1)) * i;
        result.push({ position: pos, x, y: Y_MAP[pos] ?? 50 });
      }
    }
    // 严格坐标兜底：任何 NaN/越界坐标 → 回退标准 4-3-3 默认坐标
    const valid = result.length === 11 && result.every(
      (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100,
    );
    return valid ? result : build("4-3-3");
  };
  return build(formation ?? "4-3-3");
}

/**
 * 首发 → 槽位纯函数映射（战术板渲染唯一数据源），三层兜底：
 *   ① 按 index 一一对应（starterIds 约定顺序 = GK→DEF→MID→FWD）
 *   ② 空槽按位置匹配剩余首发（顺序异常时的修复——绝不让外场球员消失）
 *   ③ 仍空则按序填充剩余首发
 * 无论数据顺序如何，11 名球员的图标 100% 稳定呈现在球场上。
 */
export function mapStartersToSlots(
  starterIds: string[] | undefined,
  players: Player[] | undefined,
  formation?: string | undefined,
): (Player | null)[] {
  const slots = generatePitchSlots(formation);
  const result: (Player | null)[] = slots.map(() => null);
  const playerMap = new Map<string, Player>((players ?? []).map((p) => [p.id, p]));
  const ids = (starterIds ?? []).filter((id) => playerMap.has(id));

  // ① index 优先映射
  const slotCount = slots.length;
  for (let i = 0; i < slotCount && i < ids.length; i++) {
    result[i] = playerMap.get(ids[i]) ?? null;
  }

  // ② 位置匹配兜底：空槽按槽位位置匹配未上场的首发球员
  const usedIds = new Set(ids.slice(0, slotCount));
  const unusedIds = ids.filter((id) => !usedIds.has(id));
  for (let i = 0; i < slotCount; i++) {
    if (result[i]) continue;
    const idx = unusedIds.findIndex((id) => playerMap.get(id)!.position === slots[i].position);
    if (idx >= 0) {
      result[i] = playerMap.get(unusedIds[idx]) ?? null;
      unusedIds.splice(idx, 1);
    }
  }

  // ③ 最终兜底：剩余空槽由剩余首发按序填充（保证 11 人全部渲染）
  let u = 0;
  for (let i = 0; i < slotCount; i++) {
    if (!result[i] && u < unusedIds.length) {
      result[i] = playerMap.get(unusedIds[u]) ?? null;
      u++;
    }
  }
  return result;
}
