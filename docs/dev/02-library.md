# 书库管理 技术设计文档（02-library）

## 1. 概述

### 1.1 职责

书库管理模块（LIB）是用户进入应用的**第一入口**与**全局书目管理中枢**。职责包括：

- **书库浏览（LIB-01）**：以卡片网格展示所有已导入书籍，含封面/书名/作者/分类/阅读进度，支持分类筛选、排序与搜索。
- **章节目录树（LIB-02）**：选定一本书后，递归构建卷-章-节层级树，可展开/折叠，并显示各章节阅读进度。
- **元信息编辑（LIB-03）**：编辑书名/作者/封面/分类。
- **删除与清理（LIB-04）**：删除一本书，事务性级联清理其下所有章节、段落、阅读进度、笔记、双链、记忆卡、AI 缓存、FTS 索引行及原始 EPUB 文件。

### 1.2 边界

- LIB **不负责** EPUB 的导入与解析切分（属 IMP 模块，`01-import-parse.md`）。LIB 只消费 IMP 写入的 `books` / `chapters` / `paragraphs` 行。
- LIB **不负责** 段级校对编辑（IMP-03）、阅读交互（RD）、记忆卡调度（LRN）、全文检索执行（SRH）。删除时仅按外键/事务级联清理这些模块产生的数据行，不调用其业务逻辑。
- LIB **读取** `reading_progress` 表聚合进度，但进度的**写入**由 RD 模块负责。

### 1.3 与其它模块的关系

| 关系模块 | 交互 |
|---|---|
| IMP（导入解析） | IMP 写入 `books`/`chapters`/`paragraphs`，LIB 读取展示；IMP 的重新解析（IMP-07）按稳定 ID 更新行，LIB 视图自动反映 |
| RD（阅读） | RD 写 `reading_progress`、`bookmarks`，LIB 读取聚合为卡片/章节进度；LIB 提供书/章定位供 RD 打开 |
| NOTE（笔记） | 删除书时级联清理 `notes`/`note_links` |
| LRN（学习） | 删除书时级联清理 `cards`/`review_log` |
| AI（AI 工具） | 删除书时级联清理 `ai_cache` |
| SRH（检索） | 删除书时级联清理 `fts_paragraphs` 中相关行 |
| SET（设置数据） | 封面/EPUB 文件路径解析依赖 SET 约定的 `local://` 协议与 userData 目录 |

---

## 2. 相关需求

| 编号 | 功能 | 优先级 | 验收标准（摘自 PRD §3.3） |
|---|---|---|---|
| LIB-01 | 书库浏览 | P0 | 卡片网格：封面/书名/作者/阅读进度；支持分类、排序、搜索 |
| LIB-02 | 章节目录树 | P0 | 树形展示卷-章-节，可展开/折叠，显示各章阅读进度 |
| LIB-03 | 元信息编辑 | P1 | 书名/作者/封面/分类可编辑 |
| LIB-04 | 删除与清理 | P0 | 删除书籍同时清理其章节、段落、进度、笔记、AI 资源 |

补充非功能约束（PRD §4）：章节/段落打开 ≤ 200ms（NFR-P2）；稳态内存 ≤ 400MB（NFR-P5）——决定书库浏览需做进度缓存而非每次重算。

---

## 3. 目录与文件结构

```
electron/
├── db/
│   ├── schema/02-library.sql        # books 表 DDL（与 IMP 共享，LIB 关注的索引/视图在此声明）
│   └── migrations/                  # 版本化迁移（books 字段变更走此）
├── services/
│   └── library.ts                   # 业务逻辑：列表查询、树构建、元信息更新、级联删除
├── ipc/
│   └── library.ts                   # ipcMain.handle('library:*') 薄层注册
└── models/
    └── library.ts                   # DTO 类型：BookCardDTO、ChapterNodeDTO 等

src/
├── modules/
│   └── library/
│       ├── BookGrid.tsx             # 卡片网格容器（LIB-01）
│       ├── BookCard.tsx             # 单本书卡片
│       ├── BookToolbar.tsx          # 分类筛选/排序/搜索工具条
│       ├── ChapterTree.tsx          # 章节目录树（LIB-02）
│       ├── ChapterTreeNode.tsx      # 递归树节点（展开/折叠/进度）
│       ├── BookMetaEditor.tsx       # 元信息编辑弹窗（LIB-03）
│       └── DeleteBookDialog.tsx     # 删除确认弹窗（LIB-04）
├── stores/
│   └── library.ts                   # Zustand store：书库列表、筛选/排序态、当前书树
└── lib/
    ├── ipc.ts                       # window.api.library.* 类型化封装
    └── types.ts                     # 与主进程共享的 DTO 类型
```

---

## 4. 数据模型

### 4.1 books 表（与 IMP 共享，LIB 关注读取与元信息更新）

