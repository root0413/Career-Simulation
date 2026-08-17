/**
 * ⚽ Headless Season Simulation Stress Test — orchestrator & watchdog.
 *
 * Spawns the simulation worker (stress-worker.ts) in an ISOLATED child process so
 * that a synchronous hang in the game code blocks the worker's event loop while
 * THIS process stays alive to detect it, kill it, and pinpoint the exact action.
 *
 * Watchdog model (per user requirement "每轮模拟超过 500ms 未响应则判定为死锁"):
 *   - SOFT  (500ms): the worker self-measures each action and reports PERF findings.
 *   - HARD  (action deadline, default 15s): if an `action_start` is not followed by
 *     an `action_end` within the deadline, we declare a DEADLOCK, SIGKILL the worker,
 *     and report the exact action + call-site + the game's last log lines.
 *   - IDLE  (default 90s): no output at all → assume hang, kill.
 *
 * After the run, prints a full diagnostic & remediation report.
 *
 * Usage:
 *   npm run test:stress                      (default scenario matrix)
 *   tsx tests/stress-season-test.ts --quick  (1 season per scenario)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, "stress-worker.ts");

// ── Scenario matrix ───────────────────────────────────────────
interface ScenarioConfig {
  name: string;
  mode: "career" | "manager";
  league: string;
  teamTier: "strong" | "mid" | "weak";
  seasons: number;
  injectElimination?: boolean;
}

const quick = process.argv.includes("--quick");
const SCENARIOS: ScenarioConfig[] = [
  // Primary: career one-click sim with a strong team — the user's frozen flow.
  { name: "career-strong",  mode: "career",  league: "Premier League", teamTier: "strong", seasons: quick ? 1 : 4 },
  // Strong teams finish top-8 → the "direct R16 bye" path (suspected freeze trigger).
  { name: "career-mid",    mode: "career",  league: "Bundesliga", teamTier: "mid",   seasons: quick ? 1 : 3 },
  // Control: weak team likely misses Europe entirely → season should end cleanly.
  { name: "career-weak",   mode: "career",  league: "Bundesliga", teamTier: "weak",  seasons: quick ? 1 : 2 },
  // Deterministic reproduction: force "eliminated during European phase".
  { name: "career-inject-elim", mode: "career", league: "Premier League", teamTier: "strong", seasons: 1, injectElimination: true },
  // Manager mode shares playMatchweek — must also survive multi-season runs.
  { name: "manager-mid",   mode: "manager", league: "Serie A Enilive", teamTier: "mid",   seasons: quick ? 1 : 2 },
];

// ── Watchdog thresholds ───────────────────────────────────────
const ACTION_HARD_DEADLINE_MS = 15_000; // action_start without action_end ⇒ deadlock
const IDLE_DEADLINE_MS = 90_000;        // no worker output at all ⇒ hang
const SOFT_TIMEOUT_MS = 500;            // user requirement — flagged by the worker itself

// ── Reporting state ───────────────────────────────────────────
interface Finding {
  severity: string; scenario: string; season: number; matchday: number;
  where: string; evidence: string; expected: string; fix: string;
}
const findings: Finding[] = [];
const actionStats = new Map<string, { count: number; totalMs: number; maxMs: number; maxAt: string }>();
let currentAction: { action: string; where: string; scenario: string; season: number; matchday: number; startedAt: number } | null = null;
let workerLogs: string[] = [];
let deadlocked = false;
let lastActivityAt = Date.now();
const scenarioModes = new Map<string, string>();

function recordAction(name: string, ms: number, err?: string): void {
  const st = actionStats.get(name) ?? { count: 0, totalMs: 0, maxMs: 0, maxAt: "" };
  st.count++; st.totalMs += ms;
  if (ms > st.maxMs) { st.maxMs = ms; st.maxAt = err ?? ""; }
  actionStats.set(name, st);
}

function handleLine(line: string): void {
  lastActivityAt = Date.now();
  if (!line.trim()) return;
  let ev: Record<string, unknown>;
  try { ev = JSON.parse(line); } catch { workerLogs.push(line); return; }
  switch (ev.t) {
    case "action_start": {
      currentAction = {
        action: String(ev.action), where: String(ev.where),
        scenario: String(ev.scenario ?? "?"), season: Number(ev.season ?? 0),
        matchday: Number(ev.matchday ?? 0), startedAt: Date.now(),
      };
      process.stdout.write(`  ⚙️  ${ev.scenario} S${ev.season} md${ev.matchday} · ${ev.action}\n`);
      break;
    }
    case "action_end": {
      if (currentAction) {
        recordAction(currentAction.action, Number(ev.ms) || 0, ev.err ? String(ev.err) : undefined);
        if (ev.err) process.stdout.write(`     ↳ ⚠️ error: ${ev.err}\n`);
        currentAction = null;
      }
      break;
    }
    case "finding": {
      findings.push({
        severity: String(ev.severity), scenario: String(ev.scenario),
        season: Number(ev.season), matchday: Number(ev.matchday),
        where: String(ev.where), evidence: String(ev.evidence),
        expected: String(ev.expected), fix: String(ev.fix),
      });
      break;
    }
    case "scenario": {
      if (ev.mode) scenarioModes.set(String(ev.name), String(ev.mode));
      if (ev.team) process.stdout.write(`\n▶ 场景 ${ev.name} — ${ev.team} (${scenarioModes.get(String(ev.name)) ?? "?"})\n`);
      break;
    }
    case "season_start": {
      process.stdout.write(`\n── S${ev.season} ──\n`);
      break;
    }
    case "season_end": {
      process.stdout.write(`   ✔ 赛季结束: ${ev.played} 场已打, 停在第 ${ev.matchday}/${ev.calendar} 比赛日, 已结束=${ev.ended}${ev.aborted ? ` ⛔ ${ev.aborted}` : ""}\n`);
      break;
    }
    case "scenario_end": {
      if (ev.aborted) process.stdout.write(`   ⛔ 场景中止: ${ev.aborted}\n`);
      break;
    }
    case "done": {
      process.stdout.write(`\n工作进程完成 — ${ev.findings} 条发现, 耗时 ${((Number(ev.elapsedMs) || 0) / 1000).toFixed(1)}s (${ev.suppressedLogs} 条游戏日志被抑制)\n`);
      break;
    }
    case "meta": break;
    default: workerLogs.push(line);
  }
}

// ── Main ──────────────────────────────────────────────────────
function main(): void {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  ⚽ Simple FM — Headless 赛季压力测试 / 死锁狩猎          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(`场景矩阵: ${SCENARIOS.map((s) => `${s.name}(${s.mode},${s.teamTier}×${s.seasons}季)`).join("  ")}`);
  console.log(`看门狗: 单动作硬超时 ${ACTION_HARD_DEADLINE_MS / 1000}s (软阈值 ${SOFT_TIMEOUT_MS}ms) · 静默超时 ${IDLE_DEADLINE_MS / 1000}s\n`);

  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", WORKER_PATH, JSON.stringify({ scenarios: SCENARIOS })], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.join(__dirname, ".."),
  });

  let stdoutBuf = "";
  child.stdout!.on("data", (d: Buffer) => {
    stdoutBuf += d.toString();
    let idx: number;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      workerLogs.push(line);
      if (workerLogs.length > 30) workerLogs.shift();
      handleLine(line);
    }
  });
  child.stderr!.on("data", (d: Buffer) => {
    workerLogs.push("[stderr] " + d.toString().trimEnd());
    if (workerLogs.length > 30) workerLogs.shift();
    process.stderr.write(d);
  });

  // ── Watchdog ──
  const watchdog = setInterval(() => {
    const now = Date.now();
    if (currentAction && now - currentAction.startedAt > ACTION_HARD_DEADLINE_MS) {
      // DEADLOCK: an action_start was never followed by action_end.
      deadlocked = true;
      findings.push({
        severity: "DEADLOCK",
        scenario: currentAction.scenario, season: currentAction.season, matchday: currentAction.matchday,
        where: `${currentAction.action} @ ${currentAction.where}`,
        evidence: `action never returned within ${ACTION_HARD_DEADLINE_MS / 1000}s — the worker's event loop is blocked (synchronous infinite loop / pathological scan).`,
        expected: "action returns < 500ms",
        fix: "Inspect the call-site; the last game log lines before the hang are shown in the report.",
      });
      console.error(`\n💀 死锁检测: ${currentAction.action} (${currentAction.where}) 卡死于场景 ${currentAction.scenario} S${currentAction.season} md${currentAction.matchday}`);
      console.error("── 卡死前最后 20 条游戏日志 ──");
      for (const l of workerLogs.slice(-20)) console.error("   " + l);
      clearInterval(watchdog);
      child.kill("SIGKILL");
      return;
    }
    if (now - lastActivityAt > IDLE_DEADLINE_MS) {
      deadlocked = true;
      findings.push({
        severity: "DEADLOCK", scenario: "?", season: 0, matchday: 0,
        where: "worker (global silence)",
        evidence: `no output for ${IDLE_DEADLINE_MS / 1000}s — worker hung without starting an action.`,
        expected: "continuous progress output",
        fix: "Check the worker/imports; last log lines are shown in the report.",
      });
      console.error("\n💀 死锁检测: 工作进程完全静默 (事件循环被阻塞)");
      console.error("── 最后日志 ──");
      for (const l of workerLogs.slice(-20)) console.error("   " + l);
      clearInterval(watchdog);
      child.kill("SIGKILL");
      return;
    }
  }, 200);

  child.on("exit", (code) => {
    clearInterval(watchdog);
    printReport(code);
  });
}

// ── Final report ──────────────────────────────────────────────
function printReport(exitCode: number | null): void {
  const bySev = (s: string) => findings.filter((f) => f.severity === s);
  const deadlocks = bySev("DEADLOCK").length + bySev("LIVELOCK").length;
  const corruption = bySev("CORRUPTION").length;
  const logic = bySev("LOGIC").length;
  const transition = bySev("TRANSITION").length;
  const perf = bySev("PERF").length;
  const design = bySev("DESIGN").length;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  📋 诊断与优化反馈报告                                    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`退出码: ${exitCode} ${deadlocked ? "· 由看门狗强制击杀 (SIGKILL)" : ""}`);
  console.log(`发现汇总: 💀死锁/卡死 ${deadlocks} · 🧨数据崩坏 ${corruption} · ⚖️逻辑违规 ${logic} · 🔗赛程断层 ${transition} · 🐌性能 ${perf} · 🎨设计 ${design}\n`);

  // ── Performance table ──
  if (actionStats.size) {
    console.log("── 动作耗时统计 (最慢优先) ──────────────────────────────");
    const rows = [...actionStats.entries()].sort((a, b) => b[1].maxMs - a[1].maxMs);
    console.log("   动作".padEnd(34) + "次数".padStart(6) + "平均ms".padStart(9) + "最慢ms".padStart(9));
    for (const [name, st] of rows) {
      const flag = st.maxMs > SOFT_TIMEOUT_MS ? " ⚠️ 超500ms" : "";
      console.log("   " + name.padEnd(32) + String(st.count).padStart(6) + st.totalMs.toFixed(0).padStart(8) + st.maxMs.toFixed(0).padStart(8) + flag);
    }
    console.log("");
  }

  // ── Findings grouped ──
  const groups: [string, string][] = [
    ["DEADLOCK", "💀 死锁 / 事件循环阻塞"],
    ["LIVELOCK", "🔁 活锁 / 赛季无法推进 (最可能是“死机”元凶)"],
    ["CORRUPTION", "🧨 数据崩坏"],
    ["TRANSITION", "🔗 赛程衔接断层"],
    ["LOGIC", "⚖️ 逻辑违规 (奖项门槛/年龄/衰退)"],
    ["PERF", "🐌 性能问题 (单动作 > 500ms)"],
    ["DESIGN", "🎨 设计缺陷"],
  ];
  for (const [sev, title] of groups) {
    const list = bySev(sev);
    if (!list.length) continue;
    console.log(`── ${title} (${list.length}) ─${"─".repeat(Math.max(0, 52 - title.length - String(list.length).length))}`);
    // Deduplicate identical findings (same where+evidence)
    const seen = new Set<string>();
    for (const f of list) {
      const key = f.where + "|" + f.evidence;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  · [${f.scenario} S${f.season} md${f.matchday}] ${f.where}`);
      console.log(`      观察: ${f.evidence}`);
      console.log(`      期望: ${f.expected}`);
      console.log(`      修复: ${f.fix}`);
    }
    console.log("");
  }

  console.log("══════════════════════════════════════════════════════════");
  if (deadlocks > 0) {
    console.log("结论: ❌ 检测到导致死机的卡死点 — 请按报告逐项修复后重跑本测试。");
    process.exit(1);
  }
  console.log("结论: ✅ 全部赛季自运转完成，未发现死锁/活锁。");
}

main();
