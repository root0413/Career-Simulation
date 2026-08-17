/**
 * 外部球员数据导入脚本（dev-time）：
 *   读取 data_import/ 目录下的 players.json 或 players.csv，
 *   经导入管线（位置映射/OVR·POT 校验/按名去重保高 OVR）清洗后，
 *   按俱乐部分组写入 src/data/importedPlayers.json（游戏启动时自动合并）。
 *
 * 用法： npx tsx scripts/import-players.ts [--league "La Liga"]
 * 数据行字段： name, position, age, overall, potential, club
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { importPlayerData } from "../src/utils/playerImport";
import { getAllTeams } from "../src/data/teamsDatabase";

const leagueArg = process.argv.includes("--league") ? process.argv[process.argv.indexOf("--league") + 1] : "La Liga";
const importDir = path.resolve(process.cwd(), "data_import");
const outFile = path.resolve(process.cwd(), "src/data/importedPlayers.json");

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function main(): void {
  if (!existsSync(importDir)) {
    console.log(`📂 data_import/ 目录不存在（${importDir}）— 跳过外部导入。`);
    return;
  }
  const files = readdirSync(importDir).filter((f) => /\.(json|csv)$/i.test(f));
  if (files.length === 0) {
    console.log("📂 data_import/ 为空 — 跳过外部导入。");
    return;
  }

  // 既有数据库球员（用于按名去重：保留 OVR 更高者）
  const existing = getAllTeams().flatMap((t) =>
    t.players.map((p) => ({ name: p.name, position: p.position, age: p.age, overall: p.overall, potential: p.potential, club: t.name })),
  );

  let all: ReturnType<typeof importPlayerData> = [];
  for (const file of files) {
    const text = readFileSync(path.join(importDir, file), "utf-8");
    const format = file.toLowerCase().endsWith(".csv") ? "csv" : "json";
    console.log(`📥 解析 ${file} (${format})…`);
    all = importPlayerData(text, format, all);
  }
  // 与既有数据库按名去重（保留 OVR 更高者 / 更新俱乐部信息）
  const deduped = importPlayerData(JSON.stringify(all), "json", existing);

  // 按俱乐部分组 → RawTeam 结构
  const byClub = new Map<string, typeof deduped>();
  for (const p of deduped) {
    if (!p.club) continue;
    const list = byClub.get(p.club) ?? [];
    list.push(p);
    byClub.set(p.club, list);
  }
  const teams = [...byClub.entries()]
    .filter(([, players]) => players.length >= 11)
    .map(([club, players]) => ({
      id: slugify(club),
      name: club,
      league: leagueArg,
      budget: 50,
      players: players.map((p) => ({ name: p.name, position: p.position, age: p.age, overall: p.overall, potential: p.potential })),
    }));

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(teams, null, 2), "utf-8");
  console.log(`✅ 已导入 ${teams.length} 支俱乐部（${deduped.length} 名球员）→ ${outFile}`);
}

main();
