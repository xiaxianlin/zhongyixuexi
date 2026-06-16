# Loop Engineering 方案（驱动项目从文档到可运行软件）

> 目标：用一套**文件驱动、可暂停恢复、有人工 gate 的循环工程流程**，把 `docs/PRD.md` + `docs/dev/0x-*.md` 推进为可运行的 Electron + React 应用。
>
> 配套文件：`docs/dev/PROGRESS.md`（slice 看板，唯一进度事实来源）。

---

## 1. 核心理念

- **小切片、快验证**：每轮循环只完成一个最小可交付切片（slice），立刻过质量门。
- **文件即状态**：进度、决策、阻塞全部写进 `PROGRESS.md` 与 git 历史；不依赖会话内存，任何时刻可恢复。
- **质量门不可绕过**：每轮结束必须 `tsc + lint + test` 全绿，否则该 slice 退回 doing 不算完成。
- **人工 gate 在阶段边界**：阶段（Phase）内部 slice 自动串行；阶段切换时停下等人确认，防方向漂移。
- **一次一个 slice**：禁止一轮做多件不相关的事，保证可回滚、可审查。

## 2. 三层结构

```
Phase（阶段）  ── 有明确 exit criteria，边界处人工 gate
  └─ Slice（切片） ── 最小可交付单元，一轮循环的粒度
       └─ Loop（循环） ── 单个 slice 的 plan→implement→verify→record→commit
```

## 3. 工作分解（slice 队列，按依赖排序）

> 完整清单见 `PROGRESS.md`。此处给出阶段与关键切片。编号 `S<phase>.<n>`。

### Phase 0 · 工程脚手架（所有模块的地基）
- S0.1 `git init` + Electron+React+Vite+TS 工程初始化、`.gitignore`
- S0.2 目录骨架（`electron/{main,preload,services,db,ipc,ai,models,lib}` + `src/{modules,stores,lib,components,styles}`）
- S0.3 better-sqlite3 集成 + 连接初始化（**`PRAGMA foreign_keys=ON`**）+ 迁移 runner 骨架
- S0.4 IPC 基建：`contextBridge` + `ipcMain.handle` 封装 + `AppError` + `src/lib/ipc.ts` 类型化封装
- S0.5 主题 token（`--ink/--paper/--accent`）+ 应用 shell + Zustand `session` store
- S0.6 质量门脚本：`tsc --noEmit` + ESLint + Vitest，`package.json` 串成 `check`
- **Exit**：空壳能启动、质量门脚本可跑、`window.api` 类型可用。

### Phase 1 · 导入解析与书库（IMP + LIB + schema）
- S1.1 schema：`books / chapters / paragraphs`（双键 + 软删 + 级联外键）
- S1.2 EPUB 解析服务（node-stream-zip + fast-xml-parser：OPF/NCX/spine）
- S1.3 段落切分 + 稳定 ID（UUID v4）+ `parse_hash`
- S1.4 FTS5 `fts_paragraphs` 同步（应用层 + 触发器，IMP 唯一职责）
- S1.5 导入流程 IPC + 进度推送 + **段级校对界面**
- S1.6 书库浏览 + 目录树 + 删除级联事务
- **Exit**：能导入一本真实 EPUB → 校对 → 在书库看到章节树 → 删除干净。

### Phase 2 · 阅读（RD）
- S2.1 三栏工作台 + 布局预设（settings）
- S2.2 原文栏渲染 + 古风排版 + 繁简/拼音占位
- S2.3 段级进度 `reading_progress` + 书签 `bookmarks`
- S2.4 逐段锁定同步滚动（解读栏 AI 未接入前占位）
- S2.5 词条浮窗（本地词典占位）
- S2.6 沉浸/主题切换/快捷键/多 Tab
- **Exit**：能流畅阅读导入书、进度可恢复、布局可调。

### Phase 3 · 检索（SRH）
- S3.1 全文检索（FTS5 trigram）+ 结果定位到段
- S3.2 全库高亮 + 结果列表
- S3.3 术语词典 `dictionary_terms`
- **Exit**：跨书搜词命中段落可跳转。

### Phase 4 · 设置与数据（SET）
- S4.1 `safeStorage` 加密 API Key 存储 + DeepSeek 预设
- S4.2 设置面板 + 主题/字号
- S4.3 数据备份导出/导入（tar + 双校验）
- S4.4 迁移 runner 完善 + 书籍文件管理
- **Exit**：可配 Key、切主题、备份换机。

### Phase 5 · AI 增强（AI）
- S5.1 DeepSeek 客户端（fetch + 重试 + 错误映射）
- S5.2 `ai_cache` 表 + 命中策略
- S5.3 白话解读生成 → 填充解读栏 + 同步对齐
- S5.4 RAG 智能问答（FTS top-k）
- S5.5 失败降级（AI-07）+ 三层红线拦截
- S5.6 记忆卡批量生成（依赖 S6.1）
- **Exit**：DeepSeek 解读/问答可用、断网降级、缓存生效。

### Phase 6 · 学习闭环（LRN）
- S6.1 `cards/review_log` 表 + **SM-2 纯函数 + 单元测试**
- S6.2 翻卡 UI + 评分驱动调度
- S6.3 每日复习计划（到期查询）
- S6.4 测验 + 错题转卡
- S6.5 学习仪表盘
- **Exit**：加卡→复习→测验→仪表盘闭环跑通。

