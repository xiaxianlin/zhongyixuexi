# 笔记模块技术设计文档（06-notes）

> ⚠️ **状态：大幅收敛为"段绑定笔记 CRUD"（v3.0 收敛重构后）**
>
> 本文档描述的 Markdown 分屏编辑器/双链 `[[ ]]`/反向链接/标签/笔记本/笔记全文搜索/导出 MD/HTML/PDF **均未保留**。`note_links`/`tags`/`tag_refs`/`notebooks`/`fts_notes` 表已删除。`refactor(notes): keep paragraph note surface only`。
>
> **当前实际状态**（`electron/services/notes.ts` + `src/modules/library/LibraryView.tsx` 内的笔记抽屉/弹窗）：
> - ✅ 保留：3 个 IPC —— `notes:create`（绑 book/chapter/paragraph + Markdown 文本）、`notes:delete`、`notes:getByParagraph`。
> - ✅ `notes` 表字段：id/content/book_id/chapter_id/paragraph_id（SET NULL 降级）/created_at/updated_at/deleted_at。**无 title/notebook_id/word_count/pinned**。
> - ✅ UI：详情页"添加笔记"弹窗 + 笔记抽屉（三列网格展示该段笔记），均在 `BookDetail` 内。
> - ❌ 已删除：双链解析 `wikiLinks.ts`、`note_links`、backlinks、`tags`/`tag_refs`/`notebooks`、`fts_notes`、导出（`notes:export`/`exportParagraph`，含 printToPDF）、`src/modules/notes/` 仅剩 `types.ts`。
>
> **权威参考**：`docs/PRD.md` v3.0 §3.5、`docs/dev/00-architecture.md` §5。下文为原始愿景设计存档。

## 1. 概述

### 1.1 职责

笔记模块（NOTE）为用户提供围绕「段落」做知识沉淀的能力，是学习闭环中「理解 → 沉淀」环节的载体。核心职责：

- **Markdown 笔记**：所见即所得 / 分屏编辑，支持基础排版、引用块（NOTE-01）。
- **双链引用**：在笔记中以 `[[目标]]` 语法引用章节 / 段落 / 术语 / 其它笔记，并维护反向链接（backlinks）列表（NOTE-02）。
- **笔记组织**：标签（多态）、笔记本分组、笔记全文搜索（NOTE-03）。
- **导出**：单篇 / 多篇导出 MD / HTML / PDF；段落级组合导出（原文 + AI 解读 + 配图）（NOTE-04）。
- **与段落绑定**：笔记可绑定到具体 `paragraph_id`，阅读某段时侧栏自动显示该段关联笔记（NOTE-05）。

### 1.2 边界

- 本模块**只负责笔记的创建 / 编辑 / 组织 / 双链 / 导出**。
- **不负责**：段落正文本身（归 IMP）、AI 解读生成（归 AI，本模块只读 `paragraphs.content_modern` 等字段用于组合导出）、全局全文检索 UI（归 SRH，但 FTS 表由本模块与 SRH 共建）、阅读侧栏的段落宿主渲染（归 RD，本模块仅提供数据）。
- 笔记内容存储为 **Markdown 原文**，渲染由编辑器组件完成；数据库不存渲染后 HTML（避免双数据源不一致）。

### 1.3 与其它模块的关系

| 模块 | 关系 |
|---|---|
| IMP（导入解析） | 笔记通过 `paragraph_id` / `chapter_id` / `book_id` 绑定到 IMP 产出的稳定 ID；段落稳定 ID 保证段级编辑后笔记引用不失效 |
| RD（阅读） | 阅读页侧栏 / 资源栏调用 NOTE 的 `notes:getByParagraph` 渲染关联笔记；笔记内点击双链可跳转到阅读定位（段级） |
| SRH（检索） | 笔记全文搜索复用 FTS5（`fts_notes` 虚拟表）；标签表 `tags` / `tag_refs` 与 SRH 共享（多态标签可挂段落 / 书） |
| AI（AI 工具） | 导出时读取 AI 生成的 `content_modern` / 配图（`assets/`）；AI 问答的 RAG 可纳入笔记内容 |
| SET（设置） | 备份导出包含 `notes` / `note_links` / `tags` / `notebooks`；导出目录偏好读取 settings |

---

## 2. 相关需求

引用 `docs/PRD.md` §3.7：

| 编号 | 功能 | 优先级 | 验收标准 | 本文档章节 |
|---|---|---|---|---|
| NOTE-01 | Markdown 笔记 | P0 | 分屏常驻编辑；基础排版、引用块 | §6 编辑器选型、§7.1 保存流程 |
| NOTE-02 | 双链引用 | P1 | `[[章节/段落/术语]]` 自动链接；反向链接列表 | §4.2 note_links、§7.2 解析算法、§7.3 backlinks 查询 |
| NOTE-03 | 笔记组织 | P1 | 标签、笔记本；笔记全文搜索 | §4.3 tags / §4.4 notebooks / §4.5 fts_notes、§5 IPC |
| NOTE-04 | 导出 | P1 | 导出 MD / HTML / PDF；段落级导出（原文 + 解读 + 配图） | §7.4 导出流程、§7.5 PDF 方案 |
| NOTE-05 | 与段落绑定 | P0 | 笔记可绑定到具体段落，阅读该段时侧栏显示关联笔记 | §4.1 notes.book_id/chapter_id/paragraph_id、§7.6 侧栏查询 |

---

## 3. 目录与文件结构

遵循 `00-architecture.md` §3 分层（ipc 薄层 → services 业务 → db 数据）。

