# 详情页改造 · 技术设计文档（v3.1）

| 项目 | 内容 |
|---|---|
| 文档名称 | 书籍详情页改造 技术设计 |
| 版本 | v3.1 |
| 日期 | 2026-06-22 |
| 配套 PRD | `docs/prd/20260622-detail-revamp.md` |
| 代码基准 | main @ `1a9daab`（schema v3，forward-only migration 已就位） |

> 本文档面向实现，给出 schema 迁移、服务层、IPC、状态、组件、选区锚定、AI 改造、切片计划与回归点。
> 遵循 `AGENTS.md` 与 `docs/dev/00-architecture.md` 的全部硬约束（FK ON、稳定 ID、FTS 由 IMP 模块独占、forward-only 迁移等）。

---

## 1. 现状速览（基线）

### 1.1 进程与目录

- Electron 主进程 CJS（`electron/**`），渲染 React ESM（`src/**`）。
- `electron/db/schema.ts` 持有 `CURRENT_SCHEMA`（v3）；`electron/db/migrate.ts` 已实现 forward-only 迁移（`runMigrations` + `user_version`）。
- IPC：`electron/ipc/*.ts` 注册 channel，`handle('module:action', fn)`；渲染端 `src/lib/ipc.ts` 拆 `{__ok}` 信封。
- 渲染：`src/views/LibraryView/` + `src/components/page/library/`；状态在 `src/models/library/store.ts`（Zustand，仅会话缓存）。

### 1.2 现详情页三栏

```
BookDetailView
├── ChapterList      (左, flat)
├── ParagraphList    (中, 段列表)
└── InspectorPanel   (右, 当前段的解读/医理/白话)
```

### 1.3 现有相关表（v3 schema 摘要）

```sql
books(id PK, title, author, cover, category, order_index, updated_at, deleted_at)
chapters(id PK, book_id FK CASCADE, parent_id FK chapters CASCADE,
         order_index, level, title, content_hash, created_at, deleted_at)
paragraphs(id PK TEXT, chapter_id FK CASCADE, order_index, text, edited,
           parse_hash, is_noise, quality_flag, created_at, deleted_at)
fts_paragraphs(FTS5 content=paragraphs trigram + ai/ad/au triggers)
reading_progress(book_id PK, chapter_id, paragraph_id, scroll_ratio,
                 read_seconds, percent, updated_at)
notes(id PK, content, book_id, chapter_id, paragraph_id, created_at,
      updated_at, deleted_at)  -- FKs SET NULL
ai_cache(id PK, scope CHECK='paragraph', scope_id, kind CHECK='modern',
         paragraph_id, prompt_hash, response, model, tokens, ...)
paragraph_analyses(id PK, paragraph_id FK CASCADE, kind='modern', version,
                   is_active, modern, explanation, analysis, summary,
                   model, prompt_hash, cache_id FK SET NULL, source, ...)
api_credentials / settings
```

### 1.4 关键约束（必须遵守）

1. `PRAGMA foreign_keys = ON`（已在 `db/connection` 设置）。
2. `paragraphs` 的稳定 TEXT PK + 隐式 rowid（FTS `content_rowid`）**不可动**。
3. 子表 `ON DELETE CASCADE` / `SET NULL` 规则按数据语义选定。
4. `fts_paragraphs` 同步只由 IMP 模块写（本设计新增**章正文编辑** → 需同步章节级 FTS，详见 §6.4）。
5. 迁移 forward-only，**不 DROP 稳定 ID**，不重建既有表。

---

## 2. 改造全景（一图）

```
                ┌──────────────── 渲染进程 ────────────────┐
   LibraryView  │  BookDetailView                          │
   (分类分组)   │   ├── ChapterTree        (左, 多级树)    │
                │   ├── ReadingPane        (中, 章正文+选区)│
                │   └── AnalysisRail       (右, 竖排 6 Tab) │
                │         ├── ChatTab     (对话, 流式)     │
                │         ├── InterpTabs  (解读/医理/白话) │
                │         ├── NotesTab                     │
                │         └── ExcerptsTab                  │
                └───────────────┬──────────────────────────┘
                                │ IPC ({__ok} 信封 + on 流)
                ┌───────────────▼──────────────────────────┐
                │ 主进程 services/                         │
                │   library / reading / editing / notes    │
                │   + chapter-analysis (新)                │
                │   + excerpts        (新)                 │
                │   + ai-chat         (新)                 │
                │ 主进程 ai/                                │
                │   prompts.ts (+chapter/chat 模板)        │
                │   deepseek.ts (+stream)                  │
                └───────────────┬──────────────────────────┘
                                │ better-sqlite3 (schema v4)
                                │ fetch (AI, 用户 Key)
```

