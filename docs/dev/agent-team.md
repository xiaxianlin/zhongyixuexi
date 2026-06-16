# Agent Team —— 多 agent 并行开发方案

> 目标：让多个 subagent **同步（并行）开发**各模块，互不冲突；由主 agent 负责调度与集成。这是 Phase 1 验证过的"disjoint 服务层切片 + 主 agent 集成共享文件"模式的制度化。
>
> 配套：6 个模块 subagent 定义在 `.claude/agents/dev-{rd,ai,srh,set,lrn,note}.md`。

## 1. 团队组成

| 角色 | 谁 | 职责 |
|---|---|---|
| **Orchestrator / Integrator** | 主 agent（你对话的我） | 唯一调度者（subagent 不能嵌套 spawn）；派发任务、集成共享文件、跑质量门、commit、更新 PROGRESS |
| **dev-rd** | subagent | 阅读 RD 模块 |
| **dev-ai** | subagent | AI 工具模块（DeepSeek） |
| **dev-srh** | subagent | 检索 SRH 模块 |
| **dev-set** | subagent | 设置与数据 SET 模块 |
| **dev-lrn** | subagent | 学习闭环 LRN 模块（SM-2） |
| **dev-note** | subagent | 笔记 NOTE 模块（双链） |

> 关键约束：**subagent 不能 spawn subagent**。所以调度永远由主 agent 发起——主 agent 在一条消息里并行 `Agent(subagent_type: "dev-rd")`、`"dev-ai"` …，等全部返回后集成。

## 2. 文件所有权矩阵（避免并行写冲突）

每个模块 subagent **只**创建/修改自己列内的文件。

| 模块 | 独占文件 |
|---|---|
| dev-rd | `electron/services/reading.ts`、`electron/ipc/reading.ts`、`src/modules/reading/**`、`src/lib/reading-api.ts`、`electron/db/migrations/reading.sql`、自有 `*.test.ts` |
| dev-ai | `electron/ai/**`、`electron/services/ai.ts`、`electron/ipc/ai.ts`、`src/modules/ai/**`、`src/lib/ai-api.ts`、`migrations/ai.sql`、自有测试 |
| dev-srh | `electron/services/search.ts`、`electron/ipc/search.ts`、`src/modules/search/**`、`src/lib/search-api.ts`、`migrations/search.sql`、自有测试 |
| dev-set | `electron/lib/keystore.ts`、`electron/services/{settings,backup}.ts`、`electron/ipc/settings.ts`、`src/modules/settings/**`、`src/lib/settings-api.ts`、`migrations/settings.sql`、自有测试 |
| dev-lrn | `electron/services/learning.ts`、`electron/ipc/learning.ts`、`src/modules/learning/**`、`src/lib/learning-api.ts`、`migrations/learning.sql`、自有测试 |
| dev-note | `electron/services/notes.ts`、`electron/ipc/notes.ts`、`src/modules/notes/**`、`src/lib/notes-api.ts`、`migrations/notes.sql`、自有测试 |

## 3. 共享文件（**仅 orchestrator 可改**）

模块 subagent **严禁触碰**：

- `electron/ipc/index.ts`（集中注册所有 `registerXxxHandlers()`）
- `electron/main/index.ts`
- `electron/db/migrate.ts`（把各 `migrations/*.sql` 接入迁移序列）
- `src/App.tsx`（路由：各模块视图挂载点）
- `src/lib/ipc.ts`（仅放通用 `invokeRaw/subscribe`；各模块用自己的 `src/lib/<m>-api.ts`）
- `src/lib/types.ts`、`package.json`、`package-lock.json`

> 设计意图：每个模块的 wrapper 单独成文件（`src/lib/<m>-api.ts`），避免多 agent 同时往 `ipc.ts` 追加导致冲突——这是 Phase 1 的教训。

## 4. 跨模块契约（并行前先固定，避免接口漂移）