```
electron/
├── db/
│   ├── schema/
│   │   └── notes.sql              # notes / note_links / tags / tag_refs / notebooks / fts_notes DDL + 触发器
│   └── migrations/
│       └── <ts>_notes.ts          # 版本化迁移
├── services/
│   ├── notes.ts                   # CRUD、组织（笔记本/标签）、侧栏查询
│   ├── note-links.ts              # 双链解析 + backlinks 查询（核心）
│   ├── note-search.ts             # fts_notes 全文搜索
│   └── note-export.ts             # MD / HTML / PDF 导出（PDF 调主进程 puppeteer）
├── ipc/
│   └── notes.ts                   # notes:* handle 注册（薄层）
└── models/
    └── note.ts                    # Note / NoteLink / Tag / Notebook DTO + zod schema

src/
├── modules/notes/
│   ├── NoteEditor/                # Markdown 编辑器封装（milkdown）
│   ├── NoteList/                  # 笔记列表（笔记本/标签筛选）
│   ├── NoteSidebar/               # 阅读页段落侧栏（NOTE-05）
│   ├── BacklinkPanel/             # 反向链接面板（NOTE-02）
│   ├── NoteSearch/                # 笔记搜索（NOTE-03）
│   └── NoteExport/                # 导出交互（NOTE-04）
├── stores/
│   └── notes.ts                   # Zustand store：当前笔记、列表缓存、编辑状态
└── lib/
    └── ipc.ts                     # window.api.notes.* 类型化封装
```

---

## 4. 数据模型

遵循 `00-architecture.md` §5 公共约定：主键 `TEXT`（UUID v4）、时间戳 `INTEGER`（unix ms）、软删除 `deleted_at`。

### 4.1 notes（笔记主表）

```sql
-- 笔记主表：存储 Markdown 原文
CREATE TABLE IF NOT EXISTS notes (
  id            TEXT    PRIMARY KEY,                 -- UUID v4
  title         TEXT    NOT NULL DEFAULT '无标题笔记',
  content       TEXT    NOT NULL DEFAULT '',          -- Markdown 原文（唯一存储，不存渲染 HTML）
  book_id       TEXT    NULL,                         -- 绑定书（可空：自由笔记）
  chapter_id    TEXT    NULL,                         -- 绑定章节（可空）
  paragraph_id  TEXT    NULL,                         -- 绑定段落（NOTE-05 侧栏入口，可空）
  notebook_id   TEXT    NULL,                         -- 所属笔记本（可空：未分组）
  word_count    INTEGER NOT NULL DEFAULT 0,           -- 冗余字数，用于列表展示/排序
  pinned        INTEGER NOT NULL DEFAULT 0,           -- 0/1 置顶
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER NULL,                         -- 软删除
  -- 外键（DEFERRED，允许笔记先于书/章存在时弱引用）
  FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE SET NULL,
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE SET NULL,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL,
  FOREIGN KEY (notebook_id)  REFERENCES notebooks(id)  ON DELETE SET NULL
);

-- 阅读侧栏按段查关联笔记（NOTE-05 高频路径）
CREATE INDEX IF NOT EXISTS idx_notes_paragraph ON notes(paragraph_id, deleted_at);
-- 笔记本分组浏览
CREATE INDEX IF NOT EXISTS idx_notes_notebook  ON notes(notebook_id, deleted_at, updated_at);
-- 绑章/绑书场景
CREATE INDEX IF NOT EXISTS idx_notes_chapter   ON notes(chapter_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_book      ON notes(book_id, deleted_at);
-- 更新时间排序（列表）
CREATE INDEX IF NOT EXISTS idx_notes_updated   ON notes(deleted_at, updated_at DESC);
```

> **设计说明**：
> - `content` 只存 Markdown 原文，渲染交给编辑器；避免「原文改了、缓存 HTML 没更新」的双数据源问题。
> - `book_id` / `chapter_id` / `paragraph_id` 三者**非互斥**——绑到段落时自动也归到对应章/书（写入时由 service 层回填章/书 id，便于「某本书所有笔记」类查询）。三者均可空，表示自由笔记。
> - 段落稳定 ID 保证：即便用户在 IMP-03 段级编辑（合并/拆分），只要段 ID 不变，笔记引用不失效；段被删除时 `ON DELETE SET NULL`，笔记降级为自由笔记而不丢失。
> - `word_count` 冗余字段，保存时由 service 层计算，避免列表页 `length(content)` 扫描。

### 4.2 note_links（双链解析结果，NOTE-02 核心）

```sql
-- 双链解析结果：每次保存笔记时全量重算该笔记的出链
CREATE TABLE IF NOT EXISTS note_links (
  id              TEXT    PRIMARY KEY,                -- UUID v4
  source_note_id  TEXT    NOT NULL,                   -- 引用方笔记
  target_type     TEXT    NOT NULL,                   -- 'chapter' | 'paragraph' | 'term' | 'note'
  target_id       TEXT    NOT NULL,                   -- 目标实体 id；term 类型时为 term 规范化 key
  target_alias    TEXT    NULL,                       -- 原始 [[ ]] 内文本（用于悬停提示/失效提示）
  display_text    TEXT    NULL,                       -- [[别名|显示文本]] 的显示文本（管道语法）
  position        INTEGER NOT NULL DEFAULT 0,         -- 在原文中第几个链接（用于高亮定位）
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

-- 反向链接查询核心索引：给定 target，查谁引用了它
CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_type, target_id);
-- 正向：查某笔记的所有出链
CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
-- 唯一约束：同一笔记对同一目标不重复（position 用于多处引用定位）
CREATE UNIQUE INDEX IF NOT EXISTS uq_note_links ON note_links(source_note_id, target_type, target_id);
```

