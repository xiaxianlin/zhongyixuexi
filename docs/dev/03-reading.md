# 阅读模块技术设计文档（03-reading）

> ⚠️ **状态：大幅收敛（v3.0 收敛重构后）**
>
> 本文档描述的三栏工作台/拖拽调宽/布局预设/繁简拼音/逐段锁定同步滚动/词条浮窗/沉浸模式/多 Tab 多窗/快捷键体系/书签等**绝大部分已不在当前实现内**。阅读能力已并入书库的**书籍详情页 `BookDetail`**。
>
> **当前实际状态**（`src/modules/library/LibraryView.tsx` 的 `BookDetail` + `electron/services/reading.ts`）：
> - ✅ 保留：`reading:getChapter`（取章 + 段落列表 + 段落解读 `interpretation`）；段级阅读进度（`reading_progress`，按 book_id 唯一，含 chapter_id/paragraph_id/scroll_ratio/read_seconds/percent）。
> - ❌ 已删除：独立 `ReadingWorkbench`、拖拽/折叠/布局预设、繁简/拼音、同步滚动 `useSyncScroll`、`TermPopover`、`BookmarkBar`、沉浸模式、多 Tab/多窗、`KeyboardLayer`、`reading:{getProgress,saveProgress,listBookmarks,addBookmark,updateBookmark,removeBookmark,getLayout,saveLayout,getInterpretation,lookupTerm,compareVersions,openTab,closeTab}` 等 IPC。
> - 📌 `src/modules/reading/` 仅剩 `types.ts`；`bookmarks` 表已删。解读栏改为在详情页右侧"析"面板内，由 `ai:generateModern` 按需生成。
>
> **权威参考**：`docs/PRD.md` v3.0 §3.3、`docs/dev/00-architecture.md` §5。下文为原始愿景设计存档。

## 1. 概述

### 1.1 职责

阅读模块是用户进入软件后停留时间最长的主场景，职责是把 IMP 解析产出的 `chapters` / `paragraphs` 呈现为**可深读、可对齐、可标注、可记忆**的桌面工作台，并对接 AI（07-ai）、笔记（06-notes）、检索（05-search）、学习（04-learning）模块做增强。具体承担：

- 三栏可布局工作台（原文 / 解读 / 资源），支持拖拽、折叠、调宽、布局预设（RD-01）。
- 原文栏排版渲染（仿宋衬线、字号行距行宽可调、繁简/拼音注音）（RD-02）。
- 解读栏展示 AI 白话 + 医理点拨，与原文**逐段锁定同步滚动**、可开关（RD-03）。
- 资源栏（AI 配图、经络图、关联方剂），可切换为笔记栏（RD-04）。
- 词条浮窗：点击词 → 本地词典 / AI 释义 / 关联跳转（RD-05）。
- 多版本对照：同书不同导入版本逐段对齐（RD-06，P1）。
- 沉浸 / 护眼模式（RD-07）。
- 书签与**段级阅读进度**，自动记录与恢复（RD-08）。
- 快捷键体系（RD-09）。
- 多 Tab / 多窗（RD-10）。

### 1.2 边界

| 做什么 | 不做什么（归属） |
|---|---|
| 段落渲染、滚动、定位、进度、书签、浮窗、布局 | 段落解析与段级编辑（**01-import-parse / IMP**） |
| 调 AI 生成解读并缓存展示 | AI Prompt 编排、流式调用、token 计费（**07-ai / AI**）；本模块只做"请求 + 展示 + 缓存键" |
| 资源栏切笔记入口 | Markdown 编辑、双链解析、导出（**06-notes / NOTE**） |
| 词条点击 → 词典查询入口 | 术语词典的构建与维护（**05-search / SRH**，`dictionary_terms` 表） |
| 记忆卡"一键加入"按钮 | SM-2 调度、复习计划、测验（**04-learning / LRN**） |
| 全库高亮入口 | FTS5 索引、关系网络（**05-search / SRH**） |

### 1.3 与其它模块的关系

```
        ┌─────────────────────────── RD 阅读 ───────────────────────────┐
        │  布局/滚动/进度/书签/浮窗/快捷键/Tab 多窗                       │
        └──┬─────────────┬──────────────┬──────────────┬───────────────┘
           │ reads       │ invokes      │ invokes      │ invokes
           ▼             ▼              ▼              ▼
   paragraphs/chapters  07-ai 生成     05-search     04-learning
   (IMP 产出, 稳定 ID)  (解读/配图)   (词典/高亮)    (加记忆卡)
           │             │              │              │
           │             ▼              ▼              ▼
           │        ai_cache(段级) dictionary_terms  cards
           │
           ▼
   reading_progress / bookmarks (RD 自有表)
```

- **强依赖**：`paragraphs` / `chapters` 表（稳定 ID）、`ai_cache`（段级解读缓存）、`settings`（布局预设、主题、字号）。
- **被依赖**：`06-notes` 通过 `paragraph_id` 在资源栏/侧栏显示关联笔记；`04-learning` 从阅读页接收"加卡"请求。

---

## 2. 相关需求

引用 `PRD.md` §3.4 功能编号与验收标准，补充本模块的工程化验收口径。