`books` 表由 IMP 模块在导入时创建并写入来源/解析信息，LIB 模块负责日常读取与元信息字段更新。此处给出完整 DDL（IMP 文档应与之保持一致；以本文档为权威定义）。

```sql
-- books：书籍元信息与来源文件
CREATE TABLE IF NOT EXISTS books (
  book_id        TEXT    PRIMARY KEY,                 -- UUID v4，应用层生成，稳定 ID
  title          TEXT    NOT NULL,                    -- 书名（可编辑，LIB-03）
  author         TEXT    DEFAULT '',                  -- 作者/辑者（可编辑）
  source_format  TEXT    NOT NULL DEFAULT 'epub',     -- 来源格式：'epub'（首期唯一）
  source_file    TEXT    NOT NULL,                    -- 原始文件相对路径，如 'files/shennong.epub'
  cover          TEXT    DEFAULT '',                  -- 封面相对路径，如 'covers/<book_id>.png'；空则用占位图
  category       TEXT    DEFAULT '',                  -- 用户分类，如 '本草'/'内经'/'方剂'（可编辑）
  imported_at    INTEGER NOT NULL DEFAULT 0,          -- 导入时间 unix ms
  updated_at     INTEGER NOT NULL DEFAULT 0,          -- 元信息最后更新时间 unix ms
  parse_version  INTEGER NOT NULL DEFAULT 1,          -- 解析版本（IMP 重新解析自增）
  deleted_at     INTEGER NULL                         -- 软删除标记（LIB-04 默认走物理删除，保留字段供"回收站"演进）
);

-- 分类筛选索引（LIB-01 分类过滤）
CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
-- 导入时间排序索引（LIB-01 默认按最近导入排序）
CREATE INDEX IF NOT EXISTS idx_books_imported_at ON books(imported_at DESC);
```

**字段说明（LIB 视角）**：

| 字段 | LIB 用途 | 可编辑（LIB-03） |
|---|---|---|
| `title` | 卡片/树根标题 | 是 |
| `author` | 卡片副标题 | 是 |
| `cover` | 卡片封面图来源 | 是（用户可替换） |
| `category` | 分类筛选维度 | 是 |
| `source_file` | 删除时定位并清理原始 EPUB 文件 | 否（IMP 写入） |
| `imported_at` / `updated_at` | 排序、编辑标识 | 否（系统维护） |

**封面来源策略**：

1. **首选**：导入时 IMP 从 EPUB metadata（`opf/meta` 的 `cover` / `meta name="cover"`）提取封面图，存为 `covers/<book_id>.png`（统一转 PNG，缩放至 ≤ 400×600），`books.cover` 存相对路径。
2. **用户替换（LIB-03）**：用户可在元信息编辑中选择本地图片，主进程复制到 `covers/<book_id>.<ext>` 并更新 `cover` 字段。
3. **占位**：`cover` 为空时，前端用基于 `title` 首字 + 古墨色背景生成的纯前端占位图（canvas，无 IO）。
4. **协议**：路径统一用相对 `userData` 目录的相对路径；前端经 IPC 解析为 `file://` 绝对路径或由主进程返回 base64 缩略图（见 §5 `library:getCover`）。

### 4.2 chapters 表（IMP 写入，LIB 读取构建树）

完整 DDL 归属 IMP 文档，此处列出 LIB 构建树所依赖的字段与索引。

```sql
CREATE TABLE IF NOT EXISTS chapters (
  chapter_id   TEXT    PRIMARY KEY,                  -- UUID v4，稳定 ID
  book_id      TEXT    NOT NULL,
  parent_id    TEXT    NULL,                         -- 自引用父章节；根章节为 NULL
  order_index  INTEGER NOT NULL DEFAULT 0,           -- 同级排序
  level        TEXT    DEFAULT '',                   -- 层级标签：'卷'/'品'/'篇'（展示用）
  title        TEXT    NOT NULL,
  FOREIGN KEY (book_id)   REFERENCES books(book_id)     ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES chapters(chapter_id) ON DELETE CASCADE
);

-- 章节目录树构建核心索引：按书取全部章节 + 父子组装
CREATE INDEX IF NOT EXISTS idx_chapters_book    ON chapters(book_id, order_index);
CREATE INDEX IF NOT EXISTS idx_chapters_parent  ON chapters(parent_id);
```

### 4.3 进度聚合相关表（reading_progress，RD 写入，LIB 只读）

