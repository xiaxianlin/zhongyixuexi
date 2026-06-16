# 检索与知识图谱 技术设计文档（05-search）

## 1. 概述

### 1.1 职责

检索与知识图谱模块（SRH）负责对本库中已导入并解析的全部内容提供**检索、筛选、高亮、术语词典与知识图谱**能力。它是「读过之后能找到、能关联」的关键支撑，服务阅读、笔记、AI 问答 RAG 三个下游场景。

核心职责：

- **全文检索（SRH-01）**：基于 SQLite **FTS5**，跨所有导入书的章节/段落做全文检索，BM25 排序，snippet 高亮，定位到 `paragraph_id` 并跳转阅读。
- **结构化筛选（SRH-02，P2）**：按书 / 章节层级 / 用户标签过滤检索结果。
- **知识图谱（SRH-03，P2）**：术语/实体关系网络可视化，依赖 AI 抽取实体。
- **术语词典（SRH-04）**：用户自建或 AI 辅助构建术语词典，点击术语弹窗（定义 + 出处 + 关联）。
- **全库高亮（SRH-05）**：选中词后全库高亮出现位置 + 结果列表。
- **向量检索（可选）**：`sqlite-vec` 语义检索，为 AI 问答 RAG（AI-02）服务。

### 1.2 边界

- **不做**：笔记本身的全文检索归属 NOTE 模块（NOTE-03）；AI 问答的 Prompt 拼装与调用归属 AI 模块（07-ai）。本模块只提供**检索能力与 top-k 段落返回**。
- **不内置内容**：所有检索对象均为用户导入并解析后的 `paragraphs`；软件本身无预置书籍。
- **本地优先**：除 AI 抽取实体（P2）、AI 辅助构建术语（SRH-04）外，全部离线可用。

### 1.3 与其它模块的关系

| 模块 | 关系 |
|---|---|
| **IMP（导入解析）** | IMP 写入/修改 `paragraphs` 时需同步 `fts_paragraphs`（见 §7.1）；段落稳定 ID 是检索定位与跳转的锚点 |
| **RD（阅读）** | 检索结果点击跳转到阅读页并定位段落；全库高亮在阅读页渲染层叠加 |
| **NOTE（笔记）** | 标签 `tags`/`tag_refs` 复用 NOTE 的标签体系做结构化筛选（SRH-02）；`[[术语]]` 双链可关联到 `dictionary_terms` |
| **AI** | SRH-04（AI 辅助术语）、SRH-03（AI 抽取实体）调用 AI 模块；AI-02 问答 RAG 向本模块请求 top-k 段落 |
| **SET** | 向量检索（sqlite-vec）开关、是否启用 jieba 预分词等通过 SET 配置 |

---

## 2. 相关需求

引用 `docs/PRD.md` §3.6。

| 编号 | 功能 | 优先级 | 验收标准 | 本文档覆盖章节 |
|---|---|---|---|---|
| SRH-01 | 全文检索 | P0 | SQLite FTS5；跨所有导入书检索章节/段落/关键词；结果高亮 + 跳转（定位到段） | §4.1、§5.1、§7.2 |
| SRH-02 | 结构化筛选 | P2 | 按书/章节层级/用户标签过滤 | §4.4、§5.2、§7.3 |
| SRH-03 | 知识图谱 | P2 | 术语/实体关系网络可视化（依赖 AI 抽取实体） | §4.5、§5.5、§7.6 |
| SRH-04 | 术语词典 | P1 | 用户自建或 AI 辅助构建；点击术语 → 弹窗（定义 + 出处 + 关联） | §4.3、§5.4、§7.5 |
| SRH-05 | 全库高亮 | P1 | 选中词后全库高亮出现位置 + 结果列表 | §5.3、§7.4 |

非功能指标（PRD §4.1）：

- **NFR-P3**：全文检索 ≤ 300ms（万段落级）。FTS5 BM25 查询本身为毫秒级，预算主要花在中文分词预处理与 snippet 渲染。

---

## 3. 目录与文件结构

依据 `00-architecture.md` §3 的分层原则（`ipc/` 薄入口 → `services/` 业务 → `db/` 数据）。

