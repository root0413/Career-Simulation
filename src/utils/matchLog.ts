import type { CalendarMatchday, CareerMatchLogEntry, EuropeanStatus } from "../types/game";
import { EURO_STAGES } from "./calendar";

/**
 * 比赛记录展示逻辑（语义化标签 + 赛段分组）— 替代过去模糊的 "R1/R2" 标注。
 *
 * 标签规则：
 *   本土联赛：     联赛第 29 轮
 *   欧战联赛阶段：  欧冠联赛阶段 第 1 轮
 *   两回合淘汰赛：  欧冠 1/8 决赛 首回合 / 次回合
 *   决赛（单场）：  欧冠 决赛
 */

/** 赛事中文名（日历只区分 league/european，具体赛事在记录时由 tournament 提供） */
export const COMPETITION_NAMES: Record<Exclude<EuropeanStatus, "NONE">, string> = {
  UCL: "欧冠",
  UEL: "欧联",
  UECL: "欧协联",
};

/** 淘汰赛阶段 → 展示名 */
const KO_STAGE_NAMES: Record<string, string> = {
  "淘汰赛附加赛": "附加赛",
  "16强": "1/8 决赛",
  "8强": "1/4 决赛",
  "半决赛": "半决赛",
};

/**
 * 欧战全局轮次（1..17）→ 阶段内轮次（1..8 / 1..2 / 1）。
 * 依据 EURO_STAGES 的轮数累计偏移推导，与 generateCalendar 同源。
 */
export function getStageRound(md: CalendarMatchday): number {
  let acc = 0;
  for (const st of EURO_STAGES) {
    if (st.stage === md.stage) return md.round - acc;
    acc += st.rounds;
  }
  return md.round;
}

/**
 * 生成语义化轮次标签。
 * @param md          日历场次（记录日志时传入即将开打的 mdPlayed）
 * @param competition 欧战赛事类型；联赛比赛传 null/undefined 即可
 */
export function formatMatchdayLabel(
  md: CalendarMatchday,
  competition: EuropeanStatus | null | undefined,
): string {
  if (md.type === "league") return `联赛第 ${md.round} 轮`;

  const comp = competition && competition !== "NONE" ? COMPETITION_NAMES[competition] : "欧战";
  const stageRound = getStageRound(md);

  if (md.stage === "联赛阶段") return `${comp}联赛阶段 第 ${stageRound} 轮`;
  if (md.stage === "决赛") return `${comp} 决赛`; // 决赛为单场，无首/次回合

  const stageName = KO_STAGE_NAMES[md.stage ?? ""] ?? "淘汰赛";
  const leg = stageRound === 1 ? "首回合" : "次回合";
  return `${comp} ${stageName} ${leg}`;
}

/**
 * 按赛段对连续记录分组：相同 phase（且相同赛事）的连续记录归入一组。
 * 联赛→欧战交叉点处会切分，保证两个赛段的记录绝不混排。
 */
export function groupMatchLogEntries(entries: CareerMatchLogEntry[]): {
  phase: CareerMatchLogEntry["phase"];
  competition: EuropeanStatus | null;
  entries: CareerMatchLogEntry[];
}[] {
  const groups: {
    phase: CareerMatchLogEntry["phase"];
    competition: EuropeanStatus | null;
    entries: CareerMatchLogEntry[];
  }[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.phase === e.phase && last.competition === e.competition) {
      last.entries.push(e);
    } else {
      groups.push({ phase: e.phase, competition: e.competition, entries: [e] });
    }
  }
  return groups;
}
