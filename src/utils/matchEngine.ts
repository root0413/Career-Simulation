import {
  Position,
  MatchEventType,
  FORMATION_SLOTS,
  type Team,
  type Player,
  type MatchResult,
  type StartingXI,
  type Tactic,
  type Formation,
} from "../types/game";

// ── Constants ───────────────────────────────────────────────

// 全局进球效率校准（真实足坛区间）：场均两队总进球 2.0-3.2 球，
// 顶级前锋单季 28-42 球上限——杜绝 63 球/季与 6-0、7-2 式大比分。
const BASE_GOAL_RATE = 0.011;
const HOME_ADVANTAGE = 1.08;
const DICE_RANGE_MIN = 0.6;   // 收窄随机骰（原 0.2-1.8 的 9 倍波动会淹没实力差）
const DICE_RANGE_MAX = 1.4;
/** 实力差指数放大系数：进球期望 ∝ (攻/防)^GAP_POWER —— 线性比值（1.2×）压缩差距，
 *  幂指数使 OVR 差 15 的豪门对弱队期望胜率达到 75-90%+ */
const GAP_POWER = 4.5;
const DEFAULT_FORMATION: Formation = "4-4-2";
const DEFAULT_TACTIC: Tactic = "balanced";

// Injury constants — light-knock skewed: 伤病时长向轻伤倾斜（1-8 周，均值 ~2.8），
// 避免场均 6.5 周的主力伤缺把实力信号完全淹没（曾致拜仁 73→57 分、豪门沉沦）
const INJURY_BASE_CHANCE = 0.00002;
const INJURY_MIN_WEEKS = 1;
const INJURY_MAX_WEEKS = 8;

/** 轻伤倾斜的伤病周数：pow(rand, 1.6) 使 1-3 周轻伤占大多数，7-8 周重伤稀少 */
function rollInjuryWeeks(): number {
  const heavy = Math.pow(Math.random(), 1.6);
  return INJURY_MIN_WEEKS + Math.floor(heavy * (INJURY_MAX_WEEKS - INJURY_MIN_WEEKS + 1));
}

// ── Team prestige (声望/底蕴，等效 OVR 加成) ─────────────────

const TEAM_PRESTIGE: Record<string, number> = {
  // 真实豪门（teamsDatabase 英文名）
  "Manchester City": 2, "Arsenal": 1.5, "Liverpool": 2, "Man Utd": 1.5, "Chelsea": 1.5,
  "Lombardia FC": 1.5, "Milano FC": 1.5, "Juventus": 1.5, "SSC Napoli": 1,
  "FC Bayern München": 2, "Borussia Dortmund": 1.5, "Leverkusen": 1.5, "RB Leipzig": 1.5,
  "Paris SG": 2, "AS Monaco": 1,
  // 西甲
  "Real Madrid": 2, "FC Barcelona": 2, "Atlético Madrid": 1.5,
  // 虚拟欧战豪门（europeanEngine VIRTUAL_TEAMS 中文名）
  "曼城蓝月": 2, "慕尼黑FC": 2, "马德里红白": 2, "巴塞罗那竞技": 2,
  "红军利物浦": 1.5, "巴黎圣日耳曼": 2, "米兰红黑": 1.5, "都灵斑马": 1.5,
  "枪手红白": 1.5, "多特黄黑": 1.5, "切尔西蓝": 1.5, "曼联红魔": 1.5,
  "皇家蓝军": 1.5, "那不勒斯蓝": 1, "勒沃库森": 1.5, "莱比锡红牛": 1.5,
};

/** 球队声望/底蕴加成（等效 OVR） */
export function teamPrestige(teamName: string): number {
  return TEAM_PRESTIGE[teamName] ?? 0;
}

// ── 欧战专属豪门权重（European Elite Boost）───────────────────
// 修复：真实数据库豪门（曼城均分 ~82）在欧冠面对虚拟豪门（88-90）长期吃亏，
// 导致 16 个赛季进不了 16 强。欧战模拟中给 curated 超级豪门额外等效 OVR，
// 保证 OVR 顶级豪门在欧洲赛场的统治力与晋级权重（只影响欧战，不影响国内联赛）。