```
electron/
├── db/
│   ├── migrations/
│   │   ├── 0050_search_fts.ts        # fts_paragraphs + 触发器
│   │   ├── 0051_dictionary.ts        # dictionary_terms
│   │   ├── 0052_kg_entities.ts       # entities / relations（P2）
│   │   └── 0053_vec.ts               # sqlite-vec + vec_paragraphs（P2，可选）
│   └── schema/
│       └── search.sql                # 本模块 DDL 汇总（便于 review）
├── services/
│   ├── search.ts                     # FTS5 全文检索、BM25、snippet
│   ├── highlight.ts                  # 全库高亮：扫描 + 位置定位
│   ├── filter.ts                     # 结构化筛选（书/层级/标签）
│   ├── dictionary.ts                 # 术语词典 CRUD + AI 辅助
│   ├── kg.ts                         # 知识图谱实体/关系（P2）
│   └── vec.ts                        # 向量检索（P2，可选，供 RAG）
├── ipc/
│   └── search.ts                     # ipcMain.handle 注册 search:*（薄层）
├── ai/
│   └── prompts/
│       ├── term-extract.ts           # AI 辅助术语抽取 prompt（SRH-04）
│       └── entity-extract.ts         # AI 实体/关系抽取 prompt（SRH-03，P2）
└── models/
    └── search.ts                     # DTO：SearchHit, TermRef, KgNode, KgEdge...

src/
├── modules/search/
│   ├── SearchPanel.tsx               # 主检索面板（输入 + 结果列表）
│   ├── SearchBar.tsx
│   ├── ResultList.tsx                # 段落级结果，snippet 高亮
│   ├── FilterPanel.tsx               # 结构化筛选（书/层级/标签）P2
│   ├── TermPopup.tsx                 # 术语弹窗（定义+出处+关联）
│   ├── DictionaryView.tsx            # 术语词典管理
│   ├── KgGraph.tsx                   # 知识图谱可视化（react-flow）P2
│   └── HighlightOverlay.tsx          # 全库高亮叠加层（配合 RD）
├── stores/
│   └── search.ts                     # Zustand store：query/results/filters/activeTerm
└── lib/
    └── ipc.ts                        # window.api.search.* 类型化封装
```

---

## 4. 数据模型

> 依据 `00-architecture.md` §5 公共约定：主键 `TEXT`（UUID v4），时间戳 `INTEGER`（unix ms）。`paragraphs`、`chapters`、`books`、`tags`/`tag_refs` 由 IMP / NOTE 模块定义，此处仅引用。

### 4.1 FTS5 虚拟表 `fts_paragraphs`（SRH-01 核心）

FTS5 采用**外部内容表（external content table）**模式，`fts_paragraphs` 不存储正文副本，而是通过 `content` 指向 `paragraphs`，避免双写数据膨胀与不一致。

#### 4.1.1 为什么用「外部内容表」

- 正文已在 `paragraphs.text`，FTS 表只负责倒排索引，无需复制全文（省空间、避免冗余一致性问题）。
- 写入/更新时只需同步索引行（`rowid` + `token`），正文读取回查 `paragraphs`。
- 代价：必须用触发器或应用层严格同步删除/更新，否则出现「索引命中但正文已变」的幽灵行（见 §7.1 同步策略与防御性校验）。

#### 4.1.2 DDL

```sql
-- content table：FTS5 外部内容表必须有一个同名影子表前缀，此处用 content='paragraphs' 直接指向
CREATE VIRTUAL TABLE fts_paragraphs USING fts5(
    text,                                    -- 段落正文（索引列）
    content='paragraphs',                    -- 外部内容表
    content_rowid='rowid',                   -- 段落表 rowid（paragraphs 用 INTEGER PRIMARY KEY rowid）
    tokenize = 'trigram case_sensitive 0'    -- 分词器，见 §4.1.4 中文分词方案权衡
);

-- BM25 排序辅助权重：段落长度归一可选。FTS5 bm25() 默认已按文档长度做归一。
-- 若需对不同来源加权，可加 weight 列或在应用层按 book/chapter 调整（见 §5.1）。
```

> **content_rowid 对齐说明**：`paragraphs` 表必须有显式 `rowid`（`INTEGER PRIMARY KEY AUTOINCREMENT` 或用 `id TEXT` 主键时另设 `rowid`）。本设计令 `paragraphs` 同时具备稳定字符串主键 `paragraph_id TEXT PRIMARY KEY` 与自增 `rowid INTEGER`（FTS 用），二者一一对应。FTS 命中后用 `paragraphs.rowid = fts_paragraphs.rowid` 回查，再取 `paragraph_id` 供跳转。

#### 4.1.3 snippet / highlight 使用

FTS5 内置 `snippet()` 与 `highlight()` 函数，配合 BM25 返回高亮片段：

```sql
SELECT
    p.paragraph_id,
    p.chapter_id,
    c.book_id,
    snippet(fts_paragraphs, 0, '<mark>', '</mark>', ' … ', 24) AS snippet_text,
    bm25(fts_paragraphs) AS score
FROM fts_paragraphs
JOIN paragraphs p ON p.rowid = fts_paragraphs.rowid
JOIN chapters c ON c.chapter_id = p.chapter_id
WHERE fts_paragraphs MATCH :query
ORDER BY rank;          -- rank 即按 bm25 升序（越小越相关）
```

- `snippet(..., 0, '<mark>', '</mark>', ' … ', 24)`：第 0 列、高亮标签 `<mark>`、省略符 ` … `、片段约 24 token。
- `highlight()` 返回整列文本加高亮（用于全库高亮场景，见 §7.4）。
- 渲染端将 `<mark>` 转为 React 节点（避免 `dangerouslySetInnerHTML` 直插：先转义再按标签切分）。

#### 4.1.4 中文分词方案权衡（关键决策）

FTS5 内置分词器对中文存在显著局限：