| 契约 | 提供方 → 消费方 | 约定 |
|---|---|---|
| API Key | dev-set → dev-ai | 主进程内 `getActiveApiKey(): {provider,baseUrl,model,apiKey}\|null`；明文不进 IPC、不进日志 |
| 全文检索 | dev-srh → dev-ai | `searchParagraphs(q, {limit}): {paragraphId,snippet,score}[]`（FTS5 top-k，供 RAG） |
| 解读落库 | dev-ai → dev-rd | AI 写 `paragraphs.content_modern`；RD 解读栏读该列渲染 |
| 卡片草稿 | dev-ai → dev-lrn | `generateCards` 产出 `[{front,back,type,paragraphId?}]`；dev-lrn 提供 `createCards(drafts)` |
| 笔记绑段 | dev-note → dev-rd | `notes WHERE paragraph_id=? AND deleted_at IS NULL`；外键 `ON DELETE SET NULL` |
| 当前焦点 | 所有 → session store | `activeBookId/activeChapterId/activeParagraphId/view`（`src/stores/session.ts`，已存在） |

## 5. 并行波次（按依赖）

**Wave 1（服务层可全部并行）**：dev-set、dev-srh、dev-lrn、dev-note、dev-rd —— 仅依赖 Phase 1 已有的 schema/IPC/FTS。
**Wave 2**：dev-ai —— 依赖 Wave 1 的 `getActiveApiKey`(SET)、`searchParagraphs`(SRH)、`paragraphs.content_modern`(RD)。

> 实操：每个 Phase 由主 agent 做一次 fan-out（该 Phase 相关模块并行），返回后串行集成。不必一次派 6 个——按 Phase 需要的模块派。

## 6. 集成协议（主 agent 在 subagent 返回后执行）

1. 收集每个 subagent 返回摘要里的：`<module>:*` channel 清单、`src/lib/<m>-api.ts`、`ipc/index.ts` 注册行、`App.tsx` 路由片段、`migrations/<m>.sql`。
2. **migrate.ts**：为每个 `migrations/*.sql` 加一条 migration 条目（forward-only，不破坏稳定 ID）。
3. **ipc/index.ts**：`import { registerXxxHandlers }` + 在 `registerAllIpc()` 调用。
4. **App.tsx**：挂载各模块视图（按 session.view 路由）。
5. `src/lib/ipc.ts` **不动**（各模块 wrapper 独立文件）。
6. 跑 `npm run check` 全绿——解决跨模块类型摩擦（如契约签名对齐）。
7. 端到端 smoke + 必要时扩展 `electron/main/integration-check.ts`。
8. 分 slice commit（conventional + slice 编号）+ 更新 `docs/dev/PROGRESS.md`。

## 7. 调度示例（主 agent）

在**一条消息**里并行派发（同一 Phase 的模块）：
```
Agent(subagent_type: "dev-set", prompt: "实现 SET-01~03，按你的所有权范围……")
Agent(subagent_type: "dev-srh", prompt: "实现 SRH-01/02/04……")
Agent(subagent_type: "dev-lrn", prompt: "实现 LRN-01~03，SM-2 必须有单测……")
Agent(subagent_type: "dev-note", prompt: "实现 NOTE-01/02，双链解析必须有单测……")
```
全部返回后 → 执行 §6 集成 → Wave 2 派 `dev-ai`。

## 8. 并行纪律（写进每个 subagent prompt）

- subagent **不运行** `npm/tsc/check/build`（会读到其它并行 agent 的半成品文件，互相干扰）；自行通读保证可编译。
- subagent **不创建**所有权之外的文件。
- subagent 在摘要里**贴出**主 agent 需要的集成片段（channel、注册行、路由、DDL）。
- 主 agent 是唯一跑 `npm run check` 与 commit 的人。

## 9. 生效说明

`.claude/agents/*.md` 是磁盘定义——**新建后需重启 Claude Code 会话**才会被加载为可调用的 `subagent_type`（用 `/agents` 在 UI 内建的即时生效；文件式不即时）。重启后即可用 `Agent(subagent_type: "dev-rd")` 等调用。