---

## 3. 数据模型与迁移（schema v3 → v4）

### 3.1 迁移文件

新增 `electron/db/migrations/0004_detail_revamp.ts`，在 `migrate.ts` 的 `MIGRATIONS` 数组追加 `{ version: 4, run: m0004 }`，`CURRENT_SCHEMA_VERSION = 4`。

> 命名沿用 forward-only 风格：序号 + 主题。**所有 SQL 用 `IF NOT EXISTS` / 幂等 ALTER**，避免重复执行出错。

### 3.2 迁移 DDL（要点）

```sql
-- 1) books.category 规范化（数据级 backfill）
UPDATE books SET category = 'classic'
 WHERE category IS NULL OR category = ''
  AND title IN ('黄帝内经·素问','黄帝内经·灵枢','黄帝八十一难经');
UPDATE books SET category = 'modern'
 WHERE (category IS NULL OR category = '')
  AND title NOT IN ('黄帝内经·素问','黄帝内经·灵枢','黄帝八十一难经');

-- 2) chapters.content（整章正文）
ALTER TABLE chapters ADD COLUMN content TEXT;
-- 回填：把每章 paragraphs 按 order_index 用 \n\n 拼接
-- (在事务里用 JS 拼接后 UPDATE，避免 SQLite 字符串聚合的复杂度)

-- 3) chapter_analyses（章级解读，对齐 paragraph_analyses 结构）
CREATE TABLE IF NOT EXISTS chapter_analyses (
  id           TEXT PRIMARY KEY,
  chapter_id   TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'modern',
  version      INTEGER NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  modern       TEXT,
  explanation  TEXT,
  analysis     TEXT,
  summary      TEXT,
  model        TEXT,
  prompt_hash  TEXT,
  cache_id     TEXT,
  source       TEXT NOT NULL DEFAULT 'ai',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  meta         TEXT,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (cache_id)   REFERENCES ai_cache(id) ON DELETE SET NULL
);
CREATE INDEX idx_chapter_analyses_chapter
  ON chapter_analyses(chapter_id, kind, created_at DESC);
CREATE UNIQUE INDEX uq_chapter_analyses_active
  ON chapter_analyses(chapter_id, kind) WHERE is_active = 1;

-- 4) excerpts
CREATE TABLE IF NOT EXISTS excerpts (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL,
  chapter_id    TEXT NOT NULL,
  start_offset  INTEGER NOT NULL,
  end_offset    INTEGER NOT NULL,
  excerpt_text  TEXT NOT NULL,
  note          TEXT,
  stale         INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
CREATE INDEX idx_excerpts_chapter ON excerpts(chapter_id, start_offset);
CREATE INDEX idx_excerpts_book    ON excerpts(book_id, created_at DESC);

-- 5) notes 增列（选区锚定，可空兼容旧数据）
ALTER TABLE notes ADD COLUMN start_offset INTEGER;
ALTER TABLE notes ADD COLUMN end_offset   INTEGER;
ALTER TABLE notes ADD COLUMN quote_text   TEXT;
ALTER TABLE notes ADD COLUMN stale        INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_notes_chapter_range
  ON notes(chapter_id, start_offset);

-- 6) ai_threads / ai_messages
CREATE TABLE IF NOT EXISTS ai_threads (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL,
  chapter_id  TEXT NOT NULL,
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (book_id)    REFERENCES books(id)    ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_ai_threads_chapter ON ai_threads(chapter_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content       TEXT NOT NULL,
  quote_text    TEXT,
  quote_start   INTEGER,
  quote_end     INTEGER,
  model         TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE
);
CREATE INDEX idx_ai_messages_thread ON ai_messages(thread_id, created_at);

-- 7) ai_cache.scope 放宽（CHECK 约束无法直接改，用重建表迁移）
--    00-architecture §5：ai_cache 由 AI 模块独占，允许我们迁移。
--    方案：新建 ai_cache_new（scope CHECK IN ('paragraph','chapter','chat')）
--    → INSERT SELECT → DROP 旧 → RENAME。在事务内一次完成。
--    （kind 同步放宽到 ('modern','chapter','chat')）

-- 8) reading_progress 语义调整（仍按 book_id 唯一）
--    不改表结构；chapter_id/paragraph_id 中 paragraph_id 允许为当前章第一段或 NULL
--    → 迁移：把 paragraph_id 改为可空（若非空），并放宽 FK 为 ON DELETE SET NULL。
--    若改造代价大，保留 paragraph_id 必填，用「章首段」作为占位（最小改动）。
```

