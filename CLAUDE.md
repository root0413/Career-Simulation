# CLAUDE.md — Simple FM Architecture Reference

## Project Overview

Simple FM is a browser-based football manager game built with React 19 + TypeScript + Vite + Zustand 5 + Tailwind CSS 4.  It supports two game modes: **Manager Mode** (control the whole club) and **Player Career Mode** (Be-a-Pro, AI-managed team).  The game features real team/player data from `teams_output.json` (140 teams) and `free_agents_output.json` (498 players).

## Architecture

```
src/
├── types/game.ts              # All interfaces & enums
├── store/useGameStore.ts       # Zustand state — ~2000 lines, all game logic
├── utils/
│   ├── matchEngine.ts          # Pure-function 90-min match simulator (Goal + Assist events)
│   ├── worldGenerator.ts       # Generates league world from teams_output.json
│   ├── europeanEngine.ts       # Modern UCL format (36-team league phase, 2-leg KO)
│   ├── matchLog.ts             # Semantic match labels (联赛第 X 轮 / 欧冠 1/8 决赛 首回合) + phase grouping
│   ├── seasonStats.ts          # True Season Stats Tracker: per-match real accumulation (deterministic ratings)
│   ├── lifecycle.ts            # 老将退役概率 retirementChance(age, overall)（35 起 10% → 40+ 90%，状态差 ×1.3）
│   ├── newgens.ts              # U21 青训新秀生成（俱乐部实力分层潜力：超级豪门可出 90-95 POT 妖人）
│   └── calendar.ts             # Season calendar: league first, then European
├── data/
│   ├── teamsDatabase.ts        # 160 real teams (140 + La Liga 20，经导入管线清洗/去重合并)
│   ├── laLigaTeams.json        # 西甲 20 队（皇马/巴萨/马竞等）
│   ├── importedPlayers.json    # scripts/import-players.ts 外部导入产物（启动时自动合并）
│   ├── transferMarket.ts       # Initial transfer pool (25 players)
│   ├── freeAgentsDatabase.ts   # 498 free agents (smart dedup)
│   ├── careerTransfers.ts      # 豪门名单/联赛等级/租借目的地/转会费 (转会生态纯函数)
│   └── leagueRules.ts          # Per-league rules (teams/rounds/euro spots，含西甲 20 队 38 轮)
├── components/
│   ├── TeamSelection.tsx        # Manager mode: pick league → team
│   ├── TacticsPanel.tsx         # Formation + tactic selector
│   ├── LineupPitch.tsx          # Graphical pitch (position-colored circles)
│   ├── CreatePlayerModal.tsx    # Career: attribute sliders + live OVR preview
│   ├── SelectClubView.tsx       # Career: league → club picker
│   ├── CareerDashboard.tsx      # Career: 3-column layout, AI lineup, sim
│   ├── SimulationPausedModal.tsx # Career: sim-interruption modal (fixed footer button)
│   └── EuropeanStandingsPanel.tsx # UCL/UEL/UECL league phase table
├── App.tsx                      # Main router: mode selection → flow routing
├── main.tsx                     # Entry + ErrorBoundary
└── index.css                    # Tailwind CSS v4
tests/
├── test-runner.ts              # 3828+ unit assertions
├── career-test.ts              # Career mode flow test (82 assertions)
├── full-matrix-test.ts         # 8 leagues × 2 modes × 2 seasons
├── stress-season-test.ts       # Headless stress orchestrator (watchdog + report)
├── stress-worker.ts            # Stress payload: multi-season sim + audits
└── e2e/game.spec.ts           # Playwright browser E2E
```

## Key Design Patterns

### State Management
- Single Zustand store with `persist` middleware (localStorage, version 2)
- `GameMode`: `"manager" | "career"` determines UI flow
- `onRehydrateStorage`: comprehensive migration for old save formats
- All Player arrays validated on load (12 fields checked, nulls filtered)