| 分词器 | 中文表现 | 优点 | 缺点 |
|---|---|---|---|
| `simple` | 仅按 ASCII 字母/数字切分，中文整段视为一个 token | — | **中文几乎不可用**，整段成一个 token 无法按词命中 |
| `unicode61` | 按 Unicode 类别切分，中文连续汉字仍归为一个 token | 轻量、零依赖 | 中文无法分词，只能整句命中；子串检索失效 |
| **`trigram`** | 滑动 3 字符（UTF-8 字符级）切分，支持任意子串匹配 | **无需分词词典**，子串召回高，对古文/生僻术语友好；FTS5 原生支持（3.3.0+） | 索引体积偏大（约为原文 1.5–2x）；极短词（1-2 字）需特殊处理；无语义概念 |
| jieba 预分词（应用层） | 用 jieba 切词后以空格分隔写入 FTS5（`unicode61` 分词） | 词级精确，索引小 | 需引入 Node 端分词（`nodejieba` 原生模块，打包复杂、跨平台编译）；古文/中医术语分词质量差，需自维护词典 |

**决策（推荐）**：

- **首期采用 `trigram`**。理由：中医典籍含大量古文、生僻术语、异体字，基于词典的分词（jieba）召回差且需维护中医专词表，成本高；`trigram` 无需词典、子串召回强、零原生依赖，契合「内容零内置、用户任意导入」的约束。索引膨胀在万段落级可接受（NFR-P3 目标万段落 ≤ 300ms）。
- **1–2 字短词检索**：trigram 对 `MATCH '脾'`（单字）不命中（需 ≥3 字符）。短词走 **SRH-05 全库高亮**的子串扫描路径（`LIKE '%脾%'` + 章节范围裁剪），或应用层把单字查询包装为 `SUBSTR` 扫描。本设计在 `search.ts` 中：若查询长度 < 3 个汉字，自动降级为 `LIKE` 扫描并提示用户。
- **P2 可选 jieba 增强**：若后续需更精确的词级检索与统计（如词频词云），在 `SET` 中提供「启用词级分词」开关，后台对 `paragraphs.text` 离线跑 jieba 生成 `paragraphs_text_segmented` 列，另建 `fts_paragraphs_word`（`unicode61`）双索引；默认关闭。

> **备选（若 SQLite 版本 < 3.3.0 无 trigram）**：退化为 `unicode61` + 应用层 ngram 预处理（写入前把正文按 3 字滑窗插入空格）。但 better-sqlite3 随 SQLite 版本较新，通常已含 trigram，建议在迁移脚本中做版本探测。

### 4.2 FTS 索引同步（触发器 + 应用层双保险）

采用**数据库触发器**为主保证一致性，应用层（IMP service）在事务内显式 upsert 作为**快速路径**与**重建入口**。

```sql
-- 触发器：paragraphs 插入 → 同步 FTS
CREATE TRIGGER fts_paragraphs_ai AFTER INSERT ON paragraphs BEGIN
    INSERT INTO fts_paragraphs(rowid, text) VALUES (new.rowid, new.text);
END;

-- 触发器：paragraphs 删除 → 同步删除 FTS（外部内容表需先删索引行）
CREATE TRIGGER fts_paragraphs_ad AFTER DELETE ON paragraphs BEGIN
    INSERT INTO fts_paragraphs(fts_paragraphs, rowid, text) VALUES('delete', old.rowid, old.text);
END;

-- 触发器：paragraphs 更新正文 → 先删旧后插新
CREATE TRIGGER fts_paragraphs_au AFTER UPDATE OF text ON paragraphs BEGIN
    INSERT INTO fts_paragraphs(fts_paragraphs, rowid, text) VALUES('delete', old.rowid, old.text);
    INSERT INTO fts_paragraphs(rowid, text) VALUES (new.rowid, new.text);
END;
```

> 外部内容表的 `delete` 命令语法为 `INSERT INTO fts_table(fts_table, rowid, <indexed_cols>) VALUES('delete', ...)`，必须提供与建表列一致的值（用 old.*）。

**与 IMP 协调（§7.1）**：IMP 段级编辑（IMP-03）改 `paragraphs.text` 时触发器自动同步；重新解析（IMP-07）批量重写段落时，IMP 在事务内执行 `INSERT INTO fts_paragraphs(fts_paragraphs) VALUES('rebuild');` 重建索引，避免逐行触发开销。**防御性校验**：启动时（或 SET「重建索引」入口）执行 `INSERT ... VALUES('integrity-check')`，失败则提示重建。

### 4.3 术语词典 `dictionary_terms`（SRH-04）