const EURO_ELITE_BOOST: Record<string, number> = {
  // Tier 1（+8）：绝对豪门
  "Manchester City": 8, "FC Bayern München": 8, "Paris SG": 8,
  "Real Madrid": 8, "FC Barcelona": 8,
  // Tier 2（+6）
  "Arsenal": 6, "Liverpool": 6, "Lombardia FC": 6, "Milano FC": 6, "Juventus": 6, "Atlético Madrid": 6,
  // Tier 3（+4）
  "Chelsea": 4, "Man Utd": 4, "Borussia Dortmund": 4, "Leverkusen": 4, "RB Leipzig": 4, "SSC Napoli": 4,
  "AS Monaco": 2,
};

/** 欧战专属权重（simulateMatch 的 european 上下文生效；国内联赛不受影响） */
export function europeanEliteBoost(teamName: string): number {
  return EURO_ELITE_BOOST[teamName] ?? 0;
}

/**
 * Gentler non-linear injury risk based on stamina.
 *   stamina ≥ 80  →  multiplier = 0    (immune)
 *   stamina = 50  →  multiplier ≈ 0.5  (moderate)
 *   stamina = 30  →  multiplier ≈ 1.5  (elevated)
 *   stamina = 10  →  multiplier ≈ 3.0  (high risk)
 */
function injuryRiskMultiplier(stamina: number): number {
  if (stamina >= 80) return 0;
  const deficit = 80 - stamina;
  return Math.min(5, (deficit * deficit) / 800);
}

// ── Commentary pools ────────────────────────────────────────

const GOAL_COMMENTARIES = [
  "{name} curls a stunning shot into the top corner!",
  "{name} taps it in from close range after a defensive mix-up!",
  "{name} smashes home a thunderous strike from the edge of the box!",
  "A brilliant solo run from {name} ends with a clinical finish!",
  "{name} rises highest and nods it into the net — unstoppable header!",
  "{name} slots it calmly past the keeper, ice-cold composure!",
  "Penalty! {name} steps up and buries it in the bottom corner!",
  "{name} pounces on the rebound and drills it home!",
  "A pinpoint cross finds {name}, who volleys it home on the half-turn!",
  "{name} weaves through the defence and dinks it delicately over the keeper!",
  "It's a rocket from {name}! The keeper never saw it coming!",
  "{name} converts from a tight angle — sheer improvisation!",
];

const INJURY_COMMENTARIES = [
  "{name} pulls up clutching his hamstring — he can't continue!",
  "{name} goes down after a heavy challenge and signals to the bench.",
  "{name} is limping badly... the medics are waving for a substitution.",
  "{name} collides awkwardly and looks in serious discomfort!",
];

const ASSIST_COMMENTARIES = [
  "{name} provides the killer pass!",
  "A pinpoint cross from {name} sets it up!",
  "{name} threads a perfect through-ball!",
  "The assist comes from {name} after a clever run!",
];

// ── Helpers ─────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollDice(): number {
  return rand(DICE_RANGE_MIN, DICE_RANGE_MAX);
}

function topN(players: Player[], n: number): Player[] {
  return [...players].sort((a, b) => b.overall - a.overall).slice(0, n);
}

// ── Formation parsing (dynamic fallback) ────────────────────

function resolveSlots(raw: string): Record<Position, number> {
  if (raw in FORMATION_SLOTS) return FORMATION_SLOTS[raw as Formation];

  const parts = raw.split("-").map(Number);
  if (parts.length >= 3 && parts.every((n) => !isNaN(n) && n >= 0)) {
    const def = parts[0];
    const fwd = parts[parts.length - 1];
    const mid = parts.slice(1, -1).reduce((a, b) => a + b, 0);
    if (1 + def + mid + fwd === 11) {
      console.log(`[matchEngine] Dynamic parse "${raw}" → GK:1 DEF:${def} MID:${mid} FWD:${fwd}`);
      return { [Position.GK]: 1, [Position.DEF]: def, [Position.MID]: mid, [Position.FWD]: fwd };
    }
  }
  console.warn(`[matchEngine] Unknown formation "${raw}", falling back to ${DEFAULT_FORMATION}`);
  return FORMATION_SLOTS[DEFAULT_FORMATION];
}

// ── Team sanitisation ───────────────────────────────────────

