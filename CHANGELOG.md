# 📋 开发日志

## 创作步骤

### 第一阶段 — 地基（类型与数据）

| # | 任务 | 文件 |
|---|------|------|
| 1 | 定义核心游戏接口 | `src/types/game.ts` |
| 2 | 构建世界生成器 | `src/utils/worldGenerator.ts` |
| 3 | 搭建 Zustand 状态管理 | `src/store/useGameStore.ts` |
| 4 | 接入 Tailwind CSS v4 | `vite.config.ts`、`src/index.css` |

### 第二阶段 — 比赛引擎

| # | 任务 | 文件 |
|---|------|------|
| 5 | 纯函数比赛模拟器 | `src/utils/matchEngine.ts` — 90 分钟循环 / 首发筛选 / 战术Buff / 伤病 / 进球 |

### 第三阶段 — UI 骨架

| # | 任务 | 文件 |
|---|------|------|
| 6 | 初始画面 + 仪表盘 | `src/App.tsx` — 双栏布局 / 球员表格 / 积分榜 / 比赛结果弹窗 |

### 第四阶段 — 核心逻辑

| # | 任务 | 文件 |
|---|------|------|
| 7 | 周赛制 playMatchweek | `src/store/useGameStore.ts` — 8 队配对 / 4 场同时模拟 / 积分排序 |
| 8 | 位置感知能力生成 | `src/utils/worldGenerator.ts` — FWD 进攻高 / DEF 防守高 / MID 均衡 / GK 防守极高 |

### 第五阶段 — 战术系统

| # | 任务 | 文件 |
|---|------|------|
| 9 | 8 种阵型 + 3 种战术 | `src/types/game.ts` — Formation / Tactic / FORMATION_SLOTS |
| 10 | 战术面板组件 | `src/components/TacticsPanel.tsx` — 迷你站位图 + 心态选择 |
| 11 | 引擎战术 buff | `src/utils/matchEngine.ts` — ±15% 攻防修正 |

### 第六阶段 — 体能、伤病与轮换

| # | 任务 | 文件 |
|---|------|------|
| 12 | 体能消耗与恢复 | `src/store/useGameStore.ts` — 首发 −5~10 / 替补 +8~15 / 每周 +20~50 |
| 13 | 非线性伤病系统 | `src/utils/matchEngine.ts` — 1~26 周 / 重伤潜力惩罚 / `injuryRiskMultiplier` |
| 14 | 赛前校验 | `src/store/useGameStore.ts` — 首发 ≠ 11 或含伤员 → 拦截 |
| 15 | 两击换人 + 自动轮换 | `src/App.tsx` / `src/store/useGameStore.ts` |
| 16 | 体能条 + 伤病 UI | `src/App.tsx` — 绿/琥珀/红进度条 + 🩹 X周 |

### 第七阶段 — 成长系统

| # | 任务 | 文件 |
|---|------|------|
| 17 | 潜力属性 | `src/types/game.ts` — `Player.potential` 50–99 |
| 18 | 比赛成长 + 老将衰退 | `src/store/useGameStore.ts` — 按潜力+年龄 / 30+ 衰退 |
| 19 | 老将潜力锚定 | `src/utils/worldGenerator.ts` — age ≥ 29 → potential = overall + 0~2 |
| 20 | 重伤潜力惩罚 | `src/store/useGameStore.ts` — injury ≥ 8周 → potential −2~5 |

### 第八阶段 — 转会市场与青训

| # | 任务 | 文件 |
|---|------|------|
| 21 | 转会市场数据 | `src/data/transferMarket.ts` — 25 人初始池 |
| 22 | buyPlayer / sellPlayer | `src/store/useGameStore.ts` — 三梯队签约 / 80% 回收 |
| 23 | 转会市场 UI | `src/App.tsx` — 搜索/筛选/三按钮签约 |
| 24 | U21 / U18 梯队 | `src/types/game.ts` — 提拔/下放 |
| 25 | 自由球员提取 | `extract_free_agents.py` + `src/data/freeAgentsDatabase.ts` — 498 人 |
| 26 | 自由球员去重 | `src/store/useGameStore.ts` — 姓名+年龄交叉比对 |

### 第九阶段 — 多联赛与真实球队

| # | 任务 | 文件 |
|---|------|------|
| 27 | 中文球队数据库 | `src/data/teamsDatabase.ts` — 8 联赛 140 队 / 真实球员大名单 |
| 28 | 开局选队界面 | `src/components/TeamSelection.tsx` — 联赛列表 + 球队网格 |
| 29 | 世界生成器重构 | `src/utils/worldGenerator.ts` — 真实球队优先 / 随机兜底 |
| 30 | JSON 导入支持 | `tsconfig.app.json` — `resolveJsonModule: true` |
| 31 | CSV 提取脚本 | `extract_free_agents.py` — male_players.csv → free_agents_output.json |

### 第十阶段 — 赛季循环与欧战

| # | 任务 | 文件 |
|---|------|------|
| 32 | 赛季赛历 | `src/utils/calendar.ts` — 54 比赛日（38 联赛 + 13 欧战） |
| 33 | 欧战引擎 | `src/utils/europeanEngine.ts` — 32 虚拟队 / 小组赛 / 淘汰赛 |
| 34 | 赛季结算 | `src/store/useGameStore.ts` — 排名奖金 / 赛季结束弹窗 |
| 35 | 新赛季初始化 | `src/store/useGameStore.ts` — 年龄+1 / 欧战资格分配 / 体能恢复 |
| 36 | 欧战 UI 适配 | `src/App.tsx` — 蓝色主题按钮 / 赛历标签 |

### 第十一阶段 — 图形化阵型与响应式

| # | 任务 | 文件 |
|---|------|------|
| 37 | 图形化阵型 Pitch | `src/components/LineupPitch.tsx` — 绿茵场 + 11 槽位点选 |
| 38 | 底部抽屉选择面板 | `src/components/LineupPitch.tsx` — 手机端底部弹出 |
| 39 | 全场响应式布局 | `src/App.tsx` — 移动端垂直堆叠 / 桌面端左右分栏 |
| 40 | 触控优化 | `src/components/LineupPitch.tsx` — min-h-[44px] / touch-manipulation |

### 第十二阶段 — 稳定性与架构

| # | 任务 | 文件 |
|---|------|------|
| 41 | Error Boundary | `src/main.tsx` — 捕获渲染崩溃 / 一键重置 |
| 42 | Zustand 版本迁移 | `src/store/useGameStore.ts` — version: 2 + 自动迁移 |
| 43 | Hooks 规则修复 | `src/App.tsx` — App → MainGame 拆分 |
| 44 | 空值安全加固 | `matchEngine.ts` / `useGameStore.ts` — `?.` 全链路 |
| 45 | 旧 ID 兼容自动修复 | `src/store/useGameStore.ts` — 陈旧 starterId 自动填充 |
| 46 | 转会市场去重 | `src/store/useGameStore.ts` — isSamePlayer 交叉比对 |

---

## 🔮 更新路线图

### v0.5 — 训练与球探
- [ ] 训练系统（指定球员强化特定属性）
- [ ] 球探网络（自动发现青年天才）

### v0.6 — 视听打磨
- [ ] 音效（进球、哨声、观众）
- [ ] 比分揭晓动画
- [ ] 球员头像

### v0.7 — 存档与分享
- [ ] 导出/导入存档（JSON 下载）
- [ ] 多个存档槽位

---

## ⚙️ 技术债务

- [ ] 拆分 App.tsx 组件
- [ ] 为 matchEngine / worldGenerator 添加单元测试
- [ ] 球员详情卡片
