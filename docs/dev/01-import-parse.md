# 导入与解析模块 技术设计文档（01-import-parse）

> ⚠️ **状态：已移出应用运行路径（v3.0 收敛重构后）**
>
> 本文档描述的 EPUB 导入/段级校对/章级编辑/重新解析等**均不在当前应用运行路径内**。应用内容来源已改为**内置三本经典**（`data/{nanjing,suwen,lingshu}-original.json`），启动时由 `electron/services/builtin-content.ts` 的 `seedBuiltinContent()` 幂等写入。
>
> **当前实际状态**：
> - 现存代码：`electron/services/{epub,paragraph,import,content-normalize}.ts`、`electron/db/fts.ts` —— 仅作为**离线内容生产工具链**，用于把来源文本加工成 `data/*.json`，不在应用运行时调用。
> - 已删除：导入 UI（`src/modules/import/` 空目录）、段级校对编辑器、章级编辑、去重 UI、`import:*` / `library:deleteBook` / `library:updateMeta` 等 IPC channel。
> - FTS5 同步触发器与 `rebuildFts` **仍在运行路径**（`electron/db/schema.ts` + `fts.ts`），归内置 seed 与段落写入使用。
>
> **权威参考**：`docs/PRD.md` v3.0、`docs/dev/00-architecture.md` §5、`docs/dev/PROGRESS.md`、`docs/dev/book-import-json.md`（JSON 中间格式定义）。下文为原始愿景设计存档。

## 1. 概述

### 1.1 职责

导入与解析模块（IMP）是整个学习软件的**数据入口**。其职责是将用户导入的 EPUB 文件，在 Electron 主进程内解析为结构化的「书籍 → 章节树 → 段落」三层模型，落库到 SQLite，并支持用户对解析结果做段级 / 章级校对。解析后的段落是全文检索、AI 解读、笔记、记忆卡等所有下游模块的**最小引用单元**，因此段落必须拥有**稳定 ID** 与**内容指纹（parse_hash）**，保证重新解析与段级编辑后下游引用不失效。

首期只做 EPUB（PRD C-6），不做 PDF / OCR。

### 1.2 边界

| 在范围内 | 不在范围内 |
|---|---|
| EPUB 解包、OPF/NCX/Nav 解析、章节树构建、段落切分 | PDF 解析、扫描型 OCR（Phase 3） |
| books / chapters / paragraphs 三表 DDL 与写入 | 笔记、记忆卡、AI 解读的表与逻辑（各自模块） |
| 段级 / 章级编辑操作（增删改、合并拆分、重排、清理噪声） | 三栏阅读视图渲染（RD 模块） |
| 重新解析时的稳定 ID 映射合并（IMP-07） | FTS5 查询语法与检索 UI（SRH 模块，本模块只负责写入同步） |
| 解析进度推送、解析质量标记、去重提示 | AI 内容生成（AI 模块） |

### 1.3 与其它模块的关系

- **LIB（书库）**：IMP 产出 `books/chapters/paragraphs`，LIB 负责浏览、元信息编辑、删除级联清理。
- **RD（阅读）**：消费段落，记录段级进度。IMP 保证段落稳定 ID，使进度 / 书签在编辑后仍可定位。
- **NOTE（笔记）/ LRN（记忆卡）/ AI（解读缓存）**：均通过 `paragraph_id` 绑定段落。IMP 段级编辑须**保留这些引用**——这是稳定 ID + parse_hash 设计的核心动机。
- **SRH（检索）**：paragraphs 写入时同步 FTS5；本模块负责写入端，查询在 SRH。
- **SET（设置与数据）**：IMP 提供重新解析入口（SET-04 书籍文件管理）；原始 EPUB 存放于 `files/`，由 SET 的备份/恢复统一打包。

---

## 2. 相关需求

引用 `docs/PRD.md` §3.2。

| 编号 | 功能 | 优先级 | 关键验收标准摘要 |
|---|---|---|---|
| IMP-01 | EPUB 导入 | P0 | 拖入/选择 `.epub`；解包并解析为 书籍 + 章节树（OPF spine / NCX / Nav TOC）+ 段落 |
| IMP-02 | 段落解析 | P0 | 按语义切分段落，保留段 ID，保留原始 HTML 结构信息辅助识别 |
| IMP-03 | 段级编辑 | P0 | 段落级增删改、合并/拆分、重排、批量清理噪声（页眉/页脚/水印/空行）；原文与解析预览对照 |
| IMP-04 | 章节编辑 | P0 | 章节合并/拆分/重排、编辑标题、修正层级（卷-品-篇） |
| IMP-05 | 原文清理 | P1 | 断行拼接、空格归一、编码修复；古文可选繁简转换、自动注音 |
| IMP-06 | 解析质量提示 | P0 | 解析失败/存疑的章节与段落明确标记，引导校对 |
| IMP-07 | 重新解析 | P1 | 改参数后可重新解析；段落采用稳定 ID，已校对内容与 AI 解读按段 ID 映射保留 |
| IMP-08 | 导入去重 | P1 | 同名/同内容书提示是否覆盖或作为新副本 |

关联非功能需求：NFR-P4（中型书 ≤ 5 秒解析）、NFR-P3（检索 ≤ 300ms，依赖 FTS5 同步）、§4.2（稳定 ID 保证引用关系不破坏）。

---

## 3. 目录与文件结构

依据 `00-architecture.md` §3 的分层原则（`ipc/` 薄入口、`services/` 承载业务、`db/` 承载数据）。