```sql
CREATE TABLE IF NOT EXISTS reading_progress (
  book_id           TEXT    NOT NULL,
  chapter_id        TEXT    NOT NULL,
  paragraph_id      TEXT    NOT NULL,                -- 精确到段（PRD RD-08）
  last_read_at      INTEGER NOT NULL DEFAULT 0,
  read_count        INTEGER NOT NULL DEFAULT 0,      -- 该段累计阅读次数
  PRIMARY KEY (book_id, paragraph_id),
  FOREIGN KEY (book_id)      REFERENCES books(book_id)        ON DELETE CASCADE,
  FOREIGN KEY (chapter_id)   REFERENCES chapters(chapter_id)  ON DELETE CASCADE
);

-- 按章/书聚合进度用索引
CREATE INDEX IF NOT EXISTS idx_rp_book    ON reading_progress(book_id);
CREATE INDEX IF NOT EXISTS idx_rp_chapter ON reading_progress(chapter_id);
```

### 4.4 进度聚合视图（避免每次 JOIN 重算）

为 LIB-01 卡片进度与 LIB-02 章节进度提供预聚合。用 SQLite 视图封装；章节段落总数来自 `paragraphs` 表（IMP 写入）。

```sql
-- 书级进度：已读段数 / 总段数
CREATE VIEW IF NOT EXISTS v_book_progress AS
SELECT
  b.book_id,
  COUNT(p.paragraph_id)                                 AS total_paragraphs,
  COUNT(rp.paragraph_id)                                AS read_paragraphs,
  CASE WHEN COUNT(p.paragraph_id) = 0 THEN 0
       ELSE CAST(COUNT(rp.paragraph_id) AS REAL) / COUNT(p.paragraph_id)
  END                                                   AS progress,
  MAX(rp.last_read_at)                                  AS last_read_at
FROM books b
LEFT JOIN paragraphs        p  ON p.book_id    = b.book_id
LEFT JOIN reading_progress rp ON rp.paragraph_id = p.paragraph_id AND rp.book_id = b.book_id
GROUP BY b.book_id;

-- 章级进度：每章已读段数 / 总段数
CREATE VIEW IF NOT EXISTS v_chapter_progress AS
SELECT
  c.chapter_id,
  c.book_id,
  COUNT(p.paragraph_id)                                 AS total_paragraphs,
  COUNT(rp.paragraph_id)                                AS read_paragraphs,
  CASE WHEN COUNT(p.paragraph_id) = 0 THEN 0
       ELSE CAST(COUNT(rp.paragraph_id) AS REAL) / COUNT(p.paragraph_id)
  END                                                   AS progress,
  MAX(rp.last_read_at)                                  AS last_read_at
FROM chapters c
LEFT JOIN paragraphs        p  ON p.chapter_id   = c.chapter_id
LEFT JOIN reading_progress rp ON rp.paragraph_id = p.paragraph_id
GROUP BY c.chapter_id;
```

> **性能说明**：万段落级下，上述视图 GROUP BY 在 `paragraphs.chapter_id` / `reading_progress.paragraph_id`（主键前缀）有索引时为索引扫描，单书聚合 < 10ms。若书目增长到数十本且卡片网格需一次性展示全部进度，引入应用层缓存（见 §6.3），避免首屏 N 次视图查询。

---

## 5. IPC 接口

所有 channel 统一前缀 `library:`。入参/返回为可序列化 DTO；错误为结构化 `AppError { code, message, details? }`。无长任务（删除为本地同步事务，百毫秒级，直接 await 返回，不需要 `webContents.send` 进度）。

| Channel | 入参 | 返回 | 说明 | 错误码 |
|---|---|---|---|---|
| `library:list` | `{ category?: string; sort?: 'imported_at' \| 'title' \| 'last_read'; search?: string }` | `BookCardDTO[]` | 卡片网格数据（含进度聚合） | `Db` |
| `library:getCategories` | — | `string[]` | 全部已用分类（去重，用于筛选下拉） | `Db` |
| `library:getCover` | `{ bookId: string }` | `{ url: string } \| null` | 解析封面为可加载的 `file://` URL；无封面返回 null（前端用占位） | `Io`, `NotFound` |
| `library:getChapterTree` | `{ bookId: string }` | `ChapterNodeDTO[]` | 章节目录树（已组装为树结构 + 各章进度） | `Db`, `NotFound` |
| `library:updateMeta` | `{ bookId: string; patch: BookMetaPatch }` | `BookCardDTO` | 元信息更新（LIB-03）；仅允许字段：title/author/cover/category | `Validation`, `Db`, `NotFound` |
| `library:replaceCover` | `{ bookId: string; srcFilePath: string }` | `{ cover: string }` | 复制用户选择的图片到 `covers/`，更新 cover 字段并返回新相对路径 | `Io`, `NotFound` |
| `library:deleteBook` | `{ bookId: string; deleteSourceFile?: boolean }` | `{ ok: true; removedRows: number }` | 删除书籍及级联清理（LIB-04）；`deleteSourceFile` 控制是否同时删除原始 EPUB 文件 | `Db`, `Io`, `NotFound` |

### 5.1 DTO 类型（`electron/models/library.ts`，与 `src/lib/types.ts` 共享）

