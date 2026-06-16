# 架构总览与公共约定（00-Architecture）

> 本文件是各模块技术设计文档的**共同地基**。所有模块文档（01–08）必须遵循此处的项目结构、IPC 约定、数据模型规范与文档模板。需求依据见 `docs/PRD.md`。

---

## 1. 项目背景（摘要）

- **产品**：中医经典本地学习软件（PC 桌面）。
- **核心约束**：只做 PC；本地优先（无账号/无云同步/无服务端）；联网仅 AI API（默认 DeepSeek）；内容零内置，用户导入 EPUB；首期仅 EPUB。
- **完整需求**：见 `docs/PRD.md`。

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | **Electron** | 主进程 Node.js + Chromium 渲染；生态成熟、打包顺、踩坑少 |
| 主进程 | **Node.js + TypeScript** | 业务逻辑、DB、解析、HTTP 均在主进程 |
| 前端（渲染） | **React 18 + TypeScript + Vite** | HMR 开发体验好 |
| IPC | **contextBridge + ipcMain.handle / ipcRenderer.invoke** | contextIsolation 开启，preload 暴露类型化 API |
| 状态管理 | **Zustand** | 轻量，按模块拆 store |
| 样式 | **Tailwind CSS + shadcn/ui** | 基础组件复用，古风主题通过 token 覆盖 |
| 路由/导航 | 状态机式（Zustand store 驱动） | 桌面多窗场景，非传统 URL 路由 |
| 数据库 | **SQLite（better-sqlite3）+ FTS5** | 主进程同步驱动，高性能；通过 IPC 暴露，渲染进程不裸写 SQL |
| EPUB 解析 | **`node-stream-zip` + `fast-xml-parser`**（或等价 `epub2`） | 主进程解包 + 解析 OPF/NCX/spine |
| HTTP/AI | **`undici` / 全局 fetch** | 调用 DeepSeek / 其他厂商 |
| 向量检索（可选） | **`sqlite-vec`** | 千段落级，Phase 2 按需 |
| Key 安全存储 | **Electron `safeStorage`**（或 `keytar`） | API Key 原生加密 |
| 构建/打包 | **electron-builder** | Win（nsis）/ macOS（dmg），差量更新 |
| 更新 | 前端资源热更（reload）+ `electron-updater` | 见 §10 |

> **选型理由**：相比 Tauri，Electron 生态成熟、better-sqlite3 与 EPUB 解析库即取即用、JS 全栈团队上手快；代价是包体较大（~100MB+）、内存较高，对本学习类应用可接受。

## 3. 项目目录结构

```
zhongyixuexi/
├── docs/                      # 产品/技术文档
│   ├── PRD.md
│   └── dev/
│       ├── 00-architecture.md # 本文件
│       ├── 01-import-parse.md
│       ├── 02-library.md
│       ├── 03-reading.md
│       ├── 04-learning.md
│       ├── 05-search.md
│       ├── 06-notes.md
│       ├── 07-ai.md
│       └── 08-settings-data.md
├── electron/                  # Electron 主进程（Node + TS）
│   ├── main/                  # 主进程入口、窗口管理、生命周期
│   │   ├── index.ts
│   │   └── window.ts
│   ├── preload/               # preload 脚本（contextBridge 暴露受限 API）
│   │   └── index.ts
│   ├── db/                    # better-sqlite3 连接、迁移、schema
│   ├── services/              # 业务逻辑（按模块）
│   │   ├── import.ts          # EPUB 解析
│   │   ├── library.ts
│   │   ├── reading.ts
│   │   ├── learning.ts
│   │   ├── search.ts
│   │   ├── notes.ts
│   │   ├── ai.ts
│   │   └── settings.ts
│   ├── ipc/                   # ipcMain.handle 注册（薄层，调 services）
│   ├── ai/                    # DeepSeek 客户端、prompt 模板
│   ├── models/                # 类型 / DTO
│   └── lib/                   # error、日志、工具
├── src/                       # React 渲染进程
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/            # 通用 UI
│   ├── modules/               # 按模块组织
│   │   ├── import/
│   │   ├── library/
│   │   ├── reading/
│   │   ├── learning/
│   │   ├── search/
│   │   ├── notes/
│   │   ├── ai/
│   │   └── settings/
│   ├── stores/                # Zustand stores（按模块）
│   ├── lib/
│   │   ├── ipc.ts             # 调 preload 暴露的 api（类型化）
│   │   └── types.ts           # 与主进程共享的类型
│   └── styles/                # Tailwind / 主题 token
├── electron-builder.yml
└── package.json
```

