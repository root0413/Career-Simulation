import { Position, type Player } from "../types/game";
import { marketValue } from "../utils/marketValue";
import { generateUUID } from "../utils/uuid";
import { dedupePlayers, normalizePosition, type ImportedPlayerRecord } from "../utils/playerImport";
import rawTeams from "../../teams_output.json";
import rawLaLiga from "./laLigaTeams.json";
import rawImported from "./importedPlayers.json";

// ── JSON source types ───────────────────────────────────────

interface RawPlayer {
  name: string;
  position: string;
  age: number;
  overall: number;
  potential: number;
  value?: number; // 兼容旧数据（身价已统一由 marketValue 计算，可省略）
}

interface RawTeam {
  id: string;
  name: string;
  league: string;
  budget: number; // millions
  players: RawPlayer[];
}

// ── 西甲 + 外部导入数据合并（清洗/位置映射/按名去重保高 OVR）──

function toImportRecords(teams: RawTeam[]): ImportedPlayerRecord[] {
  const out: ImportedPlayerRecord[] = [];
  for (const t of teams) {
    for (const p of t.players) {
      const pos = normalizePosition(p.position);
      if (!pos) continue;
      out.push({ name: p.name, position: pos, age: p.age, overall: p.overall, potential: p.potential, club: t.name });
    }
  }
  return out;
}

/** 合并新联赛数据：既有球员名冲突时保留 OVR 更高者（或仅更新俱乐部归属） */
function mergeLeagueData(
  baseTeams: RawTeam[], incomingTeams: RawTeam[],
): RawTeam[] {
  const incomingClubs = new Set(incomingTeams.map((t) => t.name));
  const merged = dedupePlayers(toImportRecords(baseTeams), toImportRecords(incomingTeams));
  // 每个 incoming 俱乐部取清洗后仍归属本队的球员
  const byClub = new Map<string, RawPlayer[]>();
  for (const rec of merged) {
    if (!incomingClubs.has(rec.club)) continue;
    const list = byClub.get(rec.club) ?? [];
    list.push({ name: rec.name, position: rec.position, age: rec.age, overall: rec.overall, potential: rec.potential });
    byClub.set(rec.club, list);
  }
  return incomingTeams
    .map((t) => ({ ...t, players: byClub.get(t.name) ?? [] }))
    .filter((t) => t.players.length >= 11); // 球员数不足的俱乐部不进入数据库
}

const laLigaTeams = mergeLeagueData(rawTeams as RawTeam[], rawLaLiga as RawTeam[]);
const importedTeams = mergeLeagueData([...rawTeams as RawTeam[], ...laLigaTeams], rawImported as RawTeam[]);

const TEAMS_RAW: RawTeam[] = [...rawTeams as RawTeam[], ...laLigaTeams, ...importedTeams];

// ── Stat generators (position-aware) ────────────────────────

function rand(n: number, variance: number): number {
  return n + Math.floor((Math.random() - 0.5) * variance * 2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function generateStats(pos: string, overall: number): { attack: number; defense: number; stamina: number } {
  const base = overall;
  switch (pos) {
    case "GK":
      return { attack: clamp(rand(12, 3), 5, 30), defense: clamp(rand(base + 5, 4), 40, 99), stamina: clamp(rand(base - 5, 6), 30, 90) };
    case "DEF":
      return { attack: clamp(rand(base - 20, 8), 20, 70), defense: clamp(rand(base + 5, 4), 40, 99), stamina: clamp(rand(base - 3, 6), 40, 90) };
    case "MID":
      return { attack: clamp(rand(base, 5), 30, 90), defense: clamp(rand(base - 5, 5), 30, 90), stamina: clamp(rand(base + 2, 5), 50, 95) };
    case "FWD":
      return { attack: clamp(rand(base + 5, 5), 40, 99), defense: clamp(rand(base - 30, 8), 10, 60), stamina: clamp(rand(base - 5, 6), 30, 90) };
    default:
      return { attack: clamp(rand(base, 5), 30, 90), defense: clamp(rand(base, 5), 30, 90), stamina: clamp(rand(base, 5), 40, 90) };
  }
}

// ── Convert raw → Player ────────────────────────────────────

function convertPlayer(raw: RawPlayer): Player {
  const pos = raw.position as Position;
  const stats = generateStats(raw.position, raw.overall);
  return {
    id: generateUUID(),
    name: raw.name,
    age: raw.age,
    position: pos,
    attack: stats.attack,
    defense: stats.defense,
    stamina: clamp(rand(65 + Math.floor((raw.overall - 65) / 2), 8), 20, 95),
    injuryWeeks: 0,
    potential: raw.potential,
    overall: raw.overall,
    // 统一身价体系（€200M 上限）：OVR/POT/年龄梯度，贴合现代市场通胀
    value: marketValue(raw.overall, raw.potential, raw.age),
  };
}

// ── League grouping ─────────────────────────────────────────

export interface RealTeamData {
  id: string;
  name: string;
  league: string;
  budget: number; // already multiplied
  players: Player[];
}

/** Group teams by league name → team list. */
export function getTeamsByLeague(): Map<string, RealTeamData[]> {
  const map = new Map<string, RealTeamData[]>();
  for (const raw of TEAMS_RAW) {
    const team: RealTeamData = {
      id: raw.id,
      name: raw.name,
      league: raw.league,
      budget: Math.round(raw.budget * 1_000_000), // M → raw €
      players: raw.players.map(convertPlayer),
    };
    const list = map.get(raw.league) ?? [];
    list.push(team);
    map.set(raw.league, list);
  }
  return map;
}

/** Flat list of all teams. */
export function getAllTeams(): RealTeamData[] {
  return TEAMS_RAW.map((raw) => ({
    id: raw.id,
    name: raw.name,
    league: raw.league,
    budget: Math.round(raw.budget * 1_000_000),
    players: raw.players.map(convertPlayer),
  }));
}

/** All unique league names. */
export function getLeagueNames(): string[] {
  return [...new Set(TEAMS_RAW.map((t) => t.league))];
}
