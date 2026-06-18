# 书籍导入 JSON 结构说明

本文定义导入器的规范化中间格式，用于把 EPUB/PDF 等来源解析成稳定的「书籍 -> 章节 -> 段落」数据，再写入 SQLite 的 `books`、`chapters`、`paragraphs` 表。

这个 JSON 不是数据库 dump。它保留来源、解析器、质量提示和稳定锚点，方便重复解析、人工校对、批量导入与后续迁移。

## 顶层结构

```ts
interface ImportedBookJson {
  schemaVersion: 1
  generator: {
    name: string
    version: string
    generatedAt: string
  }
  book: BookRecord
  source: SourceRecord
  parse: ParseRecord
  quality: QualityReport
  chapters: ChapterRecord[]
}
```

## 字段说明

### `book`

书籍级元信息，对应数据库 `books` 的主要字段。

```ts
interface BookRecord {
  id: string
  title: string
  author: string | null
  category: string | null
  language: string
  sourceFormat: 'epub' | 'pdf' | 'text'
  importedAt: string
}
```

- `id`：稳定书籍 ID。导入器应基于来源内容 hash 和书名生成，重跑同一来源保持不变。
- `sourceFormat`：来源类型。首期应用导入链路以 EPUB 为主，但中间格式允许 PDF。
- `importedAt`：ISO 8601 字符串。落库时转换为 unix ms。

### `source`

来源文件和抽取范围。

```ts
interface SourceRecord {
  path: string
  sha256: string
  format: 'epub' | 'pdf' | 'text'
  pageCount?: number
  extractedPages?: { start: number; end: number }
  entries?: string[]
}
```

- `sha256`：来源文件级 hash，用于导入去重。
- `pageCount`：PDF 总页数。
- `extractedPages`：本次实际参与正文解析的页码闭区间。
- `entries`：EPUB spine/xhtml 或其它容器条目；PDF 可省略。

### `parse`

解析器版本和规则快照。这个对象应当能说明“为什么生成了当前章节/段落”。

```ts
interface ParseRecord {
  parser: string
  parserVersion: string
  params: {
    chapterHeading: string
    paragraphSplit: string
    textNormalization: string[]
  }
}
```

### `quality`

全书级质量报告。解析器不应吞掉异常，应把不确定性显式写到这里。

```ts
interface QualityReport {
  status: 'ok' | 'suspect' | 'failed'
  chapterCount: number
  paragraphCount: number
  warnings: string[]
}
```

### `chapters`

章节树。首期可输出扁平章节列表，未来可通过 `parentId` 表示卷、篇、节层级。

```ts
interface ChapterRecord {
  id: string
  bookId: string
  parentId: string | null
  orderIndex: number
  level: string | null
  title: string
  canonicalTitle?: string
  collection?: string
  sequence?: number | null
  sourceRange: SourceRange
  contentHash: string
  quality: NodeQuality
  paragraphs: ParagraphRecord[]
}
```

- `id`：稳定章节 ID，建议由 `book.id + collection + sequence + title` 派生。
- `level`：如 `序`、`篇`、`卷`；未知时为 `null`。
- `canonicalTitle`：去除 OCR 附加尾字后的规范标题，例如 `九针十二原第一法` 的规范标题为 `九针十二原第一`。
- `collection`：经典分部，例如 `素问`、`灵枢`。
- `sequence`：篇序号；如果源文本缺失或无法判断，写 `null`。
- `sourceRange`：该章节在来源中的页码和行号范围。
- `contentHash`：章节正文规范化后 sha256 前缀，用于重新解析映射。

### `paragraphs`

段落是下游笔记、AI 解读、记忆卡、检索定位的最小引用单元。

```ts
interface ParagraphRecord {
  id: string
  chapterId: string
  orderIndex: number
  text: string
  blockType: 'p' | 'preface' | 'note'
  parseHash: string
  sourceRange: SourceRange
  quality: NodeQuality
}
```

- `id`：稳定段落 ID，建议由 `chapter.id + orderIndex + parseHash` 派生。后续重解析时优先用 `parseHash` 复用旧 ID。
- `text`：清理后的纯文本。不要把页眉、页码、提取器控制字符写入正文。
- `parseHash`：段落文本规范化后 sha256 前缀，是 IMP-07 重新解析保留下游引用的核心键。
- `blockType`：正文通常为 `p`；序文可用 `preface`；校勘脚注或源注可用 `note`。

### `SourceRange` 与 `NodeQuality`

```ts
interface SourceRange {
  startPage: number
  endPage: number
  startLine?: number
  endLine?: number
}

interface NodeQuality {
  flag: 'ok' | 'suspect' | 'failed'
  notes: string[]
}
```

## 落库映射

| JSON 字段 | SQLite 字段 |
| --- | --- |
| `book.id` | `books.id` |
| `book.title` | `books.title` |
| `book.author` | `books.author` |
| `book.sourceFormat` | `books.source_format` |
| `source.path` | `books.source_file` |
| `book.category` | `books.category` |
| `chapters[].id` | `chapters.id` |
| `chapters[].bookId` | `chapters.book_id` |
| `chapters[].parentId` | `chapters.parent_id` |
| `chapters[].orderIndex` | `chapters.order_index` |
| `chapters[].level` | `chapters.level` |
| `chapters[].title` | `chapters.title` |
| `chapters[].contentHash` | `chapters.content_hash` |
| `paragraphs[].id` | `paragraphs.id` |
| `paragraphs[].chapterId` | `paragraphs.chapter_id` |
| `paragraphs[].orderIndex` | `paragraphs.order_index` |
| `paragraphs[].text` | `paragraphs.text` |
| `paragraphs[].parseHash` | `paragraphs.parse_hash` |
| `paragraphs[].quality.flag` | `paragraphs.quality_flag` |

## 校验约束

- `schemaVersion` 必须为 `1`。
- `book.id`、`chapters[].id`、`paragraphs[].id` 全局稳定且非空。
- `chapters[].orderIndex` 在同一 `bookId + parentId` 下从 `0` 递增。
- `paragraphs[].orderIndex` 在同一 `chapterId` 下从 `0` 递增。
- `paragraphs[].text` 去除首尾空白后不能为空。
- `chapters[].contentHash` 和 `paragraphs[].parseHash` 必须由规范化文本计算，不能随机生成。
- `quality.status !== 'ok'` 时必须提供至少一条 `quality.warnings`。

## 当前样例产物

随包内置三本经典均按本结构组织，位于 `data/`：

- `data/suwen-original.json`（《素问》，79 章 / 694 段，book.id = `huangdi-suwen`）
- `data/lingshu-original.json`（《灵枢》，81 章，book.id = `huangdi-lingshu`）
- `data/nanjing-original.json`（《难经》，81 章，book.id 随机 UUID）

启动时由 `electron/services/builtin-content.ts` 的 `seedBuiltinContent()` 读取并事务写入 `books`/`chapters`/`paragraphs`，已存在则跳过（幂等）。各文件的 `quality.chapterCount` / `quality.paragraphCount` 用于落库前校验段落数一致性。