### Phase 7 · 笔记（NOTE）
- S7.1 `notes` 表 + Milkdown 编辑器
- S7.2 双链 `[[ ]]` 解析 + `note_links` + backlinks
- S7.3 标签/笔记本 + 段落绑定
- S7.4 导出 MD/HTML/PDF
- **Exit**：边读边记、双链可跳、可导出。

### Phase 8 · 打包发布
- S8.1 electron-builder（Win nsis / macOS dmg）
- S8.2 更新策略（前端资源热更 reload + electron-updater）
- S8.3 EPUB 测试夹具回归套件
- **Exit**：双平台安装包可装可用。

## 4. 单轮循环流程（每个 slice）

```
1. PICK   读 PROGRESS.md，取第一个 status=todo 的 slice
2. CONTEXT Read 该 slice 涉及的 PRD 段 + 技术文档 + 已有代码，理解约定
3. PLAN   在 PROGRESS.md 把它置 doing，写一句实现要点
4. IMPLEMENT 按 00-architecture 约定写代码（风格、IPC、分层）
5. VERIFY 跑质量门：tsc --noEmit → lint → 相关测试；不得破坏已有测试
6. RECORD 在 PROGRESS.md 记：产出文件、关键决策、遗留问题；置 done
7. COMMIT git add + commit（conventional commit，附 slice 编号）
8. GATE   若触发 Phase exit criteria → 停下报告等确认；否则结束本轮
```

**硬规则**：
- 一轮一个 slice，禁止批量。
- 质量门不绿 = slice 留 doing、不 commit、本轮算未完成。
- 遇阻塞：置 `blocked` + 写原因，停下报告，不强推。

## 5. 质量门（每轮必须全过）

```bash
# package.json scripts.check
tsc --noEmit && eslint . && vitest run
```

- 类型零错误；lint 零 error（warning 记录不阻断）；
- 新增/相关测试通过；**已有测试不得变红**（回归红线）；
- 涉及 schema 变更必须带正向迁移脚本，不得 DROP 稳定 ID 列。

## 6. 进度追踪：`PROGRESS.md`

每个 slice 一行，字段：`编号 | 状态 | 摘要 | 产出 | 决策/阻塞`。
状态：`todo / doing / done / blocked / skipped`。
- 唯一进度事实来源；每轮首读、末写。
- Phase 间用 `---` 分隔，附 exit criteria 勾选框。

## 7. 版本控制策略

- 仓库当前**非 git**：S0.1 第一件事 `git init` + `.gitignore`（排除 `node_modules/`、`dist/`、`release/`、`*.db`、用户数据）。
- 分支：主开发在 `main`；长切片可开 `slice/Sx.y` 分支，合并后删。
- Commit：`feat(imp): parse epub spine into chapters (S1.2)`；每个 slice 一个 commit（可多步但最终一个语义 commit）。
- 不主动 push（用户要求时再 push）。

## 8. 驱动方式（三选一，推荐 C）

- **A · 全自动无人 loop**：用 `/loop` 让上面「单轮 prompt」按节奏自推进，直到遇 Phase gate 或 blocked 才停。
  - 优点：快；缺点：token 消耗大、方向漂移风险、难中途回头。
- **B · 手动逐轮**：你每轮贴一次 prompt，我做完一个 slice 报告，你确认下一个。
  - 优点：完全可控、省 token；缺点：要人盯着。
- **C · 混合（推荐）**：Phase 内用 loop 自动串行 slice；Phase 边界停下做人工 review + 确认进入下一 Phase。token 与可控性平衡。

> 无论哪种，状态都在 `PROGRESS.md` + git，随时可暂停/换人/恢复。

## 9. 风险控制

| 风险 | 控制 |
|---|---|
| 方向漂移 | Phase 边界人工 gate；每轮只做一个 slice |
| 质量退化 | 质量门硬卡；已有测试不得变红 |
| 不可回退 | git 每 slice 一 commit；schema 仅正向迁移 |
| token 失控 | 混合驱动；slice 粒度小；遇复杂决策停下问 |
| AI 误删/误改 | 危险操作（删数据/改 schema）前读目标确认；不 push |

## 10. 单轮 Loop Prompt 模板（可直接复制给 /loop 或手动触发）

```
你是本项目（中医经典本地学习软件，Electron+React）的循环工程执行者。
严格按 docs/dev/loop-engineering.md 的「单轮循环流程」执行：

1. 读 docs/dev/PROGRESS.md，取第一个 status=todo 的 slice（若 doing 则继续它）。
2. 读相关 PRD 段 + docs/dev 下对应模块技术文档 + 已有代码。
3. 实现该 slice，遵循 docs/dev/00-architecture.md 约定（IPC/分层/主题/全局硬约束）。
4. 跑质量门 `npm run check`（tsc+lint+test），必须全绿且不破坏已有测试。
5. 更新 PROGRESS.md：该 slice 置 done，记产出文件与决策；若阻塞置 blocked 并停下。
6. git add + commit（conventional commit，带 slice 编号）。
7. 若该 slice 触发其所在 Phase 的 exit criteria，停下报告等我确认下一 Phase。
8. 一轮只做一个 slice；不要批量；危险操作（删数据/改 schema）前先说明。

完成后用 3-5 行汇报：做了什么、质量门结果、下一 slice 是什么。
```

## 11. 启动 Checklist

- [ ] 确认驱动方式（A/B/C）
- [ ] 确认初始 `PROGRESS.md` slice 清单
- [ ] 启动 Phase 0（S0.1 起）