> **分层原则**：`ipc/` 是薄入口（参数校验 + 调 service + 序列化），业务逻辑在 `services/`，数据在 `db/`。渲染进程通过 `lib/ipc.ts`（封装 preload 暴露的 `window.api`）调用，不直接 `ipcRenderer`。

## 4. Electron IPC 约定

- **安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox` 按需；仅通过 preload 的 `contextBridge.exposeInMainWorld('api', {...})` 暴露白名单方法。
- **channel 命名**：`<module>:<action>`，kebab/camel 皆可，统一即可。例：`import:epub`、`reading:getProgress`、`ai:generateModern`。
- **异步调用**：主进程 `ipcMain.handle(channel, handler)`，渲染进程经 preload 暴露后 `await window.api.import.epub(path)`（内部 `ipcRenderer.invoke`）。
- **参数与返回**：参数为普通可序列化对象（或传文件路径让主进程读盘，避免大对象过 IPC）；返回 DTO，禁止返回 db 句柄/函数。
- **错误**：handler 抛出结构化 `AppError`（`{ code, message, details? }`），经 IPC 序列化后渲染进程 `try/catch` 拿到。
- **长任务进度**：解析大书、AI 生成等耗时操作，主进程用 `event.sender.send('import:progress', payload)` 或 `webContents.send` 推送进度，渲染进程监听。
- **DB 并发**：`better-sqlite3` 同步执行，放主进程单例；写操作用 `db.transaction()` 保证原子性；避免在渲染进程持有连接。

### IPC 暴露示例

```ts
// electron/preload/index.ts
contextBridge.exposeInMainWorld('api', {
  import: {
    epub: (path: string) => ipcRenderer.invoke('import:epub', path),
    onProgress: (cb) => {
      const h = (_e: unknown, p: ImportProgress) => cb(p);
      ipcRenderer.on('import:progress', h);
      return () => ipcRenderer.off('import:progress', h);
    },
  },
  // ...其它模块
});
```

```ts
// electron/ipc/import.ts
ipcMain.handle('import:epub', async (_e, path: string) => {
  return importService.parseEpub(path); // 抛 AppError 由调用方捕获
});
```

## 5. 数据模型规范（全库 schema 概览）

> 各模块文档细化各自表的字段、索引、触发器。此处给出全貌与公共约定。

**公共约定**：
- 所有主键 `id` 用 `TEXT`（UUID v4，应用层生成），保证跨设备/迁移稳定。
- 时间戳 `INTEGER`（unix ms）。
- 软删除：`deleted_at INTEGER NULL`（可选，按模块定）。
- 段落/章节的稳定 ID 用于段级编辑后保留笔记/卡片/AI 解读引用。

**全局硬约束（跨模块必须一致，以本节为唯一事实来源）**：

1. **`PRAGMA foreign_keys = ON`**：每次建立 SQLite 连接必须立即执行，否则所有 `ON DELETE CASCADE` / `SET NULL` 静默失效。在 `db/` 连接初始化处统一设置。
2. **`paragraphs` 表双键**：同时具备 `id TEXT PRIMARY KEY`（应用层稳定 ID，UUID v4）与隐式 `rowid INTEGER`（FTS5 `content_rowid` 使用）。FTS5 外部内容表 `fts_paragraphs` 以 `content='paragraphs', content_rowid='rowid'` 指向段落表。各模块 DDL 不得破坏这两个键。
3. **级联删除归属**：所有引用 `paragraph_id` / `chapter_id` / `book_id` 的子表（notes、note_links、cards、review_log、quiz_results、bookmarks、reading_progress、ai_cache、tag_refs 等）必须声明对应外键 `ON DELETE CASCADE`（或按语义 `SET NULL`，如笔记绑段删除时降级为自由笔记）。删书/删章/删段的事务由 IMP/LIB 模块发起，其余模块仅靠外键级联被动清理，不自行写删除逻辑。
4. **FTS5 同步唯一职责**：`fts_paragraphs` 的同步**以 IMP 模块为准**（应用层事务内显式写 + AFTER INSERT/UPDATE/DELETE 触发器兜底的双轨策略），SRH 模块仅负责检索读取，不得重复写入或重建（批量 rebuild 除外）。避免双写导致重复索引。
5. **稳定 ID 不可变**：任何 schema 迁移不得 DROP/重生成 `paragraphs.id` / `chapters.id`；段级编辑与重新解析只新增/软删，不改写既有 ID（IMP-07 靠 `parse_hash` 映射保留）。

**核心表清单**（详细 DDL 见各模块文档）：

| 表 | 归属模块 | 说明 |
|---|---|---|
| `books` | LIB / IMP | 书籍元信息 + 来源文件 |
| `chapters` | IMP | 章节层级容器（稳定 ID） |
| `paragraphs` | IMP | 段落正文（稳定 ID + parse_hash，段级编辑单元） |
| `bookmarks` | RD | 书签 |
| `reading_progress` | RD | 阅读进度（段级） |
| `notes` | NOTE | Markdown 笔记（可绑段） |
| `note_links` | NOTE | 双链解析结果 |
| `tags` / `tag_refs` | NOTE / SRH | 标签 |
| `cards` / `review_log` | LRN | 记忆卡 + SM-2 调度记录 |
| `quiz_questions` / `quiz_results` | LRN | 测验题库 + 作答 |
| `dictionary_terms` | SRH | 术语词典 |
| `entities` / `relations` | SRH (P2) | 知识图谱 |
| `ai_cache` | AI | AI 生成内容缓存（绑 paragraph_id） |
| `settings` | SET | 应用设置（含加密 API Key 引用） |
| `fts_paragraphs` | SRH / IMP | FTS5 虚拟表（段落全文索引） |

## 6. 状态管理约定

- 每个模块一个 Zustand store（`src/stores/<module>.ts`），存 UI 状态与缓存数据。
- **持久化数据一律走 SQLite**，store 仅缓存当前会话所需；不做 store 持久化（避免双数据源）。
- 跨模块共享状态（如当前打开的书/章/段）放 `stores/session.ts`。

## 7. 错误处理与日志

- 主进程：自定义 `AppError` 类（`code` + `message` + 可选 `details`），按类别（`Db` / `Parse` / `Io` / `Ai` / `Validation`）；日志用 `electron-log` 或 `pino`。
- 渲染进程：`lib/ipc.ts` 统一捕获 `AppError`，按 code 映射用户可读提示（i18n key）。
- AI 失败必须降级（AI-07）：不阻断阅读/学习，仅提示。

## 8. UI / 主题约定（依据 PRD §10）

- 颜色 token：`--ink #5C4033`、`--paper #EDE4D5`、`--accent #A67C5D`；支持深色模式。
- 排版：原文衬线 18–22px，白话无衬线 16–20px，行高 1.6–1.8。
- 所有可交互元素支持键盘操作（RD-09）。