| 编号 | 需求摘要 | PRD 验收标准 | 工程验收口径（本文细化） |
|---|---|---|---|
| RD-01 | 三栏工作台 | 默认左原文/中解读/右资源；可拖拽、折叠、调宽；布局可保存为预设 | 三栏宽度比例持久化到 `settings`；折叠后单栏占满；预设增删改；拖拽过程中无回流、<16ms/帧 |
| RD-02 | 原文栏 | 仿宋衬线；字号/行距/行宽可调；繁简切换、拼音/注音 | 字号 18–32px 无级可调并持久化；繁简映射查表；拼音叠加用 Ruby/`<rt>` 不破坏段落 DOM |
| RD-03 | 解读栏 | AI 白话逐句译文 + 医理点拨（按需生成、本地缓存）；与原文**逐段锁定同步滚动**（可开关） | 按 `paragraph_id` 映射；同步误差 ≤ 1 段；开关切换无跳变；无解读的段显示占位"未生成" |
| RD-04 | 资源栏 | AI 配图（缩放）；可切换为笔记栏 | Tab 切换保留滚动位置；图片懒加载、缩放不重排 |
| RD-05 | 词条浮窗 | 点击词 → 本地词典/AI 释义 + 关联跳转 | 浮窗定位防越界（flip）；词典未命中可一键调 AI；关联条目点击跳转定位到段 |
| RD-06 | 多版本对照 | 并排同一书不同导入版本，逐段对齐（P1） | 按章节标题模糊匹配 + 段落文本相似度对齐；对齐失败段显示"无对应" |
| RD-07 | 沉浸 / 护眼 | 隐藏工具栏全屏；浅色/深色/护眼主题 | `F11`/快捷键切换；主题 token 即时切换无重载；全屏退出恢复布局 |
| RD-08 | 书签与进度 | 书签收藏；自动记录阅读进度（**精确到段**） | 进度写 `reading_progress`（chapter+paragraph+scrollRatio）；重开自动恢复；崩溃不丢（事务 + debounce 落盘） |
| RD-09 | 快捷键体系 | 翻章/翻段、高亮、加记忆卡、跳转全键盘操作 | 全命令可达键盘；冲突可配置；macOS 用 `Cmd`、Win 用 `Ctrl` 自动映射 |
| RD-10 | 多 Tab / 多窗 | 同时打开多章对照；弹出独立窗口 | 见 §6.5 方案选型（单窗多 Tab 为主，关键章可弹出独立 BrowserWindow） |

**非功能（PRD §4）适用项**：NFR-P2 章节/段落打开 ≤ 200ms（本地命中）；NFR-P5 稳态内存 ≤ 400MB（需做章节内容懒加载、虚拟滚动）。

---

## 3. 目录与文件结构

按 `00-architecture.md` §3 的分层（`electron/` 主进程业务在 `services/`，薄 IPC 在 `ipc/`，渲染在 `src/modules/reading/`）。

```
electron/
├── services/
│   └── reading.ts              # 进度/书签/布局预设/版本对照对齐 等业务逻辑
├── ipc/
│   └── reading.ts              # 注册 reading:* handle（薄层，参数校验 + 调 service）
└── models/
    └── reading.ts              # DTO 类型：ProgressDTO / BookmarkDTO / LayoutPreset 等

src/                            # React 渲染进程
├── modules/reading/
│   ├── ReadingWorkbench.tsx    # 三栏工作台根（布局容器、DragSplitter、预设管理）
│   ├── panels/
│   │   ├── OriginalPanel.tsx   # 左：原文栏（排版、繁简、拼音、词条命中）
│   │   ├── InterpretPanel.tsx  # 中：解读栏（AI 白话 + 医理，逐段块）
│   │   └── ResourcePanel.tsx   # 右：资源栏（配图/经络/关联，可切笔记）
│   ├── components/
│   │   ├── ParagraphBlock.tsx  # 单段渲染（原文/解读共用，data-paragraph-id 锚定）
│   │   ├── SyncScroller.ts     # 逐段锁定同步滚动控制器（核心算法，见 §7.1）
│   │   ├── TermPopover.tsx     # 词条浮窗
│   │   ├── BookmarkBar.tsx     # 书签条/侧栏
│   │   ├── ChapterTree.tsx     # 目录树（复用 LIB-02，薄封装）
│   │   ├── VersionCompare.tsx  # 多版本对照（P1）
│   │   ├── ImmersiveToggle.tsx # 沉浸/护眼切换
│   │   └── KeyboardLayer.tsx   # 快捷键绑定层
│   ├── hooks/
│   │   ├── useParagraphs.ts    # 取章内段落（分页/虚拟化）
│   │   ├── useProgress.ts      # 进度记录/恢复
│   │   ├── useBookmarks.ts
│   │   ├── useSyncScroll.ts    # 同步滚动开关 + 联动
│   │   └── useReadingKeyboard.ts
│   └── types.ts                # 渲染侧局部类型
├── stores/
│   ├── reading.ts              # Zustand：当前章/段、滚动状态、面板可见性、布局
│   └── session.ts              # 跨模块：当前打开的书/章/段、Tab 列表（见 §6.5）
└── lib/
    └── ipc.ts                  # window.api.reading.* 类型化封装
```

> **分层原则**：渲染进程不裸写 SQL，所有数据经 `reading:*` IPC 调主进程 `services/reading.ts`；store 仅缓存当前会话状态（当前章、滚动比例、面板可见性），持久化数据一律走 SQLite。

---

## 4. 数据模型

本模块涉及 3 张自有表（`reading_progress`、`bookmarks`、布局预设存 `settings` 的 JSON 字段）+ 复用 `paragraphs` / `chapters` / `ai_cache`。

