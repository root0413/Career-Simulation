import type { CalendarMatchday } from "../types/game";

/**
 * 欧战各阶段的轮数配置（共享给 matchLabel.ts 推导阶段内轮次）。
 * `rounds` 为各阶段的比赛轮数，按日历顺序累计为全局欧战轮次 1..17。
 */
export const EURO_STAGES: { rounds: number; stage: string; name: string }[] = [
  { rounds: 8, stage: "联赛阶段", name: "欧战 联赛阶段" },
  { rounds: 2, stage: "淘汰赛附加赛", name: "欧战 附加赛" },
  { rounds: 2, stage: "16强", name: "欧战 1/8决赛" },
  { rounds: 2, stage: "8强", name: "欧战 1/4决赛" },
  { rounds: 2, stage: "半决赛", name: "欧战 半决赛" },
  { rounds: 1, stage: "决赛", name: "欧战 决赛" },
];

/**
 * Season calendar: ALL league rounds first, then European phase at season end.
 * Qualified teams play European matches; unqualified teams skip directly to new season.
 */
export function generateCalendar(totalRounds = 38): CalendarMatchday[] {
  const calendar: CalendarMatchday[] = [];
  let id = 0;

  // ── Phase 1: All domestic league rounds ──
  for (let r = 1; r <= totalRounds; r++) {
    calendar.push({ id: ++id, type: "league", round: r, name: `联赛 第${r}轮` });
  }

  // ── Phase 2: European competition (post-league, for qualified teams only) ──
  let euroRound = 0;
  for (const stage of EURO_STAGES) {
    for (let r = 1; r <= stage.rounds; r++) {
      euroRound++;
      calendar.push({
        id: ++id,
        type: "european",
        round: euroRound,
        stage: stage.stage,
        name: `${stage.name} 第${r}轮`,
      });
    }
  }

  console.log(
    `[calendar] Generated ${calendar.length} matchdays (${calendar.filter((c) => c.type === "league").length} league + ${calendar.filter((c) => c.type === "european").length} european)`,
  );
  return calendar;
}