> **设计说明**：
> - `target_type` 枚举 `chapter` / `paragraph` / `term`（术语，对应 SRH 的 `dictionary_terms`）/ `note`（笔记互链）。
> - 解析策略：**保存笔记时全量删除该 `source_note_id` 的旧链接，重新扫描 `content` 写入**（见 §7.2）。双链是 Markdown 的派生数据，原文是唯一真源；不做增量 diff（笔记体量小，全量重算成本可忽略，且避免增量算法的边界 bug）。
> - `target_alias` 保留用户原始输入（如 `[[人参]]`），用于目标被删除时显示「失效链接」并提供修复入口。
> - `display_text` 支持 `[[paragraph:uuid|这段讲人参]]` 管道语法——竖线后为显示文本，竖线前为引用目标（可选带 `type:` 前缀）。
> - **不存 target 的快照字段**（如目标标题），避免目标改名后反查失效；标题在查询时 JOIN 取实时值。

### 4.3 tags / tag_refs（多态标签，NOTE-03 + SRH 共享）

```sql
-- 标签字典
CREATE TABLE IF NOT EXISTS tags (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,                -- 标签名（唯一）
  color       TEXT    NULL,                           -- 可选颜色 token
  created_at  INTEGER NOT NULL
);

-- 多态标签引用：可挂笔记 / 段落 / 书（ref_type 区分）
CREATE TABLE IF NOT EXISTS tag_refs (
  id          TEXT    PRIMARY KEY,
  tag_id      TEXT    NOT NULL,
  ref_type    TEXT    NOT NULL,                       -- 'note' | 'paragraph' | 'book'
  ref_id      TEXT    NOT NULL,                       -- 对应实体 id
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  UNIQUE (tag_id, ref_type, ref_id)                   -- 同一标签不重复挂同一目标
);

CREATE INDEX IF NOT EXISTS idx_tag_refs_target ON tag_refs(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_tag_refs_tag    ON tag_refs(tag_id);
```

> **为什么多态**：PRD §3.6 SRH-02 结构化筛选需按标签过滤段落/书；NOTE-03 需按标签组织笔记。共用一张 `tag_refs` + `ref_type`，避免为笔记/段落/书各建一张关联表。

### 4.4 notebooks（笔记本分组，NOTE-03）

```sql
-- 笔记本分组
CREATE TABLE IF NOT EXISTS notebooks (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  parent_id   TEXT    NULL,                           -- 支持嵌套（可空）
  sort_order  INTEGER NOT NULL DEFAULT 0,
  icon        TEXT    NULL,                           -- 可选图标标识
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notebooks_parent ON notebooks(parent_id, sort_order);
```

> 笔记本支持单层嵌套（`parent_id`），避免过深层级；`notes.notebook_id` 为外键，删除笔记本时笔记的 `notebook_id` 置空（`ON DELETE SET NULL`，笔记不随笔记本删除）。

### 4.5 fts_notes（笔记全文搜索虚拟表，NOTE-03）

```sql
-- FTS5 虚拟表：笔记全文搜索（与 SRH 的 fts_paragraphs 独立，避免混表）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
  note_id UNINDEXED,                                  -- 关联 notes.id（不索引，仅外挂）
  title,
  content,                                            -- Markdown 原文
  tokenize = 'unicode61 remove_diacritics 2'          -- 中文需配合自定义分词器或 trigram（见 §11）
);
```

> **FTS 同步策略（触发器）**：在 `notes` 上建触发器，INSERT/UPDATE 时同步写 `fts_notes`，软删除时删除对应行。

```sql
CREATE TRIGGER IF NOT EXISTS trg_notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO fts_notes(note_id, title, content) VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS trg_notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM fts_notes WHERE note_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_notes_au AFTER UPDATE OF title, content ON notes WHEN
  new.deleted_at IS NULL BEGIN
  DELETE FROM fts_notes WHERE note_id = old.id;
  INSERT INTO fts_notes(note_id, title, content) VALUES (new.id, new.title, new.content);
END;
-- 软删除：deleted_at 由 NULL 变非 NULL 时，从 FTS 移除
CREATE TRIGGER IF NOT EXISTS trg_notes_softdel AFTER UPDATE OF deleted_at ON notes WHEN
  new.deleted_at IS NOT NULL AND old.deleted_at IS NULL BEGIN
  DELETE FROM fts_notes WHERE note_id = new.id;
END;
```

> **为何独立 `fts_notes` 而非复用 `fts_paragraphs`**：两类内容检索意图不同（段落是书内容，笔记是用户沉淀），独立表便于分别做权重/排序；且 `fts_paragraphs` 归 SRH 主导，解耦更清晰。

---

## 5. IPC 接口

channel 前缀 `notes:*`，遵循 `00-architecture.md` §4 约定。所有方法经 preload `contextBridge` 暴露为 `window.api.notes.*`，渲染进程通过 `src/lib/ipc.ts` 类型化调用。

### 5.1 笔记 CRUD（NOTE-01 / NOTE-05）

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `notes:create` | `{ title?, content?, book_id?, chapter_id?, paragraph_id?, notebook_id? }` | `Note` | 创建笔记；若 `paragraph_id` 给定，service 层回填 `chapter_id` / `book_id` |
| `notes:get` | `{ id }` | `Note \| null` | 单条 |
| `notes:update` | `{ id, title?, content?, paragraph_id?, notebook_id?, pinned? }` | `Note` | 更新；content 变更触发双链重解析 + FTS 同步（触发器） |
| `notes:delete` | `{ id }` | `{ ok: true }` | 软删除（置 `deleted_at`）；FTS 触发器移除索引 |
| `notes:getByParagraph` | `{ paragraph_id }` | `Note[]` | **NOTE-05 高频**：阅读侧栏按段查关联笔记 |
| `notes:getByChapter` | `{ chapter_id }` | `Note[]` | 章级聚合 |
| `notes:list` | `{ notebook_id?, tag_ids?, book_id?, limit?, offset? }` | `{ items: Note[], total }` | 列表（笔记本/标签/书筛选） |