## 9. 测试约定

- 主进程：`services/` 单元测试（Vitest，含解析、SM-2 调度、SQL）；`ipc/` 用 mock 集成测试。
- 渲染进程：组件用 Vitest + Testing Library；关键 hook/store 测试。
- 解析质量：准备 EPUB 测试夹具（含正常/异常/多层级案例），回归解析成功率。

## 10. 更新策略

- **前端热更新（不重启）**：Electron 中前端资源本就是外部文件（`loadURL` / `loadFile`），天然支持热更——下载新版前端 bundle → 替换 → `win.reload()`；进程不退出，用户数据保留。覆盖绝大多数 UI 迭代。
- **主进程/整包更新**：`electron-updater`（electron-builder 配套）差量更新，低频；涉及主进程逻辑、原生模块、Electron 版本时触发，需重启。
- **DB 迁移**：schema 变更走版本化迁移脚本（`electron/db/migrations/`），不可破坏已有稳定 ID。

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

| 编号 | 模块 | 文档 | PRD 前缀 |
|---|---|---|---|
| 01 | 导入与解析 | `01-import-parse.md` | IMP |
| 02 | 书库管理 | `02-library.md` | LIB |
| 03 | 阅读 | `03-reading.md` | RD |
| 04 | 学习闭环 | `04-learning.md` | LRN |
| 05 | 检索与知识图谱 | `05-search.md` | SRH |
| 06 | 笔记 | `06-notes.md` | NOTE |
| 07 | AI 工具 | `07-ai.md` | AI |
| 08 | 设置与数据 | `08-settings-data.md` | SET |
