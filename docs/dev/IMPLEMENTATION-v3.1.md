# 详情页改造 v3.1 · 实现计划（Slice-level Plan）

| 项目 | 内容 |
|---|---|
| 文档名称 | 详情页改造 v3.1 实现计划（切片级、可执行） |
| 日期 | 2026-06-23 |
| 上游文档 | `docs/prd/20260622-detail-revamp.md` · `docs/tech/20260622-detail-revamp.md` |
| 代码基准 | `main @ b9328b3`（schema v3，forward-only 迁移已就位） |
| 方法论 | `docs/dev/loop-engineering.md`（一切以 `docs/dev/PROGRESS.md` 为进度事实源） |

> 本文把技术设计转成**可直接执行**的切片任务清单，并把**对技术文档的若干校正**写明（已在通读当前代码时发现）。
> 凡与 `docs/tech/20260622-detail-revamp.md` 冲突之处，**以本文为准**，并回头修订技术文档对应小节。

---

## 0. 对技术文档的校正（实现前必须知晓）

通读 `electron/db/schema.ts` / `services/library.ts` / `services/notes.ts` / `migrate.ts` 后，发现技术文档有几处与现状不符，实现按下列校正执行：

| # | 技术文档原说法 | 实际现状 | 实现动作 |
|---|---|---|---|
| C1 | "D2 把 `library:tree` 升级为多级树" | `getChapterTree()` (`library.ts:117`) **早已**用 `buildChapterTree()` 内存构建多级树并返回 `children`；`library:tree` IPC 也已存在 | D2 **不重建树算法**，仅做：① `analyzed` 子查询扩展为也看 `chapter_analyses`；② 树 UI 组件重写（`ChapterTree.tsx` 替代 `ChapterList.tsx`） |
| C2 | "`chapters` 需要新增 `parent_id`/`level`/`content_hash`" | 这三列**已存在**（schema.ts） | 迁移**只新增** `content` 与 `updated_at` 两列 |
| C3 | "笔记改为可选段绑定" | `notes.createNote` (`notes.ts:37`) **强制** `paragraph_id`（`'笔记必须绑定段落'`） | D6 放宽校验：`paragraph_id` 可空，但需 `chapter_id`；旧 `notes:getByParagraph` 保留 |
| C4 | "`analyzed` 标记来自 `paragraph_analyses`" | 是（`library.ts:122-130`）；v3.1 要让它也看 `chapter_analyses` | D2/D4 改 `getChapterTree` 的 EXISTS 子查询为「段级 OR 章级」 |
| C5 | "`ai_cache.scope` 重建表" | `ai_cache` 现有 `scope CHECK='paragraph'`、`kind CHECK='modern'` | D1 在事务内重建（CREATE→INSERT SELECT→DROP→RENAME），`scope IN ('paragraph','chapter','chat')`，`kind IN ('modern','chapter','chat')` |
| C6 | "`chapters.updated_at` 新增" | chapters 表无此列 | D1 迁移 `ALTER TABLE chapters ADD COLUMN updated_at INTEGER`，回填 `= created_at` |
| C7 | "FRTS 同步只由 IMP 模块写" | 现有 `fts_paragraphs` 触发器在 schema.ts；`rebuildFts()` 存在 | D3 新增 `fts_chapters` 仍在 editing service 内调用，保持「单一写者」语义 |

---

## 1. 总览：7 切片 + 依赖图

```
 D1 数据地基 (schema v4)
   │
   ├──► D2 分类 + 章节树 UI ──────────► (并行)
   │        │
   │        └──► D3 阅读区 + 选区 + 摘录
   │                 │
   │                 └──► D6 笔记选区化
   │
   └──► D4 章级 AI + 析侧栏骨架 ──► D5 对话 + 引用 + 流式
                                          │
                                          └──► D7 打磨 + NFR
```

- **强串行**：D1 必须先过（所有切片依赖 schema v4）。
- **可并行**：D2 与 D4 在 D1 后可并行（一个偏库 / 树 / 阅读 UI，一个偏 AI / 析栏）。
- **每切片**：实现 → `npm run check` 绿 → 改 `PROGRESS.md`（todo→done + 决策）→ 单 commit（conventional commit + slice tag）→ 视情况跑 `qa-review` agent。