### 5.2 双链与反向链接（NOTE-02）

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `notes:getOutlinks` | `{ note_id }` | `NoteLink[]` | 笔记的出链（含目标实时标题，JOIN 取） |
| `notes:getBacklinks` | `{ target_type, target_id }` | `Backlink[]` | **反向链接**：谁引用了此目标（章/段/术语/笔记） |
| `notes:resolveLinkTarget` | `{ raw }` | `{ target_type, target_id, title, valid } \| null` | 编辑器输入 `[[ ]]` 时实时解析候选（用于自动补全下拉） |

### 5.3 笔记组织（NOTE-03）

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `notes:search` | `{ query, notebook_id?, limit? }` | `{ items: NoteSearchHit[], total }` | FTS5 全文搜索（标题 + 正文），返回 snippet 高亮 |
| `notes:listTags` | `{ ref_type? }` | `Tag[]` | 标签列表（可按 ref_type 过滤） |
| `notes:setTags` | `{ ref_type, ref_id, tag_ids[] }` | `{ ok }` | 设置某实体的标签（全量覆盖） |
| `notes:listNotebooks` | `{}` | `Notebook[]` | 笔记本树 |
| `notes:createNotebook` | `{ name, parent_id? }` | `Notebook` | 新建笔记本 |
| `notes:renameNotebook` | `{ id, name }` | `Notebook` | 重命名 |
| `notes:deleteNotebook` | `{ id }` | `{ ok }` | 删除笔记本（笔记降级为未分组） |

### 5.4 导出（NOTE-04）

| channel | 入参 | 返回 | 说明 | 长任务 |
|---|---|---|---|---|
| `notes:export` | `{ note_ids: string[], format: 'md'\|'html'\|'pdf', out_dir, bundle?: boolean }` | `{ files: string[] }` | 多篇导出；`bundle` 为 true 时合并为单文件 | 是（PDF） |
| `notes:exportParagraph` | `{ paragraph_id, include: { original, modern, image }, format }` | `{ file }` | **段落级组合导出**：原文 + AI 解读 + 配图 | 是（PDF） |

- 长任务进度：主进程 `event.sender.send('notes:exportProgress', { current, total, file })`，渲染进程 `window.api.notes.onExportProgress(cb)` 监听。

### 5.5 错误约定

所有 handler 抛 `AppError`（`00-architecture.md` §7），本模块常用 code：

| code | 场景 |
|---|---|
| `Validation` | 入参缺失/格式错（如 note_id 为空） |
| `NotFound` | 笔记/笔记本/标签不存在（且未软删除） |
| `Db` | SQLite 写失败（磁盘满、锁） |
| `Io` | 导出写文件失败、PDF 渲染失败 |
| `Export.UnsupportedFormat` | 未知 format |

---

## 6. 前端设计

### 6.1 Markdown 编辑器选型（NOTE-01）

