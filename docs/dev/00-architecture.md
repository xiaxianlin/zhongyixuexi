# 架构总览与公共约定（00-Architecture）

> 本文件是各模块技术设计文档的**共同地基**。所有模块文档（01–08）必须遵循此处的项目结构、IPC 约定、数据模型规范与文档模板。需求依据见 `docs/PRD.md`。

> ⚠️ **本文档已于 2026-06-18 对齐当前实现（v3.0 收敛重构后形态）。** 下文 §1/§2/§3/§4/§5 已按代码现状校正：
> - 内容来源从"用户导入 EPUB"改为**内置三本经典**（`data/*-original.json` + 启动 seed）。
> - DB 从"forward-only migrations"改为**单一 `schema.ts` + 版本不符删库重建**（仅开发期）。
> - IPC preload 从"按模块暴露 api"改为**仅暴露 `{invoke, on}`**；模块 API 在 `src/lib/*-api.ts`。
> - 多张表（cards/review_log/quiz_*/dictionary_terms/bookmarks/tags/notebooks/note_links/entities/relations）已在重构中删除，§5 仅列现存表。
> - 8 份模块文档（01–08）描述的是**原始愿景设计**，与当前代码有出入，各文档顶部已加状态标注，**以本文件与代码为准**。

---

## 1. 项目背景（摘要）

- **产品**：中医经典本地学习软件（PC 桌面）。
- **核心约束**：只做 PC；本地优先（无账号/无云同步/无服务端）；联网仅 AI API（默认 DeepSeek）；**内置三本中医经典**（《素问》《灵枢》《难经》）。
- **完整需求**：见 `docs/PRD.md`（v3.0）。

## 2. 技术栈（当前实现）

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | **Electron** | 主进程 Node.js + Chromium 渲染；主进程强制 CJS（无 `type:module`） |
| 主进程 | **Node.js + TypeScript** | 业务逻辑、DB、AI HTTP 均在主进程 |
| 前端（渲染） | **React 18 + TypeScript + Vite** | ESM，HMR |
| IPC | **contextBridge（仅 `{invoke,on}`）+ ipcMain.handle（`{__ok}` 信封）** | contextIsolation 开启、nodeIntegration 关闭 |
| 状态管理 | **Zustand** | session/ui/ai/search，仅会话/UI 缓存，持久化一律 SQLite |
| 样式 | **原生 CSS + 主题 token**（`src/styles/theme.css`） | 三主题（paper/ink/dark）经 `data-theme` 切换；**未用 Tailwind/shadcn**（早期文档提及，实际未引入） |
| 路由/导航 | 状态机式（Zustand session store 驱动 `view`） | 非传统 URL 路由 |
| 数据库 | **SQLite（better-sqlite3）+ FTS5（trigram）** | 主进程同步驱动；单一 `schema.ts`，开发期 reset 式 |
| 内容来源 | **随包 `data/*-original.json` + 启动 `seedBuiltinContent()`** | 内置三书；EPUB 解析工具链（`node-stream-zip` + `fast-xml-parser`）仅用于离线生产这些 JSON |
| HTTP/AI | **全局 `fetch`** | 调用 DeepSeek / 其他厂商；唯一联网点 |
| Key 安全存储 | **Electron `safeStorage` + 机器绑定 AES fallback**（`electron/lib/keystore.ts`） | API Key 原生加密，明文不出主进程 |
| 构建/打包 | **electron-builder** | Win（nsis）/ macOS（dmg）—— Phase 8 todo |
| 更新 | 前端资源热更（reload）+ `electron-updater`（规划） | 见 §10 |

> **未引入（早期文档提及）**：Tailwind/shadcn-ui（用原生 CSS）、sqlite-vec 向量检索、keytar（用 safeStorage）、nodejieba（用 FTS5 trigram）、opencc 繁简、puppeteer。

## 3. 项目目录结构（当前实现）