---

## 2. Slice D1 · 数据地基（schema v3 → v4）

**目标**：单次 forward-only 迁移把 v3.1 全部数据结构落库，不破坏既有数据。

### 2.1 产出文件

| 文件 | 动作 | 要点 |
|---|---|---|
| `electron/db/migrations/0004_detail_revamp.ts` | 新建 | 导出 `up(db: DB)`，全程 `db.transaction` |
| `electron/db/migrate.ts` | 改 | 在 `MIGRATIONS[]` 追加 `{ version: 4, name: 'detail_revamp', up }` |
| `electron/db/schema.ts` | 改 | `CURRENT_SCHEMA_VERSION` 3→4；`CURRENT_SCHEMA` 加新表/列的 `CREATE TABLE IF NOT EXISTS`（保证全新库与升级库最终态一致） |
| `electron/services/migrate-helpers.ts`（可选） | 新建 | `backfillChapterContent(db)` 等纯函数，便于单测 |

### 2.2 迁移内容（按顺序，事务内）

1. `books.category` backfill：内置三书 `'classic'`，其余 `'modern'`（`UPDATE ... WHERE category IS NULL OR ''`）。
2. `ALTER TABLE chapters ADD COLUMN content TEXT`；`ALTER TABLE chapters ADD COLUMN updated_at INTEGER`；回填 `updated_at = created_at`。
3. `backfillChapterContent`：每章 `paragraphs`（`deleted_at IS NULL`）按 `order_index` 用 `\n\n` 拼接 → `UPDATE chapters SET content=?`。
4. `CREATE TABLE chapter_analyses`（结构对齐 `paragraph_analyses`，`chapter_id` FK CASCADE + `cache_id` FK SET NULL）+ 索引 + `uq_chapter_analyses_active`（`WHERE is_active=1`）。
5. `CREATE TABLE excerpts`（FK book/chapter CASCADE）+ 两个索引。
6. `ALTER TABLE notes ADD COLUMN start_offset/end_offset/quote_text/stale` + `idx_notes_chapter_range`。
7. `CREATE TABLE ai_threads`（FK CASCADE，`uq_ai_threads_chapter`）+ `ai_messages`（FK CASCADE）。
8. **重建 `ai_cache`**：`CREATE TABLE ai_cache_new`（`scope CHECK IN ('paragraph','chapter','chat')`、`kind CHECK IN ('modern','chapter','chat')`）→ `INSERT INTO ai_cache_new SELECT * FROM ai_cache` → `DROP TABLE ai_cache` → `ALTER TABLE ai_cache_new RENAME TO ai_cache` → 重建原索引。
9. `CREATE VIRTUAL TABLE fts_chapters USING fts5(content, content='chapters', content_rowid='rowid', tokenize='trigram')` + ai/ad/au 触发器（仅当 `deleted_at IS NULL`），对齐 `fts_paragraphs` 写法。

### 2.3 验收

- [ ] 迁移在「全新库」与「现有 v3 库」上各跑一遍，结果一致（表 / 列 / 索引 / 触发器齐全）。
- [ ] 迁移**幂等**：连跑两次第二次 no-op（`user_version=4` 后跳过）。
- [ ] `chapters.content` 三本内置经典全部非空，长度 = 该章 paragraphs 拼接长度。
- [ ] `npm run check` 绿；新增 `migrate.test.ts` 覆盖：① 升级后表存在；② backfill 正确（用 `data/*-original.json` fixture）；③ ai_cache 行数不变。

### 2.4 风险

- `ai_cache` 重建：失败必须整事务回滚；开发期可 `resetDbFiles()` 重试。
- backfill 对超大书（灵枢全本）的内存峰值：流式 prepared statement 逐章 UPDATE，避免一次性 `.all()`。

### 2.5 Commit

```
feat(db): schema v4 migration for detail revamp (D1)
```

---

## 3. Slice D2 · 分类 + 章节树 UI