**结论：采用 [Milkdown](https://milkdown.dev/)（基于 ProseMirror，插件化 Markdown WYSIWYG）。**

| 候选 | 类型 | 古风排版适配 | 双链支持 | 结论 |
|---|---|---|---|---|
| **Milkdown** ✅ | WYSIWYG（所见即所得）+ 可切分屏 | ProseMirror schema 可自定义节点（引用块、古文注音 ruby、双链 span） | 自定义 mark/node 实现 `[[ ]]` 内联高亮 + 自动补全 | **选用**：插件化、类型友好、可定制节点渲染古风排版 |
| Lexical（Meta） | WYSIWYG | 可定制 | 需自建 | 备选；生态偏 React 内嵌，Markdown 双向同步需额外工作 |
| CodeMirror 6 | 分屏（源码 + 预览） | 仅靠 CSS 预览，古风注音等需自渲染 | 装饰（Decoration）可实现高亮 | 适合「源码党」，但所见即所得体验弱 |
| react-markdown + textarea | 分屏 | 弱 | 需自建 | 太轻，编辑体验差，不满足 P0 常驻编辑 |

**选型理由**：
1. **所见即所得**符合 PRD「分屏常驻编辑」——阅读页右侧资源栏切为笔记栏时，用户希望直接看到排版结果，而非源码。
2. **插件化 schema**：可注册自定义节点渲染古风元素（如 `ruby` 注音、引用块竖线），与 PRD §10 古墨/米纸主题 token（`--ink #5C4033`）一致。
3. **双链内联**：自定义 ProseMirror `link` mark，输入 `[[` 触发自动补全（调 `notes:resolveLinkTarget`），渲染为可点击 span；失效链接用虚线下划线提示。
4. **分屏模式**：Milkdown 支持切换源码视图（`@milkdown/preset-commonmark` + 源码插件），满足「源码党」偶尔需求。

**集成要点**：
- 编辑器组件 `NoteEditor` 封装 Milkdown，`content` 双向绑定 Zustand `notes` store 的 `draft`。
- 防抖保存：输入停顿 800ms 或失焦时调 `notes:update`（§7.1）。
- 自定义双链 mark：`[[target|alias]]` → `<span class="wikilink" data-type data-id>alias</span>`。

### 6.2 组件树

```
NotesModule（路由入口）
├── NoteListPanel                    # 左：笔记列表（笔记本树 + 标签 + 搜索）
│   ├── NotebookTree                 # 笔记本嵌套树（NOTE-03）
│   ├── TagCloud                     # 标签云
│   └── NoteSearchBox               # 搜索（NOTE-03，FTS）
├── NoteEditorPane                   # 中：编辑器
│   ├── NoteEditor (Milkdown)        # 编辑 + 双链自动补全
│   └── NoteMetaBar                  # 标题、绑段信息、标签、置顶
└── NoteContextPanel                 # 右：上下文
    ├── BacklinkPanel                # 反向链接列表（NOTE-02）
    └── OutlinkPanel                 # 出链列表

# 独立入口（嵌入阅读页 RD）
ReadingNoteSidebar（NOTE-05）
├── 段落关联笔记列表（notes:getByParagraph）
└── 快速新建笔记按钮（预填 paragraph_id）
```

### 6.3 Zustand store（`src/stores/notes.ts`）

```ts
interface NotesStore {
  // 列表
  list: Note[];
  total: number;
  filter: { notebook_id?: string; tag_ids?: string[]; book_id?: string };
  setFilter: (f: Partial<NotesStore['filter']>) => void;
  refreshList: () => Promise<void>;

  // 当前编辑
  currentId: string | null;
  current: Note | null;
  draft: string;                       // 编辑器内容（未保存）
  backlinks: Backlink[];               // 当前笔记的反链
  outlinks: NoteLink[];                // 当前笔记的出链
  openNote: (id: string) => Promise<void>;
  setDraft: (md: string) => void;
  saveDraft: () => Promise<void>;      // 防抖触发

  // 段落侧栏（NOTE-05）
  sidebarParagraphId: string | null;
  sidebarNotes: Note[];
  loadSidebar: (paragraph_id: string) => Promise<void>;
}
```

> store 只缓存当前会话数据，持久化一律走 SQLite（遵循 `00-architecture.md` §6）。

### 6.4 关键交互与状态流转

- **创建笔记（绑段）**：阅读页选中段落 →「加笔记」→ 调 `notes:create({ paragraph_id })` → service 回填 chapter/book → 打开编辑器，`paragraph_id` 显示在 meta bar。
- **双链自动补全**：编辑器输入 `[[` → 弹候选下拉（章节/段落/术语/笔记，模糊匹配）→ 选中插入 `[[type:id|显示文本]]` → 失焦保存时由 service 解析写 `note_links`。
- **反向链接面板**：打开任一笔记 → `notes:getBacklinks({ target_type: 'note', target_id: currentId })` → 列表展示引用方笔记，点击跳转。
- **阅读页点击双链跳转**：双链 span 点击 → 解析 `data-type`/`data-id` → 若是 paragraph，触发阅读模块定位到该段（交 RD）；若是 note，打开该笔记。

---

## 7. 核心流程

### 7.1 笔记保存流程（NOTE-01）

```
渲染进程                    IPC                      主进程 service
─────────────────────────────────────────────────────────────────
NoteEditor 输入
  │
  ├─ 防抖 800ms / 失焦
  ▼
notes:update({id, content, title})
  │─────────────────────────────▶│ notes:update handler
                                 │  ├─ 校验 id 存在
                                 │  ▼
                                 │  noteService.update()
                                 │  ├─ db.transaction:
                                 │  │   1. UPDATE notes SET content=?, title=?, word_count=?, updated_at=?
                                 │  │      → 触发器 trg_notes_au 同步 fts_notes
                                 │  │   2. noteLinksService.reparse(id, content)  ← 见 §7.2
                                 │  └─ 返回 Note
  │◀─────────────────────────────│
  ▼
store.current 更新
```

### 7.2 双链解析算法（NOTE-02 核心）

**输入**：笔记 Markdown 原文 `content`。
**输出**：`NoteLink[]`，全量替换该 `source_note_id` 在 `note_links` 的记录。

**语法支持**：
- `[[target]]`：target 可为章节标题、段落、术语、笔记标题（模糊解析，见 §7.2 步骤 4）。
- `[[type:id]]`：精确引用，`type` ∈ `chapter` / `paragraph` / `term` / `note`。
- `[[target|alias]]`：竖线后为显示文本。

**伪代码**：

```ts
// electron/services/note-links.ts

const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g;   // 匹配 [[ ... ]]，内部不含方括号

interface ParsedLink {
  targetType: 'chapter' | 'paragraph' | 'term' | 'note';
  targetId: string;
  targetAlias: string;    // 原始目标文本
  displayText: string;    // 显示文本（管道后，默认等同 targetAlias）
  position: number;       // 第几个链接
}

/** 保存笔记时全量重算出链。db 事务内调用。 */
function reparseLinks(db: Database, noteId: string, content: string): void {
  const tx = db.transaction(() => {
    // 1. 删除该笔记全部旧链接（全量重算）
    db.prepare('DELETE FROM note_links WHERE source_note_id = ?').run(noteId);

    // 2. 扫描所有 [[ ]]
    const matches = [...content.matchAll(WIKILINK_RE)];
    const seen = new Set<string>();   // 去重（同一目标多处引用只存一行，position 记首次）
    let pos = 0;

    for (const m of matches) {
      const inner = m[1].trim();
      // 3. 拆分管道：[[target|alias]]
      const [rawTarget, alias] = inner.includes('|')
        ? inner.split('|', 2).map(s => s.trim())
        : [inner, inner];
      const displayText = alias || rawTarget;

      // 4. 解析 target → { targetType, targetId, valid }
      const resolved = resolveTarget(db, rawTarget);   // 见下
      if (!resolved) {
        // 目标未命中：仍记录（target_alias 保留原文，target_id 置空标记失效？）
        // 策略：term 类型兜底——把 rawTarget 当作 term key 存，便于术语创建后自动恢复链接
        persistLink(db, noteId, 'term', normalizeTermKey(rawTarget), rawTarget, displayText, pos);
      } else {
        const dedupKey = `${resolved.targetType}:${resolved.targetId}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        persistLink(db, noteId, resolved.targetType, resolved.targetId, rawTarget, displayText, pos);
      }
      pos++;
    }
  });
  tx();
}