```
electron/
├── services/
│   └── import/
│       ├── index.ts              # 模块对外门面：parseEpub / reparse / edit* 等
│       ├── epub-reader.ts        # node-stream-zip 封装：读 zip、取条目、读文本/图片
│       ├── opf-parser.ts         # 解析 container.xml → OPF（metadata/spine/manifest）
│       ├── toc-parser.ts         # 解析 NCX (epub2) / Nav (epub3) → 章节树
│       ├── chapter-builder.ts    # spine + toc 合并 → 层级章节树
│       ├── paragraph-splitter.ts # XHTML 正文 → paragraphs（切分策略核心）
│       ├── text-cleaner.ts       # 原文清理（IMP-05）：断行拼接、空格归一、噪声识别
│       ├── parse-hash.ts         # parse_hash 生成（内容指纹）
│       ├── stable-id.ts          # UUID v4 + 段落稳定 ID 映射合并（IMP-07）
│       ├── dedupe.ts             # 导入去重（IMP-08）
│       ├── progress.ts           # 解析进度推送（webContents.send 封装）
│       └── __tests__/            # Vitest 单元测试 + EPUB 夹具
├── ipc/
│   └── import.ts                 # ipcMain.handle 注册（薄层，调 services/import）
├── db/
│   ├── schema/
│   │   └── 01-imp.sql            # books/chapters/paragraphs/fts DDL + 触发器
│   └── migrations/
│       └── 001-init-imp.ts       # 初始迁移（建表）
└── models/
    └── import.ts                 # 与渲染进程共享的 DTO / 类型（Book/Chapter/Paragraph 等）

src/
├── modules/
│   └── import/
│       ├── ImportDropzone.tsx     # 拖入/选择 EPUB（IMP-01）
│       ├── ImportProgressDialog.tsx # 进度展示（监听 import:progress）
│       ├── ReviewWorkbench.tsx    # 段级校对双栏（IMP-03/04，PRD §10）
│       ├── ParagraphEditor.tsx    # 段落编辑（增删改/合并/拆分/重排）
│       ├── ChapterTreeEditor.tsx  # 章节树编辑（合并/拆分/标题/层级）
│       ├── NoiseCleanPanel.tsx    # 批量清理噪声（IMP-05）
│       └── QualityWarnings.tsx    # 解析质量提示（IMP-06）
├── stores/
│   └── import.ts                 # Zustand store：导入状态、当前校对书/章、进度
└── lib/
    └── ipc.ts                    # window.api.import.* 类型化封装
```

---

## 4. 数据模型

### 4.1 三张核心表 DDL

> 公共约定（遵循 `00-architecture.md` §5）：主键 `TEXT`（UUID v4，应用层生成）；时间戳 `INTEGER`（unix ms）；软删除 `deleted_at INTEGER NULL`。开启 `PRAGMA foreign_keys = ON`。

```sql
-- ============ books：书籍元信息 + 来源文件 ============
CREATE TABLE IF NOT EXISTS books (
  id              TEXT    PRIMARY KEY,                -- UUID v4，书籍稳定 ID
  title           TEXT    NOT NULL,
  author          TEXT,                                -- 可空
  source_format   TEXT    NOT NULL DEFAULT 'epub',    -- 首期仅 'epub'
  source_file     TEXT    NOT NULL,                   -- 相对路径 files/<id>.epub
  source_hash     TEXT    NOT NULL,                   -- EPUB 文件级 sha256，用于去重（IMP-08）
  cover           TEXT,                                -- 相对路径 covers/<id>.png 或 NULL
  category        TEXT,                                -- 用户分类，可空
  language        TEXT,                                -- 'zh-CN' 等，影响繁简/注音
  parse_version   INTEGER NOT NULL DEFAULT 0,         -- 已成功解析的版本号；0=未解析
  parse_status    TEXT    NOT NULL DEFAULT 'pending', -- pending|parsing|parsed|failed
  parse_params    TEXT,                                -- JSON：切分/清理参数快照（IMP-07 重解析用）
  imported_at     INTEGER NOT NULL,                   -- unix ms
  parsed_at       INTEGER,                             -- 最近一次解析完成时间
  deleted_at      INTEGER                              -- 软删除（LIB-04 级联清理判此字段）
);

CREATE INDEX IF NOT EXISTS idx_books_source_hash ON books(source_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_books_title       ON books(title)      WHERE deleted_at IS NULL;
```

```sql
-- ============ chapters：章节层级容器（稳定 ID） ============
CREATE TABLE IF NOT EXISTS chapters (
  id              TEXT    PRIMARY KEY,                -- UUID v4，章节稳定 ID
  book_id         TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  parent_id       TEXT    REFERENCES chapters(id) ON DELETE CASCADE, -- 自引用层级：卷-品-篇
  order_index     INTEGER NOT NULL,                   -- 同级排序（从 0 起）
  level           INTEGER NOT NULL DEFAULT 0,         -- 层级深度：0=顶层卷，1=品...
  level_label     TEXT,                               -- 语义层级名：'卷'|'品'|'篇'|'章'，可空
  title           TEXT    NOT NULL,
  source_href     TEXT,                               -- EPUB 内 spine itemref idref / href，溯源用
  src_anchor      TEXT,                               -- 章节在 XHTML 内的锚点 id（若有）
  content_hash    TEXT,                               -- 章节正文聚合 hash（用于重新解析映射）
  quality_flag    TEXT    NOT NULL DEFAULT 'ok',      -- ok|suspect|failed（IMP-06）
  quality_note    TEXT,                               -- 存疑/失败原因
  edited          INTEGER NOT NULL DEFAULT 0,         -- 0/1 用户是否手动编辑过（IMP-04）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER                             -- 软删除
);

CREATE INDEX IF NOT EXISTS idx_chapters_book_parent
  ON chapters(book_id, parent_id, order_index) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chapters_book
  ON chapters(book_id) WHERE deleted_at IS NULL;
-- level_label 供卷-品-篇层级识别，选择性索引
CREATE INDEX IF NOT EXISTS idx_chapters_level_label
  ON chapters(book_id, level_label) WHERE deleted_at IS NULL AND level_label IS NOT NULL;
```