### 4.1 reading_progress（段级阅读进度，RD-08）

```sql
-- 段级阅读进度：一本书一行（按 book_id 唯一），记录最近阅读位置
CREATE TABLE IF NOT EXISTS reading_progress (
  book_id        TEXT    NOT NULL,                 -- FK books.id（一本书一条）
  chapter_id     TEXT    NOT NULL,                 -- 当前章节（FK chapters.id，稳定 ID）
  paragraph_id   TEXT    NOT NULL,                 -- 当前可视区顶部段（FK paragraphs.id，段级精度）
  scroll_ratio   REAL    NOT NULL DEFAULT 0,       -- 章节内滚动比例 0~1（段落之上更细粒度的微调）
  read_seconds   INTEGER NOT NULL DEFAULT 0,       -- 累计阅读秒数（参与 streak/仪表盘）
  percent        REAL    NOT NULL DEFAULT 0,       -- 全书阅读百分比（章节字数加权，展示用，冗余可由触发器维护）
  updated_at     INTEGER NOT NULL,                 -- unix ms
  PRIMARY KEY (book_id),
  FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE CASCADE,
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE CASCADE,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE CASCADE
);

-- 按更新时间排序（书库卡片展示"最近阅读"）
CREATE INDEX IF NOT EXISTS idx_reading_progress_updated
  ON reading_progress(updated_at DESC);
```

**设计要点**：
- **段级精度**：`paragraph_id` 是主定位锚（稳定 ID，重解析不破坏），`scroll_ratio` 仅作段内微调（如该段很长，记录段内 0.3 处）。
- **一章多段一进度**：进度记录"最近可视顶部段"。恢复时滚动到该段顶部再叠加 `scroll_ratio`。
- **崩溃安全**：主进程用 `db.transaction()` 写入；渲染侧 debounce 2s + 页面隐藏/失焦时强制 flush（见 §7.3）。
- **全书百分比**：`percent` 冗余字段，由触发器在段落阅读状态变化时按章节字数加权重算，避免书库页实时聚合。

### 4.2 bookmarks（书签，可绑段/章，RD-08）

```sql
-- 书签：可绑定到段（精确）或章（粗粒度），带可选标题/备注
CREATE TABLE IF NOT EXISTS bookmarks (
  id             TEXT    PRIMARY KEY,              -- UUID v4
  book_id        TEXT    NOT NULL,                 -- FK books.id
  chapter_id     TEXT    NOT NULL,                 -- FK chapters.id（必填，定位到章）
  paragraph_id   TEXT,                             -- 可空：空=章级书签，非空=段级书签（FK paragraphs.id）
  title          TEXT,                             -- 可空：用户自定义标题，缺省取段落/章节标题前 N 字
  note           TEXT,                             -- 可空：书签备注
  color          TEXT,                             -- 可空：标签色（预留，多色书签）
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (book_id)      REFERENCES books(id)      ON DELETE CASCADE,
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id)   ON DELETE CASCADE,
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id) ON DELETE SET NULL
);

-- 书签侧栏按书 + 创建时间倒序列出
CREATE INDEX IF NOT EXISTS idx_bookmarks_book_created
  ON bookmarks(book_id, created_at DESC);
-- 按段快速查"这段有几个书签"（阅读页段内显示标记）
CREATE INDEX IF NOT EXISTS idx_bookmarks_paragraph
  ON bookmarks(paragraph_id) WHERE paragraph_id IS NOT NULL;
```

**设计要点**：
- `paragraph_id` 可空实现"章级 vs 段级"二合一，避免两张表；段级书签是 RD-08 验收的"精确到段"。
- 段落被段级编辑删除时 `ON DELETE SET NULL`（退化为章级书签），不丢用户标记。
- `title` 缺省取章节/段落首句前 16 字，减少用户手动命名负担。

### 4.3 布局预设（存 settings 表，RD-01）

布局预设不单建表，复用全局 `settings` 表的 KV JSON 模式（归属 SET 模块，此处定义 value 结构）：

```ts
// settings 表中 key = 'reading.layout', value 为下列 JSON
interface ReadingLayoutPreset {
  id: string;              // UUID
  name: string;            // "默认三栏" / "对照宽原文" / ...
  panels: {
    original:   { visible: boolean; widthRatio: number }; // 0~1
    interpret:  { visible: boolean; widthRatio: number };
    resource:   { visible: boolean; widthRatio: number; mode: 'resource' | 'notes' };
  };
  syncScroll: boolean;     // 是否开启逐段锁定同步滚动
  fontSize: number;        // 原文字号（RD-02）
  lineHeight: number;
  theme: 'paper' | 'ink' | 'eye-care'; // RD-07
}
// settings value = { active: presetId, presets: ReadingLayoutPreset[] }
```

> settings 表的 DDL 由 `08-settings-data.md` 定义。本模块只读写 `reading.layout` 这一 key。

### 4.4 复用表的字段约定

| 表 | 本模块用到字段 | 说明 |
|---|---|---|
| `paragraphs` | `id`, `chapter_id`, `order_index`, `text`, `content_modern`, `content_explanation`, `parse_hash` | `content_modern`/`content_explanation` 为 AI 生成并缓存（见 `ai_cache`）；同步滚动以 `order_index` 排序、`id` 锚定 |
| `chapters` | `id`, `book_id`, `parent_id`, `order_index`, `title`, `level` | 目录树、进度跳转、版本对照章节匹配 |
| `ai_cache` | `paragraph_id`, `type`('modern'/'explanation'/'image'), `content`, `updated_at` | 解读栏与资源栏读取 AI 缓存；未命中则调 AI 模块（07） |

