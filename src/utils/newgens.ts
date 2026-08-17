import { Position, type Player } from "../types/game";
import { marketValue } from "./marketValue";
import { generateUUID } from "./uuid";

/**
 * 每赛季末 U21 青训造血：为各俱乐部生成随机新秀（Newgens）。
 * 俱乐部实力（首发平均 OVR + 声望）越强，新秀潜力上限越高——
 * 超级豪门的 U21 能涌现 90+ 潜力的顶级妖人，小俱乐部青训上限相对较低。
 */

function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 按俱乐部有效实力分层决定新秀潜力区间 */
export function potentialBandFor(clubStrength: number): { min: number; max: number; eliteChance: number } {
  if (clubStrength >= 88) return { min: 72, max: 95, eliteChance: 0.15 }; // 超级豪门：15% 概率 90-95
  if (clubStrength >= 82) return { min: 66, max: 88, eliteChance: 0.05 };
  if (clubStrength >= 76) return { min: 60, max: 80, eliteChance: 0 };
  return { min: 52, max: 72, eliteChance: 0 };
}

function randomPosition(rng: () => number): Position {
  const r = rng();
  if (r < 0.05) return Position.GK;
  if (r < 0.45) return Position.DEF;
  if (r < 0.80) return Position.MID;
  return Position.FWD;
}

/** 按位置生成攻防属性（与 DB 生成器同构） */
function attributesFor(pos: Position, overall: number): { attack: number; defense: number } {
  switch (pos) {
    case Position.GK: return { attack: clamp(rand(10, 25), 5, 30), defense: clamp(rand(overall, overall + 5), 40, 99) };
    case Position.DEF: return { attack: clamp(rand(overall - 20, overall - 10), 20, 70), defense: clamp(rand(overall, overall + 5), 40, 99) };
    case Position.MID: return { attack: clamp(rand(overall - 3, overall + 3), 30, 90), defense: clamp(rand(overall - 8, overall - 2), 30, 90) };
    case Position.FWD: return { attack: clamp(rand(overall, overall + 6), 40, 99), defense: clamp(rand(overall - 32, overall - 24), 10, 60) };
  }
}

const FIRST_NAMES = ["Lucas", "Mateo", "Enzo", "Noah", "Leo", "Marco", "Alessandro", "Kylian", "Toni", "Iker", "Rafael", "Nico", "Theo", "Julian", "Owen", "Pedro"];
const LAST_NAMES = ["Silva", "Costa", "Moreno", "Ferrari", "Braun", "Dubois", "Rossi", "Vidal", "Klein", "Wagner", "Lopez", "Martins", "Nakamura", "Bauer", "Greco", "Fischer"];

/** 生成一名 U21 新秀（16-19 岁；当前 OVR 低于潜力 12-18 点，代表成长空间） */
export function generateNewgen(clubStrength: number, rng: () => number = Math.random): Player {
  const band = potentialBandFor(clubStrength);
  const pos = randomPosition(rng);
  const age = rand(16, 19);
  let potential: number;
  if (band.eliteChance > 0 && rng() < band.eliteChance) {
    potential = rand(90, 95); // 顶级妖人
  } else {
    potential = rand(band.min, Math.min(band.max, 89));
  }
  const overall = clamp(potential - rand(12, 18), 45, 82);
  const { attack, defense } = attributesFor(pos, overall);
  const name = `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]}`;
  return {
    id: generateUUID(),
    name,
    age,
    position: pos,
    attack,
    defense,
    stamina: clamp(rand(55, 75), 30, 90),
    injuryWeeks: 0,
    potential,
    overall,
    value: marketValue(overall, potential, age),
  };
}

/** 为一家俱乐部生成 2-4 名新秀 */
export function generateNewgens(clubStrength: number, rng: () => number = Math.random): Player[] {
  const count = 2 + Math.floor(rng() * 3);
  return Array.from({ length: count }, () => generateNewgen(clubStrength, rng));
}