**目标**：书库按分类分组；详情页左栏从扁平 `ChapterList` 切到多级 `ChapterTree`，支持折叠 / 新增子节点 / 重命名 / 删除。

### 3.1 服务 / IPC

| 文件 | 动作 | 内容 |
|---|---|---|
| `electron/services/library.ts` | 改 | `getChapterTree()` 的 `analyzed` EXISTS 子查询扩展为「段级 (`paragraph_analyses`) **OR** 章级 (`chapter_analyses`)」 |
| `electron/services/editing.ts` | 改 / 加 | 新增 `setBookCategory(bookId, category)`；新增 `createChildChapter({bookId, parentId, title})`（注意 `parent_id` FK 自引用、`order_index` 取末尾、`level` 取父+1，软约束 ≤3） |
| `electron/ipc/editing.ts` | 改 | 注册 `handle('books:setCategory', ...)`、`handle('chapters:createChild', ...)` |
| `src/lib/library-api.ts` 等价文件 | 改 | 加 typed wrapper（按现有 `invokeRaw` 风格） |

> **复用**：`buildChapterTree()` 已存在且正确（C1），不动算法。

### 3.2 UI

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/components/page/library/ChapterTree.tsx` | 新建（替代 `ChapterList.tsx`） | 递归渲染 `ChapterNode.children`；折叠/展开本地 state；节点 hover 显示 `+ 子节点 / ✎ / 🗑`；`analyzed` 小红点 |
| `src/views/LibraryView/LibraryView.tsx`（书库页） | 改 | 按 `category` 分组渲染（古籍 / 现代书两组，或顶部 Tab 筛选）；卡片角标显示分类 |
| `src/views/LibraryView/BookDetailView.tsx` | 改 | 头部加分类徽标；左栏组件由 `ChapterList` 换为 `ChapterTree` |
| `src/models/library/store.ts` | 改 | 加 `createChildChapter` / `setCategory` action |

### 3.3 验收（对应 PRD）

- [ ] CAT-01/02/04：分类规范化、书库分组、白话 Tab 显隐（白话 Tab 本切片只做数据层，UI 由 D4 落）。
- [ ] LIB-T-01/02/04/05/06：树渲染、选中切章、新增子节点、重命名、删除二次确认。
- [ ] LIB-T-03：节点「已分析」红点（章级或段级任一命中）。
- [ ] `npm run check` 绿；`library-tree.test.ts` 加用例：含父子三级的 fixture。

### 3.4 Commit

```
feat(library): category groups + multi-level chapter tree UI (D2)
```

---

## 4. Slice D3 · 阅读区 + 文本选区 + 摘录

**目标**：中栏由「段列表」变为「整章阅读区」；光标选区弹悬浮三按钮；摘录沉淀与展示；正文可编辑（含重新锚定）。

### 4.1 服务 / IPC

| 文件 | 动作 | 内容 |
|---|---|---|
| `electron/services/reading.ts` | 改 | 新增 `getChapter(bookId, chapterId)`：返回 `{ chapter, content, analysis }`，`analysis` 来自 `chapter_analyses` active 行（可能 null）；**不再读 paragraphs**（阅读路径） |
| `electron/services/editing.ts` | 加 | `saveChapterContent(chapterId, text)`：事务内 ① 写 `chapters.content/content_hash/updated_at`；② `reanchorExcerptsAndNotes(chapterId, oldText, newText)`；③ 同步 `fts_chapters`（由触发器自动，无需手写） |
| `electron/services/excerpts.ts` | 新建 | `create / listByChapter / listByBook / delete` + `reanchor(chapterId, oldText, newText)`（被 editing 调） |
| `electron/services/excerpt-anchor.ts` | 新建 | `reanchorRange(oldText, newText, start, end, excerptText): {start,end,stale}` 纯函数（可单测） |
| `electron/ipc/reading.ts` | 改 | 注册 `chapters:getContent`；`reading:getChapter` 保留（兼容） |
| `electron/ipc/editing.ts` | 改 | 注册 `chapters:saveContent` |
| `electron/ipc/excerpts.ts` | 新建 | 注册 `excerpts:create / listByChapter / listByBook / delete` |

### 4.2 重新锚定算法（excerpt-anchor.ts）

输入 `(oldText, newText, start, end, excerptText)`，输出 `{start, end, stale}`：

1. **精确**：`newText.indexOf(excerptText)` 唯一命中 → 用该位置更新。
2. **diff 映射**：用 `fast-diff`（新增依赖，MIT）生成 old→new 字符映射；把 `(start,end)` 投影到 new；若投影区间文本 === `excerptText`（或相似度 >0.8）→ 更新。
3. **失配**：`stale=1`，offset 不变（保留 excerptText 快照）。

> 选 `fast-diff` 而非自写 LCS：稳定、纯 JS、~5KB、已被广泛使用。

### 4.3 UI

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/components/page/library/ReadingPane.tsx` | 新建（替代 `ParagraphList.tsx`） | 渲染 `chapter.content`；右上「AI 分析」(本切片占位，D4 接) +「编辑」按钮；编辑态切 `<textarea>` |
| `src/components/page/library/TextBlock.tsx` | 新建 | 受控渲染 content；接受 `ranges: {start,end,kind}[]` 渲染 `<mark>`；导出 `getOffsetsFromSelection(rootEl, selection)` |
| `src/components/page/library/SelectionToolbar.tsx` | 新建 | 悬浮三按钮（摘录 / 写笔记 / 引用）；「引用」在 D5 前 disabled；「写笔记」在 D6 前可仅弹占位 |
| `src/components/page/library/rail/ExcerptsTab.tsx` | 新建 | 本章摘录列表，点击滚动定位；删除按钮 |
| `src/models/library/store.ts` | 改 | 加 `chapterContent / selection / excerpts / editingChapterContent` 字段与 action |