```sql
CREATE TABLE dictionary_terms (
    term_id        TEXT PRIMARY KEY,            -- UUID v4
    term           TEXT NOT NULL,               -- 术语原文，如「脾虚」
    definition     TEXT,                        -- 定义/释义
    source         TEXT,                        -- 出处描述（书名·篇名），自由文本
    category       TEXT,                        -- 分类：病机/治法/中药/方剂/经络/穴位/其它
    attributes     TEXT,                        -- JSON：结构化属性（性味/归经/功效等，AI-04 可填充）
    created_by     TEXT NOT NULL,               -- 'user' | 'ai'
    paragraph_id   TEXT,                        -- 首次出现/权威定义所在段落（可空，用于跳转）
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(paragraph_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_dict_term ON dictionary_terms(term);   -- 术语唯一
CREATE INDEX idx_dict_category ON dictionary_terms(category);

-- 术语 → 出现段落 多对多（用于术语弹窗「关联」列表）
CREATE TABLE term_occurrences (
    term_id        TEXT NOT NULL,
    paragraph_id   TEXT NOT NULL,
    count          INTEGER NOT NULL DEFAULT 1,  -- 在该段出现次数
    PRIMARY KEY (term_id, paragraph_id),
    FOREIGN KEY (term_id) REFERENCES dictionary_terms(term_id) ON DELETE CASCADE,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(paragraph_id) ON DELETE CASCADE
);
CREATE INDEX idx_occ_paragraph ON term_occurrences(paragraph_id);
```

> `term_occurrences` 由后台扫描（全库高亮任务副产品）或 AI 标注（AI-04）填充，供术语弹窗展示「出现于 N 段」并可跳转。

### 4.4 结构化筛选所需索引（SRH-02）

复用 IMP 的 `chapters(book_id, parent_id, level)` 与 NOTE 的 `tags`/`tag_refs`，补充 `paragraphs` 上的查询索引：

```sql
-- 段落按章节/书筛选的常用路径
CREATE INDEX idx_paragraph_chapter ON paragraphs(chapter_id, order_index);

-- 标签引用（NOTE 模块定义，此处仅声明依赖）
-- tag_refs(target_type='paragraph', target_id, tag_id)
```

结构化筛选在应用层拼装（见 §7.3），不引入额外表。

### 4.5 知识图谱 `entities` / `relations`（SRH-03，P2）

```sql
CREATE TABLE entities (
    entity_id     TEXT PRIMARY KEY,             -- UUID v4
    name          TEXT NOT NULL,                -- 实体名，如「人参」「太阴脾经」
    type          TEXT NOT NULL,                -- 中药/方剂/病证/经络/穴位/症状/病机
    attributes    TEXT,                         -- JSON 结构化属性（AI-04 抽取：性味/归经/功效）
    source_term_id TEXT,                        -- 关联到 dictionary_terms（可空）
    created_by    TEXT NOT NULL,                -- 'ai' | 'user'
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (source_term_id) REFERENCES dictionary_terms(term_id) ON DELETE SET NULL
);
CREATE INDEX idx_entity_name ON entities(name);
CREATE INDEX idx_entity_type ON entities(type);

CREATE TABLE relations (
    relation_id   TEXT PRIMARY KEY,
    source_id     TEXT NOT NULL,                -- 起始实体
    target_id     TEXT NOT NULL,                -- 目标实体
    type          TEXT NOT NULL,                -- 归经于/主治/配伍/包含/同义/上下位
    weight        REAL NOT NULL DEFAULT 1.0,    -- 置信度/强度（AI 抽取打分）
    paragraph_id  TEXT,                         -- 关系出处段落
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (source_id) REFERENCES entities(entity_id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES entities(entity_id) ON DELETE CASCADE,
    FOREIGN KEY (paragraph_id) REFERENCES paragraphs(paragraph_id) ON DELETE SET NULL
);
CREATE INDEX idx_relation_source ON relations(source_id, type);
CREATE INDEX idx_relation_target ON relations(target_id, type);
```

实体抽取由 AI 模块（AI-04 结构化标注）产出，写入 `entities`/`relations`；本模块负责查询与可视化。

### 4.6 向量检索 `vec_paragraphs`（可选，P2，供 RAG）

```sql
-- 依赖 sqlite-vec 扩展（主进程加载）
CREATE VIRTUAL TABLE vec_paragraphs USING vec0(
    paragraph_id TEXT PRIMARY KEY,
    embedding    FLOAT[768]                     -- 维度依 embedding 模型（如 bge-small-zh 512/768）
);
```

何时引入见 §7.7。FTS5 为检索主线，向量检索仅在 AI-02 RAG 需要语义召回时启用。

---

## 5. IPC 接口

channel 前缀 `search:*`（遵循 `00-architecture.md` §4）。

### 5.1 全文检索（SRH-01）

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `search:fulltext` | `{ query: string, limit?: number, offset?: number, bookIds?: string[] }` | `{ total: number, hits: SearchHit[] }` | FTS5 MATCH + BM25；短词（<3 汉字）自动降级 LIKE 扫描 |

**SearchHit DTO**：

```ts
interface SearchHit {
  paragraphId: string;
  chapterId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  snippet: string;        // 含 <mark> 高亮的片段
  score: number;          // bm25 分（越小越相关）
  orderIndex: number;     // 段落序号，用于结果排序/上下文
}
```

### 5.2 结构化筛选（SRH-02，P2）

| channel | 入参 | 返回 |
|---|---|---|
| `search:filter` | `{ query?: string, bookIds?: string[], chapterLevels?: string[], tagIds?: string[], limit?: number }` | `{ total, hits: SearchHit[] }` |