---

## 5. IPC 接口

统一 channel 前缀 `reading:*`（遵循 `00-architecture.md` §4 命名约定）。所有 handler 在 `electron/ipc/reading.ts` 注册，薄层调 `services/reading.ts`。

| Channel | 入参 | 返回 | 说明 / 进度 |
|---|---|---|---|
| `reading:getChapter` | `{ bookId, chapterId }` | `{ chapter, paragraphs: ParagraphDTO[] }` | 取章 + 段列表（按 order_index 排序）；本地命中应 <200ms |
| `reading:getProgress` | `{ bookId }` | `ProgressDTO \| null` | 恢复阅读位置 |
| `reading:saveProgress` | `ProgressDTO` | `{ ok: boolean }` | debounce 由渲染侧控制；主进程事务写入 |
| `reading:listBookmarks` | `{ bookId }` | `BookmarkDTO[]` | 按创建时间倒序 |
| `reading:addBookmark` | `{ bookId, chapterId, paragraphId?, title?, note? }` | `BookmarkDTO` | 段/章二合一 |
| `reading:updateBookmark` | `{ id, title?, note?, color? }` | `BookmarkDTO` | |
| `reading:removeBookmark` | `{ id }` | `{ ok: boolean }` | |
| `reading:getLayout` | — | `{ active, presets[] }` | 读 settings.reading.layout |
| `reading:saveLayout` | `{ active, presets[] }` | `{ ok }` | 写 settings |
| `reading:getInterpretation` | `{ paragraphId }` | `{ modern?, explanation?, cached: boolean }` | 先查 ai_cache；未命中返回 cached=false，由渲染侧决定是否触发 AI（调 `ai:generateModern`） |
| `reading:lookupTerm` | `{ term }` | `{ definition?, source?: 'dict' \| 'ai' }` | 先查 `dictionary_terms`（SRH）；未命中可选调 AI（07） |
| `reading:compareVersions` | `{ bookIdA, bookIdB, chapterIdA }` | `{ pairs: [{ paraA?, paraB?, score }] }` | P1 多版本对照：按章节标题匹配 + 段文本相似度对齐 |
| `reading:openTab` / `reading:closeTab` | `{ bookId, chapterId }` / `{ tabId }` | `{ tabId }` | 多 Tab 会话（见 §6.5，渲染侧 session store 为主，IPC 仅持久化"最近 Tab 列表"） |

**错误约定**：handler 抛 `AppError`（`{ code, message, details? }`），code 取 `Db` / `Validation` 等（见 00-architecture §7）。例如 `paragraphId` 不属于该 `chapterId` 时抛 `Validation`。

**长任务**：`reading:getChapter` 对超大章节（>500 段）分页返回，进度通过 `webContents.send('reading:chapterChunk', chunk)` 推送，渲染侧增量渲染（虚拟滚动，见 §6.3）。

**IPC 暴露（preload 节选）**：

```ts
// electron/preload/index.ts（reading 段）
reading: {
  getChapter: (p) => ipcRenderer.invoke('reading:getChapter', p),
  getProgress: (p) => ipcRenderer.invoke('reading:getProgress', p),
  saveProgress: (p) => ipcRenderer.invoke('reading:saveProgress', p),
  listBookmarks: (p) => ipcRenderer.invoke('reading:listBookmarks', p),
  addBookmark: (p) => ipcRenderer.invoke('reading:addBookmark', p),
  // ...
}
```

---

## 6. 前端设计

### 6.1 组件树

```
<ReadingWorkbench>                       // 三栏根，读 layout 预设
 ├─ <Toolbar>                            // 章节标题 / 翻章 / 沉浸 / 同步滚动开关 / 布局预设选择
 ├─ <DragSplitter layout="horizontal">   // 拖拽分隔条，控制三栏 widthRatio
 │   ├─ <OriginalPanel>                  // 左
 │   │   ├─ <ChapterTree> (collapsible)  // 目录树（复用 LIB-02）
 │   │   └─ <VirtualParagraphList type="original">
 │   │        └─ <ParagraphBlock kind="original" data-paragraph-id=…>
 │   │             └─ <TermTrigger>      // 词可点击，触发 <TermPopover>
 │   ├─ <InterpretPanel>                 // 中
 │   │   └─ <VirtualParagraphList type="interpret" syncedTo="original">
 │   │        └─ <ParagraphBlock kind="interpret" data-paragraph-id=…>
 │   │             ├─ <ModernText>
 │   │             └─ <ExplanationBlock>
 │   └─ <ResourcePanel mode={resource|notes}>  // 右
 │       ├─ (resource) <ImageViewer> / <MeridianChart> / <RelatedList>
 │       └─ (notes)   <NoteEditor>       // 复用 06-notes
 ├─ <BookmarkBar>                        // 书签侧抽屉（可折叠）
 ├─ <TermPopover>                        // 全局浮层（portal）
 └─ <KeyboardLayer>                      // 快捷键（挂在 window，见 §6.6）
```

### 6.2 store 结构（`src/stores/reading.ts`，Zustand）