```ts
export interface BookCardDTO {
  bookId: string;
  title: string;
  author: string;
  category: string;
  cover: string;                 // 相对路径，空则前端占位
  importedAt: number;
  updatedAt: number;
  progress: number;              // 0..1，来自 v_book_progress
  totalParagraphs: number;
  readParagraphs: number;
  lastReadAt: number;            // 0 表示从未阅读
  chapterCount: number;
}

export interface BookMetaPatch {
  title?: string;
  author?: string;
  category?: string;
  cover?: string;                // 一般经 replaceCover 后传入新相对路径
}

export interface ChapterNodeDTO {
  chapterId: string;
  parentId: string | null;
  orderIndex: number;
  level: string;
  title: string;
  progress: number;              // 0..1，来自 v_chapter_progress
  totalParagraphs: number;
  readParagraphs: number;
  children: ChapterNodeDTO[];    // 已递归组装
}

export interface ListParams {
  category?: string;
  sort?: 'imported_at' | 'title' | 'last_read';
  search?: string;
}
```

### 5.2 preload 暴露（`electron/preload/index.ts` 片段）

```ts
contextBridge.exposeInMainWorld('api', {
  library: {
    list:            (p: ListParams)        => ipcRenderer.invoke('library:list', p),
    getCategories:   ()                     => ipcRenderer.invoke('library:getCategories'),
    getCover:        (bookId: string)       => ipcRenderer.invoke('library:getCover', { bookId }),
    getChapterTree:  (bookId: string)       => ipcRenderer.invoke('library:getChapterTree', { bookId }),
    updateMeta:      (bookId: string, patch: BookMetaPatch) =>
                         ipcRenderer.invoke('library:updateMeta', { bookId, patch }),
    replaceCover:    (bookId: string, srcFilePath: string) =>
                         ipcRenderer.invoke('library:replaceCover', { bookId, srcFilePath }),
    deleteBook:      (bookId: string, deleteSourceFile = true) =>
                         ipcRenderer.invoke('library:deleteBook', { bookId, deleteSourceFile }),
  },
  // ...其它模块
});
```

---

## 6. 前端设计

### 6.1 组件树

```
<BookGrid>                              // LIB-01 容器，挂载时拉 list
├── <BookToolbar>                       // 分类下拉 + 排序切换 + 搜索输入
│   ├── Select（category）              // shadcn/ui Select，选项来自 getCategories
│   ├── ToggleGroup（sort）             // imported_at / title / last_read
│   └── Input（search）                 // 实时筛选（debounce 200ms）
└── <CardGrid>                          // CSS Grid，响应式列数（minmax(220px, 1fr)）
    └── map → <BookCard>
        ├── 封面（<img> via getCover，空则占位 canvas）
        ├── 书名 / 作者 / 分类标签
        ├── <ProgressRing progress={progress} />     // 环形进度，来自 DTO
        └── Actions（编辑元信息 / 删除 / 打开）

<BookMetaEditor>                        // LIB-03，Dialog 弹窗
├── Input（title / author / category）
└── 封面选择（触发 replaceCover）+ 预览

<DeleteBookDialog>                      // LIB-04，AlertDialog 二次确认
└── 确认 → deleteBook(bookId, deleteSourceFile)

<ChapterTree>                           // LIB-02，选定书后侧栏或独立页
└── 递归渲染 <ChapterTreeNode>
    ├── 折叠箭头（有 children 时）+ 标题 + level 徽标
    ├── <ProgressBar progress={progress} />           // 章级进度
    └── children?.map → <ChapterTreeNode>（递归）
```

### 6.2 Store 结构（`src/stores/library.ts`，Zustand）

```ts
interface LibraryStore {
  // 数据
  books: BookCardDTO[];
  categories: string[];
  chapterTree: ChapterNodeDTO[];        // 当前展开树的章节
  currentBookId: string | null;

  // UI 态
  loading: boolean;
  error: AppError | null;
  filter: { category: string; sort: 'imported_at' | 'title' | 'last_read'; search: string };
  expandedChapterIds: Set<string>;      // 章节树展开态（持久化到内存即可）

  // 动作
  load: () => Promise<void>;
  setFilter: (patch: Partial<LibraryStore['filter']>) => void;
  openBook: (bookId: string) => Promise<void>;          // 拉 chapterTree
  saveMeta: (bookId: string, patch: BookMetaPatch) => Promise<void>;
  removeBook: (bookId: string, deleteSourceFile?: boolean) => Promise<void>;
  toggleChapter: (chapterId: string) => void;
}
```

**状态流转**：