实现：FTS 子查询 + 对 `paragraphs`/`chapters`/`tag_refs` 的 IN 过滤在应用层拼装（见 §7.3）。

### 5.3 全库高亮（SRH-05）

| channel | 入参 | 返回 |
|---|---|---|
| `search:highlightAll` | `{ term: string, scope?: { bookId?: string } }` | `{ total: number, locations: HighlightLoc[] }` |
| `search:clearHighlight` | `{}` | `void` |

**HighlightLoc**：

```ts
interface HighlightLoc {
  paragraphId: string;
  chapterId: string;
  bookId: string;
  count: number;          // 该段命中次数
}
```

> 全库高亮对大库可能较重（LIKE 全表扫描）。策略：限定 scope（当前书 / 当前章节）默认，全库扫描异步进行并推送进度。

### 5.4 术语词典（SRH-04）

| channel | 入参 | 返回 |
|---|---|---|
| `search:termList` | `{ q?: string, category?: string }` | `Term[]` |
| `search:termGet` | `{ termId: string }` | `TermDetail`（含 occurrences 列表） |
| `search:termUpsert` | `{ term: Omit<Term,'termId'\|'createdAt'\|'updatedAt'> }` | `Term` |
| `search:termDelete` | `{ termId: string }` | `void` |
| `search:termAiSuggest` | `{ term: string, paragraphId?: string }` | `TermAiSuggestion`（AI 辅助生成 definition/source，**走 AI 模块，失败降级**） |

### 5.5 知识图谱（SRH-03，P2）

| channel | 入参 | 返回 |
|---|---|---|
| `search:kgSubgraph` | `{ entityId?: string, type?: string, depth?: number, limit?: number }` | `{ nodes: KgNode[], edges: KgEdge[] }` |
| `search:kgSearch` | `{ q: string }` | `Entity[]` |

### 5.6 向量检索（P2，可选）

| channel | 入参 | 返回 |
|---|---|---|
| `search:semantic` | `{ query: string, limit?: number, bookIds?: string[] }` | `SearchHit[]`（复用 DTO，score 为余弦距离） |

> 该 channel 主要服务 AI-02 RAG，通常由 AI 模块内部调用而非用户直接触发。

### 5.7 错误约定

- handler 抛 `AppError`（`00-architecture.md` §7）：FTS 查询语法错误 → `code: 'Search/QuerySyntax'`；sqlite-vec 未加载 → `code: 'Search/VecUnavailable'`；AI 辅助失败 → 由 AI 模块抛 `Ai/*`，本模块透传并降级。
- 长任务（全库高亮扫描、向量索引重建）用 `webContents.send('search:progress', { done, total })` 推送进度。

---

## 6. 前端设计

### 6.1 组件树

```
SearchModule
├── SearchPanel                    # 主面板，常驻侧栏或 Cmd+K 唤起
│   ├── SearchBar                  # 输入框 + 快捷键（Cmd/Ctrl+K 聚焦，Enter 检索）
│   ├── FilterPanel (P2)           # 书/层级/标签多选过滤
│   ├── ResultList
│   │   └── ResultItem             # snippet 渲染（<mark> → 高亮节点），点击 → 跳转 RD
│   └── EmptyState / Loading / ErrorState
├── TermPopup                      # 浮窗：阅读页点术语触发（RD-05 词条浮窗复用）
│   ├── DefinitionBlock
│   ├── SourceBlock                # 出处，可跳转
│   └── OccurrenceList             # 关联段落列表
├── DictionaryView                 # 术语词典管理页（表格 + 编辑抽屉 + AI 辅助按钮）
├── KgGraph (P2)                   # react-flow 画布
│   └── KgNode / KgEdge
└── HighlightOverlay              # 全库高亮：订阅 search store 的 activeTerm，在 RD 渲染层注入 <mark>
```

### 6.2 Store 结构（`src/stores/search.ts`，Zustand）

```ts
interface SearchStore {
  query: string;
  hits: SearchHit[];
  total: number;
  loading: boolean;
  error: AppError | null;
  filters: { bookIds: string[]; chapterLevels: string[]; tagIds: string[] };

  // 全库高亮
  activeTerm: string | null;          // null = 关闭高亮
  highlightLocations: HighlightLoc[];

  // 术语弹窗
  activeTermDetail: TermDetail | null;

  // 知识图谱
  kgNodes: KgNode[];
  kgEdges: KgEdge[];

  // actions
  runSearch: (q: string) => Promise<void>;
  applyFilters: (f: Partial<SearchStore['filters']>) => void;
  toggleHighlight: (term: string | null) => Promise<void>;
  openTerm: (termId: string) => Promise<void>;
  loadKg: (entityId?: string) => Promise<void>;
}
```

### 6.3 关键交互