```ts
interface ReadingStore {
  // 会话状态（不持久化，持久化走 IPC）
  bookId: string | null;
  chapterId: string | null;
  paragraphs: ParagraphDTO[];          // 当前章段落
  topParagraphId: string | null;       // 当前可视顶部段（写进度用）
  scrollRatio: number;                 // 段内/章内微调比例

  // 布局
  layout: ReadingLayoutPreset | null;
  panels: { original: PanelState; interpret: PanelState; resource: PanelState };
  syncScroll: boolean;
  immersive: boolean;

  // 书签缓存（当前书）
  bookmarks: BookmarkDTO[];

  // actions
  openChapter(bookId, chapterId): Promise<void>;
  setTopParagraph(id, ratio): void;    // 触发 debounced saveProgress
  toggleSyncScroll(): void;
  applyPreset(preset): void;
  addBookmarkAt(paragraphId?): Promise<void>;
  // ...
}
```

> 遵循 00-architecture §6：store 只缓存当前会话；切换 Tab/章节时清旧加载新；不把全库段落塞进 store。

### 6.3 虚拟滚动与性能

为满足 NFR-P5（内存 ≤400MB）与大章节（数百段）：

- 原文/解读栏用**虚拟列表**（如 `@tanstack/react-virtual`），仅渲染可视区 ±buffer 段落 DOM。
- 段落 DOM 必须有稳定 `data-paragraph-id` 与稳定高度预估（measureCache），供同步滚动锚定。
- 图片懒加载（`IntersectionObserver`），`decoding="async"`。
- 章节切换走 `reading:getChapter`，超大章分块（见 §5 进度推送）。

### 6.4 原文排版（RD-02）

- 字体：仿宋衬线（CSS `font-family: "FangSong","STFangsong",serif`），字号 18–32px，行高 1.6–1.8，行宽 `max-width: 42rem`。
- 繁简切换：查繁简映射表（本地 JSON，随包），替换渲染文本不改库内原文（保留原文档底本）。
- 拼音/注音：用 HTML5 Ruby `<ruby>人<rt>rén</rt></ruby> 参<rt>shēn</rt></ruby>`，拼音数据由 IMP-05 生成或按需 AI 标注（多音字词典校正，见 idea.md §8）。叠加注音不破坏段落 DOM 结构，保证 `data-paragraph-id` 锚定稳定。

### 6.5 多 Tab / 多窗（RD-10）方案选型

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A. 单窗多 Tab**（主进程 1 个 BrowserWindow，渲染内 Tab 栏） | 状态共享简单（同 store）、切换快、内存低、IPC/db 单连接复用 | 单窗崩溃影响所有 Tab；极致对照（4 屏并排）受限 | **MVP/P0 采用** |
| **B. 多 BrowserWindow**（每章弹独立窗口） | 天然隔离、可拖到不同显示器、原生窗口管理 | 每窗一套渲染进程，内存 ×N；跨窗同步（进度/书签）需 IPC 广播 | **P1 选择性采用**：仅"弹出独立窗口"按钮触发，用于对照研读 |
| C. 单窗 + 多 BrowserView（已弃用 API） | 介于 A/B | Electron 已弃用 BrowserView，推荐 WebContentsView | 不采用 |

**最终选型**：
- **主形态：单窗多 Tab**（方案 A）。`stores/session.ts` 维护 `tabs: ReadingTab[]`（每 Tab 含 bookId/chapterId/scrollRatio/paragraphId），活动 Tab 渲染到工作台。切换 Tab 不销毁组件树，用 CSS `hidden` 保活（保留滚动位置）。
- **弹出独立窗**（方案 B，P1）：工具栏"在新窗口打开"按钮 → 主进程 `window.ts` 新建 `BrowserWindow`，通过 IPC 传 `{ bookId, chapterId, paragraphId }`；独立窗读同一 `app.db`，进度/书签写入后用 `webContents.send('reading:bookmarkChanged')` 广播给主窗刷新（避免脏读）。
- **对照研读**：多 Tab + RD-06 多版本对照（同窗内并排）即可满足大多数场景；跨屏对照用弹出窗。

### 6.6 快捷键体系（RD-09）

**绑定方案**：自研轻量层 `KeyboardLayer`（基于 React + `keydown` 监听），不引入 mousetrap（减少依赖、可控冲突）。理由：命令清单固定（见下）、需 macOS/Win 自动映射 `Cmd/Ctrl`、需支持用户自定义（读 settings）。

**命令清单（默认绑定）**：

| 命令 | macOS | Windows | 说明 |
|---|---|---|---|
| 上一章 | `Cmd+Shift+Left` | `Ctrl+Shift+Left` | RD-09 翻章 |
| 下一章 | `Cmd+Shift+Right` | `Ctrl+Shift+Right` | |
| 上一段 | `Cmd+Up` / `K` | `Ctrl+Up` / `K` | 滚动到上一段顶部 |
| 下一段 | `Cmd+Down` / `J` | `Ctrl+Down` / `J` | |
| 切换同步滚动 | `Cmd+Shift+S` | `Ctrl+Shift+S` | RD-03 开关 |
| 切换沉浸模式 | `F11` / `Cmd+Shift+F` | `F11` | RD-07 |
| 加书签（当前段） | `Cmd+D` | `Ctrl+D` | RD-08 段级 |
| 加记忆卡（当前段） | `Cmd+M` | `Ctrl+M` | 调 LRN |
| 高亮选中 | `Cmd+H` | `Ctrl+H` | |
| 命令面板 / 跳转 | `Cmd+P` / `Cmd+K` | `Ctrl+P` / `Ctrl+K` | 章节快速跳转 |
| 关闭 Tab | `Cmd+W` | `Ctrl+W` | RD-10 |
| 新 Tab / 打开书 | `Cmd+T` | `Ctrl+T` | |

