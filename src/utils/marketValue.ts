/**
 * 统一球员身价体系——贴合现代足坛转会市场通胀：
 *   - 巅峰上限 €200M：OVR 95+ 顶级巨星 / 金球奖得主 / 年轻顶级妖人可触及
 *   - 主力球星（OVR 85-90）区间 €70M-130M；优秀轮换与潜力新星按 OVR/POT/年龄梯度放大
 *   - 老将（29+）按年龄折扣，青训潜力溢价（POT > OVR 时上浮）
 */

export const VALUE_CEILING = 200_000_000;

export function marketValue(overall: number, potential?: number, age?: number): number {
  // 基准：OVR 99 → €200M 上限；每低 30 点 OVR 贬值 10 倍（对数梯度）
  const base = VALUE_CEILING * 10 ** ((overall - 99) / 30);

  // 潜力溢价：年轻球员成长空间上浮至多 50%
  const potFactor =
    potential !== undefined && potential > overall
      ? 1 + Math.min(0.5, ((potential - overall) / 100) * 1.5)
      : 1;

  // 年龄曲线：23 岁以下溢价，29 岁起递减
  const ageFactor =
    age === undefined ? 1
    : age <= 23 ? 1.3
    : age <= 28 ? 1.0
    : age <= 31 ? 0.7
    : age <= 34 ? 0.4
    : 0.25;

  const raw = Math.min(VALUE_CEILING, base * potFactor * ageFactor);
  return Math.round(raw / 100_000) * 100_000; // 取整到 €0.1M
}