### 4.4 验收（对应 PRD）

- [ ] RD-01/02/03/04/06：章级渲染、切章、选区弹工具条、工具条定位、正文编辑。
- [ ] RD-07 占位（按钮存在，点击暂无 AI 动作 → D4 接）。
- [ ] EXC-01/02/03/06：创建、本章列表、删除、编辑后重新锚定（含 stale）。
- [ ] `excerpt-anchor.test.ts` 六场景：无变化 / 纯插入 / 纯删除 / 替换 / 多次编辑 / 失配。
- [ ] `npm run check` 绿。

### 4.5 Commit

```
feat(reading): chapter reading pane + selection + excerpts (D3)
```

---

## 5. Slice D4 · 章级 AI + 析侧栏骨架

**目标**：右栏改造为竖排 6 Tab；章级 AI 分析（解读 / 医理 / 白话）落库并展示；现代书隐藏白话 Tab。

### 5.1 服务 / IPC

| 文件 | 动作 | 内容 |
|---|---|---|
| `electron/services/chapter-analysis.ts` | 新建 | 镜像 `paragraph-analysis.ts`：`writeActiveChapterAnalysis / ensureActiveChapterAnalysis / getActiveChapterAnalysisView / listHistory / activateVersion`；缓存走 `ai_cache {scope:'chapter', kind:'chapter'}` |
| `electron/ai/prompts.ts` | 改 | `buildChapterPrompt({title, content, category})`：返回 `{messages, temperature:0.3, response_format:'json_object'}`；`category='modern'` 时 JSON 模板**去掉 modern 键** |
| `electron/ai/deepseek.ts` | 改 | `chat()` 已存在；确认能跑 json_object 模式（一般无需改） |
| `electron/ipc/ai.ts` | 改 | 注册 `chapters:analyze / chapters:analysisHistory` |
| `src/lib/ai-api.ts` 等价 | 改 | typed wrapper |