```sql
-- ============ paragraphs：段落正文（稳定 ID + parse_hash，段级编辑单元） ============
CREATE TABLE IF NOT EXISTS paragraphs (
  id                  TEXT    PRIMARY KEY,            -- UUID v4，段落稳定 ID（核心）
  book_id             TEXT    NOT NULL REFERENCES books(id)    ON DELETE CASCADE,
  chapter_id          TEXT    NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  order_index         INTEGER NOT NULL,               -- 章内排序（从 0 起）
  text                TEXT    NOT NULL,               -- 段落纯文本（清理后）
  html                TEXT,                           -- 保留原始 HTML 片段（IMP-02 结构信息）
  block_type          TEXT    NOT NULL DEFAULT 'p',   -- p|h1|h2|h3|li|blockquote|...
  heading_level       INTEGER,                        -- 标题级别（block_type 为 h* 时）
  parse_hash          TEXT    NOT NULL,               -- 内容指纹（IMP-07 映射核心）
  -- AI 字段由 AI 模块写入，此处预留以避免 JOIN；可空
  content_modern      TEXT,                           -- AI 白话译文
  content_explanation TEXT,                           -- AI 医理点拨
  edited              INTEGER NOT NULL DEFAULT 0,     -- 0/1 用户是否手动编辑过（IMP-03）
  -- 段级元信息
  is_noise            INTEGER NOT NULL DEFAULT 0,     -- 0/1 是否被标记为噪声（页眉/水印）
  quality_flag        TEXT    NOT NULL DEFAULT 'ok',  -- ok|suspect|failed（IMP-06）
  quality_note        TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER                         -- 软删除
);

-- 检索/读取主路径：按章取段（RD/SRH 高频查询）
CREATE INDEX IF NOT EXISTS idx_paragraphs_chapter_order
  ON paragraphs(chapter_id, order_index) WHERE deleted_at IS NULL;
-- parse_hash 是 IMP-07 重新解析映射的查找键，必须可高效检索
CREATE INDEX IF NOT EXISTS idx_paragraphs_parse_hash
  ON paragraphs(chapter_id, parse_hash) WHERE deleted_at IS NULL;
-- 全书段落扫描（如多版本对照、清理）
CREATE INDEX IF NOT EXISTS idx_paragraphs_book
  ON paragraphs(book_id, chapter_id) WHERE deleted_at IS NULL;
```

### 4.2 FTS5 虚拟表与同步策略

FTS5 虚拟表 `fts_paragraphs` 归属 SRH 查询，但**写入同步由 IMP 负责**（段落写入/编辑/删除发生在本模块）。

采用**应用层同步 + 触发器兜底**双轨：

- **主路径（应用层）**：`services/import` 在写入 / 编辑 / 软删除段落的同一事务内，显式 `INSERT/UPDATE/DELETE INTO fts_paragraphs`。好处是可控制 tokenizer、可注入章节标题上下文、可避免触发器在批量导入时的额外开销。
- **兜底（触发器）**：防止遗漏写入路径（例如未来其它模块直接改 paragraphs），附加 AFTER 触发器保证最终一致。软删除时从 FTS 移除（保证检索不返回已删段）。

```sql
-- FTS5 虚拟表（contentless 外部内容表，避免正文双存）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_paragraphs USING fts5(
  paragraph_id UNINDEXED,
  book_id      UNINDEXED,
  chapter_id   UNINDEXED,
  title,            -- 章节标题（检索时提供上下文，提升相关性）
  text,             -- 段落正文
  tokenize = 'unicode61 remove_diacritics 2'  -- 中文需配合 simple 分词或 trigram（见说明）
  -- content='paragraphs', content_rowid='rowid'  -- 外部内容模式（可选优化）
);
```

> **中文分词说明**：`unicode61` 对中文按字切分，召回尚可但相关性一般。首期可接受（FTS5 起步，见 PRD 待决策 #3）；若需更高质量，Phase 2 切换 `tokenize = 'trigram'`（FTS5 内置，适合中文短语匹配）或接入 `jieba` 预分词列。本字段可由迁移平滑替换，不影响 paragraphs 主表。

```sql
-- ============ 触发器兜底：paragraphs ↔ fts_paragraphs 同步 ============

-- 新增段落 → 写 FTS（含章节标题）
CREATE TRIGGER IF NOT EXISTS trg_para_after_insert AFTER INSERT ON paragraphs
FOR EACH ROW WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO fts_paragraphs(paragraph_id, book_id, chapter_id, title, text)
  SELECT NEW.id, NEW.book_id, NEW.chapter_id,
         COALESCE(c.title, ''), NEW.text
  FROM chapters c WHERE c.id = NEW.chapter_id;
END;

-- 更新段落文本/章节归属 → 同步 FTS（先删后插，保持一致）
CREATE TRIGGER IF NOT EXISTS trg_para_after_update AFTER UPDATE OF text, chapter_id, deleted_at ON paragraphs
FOR EACH ROW
BEGIN
  DELETE FROM fts_paragraphs WHERE paragraph_id = NEW.id;
  INSERT INTO fts_paragraphs(paragraph_id, book_id, chapter_id, title, text)
  SELECT NEW.id, NEW.book_id, NEW.chapter_id,
         COALESCE(c.title, ''), NEW.text
  FROM chapters c WHERE c.id = NEW.chapter_id
  WHERE NEW.deleted_at IS NULL;
END;

-- 软删除 / 硬删除 → 从 FTS 移除
CREATE TRIGGER IF NOT EXISTS trg_para_after_delete AFTER DELETE ON paragraphs
FOR EACH ROW
BEGIN
  DELETE FROM fts_paragraphs WHERE paragraph_id = OLD.id;
END;
```

### 4.3 约定补充

- **软删除与 FTS**：段落软删除（`deleted_at` 非 NULL）时，应用层与 `trg_para_after_update` 均会从 FTS 移除，确保检索不返回已删段。
- **AI 字段位置**：`content_modern` / `content_explanation` 物化在 paragraphs（PRD §5.1 如此），避免阅读页多表 JOIN；AI 模块另维护 `ai_cache` 做版本/失效管理。IMP 在**重新解析/段级编辑时不得清空**这两列（见 §7.2 IMP-07）。
- **parse_hash 索引**：`idx_paragraphs_parse_hash` 以 `(chapter_id, parse_hash)` 为键，因重新解析映射在章内进行（见 §7.2）。

---

## 5. IPC 接口

遵循 `00-architecture.md` §4：channel 命名 `<module>:<action>`，本模块统一 `import:*`；`contextIsolation: true`，preload 暴露 `window.api.import.*`。长任务用 `webContents.send('import:progress', payload)` 推送进度。

### 5.1 Channel 清单