- **Cmd/Ctrl+K 全局唤起检索**：在 RD 阅读页与全局快捷键注册（RD-09）中拦截，聚焦 SearchBar。
- **结果跳转**：点击 `ResultItem` → 调 `reading:openParagraph(paragraphId)`（RD 模块），SearchPanel 折叠或侧栏保留。
- **选中词 → 全库高亮**：在阅读页选中文本 → 右键菜单「全库高亮此词」→ `toggleHighlight(term)` → store 更新 → `HighlightOverlay` 重渲染当前章节段落。同时拉取 `highlightAll` 结果填充 `ResultList`。
- **术语弹窗**：阅读页点击带 `data-term-id` 的术语 → `openTerm` → `TermPopup` 渲染。术语在正文的识别：渲染层用 `dictionary_terms` 构建正则/AC 自动机做段落内标注（轻量，段落级缓存）。

---

## 7. 核心流程

### 7.1 FTS 索引同步流程（与 IMP 协调）

```
IMP 段级编辑（IMP-03）/ 重新解析（IMP-07）
        │
        │  事务内写 paragraphs（INSERT/UPDATE/DELETE）
        ▼
 ┌──────────────────────────────┐
 │  DB 触发器自动同步 fts_paragraphs │  ← 主路径，保证一致性
 │  (ai/ad/au 触发器)              │
 └──────────────────────────────┘
        │
        │  批量场景（重新解析、导入新书）
        ▼
 IMP service 显式执行：
   INSERT INTO fts_paragraphs(fts_paragraphs) VALUES('rebuild');
   （事务内，跳过逐行触发开销）

 防御性：
   - 启动 / SET 入口执行 'integrity-check'，失败提示重建
   - search service 命中后回查 paragraphs，若 rowid 已不存在（幽灵行），
     记录告警并跳过该结果（不抛错，保证检索可用）
```

**为什么触发器优先而非纯应用层**：用户/IMP 任何路径改 `paragraphs`（含未来可能的迁移脚本、SQL 直改）都必须同步索引，触发器是唯一不漏的兜底；应用层 `rebuild` 仅用于批量性能优化。

### 7.2 全文检索流程（SRH-01）

```
用户输入 query → SearchBar
        │
        ▼
 search.runSearch(q)
        │
        ▼
 window.api.search.fulltext({query: q, bookIds, limit})
        │
        ▼
 ipc/search.ts → searchService.fulltext(q)
        │
        ├─ 若 len(汉字) < 3 → 降级 LIKE '%q%'（章节范围裁剪 + LIMIT）→ 返回（无 BM25，按 order_index）
        │
        └─ 否则 → 转义 FTS5 特殊字符 → 构造 MATCH 表达式
                   SELECT paragraph_id, snippet(...), bm25(...)
                   FROM fts_paragraphs
                   JOIN paragraphs p ON p.rowid = fts_paragraphs.rowid
                   JOIN chapters c ...
                   WHERE fts_paragraphs MATCH :q [AND c.book_id IN (...)]
                   ORDER BY rank
                   LIMIT :limit OFFSET :offset
        │
        ▼
 返回 SearchHit[] → store.hits → ResultList 渲染
        │
        ▼
 用户点击 ResultItem → reading:openParagraph(paragraphId) → RD 定位到段
```

**FTS5 MATCH 表达式构造要点**：
- trigram 模式下直接传原始查询字符串即可（子串匹配）。
- 转义 `"` `*` `(` `)` 等 FTS5 语法字符，避免被解释为操作符；多词默认 AND，用户可用空格分词。
- BM25 权重：首期用默认列等权；P2 可按 `book`/`chapter level` 在应用层二次加权（检索后按 `(bookWeight, score)` 排序）。

### 7.3 结构化筛选流程（SRH-02，P2）

筛选与全文可组合。实现策略：**先 FTS 召回候选 rowid 集合，再 JOIN 过滤**，避免对全量段落做标签 JOIN。

```
FTS 子查询（返回匹配 rowid + score）
   │
   JOIN paragraphs p ON p.rowid = fts.rowid
   JOIN chapters c ON c.chapter_id = p.chapter_id
   LEFT JOIN tag_refs tr ON tr.target_id = p.paragraph_id AND tr.target_type='paragraph'
   WHERE 1=1
     [AND c.book_id IN (:bookIds)]
     [AND c.level IN (:chapterLevels)]
     [AND tr.tag_id IN (:tagIds)]
   GROUP BY p.paragraph_id
   ORDER BY MIN(rank), ...
```

纯筛选（无 query）时跳过 FTS，直接对 `paragraphs` + 标签 JOIN 分页。

### 7.4 全库高亮流程（SRH-05）

```
阅读页选中文本「脾虚」
        │
        ▼
 toggleHighlight('脾虚')
        │
        ├─ store.activeTerm = '脾虚'
        ├─ search.highlightAll('脾虚') → locations: [{paragraphId, count}, ...]
        │     （LIKE 全库扫描，scope 默认当前书；全库异步 + 进度推送）
        ▼
 HighlightOverlay 订阅 activeTerm：
   - 当前可见章节段落：用 highlight() 或前端正则替换，在正文 DOM 上叠加 <mark>
   - ResultList 显示 locations（点击跳转）
        │
        ▼
 关闭：toggleHighlight(null) → 清除 store 与 DOM 标记
```