1. **首屏**：`load()` 调 `library:list`，填 `books` + `categories`；筛选/排序/搜索变更（debounce）后重调 `list`。
2. **打开书**：`openBook(bookId)` 调 `library:getChapterTree`，填 `chapterTree` + `currentBookId`；跳转 RD 模块由 session store 接管。
3. **编辑元信息**：`saveMeta` 调 `updateMeta`，成功后局部更新 `books` 中对应行（无需全量重拉）。
4. **删除**：`removeBook` 调 `deleteBook`，成功后从 `books` 移除该行；若 `currentBookId === bookId` 则清空 `chapterTree` 并回到网格。
5. **进度刷新**：从 RD 返回书库时，`load()` 重拉以反映最新进度（进度由 RD 写 `reading_progress`，LIB 不直接写）。

### 6.3 性能考量：进度缓存

- **卡片网格**：`library:list` 已在主进程通过 `v_book_progress` 视图一次聚合所有书的进度，前端无 N+1 查询。
- **章节树**：`library:getChapterTree` 一次性返回整棵树（含章级进度），典型中医典籍章节量 < 500，序列化体积 < 100KB，单次 IPC 即可。
- **封面懒加载**：`<BookCard>` 用 `IntersectionObserver` 懒加载可见卡片的封面（`getCover`），避免一次性打开数十个 `file://` 图片句柄。
- **超大规模演进**：若单库书目 > 数百本，`list` 改为分页 + 虚拟滚动（如 `@tanstack/react-virtual`）；当前 MVP 不需要。

---

## 7. 核心流程

### 7.1 书库浏览查询（LIB-01）

```
[BookGrid 挂载]
   └─ load() ──IPC──▶ library:list { category, sort, search }
                         │
        主进程 services/library.ts:
          SELECT b.*, COALESCE(v.progress,0), COALESCE(v.read_paragraphs,0), ...
          FROM books b
          LEFT JOIN v_book_progress v ON v.book_id = b.book_id
          WHERE (? IS NULL OR b.category = ?)          -- 分类
            AND (? = '' OR b.title LIKE '%' || ? || '%' OR b.author LIKE '%' || ? || '%')  -- 搜索
            AND b.deleted_at IS NULL
          ORDER BY <sort 映射>                          -- imported_at DESC / title ASC / last_read DESC
                         │
   ◀── BookCardDTO[] ──── 填 books store
```

`sort` 为 `last_read` 时 ORDER BY 用 `COALESCE(v.last_read_at, 0) DESC`。

### 7.2 章节目录树构建（LIB-02）

**算法选择：应用层组装（一次查询 + 内存建树），不使用递归 CTE。**

理由：
- 单书章节数 < 500，扁平结果集一次读入内存后 O(n) 组装，常数小、实现简单。
- 递归 CTE 在 SQLite 中每次查询重新计算，且无法方便地与章级进度视图 JOIN 后再递归；应用层组装可一次 SQL 同时取章节行与进度。
- 展开态在前端 `expandedChapterIds` 维护，无需服务端参与。

**主进程实现（`services/library.ts`）**：

```ts
function buildChapterTree(bookId: string): ChapterNodeDTO[] {
  // 一次查询：章节行 + 章级进度（LEFT JOIN v_chapter_progress）
  const rows = db.prepare(`
    SELECT c.chapter_id, c.parent_id, c.order_index, c.level, c.title,
           COALESCE(v.progress, 0)         AS progress,
           COALESCE(v.total_paragraphs, 0) AS total_paragraphs,
           COALESCE(v.read_paragraphs, 0)  AS read_paragraphs
    FROM chapters c
    LEFT JOIN v_chapter_progress v ON v.chapter_id = c.chapter_id
    WHERE c.book_id = ?
    ORDER BY c.order_index
  `).all(bookId);

  // O(n) 建树：map[id] -> node，再挂 children
  const map = new Map<string, ChapterNodeDTO>();
  const roots: ChapterNodeDTO[] = [];
  for (const r of rows) {
    map.set(r.chapter_id, { ...r, children: [] });
  }
  for (const r of rows) {
    const node = map.get(r.chapter_id)!;
    if (r.parent_id && map.has(r.parent_id)) {
      map.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
```

**性能**：SQL 走 `idx_chapters_book`（覆盖 book_id + order_index），单书查询 < 5ms；建树 O(n)。整棵树（含进度）经一次 IPC 返回。

**展开/折叠**：前端纯 UI 态，切换 `expandedChapterIds`，不重新请求。节点默认折叠根节点下一层展开。

### 7.3 元信息编辑（LIB-03）

```
[BookMetaEditor 提交]
   └─ saveMeta(bookId, patch) ──IPC──▶ library:updateMeta
                                         │
        主进程:
          1. 校验 patch：title 非空、长度 ≤ 200；author/category 长度 ≤ 100
          2. UPDATE books SET title=?, author=?, category=?, updated_at=?
             WHERE book_id=? AND deleted_at IS NULL
          3. 返回更新后的 BookCardDTO（重查视图）
                                         │
   ◀── BookCardDTO ──── 局部更新 books store 对应行
```