### 5.2 UI

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/components/page/library/AnalysisRail.tsx` | 新建（替代 `InspectorPanel.tsx`） | 右侧竖排 Tab（`writing-mode: vertical-rl`）；active 加左色条；默认 `'chat'`；`book.category==='modern'` 过滤掉 `'modern'` |
| `src/components/page/library/rail/InterpTab.tsx` | 新建 | 接 `kind: 'analysis'|'explanation'|'modern'`，读 `chapterAnalysis[kind]`；空态 + CTA「点右上 AI 分析」 |
| `src/views/LibraryView/BookDetailView.tsx` | 改 | 右栏换 `AnalysisRail`；RD-07 的「AI 分析」按钮接 `chapters:analyze` |
| `src/models/library/store.ts` | 改 | 加 `chapterAnalysis / activeTab / analyzeChapter()`；切章时清空并重取 |

### 5.3 验收（对应 PRD）

- [ ] AI-10/11/12/17/18/19：章级分析、active 唯一、失败降级、解读/医理/白话 Tab、现代书无白话。
- [ ] ANL-01/02/03/04/06：6 Tab 结构、默认对话、竖排、白话显隐、切章刷新。
- [ ] `prompts.test.ts` 加 snapshot：classic / modern 两版章级 prompt；红线文案仍出现。
- [ ] `chapter-analysis.test.ts`：active 唯一、版本化、history。
- [ ] `npm run check` 绿。

### 5.4 Commit

```
feat(ai): chapter-level analysis + vertical tab rail (D4)
```

---

## 6. Slice D5 · 对话 + 引用 + 流式

**目标**：右栏「对话」Tab 一章一会话；选区「引用」预填到输入框；流式增量渲染。

### 6.1 服务 / IPC

| 文件 | 动作 | 内容 |
|---|---|---|
| `electron/services/ai-chat.ts` | 新建 | `getOrCreateThreadForChapter(bookId, chapterId)`（`uq_ai_threads_chapter` 保证唯一）；`sendChat(threadId, content, quote?)`：取最近 8 条消息 + 章 content（token 预算截断）→ `deepseek.streamChat` → `webContents.send('ai:chat:token')` → done 后写 user + assistant 两条 `ai_messages`；`resetThread(threadId)` |
| `electron/ai/deepseek.ts` | 改 | 新增 `streamChat(req, cfg, onDelta)`：`fetch` SSE 解析，遇 `data:[DONE]` 终止；复用 `chat()` 鉴权 / 错误归一 |
| `electron/ai/prompts.ts` | 改 | `buildChatPrompt({chapter, history, user, quote?})`：system = `RED_LINE_PROMPT` + 「本章原文（节选）」+ truncate；messages = history + user（quote 拼成 `> ...`） |
| `electron/ipc/ai.ts` | 改 | 注册 `ai:threadForChapter / ai:sendChat / ai:chatHistory / ai:resetThread`；流式经 `webContents.send('ai:chat:token', {threadId, delta, done})` |
| `electron/preload/index.ts` | 改（如需） | 确认 `on(channel, cb)` 已暴露（已有），无需扩 API |

### 6.2 UI

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/components/page/library/rail/ChatTab.tsx` | 新建 | 进 Tab 拉 thread + history；输入框发送；订阅 `ai:chat:token` 按 `threadId` 过滤增量 append；「清空对话」二次确认 |
| `src/models/ai/chat.ts` | 新建 | 流式订阅封装（`window.api.on('ai:chat:token', ...)`） |
| `src/components/page/library/SelectionToolbar.tsx` | 改 | 「引用」按钮启用：切到 chat Tab + 把 quote 预填输入框（`> …`） |
| `src/models/library/store.ts` | 改 | `chatThread / chatMessages / chatStreaming` + `sendChat / resetChat` |

### 6.3 验收（对应 PRD）

- [ ] AI-13/14/15/16：引用到对话、章 scope 上下文、消息持久化、清空。
- [ ] RD-05：未配 Key 时「引用」置灰 + tooltip。
- [ ] 流式：首 token ≤ 2s（本地测）；超时 30s 提示重试。
- [ ] `ai-chat.test.ts`：一章一会话、history 读取、reset；`prompts.test.ts` 加 chat prompt snapshot。
- [ ] `npm run check` 绿。

### 6.4 Commit

```
feat(ai): chapter-scoped chat with streaming + quote (D5)
```

---

## 7. Slice D6 · 笔记选区化