**性能**：高亮渲染只作用于当前可视章节的段落（虚拟化/分章加载，避免一次性渲染全书）。全库 `highlightAll` 结果仅用于结果列表，正文标记懒加载。

### 7.5 术语词典流程（SRH-04）

**用户自建**：DictionaryView → 填表 → `search:termUpsert` → 写 `dictionary_terms`。

**AI 辅助**：选中段落内某词 →「AI 生成释义」→ `search:termAiSuggest` → AI 模块用 `prompts/term-extract.ts`（含中医术语模板）调 DeepSeek → 返回 `{definition, source, category, attributes}` 草稿 → 用户确认编辑后入库。

**正文识别**：段落渲染时，用 `dictionary_terms.term` 构建匹配器（AC 自动机或按段落缓存的正则集），命中处包裹 `<span data-term-id>` → 点击触发 `TermPopup`。

### 7.6 知识图谱流程（SRH-03，P2）

```
AI-04 结构化标注（后台/手动触发）
        │
        ▼ 对选定段落/章节调用 entity-extract prompt
   抽取 entities + relations → 写 entities / relations（带 paragraph_id 出处）
        │
        ▼
KgGraph 组件：
   search:kgSubgraph({entityId, depth:2}) → nodes/edges
        │
        ▼
 react-flow 渲染：
   - 节点按 type 着色（中药/方剂/病证...）
   - 边按 type 标签（归经于/主治/配伍）
   - 点击节点 → 下钻（重载该节点邻域）或跳转出处段落
   - 点击节点 → 侧栏展示实体 attributes + 关联 dictionary_terms
```

可视化选型：**react-flow**（声明式、React 友好、交互丰富、布局算法可接 dagre/elk）。备选 cytoscape（性能更优但 React 集成略重）。首期数据量小（千级实体），react-flow 足够。

### 7.7 向量检索引入时机（P2，可选）

**不在首期引入**。决策依据（呼应 PRD §13.3）：

- 首期 SRH-01（FTS5 关键词）+ AI 问答 RAG 用关键词召回已能满足基本问答。
- **引入时机**：当用户反馈「关键词召回漏掉语义相关但用词不同的段落」（如问「补气」却想召回讲「益气」「健脾」的段落）时，引入 `sqlite-vec` 做语义召回。
- **集成方式**：主进程加载 sqlite-vec 扩展；后台对 `paragraphs` 离线生成 embedding（本地模型如 `@xenova/transformers` bge-small-zh，或走用户配置的 embedding API），写 `vec_paragraphs`。AI-02 RAG 改为 FTS + 向量混合召回（RRF 融合）。
- **成本**：embedding 计算耗 CPU/可能联网；默认关闭，SET 开关 + 进度提示。

---

## 8. 错误处理与边界

| 场景 | 处理 |
|---|---|
| FTS5 查询语法错误（特殊字符） | `searchService` 预转义；仍失败抛 `Search/QuerySyntax`，前端提示「检索词包含非法字符」并保留上次结果 |
| trigram 短词（<3 汉字）不命中 | 自动降级 `LIKE` 扫描并提示「短词使用精确扫描」；限制 `LIKE` 范围避免全表扫卡顿 |
| 索引幽灵行（FTS 命中但 paragraphs 已删） | 回查 paragraphs，rowid 不存在则跳过 + `electron-log` 告警；不阻断检索 |
| 索引损坏（integrity-check 失败） | SET 提供「重建全文索引」入口，执行 `rebuild`；重建期间检索降级为 `LIKE`（标记为降级模式） |
| 全库高亮大库卡顿 | 默认限定 scope（当前书/章）；全库异步 + 进度；前端骨架屏 |
| AI 辅助术语/实体抽取失败 | 透传 `Ai/*` 错误，UI 提示「AI 暂不可用，可手动编辑」；不影响词典/图谱已有数据与检索（AI-07 降级） |
| sqlite-vec 未加载 | `search:semantic` 抛 `Search/VecUnavailable`；AI RAG 自动回退 FTS5 召回 |
| 段落被段级编辑删除 | 触发器同步删 FTS；`term_occurrences`/`relations.paragraph_id` `ON DELETE SET NULL`，弹窗/图谱出处显示「段落已删除」 |
| 术语重复 | `dictionary_terms.term` 唯一索引，upsert 时冲突提示合并 |

**性能边界（NFR-P3）**：万段落 FTS5 BM25 查询 + JOIN 回查目标 ≤ 300ms。实测若超预算，优先优化：① 确保 `paragraphs.rowid`/`chapter_id` 索引存在；② snippet token 数从 24 调小；③ 大结果集分页（默认 limit 50）。

---

## 9. 依赖关系

### 9.1 依赖（本模块需要）