```
zhongyixuexi/
├── docs/                      # 产品/技术文档
│   ├── PRD.md                 # 产品需求（v3.0，收敛后）
│   └── dev/
│       ├── 00-architecture.md # 本文件（已对齐实现）
│       ├── 01-import-parse.md ~ 08-settings-data.md  # 模块设计（原始愿景，顶部有状态标注）
│       ├── PROGRESS.md        # 进度看板（唯一进度事实来源）
│       ├── loop-engineering.md / agent-team.md / book-import-json.md
│       └── design/
├── data/                      # 随包内置经典源数据（JSON）
│   ├── suwen-original.json    # 《素问》
│   ├── lingshu-original.json  # 《灵枢》
│   └── nanjing-original.json  # 《难经》
├── electron/                  # Electron 主进程（Node + TS，CJS）
│   ├── main/                  # 主进程入口、窗口管理、生命周期、集成检查
│   │   ├── index.ts           # ready 时 prepareDatabase + seedBuiltinContent + registerAllIpc
│   │   └── integration-check.ts
│   ├── preload/               # preload：仅暴露 {invoke, on}（contextIsolation 开）
│   │   └── index.ts
│   ├── db/                    # better-sqlite3 单例 + schema + FTS
│   │   ├── connection.ts      # 连接（WAL + foreign_keys=ON）
│   │   ├── schema.ts          # 单一 CURRENT_SCHEMA（version=2），版本不符 resetDbFiles
│   │   ├── fts.ts             # rebuildFts
│   │   └── index.ts
│   ├── services/              # 业务逻辑（按模块）
│   │   ├── builtin-content.ts # 启动 seed 内置经典
│   │   ├── content-normalize.ts
│   │   ├── library.ts         # listBooks / getChapterTree / buildChapterTree
│   │   ├── reading.ts         # getChapter（段落 + 解读）
│   │   ├── search.ts          # FTS5 检索
│   │   ├── notes.ts           # 段绑定笔记 CRUD
│   │   ├── ai.ts              # generateModern（段级解读编排）
│   │   ├── paragraph-analysis.ts # 解读版本化读写
│   │   ├── settings.ts        # AI 凭证 provider CRUD
│   │   └── learning.ts        # 阅读足迹仪表盘聚合
│   ├── ipc/                   # ipcMain.handle 注册（经 registry.handle 信封）
│   │   ├── registry.ts        # handle() 包 {__ok} 信封
│   │   ├── index.ts           # registerAllIpc
│   │   └── {library,reading,search,ai,notes,settings,learning}.ts
│   ├── ai/                    # DeepSeek 客户端、prompt、缓存、红线
│   │   ├── deepseek.ts / prompts.ts / cache.ts / guard.ts / errors.ts / types.ts
│   ├── lib/                   # error（AppError）、keystore（safeStorage）
│   └── models/                # （预留；当前 DTO 内联在各 service）
├── src/                       # React 渲染进程（ESM via Vite）
│   ├── main.tsx / App.tsx     # 应用 shell（导航：首页/书库/设置 + 快速检索）
│   ├── global.d.ts            # window.api 类型
│   ├── modules/
│   │   ├── library/           # LibraryView（书库 + BookDetail 三栏详情）
│   │   ├── search/            # SearchPanel / ResultList
│   │   ├── settings/          # SettingsView / ProviderEditorModal
│   │   ├── learning/          # Dashboard（阅读足迹）
│   │   ├── ai/                # DegradedNotice
│   │   ├── reading/ notes/ import/  # （仅 types.ts 或空；功能已收敛进 library/settings）
│   ├── stores/                # Zustand：session / ui / ai / search
│   ├── lib/                   # ipc.ts（invokeRaw）+ *-api.ts 类型化封装 + types.ts
│   └── styles/                # theme.css / main.css
├── electron.vite.config.ts / tsconfig{,.node,.web}.json / eslint.config.mjs / vitest.config.ts
└── package.json               # 无 "type":module（主进程 CJS）
```

> **分层原则**：`ipc/` 是薄入口（经 `registry.handle()` 信封 + 调 service），业务逻辑在 `services/`，数据在 `db/schema.ts`。渲染进程通过 `src/lib/*-api.ts`（封装 `invokeRaw('module:action')`）调用，**不直接 `ipcRenderer`**，也不直接访问 `window.api.invoke`（统一走 `invokeRaw` 拆信封抛 `IpcError`）。