**目标**：笔记从「段绑定」升级到「章 + 可选选区」；笔记 Tab 本章 / 全书切换。

### 7.1 服务 / IPC

| 文件 | 动作 | 内容 |
|---|---|---|
| `electron/services/notes.ts` | 改 | **放宽** `createNote`：`paragraph_id` 可空，但需 `chapter_id`（C3）；新增 `listByChapter(chapterId, scope)`：合并章级笔记（`chapter_id=?`）+ 段笔记（`paragraph_id IN 本章活段`）；新增 `createWithQuote({bookId, chapterId, start?, end?, quote?, content})` |
| `electron/services/editing.ts` | 改 | `saveChapterContent` 的 reanchor 扩展到 notes（有 offset 的）→ 更新或 `stale=1` |
| `electron/ipc/notes.ts` | 改 | 注册 `notes:listByChapter / notes:createWithQuote`；保留 `notes:getByParagraph` |

### 7.2 UI

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/components/page/library/rail/NotesTab.tsx` | 新建 | 本章 / 全书切换；列表按 `start_offset` 排序；段笔记标图标；展示 quote；编辑 / 删除 |
| `src/components/page/library/SelectionToolbar.tsx` | 改 | 「写笔记」启用：弹 NoteEditor（Markdown textarea），预填 quote 块 |
| `src/components/page/library/NoteEditorModal.tsx` | 新建 / 复用 | 沿用现有 Modal（refactor 已抽出） |
| `src/models/library/store.ts` | 改 | `notesByChapter` + `createNoteWithQuote / fetchNotesByChapter` |

### 7.3 验收（对应 PRD）

- [ ] NOTE-01~08：选区创建、章级创建、Tab 列表、删除降级（chapter_id SET NULL）、全书切换、quote 展示、旧段笔记兼容、重新锚定。
- [ ] ANL-05：Tab 头数量徽标（笔记 / 摘录 / 对话）。
- [ ] `notes-chapter.test.ts`：章级 + 段笔记合并查询、quote 落库。
- [ ] `npm run check` 绿。

### 7.4 Commit

```
feat(notes): chapter + selection-scoped notes (D6)
```

---

## 8. Slice D7 · 打磨 + NFR

**目标**：补 P1/P2 项与性能优化，准备发布。

### 8.1 任务清单

- [ ] LIB-T-07 拖拽改层级 / 顺序（`@dnd-kit/core` 或原生 HTML5 DnD）。
- [ ] LIB-T-08 层级软约束 ≤3，超出 toast 提示。
- [ ] EXC-04 / NOTE-05「全书」维度（D3/D6 已铺数据，这里补 UI）。
- [ ] 性能：`ChapterTree` 虚拟滚动（500 节点 ≤300ms）；`TextBlock` 大章（>8k 字）分段渲染。
- [ ] a11y：竖排 Tab 提供「切换为顶部水平 Tab」设置开关（开放问题 5）。
- [ ] `qa-review` agent 跑全 diff（Critical/Warning/Suggestion）。
- [ ] PROGRESS.md 把 D1–D7 标记 done + 写「变更日志」条目。

### 8.2 Commit

```
perf(detail): tree virtualization + polish (D7)
```

---

## 9. 跨切片共享约定

### 9.1 IPC 信封

- 所有新 channel 走 `handle('module:action', fn)`；渲染端 `invokeRaw('module:action', payload)`；返回 `{__ok:true, data}` / `{__ok:false, error}`（已由 `registry.ts` 包装）。
- 流式：主进程 `webContents.send`，渲染 `window.api.on`；事件名 `ai:chat:token`。

### 9.2 命名

- Channel：`module:action`（如 `chapters:analyze`、`excerpts:create`、`ai:sendChat`）。
- DTO：`XxxDTO`（如 `ChapterContent`、`ExcerptDTO`、`AiMessageDTO`），与既有 `BookListItem` / `ChapterNode` 风格一致。
- 服务函数：动词在前（`getChapter` / `createExcerpt` / `saveChapterContent`）。

### 9.3 硬约束（来自 AGENTS.md / 00-arch §5）

- `PRAGMA foreign_keys=ON`：已由 `connection.ts` 保证；新表 FK 必须带 `ON DELETE CASCADE` / `SET NULL`。
- `paragraphs` 双键（TEXT PK + rowid）不动；`fts_paragraphs` 不动。
- 新 `fts_chapters` 同步：由 schema 触发器 + editing service 单一入口维护，**别处只读**。
- 迁移 forward-only：不 DROP 稳定 ID，不重建 `paragraphs` / `chapters`（只 ALTER ADD）；`ai_cache` 是唯一被重建的表（由 AI 模块独占，允许）。

### 9.4 测试矩阵

| 文件 | 切片 | 覆盖 |
|---|---|---|
| `migrate.test.ts` | D1 | 升级、幂等、backfill |
| `library-tree.test.ts` | D2 | 三级树 + analyzed（段/章级） |
| `excerpt-anchor.test.ts` | D3 | 重新锚定六场景 |
| `excerpts.test.ts` | D3 | CRUD |
| `chapter-analysis.test.ts` | D4 | active 唯一 / 版本化 / history |
| `prompts.test.ts` | D4/D5 | 章 / 对话 prompt snapshot + 红线 |
| `ai-chat.test.ts` | D5 | 一章一会话 / history / reset |
| `notes-chapter.test.ts` | D6 | 章+段合并查询 / quote |

---

## 10. PROGRESS.md 注入（D1 起逐切片更新）

在 `PROGRESS.md` 现有 Phase 8 之后新增一节：

```markdown
## Phase 9 · 详情页改造 v3.1（doing）