**实现要点**：
- 全局监听挂在 `window`，活动 Tab/store 决定命令路由。
- 输入框聚焦时（`isContentEditable` / `input`/`textarea`）禁用单字母快捷键（`J`/`K`/`H`），避免误触。
- 冲突检测：保存自定义绑定时校验同修饰键组合不重复。
- 所有可交互元素 `tabindex` + `aria-label`，满足可访问性（PRD §4.4）。

---

## 7. 核心流程

### 7.1 逐段锁定同步滚动（RD-03）——核心算法

**目标**：原文栏滚动时，解读栏自动滚动到"对应段"位置，反之亦然；误差 ≤1 段；可开关。

**映射基础**：原文段与解读段**共享 `paragraph_id`**（解读是同一 `paragraph` 行的 `content_modern`/`content_explanation`，或 `ai_cache` 按 `paragraph_id` 缓存）。因此映射是 1:1 按 `paragraph_id` + `order_index` 对齐，无需文本匹配。

**算法（元素锚定 + 比例插值，伪代码）**：

```
# 记号：
#   A = 原文栏滚动容器, B = 解读栏滚动容器
#   P = 当前章段落列表（按 order_index 升序，每段有 paragraph_id）
#   domA[id], domB[id] = 两栏中对应段的 DOM 元素（虚拟列表需 measureCache 估高）

# 状态：syncing（防来回震荡的 reentry guard）
syncing = false

function onScrollA(event):
    if not syncScroll or syncing: return
    syncing = true
    try:
        # 1) 找 A 中"可视区顶部锚点段" anchorA
        #    定义：第一个其底边 >= A.scrollTop 的段（即顶部刚刚露出/即将划过的段）
        anchorA = findAnchor(A, A.scrollTop)      # 逼近查找，O(log n)
        if anchorA == null: return
        id = anchorA.paragraph_id

        # 2) 计算锚点段在 A 内的"段内进度比例" r ∈ [0,1]
        #    r = (scrollTop - 段顶) / 段高  —— 表示锚点段滚过了多少
        topA    = domA[id].offsetTop - A.offsetTop
        heightA = domA[id].offsetHeight
        r = clamp((A.scrollTop - topA) / heightA, 0, 1)

        # 3) 在 B 中定位同 id 段，按比例插值目标 scrollTop
        domB[id] = resolveB(id)                    # 虚拟列表可能未渲染 → 用 measureCache 估 offsetTop
        if domB[id] == null:
            # 降级：B 没有该段（未生成解读），滚到最近的"已生成"段
            target = nearestRenderedB(id)
        else:
            topB    = domB[id].offsetTop - B.offsetTop
            heightB = domB[id].offsetHeight
            target  = topB + r * heightB           # 按段内比例对齐

        # 4) 平滑设置 B 滚动（避免抢占焦点/动画抖动）
        B.scrollTop = target                        # 或 B.scrollTo({ top: target, behavior: 'auto' })
    finally:
        syncing = false                             # 用 rAF 延迟释放更稳：nextFrame(() => syncing=false)

# 反向（B 滚动驱动 A）对称实现 onScrollB，复用同一逻辑交换 A/B。
```

**关键工程点**：
1. **reentry guard（`syncing`）**：设置 B 的 `scrollTop` 会触发 B 的 scroll 事件，必须用 flag 阻断反向再触发 A，否则死循环抖动。推荐用 `requestAnimationFrame` 在下一帧释放 flag，保证一帧内只同步一次。
2. **虚拟列表未渲染段的处理**：B 栏用虚拟滚动时，目标段 DOM 可能不存在，用 `measureCache[id]`（已测量过的段高累积 offsetTop）估算位置；估算后 B 滚动到该位置会触发该段渲染，可二次精修（`IntersectionObserver` 回调修正）。
3. **段高不等**：原文段与解读段高度通常不同（解读更长），所以用"段内比例 r"而非绝对像素，保证视觉上"读到段的同一进度"。
4. **未生成解读的段**：`ai_cache` 未命中时解读栏该段显示占位"点击生成"，同步滚动跳过它滚到最近已生成段（`nearestRenderedB`），并在锚点段渲染后修正。
5. **开关切换无跳变**：关闭同步滚动时记录两栏各自位置；重新开启时以"当前活动栏"（最后滚动的栏）为准，把另一栏同步过来，避免突跳。
6. **节流**：`onScrollA` 用 `rAF` 节流（一帧一次），滚动量大时不掉帧。

**为什么不用纯比例同步**：`scrollRatio = scrollTop/scrollHeight` 直接套用会让两栏顶部对不齐段（因段高差异累积），读感错位。**元素锚定 + 段内比例**才是"逐段锁定"的正确语义，满足 RD-03 验收"逐段锁定、误差≤1段"。

### 7.2 打开章节与渲染流程