function sanitizeTeam(team: Team): { formation: Formation; tactic: Tactic } {
  const formation = (
    team.formation && team.formation in FORMATION_SLOTS ? team.formation : DEFAULT_FORMATION
  ) as Formation;
  const tactic = (
    team.tactic && (team.tactic === "attacking" || team.tactic === "balanced" || team.tactic === "defensive")
      ? team.tactic : DEFAULT_TACTIC
  ) as Tactic;

  if (team.formation !== formation || team.tactic !== tactic) {
    console.warn(`[matchEngine] Patched "${team.name}": formation→"${formation}" tactic→"${tactic}"`);
  }
  return { formation, tactic };
}

// ── Starting XI selection ───────────────────────────────────

/**
 * Select the starting 11.
 * Prefers `team.starterIds` if present (player-chosen lineup).
 * Falls back to auto-selection by overall in each position slot.
 * Skips injured players.
 */
export function selectStartingXI(team: Team): StartingXI {
  const { formation } = sanitizeTeam(team);
  const slots = resolveSlots(formation);

  // Healthy players only
  const healthy = team.players.filter((p) => p.injuryWeeks === 0);

  // If team has explicit starter IDs, use them (filter injured)
  if (team.starterIds && team.starterIds.length === 11) {
    const starterSet = new Set(team.starterIds);
    const picked = healthy.filter((p) => starterSet.has(p.id));

    if (picked.length === 11) {
      const gk = picked.find((p) => p.position === Position.GK);
      const defs = picked.filter((p) => p.position === Position.DEF);
      const mids = picked.filter((p) => p.position === Position.MID);
      const fwds = picked.filter((p) => p.position === Position.FWD);
      const all = [gk, ...defs, ...mids, ...fwds].filter((p): p is Player => p != null);

      if (!gk || all.length !== 11) {
        console.warn(`[matchEngine] "${team.name}" has incomplete explicit starterIds — falling back to auto-select`);
      } else {
        console.log(`[matchEngine] "${team.name}" using explicit starterIds (${all.length} players)`);
        return {
          gk, defs, mids, fwds, all,
          teamATT: all.reduce((s, p) => s + p.attack, 0),
          teamDEF: all.reduce((s, p) => s + p.defense, 0),
        };
      }
    }
    console.warn(`[matchEngine] "${team.name}" has ${picked.length}/11 healthy starters — falling back to auto-select`);
  }

  // Auto-select by overall per position (original logic)
  const byPos = (pos: Position) => healthy.filter((p) => p.position === pos);

  const pickedGk = topN(byPos(Position.GK), slots[Position.GK]);
  const pickedDef = topN(byPos(Position.DEF), slots[Position.DEF]);
  const pickedMid = topN(byPos(Position.MID), slots[Position.MID]);
  const pickedFwd = topN(byPos(Position.FWD), slots[Position.FWD]);

  // Back-fill short positions — 位置兼容链（严禁大面积客串）：
  // GK 仅 GK；DEF 优先 DEF→MID；MID 优先 MID→DEF→FWD；FWD 优先 FWD→MID→DEF。
  // 前锋客串后防/中场仅发生在真正人手短缺时（个别，而非全队大客串）。
  const shortfall = [slots[Position.GK] - pickedGk.length, slots[Position.DEF] - pickedDef.length,
    slots[Position.MID] - pickedMid.length, slots[Position.FWD] - pickedFwd.length];

  // 客串硬限制：全场"非本职位置客串"≤ 1 人（优先同位置，其次 1 次兼容客串）
  const cross = { used: 0 };
  const fillChain = (arr: Player[], need: number, preferred: Position[]) => {
    const used = new Set([...pickedGk, ...pickedDef, ...pickedMid, ...pickedFwd, ...arr].map((p) => p.id));
    const bestOf = (pos: Position) =>
      healthy.filter((p) => p.position === pos && !used.has(p.id)).sort((a, b) => b.overall - a.overall)[0];
    for (let i = 0; i < Math.max(0, need); i++) {
      let candidate = bestOf(preferred[0]);
      if (!candidate && cross.used < 1) {
        for (const pos of preferred.slice(1)) {
          candidate = bestOf(pos);
          if (candidate) { cross.used++; break; }
        }
      }
      if (!candidate) {
        // 极端兜底（客串额度耗尽仍不足 11 人）——取剩余最优
        candidate = healthy.filter((p) => !used.has(p.id)).sort((a, b) => b.overall - a.overall)[0];
      }
      if (!candidate) break;
      arr.push(candidate);
      used.add(candidate.id);
    }
  };
  fillChain(pickedGk, shortfall[0], [Position.GK]);
  fillChain(pickedDef, shortfall[1], [Position.DEF, Position.MID]);
  fillChain(pickedMid, shortfall[2], [Position.MID, Position.DEF, Position.FWD]);
  fillChain(pickedFwd, shortfall[3], [Position.FWD, Position.MID, Position.DEF]);

  const all = [...pickedGk, ...pickedDef, ...pickedMid, ...pickedFwd].filter((p): p is Player => p != null);
  console.log(`[matchEngine] "${team.name}" auto-selected ${all.length} players`);

  return {
    gk: pickedGk[0] ?? all.find((p) => p.position === Position.GK),
    defs: pickedDef, mids: pickedMid, fwds: pickedFwd, all,
    teamATT: all.reduce((s, p) => s + (p?.attack ?? 0), 0),
    teamDEF: all.reduce((s, p) => s + (p?.defense ?? 0), 0),
  };
}