| Channel | 入参 | 返回 | 长 任务 | 错误码 | 说明 |
|---|---|---|---|---|---|
| `import:epub` | `{ filePath: string, options?: ParseOptions }` | `ImportResult` | 是 | `Parse*`, `Io*`, `Validation` | IMP-01/02，解析并入库；返回 bookId + 统计 |
| `import:reparse` | `{ bookId: string, options?: ParseOptions }` | `ImportResult` | 是 | `Parse*`, `Db*` | IMP-07，重新解析（保留稳定 ID） |
| `import:getBook` | `{ bookId: string }` | `Book \| null` | 否 | — | 取书与解析状态 |
| `import:getChapterTree` | `{ bookId: string }` | `ChapterNode[]` | 否 | — | 取章节树（含质量标记） |
| `import:getParagraphs` | `{ chapterId: string }` | `Paragraph[]` | 否 | — | 取章内段落（按 order） |
| `import:updateParagraph` | `{ paragraphId: string, patch: ParagraphPatch }` | `Paragraph` | 否 | `Validation`, `Db*` | IMP-03 改单段 |
| `import:mergeParagraphs` | `{ paragraphIds: string[] }` | `Paragraph` | 否 | `Validation`, `Db*` | IMP-03 合并多段为一段（保留首段 ID） |
| `import:splitParagraph` | `{ paragraphId: string, splitAt: number }` | `{ first: Paragraph, second: Paragraph }` | 否 | `Validation`, `Db*` | IMP-03 在字符偏移处拆分（首段保 ID，次段新生成） |
| `import:reorderParagraphs` | `{ chapterId: string, orderedIds: string[] }` | `void` | 否 | `Validation`, `Db*` | IMP-03 段落重排 |
| `import:deleteParagraph` | `{ paragraphId: string, soft?: boolean }` | `void` | 否 | `Db*` | IMP-03 删除段（默认软删） |
| `import:insertParagraph` | `{ chapterId: string, afterId: string \| null, text: string, blockType?: string }` | `Paragraph` | 否 | `Validation`, `Db*` | IMP-03 插入新段 |
| `import:cleanNoise` | `{ chapterId: string \| bookId: string, mode: NoiseCleanMode }` | `{ affected: number }` | 否 | `Db*` | IMP-05 批量清理噪声 |
| `import:updateChapter` | `{ chapterId: string, patch: ChapterPatch }` | `Chapter` | 否 | `Validation`, `Db*` | IMP-04 改标题/层级/质量 |
| `import:mergeChapters` | `{ chapterIds: string[] }` | `Chapter` | 否 | `Validation`, `Db*` | IMP-04 章合并 |
| `import:splitChapter` | `{ chapterId: string, atParagraphId: string, newTitle?: string }` | `{ first: Chapter, second: Chapter }` | 否 | `Validation`, `Db*` | IMP-04 章拆分 |
| `import:reorderChapters` | `{ parentId: string \| null, orderedIds: string[] }` | `void` | 否 | `Validation`, `Db*` | IMP-04 章重排 |
| `import:checkDuplicate` | `{ filePath: string }` | `{ duplicate: boolean, existingBookId?: string }` | 否 | `Io*` | IMP-08 去重预检（按 source_hash） |
| `import:progress` | （由主进程推送） | `ImportProgress` | — | — | 进度事件（见 5.3） |

### 5.2 关键 DTO 类型

```ts
// electron/models/import.ts（与渲染进程共享）

interface ParseOptions {
  splitMode?: 'block' | 'natural'; // 段落切分策略，默认 'natural'
  maxParagraphChars?: number;       // 超长段二次切分阈值，默认 500
  cleanNoise?: boolean;             // 导入时自动清理明显噪声，默认 true
  keepHtml?: boolean;               // 是否保留原始 HTML，默认 true
  t2s?: boolean;                    // 繁转简（IMP-05），默认 false
}

interface ImportResult {
  bookId: string;
  book: Book;
  stats: {
    chapters: number;
    paragraphs: number;
    noiseFlagged: number;   // 自动标记噪声数
    suspect: number;        // 质量存疑数
    durationMs: number;
  };
  warnings: QualityWarning[]; // IMP-06
}

interface ImportProgress {
  bookId: string;
  phase: 'extract' | 'parse_opf' | 'parse_toc' | 'split' | 'write_db' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

interface QualityWarning {
  level: 'suspect' | 'failed';
  scope: 'chapter' | 'paragraph';
  refId: string;   // chapter_id 或 paragraph_id
  reason: string;  // 如「正文为空」「TOC 缺失」「疑似全图章节」「编码异常」
}

type NoiseCleanMode =
  | 'header_footer'   // 页眉页脚
  | 'watermark'       // 水印
  | 'blank_lines'     // 多余空行
  | 'all';

interface ParagraphPatch {
  text?: string;
  html?: string;
  blockType?: string;
  isNoise?: boolean;
  // 注意：parse_hash 不接受外部 patch，仅由系统按内容重算
}
```

### 5.3 进度推送约定

长任务（`import:epub` / `import:reparse`）各阶段推送 `ImportProgress`：

```
extract(0..1) → parse_opf → parse_toc(0..N章) → split(0..N章) → write_db(0..N段) → done
```

主进程实现（`services/import/progress.ts`）封装一个 `ProgressEmitter`，持有 `webContents` 引用，节流推送（≥100ms 间隔或每章/每 50 段一次，避免淹没渲染进程）。渲染进程 `onProgress(cb)` 返回取消订阅函数（见架构 §4 示例）。

### 5.4 IPC 注册（薄层示例）

```ts
// electron/ipc/import.ts（薄层：校验 + 调 service + 序列化）
import { ipcMain, BrowserWindow } from 'electron';
import { importService } from '../services/import';
import { AppError } from '../lib/error';

export function registerImportIpc(getWin: () => BrowserWindow | null) {
  const emit = (p: ImportProgress) => getWin()?.webContents.send('import:progress', p);

  ipcMain.handle('import:epub', async (_e, { filePath, options }) => {
    if (!filePath || typeof filePath !== 'string') throw new AppError('Validation', 'filePath 缺失');
    return importService.parseEpub(filePath, options, emit); // emit 用于进度推送
  });

  ipcMain.handle('import:mergeParagraphs', async (_e, { paragraphIds }) => {
    if (!Array.isArray(paragraphIds) || paragraphIds.length < 2)
      throw new AppError('Validation', '至少选择两段');
    return importService.mergeParagraphs(paragraphIds);
  });
  // ...其余 channel 同构
}
```