### Match Engine (`matchEngine.ts`)
- `simulateMatch(homeTeam, awayTeam): MatchResult`
- **OVR 驱动胜率模型**：进球期望 ∝ (攻/防)^4.5（幂指数放大实力差）——OVR 差 15 的豪门对弱队期望胜率 75-90%+；`expectedGoalsPerMatch` 纯函数可测
- 攻防强度按位置关键度加权（进攻 FWD45%+MID40%+DEF10%+GK5%；防守 GK25%+DEF60%+MID10%+FWD5%）——弱门将（如 60）不会压垮 99 后防的豪华球队；**权重按到场位置组动态归一化**（首发无后卫时剩余位置按比例放大，曾修复空后卫组 0×0.60 把防守腰斩致 77-33 荒谬比分）
- 球队声望/底蕴（`TEAM_PRESTIGE`，等效 OVR +1~2）：真实豪门英文名 + 虚拟欧战豪门中文名
- 随机骰收窄至 0.6-1.4（原 0.2-1.8 的 9 倍波动淹没实力差）
- Injury: 概率 0.00002/min，**1-8 周轻伤倾斜**（pow(rand,1.6)，均值 ~2.8 周——原 1-12 均匀分布场均 6.5 周伤缺曾致拜仁 73→57 分）；≥80 stamina 免疫
- Tactic buffs: ±15% ATT/DEF · Home advantage: 1.08×
- `applyGrowth` **潜力天花板硬门槛**：`overall < potential` 才成长 + gapFactor 递减收益（曾缺失——年轻球员每场 +1~2 点直冲 99，3 季全联盟膨胀至 83-89、豪门差距被抹平）
- `joinCareerClub`/`buildWorldForMove` 模糊匹配：**子串匹配要求被包含字符串 ≥ 4 字符**（曾修复："ol" ⊂ "vfl_wolfsburg" 导致选沃尔夫斯堡加入里昂）

### UCL Format (`europeanEngine.ts`)
- 36 teams, single league table, 8 rounds each
- Fixture generation: round-robin circle method over pot-interleaved order — 8 perfect matchings = exactly 144 fixtures, 18 per round, each team 8 UNIQUE opponents (symmetric: A plays B ⇔ B plays A), greedy ≈4 home/4 away
- Top 8 → direct R16 (bye in rounds 9-10); 9-24 → KO playoffs (2 legs); 25-36 → eliminated
- Two-legged knockout with aggregate scoring; final is a single match (`singleLeg: true`)
- Unplayed virtual-vs-virtual ties are auto-resolved by league-phase ranking at stage advancement
- `syncTournamentStage(t, euroRound)` keeps the bracket in sync with the calendar (top-8 byes, stage transitions)

### Career Mode — AI Coach
- `generateAILineup()`: 1 GK + 10 best outfield, slot-mapped by position
- GK absolute isolation — never plays outfield, never subbed by outfield
- `advanceWeek` back-fill respects GK isolation
- Sub-on dice roll: 25-50% based on OVR