> **注**：`electron/db/migrations/` 目录存在但为空（迁移机制已改为 reset 式，见 §5）。`electron/services/` 下保留的 `epub.ts`/`import.ts`/`paragraph.ts` 等为内容生产工具链，不在应用运行路径内。

## 4. Electron IPC 约定（当前实现）

- **安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`。preload 经 `contextBridge.exposeInMainWorld('api', {invoke, on})` **仅暴露两个方法**（不再按模块细分）。
- **channel 命名**：`<module>:<action>`。当前实际 channel（共 12 个）：`library:{list,tree}`、`reading:getChapter`、`search:fulltext`、`ai:{status,generateModern}`、`notes:{create,delete,getByParagraph}`、`settings:{listProviders,saveProvider,setActiveProvider}`、`learning:getDashboard`。
- **信封模式（关键）**：所有 `ipcMain.handle` 经 `electron/ipc/registry.ts` 的 `handle(channel, fn)` 包装，返回 `{__ok:true,data} | {__ok:false,error:SerializedError}`，规避 Electron 版本间错误序列化差异。
- **渲染端调用**：`src/lib/ipc.ts` 的 `invokeRaw<T>('module:action', ...args)` 拆信封，失败抛 `IpcError`（带 `.code`）。各模块在 `src/lib/*-api.ts` 里用 `invokeRaw` 包成类型化方法。长任务进度经 `on(channel, cb)` 订阅（返回取消订阅函数）。
- **DB 并发**：`better-sqlite3` 同步执行，主进程单例；写操作用 `db.transaction()`。

### IPC 暴露（实际）

```ts
// electron/preload/index.ts —— 仅暴露 {invoke, on}
const api = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => {
    const listener = (_e, payload) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },
}
contextBridge.exposeInMainWorld('api', api)
```

```ts
// electron/ipc/registry.ts —— handle() 包信封
export function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try { return { __ok: true, data: await fn(event, ...args) } }
    catch (err) { return { __ok: false, error: serializeError(err) } }
  })
}
```

```ts
// src/lib/ipc.ts —— 渲染端拆信封 + 模块化封装
export async function invokeRaw<T>(channel, ...args): Promise<T> {
  const result = await window.api.invoke(channel, ...args)
  if (!result.__ok) throw new IpcError(result.error)
  return result.data
}
export const libraryApi = {
  list: () => invokeRaw<BookListItem[]>('library:list'),
  tree: (bookId) => invokeRaw<ChapterNode[]>('library:tree', bookId),
}
// ...其余 *-api.ts 同构
```

## 5. 数据模型规范（当前实现）

> 权威定义：`electron/db/schema.ts` 的单一 `CURRENT_SCHEMA`（`CURRENT_SCHEMA_VERSION = 2`）。本节为现状摘要。

**公共约定**：
- 主键 `id` 用 `TEXT`（应用层生成），稳定。**注意当前实现用 `id` 而非 `book_id`/`chapter_id`/`paragraph_id` 作为主键列名**（早期文档的 `*_id` 命名已不适用）。
- 时间戳 `INTEGER`（unix ms）。
- 软删除：`deleted_at INTEGER NULL`（books/chapters/paragraphs 有）。

**schema 机制（重要变更）**：当前**不是** forward-only 迁移，而是单一 `CURRENT_SCHEMA` + `prepareDatabase()` 检测 `user_version`，版本不符即 `resetDbFiles()` 删库重建。`electron/db/migrations/` 目录为空。**此机制仅适用开发期；生产打包前必须改为版本化迁移（PROGRESS S8.1 阻塞项），否则用户升级会丢数据。**

**全局硬约束（跨模块必须一致）**：

1. **`PRAGMA foreign_keys = ON`**：每次连接立即执行（`connection.ts`）。SQLite 默认 OFF，不显式开启则所有 `ON DELETE CASCADE` / `SET NULL` 静默失效。
2. **`paragraphs` 表双键**：同时具备 `id TEXT PRIMARY KEY`（稳定）与隐式 `rowid INTEGER`（FTS5 `content_rowid` 使用）。`fts_paragraphs` 以 `content='paragraphs', content_rowid='rowid'` 指向段落表。DDL 不得破坏任一键。
3. **级联删除**：子表外键声明 `ON DELETE CASCADE`（或按语义 `SET NULL`，如 notes 绑段删除降级为自由笔记）。
4. **FTS5 同步唯一职责**：`fts_paragraphs` 由 `paragraphs_ai/ad/au` 触发器同步（软删/噪声过滤），批量场景用 `rebuildFts()`。别处只读，不写。
5. **稳定 ID 不可变**：任何 schema 重构不得 DROP/重生成 `paragraphs.id` / `chapters.id` / `books.id`。

**现存表清单**（`electron/db/schema.ts`）：

| 表 | 归属 | 说明 |
|---|---|---|
| `books` | LIB | 书籍元信息（内置经典，字段 id/title/author/cover/category/updated_at/deleted_at） |
| `chapters` | LIB | 章节层级（id/book_id/parent_id 自引用/order_index/level/title/content_hash/created_at/deleted_at） |
| `paragraphs` | LIB | 段落正文（id/chapter_id/order_index/text/edited/parse_hash/is_noise/quality_flag/created_at/deleted_at；隐式 rowid 供 FTS） |
| `fts_paragraphs` | SRH/IMP | FTS5 虚拟表（content='paragraphs', trigram, ai/ad/au 触发器） |
| `reading_progress` | RD | 段级阅读进度（book_id 唯一；chapter_id/paragraph_id/scroll_ratio/read_seconds/percent/updated_at） |
| `notes` | NOTE | 段绑定 Markdown 笔记（id/content/book_id/chapter_id/paragraph_id SET NULL/created_at/updated_at/deleted_at） |
| `ai_cache` | AI | AI 解读缓存（scope/scope_id/kind/paragraph_id/prompt_hash/response/model/tokens/invalidated；paragraph_id CASCADE） |
| `paragraph_analyses` | AI | 段落解读版本化（paragraph_id/kind/version/is_active 唯一索引/modern/explanation/analysis/summary/model/prompt_hash/cache_id/source） |
| `settings` | SET | KV 设置（key/value/updated_at） |
| `api_credentials` | SET | AI 凭证（provider/label/base_url/model/api_key_enc safeStorage 加密/is_active） |

> **已删除的表**（重构中移除，文档别处若提及均为历史）：`bookmarks`、`cards`、`review_log`、`quiz_questions`、`quiz_results`、`dictionary_terms`、`term_occurrences`、`tags`、`tag_refs`、`notebooks`、`note_links`、`entities`、`relations`。

## 6. 状态管理约定

- 每个模块一个 Zustand store（`src/stores/<module>.ts`），存 UI 状态与缓存数据。
- **持久化数据一律走 SQLite**，store 仅缓存当前会话所需；不做 store 持久化（避免双数据源）。
- 跨模块共享状态（如当前打开的书/章/段）放 `stores/session.ts`。

## 7. 错误处理与日志

- 主进程：自定义 `AppError` 类（`code` + `message` + 可选 `details`），code 取 `DB` / `PARSE` / `IO` / `AI` / `VALIDATION` / `NOT_FOUND` / `CONFLICT` / `UNKNOWN`（见 `electron/lib/error.ts`）。日志当前用 `console`（未引入 electron-log/pino）。
- **跨 IPC 错误**：经 `registry.handle()` 的 `{__ok:false,error:SerializedError}` 信封；渲染端 `invokeRaw` 拆信封抛 `IpcError`（带 `.code`）。
- AI 失败必须降级（AI-02）：不阻断阅读，仅提示（`DegradedNotice`）。

## 8. UI / 主题约定

- 主题 token 经 CSS 变量（`src/styles/theme.css`），三主题 paper/ink/dark 经 `data-theme` 切换；颜色 `--ink #5C4033`、`--paper #EDE4D5`、`--accent #A67C5D`。
- 排版：原文衬线行高 1.7；白话/医理无衬线。
- 样式为**原生 CSS**（按模块拆 `*.css`），未用 Tailwind/shadcn。
- 所有可交互元素支持键盘操作。

## 9. 测试约定

- 主进程：`services/` 与 `ai/`、`db/` 单元测试（Vitest，含 FTS、AI prompt、paragraph-analysis、library buildChapterTree、错误序列化等）。
- 渲染进程：`src/modules/search/snippet.test.ts` 等纯函数测试。
- 集成：`electron/main/integration-check.ts`（`ZYXX_INTEGRATION=1` 启动时跑，覆盖 seed → list → tree → search → chapter → ai 现有面）。
- 质量门：`npm run check` = typecheck（node+web）+ eslint + vitest。

## 10. 更新策略

- **前端热更新（不重启）**：Electron 中前端资源本就是外部文件（`loadURL` / `loadFile`），天然支持热更——下载新版 bundle → 替换 → `win.reload()`；进程不退出，用户数据保留。
- **主进程/整包更新**：`electron-updater`（electron-builder 配套）差量更新（Phase 8 规划）；涉及主进程逻辑、原生模块、Electron 版本时触发，需重启。
- **DB 迁移（重要）**：当前为**单一 `schema.ts` + 版本不符删库重建**（仅开发期，`prepareDatabase` 调 `resetDbFiles`）。**生产前必须改为 forward-only 版本化迁移**，否则已发布版本升级会丢用户数据（PROGRESS S8.1 阻塞项）。任何迁移不得破坏稳定 ID（`paragraphs.id` / `chapters.id` / `books.id`）。

---

## 附录 A：模块技术文档统一模板

各模块文档（`01–08`）请遵循以下结构：

```
# <模块名> 技术设计文档（<编号>-<slug>）

## 1. 概述
职责、边界、与其它模块的关系。

## 2. 相关需求
引用 PRD 功能编号（如 IMP-01、RD-03）与验收标准。

## 3. 目录与文件结构
本模块在 electron/ 与 src/ 下的代码组织（services/ipc/components/stores）。

## 4. 数据模型
本模块涉及的表 DDL（含字段、类型、索引、触发器）。

## 5. IPC 接口
channel 清单：命名、入参、返回、错误、是否长任务（webContents.send 进度）。

## 6. 前端设计
组件树、store 结构、关键交互与状态流转。

## 7. 核心流程
关键流程时序/步骤（用文字或简易序列图）。

## 8. 错误处理与边界
失败场景、降级策略、边界条件。

## 9. 依赖关系
依赖/被依赖的其它模块、共享类型。

## 10. 测试策略
单元/集成测试点、夹具。

## 11. 开放问题
待决策的技术点。
```

## 附录 B：模块清单与文档映射

> ⚠️ 下表 8 份模块文档描述的是**原始愿景设计（v2.x）**，与 v3.0 收敛重构后的代码有较大出入（导入/卡片/测验/双链/词典/备份等已移除）。各文档顶部已加状态标注；**阅读时以本文件 §3/§4/§5、`PROGRESS.md` 与代码为准**。文档保留作设计意图存档。

| 编号 | 模块 | 文档 | PRD 前缀 | 当前状态 |
|---|---|---|---|---|
| 01 | 导入与解析 | `01-import-parse.md` | IMP | **已移出应用运行路径**（工具链保留产 `data/*.json`） |
| 02 | 书库管理 | `02-library.md` | LIB | 部分实现（list/tree + 详情页；元信息编辑/删除 UI 已删） |
| 03 | 阅读 | `03-reading.md` | RD | 大幅收敛（三栏工作台/同步滚动/书签/快捷键等已删，并入 LibraryView.BookDetail） |
| 04 | 学习闭环 | `04-learning.md` | LRN | **记忆卡/SM-2/测验全删**；改为阅读足迹仪表盘 |
| 05 | 检索与知识图谱 | `05-search.md` | SRH | 仅 FTS5 检索保留；术语词典/知识图谱/向量已删 |
| 06 | 笔记 | `06-notes.md` | NOTE | 大幅收敛（双链/标签/笔记本/导出全删；仅段绑定 CRUD） |
| 07 | AI 工具 | `07-ai.md` | AI | 仅段级解读 + 缓存 + 降级保留；RAG/卡片/配图/TTS 已删 |
| 08 | 设置与数据 | `08-settings-data.md` | SET | 仅凭证 provider CRUD + 外观；备份/文件管理已删 |