---

## 6. 前端设计

### 6.1 组件树

```
ImportModule
├── ImportDropzone                 // IMP-01：拖拽/选择 .epub，触发 import:epub
│   └── (拖入前) checkDuplicate 预检 → 冲突弹窗（IMP-08）
├── ImportProgressDialog           // 监听 import:progress，分阶段进度条 + 取消
├── ReviewWorkbench                // IMP-03/04 校对主界面（PRD §10 双栏）
│   ├── LeftPane: EpubRawPreview   // 左：EPUB 原文预览 + 解析标记（高亮存疑段）
│   └── RightPane
│       ├── ChapterTreeEditor      // IMP-04：章节树（卷-品-篇），合并/拆分/重排/标题/层级
│       └── ParagraphEditor        // IMP-03：当前章段落列表
│           ├── ParagraphRow        // 单段：编辑/合并/拆分/删除/标记噪声
│           └── NoiseCleanPanel     // IMP-05 批量清理
└── QualityWarnings                // IMP-06：存疑/失败清单，点击定位
```

### 6.2 Zustand Store

```ts
// src/stores/import.ts
interface ImportStore {
  // 导入流程状态
  phase: 'idle' | 'importing' | 'review' | 'done' | 'error';
  progress: ImportProgress | null;
  activeBookId: string | null;

  // 校对工作台状态
  chapterTree: ChapterNode[];
  selectedChapterId: string | null;
  paragraphs: Paragraph[];           // 当前选中章的段落
  warnings: QualityWarning[];

  // 派生
  hasUnsavedEdits: boolean;

  // actions：均调 lib/ipc → window.api.import.*
  importEpub(file: File): Promise<void>;
  loadReview(bookId: string): Promise<void>;
  selectChapter(chapterId: string): Promise<void>;
  updateParagraph(id: string, patch: ParagraphPatch): Promise<void>;
  mergeParagraphs(ids: string[]): Promise<void>;
  splitParagraph(id: string, at: number): Promise<void>;
  // ...
}
```

### 6.3 关键交互与状态流转

- **导入去重（IMP-08）**：拖入文件 → 先 `checkDuplicate`（按 sha256）→ 命中则弹窗：「已存在《X》，覆盖 / 作为新副本 / 取消」。覆盖走软删旧书 + 新解析（保留旧 `book_id` 之外，所有下游引用按 §7.2 映射保留）。
- **段级编辑乐观更新**：`updateParagraph` 等操作先在 store 本地更新（即时反馈），主进程返回权威结果后回填；失败回滚并 toast。
- **质量提示（IMP-06）**：解析完成后 `QualityWarnings` 列出所有 `quality_flag != 'ok'` 的章/段；点击跳转并高亮。存疑段在 `ParagraphRow` 以 `--accent` 边框标记。
- **重排**：段落/章节重排用拖拽（dnd-kit），松手后调 `reorder*`，按 `order_index` 重算。
- **噪声标记**：`ParagraphRow` 可手动勾选「标记为噪声」→ `is_noise=1`；`NoiseCleanPanel` 提供按章/全书批量清理。

---

## 7. 核心流程

### 7.1 EPUB 解析流程（IMP-01 / IMP-02）

EPUB 本质是 ZIP 包，内含 XHTML 正文 + OPF（包描述，含 spine 阅读顺序）+ NCX（epub2 目录）/ Nav（epub3 目录）。解析分五步：

```
[1 读 ZIP] → [2 解 OPF(spine+manifest+metadata)] → [3 解 TOC(NCX/Nav)→章节树]
   → [4 按 spine 遍历 XHTML：合并 TOC + 正文 → 段落切分] → [5 事务写库 + FTS 同步]
```

**步骤 1：读 ZIP（`epub-reader.ts`，`node-stream-zip`）**

```ts
// 伪代码
const zip = new StreamZip.async({ file: epubPath });
// EPUB 入口：META-INF/container.xml → 指向 OPF 路径
const containerXml = await zip.entryDataString('META-INF/container.xml');
const opfPath = parseContainerXml(containerXml).rootfileFullPath; // 如 'OEBPS/content.opf'
const opfXml = await zip.entryDataString(opfPath);
// 后续按 manifest 内 href（相对 OPF 目录）读取 XHTML
```

> 用 `node-stream-zip` 而非 `unzipper`：同步随机访问条目、内存占用低（流式）、对损坏包容错好。XHTML 文本统一按 manifest 声明的 encoding（缺省 UTF-8）解码；若遇 GBK 旧包，按字节序检测回退（IMP-05 编码修复）。

**步骤 2：解 OPF（`opf-parser.ts`，`fast-xml-parser`）**

OPF 提供三要素：`metadata`（书名/作者/语言/封面图）、`manifest`（所有资源 id↔href 映射）、`spine`（线性阅读顺序，itemref idref 列表）。

```ts
interface ParsedOpf {
  metadata: { title: string; author: string; language: string; coverHref?: string };
  manifest: Map<idref, { href: string; mediaType: string; properties?: string }>;
  spine: { idref: string; linear: boolean }[]; // linear=false 通常是注脚/附录，可降权
}
// fast-xml-parser 配置：ignoreAttributes:false（取 href 等 attribute）、trimValues:true
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const opf = parser.parse(opfXml);
```

**步骤 3：解 TOC → 章节树（`toc-parser.ts` + `chapter-builder.ts`）**

EPUB 有两套目录体系，优先 Nav（epub3），回退 NCX（epub2）：

- **Nav（epub3）**：`nav.xhtml` 内 `<nav epub:type="toc">` 的 `<li><a href="...">` 嵌套 → 直接得到层级树。
- **NCX（epub2）**：`toc.ncx` 的 `<navPoint>` 嵌套（playOrder + src + title）→ 层级树。

若两者均缺失（劣质 EPUB），**降级**：以 spine 中每个 XHTML 为一章，标题取其首个 `<h1>`/`<title>`，并打 `quality_flag='suspect'`（IMP-06，reason='TOC 缺失，按 spine 推断章节'）。