> **paragraph_id 处理选择**：为最小改动与 FK 完整性，**保留 `paragraph_id NOT NULL`**，章级阅读时用「该章 order_index 最小的活段落 id」作为占位写入；`scroll_ratio` 表示**章正文**滚动比。这避免动 FK 与 PK 语义。

### 3.3 `chapters.content` 回填脚本（迁移内）

```ts
function backfillChapterContent(db: Database) {
  const chapters = db.prepare(
    `SELECT id FROM chapters WHERE deleted_at IS NULL AND (content IS NULL OR content = '')`
  ).all() as { id: string }[]
  const sel = db.prepare(
    `SELECT text FROM paragraphs
      WHERE chapter_id = ? AND deleted_at IS NULL
      ORDER BY order_index, created_at`
  )
  const upd = db.prepare(`UPDATE chapters SET content = ? WHERE id = ?`)
  for (const c of chapters) {
    const paras = sel.all(c.id) as { text: string }[]
    const content = paras.map(p => p.text).join('\n\n')
    upd.run(content, c.id)
  }
}
```

### 3.4 风险点

- **`ai_cache` 重建**：必须事务内 `INSERT ... SELECT` 全量搬运；体积评估（开发期 < 10MB，OK）。
- **`chapters.content` 体积**：单章通常 < 5KB；Long TEXT OK。
- **回填原子性**：整个迁移在 `db.transaction(() => { ... })()` 内，失败回滚不写 `user_version`。

---

## 4. 选区与重新锚定（核心机制）

### 4.1 坐标定义

- 坐标空间：`chapters.content` 的 UTF-16 code unit 序列（与 JS `String` 一致，`slice(start, end)` 直接取串）。
- 存证：`excerpt_text` / `quote_text` 与 offsets 同写，作为：① 展示 fallback；② 编辑后比对的「指纹」。

### 4.2 渲染层选区（DOM → 文本 offset）

- 阅读区用一个受控 `<TextBlock>` 组件渲染 `chapter.content`，**文本节点结构与 content 一一对应**（不做分段、不插中间节点）。
- 用 `Selection` API 取 `anchorNode` / `focusNode` + `anchorOffset` / `focusOffset`，再通过**树遍历累计**换算成 `content` 内的 `[start, end)`。
- 提供工具函数 `getOffsetsFromSelection(rootEl, selection): {start, end, text} | null`（单测覆盖）。

### 4.3 高亮已有摘录 / 笔记引用

- 把当前章所有 `(start, end)` 区间合并、按 offset 排序，渲染时切分为「普通段 / 命中段」。
- 用 React 把 `content` 切成 segments 渲染，命中段加 `<mark class="excerpt">` / `<mark class="note">`。

### 4.4 重新锚定（正文编辑后）

实现位置：`electron/services/editing.ts` 新增 `saveChapterContent(chapterId, text)`，事务内：

1. 取 `old = chapters.content`。
2. 写入 `new = text`、`content_hash = sha256Hex16(normalize(new))`。
3. 取本章所有 `excerpts` + `notes`(有 offset)。
4. 对每条 `(start, end, excerpt_text)`：
   - **精确重匹配**：在 `new` 里搜索 `excerpt_text`，若唯一命中 → 更新 offset，`stale=0`。
   - **模糊重匹配**：用 `diff` 算 `old→new` 字符映射（Myers，建议 `fast-diff` 或自实现简化 LCS），把 `(start, end)` 映射到 `new`；映射区间内文本 == `excerpt_text`（或相似度 > 0.8）→ 更新。
   - **失配**：`stale=1`，保留 `excerpt_text` 作为快照。
5. FTS 同步：见 §6.4。
6. 返回更新后的章节，前端刷新 + 把 stale 摘录 / 笔记在 UI 上提示。

> **库选择**：`fast-diff`（小、纯 JS、MIT），加到 `package.json`。也可手写 LCS，但建议直接用库以降风险。

### 4.5 单测

- `excerpt-anchor.test.ts`：覆盖「无变化 / 纯插入 / 纯删除 / 替换 / 多次编辑 / 失配」六种场景。

---

## 5. IPC 通道设计（新增 / 改动）

> 命名遵循 `module:action`。所有 channel 在 `electron/ipc/*.ts` 注册，渲染端在 `src/models/*/api.ts` 加 typed wrapper。