### Career Player System
- Attribute-based creation: ATT/PLM/DEF sliders (1-99), live OVR preview
- Position-weighted OVR: FWD(70/20/10), MID(30/50/20), DEF(10/20/70)
- Per-match rating (scarcity-based): max 6.8 without G/A, 8.5+ very rare
- Growth: recent-5-match avg > 7.3, age-curved (≤23 ×2, 24-29 ×1, 30+ ×0.3)
- Injury: major (≥6w) → potential -2~3, veteran → permanent attribute loss
- Age decline: ≥32 (non-linear, 35+ → -2~5)
- Career events: contract renewal, transfer offers, demotion warnings
- 退役流转：红色「挂靴退役」按钮 → RetireModal 二次确认（不可逆文案）→ `retirePlayer()` 构建 `careerLegacy`（buildCareerLegacy 纯函数：生涯总数据/奖杯墙/荣誉室/传奇评价五档 GOAT→平凡）→ `gameStatus: "RETIRED"` → App 路由 CareerLegacyScreen 谢幕页（纯 CSS 撒花）
- `careerTrophies` 奖杯记录：generateSeasonAwards 赛季结算时写入（联赛冠军 = 快照榜第 1；欧战冠军 = tournament final 胜者）；honours 写入必须基于最新 careerPlayer（避免覆盖刚记录的奖杯）
- `careerSeasons` 逐年记录：赛季结算时写入（球队/联赛/排名/欧战成绩/单季出场进球助攻评分/OVR/身价）——谢幕页时间轴与生涯峰值（最高 OVR/身价巅峰/单季进球纪录）数据源
- AI 教练自动引援：`aiReinforceSquad()` 在 startNewSeason 末（转会窗口）评估——位置组最佳球员长期伤停（≥6 周）或老化（≥33 岁）且健康球员 <4 → **青训提拔优先**（U21 潜力小将免费升一线队，零转会费）→ 无人则从转会市场签入位置匹配/质量相当/年轻（≤29 岁）新援（扣预算/移出市场/`new_signing` 事件通知），单窗口至多 2 笔
- **老将自主退役**：赛季结算管线（evolveSquad）对 35+ 球员按 `retirementChance`（35→10%，38→55%，40+→90%；OVR<75 ×1.3）退役出队；生涯球员跳过阵容层退役、由 startNewSeason 末专属判定触发 → `retirePlayer()` 直接进入生涯荣誉谢幕页
- **青训造血**：每赛季末所有俱乐部（含背景联赛）生成 2-4 名 U21 新秀（16-19 岁），潜力按俱乐部实力分层（有效实力 = 首发均 OVR + 声望：≥88 可出 90-95 POT 妖人，<76 上限 72）；U21 超龄（22+）自动出队防梯队膨胀
- `seasonAwards.euroFinish`：欧战最终名次快照（getEuropeanFinish 推导 冠军/亚军/四强/八强/十六强/附加赛出局/联赛阶段出局 + 图标），颁奖面板「欧战成绩」行展示；欧冠冠军触发专属全屏庆祝动效（UclCelebration 捧杯+彩带雨）
- 金靴得主**硬性入选最佳阵容**（同位置组顶替评分最低者、占据招牌名额 ST/CM/CB/GK——绝不允许被挤出最佳阵）
- 金球权重重构：ballonScore = G+A×2.5 + 评分×8 + OVR×0.8 + 欧冠冠军+18 + 联赛冠军+10；**断层直通**（G+A≥45 且评分≥7.7 且欧冠/联赛冠军）直接当选；常规档评分门槛放宽（35/8.5 → 30/8.0 → 25/7.7）
- 身价体系统一 `marketValue`（utils/marketValue.ts）：€200M 上限、OVR/POT/年龄梯度（96 OVR 22 岁妖人可触顶）；所有价值计算点（DB/自由球员/市场/新秀/成长/老化/生涯球员）统一接入；金球奖得主身价地板 €120M
- 西甲联赛完整接入：laLigaTeams.json（20 队）经 playerImport 管线（位置映射 LWF→FWD 等/OVR·POT 钳制/按名去重保高 OVR 或仅更新俱乐部）合并进 teamsDatabase；leagueRules 西甲 20 队 38 轮；TOP5_LEAGUES/ELITE_CLUBS/声望/欧战权重含西甲豪门；scripts/import-players.ts 读取 data_import/*.json|csv 写入 importedPlayers.json
- 首发阵容健壮兜底：`ensureValidStarters`（不足 11 人/引用失效/无门将 → 自动填回最强 11 人）；rehydrate 全队修复 + 一键模拟前置校验；`simError` Toast（阵容 <11 人/模拟异常 → 明确报错，绝不静默卡死）
- AI 阵容位置完整性：generateAILineup 均衡骨架（按阵型各位置最佳）+ 补位兼容链（DEF→MID→FWD，前锋最后客串）+ **客串硬限制 ≤1 人**；selectStartingXI 同样兼容链 + 客串上限；AI 阵型/战术每赛季随机化（经理模式玩家队除外）；aiReinforceSquad：位置组绝对短缺（<2 人）→ **缺口强制引援**（跳过青训直接市场购买专职球员）；老将退役保底（最多退到剩 11 人）
- 进球引擎位置加权：`pickWeightedScorer`（FWD 1.0 / MID 0.12 / DEF 0.02 × attack/99 因子）——前锋占 ≥85% 进球，中场赛季 2-10 球区间（曾修复：防守型中场单季 69 球夺金靴）
- 战术板渲染：`generatePitchSlots` + `mapStartersToSlots`（utils/pitchSlots.ts）——槽位坐标按真实阵型生成并严格校验（NaN/越界 → 回退 4-3-3 默认坐标）；首发映射**三层兜底**（index → 位置匹配 → 剩余填充，顺序异常也 11 人全渲染）；生涯战术板为独立组件 `CareerPitch`（固定高度 clamp + 零条件隐藏 + PitchErrorBoundary 错误边界降级网格）；曾修复"模拟时只剩门将"
- 安全 UUID：`generateUUID`（utils/uuid.ts）——window.crypto.randomUUID 优先，非安全上下文（手机 HTTP IP 访问）回退 Math.random v4 算法；全部 12 处 `crypto.randomUUID()` 调用点已替换（曾致手机白屏 `crypto.randomUUID is not a function`）
- 进球效率校准：`BASE_GOAL_RATE = 0.011`（场均两队总进球 2.0-3.2 区间）+ 单场单队 6 球封顶（杜绝 6-0/7-2 大比分）；实测射手榜顶级前锋 28-42 球区间（曾修复：菲尔克鲁格单季 63 球）
- Awards: Ballon d'Or 永不空缺（五大联赛+豪门资格 → 动态降级门槛 35/8.5 → 30/8.2 → 25/8.0 → 终极安全网取全服综合最佳）; TOTS = strict 4-3-3 (GK×1, DEF×4 LB/CB/CB/RB, MID×3 CDM/CM/CAM, FWD×3 LW/ST/RW, same-position fill only)

### Transfer & Loan Ecosystem (`src/data/careerTransfers.ts`)
- `TOP5_LEAGUES` (英超/意甲/德甲/法甲 DB 键) + curated `ELITE_CLUBS` (15 豪门) → `isBallonEligible(league, club)` 双条件金球资格；资格内无人达精英门槛 → **goldenBall = null 空缺**（无 near-elite 兜底）
- Elite Transfer Offer 触发：avgRecent≥7.5 + G+A≥10 + value≥8M + age<28；payload 带豪门 + 转会费（value × 1.2~1.6，`computeTransferFee`）
- Loan Offer 触发：低迷（avgRecent<6.5）或年轻豪门板凳（age≤23 + POT≥85 + 出场率<0.4×currentWeek）；目的地 = 同联赛弱队（场均 OVR 最低 3 队）+ 荷甲/德乙/土超/奥甲
- 换队时机：同联赛 → 立即生效（`moveCareerPlayerBetweenTeams` roster move + `remapTournamentTeamId` 欧战 id 重映射，standings/赛程保留）；跨联赛 → `pendingMove`，`startNewSeason` 消费并经 `buildWorldForMove`（generateWorld + cp 快照注入，generateWorld 换 UUID 必须按名字找队）重建世界
- 租借：同联赛 `loanParent {kind:"game"}` 赛季末 roster move 回归 + 成长奖励；跨联赛 `loanParent {kind:"db"}`（DB 层身份）下个赛季末重建世界回归
- `CareerPlayer` 新增 `loanParent`/`pendingMove`/`eventsThisSeason`（事件冷却）/`seasonAppearances`；`Team.league` 字段（realToGameTeam 赋值，rehydrate 按名字回填）
- 目的地一律来自 teamsDatabase 真实队——虚拟欧战队（virt-N）绝不可作东家（旧 transfer_offer 坏路径已移除）

### Season Flow
```
League R1→R38 → isLeagueEnd → standings → euroQual from leagueRules
  ├─ qualified: createTournament → European R1→R17
  └─ not qualified: skip European → season end
startNewSeason → generateSeasonAwards (真实追踪器 + 积分榜快照) → age+1 → growth/decline → new calendar → 追踪器清零
```

### True Season Stats Tracker (禁止赛季末捏造数据)
- `seasonPlayerStats: Record<playerId, SeasonPlayerStat>` — 每场比赛在 `playMatchweek`（引擎 Goal/Assist 事件）与 `simulateCareerPerformance`（生涯球员 perf，与生涯面板一致）中实时累加 appearances/goals/assists/ratingSum
- 非生涯球员单场评分 `computeMatchRating` **确定性推导**（同数据同分，无 Math.random）；生涯球员跳过事件累加（skipPlayerId），避免与 perf 双计
- `generateSeasonAwards` 候选池**严格读取追踪器**——同一球员在所有奖项/界面数据绝对一致（曾修复：金球 42 球 vs 金靴 82 球的"数据造假"Bug）
- 五大联赛后台推演（Top 5 Background Simulation）：`getTopFiveBackgroundStars`（careerTransfers.ts）收集五大联赛 OVR≥85 球星（按名字跳过已有真实数据的球员），`simulateBackgroundSeason` 按 OVR 动态推演赛季数据（OVR 88+ 球星有合理概率达成 G+A≥35/评分≥8.5）——一次性生成、全奖项共用，杜绝同人异数
- 动态降级门槛：资格内按 精英(35/8.5) → 准精英(30/8.2) → 出色(25/8.0) 逐级放宽，选出综合评分（G+A×2 + rating×10 + OVR）最高的全服第一人；**金球奖绝不空缺**（goldenBall 非空；终极安全网取全池最佳；旧存档的空缺奖项在 rehydrate 时清除）
- 战绩快照：`generateSeasonAwards` 在 `startNewSeason` 重置积分榜**之前**把 `sortStandings` 结果抓入 `seasonAwards.finalStandings`（含 playerClubId/playerClubName/euroStage）——颁奖面板必须读快照，绝不读活积分榜（曾修复：赛季结算显示 0胜0平0负）
- 玩家单赛季数据快照：`seasonAwards.playerSeasonStats`（追踪器清零前抓取）——颁奖面板「我的赛季数据」卡片（出场/进球/助攻/场均评分）与金靴/金球面板同源、数字绝对一致
- goldenBoot/leagueBest 可空（空缺渲染）；stress 审计 `auditAwards` 校验：金球非空、得主 ∈ 豪门名单、不低于最低档（G+A≥25/评分≥8.0）、金靴进球 ≥ 金球进球（同源一致性）
- `MatchEventType.Assist`：引擎进球时中前场球员 80% 概率生成真实助攻事件

### Sim Pacing (startSeasonSimulation checkpoints)
- Pause (simulationPaused) at: last league matchday · UCL league-phase round 8 · KO round legs done (euro rounds 10/12/14/16) · careerEvent
- Pause modal's 确认 ONLY closes (clears simulationPaused) — the player must click 继续模拟 to resume
- **淘汰出局流转**：KO 轮失利时**先强制暂停汇报**（`pendingElimination: true`，绝不跳过汇报直接结算）；玩家在汇报面板点「确认」→ `confirmSimulationPause()` → 此时才 `endSeasonEarly()` 结算赛季（rank/prize/seasonResult）。非淘汰的确认只关弹窗、绝不续跑
- `seasonMatchLog` entries carry `phase`/`competition`/`label` (semantic labels from `formatMatchdayLabel`); `simulationSegmentStart` marks the current sim segment — the pause modal renders ONLY that segment, grouped by phase headers (联赛 vs 欧战 never mixed)

### Calendar
```
[League R1...R38] → [Euro R1...R17]
```
All league rounds first, European phase at season end (post-league format).

## Critical Gotchas

### `generateWorld` UUIDs
`generateWorld()` assigns new UUIDs. Never use real DB IDs after generation — use **name matching**.

### Stamina vs Overall
`WEIGHTS` table: `sta: 0.00`. Stamina is a fitness stat; overall = ATT + PLM + DEF only. `getDisplayedOverall()` applies -5 for injured players.

### GK Isolation
Enforced in: `generateAILineup`, `advanceWeek`, `playMatchweek` injury auto-replace. GKs never play outfield.

### Knockout Tie Score Convention (⚠️ previously triple-bugged)
- `simulateMatch()` ALWAYS puts the player at match home — the result's home/away is never a real venue.
- Therefore tie scores are recorded in **TIE-side terms**: `isTieHome ? homeScore : awayScore` (the old player-side swap credited the player's goals to the opponent when the player was the tie's away side).
- Aggregate = each team's own two legs summed (`homeScore + homeScore2` vs `awayScore + awayScore2`). The old cross-terms (`homeScore + awayScore2`) double-counted one team's goals.
- `updateKnockoutTie` decides only after BOTH legs — the old single-match fallback fired after leg 1 of every two-legged tie, set `played2` early and turned leg 2 into a bye. Single-match finals are marked `singleLeg: true` instead.
- **点球大战**：两回合总比分打平（或单场决赛常规时间打平）→ `simulatePenaltyShootout`（5 轮 75% 命中 + 突然死亡，安全上限 20 轮防病态 rng 死循环）→ tie 记录 `penaltyHome/penaltyAway`，winnerId 由点球结果判定。汇报记录拼接 `(点球 3-4 负)`。
- **欧战专属豪门权重**：`simulateMatch(home, away, { european })`——欧战上下文中 curated 超级豪门获 `EURO_ELITE_BOOST`（曼城/拜仁/巴黎 +8，利物浦/阿森纳/国米/米兰/尤文 +6…）等效 OVR 加成（只影响欧战、不影响国内联赛）。曾修复：真实曼城（均分 ~82）长期输给虚拟豪门（88-90），16 个赛季进不了 16 强；修复后 8 次试验联赛阶段全部前 6、全部进 16 强（3 次进决赛）

### Knockout Elimination
`isPlayerEliminated()`: rank > 24 counts only AFTER the league phase (mid-phase standings are provisional); otherwise elimination = a completed tie won by the opponent, or the bracket advancing past a stage the player wasn't in. In `startSeasonSimulation` a KO loss triggers `endSeasonEarly()` (immediate settlement with rank/prize/seasonResult); in manual play, eliminated players just skip the remaining European matchdays (bye per round).

### League Rules
`src/data/leagueRules.ts` — per-league config for teams, rounds, euro spots. `buildEuroSlots(rules)` generates qualification mapping. Fallback: `getLeagueRules(name)` fuzzy match.

### Save Migration
`onRehydrateStorage` handles: missing fields, old SeasonResult format, stale playerTeamId, NaN cleanup in standings, CareerPlayer playmaking/recentRatings/honours defaults.