```ts
interface ChapterNode {
  title: string;
  href: string;        // 如 'chap1.xhtml' 或 'chap1.xhtml#sec2'
  anchor?: string;     // '#sec2'
  level: number;       // 层级深度
  children: ChapterNode[];
}
// chapter-builder：将 TOC 树与 spine 对齐——
// TOC 节点的 href 指向某 spine item 的（含锚点）；按 spine 顺序展开，
// 同一 XHTML 内多个锚点 → 拆为多个同级章节（按 DOM 锚点切分正文）。
```

**步骤 4：段落切分（`paragraph-splitter.ts`，核心见 §7.1.1）**

对每个章节，取其对应 XHTML 片段（整篇或锚点之间），解析为段落列表。

**步骤 5：事务写库 + FTS 同步 + 进度（`index.ts`）**

```ts
const tx = db.transaction(() => {
  insertBook(book);
  for (const ch of chapters) insertChapter(ch);
  for (const p of paragraphs) {
    insertParagraph(p);
    insertFts(p, chTitle); // 应用层 FTS 同步（触发器兜底）
  }
});
tx(); // 原子提交
emit({ phase: 'done', ... });
```

#### 7.1.1 段落切分粒度（IMP-02，重点）

**策略：以 HTML 块级元素为边界、自然段为产出单元；超长段二次切分。**（对应 PRD 待决策 #2 的「自然段为主，长段可选按句细分」）

1. **块级元素识别**：用 `fast-xml-parser` 解析 XHTML body，遍历 DOM；下列块级标签各自形成一个或多个段落候选：
   - `<p>`、`<div>`（仅当含直接文本，纯容器 div 递归其子）、`<li>`（列表项逐条成段）、`<blockquote>`（整段，`block_type='blockquote'`）。
   - `<h1>~<h6>`：成段，`block_type='h*'`，记 `heading_level`（用于辅助识别卷-品-篇层级，反哺章节树）。
   - `<br>` 连续分隔的文本：按 `<br>` 断为多段（常见于劣质 EPUB 把自然段写成 `<br>` 换行）。
2. **文本提取**：抽 `textContent` 并 `trim`；全角空格、` `、连续空白归一为单空格（IMP-05 空格归一在此完成）。
3. **空段丢弃**：`text` 去空白后为空且非结构性（非标题/列表占位）→ 丢弃。
4. **超长段二次切分**：若 `text.length > maxParagraphChars`（默认 500，古文长段常见），按**句末标点**（。！？；及其全角形式）切分，尽量不切断句子；切出的子段继承 `block_type`，`order_index` 递增。对中医典籍此步很关键（《内经》大段论述需细分以便逐句解读对齐）。
5. **保留 HTML**：`html` 字段保留该段原始 XHTML 片段（IMP-02 要求保留结构信息），用于校对界面左侧原文预览与后续可能的样式还原。
6. **噪声预标记**：文本匹配噪声规则（见 §7.4）的段落，`is_noise=1` 并（若 `cleanNoise` 选项开）默认软删/隐藏。

```ts
interface RawBlock { html: string; text: string; blockType: string; headingLevel?: number; }

function splitParagraphs(xhtmlBody: string, opts: ParseOptions): Paragraph[] {
  const dom = xmlParser.parse(xhtmlBody);
  const rawBlocks = walkBlockElements(dom);        // 步骤 1-2
  const cleaned  = rawBlocks.filter(b => b.text.trim() !== ''); // 步骤 3
  const out: Paragraph[] = [];
  for (const b of cleaned) {
    const text = normalizeWhitespace(b.text);      // 空格归一
    if (text.length > (opts.maxParagraphChars ?? 500)) {
      out.push(...splitBySentence(text, b).map(makeParagraph)); // 步骤 4
    } else {
      out.push(makeParagraph(b, text));
    }
  }
  return out;
}
```

### 7.2 稳定 ID + parse_hash 与重新解析（IMP-07，重点）

这是段级编辑不破坏下游引用的核心机制。

#### 7.2.1 ID 与 hash 生成策略

- **paragraph.id / chapter.id / book.id**：UUID v4，应用层生成（`crypto.randomUUID()`），一旦生成永不变更。
- **parse_hash（段落内容指纹）**：对段落规范化文本做哈希，用于「内容相同即同一段」的判断。

```ts
// parse-hash.ts
function computeParseHash(text: string, chapterId: string): string {
  // 规范化：去首尾空白、统一全角/半角标点、折叠连续空白、统一换行
  const norm = normalizeForHash(text);
  // 纳入 chapterId 上下文：同名段在不同章不算同一段
  return sha256(`${chapterId}::${norm}`).slice(0, 16); // 16 字符足够碰撞免疫
}
```

> parse_hash 取 16 字符（64 bit），单本书段落量级（万级）碰撞概率可忽略；纳入 `chapterId` 是因为重新解析映射在章内进行，避免跨章误并。

#### 7.2.2 重新解析映射合并算法（IMP-07）

用户改了解析参数（如切分模式、清理规则）后重新解析。新解析产生「新结构」，但要把旧的段级编辑、AI 解读、笔记/卡片引用**迁移到新段**。算法：**按 parse_hash 在章内匹配；命中则复用旧 ID 与下游数据，未命中则新生成**。

```
输入：旧 paragraphs（含 id/parse_hash/edited/content_modern/...），新解析 paragraphs（无 id，有 text）
对每个新章 c_new（先按 chapter content_hash 或标题+层级匹配旧章 c_old）：
  旧段索引 = Map<parse_hash, paragraph> from c_old.paragraphs
  对每个新段 p_new:
    h = computeParseHash(p_new.text, c_new.id)
    若 旧段索引 含 h（内容未变）:
      复用旧 p_old.id → p_new.id = p_old.id
      保留 p_old 的 content_modern / content_explanation / edited（AI 解读与编辑不丢）
      从索引移除（避免一对多）
    否则（内容变化，如被切分/清理/编辑过）:
      p_new.id = newUUID()
      标记 quality_flag='suspect'（提示用户：此段为新增/变更，AI 解读需重生成）
  旧段索引 中剩余 = 旧有但新解析没有的段（被合并/删除）:
    保留为软删除（deleted_at），其下游笔记/卡片引用仍可定位历史段（不级联删）
```