### 5.1 新增 channel 一览

| Channel | Payload | Return | 模块 |
|---|---|---|---|
| `books:setCategory` | `{id, category}` | `{id, category}` | editing |
| `chapters:tree` | `{bookId}` | `ChapterNode[]`（含多级 children + analyzed） | library |
| `chapters:createChild` | `{parentId?, bookId, title}` | `ChapterContent` | editing |
| `chapters:saveContent` | `{id, text}` | `ChapterDTO` + 触发重新锚定 | editing |
| `chapters:getContent` | `{bookId, id}` | `ChapterContent`（章正文 + active analysis + meta） | reading |
| `chapters:analyze` | `{chapterId, force?}` | `ChapterAnalysisDTO` | ai |
| `chapters:analysisHistory` | `{chapterId}` | `ChapterAnalysisHistoryItem[]` | ai |
| `excerpts:create` | `{bookId, chapterId, start, end, text, note?}` | `ExcerptDTO` | excerpts(新) |
| `excerpts:listByChapter` | `{chapterId}` | `ExcerptDTO[]` | excerpts |
| `excerpts:listByBook` | `{bookId}` | `ExcerptDTO[]` | excerpts |
| `excerpts:delete` | `{id}` | `{ok:true}` | excerpts |
| `notes:listByChapter` | `{chapterId, scope:'chapter'|'book'}` | `NoteDTO[]` | notes（扩展） |
| `notes:createWithQuote` | `{bookId, chapterId, start?, end?, quote?, content}` | `NoteDTO` | notes |
| `ai:threadForChapter` | `{bookId, chapterId}` | `AiThreadDTO`（无则建） | ai-chat(新) |
| `ai:sendChat` | `{threadId, content, quote?}` | `{messageId}`（流式经 `ai:chat:token`） | ai-chat |
| `ai:chatHistory` | `{threadId}` | `AiMessageDTO[]` | ai-chat |
| `ai:resetThread` | `{threadId}` | `{ok:true}` | ai-chat |

### 5.2 流式 token

- 主进程 `deepseek.streamChat()`（新增，封装 `fetch` SSE 解析）→ 通过 `webContents.send('ai:chat:token', {threadId, delta, done})`。
- 渲染端 `window.api.on('ai:chat:token', cb)` 订阅；按 `threadId` 过滤。
- 主进程同时把完整 assistant 文本写入 `ai_messages`（done 后一次性写，便于 tokens 统计与重开恢复）。

### 5.3 既有 channel 的调整

- `library:tree` → 改为返回**多级树**（已具备 `parent_id`，仅需 service 改递归拼装）。
- `library:list` → 返回项加 `category`（已存在列，DTO 已有；UI 用）。
- `paragraphs:*`、`chapters:updateTitle/create/delete` → **保留**（用于旧路径与历史段管理；新阅读路径不再调用段落级）。

---

## 6. 服务层设计

### 6.1 `services/library.ts` — 多级树

```ts
export function getChapterTree(bookId: string): ChapterNode[] {
  const rows = db.prepare(
    `SELECT c.id, c.parent_id, c.order_index, c.level, c.title,
            EXISTS(SELECT 1 FROM chapter_analyses ca
                    WHERE ca.chapter_id = c.id AND ca.is_active = 1) AS analyzed
       FROM chapters c
      WHERE c.book_id = ? AND c.deleted_at IS NULL
      ORDER BY c.order_index`
  ).all(bookId)
  return buildTree(rows) // O(n) parent map → children
}
```

- `buildTree`：用 `Map<parentId, rows>`，根 = `parent_id IS NULL`。
- 返回结构对齐既有 `ChapterNode`（已有 `children`）。

### 6.2 `services/reading.ts` — 章级正文

```ts
export function getChapter(bookId, chapterId): ChapterContent | null {
  // chapters.content + active chapter_analyses（LEFT JOIN）+ meta
  // 不再读 paragraphs（阅读路径）
}
```

- `ChapterContent` DTO：`{ chapter, content, analysis }`（替代 v3.0 的 `{chapter, paragraphs[]}`）。
- `analysis: { modern?, explanation, analysis, summary, meta } | null`。

### 6.3 `services/editing.ts` — 章正文 + 重新锚定

