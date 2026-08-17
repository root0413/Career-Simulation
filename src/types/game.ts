// ── Position / MatchEventType ───────────────────────────────
// const 对象 + 同名类型别名（兼容 erasableSyntaxOnly——enum 语法会阻断 tsc -b 构建；
// 值访问 Position.GK 与类型标注 Position 均保持不变，全项目零调用点改动）

export const Position = {
  GK: "GK",
  DEF: "DEF",
  MID: "MID",
  FWD: "FWD",
} as const;
export type Position = (typeof Position)[keyof typeof Position];

export const MatchEventType = {
  Goal: "goal",
  Assist: "assist",
  YellowCard: "yellow_card",
  RedCard: "red_card",
  Sub: "sub",
  Injury: "injury",
  Normal: "normal",
} as const;
export type MatchEventType = (typeof MatchEventType)[keyof typeof MatchEventType];

// ── Constrained string unions ──────────────────────────────

export type Formation =
  | "4-4-2"
  | "4-3-3"
  | "3-5-2"
  | "5-3-2"
  | "4-2-3-1"
  | "3-4-3"
  | "5-4-1"
  | "4-1-4-1";

export type Tactic = "attacking" | "balanced" | "defensive";

// ── All formations for UI iteration ────────────────────────

export const ALL_FORMATIONS: Formation[] = [
  "4-4-2", "4-3-3", "3-5-2", "5-3-2",
  "4-2-3-1", "3-4-3", "5-4-1", "4-1-4-1",
];

export const ALL_TACTICS: Tactic[] = ["attacking", "balanced", "defensive"];

// ── Pre-computed formation slots ────────────────────────────

export const FORMATION_SLOTS: Record<Formation, Record<Position, number>> = {
  "4-4-2":   { [Position.GK]: 1, [Position.DEF]: 4, [Position.MID]: 4, [Position.FWD]: 2 },
  "4-3-3":   { [Position.GK]: 1, [Position.DEF]: 4, [Position.MID]: 3, [Position.FWD]: 3 },
  "3-5-2":   { [Position.GK]: 1, [Position.DEF]: 3, [Position.MID]: 5, [Position.FWD]: 2 },
  "5-3-2":   { [Position.GK]: 1, [Position.DEF]: 5, [Position.MID]: 3, [Position.FWD]: 2 },
  "4-2-3-1": { [Position.GK]: 1, [Position.DEF]: 4, [Position.MID]: 5, [Position.FWD]: 1 },
  "3-4-3":   { [Position.GK]: 1, [Position.DEF]: 3, [Position.MID]: 4, [Position.FWD]: 3 },
  "5-4-1":   { [Position.GK]: 1, [Position.DEF]: 5, [Position.MID]: 4, [Position.FWD]: 1 },
  "4-1-4-1": { [Position.GK]: 1, [Position.DEF]: 4, [Position.MID]: 5, [Position.FWD]: 1 },
};

// ── Interfaces ──────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  age: number;
  position: Position;
  attack: number;
  defense: number;
  stamina: number;      // 0-100, drains during matches
  injuryWeeks: number;   // 0 = healthy, >0 = weeks sidelined
  potential: number;     // 50-99, growth ceiling; does NOT affect overall
  overall: number;
  value: number;
}

export type EuropeanStatus = "UCL" | "UEL" | "UECL" | "NONE";

// ── Modern UCL format (2024+) types ────────────────────────

/** League phase: 36 teams in a single table, each plays 8 different opponents. */
export interface EuropeanLeaguePhase {
  teams: string[];      // 36 team IDs
  fixtures: { homeId: string; awayId: string; round: number; played: boolean }[];
  standings: LeagueStandings[];
}

/** Two-legged knockout tie (leg 1 + leg 2; final may be single match). */
export interface EuropeanTie {
  homeId: string; awayId: string;
  homeScore: number; awayScore: number;      // first leg
  homeScore2: number; awayScore2: number;    // second leg
  played: boolean; played2: boolean;
  singleLeg?: boolean;                        // true = single-match tie (final)
  winnerId: string | null;
  /** 点球大战比分（总比分/单场打平时自动触发，如 4-3、5-4） */
  penaltyHome?: number;
  penaltyAway?: number;
}