**关键决策**：
- **内容未变 → 完全复用**：ID、AI 解读、edited 标记全保留，对用户透明。
- **内容变化 → 新 ID**：打 `quality_flag='suspect'`，提示重新生成 AI 解读；不强行猜测映射（避免错配把解读接到错段）。
- **被删旧段 → 软删保留**：笔记/卡片通过 `paragraph_id` 仍能查到历史段文本（`deleted_at IS NOT NULL` 但行存在），不致引用悬空。
- **章级匹配**：先按 `chapter.content_hash`（章正文聚合 hash）或 `(level, title)` 匹配新旧章；匹配不上的旧章整体软删保留。

```ts
// stable-id.ts（伪代码）
function mergeReparse(oldChapters, newChapters, oldParas): { chapters, paragraphs } {
  for (const cNew of newChapters) {
    const cOld = matchOldChapter(cNew, oldChapters); // content_hash 或 level+title
    if (!cOld) { assignNewIds(cNew); continue; }      // 全新章
    cNew.id = cOld.id;                                // 章复用
    const hashIdx = indexByHash(oldParas.byChapter(cOld.id)); // parse_hash → old para
    for (const pNew of cNew.paragraphs) {
      const h = computeParseHash(pNew.text, cNew.id);
      const pOld = hashIdx.get(h);
      if (pOld) {
        pNew.id = pOld.id;
        Object.assign(pNew, pick(pOld, ['content_modern','content_explanation','edited'])); // 保留 AI/编辑
        hashIdx.delete(h);
      } else {
        pNew.id = randomUUID();
        pNew.quality_flag = 'suspect'; // 变更段，提示重生成
      }
    }
    softDeleteRemaining(hashIdx); // 剩余旧段软删
  }
}
```

#### 7.2.3 段级编辑对 parse_hash 的影响

段级编辑（IMP-03）改 `text` 时：
- **edited 置 1**，`parse_hash` **按新内容重算**（内容变了，指纹应变）。
- 若该段已绑定 AI 解读（`content_modern` 非空）且文本变化超阈值（如编辑距离 > 20%），打 `quality_flag='suspect'`，提示「原文已修改，AI 解读可能过时，建议重新生成」。AI 解读字段**不清空**（保留旧解读供对照，用户决定是否重生成）。

### 7.3 段级编辑操作数据模型（IMP-03）

| 操作 | 实现要点 | parse_hash / ID 行为 |
|---|---|---|
| **改单段文本** | UPDATE text/html/block_type，edited=1 | parse_hash 重算；`content_modern` 保留 |
| **合并多段** | 取首段 ID 保留，text = 拼接各段（按顺序、加分隔空行），其余段软删 | 保留段 parse_hash 重算；被删段软删（下游引用仍可查历史） |
| **拆分一段** | 首段保 ID（text 取前半），次段 `newUUID()`（text 取后半），order_index 重排 | 两段 parse_hash 分别重算 |
| **重排** | 仅更新 order_index（按 orderedIds 批量 UPDATE），不改文本 | parse_hash 不变 |
| **删除段** | 软删（deleted_at=now），FTS 同步移除 | 行保留，引用不悬空 |
| **插入新段** | `newUUID()`，order_index 插入后续段 +1 | parse_hash 按文本计算 |
| **清理噪声** | 批量将匹配段 is_noise=1（或软删），FTS 同步 | 文本未变则 parse_hash 不变 |

> **合并/拆分/改文的 order_index 重算**：用「浮点化」或「重排整数」策略。首期简单做法：操作后对该章全部段落按当前顺序重排 `order_index`（0,1,2...），在单事务内完成。

### 7.4 原文清理与噪声识别（IMP-05 / IMP-03 噪声）

**噪声识别规则**（`text-cleaner.ts`，可配置、可扩展）：
- **页眉/页脚**：文本短（< 30 字）、重复出现 ≥3 次（跨章）、匹配 `第.{1,3}页`/书名/章节名模式。
- **水印**：匹配常见水印词（「试读」「扫描版」「仅供预览」「www.」「http://」）。
- **多余空行**：纯空白/仅标点的段（切分阶段已部分处理）。
- **编码异常**：含大量 `�`（替换符）或乱码密度高 → 打 `quality_flag='suspect'`。

**清理操作**：`import:cleanNoise` 按章/全书执行，匹配段 `is_noise=1`（默认）或软删（`mode` 含删除语义时）。自动清理在导入时按 `cleanNoise` 选项触发；手动清理在校对界面触发。

**IMP-05 文本归一**（导入时即做）：
- 断行拼接：句中换行（非句末标点后的换行）拼接为连续文本。
- 空格归一：全角空格、` `、连续空白 → 单 ASCII 空格。
- 繁简转换：`t2s` 选项开时调用 `opencc`（或等价库）繁→简，**保留原文副本**（`html` 或额外列）以便切回。
- 自动注音：古文可选，按拼音词典为生僻字加 `<ruby>` 注音（P1，依赖词典；本模块预留 `html` 注入点）。

---

## 8. 错误处理与边界

遵循 `00-architecture.md` §7：`AppError`（`code` + `message` + `details`）。

| 场景 | 错误码 | 处理 |
|---|---|---|
| 文件不存在/不可读 | `Io` | 友好提示，不中断 |
| 非 EPUB / 损坏 ZIP | `Parse` | 提示「文件格式无效或已损坏」 |
| OPF/NCX 缺失 | `Parse` | 降级按 spine 推断章节 + `quality_flag='suspect'`，不中断 |
| XHTML 解析失败（单章） | `Parse` | 跳过该章，记 `quality_flag='failed'` + reason，继续其余章（部分成功） |
| 编码异常（GBK/乱码） | `Parse` | 自动回退编码检测，仍异常则 `quality_flag='suspect'` |
| 章节正文为空 | `Validation` | 保留空章 + `quality_flag='suspect'`（reason='正文为空'） |
| 事务写库失败 | `Db` | 整书回滚，不产生半成品数据；提示重试 |
| 去重冲突（IMP-08） | — | 非错误，弹窗让用户选 覆盖/新副本/取消 |
| 大书超时 | `Parse` | 分批解析 + 进度推送；超阈值（如 > 5000 章）提示可能耗时，仍可继续 |