```ts
export function saveChapterContent(chapterId, text): ChapterContent {
  return db.transaction(() => {
    // 1) load old
    // 2) UPDATE chapters SET content=?, content_hash=?, updated_at (新增列或复用 created_at?)
    //    → 若 chapters 无 updated_at，迁移里 ALTER TABLE chapters ADD COLUMN updated_at
    // 3) reanchor excerpts + notes（§4.4）
    // 4) FTS sync（§6.4）
    // 5) return getChapter(bookId, chapterId)
  })()
}

export function setBookCategory(bookId, category): {...}
export function createChildChapter(bookId, parentId, title): ChapterContent {...}
```

> **`chapters.updated_at`**：现表无此列；迁移里一并 `ALTER TABLE chapters ADD COLUMN updated_at INTEGER`，回填 = `created_at`。

### 6.4 FTS 同步（章正文）

- 决策：**新增 `fts_chapters`（FTS5 content=chapters trigram）**，由 editing service 在 `saveChapterContent` 时维护；`paragraphs` 与 `fts_paragraphs` 保留不动（历史段检索仍可用，直到下线）。
- 检索 service（SRH）增加「按章检索」路径，命中按章定位（chapter_id + offset 片段）。
- 迁移里建表 + 触发器 + 回填（与 `fts_paragraphs` 同构）。
- 注意 `00-architecture §5`：FTS 同步只能由 IMP 模块写 → 把章级 FTS 视为 IMP 模块的扩展（在 editing service 内调，仍是主进程单一入口）。

```sql
CREATE VIRTUAL TABLE fts_chapters USING fts5(
  content, content='chapters', content_rowid='rowid', tokenize='trigram'
);
-- triggers: chapters_ai / chapters_ad / chapters_au（对齐 paragraphs 的写法，仅当 deleted_at IS NULL）
```

### 6.5 `services/chapter-analysis.ts`（新，镜像 paragraph-analysis）

- `writeActiveChapterAnalysis` / `ensureActiveChapterAnalysis` / `getActiveChapterAnalysisView` / `listHistory` / `activateVersion`。
- 复用 `ai_cache`（`scope='chapter'`）。
- 与 `paragraph-analysis.ts` 结构对齐，便于后续抽象。

### 6.6 `services/excerpts.ts`（新）

- `create / listByChapter / listByBook / delete / reanchor`（reanchor 由 editing 调，不直接暴露 IPC）。

### 6.7 `services/notes.ts`（扩展）

- 在现有 `create / delete / getByParagraph` 之上加：
  - `listByChapter(chapterId)`：含段笔记（`paragraph_id IN chapter`）+ 章级笔记（`chapter_id = ?`），按 `start_offset` 排序，段笔记 offset 视为 null。
  - `createWithQuote(payload)`：带选区落库。
- 删除降级语义不变（章节删 → chapter_id SET NULL）。

### 6.8 `services/ai-chat.ts`（新）

- `getOrCreateThreadForChapter(bookId, chapterId)`：`uq_ai_threads_chapter` 保证一章一会话。
- `sendChat(threadId, content, quote?)`：
  1. 取 thread + chapter；读最近 N=8 条 `ai_messages`。
  2. 构 prompt（`buildChatPrompt`）：system = `RED_LINE_PROMPT` + 「以下来自本章正文」+ chapter.content 摘要 / 全文（按 token 预算）；messages = 历史 + 本次 user（含 quote）。
  3. `deepseek.streamChat()` → 边流边 `webContents.send('ai:chat:token')`；累计 assistant 文本。
  4. 写 `ai_messages`（user + assistant，含 quote / tokens）。
- `resetThread(threadId)`：`DELETE FROM ai_messages WHERE thread_id=?`（FK CASCADE 由 db 保证；或直接删 thread 再建）。

### 6.9 `ai/prompts.ts` 扩展

- `buildChapterPrompt({title, content, category})`：返回 `{messages, temperature, response_format: json_object}`；`category='modern'` 时 prompt 中**不再要求 modern 字段**，JSON 模板去掉 modern。
- `buildChatPrompt({chapter, history, user, quote?})`：返回 messages，无 `response_format`（流式纯文本）。
- 单测：snapshot + 红线出现校验（对齐现 `prompts.test.ts`）。

### 6.10 `ai/deepseek.ts` 扩展

- 新增 `streamChat(req, cfg): AsyncIterable<Delta>` 或 callback 风格（取决于 IPC `on` 推送模型）。
- 解析 OpenAI 兼容的 `data: {..}` SSE；遇 `data: [DONE]` 终止。
- 复用现有 `chat()` 的鉴权 / 错误归一（`aiError`）。

---

## 7. 渲染层设计

### 7.1 目录新增