/**
 * 解析引用目标。优先级：精确 type:id > 段落 uuid > 章节标题 > 术语 > 笔记标题。
 * 返回 null 表示完全无法解析（极少，因 term 兜底）。
 */
function resolveTarget(db: Database, rawTarget: string): ParsedLink | null {
  // (a) 精确语法：[[paragraph:uuid]] / [[chapter:uuid]] / [[note:uuid]] / [[term:key]]
  const precise = rawTarget.match(/^(chapter|paragraph|term|note):(.+)$/i);
  if (precise) {
    const [, type, id] = precise;
    if (entityExists(db, type, id)) {
      return { targetType: type, targetId: id, targetAlias: rawTarget, displayText: rawTarget, position: 0 };
    }
  }

  // (b) 裸 UUID（无前缀）：尝试当段落/章节 uuid 查
  if (looksLikeUuid(rawTarget)) {
    if (entityExists(db, 'paragraph', rawTarget)) return mk('paragraph', rawTarget);
    if (entityExists(db, 'chapter', rawTarget))   return mk('chapter', rawTarget);
  }

  // (c) 按标题模糊匹配（用户最常见的写法：[[上品·人参]]）
  //     顺序：段落 > 章节 > 笔记（段落最细，优先命中）
  const paraRow = db.prepare(
    `SELECT p.id FROM paragraphs p
     JOIN chapters c ON p.chapter_id = c.id
     WHERE (p.text LIKE ? OR c.title LIKE ?) LIMIT 1`
  ).get(`%${rawTarget}%`, `%${rawTarget}%`);
  if (paraRow) return mk('paragraph', paraRow.id);

  const chapRow = db.prepare(`SELECT id FROM chapters WHERE title LIKE ? LIMIT 1`)
    .get(`%${rawTarget}%`);
  if (chapRow) return mk('chapter', chapRow.id);

  const noteRow = db.prepare(
    `SELECT id FROM notes WHERE title LIKE ? AND deleted_at IS NULL LIMIT 1`
  ).get(`%${rawTarget}%`);
  if (noteRow) return mk('note', noteRow.id);

  // (d) 全部未命中 → 返回 null，由调用方兜底为 term
  return null;
}
```

**关于失效链接**：
- 若 `resolveTarget` 返回 null，兜底存为 `term` 类型、`target_id = normalizeTermKey(rawTarget)`。这样当用户后续在术语词典（SRH-04）创建该术语时，反向链接自动恢复——无需改笔记原文。
- 编辑器渲染时，对 `term` 类型且 `dictionary_terms` 中不存在的，显示虚线下划线 + 悬停「术语尚未定义，点击创建」。

### 7.3 反向链接查询（NOTE-02 backlinks）

**给定一个目标（如某段落），查所有引用它的笔记**。

```sql
-- 反向链接查询：给定 target_type + target_id，返回引用方笔记列表
SELECT
  n.id, n.title, n.updated_at, n.paragraph_id,
  nl.target_alias, nl.display_text, nl.position
FROM note_links nl
JOIN notes n ON n.id = nl.source_note_id
WHERE nl.target_type = :target_type
  AND nl.target_id   = :target_id
  AND n.deleted_at IS NULL          -- 排除已删笔记
ORDER BY n.updated_at DESC;
```

**索引命中**：`idx_note_links_target(target_type, target_id)` → 高效。

**前端展示**（`BacklinkPanel`）：
- 每条 backlink 显示：笔记标题 + 引用上下文片段（原文中 `target_alias` 前后 N 字符）。
- 点击跳转打开该笔记并滚动到 `position` 对应位置。

### 7.4 导出流程（NOTE-04）

#### 单篇 / 多篇导出

```
用户选笔记 + 格式(MD/HTML/PDF) + 输出目录
  │
  ▼
notes:export({ note_ids, format, out_dir, bundle })
  │
  ▼ note-export service
  ├─ MD:    逐篇写 {title}.md（直接 content）；bundle 则拼接，篇间用 --- 分隔 + 标题锚点
  ├─ HTML:  content → markdown-it 渲染 → 套古风主题模板（注入 PRD §10 颜色/字体 CSS）
  └─ PDF:   先渲染 HTML（同上）→ puppeteer 主进程渲染 → page.pdf()
  │
  ▼ 返回 { files: [绝对路径] }
  └─ 进度 webContents.send('notes:exportProgress', { current, total, file })