封面替换单独走 `library:replaceCover`：

```
library:replaceCover(bookId, srcFilePath):
  1. 校验 srcFilePath 存在、扩展名为 png/jpg/jpeg/webp
  2. 复制到 <userData>/covers/<book_id>.<ext>（覆盖旧封面）
  3. UPDATE books SET cover='covers/<book_id>.<ext>', updated_at=? WHERE book_id=?
  4. 返回 { cover }（前端再调 updateMeta 或直接刷新该卡片封面 URL）
```

### 7.4 删除与级联清理（LIB-04）

**级联策略：外键 `ON DELETE CASCADE` 为主，应用层事务兜底无外键的表与文件系统副作用。**

books 下的 chapters、paragraphs、reading_progress、bookmarks 已在各自 DDL 声明 `FOREIGN KEY ... ON DELETE CASCADE`（通过 `book_id` 或经 `chapter_id`→`book_id` 级联）。删除一本书时，从 `books` 删一行即可让 SQLite 自动级联删除这些表的关联行。

但以下表**没有直接的 `book_id` 外键**或属外部资源，需在应用层事务中显式清理：

| 清理对象 | 清理方式 | 原因 |
|---|---|---|
| `notes`（笔记绑段） | 经 `paragraph_id` 关联，`notes` 表对 `paragraph_id` 设 `ON DELETE CASCADE`（NOTE 模块 DDL 保证），随 paragraphs 级联删除 | 依赖 NOTE 模块外键声明 |
| `note_links`（双链） | 对 `source_note_id` / `target_note_id` 级联，随 notes 删除；**额外**需清理指向被删笔记的反向链接行 | 防止悬空反向链接 |
| `cards`（记忆卡） | 绑 `paragraph_id`，对 `paragraph_id` `ON DELETE CASCADE`，随 paragraphs 删除 | 依赖 LRN 模块外键声明 |
| `review_log` | 绑 `card_id`，`ON DELETE CASCADE` 随 cards 删除 | 依赖 LRN 模块外键声明 |
| `ai_cache` | 绑 `paragraph_id`，`ON DELETE CASCADE` 随 paragraphs 删除 | 依赖 AI 模块外键声明 |
| `fts_paragraphs`（FTS5 虚拟表） | FTS5 无传统外键；**必须应用层显式 DELETE** | FTS5 表是外部内容表或独立表，CASCADE 不生效 |
| `assets/` AI 资源文件 | 应用层按 `ai_cache` 中记录的文件路径删除 | DB 外的文件系统副作用 |
| `files/<source_file>`（原始 EPUB） | 应用层删除（`deleteSourceFile=true` 时） | DB 外的文件系统副作用 |
| `covers/<cover>`（封面图） | 应用层删除 | DB 外的文件系统副作用 |

> **关键约束**：SQLite 默认**不启用**外键检查，必须在每次连接后执行 `PRAGMA foreign_keys = ON;`（在 `db/` 连接初始化时全局设置）。否则所有 `ON DELETE CASCADE` 静默失效，导致级联删除不生效、产生孤儿数据。这是本模块正确性的硬前提。

**主进程实现（`services/library.ts`，单事务）**：

```ts
function deleteBook(bookId: string, deleteSourceFile: boolean): { removedRows: number } {
  // 1. 先取出文件系统副作用所需信息（事务前或事务内均可，这里事务内读）
  const book = db.prepare(
    'SELECT source_file, cover FROM books WHERE book_id = ?'
  ).get(bookId) as { source_file: string; cover: string } | undefined;
  if (!book) throw new AppError('NotFound', `book ${bookId} not found`);

  // 2. 收集需删除的 AI 资源文件路径（fts 与 ai_cache 行随事务删）
  const aiAssetPaths = db.prepare(`
    SELECT DISTINCT file_path FROM ai_cache a
    JOIN paragraphs p ON p.paragraph_id = a.paragraph_id
    WHERE p.book_id = ?
  `).all(bookId).map(r => r.file_path).filter(Boolean);

  const tx = db.transaction(() => {
    // 3a. 清理 note_links 反向链接（指向即将被删 notes 的行）
    db.prepare(`
      DELETE FROM note_links
      WHERE target_note_id IN (
        SELECT n.note_id FROM notes n
        JOIN paragraphs p ON p.paragraph_id = n.paragraph_id
        WHERE p.book_id = ?
      )
    `).run(bookId);

    // 3b. 显式清理 FTS5（无外键 CASCADE）
    db.prepare(`
      DELETE FROM fts_paragraphs
      WHERE paragraph_id IN (
        SELECT paragraph_id FROM paragraphs WHERE book_id = ?
      )
    `).run(bookId);

    // 3c. 删 books 行 —— 外键 ON DELETE CASCADE 自动级联：
    //     chapters -> paragraphs -> reading_progress/bookmarks
    //     paragraphs -> notes(经 paragraph_id) -> note_links(经 source_note_id)
    //     paragraphs -> cards -> review_log
    //     paragraphs -> ai_cache
    const info = db.prepare('DELETE FROM books WHERE book_id = ?').run(bookId);
    return info.changes;   // 删除 books 行数（1）
  });

  const removedRows = tx();

  // 4. 文件系统副作用（事务外执行，DB 已提交成功）
  //    失败不回滚 DB（数据已清），仅记录日志，避免文件锁/权限问题阻塞删除
  const userData = app.getPath('userData');
  const safeUnlink = (rel: string) => {
    try {
      const abs = path.resolve(userData, rel);
      // 路径白名单校验，防止路径穿越
      if (abs.startsWith(userData)) fs.unlinkSync(abs);
    } catch (e) { log.warn('library:deleteBook unlink failed', rel, e); }
  };
  if (deleteSourceFile && book.source_file) safeUnlink(book.source_file);
  if (book.cover) safeUnlink(book.cover);
  for (const p of aiAssetPaths) safeUnlink(p);

  return { removedRows };
}
```