```
src/
├── components/page/library/
│   ├── ChapterTree.tsx        (替代 ChapterList)
│   ├── ReadingPane.tsx        (替代 ParagraphList)
│   ├── AnalysisRail.tsx       (替代 InspectorPanel)
│   ├── rail/
│   │   ├── ChatTab.tsx
│   │   ├── InterpTab.tsx      (解读/医理/白话 共用，kind prop)
│   │   ├── NotesTab.tsx
│   │   └── ExcerptsTab.tsx
│   ├── SelectionToolbar.tsx   (悬浮三按钮)
│   └── TextBlock.tsx          (受控正文 + 高亮 + offset 工具)
├── models/library/
│   ├── store.ts               (扩展：章正文/选区/tab/对话/excerpts/notes-by-chapter)
│   ├── api.ts                 (扩展 typed wrappers)
│   └── types.ts               (新增 DTO)
└── models/ai/
    └── chat.ts                (对话流式 IPC 订阅封装)
```

### 7.2 `BookDetailView` 改造

```tsx
<div className="bookdetail">
  <header>...书名/分类徽标/计数...</header>
  <div className="bookdetail__workspace">
    <ChapterTree bookId={book.id} />
    <ReadingPane  bookId={book.id} />
    <AnalysisRail bookId={book.id} />
  </div>
  <SelectionToolbar />           {/* 受 ReadingPane 选区驱动 */}
  <NoteEditorModal ... />
  <ConfirmModal ... />
</div>
```

### 7.3 `ReadingPane` 关键点

- 读 `chapter.content`，用 `<TextBlock>` 渲染；竖排或横排由 CSS 控制（古籍可竖排，现代横排）。
- `onSelectionWithinPane` → 计算偏移 → 上抛 `{start, end, text, rect}` 给 `SelectionToolbar`。
- 右上：「AI 分析」按钮（调 `chapters:analyze`）+「编辑」按钮（切 textarea）。
- 编辑态：禁用选区工具条；保存调 `chapters:saveContent`；返回后刷新正文 + 高亮。
- 高亮：合并本章 excerpts + notes 的 ranges，传给 `<TextBlock ranges={...}>`。

### 7.4 `AnalysisRail` 关键点

- 右侧竖排 Tab：`writing-mode: vertical-rl`；active 加左色条。
- Tab 列表：`['chat','analysis','explanation','modern','notes','excerpts']`，其中 `'modern'` 当 `book.category==='modern'` 时过滤掉。
- 默认 `activeTab='chat'`。
- 切章（`selectedChapterId` 变）→ 全部 Tab 数据 refetch。
- 笔记 / 摘录 / 对话 Tab 头徽标显示数量。

### 7.5 `ChatTab` 流式

- 进入 Tab：`ai:threadForChapter` → 拿 threadId → `ai:chatHistory` 渲染历史。
- 输入框 → 发送调 `ai:sendChat`；同时 `window.api.on('ai:chat:token', ...)` 增量 append 到「最后一条 assistant 气泡」。
- `threadId` 不匹配的事件忽略（多书 / 多 tab 安全）。
- 「引用」按钮在工具条 → 切到 chat Tab + 把 quote 预填到输入框（引用块语法 `> ……`）。

### 7.6 `useLibraryStore` 扩展（要点）

新增字段（仅会话缓存）：

```ts
chapterContent: string | null
chapterAnalysis: ChapterAnalysisView | null
activeTab: TabKey
selection: { start, end, text } | null
excerpts: ExcerptDTO[]
notesByChapter: NoteDTO[]
chatThread: AiThreadDTO | null
chatMessages: AiMessageDTO[]
chatStreaming: boolean
editingChapterContent: boolean
```

新增 action：`fetchChapter / analyzeChapter / saveChapterContent / createExcerpt / deleteExcerpt / fetchNotesByChapter / openTab / setSelection / sendChat / resetChat`。

> **持久化仍在 SQLite**：store 只缓存当前打开的书；切书 / 切章重新 fetch。

---

## 8. 兼容与数据完整性

### 8.1 v3.0 → v3.1 兼容矩阵

| 旧能力 | v3.1 处理 |
|---|---|
| 段级 AI（`paragraph_analyses`） | 表与数据保留；UI 不再展示段解读；不再生成新段解读 |
| 段笔记（`notes.paragraph_id`） | 保留；章视图下与章级笔记合并展示；段笔记在「笔记」Tab 显示原文（取该段文本作 quote） |
| 段落合并 / 拆分 / 编辑（`paragraphs:*`） | IPC 与 service 保留；UI 不在主路径暴露（可在「章节管理」二级入口保留） |
| FTS 段检索（`fts_paragraphs`） | 保留；新增 `fts_chapters` 章检索；SRH UI 提供「按段 / 按章」切换（或合并结果） |
| `reading_progress` | 结构不动；语义从「段滚动比」改为「章正文滚动比」；paragraph_id 用章首段占位 |