Exit:章级阅读 + 选区三连 + 章级 AI + 对话 + 竖排 6 Tab 析栏。

| # | 状态 | 摘要 |
|---|---|---|
| D1 | todo | schema v4 migration（chapters.content / chapter_analyses / excerpts / ai_threads / ai_messages / fts_chapters / ai_cache.scope 重建） |
| D2 | todo | 分类分组 + 多级章节树 UI（复用现有 buildChapterTree） |
| D3 | todo | 章级阅读区 + 文本选区 + 摘录 + 正文编辑（重新锚定） |
| D4 | todo | 章级 AI（解读/医理/白话）+ 析侧栏竖排 6 Tab |
| D5 | todo | 对话 + 引用 + 流式 token |
| D6 | todo | 笔记选区化（章 + 选区） |
| D7 | todo | 打磨 + NFR（虚拟滚动 / a11y / qa-review） |
```

每个切片完成时把对应 `todo → done` 并补「决策/阻塞」列。

---

## 11. 开放问题（实现期决策，对应 PRD/技术文档 §13/§14）

1. **`fast-diff` 依赖**：建议直接加（小、稳）；若坚持零依赖，D3 改手写 LCS（多 1 天）。
2. **章级 prompt 的 modern 字段**：现代书完全省略 vs 返回空串——选**省略**（DTO `modern?: string | null`）。
3. **对话历史 token 预算**：D5 先用固定 8 轮 + content 截断到 4k 字符；智能截断放 D7。
4. **`reading_progress.paragraph_id`**：保持 NOT NULL，用「章首段」占位（最小改动，C3）。
5. **竖排 Tab a11y**：D7 加「水平 Tab 备选」设置开关（开放问题）。

---

## 12. 启动建议

**立即可做**：D1（无前置依赖，纯 schema + 测试）。
**D1 完成后并行**：D2（库 / 树 UI）与 D4（AI / 析栏）可并行，分别由 dev-rd 与 dev-ai 风格的 subagent 推进（参考 `agent-team.md`），主 agent 负责共享文件（`store.ts` / `BookDetailView.tsx` / IPC index）的集成。

每个切片的 Definition of Done：
1. 代码写完且符合 §9 约定；
2. `npm run check` 绿；
3. `PROGRESS.md` 更新（todo→done + 决策）；
4. 单切片单 commit（tag `(Dn)`）；
5. （推荐）`qa-review` agent 过 diff。

---

*文档结束。下一步：开始 D1。*