| 模块 | 依赖项 |
|---|---|
| IMP | `paragraphs` / `chapters` 表及稳定 ID；段级编辑/重新解析时触发器同步 FTS；`paragraphs` 须有 `rowid`（FTS content_rowid） |
| NOTE | `tags` / `tag_refs` 表（SRH-02 标签筛选复用） |
| AI | `search:termAiSuggest`（SRH-04）、实体抽取（SRH-03）、`search:semantic`（向量）均委托 AI 模块；依赖 `ai_cache` 缓存术语/实体抽取结果 |
| RD | `reading:openParagraph` 跳转接口；`HighlightOverlay` 注入 RD 段落渲染层 |
| SET | 向量检索开关、jieba 增强开关、重建索引入口 |

### 9.2 被依赖（其它模块需要本模块）

| 模块 | 被依赖项 |
|---|---|
| AI | AI-02 问答 RAG 调用 `search:fulltext`（首期）/ `search:semantic`（P2）取 top-k 段落 |
| RD | RD-05 词条浮窗复用 `TermPopup`；全库高亮 overlay |
| NOTE | `[[术语]]` 双链解析可链接到 `dictionary_terms.term_id` |

### 9.3 共享类型（`electron/models/search.ts` / `src/lib/types.ts`）

`SearchHit`、`HighlightLoc`、`Term`、`TermDetail`、`TermAiSuggestion`、`Entity`、`Relation`、`KgNode`、`KgEdge`。

---

## 10. 测试策略

依据 `00-architecture.md` §9（Vitest + Testing Library）。

### 10.1 主进程单元测试（`services/`）

| 测试点 | 说明 |
|---|---|
| `searchService.fulltext` | 给定种子段落 + FTS 索引，断言 BM25 排序正确、snippet 含 `<mark>`、短词降级 LIKE 路径 |
| trigram 分词行为 | 验证 3 字查询命中、2 字查询降级、中文子串召回（如「脾虚」命中「脾胃虚弱」） |
| FTS 同步触发器 | 插入/更新/删除 `paragraphs` 后，`fts_paragraphs` 行数与内容一致；`rebuild` 后全量重建 |
| 幽灵行防御 | 手动制造 FTS 与 paragraphs 不一致，断言检索跳过并告警 |
| `filter` | 多书/层级/标签组合过滤结果正确 |
| `dictionary` | term 唯一约束、upsert、AI 辅助失败降级（mock AI 抛错） |
| `kg` | 子图 depth=2 召回邻域正确；关系双向遍历 |
| `vec`（若启用） | 余弦相似 top-k；sqlite-vec 未加载时抛 `Search/VecUnavailable` |

### 10.2 IPC 集成测试（mock db）

- `ipc/search.ts` 各 channel 参数校验、AppError 序列化、进度推送（`search:progress`）。

### 10.3 渲染进程组件测试

- `ResultList`：snippet `<mark>` 正确渲染为高亮节点（非 dangerouslySetInnerHTML），点击触发跳转回调。
- `TermPopup`：definition/source/occurrences 渲染；AI 加载态/错误态。
- `KgGraph`：mock nodes/edges，节点点击下钻/跳转。
- `HighlightOverlay`：activeTerm 变化触发重新标注。

### 10.4 测试夹具

- `fixtures/search-seed.sql`：导入若干测试段落（含中医术语「脾虚」「人参」「归经」），覆盖跨书、跨章节、重复词、古文异体字场景。
- `fixtures/epub/*.epub`：复用 IMP 的解析夹具，经 IMP 解析后作为检索语料（端到端：导入 → 检索 → 跳转）。
- 性能夹具：生成 1 万段落语料，断言检索 ≤ 300ms（NFR-P3）。

---

## 11. 开放问题

1. **中文分词最终方案**：首期 `trigram` 已定，但若用户反馈「检索噪声大（子串误命中）」，是否值得在 P2 引入 jieba + 中医专词表的词级分词双索引？需评估 `nodejieba` 跨平台编译对打包（electron-builder）的影响与中医词典维护成本。
2. **trigram 索引体积**：万段落级估算索引约为原文 1.5–2x；若库规模到十万段落，是否需要定期 `rebuild` 压缩或引入分库？待实测。
3. **向量检索默认模型**：引入 sqlite-vec 时，embedding 用本地 `@xenova/transformers`（离线、CPU）还是走用户配置的 embedding API（联网、计费）？倾向本地优先，但需评估模型包体积对安装包的影响。
4. **知识图谱布局算法**：react-flow 默认力导向对稠密图（如「人参」关联上百节点）易拥挤，是否接入 dagre/elk 分层布局或限制邻域节点数上限？P2 实现时定。
5. **术语正文识别性能**：用 AC 自动机在大词典（数千术语）下对每段落标注的耗时，是否需要按章节缓存标注结果或懒加载？待词典规模增长后压测。
6. **FTS content_rowid 与 paragraphs 主键**：要求 `paragraphs` 同时具备 `TEXT` 主键（稳定 ID）与 `INTEGER rowid`（FTS 用），需与 IMP 模块（01-import-parse）确认表结构一致，避免迁移期错位。

---

*本模块遵循 `00-architecture.md` 附录 A 模板。需求依据 `docs/PRD.md` §3.6（SRH）与 §5（数据模型）。*