### 8.2 删除级联一览（确认）

| 删除对象 | 子表行为 |
|---|---|
| `books` | `chapters` CASCADE → `chapter_analyses` CASCADE / `excerpts` CASCADE / `ai_threads` CASCADE；`notes` SET NULL；`reading_progress` 删除 |
| `chapters` | `paragraphs` CASCADE（保留）；`chapter_analyses` CASCADE；`excerpts` CASCADE；`ai_threads` CASCADE；`notes.chapter_id` SET NULL |
| `ai_threads` | `ai_messages` CASCADE |
| `ai_cache` | `chapter_analyses.cache_id` SET NULL（已 FK） |

### 8.3 稳定 ID 不变

- `paragraphs.id`（TEXT UUID）不动；FTS `content_rowid` 不动。
- 新表的 PK 均为 `randomUUID()`。

---

## 9. AI 改造细节

### 9.1 章级分析 prompt（要点）

```
system: RED_LINE_PROMPT + 「你将得到一整章中医古籍 / 现代教材原文，请输出整章级别的解读、医理（、白话）。」
user:
  章节：{title}
  原文：
  """
  {content}
  """
  请严格输出 JSON：
  {
    "version": 1,
    "analysis": "...",      // 整章综合解读
    "explanation": "...",   // 整章医理
    "modern": "...",        // 仅 category='classic' 时要求；modern 书省略此键
    "summary": "..."        // ≤60 字
  }
```

- 温度 0.3，`response_format: json_object`。
- 缓存：`ai_cache {scope:'chapter', scope_id:chapterId, kind:'chapter', prompt_hash}`。

### 9.2 对话 prompt（要点）

```
system: RED_LINE_PROMPT + 「用户正在阅读本章原文，回答须紧扣本章，不得诊疗 / 用药。」
        + 「本章原文（节选）：\n""" + truncate(chapter.content, TOKEN_BUDGET) + """」
messages: history(最近 8 条) + { role:'user', content: (quote? `> ${quote}\n\n`:'') + userText }
```

- 流式纯文本；不做 JSON。
- `TOKEN_BUDGET`：留出输出空间，建议 system+history+content ≤ 6k tokens；超长则按「本章首 + 用户引用附近」截断。

### 9.3 失败 / 降级

- Key 缺失：`aiError('AI_KEY_NOT_CONFIGURED')`；前端在 Tab 内提示「请先配置 Key」。
- 网络失败：错误冒泡到 `chatStreaming=false` + 错误气泡。
- 红线触发：输出端 `guard.ts` 关键词兜底（已有）；对话场景额外对「具体剂量」「处方」等触发替换为免责话术。

---

## 10. 切片计划（对应 PRD §11）

每个切片遵循 loop-engineering：实现 → `npm run check` 绿 → 更新 `docs/dev/PROGRESS.md` → 单切片单 commit。

### Slice D1 — 数据地基（schema v4）

- 新增 `migrations/0004_detail_revamp.ts` + `migrate.ts` 注册 + `CURRENT_SCHEMA_VERSION=4`。
- 回填 `chapters.content` / `books.category` / `notes` 新列默认值。
- 建 `chapter_analyses` / `excerpts` / `ai_threads` / `ai_messages` / `fts_chapters`。
- 重建 `ai_cache`（scope/kind 放宽）。
- 单测：迁移幂等性（跑两遍不报错）+ 回填正确性（用三书 fixture）。

### Slice D2 — 分类 + 章节树（UI）

- service：`library.getChapterTree`（多级）、`editing.setBookCategory`、`editing.createChildChapter`。
- IPC：`library:tree` 升级、`books:setCategory`、`chapters:createChild`。
- UI：`LibraryView` 分类分组；`ChapterTree` 替代 `ChapterList`（含折叠 / 新增子节点 / 重命名 / 删除）。
- 复用既有 `Modal` / `ConfirmModal`。

### Slice D3 — 阅读区 + 选区 + 摘录

- service：`reading.getChapter`（章正文版）、`editing.saveChapterContent`（含重新锚定）、`excerpts.*`。
- FTS：`fts_chapters` 触发器在 `saveChapterContent` 同步。
- UI：`ReadingPane` + `TextBlock` + `SelectionToolbar`；`ExcerptsTab`（本章）。
- 单测：`excerpt-anchor.test.ts`（六场景）。