```
用户在目录树点击章节 / 恢复进度跳转
  │
  ▼
store.openChapter(bookId, chapterId)
  ├─ IPC reading:getChapter → { chapter, paragraphs[] }
  ├─ IPC reading:getProgress(bookId) → 取上次位置（若就是本章）
  ├─ 渲染原文 VirtualParagraphList（按 order_index）
  ├─ 解读栏：逐段 reading:getInterpretation(paragraphId)
  │     ├─ cached → 直接渲染
  │     └─ 未缓存 → 占位"点击生成"（不自动调 AI，省 token；用户点或开关"自动生成"触发 ai:generateModern）
  ├─ 资源栏：取 ai_cache(type='image') / 关联方剂（SRH）
  └─ 恢复滚动：scrollTop = measureCache[topParagraphId].offsetTop + scrollRatio*段高
        + 若 syncScroll 开 → 触发一次 onScrollA 同步 B
```

### 7.3 段级进度记录与恢复（RD-08）

```
[记录]（渲染侧）
  IntersectionObserver 监听原文栏可视段 → 取最顶部可见段 id
    │
    ▼
  store.setTopParagraph(id, ratio)
    └─ debounce 2s → IPC reading:saveProgress
         └─ 主进程 db.transaction() UPSERT reading_progress
  + 页面 visibilitychange='hidden' / beforeunload → 强制 flush（防丢）
  + 阅读时长：每 30s 累加 read_seconds（`setInterval`，隐藏时暂停）

[恢复]（启动 / 打开书时）
  reading:getProgress(bookId) → { chapterId, paragraphId, scrollRatio }
    └─ openChapter + 滚动到 paragraphId + scrollRatio（见 §7.2）
```

**崩溃安全**：debounce 期间崩溃最多丢 2s 进度（可接受）；失焦/隐藏时强制 flush 把窗口压到最小。事务保证 UPSERT 原子。

### 7.4 词条浮窗（RD-05）

```
原文 <ParagraphBlock> 内词可点击（前端分词：按字/词典最大匹配，或选中触发）
  │ term = "人参"
  ▼
IPC reading:lookupTerm(term)
  ├─ 查 dictionary_terms（SRH 表）命中 → { definition, source:'dict' }
  └─ 未命中 → 返回 { cached:false }
       └─ 浮窗显示"本地词典无，[AI 释义]"按钮
            └─ 点击 → ai:explainTerm(term, context=当前段原文)（07-ai）
                 └─ 结果展示 + 标注"AI 辅助生成"（合规 §9）
+ 浮窗底部"关联条目"：SRH 查同 term 的其它段落/方剂 → 点击跳转（定位到段）
+ 浮窗定位：Popover 用 floating-ui（flip/fence）防越界出屏
```

### 7.5 多版本对照对齐（RD-06，P1）

```
IPC reading:compareVersions(bookIdA, bookIdB, chapterIdA)
  ├─ 章节匹配：A 章标题 → 在 B 书 chapters 模糊匹配（归一化去"卷/品/篇"层级词 + 编辑距离）
  │     └─ 命中 chapterIdB
  ├─ 段对齐：A、B 两章段落按文本相似度（余弦/编辑距离，阈值 0.6）贪心匹配
  │     ├─ 匹配上 → pair { paraA, paraB, score }
  │     ├─ A 有 B 无 → pair { paraA, paraB:null }（显示"无对应"）
  │     └─ B 有 A 无 → pair { paraA:null, paraB }
  └─ 渲染 <VersionCompare>：并排两栏，差异高亮（同/异色块），复用同步滚动（按 pair 序号锚定）
```

---

## 8. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 章节段落为空（解析失败 / 空章） | 原文栏显示"本章无内容，请在导入校对中检查（IMP-06）"，不崩溃 |
| `paragraph_id` 在 `paragraphs` 已删除（段级编辑删段） | 进度恢复时该段不存在 → 降级到同章 `order_index` 最近段；书签 `ON DELETE SET NULL` 退化为章级 |
| AI 解读未生成 / 调用失败（AI-07） | 解读栏占位"点击生成"或"AI 不可用，检查 API Key"；不阻断原文阅读；同步滚动跳过该段 |
| AI 解读与原文段不对齐（AI 输出未严格按段） | 解读块以 `paragraph_id` 为准从 `ai_cache` 取，AI 模块（07）负责按段生成与缓存键；本模块不解析自由文本 |
| 同步滚动虚拟列表未渲染目标段 | 用 measureCache 估算 offsetTop，渲染后 IntersectionObserver 修正（见 §7.1） |
| 超大章节（>500 段） | 分块 IPC + 虚拟滚动；进度按块推送（§5） |
| 多 Tab 内存膨胀 | 非活动 Tab 段落数据从 store 释放，仅保留滚动位置；切回时重取（`reading:getChapter` 本地命中快） |
| 弹出独立窗写进度后主窗脏读 | 独立窗写入后 `webContents.send('reading:progressChanged', ...)` 广播，主窗刷新 store |
| 快捷键与输入框冲突 | 输入聚焦时禁用单字母绑定（§6.6） |
| 全屏/沉浸下找不到退出键 | 浮动"退出沉浸"按钮 + `Esc`/`F11` 双重退出 |

---

## 9. 依赖关系