**事务原子性**：步骤 3a–3c 在单个 `db.transaction()` 中，要么全成要么全败（better-sqlite3 同步事务）。文件系统操作（步骤 4）在事务外：DB 已提交后清理文件，即使个别文件删除失败（被占用/权限），也不阻塞用户操作，仅记日志；SET-04 的"清理孤立资源"可后续补偿。

**安全要点**：
- `PRAGMA foreign_keys = ON` 必须在连接初始化时开启（`db/index.ts`）。
- 文件删除做路径白名单校验（`abs.startsWith(userData)`），防路径穿越攻击。
- 删除前二次确认由前端 `DeleteBookDialog` 完成，主进程不重复弹窗。
- `deleteSourceFile` 默认 `true`（PRD 要求清理原始 EPUB）；SET-04"查看原始文件"场景可传 `false` 仅删数据保留文件。

---

## 8. 错误处理与边界

| 场景 | 处理 |
|---|---|
| `list`/`getChapterTree` 查询无数据 | 返回空数组，前端显示空态（"尚未导入书籍，去导入" / "本书无章节"） |
| `bookId` 不存在（已删或非法） | 抛 `AppError('NotFound')`，前端 toast "书籍不存在或已被删除" |
| `updateMeta` 字段校验失败（空标题/超长） | 抛 `AppError('Validation', details)`，前端在表单项内联报错，不发 IPC |
| `replaceCover` 源文件不存在/格式不支持 | 抛 `AppError('Io'/'Validation')`，前端提示"请选择 png/jpg/webp 图片" |
| `deleteBook` 外键未启用（PRAGMA 漏配） | 级联失效 → 孤儿数据。**预防**：连接初始化强制 `PRAGMA foreign_keys = ON` 并加自检断言 |
| `deleteBook` 文件删除失败（占用/权限） | DB 已提交，文件清理失败仅 `log.warn`，不回滚、不抛错；纳入 SET-04 孤立资源清理 |
| 封面文件丢失（手动删除 userData 下文件） | `getCover` 检测文件不存在返回 `null`，前端降级为占位图 |
| 删除当前正打开的书 | 前端 `removeBook` 成功后清空 `chapterTree`/`currentBookId` 并回网格；若 RD 正在阅读该书，session store 监听 `books` 变化做退出处理 |
| 并发删除同一本书 | 第二次 `DELETE` 影响 0 行，`removedRows=0`，前端据此判断"已被删除" |

**降级**：LIB 是纯本地模块（无 AI/网络依赖），除 DB 损坏外无外部失败点。DB 损坏属全局故障，由 SET 备份恢复机制兜底，不在本模块处理。

---

## 9. 依赖关系

### 9.1 依赖（本模块依赖）

| 依赖项 | 说明 |
|---|---|
| `better-sqlite3` 连接（`electron/db`） | 同步执行查询/事务；依赖 `PRAGMA foreign_keys = ON` |
| `books` / `chapters` / `paragraphs` 表 | 由 IMP 模块写入，DDL 字段契约见 §4 |
| `reading_progress` 表 | 由 RD 模块写入，LIB 只读聚合 |
| 外键 CASCADE 声明 | notes/note_links/cards/review_log/ai_cache/bookmarks 各自模块 DDL 须对 `paragraph_id`/`chapter_id`/`book_id`/`card_id`/`note_id` 声明 `ON DELETE CASCADE` |
| 共享类型 DTO | `electron/models/library.ts` ↔ `src/lib/types.ts` |
| Electron `app.getPath('userData')` | 解析 `files/`、`covers/`、`assets/` 相对路径 |