### Slice D4 — 章级 AI + 析侧栏骨架

- service：`chapter-analysis.*`、`ai.buildChapterPrompt`。
- IPC：`chapters:analyze` / `chapters:analysisHistory`。
- UI：`AnalysisRail` + 竖排 Tab + `InterpTab`（解读 / 医理 / 白话）。
- 现代书隐藏白话 Tab。

### Slice D5 — 对话 + 引用 + 流式

- service：`ai-chat.*`、`ai.buildChatPrompt`、`deepseek.streamChat`。
- IPC：`ai:threadForChapter` / `ai:sendChat` / `ai:chatHistory` / `ai:resetThread` + `ai:chat:token`(on)。
- UI：`ChatTab` 流式渲染 + 工具条「引用」预填。

### Slice D6 — 笔记选区化 + 全书聚合

- service：`notes.listByChapter` / `notes.createWithQuote`。
- UI：`NotesTab`（本章 / 全书切换）+ 摘录 / 笔记高亮联动 + Tab 徽标。

### Slice D7 — 打磨与 NFR

- LIB-T-03（已分析点）/ LIB-T-07（拖拽）/ LIB-T-08（层级约束）。
- EXC-04 / NOTE-05（全书维度）。
- 性能：虚拟滚动（500 节点树）、SSE 背压、`TextBlock` 大章分段渲染。
- `npm run check` 全绿；qa-review 过一遍 diff。

---

## 11. 测试与质量门

### 11.1 单测（Vitest，`**/*.test.ts`）

| 文件 | 覆盖 |
|---|---|
| `migrate.test.ts` | v3→v4 迁移幂等、回填正确、`user_version` 写入 |
| `chapter-analysis.test.ts` | active 唯一、版本化、history |
| `excerpts.test.ts` | CRUD、按章 / 书查询 |
| `excerpt-anchor.test.ts` | 重新锚定六场景 |
| `ai-chat.test.ts` | thread 一章一会话、历史读取、reset |
| `prompts.test.ts` | 章级 / 对话 prompt snapshot + 红线 |
| `library-tree.test.ts` | 多级树构建、analyzed 标记 |
| `notes-chapter.test.ts` | 章级 + 段笔记合并查询 |

### 11.2 质量门

- `npm run check`（typecheck + lint + test）必须绿才能 commit。
- 每个 slice commit 后跑 `qa-review` agent（Critical/Warning/Suggestion）。

---

## 12. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| 迁移把 `ai_cache` 重建失败 | 全程事务 + 开发期可 `resetDbFiles` | 开发期重置 DB；生产前做导出备份（暂未实现，列入风险） |
| 重新锚定误判 | stale 兜底 + 单测六场景 | stale=1 保留快照，不丢数据 |
| 流式 IPC 在慢网下卡顿 | 渲染端 `chatStreaming` 超时（30s）提示重试 | 已写入的 user 消息保留，可重发 |
| 章正文过大（> 8k 字） | 编辑器加载耗时 / prompt 超长 | 按 P2 拆「小节级」分析 |
| 旧段笔记与新章笔记混排混乱 | UI 用图标区分「段笔记 / 章笔记 / 选区笔记」 | — |

---

## 13. 与现有 dev 文档的关系

- 本文是对 `docs/dev/02-library.md`（LIB）、`03-reading.md`（RD）、`06-notes.md`（NOTE）、`07-ai.md`（AI）在**详情页**这一片的**增量重构说明**；未冲突部分仍以原 dev 文档为准。
- `docs/dev/00-architecture.md` §5 硬约束在本设计中**全部保留**：FK ON、稳定 ID、forward-only 迁移、FTS 单一写者。
- `docs/dev/08-settings-data.md`：数据迁移机制（S8.1 已落地的 `migrate.ts`）是本次 v4 迁移的承载体。

---

## 14. 开放问题（实现期需定）

1. `chapters.updated_at` 是否新增列（建议是）。
2. `reading_progress.paragraph_id` 是否改可空（建议否，用章首段占位）。
3. `fts_chapters` 与 `fts_paragraphs` 是否长期共存，还是 v3.2 下线段级 FTS。
4. 对话历史是否做 token 预算的智能截断（建议 P1 跟进）。
5. 竖排 Tab 的 a11y：是否提供「切换为顶部水平 Tab」的设置开关。

---

*文档结束。*