```

#### 段落级组合导出（NOTE-04 特色）

```ts
// notes:exportParagraph({ paragraph_id, include: { original, modern, image }, format })
function exportParagraph(para, include, format): File {
  const sections: string[] = [];
  // 1. 原文（段正文，IMP 产出）
  if (include.original) sections.push(`## 原文\n\n${para.text}`);
  // 2. AI 白话解读 + 医理点拨（AI 模块产出，存 paragraphs.content_modern / content_explanation）
  if (include.modern)   sections.push(`## 白话解读\n\n${para.content_modern ?? '（未生成）'}\n\n## 医理点拨\n\n${para.content_explanation ?? ''}`);
  // 3. 配图（assets/ 中 AI 配图，AI-03）
  if (include.image) {
    const img = getParagraphImage(para.id);    // local://assets/xxx.png
    if (img) sections.push(`## 配图\n\n![配图](${path.basename(img)})`);
  }
  // 4. 关联笔记（NOTE-05 反向：该段绑定的笔记）
  const linkedNotes = getNotesByParagraph(para.id);
  for (const nt of linkedNotes) sections.push(`## 笔记：${nt.title}\n\n${nt.content}`);

  const md = sections.join('\n\n---\n\n');
  return format === 'md' ? writeMd(md) : renderToHtmlOrPdf(md, format);
}
```

### 7.5 PDF 方案（NOTE-04）

**结论：主进程使用 [puppeteer-core](https://pptr.dev/) + 本机 Chromium（复用 Electron 内置的 Chromium 可执行文件）渲染 PDF。**

- 不额外打包 Chromium：`puppeteer-core` 的 `executablePath` 指向 Electron 自带 Chromium（`app.getPath('exe')` 解析或 `process.env.ELECTRON_PATH`），避免包体翻倍。
- 流程：组装 HTML（古风主题模板 + 渲染后 Markdown）→ `puppeteer.launch({ executablePath })` → `page.setContent(html)` → `page.pdf({ format: 'A4', printBackground: true })` → 写盘。
- **分页控制**：模板内置 `@media print` CSS，篇与篇之间 `page-break-before: always`。
- 备选（若 puppeteer 体积/稳定性问题）：用 Electron 的隐藏 `BrowserWindow` + `webContents.printToPDF()`。`printToPDF` 依赖系统打印栈，分页/字体控制弱于 puppeteer，作为降级方案。

> **降级**：PDF 渲染失败（如 Chromium 不可用）→ 抛 `AppError(Io, 'PDF 渲染失败，已为你导出 HTML')`，并兜底输出 HTML，提示用户浏览器打印。

### 7.6 段落绑定与侧栏查询（NOTE-05）

**写入侧（创建/更新笔记）**：

```ts
// noteService.create / update
// 若给了 paragraph_id，回填 chapter_id / book_id，便于聚合查询
if (input.paragraph_id) {
  const para = db.prepare('SELECT chapter_id FROM paragraphs WHERE id = ?').get(input.paragraph_id);
  if (para) {
    const chap = db.prepare('SELECT book_id FROM chapters WHERE id = ?').get(para.chapter_id);
    note.chapter_id = para.chapter_id;
    note.book_id = chap?.book_id ?? null;
  }
}
```

**读取侧（阅读页侧栏）**：

```sql
-- NOTE-05：阅读某段时侧栏查关联笔记（高频，命中 idx_notes_paragraph）
SELECT id, title, substr(content, 1, 200) AS preview, updated_at, pinned
FROM notes
WHERE paragraph_id = :paragraph_id
  AND deleted_at IS NULL