### 9.2 被依赖（其它模块依赖本模块）

| 被依赖模块 | 依赖点 |
|---|---|
| RD（阅读） | 从 LIB 的书/章选择进入阅读；LIB 提供 `bookId`/`chapterId` |
| session store | `currentBookId` 由 LIB 设置，RD/LRN/AI 读取上下文 |
| SET（设置数据） | SET-04"清理孤立资源"复用 LIB 的文件清理逻辑（`safeUnlink` 抽公共 util） |

### 9.3 共享类型契约

`books` 表的 `book_id`、`chapters.chapter_id`、`paragraphs.paragraph_id` 为全库稳定 ID，所有模块通过这些 ID 绑定数据。本模块删除书时**不破坏 ID 规则**（直接物理删除，不回收复用 ID）。

---

## 10. 测试策略

### 10.1 主进程单元测试（Vitest）

| 测试点 | 夹具/方法 |
|---|---|
| `buildChapterTree` 单层/多层/空树/孤儿 parent_id（指向不存在的父） | 内存 SQLite + 预置 chapters 行；验证树结构、孤儿节点归为根 |
| `list` 分类/排序/搜索组合 | 预置多本书 + reading_progress 行；验证 progress 聚合、排序、LIKE 搜索 |
| `updateMeta` 校验（空标题/超长/合法） | 边界值；验证抛 `Validation` 与成功更新 `updated_at` |
| `replaceCover` 路径白名单（路径穿越 `../../etc/passwd`） | 恶意路径；验证拒绝写入 userData 外 |
| `deleteBook` 级联完整性 | 预置书+章+段+进度+笔记+卡+ai_cache+fts 行；删除后验证所有关联表 0 残留 |
| `deleteBook` FTS 显式清理 | 预置 fts_paragraphs 行；删除后验证 fts 表无残留（防止外键 CASCADE 失效场景） |
| `deleteBook` 文件副作用 | mock `fs`；验证 `unlinkSync` 调用次数与路径；验证文件失败不抛错 |
| 外键开关回归 | 关闭 `PRAGMA foreign_keys` 后删除 → 验证产生孤儿数据（用于证明 PRAGMA 必要性，反向用例） |

### 10.2 IPC 集成测试

- mock `ipcMain.handle` 注册，验证参数透传 service 与 `AppError` 序列化。
- `library:list`/`getChapterTree` 端到端：内存 DB → 预置 → invoke → 断言 DTO 形状。

### 10.3 渲染进程组件测试（Vitest + Testing Library）

- `<BookCard>` 渲染封面占位（cover 为空）、进度环数值。
- `<ChapterTree>` 递归渲染、展开/折叠交互、章级进度条显示。
- `<DeleteBookDialog>` 二次确认流程、调 store.removeBook。
- store：`load`/`setFilter`（debounce）/`openBook`/`removeBook` 流转。

### 10.4 性能回归

- 夹具：1 本书 × 500 章 × 200 段/章 = 10 万段落；`getChapterTree` ≤ 200ms（NFR-P2 放宽，树构建含进度聚合）。
- 夹具：50 本书；`list` ≤ 100ms。

---

## 11. 开放问题

1. **软删除回收站**：`books.deleted_at` 已预留，当前 LIB-04 走物理删除。是否在后续版本提供"回收站"（软删 + 30 天清理）？需 PRD 确认是否要恢复能力。当前结论：MVP 物理删除，字段预留不启用。

2. **进度聚合的实时性**：卡片进度来自 `v_book_progress` 视图，RD 写进度后回到书库需重拉 `list` 才刷新。是否引入 RD 写进度后主动通知 LIB store 刷新（事件总线 / IPC 广播）？当前结论：RD→LIB 切换时 `load()` 重拉，足够；不做实时推送。

3. **章节树超大深度**：极少数 EPUB 可能产生 > 5 层嵌套（卷-部-类-品-篇-条），树渲染与展开态管理需确认是否要做懒加载子树（按需 `getChapterTree` 只取一层）。当前结论：单书 < 500 章全量返回，不做懒加载。

4. **封面来源的 base64 vs file://**：`getCover` 当前返回 `file://` URL（渲染进程 `<img src>` 直接加载）。若后续 `sandbox` 收紧 `file://` 访问，改为返回 base64 缩略图（主进程读盘 + resize）。需与安全基线统一确认。

5. **FTS5 表模型**：`fts_paragraphs` 若采用 FTS5 外部内容表（`content='paragraphs'`），删除 paragraphs 时 FTS5 的 `external content` 触发器可能自动同步；若采用独立表则需显式 DELETE。本模块按"独立表/显式 DELETE"设计以兼容两种模型，待 SRH 模块（`05-search.md`）确定 FTS5 建表方式后复核。

---

*文档结束。后续变更请在文首登记版本。*