// ── Tactic buffs ────────────────────────────────────────────

function applyTactic(att: number, def: number, tactic: Tactic) {
  switch (tactic) {
    case "attacking": return { att: Math.round(att * 1.15), def: Math.round(def * 0.85) };
    case "defensive": return { att: Math.round(att * 0.85), def: Math.round(def * 1.15) };
    default: return { att, def };
  }
}

// ── Team strength (position-weighted) ─────────────────────────

/**
 * 位置关键度加权的攻防强度（首发 11 人）：
 *   进攻强度 = 前锋 45% + 中场 40% + 后卫 10% + 门将 5%（attack 属性）
 *   防守强度 = 门将 25% + 后卫 60% + 中场 10% + 前锋 5%（defense 属性）
 * 权重按实际到场位置动态归一化（阵容残缺时不失真）。
 *
 * 硬约束：门将只占防守 25%——Ortega 60 之类的弱门不会压垮
 * 拥有 99 后卫 + 99 锋线的豪华球队；后防 60% 是防线稳定性的主体。
 */
export function computeTeamStrengths(xi: StartingXI): { att: number; def: number } {
  const avgOf = (players: Player[], key: "attack" | "defense"): number =>
    players.length > 0 ? players.reduce((s, p) => s + p[key], 0) / players.length : 0;

  // 权重动态归一化：缺员位置组（如首发无后卫）不参与权重，
  // 剩余位置按比例放大——否则空后卫组 0×0.60 会把防守强度腰斩（曾致 77-33 荒谬比分）
  const weighted = (
    gkVal: number, defsVal: number, midsVal: number, fwdsVal: number,
    weights: [number, number, number, number],
  ) => {
    const vals = [gkVal, defsVal, midsVal, fwdsVal];
    const present = [xi.gk ? 1 : 0, xi.defs.length > 0 ? 1 : 0, xi.mids.length > 0 ? 1 : 0, xi.fwds.length > 0 ? 1 : 0];
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < 4; i++) {
      if (present[i] > 0) {
        sum += vals[i] * weights[i];
        wsum += weights[i];
      }
    }
    return wsum > 0 ? sum / wsum : 1;
  };

  const att = weighted(
    xi.gk ? xi.gk.attack : 0,
    avgOf(xi.defs, "attack"), avgOf(xi.mids, "attack"), avgOf(xi.fwds, "attack"),
    [0.05, 0.10, 0.40, 0.45],
  );
  const def = weighted(
    xi.gk ? xi.gk.defense : 0,
    avgOf(xi.defs, "defense"), avgOf(xi.mids, "defense"), avgOf(xi.fwds, "defense"),
    [0.25, 0.60, 0.10, 0.05],
  );
  return { att, def };
}

// ── Goal probability (OVR-driven dominance model) ─────────────

/**
 * 每分钟进球概率：期望 ∝ (攻/防)^GAP_POWER。
 * 幂指数放大实力差——OVR 差 15 的豪门对弱队期望胜率 75-90%+，
 * 严禁随机骰子把豪门常年拖进保级区。
 */
