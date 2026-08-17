/**
 * 球员生命周期：老将自主退役概率判定（纯函数）。
 * 赛季结束结算阶段调用——35 岁起小概率退役，年龄越大概率越高；
 * 状态下滑（OVR 偏低）的老将更早挂靴。
 */
export function retirementChance(age: number, overall: number): number {
  if (age < 35) return 0;
  const base =
    age >= 40 ? 0.90
    : age === 39 ? 0.75
    : age === 38 ? 0.55
    : age === 37 ? 0.35
    : age === 36 ? 0.20
    : 0.10; // 35
  // 状态因素：已明显下滑的老将退役意愿更高
  const formFactor = overall < 75 ? 1.3 : 1.0;
  return Math.min(1, base * formFactor);
}