/** A knockout round containing multiple ties. */
export interface EuropeanKnockout {
  round: string;   // "playoff" | "r16" | "qtr" | "semi" | "final"
  ties: EuropeanTie[];
}

/** Full tournament state for UCL / UEL / UECL. */
export interface EuropeanTournament {
  type: "UCL" | "UEL" | "UECL";
  leaguePhase: EuropeanLeaguePhase;
  knockoutPlayoffs: EuropeanKnockout | null;   // ranks 9-24 → 8 winners
  roundOf16: EuropeanKnockout | null;
  quarterFinals: EuropeanKnockout | null;
  semiFinals: EuropeanKnockout | null;
  final: EuropeanKnockout | null;
  currentStage: "league" | "playoff" | "r16" | "qtr" | "semi" | "final" | "done";
}

// Kept for backward compat during migration; unused by new code.
export interface EuropeanGroup {
  id: string;
  teamIds: string[];
  standings: LeagueStandings[];
  fixtures: { homeId: string; awayId: string; played: boolean }[];
}

export interface CalendarMatchday {
  id: number;
  type: "league" | "european";
  round: number;
  stage?: string;
  name: string;
}

/**
 * 全赛季真实数据追踪器条目（True Season Stats Tracker）。
 * 每一场比赛在 playMatchweek / simulateCareerPerformance 中实时累加，
 * 赛季末奖项评选严格读取此数据——绝不在赛季末用随机数捏造。
 */
export interface SeasonPlayerStat {
  name: string;
  position: Position;
  clubId: string;    // 最近效力俱乐部（生涯球员赛季中转会会更新）
  clubName: string;
  league: string;    // 俱乐部所属联赛（金球奖资格判定用）
  ovr: number;       // 首次累加时的 OVR
  appearances: number;
  goals: number;
  assists: number;
  ratingSum: number; // 每场评分之和；avgRating = ratingSum / appearances
}

/**
 * 生涯模式单场比赛记录（赛季日志条目）。
 * `label` 为语义化轮次标签，如 "联赛第 29 轮" / "欧冠 1/8 决赛 首回合"，
 * 由 formatMatchdayLabel 在记录时生成，UI 直接渲染。
 */
export interface CareerMatchLogEntry {
  round: number;
  opponent: string;
  goals: number;
  assists: number;
  rating: number;
  result: string;
  injured: boolean;
  /** 赛段：本土联赛 or 欧战 */
  phase: "league" | "european";
  /** 欧战赛事（phase === "european" 时有效） */
  competition: EuropeanStatus | null;
  /** 语义化轮次标签（替代模糊的 R{round}） */
  label: string;
}

// ── Player Career Mode types ──────────────────────────────

export interface CareerPlayer {
  id: string;
  name: string;
  age: number;
  nationality: string;
  position: Position;
  overall: number;
  potential: number;
  stamina: number;
  attack: number;
  playmaking: number;
  defense: number;
  value: number;
  teamId: string | null;
  injuryWeeks: number;   // 0 = healthy, >0 = weeks sidelined
  // Career statistics
  appearances: number;
  seasonAppearances: number; // 本赛季出场数（startNewSeason 时清零，租借触发判定用）
  goals: number;
  assists: number;
  avgRating: number;
  totalRatings: number;
  recentRatings: number[];
  honours: CareerHonour[];
  /** 生涯团队奖杯（联赛冠军/欧战冠军），赛季结算时累加 */
  careerTrophies: CareerTrophy[];
  /** 生涯逐年记录（谢幕页时间轴/生涯峰值数据源） */
  careerSeasons: CareerSeasonRecord[];
  /** 租借父队身份：同联赛租借用游戏内 teamId；跨联赛用 DB 层身份（回归时重建世界） */
  loanParent: { kind: "game"; teamId: string }
    | { kind: "db"; teamDbId: string; teamName: string; leagueName: string }
    | null;
  /** 赛季末待生效的跨联赛转会/租借（startNewSeason 重建世界时消费） */
  pendingMove: {
    kind: "transfer" | "loan";
    parentClub: { dbId: string; name: string; leagueName: string }; // 原俱乐部 DB 身份（租借回归用）
    targetClub: { dbId: string; name: string; leagueName: string };
    fee: number; // loan 时为 0
  } | null;
  /** 同赛季事件冷却：同类型事件每赛季至多 1 次 */
  eventsThisSeason: CareerEventType[];
}