function goalChance(att: number, def: number, dice: number, homeAdv: number): number {
  const ratio = att / Math.max(1, def);
  const dominance = Math.pow(ratio, GAP_POWER);
  return BASE_GOAL_RATE * dominance * dice * homeAdv;
}

/** 单场期望进球（纯函数，测试/校准用）：90 分钟 × 每分钟概率（骰子均值 1.0） */
export function expectedGoalsPerMatch(att: number, def: number, homeAdv: number): number {
  return BASE_GOAL_RATE * Math.pow(att / Math.max(1, def), GAP_POWER) * 90 * homeAdv;
}

/** 为进球者挑选助攻者（中前场优先；20% 进球无助攻事件）。 */
function pickAssister(xi: StartingXI, scorerId: string): Player | undefined {
  if (Math.random() < 0.2) return undefined;
  const creative = [...xi.mids, ...xi.fwds].filter((p) => p.id !== scorerId);
  const pool = creative.length > 0 ? creative : xi.all.filter((p) => p.id !== scorerId);
  if (pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 位置与属性加权进球者选择（严格进球权重约束）────────────────
// 前锋（ST/CF/LW/RW）占据进球绝大部分；中场与后卫施加极强衰减——
// 中场正常赛季进球 2-10 球区间（曾修复：防守型中场单季 69 球夺金靴）。

const SCORER_POSITION_WEIGHTS: Record<Position, number> = {
  [Position.FWD]: 1.0,
  [Position.MID]: 0.12,
  [Position.DEF]: 0.02,
  [Position.GK]: 0.0,
};

/** 加权选择进球者：位置权重 × 进攻属性因子（attack/99） */
export function pickWeightedScorer(xi: StartingXI, rng: () => number = Math.random): Player | null {
  const pool: Player[] = [...xi.fwds, ...xi.mids, ...xi.defs, ...(xi.gk ? [xi.gk] : [])].filter(
    (p): p is Player => p != null,
  );
  if (pool.length === 0) return null;
  const weighted = pool.map((p) => ({
    p,
    w: (SCORER_POSITION_WEIGHTS[p.position] ?? 0) * (0.5 + (p.attack ?? 50) / 99),
  }));
  const total = weighted.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.p;
  }
  return weighted[weighted.length - 1].p;
}

// ── Engine ──────────────────────────────────────────────────

export function simulateMatch(
  homeTeam: Team,
  awayTeam: Team,
  opts?: { european?: boolean }, // 欧战上下文：curated 超级豪门获得额外晋级权重
): MatchResult {
  const homeName = homeTeam?.name ?? "主队";
  const awayName = awayTeam?.name ?? "客队";
  console.log(`[matchEngine] ⚽ ${homeName} vs ${awayName}${opts?.european ? " (欧战)" : ""}`);

  const homeMeta = sanitizeTeam(homeTeam);
  const awayMeta = sanitizeTeam(awayTeam);

  // 1. Select XIs
  const homeXI = selectStartingXI({ ...homeTeam, ...homeMeta });
  const awayXI = selectStartingXI({ ...awayTeam, ...awayMeta });

  const homeStarterIds = homeXI.all.map((p) => p.id);
  const awayStarterIds = awayXI.all.map((p) => p.id);

  // 2. 位置加权攻防强度 + 战术加成 + 球队声望/底蕴 + 欧战豪门权重
  const homeStr = computeTeamStrengths(homeXI);
  const awayStr = computeTeamStrengths(awayXI);
  const homeBoost = teamPrestige(homeTeam?.name ?? "") + (opts?.european ? europeanEliteBoost(homeTeam?.name ?? "") : 0);
  const awayBoost = teamPrestige(awayTeam?.name ?? "") + (opts?.european ? europeanEliteBoost(awayTeam?.name ?? "") : 0);
  const homeBuffed = applyTactic(homeStr.att + homeBoost, homeStr.def + homeBoost, homeMeta.tactic);
  const awayBuffed = applyTactic(awayStr.att + awayBoost, awayStr.def + awayBoost, awayMeta.tactic);

  console.log(`[matchEngine] Buffed — ${homeName}: ATT=${homeBuffed.att.toFixed(0)} DEF=${homeBuffed.def.toFixed(0)} (加成+${homeBoost}) | ${awayName}: ATT=${awayBuffed.att.toFixed(0)} DEF=${awayBuffed.def.toFixed(0)} (加成+${awayBoost})`);

  let homeScore = 0;
  let awayScore = 0;
  const events: MatchResult["events"] = [];
  const injuredHome = new Set<string>();
  const injuredAway = new Set<string>();
  const homeInjuries: MatchResult["homeInjuries"] = [];
  const awayInjuries: MatchResult["awayInjuries"] = [];

  // 4. Minute-by-minute
  // 单场单队 6 球封顶：杜绝 6-0/7-2 式失真大比分（真实足坛极端值）
  const TEAM_GOAL_CAP = 6;
  for (let minute = 1; minute <= 90; minute++) {
    // ── Goals (+ real assist attribution for the season stats tracker) ──
    // 进球者按"位置 × 进攻属性"加权选择：前锋占绝大多数，中场/后卫强衰减
    if (homeScore < TEAM_GOAL_CAP && Math.random() < goalChance(homeBuffed.att, awayBuffed.def, rollDice(), HOME_ADVANTAGE)) {
      const scorer = pickWeightedScorer(homeXI);
      if (scorer) {
        homeScore++;
        events.push({ minute, type: MatchEventType.Goal, playerId: scorer.id,
          text: `Min ${minute}: ${pick(GOAL_COMMENTARIES).replace("{name}", scorer?.name ?? "某球员")}` });
        // 助攻：进球方中前场球员真实贡献，供赛季数据追踪器累加
        const assister = pickAssister(homeXI, scorer.id);
        if (assister) {
          events.push({ minute, type: MatchEventType.Assist, playerId: assister.id,
            text: `Min ${minute}: ${pick(ASSIST_COMMENTARIES).replace("{name}", assister.name ?? "某球员")}` });
        }
      }
    }
    if (awayScore < TEAM_GOAL_CAP && Math.random() < goalChance(awayBuffed.att, homeBuffed.def, rollDice(), 1.0)) {
      const scorer = pickWeightedScorer(awayXI);
      if (scorer) {
        awayScore++;
        events.push({ minute, type: MatchEventType.Goal, playerId: scorer.id,
          text: `Min ${minute}: ${pick(GOAL_COMMENTARIES).replace("{name}", scorer?.name ?? "某球员")}` });
        const assister = pickAssister(awayXI, scorer.id);
        if (assister) {
          events.push({ minute, type: MatchEventType.Assist, playerId: assister.id,
            text: `Min ${minute}: ${pick(ASSIST_COMMENTARIES).replace("{name}", assister.name ?? "某球员")}` });
        }
      }
    }

    // ── Injuries (check all starters once per minute) ──
    for (const p of homeXI.all) {
      if (!p) continue;
      if (!injuredHome.has(p.id) && Math.random() < INJURY_BASE_CHANCE * (1 + injuryRiskMultiplier(p.stamina ?? 100))) {
        const weeks = rollInjuryWeeks();
        injuredHome.add(p.id);
        homeInjuries.push({ playerId: p.id, weeks });
        events.push({ minute, type: MatchEventType.Injury, playerId: p.id,
          text: `Min ${minute}: ${pick(INJURY_COMMENTARIES).replace("{name}", p.name ?? "某球员")} (out ${weeks} week${weeks > 1 ? "s" : ""})` });
      }
    }
    for (const p of awayXI.all) {
      if (!p) continue;
      if (!injuredAway.has(p.id) && Math.random() < INJURY_BASE_CHANCE * (1 + injuryRiskMultiplier(p.stamina ?? 100))) {
        const weeks = rollInjuryWeeks();
        injuredAway.add(p.id);
        awayInjuries.push({ playerId: p.id, weeks });
        events.push({ minute, type: MatchEventType.Injury, playerId: p.id,
          text: `Min ${minute}: ${pick(INJURY_COMMENTARIES).replace("{name}", p.name ?? "某球员")} (out ${weeks} week${weeks > 1 ? "s" : ""})` });
      }
    }
  }

  console.log(`[matchEngine] 🏁 ${homeName} ${homeScore}–${awayScore} ${awayName} | Goals:${homeScore + awayScore} Injuries:${homeInjuries.length + awayInjuries.length}`);

  return {
    homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
    homeScore, awayScore, events,
    homeStarters: homeStarterIds, awayStarters: awayStarterIds,
    homeInjuries, awayInjuries,
  };
}