**降级原则**：解析永远**尽量产出部分结果**而非全失败——能解析的章正常入库，问题章/段打标记进入校对流程（IMP-06）。这契合 PRD「不保证 100% 准确，提供校对工具」的定位。

**边界条件**：
- 超大 EPUB（数百 MB）：`node-stream-zip` 流式读取，不一次性解压到内存/磁盘；逐条目按需读。
- 同 XHTML 多锚点章节：按 `<a id>`/`<section>` 锚点切分，避免整篇算一章。
- 无封面图：`cover` 留 NULL，UI 用默认封面。
- 嵌套层级过深（> 6 层）：`level` 封顶 6，超出扁平化到 6 并打 suspect。

---

## 9. 依赖关系

### 9.1 本模块依赖

| 依赖 | 用途 |
|---|---|
| `node-stream-zip` | EPUB ZIP 解包、流式读取条目 |
| `fast-xml-parser` | 解析 container.xml / OPF / NCX / Nav / XHTML |
| `better-sqlite3` | 写 books/chapters/paragraphs + FTS5（经 `db/` 单例） |
| Node `crypto` | `randomUUID()` + sha256（parse_hash / source_hash） |
| `opencc`（可选，P1） | 繁简转换（IMP-05） |

### 9.2 被依赖（下游消费本模块产出）

| 模块 | 消费内容 | 约定 |
|---|---|---|
| **LIB** | books/chapters/paragraphs 浏览、删除级联 | 删书依赖 `ON DELETE CASCADE` + 软删 |
| **RD** | paragraphs 渲染、段级进度/书签 | 依赖段稳定 ID 不变 |
| **NOTE** | notes 绑 `paragraph_id` | 依赖段级编辑后 ID 保留/软删可查 |
| **LRN** | cards 绑 `paragraph_id` | 同上 |
| **AI** | `content_modern`/`content_explanation`、ai_cache 绑段 | 依赖段 ID 稳定；重解析映射保留解读 |
| **SRH** | fts_paragraphs 查询 | 本模块负责写入同步 |

### 9.3 共享类型

`electron/models/import.ts` 导出 `Book / Chapter / Paragraph / ChapterNode / ImportResult / ImportProgress / ParseOptions / QualityWarning / ParagraphPatch / ChapterPatch` 等，主进程与渲染进程（经 `src/lib/types.ts` re-export）共享，避免重复定义。

---

## 10. 测试策略

遵循 `00-architecture.md` §9（Vitest）。

### 10.1 单元测试（`services/import/__tests__/`）

| 单元 | 测试点 |
|---|---|
| `opf-parser` | 正常 OPF、缺 metadata、缺 spine、linear=false 混合 |
| `toc-parser` | epub3 Nav、epub2 NCX、两者皆缺（降级）、深嵌套、空标题 |
| `chapter-builder` | TOC↔spine 对齐、同 XHTML 多锚点拆章、层级推断 |
| `paragraph-splitter` | `<p>`/`<div>`/`<li>`/`<blockquote>`/`<h*>` 切分、`<br>` 断段、空段丢弃、超长段按句切分（不切断句子）、保留 html |
| `text-cleaner` | 空格归一、断行拼接、页眉/水印/空行识别、GBK 编码回退 |
| `parse-hash` | 规范化稳定性（标点/空白差异同 hash）、跨章不同 hash、碰撞抽样 |
| `stable-id`（IMP-07） | 内容未变→复用 ID+AI 解读；内容变→新 ID+suspect；旧段软删保留；章级匹配 |
| `dedupe` | 同 sha256 命中、不同文件不误报 |

### 10.2 集成测试（`ipc/` mock + 内存 SQLite）

- 端到端：选夹具 EPUB → `import:epub` → 断言 books/chapters/paragraphs 行数 + FTS 命中。
- 段级编辑全操作：合并→拆分→重排→删除→插入，断言 order_index 单调、parse_hash 正确重算、FTS 同步。
- 重新解析：改 `splitMode` 重解析 → 断言未变段 ID 不变、AI 解读保留、变更段 suspect。
- 进度推送：mock `webContents.send`，断言各 phase 推送顺序与节流。

### 10.3 EPUB 测试夹具

准备回归夹具（放 `__tests__/fixtures/`），覆盖 PRD「不同 EPUB 制作质量差异」：
1. **标准 epub3**（Nav + 完整 spine）。
2. **标准 epub2**（NCX）。
3. **无 TOC 劣质包**（仅 spine，验降级 + suspect）。
4. **多层级中医典籍**（卷-品-篇-条目，验层级与长段切分，如模拟《神农本草经》结构）。
5. **带噪声包**（页眉/水印/空行，验清理）。
6. **GBK 旧编码包**（验编码回退）。
7. **损坏包**（截断 ZIP，验错误降级）。

回归指标：解析成功率 > 95%（PRD §12）。

---

## 11. 开放问题

1. **中文 FTS 分词**：首期 `unicode61`（按字）召回可接受但相关性一般；是否 Phase 2 切 `trigram` 或接入 `jieba` 预分词列？需 SRH 模块联合评估查询体验。本模块 DDL 已预留 tokenizer 可迁移性。
2. **parse_hash 是否纳入章节标题**：当前 hash 含 `chapterId` 防跨章误并；若用户大量重命名章节，重解析时章匹配靠 `(level,title)`，可能误判。是否引入更鲁棒的章匹配（如正文前 N 字 fingerprint）待压测。
3. **FTS contentless 外部内容表**：当前 DDL 为独立 FTS 表（正文双存，简单）。数据量增大后是否改 `content='paragraphs'` 外部内容模式省空间？需权衡迁移成本与万段落级存储开销（首期可双存）。
4. **段落保留原始 HTML 的体积**：`html` 列对劣质 EPUB 可能较大（全文级）。是否仅保留精简结构（块级标签 + 必要属性）而非原始片段？影响校对界面原文预览还原度。
5. **自动注音（IMP-05）的词典来源**：古文多音字注音需拼音词典，首期是否引入完整词典（增包体）还是按需 AI 生成（依赖联网）？P1 功能，可推迟决策。
6. **重新解析时 AI 解读的「变更阈值」**：当前用编辑距离 > 20% 判定需重生成，阈值是否合理需用户测试反馈。