ORDER BY pinned DESC, updated_at DESC;
```

- 侧栏组件 `ReadingNoteSidebar` 在段落切换时调 `notes:getByParagraph`（debounce 150ms 防抖快速切段）。
- 「快速新建」按钮：预填当前 `paragraph_id` 直接进入编辑器。

---

## 8. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 保存时 DB 写失败（磁盘满/锁） | 抛 `AppError(Db)`；前端提示「保存失败」，保留 `draft` 不丢，自动重试 3 次（指数退避） |
| 双链目标被删除（段落被段级编辑删除） | `notes.paragraph_id` 经 `ON DELETE SET NULL` 降级为自由笔记；`note_links` 中该链接仍存（`target_id` 指向已删段），backlinks 查询 JOIN 时目标标题取不到 → 前端显示「（已删除）」并提供「解除绑定」入口 |
| 双链目标重命名（章节标题改了） | `note_links` 只存 id 不存标题，JOIN 实时取最新标题，自动正确；无需重解析 |
| 双链语法错误（`[[` 未闭合） | 正则不匹配，忽略该处，不阻塞保存；编辑器可选高亮未闭合语法 |
| FTS 触发器与软删除冲突 | 触发器 `trg_notes_softdel` 确保软删除时移除 FTS 行；恢复（`deleted_at` 置 NULL）时由应用层补写 FTS 行 |
| PDF 渲染失败 | 降级输出 HTML + 提示（§7.5） |
| 导出文件名冲突（同名笔记） | service 自动追加 `-2` / `-3` 后缀，不覆盖 |
| 笔记本删除时笔记归属 | `ON DELETE SET NULL`，笔记降级「未分组」，不随笔记本删除 |
| 标签删除 | `tag_refs` `ON DELETE CASCADE` 级联清理引用 |
| 编辑器未保存切走 | store 持有 `draft`，切回时恢复；组件 unmount 前触发一次 `saveDraft` |
| 中文 FTS 分词（见 §11） | FTS5 默认 `unicode61` 对中文按字分词；若需词级检索，迁移到 `trigram` tokenizer（SQLite ≥3.34）或自定义分词器 |

---

## 9. 依赖关系

### 9.1 依赖（本模块使用）

| 模块 / 包 | 用途 |
|---|---|
| `books` / `chapters` / `paragraphs`（IMP） | 笔记绑段/章/书的稳定 ID 来源；导出读取段正文 |
| `dictionary_terms`（SRH） | 双链 term 类型解析与回链恢复 |
| `paragraphs.content_modern` / `content_explanation`（AI 写入） | 段落级组合导出（NOTE-04）读取 AI 解读 |
| `assets/`（AI 写入） | 段落级导出配图 |
| npm: `milkdown` + `@milkdown/*` | 渲染进程编辑器 |
| npm: `markdown-it` | 导出时 MD→HTML 渲染（与编辑器渲染解耦，导出用轻量库） |
| npm: `puppeteer-core` | 主进程 PDF 渲染 |
| npm: `better-sqlite3` | DB（全模块共享） |

### 9.2 被依赖（谁使用本模块）

| 模块 | 用途 |
|---|---|
| RD（阅读） | `notes:getByParagraph` 渲染侧栏（NOTE-05） |
| SRH（检索） | 共享 `tags` / `tag_refs`；`fts_notes` 可纳入全局检索结果聚合 |
| AI（问答 RAG） | 可选把笔记内容纳入 RAG 上下文（增强「基于自己笔记」的问答） |
| SET（备份） | 备份/导出包含 `notes` / `note_links` / `tags` / `tag_refs` / `notebooks` / `fts_notes`（重建） |

### 9.3 共享类型（`electron/models/note.ts`）

```ts
export interface Note {
  id: string;
  title: string;
  content: string;            // Markdown 原文
  book_id: string | null;
  chapter_id: string | null;
  paragraph_id: string | null;
  notebook_id: string | null;
  word_count: number;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export type LinkTargetType = 'chapter' | 'paragraph' | 'term' | 'note';

export interface NoteLink {
  id: string;
  source_note_id: string;
  target_type: LinkTargetType;
  target_id: string;
  target_alias: string;
  display_text: string;
  position: number;
  // JOIN 补充（非表字段）
  target_title?: string;      // 目标实时标题
  target_valid?: boolean;     // 目标是否存在
}

export interface Backlink extends NoteLink {
  note_title: string;         // 引用方笔记标题
  note_updated_at: number;
}

export interface NoteSearchHit {
  note_id: string;
  title: string;
  snippet: string;            // FTS snippet 高亮
  rank: number;
}
```

---

## 10. 测试策略

遵循 `00-architecture.md` §9（Vitest + Testing Library）。

### 10.1 主进程单元测试（`services/`）

| 测试点 | 夹具 / 用例 |
|---|---|
| `note-links.reparseLinks` 双链解析 | 输入含 `[[chapter:uuid]]` / `[[段落标题]]` / `[[target|alias]]` / 未闭合 `[[` / 多次引用同目标的断言：正确写 note_links、去重、position 正确 |
| `resolveTarget` 优先级 | 精确 `type:id` > 裸 uuid > 段落标题模糊 > 章节标题 > 笔记标题 > term 兜底 |
| `getBacklinks` | 建多条笔记引用同一段落，查 backlinks 返回正确集合、排除软删除笔记 |
| 全量重算幂等 | 同一 content 连续 reparse 两次，note_links 结果一致（无重复行） |
| 段落删除后 | `paragraph_id` 置 NULL，笔记不丢；backlinks 显示「已删除」 |
| FTS 触发器 | INSERT/UPDATE/软删除后 `fts_notes` 行数与内容正确 |
| `exportParagraph` 组合 | `include` 各开关组合下输出 MD 片段正确拼接原文/解读/配图/笔记 |

### 10.2 IPC 集成测试（`ipc/`）

- 用 in-memory better-sqlite3 + mock service，验证 handler 参数校验、错误码映射、长任务进度推送（spy `event.sender.send`）。

### 10.3 渲染进程组件测试

- `NoteEditor`：双链自动补全下拉、失效链接虚线提示、防抖保存触发。
- `BacklinkPanel`：列表渲染、空态、跳转回调。
- `ReadingNoteSidebar`：段落切换 debounce 加载、快速新建预填 paragraph_id。

### 10.4 夹具

- 测试 DB：预置 1 本书 + 3 章 + 若干段（含稳定 UUID）、3 篇笔记（含各种双链语法）、若干标签/笔记本。
- EPUB 夹具复用 IMP 模块的测试夹具（若有），保证段落稳定 ID 一致性验证。

---

## 11. 开放问题

1. **中文 FTS 分词**：`unicode61` 对中文按字分词，检索「脾虚」会拆成「脾」「虚」命中，召回尚可但精度不足。是否首期即启用 `trigram` tokenizer（SQLite ≥3.34，better-sqlite3 自带版本需确认）？还是先用 `unicode61` + 按字检索，后续按需切换？倾向：**首期 `unicode61` 起步，P2 视用户反馈再切 `trigram`**（与 SRH 模块的 FTS 策略保持一致）。

2. **双链 `[[ ]]` 与 Markdown 标准链接共存**：Milkdown 的标准 `[text](url)` 链接与自定义 `[[ ]]` mark 是否冲突？需确认 ProseMirror schema 优先级与输入法（中文输入 `[[` 时 IME 状态）。预计通过 input rule 在 `[[` 后触发补全规避，需原型验证。

3. **puppeteer-core 与 Electron Chromium 版本对齐**：puppeteer-core 期望的 Chromium 版本需与 Electron 内置版本兼容，否则 `page.pdf()` 可能异常。是否锁定 puppeteer-core 版本跟随 Electron 升级？或降级用 `BrowserWindow.printToPDF`？倾向：**首期 puppeteer-core + 版本锁定；若稳定性问题降级 printToPDF**。

4. **笔记版本历史**：PRD 未要求，但用户误删/误改笔记内容后无法恢复。是否在 `notes` 旁加 `note_revisions`（存 content 快照，限制保留 N 版）？倾向：**P2 视用户反馈再加**，首期靠软删除兜底。

5. **双链跨书引用**：当前 `[[章节标题]]` 模糊匹配是全库范围（可能跨多本书命中同名章节）。是否需限定「同书优先」或在语法中支持 `[[book:某书>某章]]`？倾向：**首期全库匹配 + 候选下拉标注书名供用户选择**，避免语法膨胀。

6. **笔记内嵌图片**：笔记 Markdown 中插入本地图片（截图/拖入）如何存储？是存 `assets/notes/<id>/` 还是 base64 内联？倾向：**存 `assets/notes/<note_id>/` + 相对引用**，避免 content 膨胀；删除笔记时级联清理图片目录。

---

*文档结束。后续变更请在 `00-architecture.md` 版本表与本文件文首登记。*