export interface CareerHonour {
  season: number;
  award: string;
  icon: string;
}

/** 生涯团队奖杯记录（赛季结算时由 generateSeasonAwards 写入） */
export interface CareerTrophy {
  season: number;
  type: "league" | "ucl" | "uel" | "uecl";
  name: string; // 如 "联赛冠军" / "欧冠冠军"
  icon: string;
}

/** 生涯逐年记录（赛季结算时写入，谢幕页时间轴/峰值数据源） */
export interface CareerSeasonRecord {
  season: number;
  clubName: string;
  leagueName: string;
  leagueRank: number | null;      // 1-based 最终联赛排名（快照榜）
  euroFinishLabel: string | null; // 如 "欧冠冠军" / "欧冠四强 (半决赛)"；null = 未参加
  apps: number;
  goals: number;
  assists: number;
  avgRating: number;
  ovr: number;    // 赛季末 OVR
  value: number;  // 赛季末身价
}

// ── Career events ─────────────────────────────────────────

export type CareerEventType = "contract_renewal" | "transfer_offer" | "transfer_rumor"
  | "demotion_warning" | "transfer_listed" | "loan_offer" | "new_signing";

/** 豪门转会申请载荷：求购俱乐部 + 转会费 */
export interface EliteTransferPayload {
  clubName: string;
  clubDbId: string;   // teamsDatabase 真实队 id（跨联赛重建世界用）
  leagueName: string; // DB 联赛名
  fee: number;        // 转会费（€）
}

/** 租借申请载荷 */
export interface LoanOfferPayload {
  clubName: string;
  clubDbId: string;
  leagueName: string;
  crossLeague: boolean;      // true = 跨联赛，走 pendingMove
  gameTeamId: string | null; // 同联赛租借目标队（游戏内 id）
  reason: string;            // 租借理由文案
}

/** AI 教练自动引援通知载荷 */
export interface NewSigningPayload {
  playerName: string;
  position: string;
  ovr: number;
  fee: number;
}

export interface CareerEvent {
  type: CareerEventType;
  title: string;
  body: string;
  actionLabel: string;
  dismissLabel: string;
  payload?: EliteTransferPayload | LoanOfferPayload | NewSigningPayload | null;
}

export interface Team {
  id: string;
  name: string;
  budget: number;
  players: Player[];
  starterIds: string[];
  u21Players: Player[];
  u18Players: Player[];
  formation: Formation;
  tactic: Tactic;
  europeanStatus: EuropeanStatus;
  /** 所属联赛（DB 联赛名；虚拟队为中文联赛名）。旧存档可能缺失。 */
  league?: string;
}

export interface MatchEvent {
  minute: number;
  text: string;
  type: MatchEventType;
  /** Which player's ID this event involves (scorer / injured player). */
  playerId?: string;
}

export interface MatchResult {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];

  /** IDs of players who were on the pitch (starters) — for stamina drain. */
  homeStarters: string[];
  awayStarters: string[];
  /** Injuries sustained during this match. */
  homeInjuries: { playerId: string; weeks: number }[];
  awayInjuries: { playerId: string; weeks: number }[];
}

export interface LeagueStandings {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface StartingXI {
  gk: Player;
  defs: Player[];
  mids: Player[];
  fwds: Player[];
  all: Player[];
  teamATT: number;
  teamDEF: number;
}