| 依赖（本模块 → 其它） | 内容 |
|---|---|
| → 01-import-parse (IMP) | `paragraphs` / `chapters` 表与稳定 ID；段级编辑后 ID 不变是同步映射基础 |
| → 07-ai (AI) | `ai_cache`（解读/配图/释义）、`ai:generateModern` / `ai:explainTerm` 调用；失败降级由 AI-07 保证 |
| → 05-search (SRH) | `dictionary_terms`（词条浮窗）、FTS 关联条目、全库高亮入口 |
| → 06-notes (NOTE) | 资源栏切笔记模式调 `<NoteEditor>`；按 `paragraph_id` 显示关联笔记 |
| → 04-learning (LRN) | "加记忆卡"按钮调 LRN 入卡 |
| → 08-settings (SET) | `settings` 表存布局预设、字号、主题、API Key（AI 可用性前置判断） |
| → 00-architecture (公共) | IPC 约定、`AppError`、Zustand 约定、主题 token |

| 被依赖（其它 → 本模块） | 内容 |
|---|---|
| 02-library (LIB) ← | 书库卡片显示进度（读 `reading_progress.percent` / `updated_at`） |
| 05-search (SRH) ← | 检索结果点击跳转 → 定位到段（调本模块 `openChapter + 滚动到 paragraphId`） |
| 06-notes (NOTE) ← | 双链 `[[段落]]` 跳转 → 本模块定位段 |

**共享类型（`electron/models/reading.ts` + `src/lib/types.ts`）**：`ParagraphDTO`、`ChapterDTO`、`ProgressDTO`、`BookmarkDTO`、`ReadingLayoutPreset`。主进程与渲染进程共用同一类型定义。

---

## 10. 测试策略

| 层 | 测试点 | 工具 / 夹具 |
|---|---|---|
| **service 单元** | `saveProgress` 事务原子（崩溃模拟）、`listBookmarks` 排序、`compareVersions` 章节匹配 + 段对齐相似度 | Vitest + 内存 SQLite（`better-sqlite3` `:memory:`） |
| **IPC 集成** | `reading:getChapter` 参数校验（`paragraphId` 不属 `chapterId` 抛 `Validation`）、未配置 AI 时 `getInterpretation` 返回 cached=false | mock ipcMain + service |
| **同步滚动算法** | 段高不等时比例对齐误差、虚拟列表未渲染段估算、reentry guard 不抖动、开关切换无跳变 | Vitest 测 `SyncScroller` 纯函数（`findAnchor`/比例计算）+ jsdom 模拟 scroll；构造段高不等夹具 |
| **组件** | `ParagraphBlock` 渲染稳定 `data-paragraph-id`、`TermPopover` 定位不越界、布局拖拽改变 widthRatio 并持久化 | Vitest + Testing Library |
| **store** | `openChapter` 切换清旧、`setTopParagraph` debounce 触发 saveProgress、`applyPreset` 覆盖面板状态 | Vitest |
| **快捷键** | 命令路由、输入框聚焦禁用单字母、macOS/Win 修饰键映射 | Testing Library `fireEvent.keyDown` |
| **端到端（手动/夹具）** | 打开含 300 段的章 → 滚动流畅（<16ms/帧）、进度恢复精确到段、崩溃重启不丢进度 | EPUB 测试夹具（IMP 提供，含正常/超大/空章） |
| **性能** | 稳态内存 ≤400MB（NFR-P5）、章节打开 ≤200ms（NFR-P2） | Electron 内存 profiling + 计时 |

**夹具依赖**：复用 IMP 模块的 EPUB 测试夹具（正常/异常/多层级/超大章案例），本模块在其解析结果上验证阅读链路。

---

## 11. 开放问题

1. **同步滚动的"逐句"粒度**：PRD RD-03 措辞为"逐句译文"，但本设计按**段**锁定（映射基础是 `paragraph_id`）。若需句级对齐，需 AI 模块（07）在 `ai_cache` 内输出"句对齐结构"（`[{orig_sentence, modern_sentence}]`），本模块再按句锚定。**建议 P0 段级、P2 按需句级**，需与 AI 模块确认输出 schema。关联 PRD §13 开放问题 2（段落切分粒度）。
2. **自动生成解读的触发策略**：进入章节后是否自动为所有段调 AI 生成解读（费 token）还是仅用户点击生成？**建议默认手动 + 提供"自动生成本章"开关**，需 SET 模块增加偏好项。
3. **繁简映射数据来源**：随包内置 OpenCC 轻量表 vs AI 按需转换？内置表体积可控且离线可用，**建议内置**，需确认License与体积（影响打包大小，见 NFR）。
4. **拼音/注音数据**：由 IMP-05 解析期生成存表，还是阅读期按需 AI 标注？前者离线快但解析期成本高，后者省成本但需联网。**建议 IMP 期生成并缓存到 `paragraphs` 扩展字段或 `ai_cache`**，需与 IMP 模块定字段。
5. **多版本对照的章节匹配阈值**：模糊匹配编辑距离/相似度阈值需用真实多版本 EPUB（《神农本草经》孙星衍本 vs 顾观光本）调参，P1 实施前需采集夹具。
6. **弹出独立窗口的进度同步广播**：是否需要更通用的"多窗数据同步"机制（如主进程维护变更广播总线）？目前用点对点 `webContents.send` 够用，若 RD-10 多窗场景增多可抽象为公共能力（00-architecture）。
7. **快捷键自定义存储位置**：存 `settings` 的一个 key，还是与布局预设合并？**建议独立 key `reading.keybindings`**，便于 SET 模块统一管理用户偏好。

---

*本文档结束。变更请在 `00-architecture.md` 文首版本表与本文件同步登记。*
