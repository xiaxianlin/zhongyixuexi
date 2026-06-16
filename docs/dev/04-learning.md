# 学习闭环模块 技术设计文档（04-Learning）

> 本文件遵循 `00-architecture.md` 附录 A 模板。需求依据见 `docs/PRD.md` §3.5（LRN）及相关条目（AI-06、RD-09）。

---

## 1. 概述

### 1.1 职责

学习闭环模块（LRN）是本软件的「记住所学」引擎，负责把分散在阅读、AI 生成、测验中的知识点沉淀为**可调度复习的记忆卡**，并通过 SM-2 间隔重复算法在恰当的时间把它们推到用户面前，形成「学 → 卡 → 复习 → 测验 → 错题再成卡」的闭环。

核心职责：

- **卡片调度**：基于 SM-2 算法为每张卡计算下次复习时间（`due_at`）。
- **每日复习计划**：计算到期卡片队列，支持「今天到期 / 全部 / 随机」三种模式。
- **卡片生命周期**：管理卡片的多种来源（手写 / 阅读页加卡 / AI 批量生成 / 测验错题转卡）、翻卡交互、评分入库。
- **测验**：从卡片库/段落生成选择/匹配/判断题，作答并统计正确率，错题可一键转卡。
- **学习仪表盘**：聚合复习数据，产出掌握度、复习热力图、连续学习天数（streak）、薄弱章节推荐。

### 1.2 边界

| 在本模块内 | 不在本模块内 |
|---|---|
| 卡片表、复习记录表、测验表的 schema 与读写 | 卡片「正文」所需的原文/译文文本（来自 `paragraphs` 表，由 IMP/RD 维护） |
| SM-2 调度计算（纯函数，可单测） | AI 调用本身（AI-06 由 AI 模块发起，LRN 仅消费其产出的卡片草稿 DTO） |
| 翻卡 UI 状态机与评分交互 | AI Prompt 模板、API Key 管理（SET-01）、降级策略（AI-07） |
| 测验题生成与作答记录 | 全文检索（SRH）、笔记（NOTE） |
| 仪表盘聚合查询 | 知识图谱可视化（SRH-03，P2） |

### 1.3 与其它模块的关系

- **RD（阅读）**：阅读页「一键加卡」、快捷键加卡（RD-09）通过 `learning:createCard` 把当前段落的原文/译文落库为卡，携带 `paragraph_id`。
- **AI（AI-06）**：AI 模块对选定段落批量抽取要点 → 返回 `CardDraft[]` 草稿 → LRN 提供确认入库接口。AI 失败（AI-07）不影响本地已有卡片与手写加卡。
- **IMP**：`paragraphs.paragraph_id` 与 `chapters.chapter_id` 是卡片/测验题的稳定绑定锚点（架构 §5 公共约定）。
- **SET**：学习相关偏好（每日新卡上限、每日复习上限、目标保留率、新卡顺序）存 `settings`，LRN 读取后参与计划计算。

---

## 2. 相关需求

| PRD 编号 | 功能 | 优先级 | 验收标准（摘录） | 本文档对应章节 |
|---|---|---|---|---|
| LRN-01 | 间隔重复记忆卡 | P0 | SM-2 算法调度；卡片类型：原文→解读、术语→释义、配图→名称、章/段标题→要点 | §4.1 cards 表、§7.1 SM-2 算法 |
| LRN-02 | 每日复习计划 | P0 | 本地计算到期卡片；支持「今天到期 / 全部 / 随机」 | §7.2 每日计划、§5 IPC `learning:getDueQueue` |
| LRN-03 | 卡片来源 | P0 | 阅读页一键加卡（可绑段）；AI 批量生成（AI-06）；测验错题转卡；手写卡片 | §7.3 卡片来源交互 |
| LRN-04 | 翻卡交互 | P0 | 正反面翻转；评分（重来/困难/良好/简单）驱动调度 | §6.2 翻卡状态机、§7.1 评分映射 |
| LRN-05 | 测验 | P1 | 选择/匹配/判断；记录正确率；错题转卡 | §4.3/§4.4 测验表、§7.4 测验流程 |
| LRN-06 | 学习仪表盘 | P1 | 进度、掌握度热力图、薄弱章节推荐、本地 streak | §7.5 仪表盘聚合 |

相关非功能需求（PRD §4）：NFR-P2 段落打开 ≤200ms（复习卡渲染同标准）、NFR-R1 本地优先（全部调度本地计算，无联网）、NFR-R3 数据可备份（cards/review_log 随 `app.db` 导出，见 SET-03）。

---

## 3. 目录与文件结构

按架构 §3 的分层（`ipc/` 薄入口 → `services/` 业务 → `db/` 数据），本模块代码组织如下：

```
electron/
├── db/
│   ├── schema/04-learning.sql          # cards / review_log / quiz_* 的 DDL（迁移脚本引入）
│   └── migrations/                     # 版本化迁移，不可破坏既有 id
├── services/
│   └── learning.ts                     # 核心业务：调度、计划、加卡、测验、仪表盘
├── ipc/
│   └── learning.ts                     # ipcMain.handle('learning:*') 注册（薄层）
├── models/
│   └── learning.ts                     # Card / ReviewLog / Quiz* 类型与 DTO
└── lib/
    └── sm2.ts                          # SM-2 纯函数（无 IO，便于单测）

src/
├── modules/learning/
│   ├── FlashcardView.tsx              # 翻卡主视图（正反翻转 + 评分按钮）
│   ├── DailyPlan.tsx                  # 每日复习计划（到期队列 + 模式切换）
│   ├── CardEditor.tsx                 # 手写/编辑卡片
│   ├── AiCardsConfirm.tsx            # AI 草稿确认入库（消费 AI-06 产出）
│   ├── QuizView.tsx                   # 测验作答
│   └── Dashboard.tsx                  # 学习仪表盘（掌握度/热力图/streak）
├── stores/
│   └── learning.ts                    # Zustand store：复习会话状态、队列缓存、翻卡状态机
└── lib/
    └── ipc.ts                         # window.api.learning.* 类型化封装
```

---

## 4. 数据模型

遵循架构 §5 公共约定：主键 `id` = `TEXT`（UUID v4，应用层生成）；时间戳 `INTEGER`（unix ms）；软删除可选 `deleted_at`。

### 4.1 cards 表（记忆卡）

```sql
CREATE TABLE IF NOT EXISTS cards (
  id              TEXT    PRIMARY KEY,                 -- UUID v4
  deck            TEXT    NOT NULL DEFAULT 'default',  -- 牌组：default / book-<book_id> / quiz-errors
  type            TEXT    NOT NULL,                    -- 卡片类型，见下方枚举
  front           TEXT    NOT NULL,                    -- 正面（问题/题干）
  back            TEXT    NOT NULL,                    -- 反面（答案/解读）
  -- 绑定锚点（来源粒度，可空表示手写未绑定）
  book_id         TEXT,                                -- 所属书（可空）
  chapter_id      TEXT,                                -- 绑定章节（可空）
  paragraph_id    TEXT,                                -- 绑定段落（可空，段级粒度）
  -- 来源追溯
  source          TEXT    NOT NULL DEFAULT 'manual',   -- manual / reading / ai_batch / quiz_error
  source_ref      TEXT,                                -- 来源引用（如 ai_cache.id / quiz_result_id）
  -- SM-2 调度状态（核心）
  ease_factor     REAL    NOT NULL DEFAULT 2.5,        -- 难度系数 EF，初始 2.5
  interval_days   INTEGER NOT NULL DEFAULT 0,          -- 当前间隔（天），0=新卡
  repetitions     INTEGER NOT NULL DEFAULT 0,          -- 已连续答对次数
  due_at          INTEGER NOT NULL,                    -- 下次到期时间戳（ms）；新卡 = created_at
  -- 状态与元数据
  status          TEXT    NOT NULL DEFAULT 'active',   -- active / suspended / buried
  reviewed_count  INTEGER NOT NULL DEFAULT 0,          -- 累计复习次数
  lapsed_count    INTEGER NOT NULL DEFAULT 0,          -- 累计「重来」次数（遗忘次数）
  tags            TEXT,                                -- 逗号分隔标签（冗余便于筛选；规范标签走 tag_refs）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,                             -- 软删除
  FOREIGN KEY (book_id)      REFERENCES books(id),
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id),
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id)
);

-- 索引：复习计划主查询（按到期 + 牌组 + 状态）
CREATE INDEX IF NOT EXISTS idx_cards_due        ON cards(deck, status, due_at);
-- 索引：按来源/段落反查（阅读页加卡去重、章节统计）
CREATE INDEX IF NOT EXISTS idx_cards_source     ON cards(source, paragraph_id);
CREATE INDEX IF NOT EXISTS idx_cards_chapter    ON cards(chapter_id);
CREATE INDEX IF NOT EXISTS idx_cards_book       ON cards(book_id);
```

**字段说明**：

- `type` 枚举值（对应 LRN-01 卡片类型）：
  - `'original_to_interpret'`：原文 → 解读（正面原文，反面白话译文/医理）。
  - `'term_to_meaning'`：术语 → 释义（正面「君臣佐使」，反面释义）。
  - `'image_to_name'`：配图 → 名称（反面引用 `local://` 图，P2）。
  - `'title_to_points'`：章/段标题 → 要点（正面章节标题，反面要点列表）。
- `source` 枚举：`'manual'`（手写）/ `'reading'`（阅读页加卡）/ `'ai_batch'`（AI-06 批量）/ `'quiz_error'`（测验错题转卡）。
- `deck`：默认 `'default'`；按书导入时可为 `'book-<book_id>'`；测验错题转卡归入 `'quiz-errors'`，便于用户单独强化。
- `ease_factor` / `interval_days` / `repetitions` / `due_at` 四字段是 SM-2 调度的状态机变量，含义见 §7.1。

### 4.2 review_log 表（复习记录）

```sql
CREATE TABLE IF NOT EXISTS review_log (
  id              TEXT    PRIMARY KEY,                 -- UUID v4
  card_id         TEXT    NOT NULL,
  -- 评分（用户输入）
  grade          INTEGER NOT NULL,                     -- 0..5（SM-2 原始评分，见 §7.1 映射）
  grade_label    TEXT    NOT NULL,                     -- again / hard / good / easy（UI 用的四档映射）
  -- 调度前快照
  prev_ease_factor   REAL    NOT NULL,
  prev_interval_days INTEGER NOT NULL,
  prev_repetitions   INTEGER NOT NULL,
  -- 调度后结果
  next_ease_factor   REAL    NOT NULL,
  next_interval_days INTEGER NOT NULL,
  next_repetitions   INTEGER NOT NULL,
  next_due_at        INTEGER NOT NULL,
  -- 元数据
  elapsed_ms     INTEGER,                              -- 本次翻卡耗时（翻面到评分的时间，用于 UX 调优）
  reviewed_at    INTEGER NOT NULL,                     -- 复习发生时间戳
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- 索引：按卡查历史（曲线回放）
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id, reviewed_at);
-- 索引：仪表盘按日聚合（热力图、streak）
CREATE INDEX IF NOT EXISTS idx_review_log_day  ON review_log(reviewed_at);
```

> `review_log` 同时记录「调度前/调度后」值，保证调度可追溯、可回滚（若用户误评，可用上一条 log 还原 `cards` 调度状态）。

### 4.3 quiz_questions 表（测验题库）

```sql
CREATE TABLE IF NOT EXISTS quiz_questions (
  id              TEXT    PRIMARY KEY,
  book_id         TEXT,
  chapter_id      TEXT,                                -- 题目所属章节（薄弱章节推荐依据）
  paragraph_id    TEXT,                                -- 出题段落锚点
  source          TEXT    NOT NULL DEFAULT 'generated',-- generated(AI/规则) / imported
  qtype           TEXT    NOT NULL,                    -- choice / match / judge
  stem            TEXT    NOT NULL,                    -- 题干
  -- 题型数据（JSON 串，按 qtype 解析；见 §7.4 结构）
  payload         TEXT    NOT NULL,                    -- 选项/匹配项/判断对象
  answer          TEXT    NOT NULL,                    -- 正确答案（JSON：choice=选项key, judge=bool, match=映射）
  explanation     TEXT,                                -- 解析（错题转卡时作为卡片 back）
  difficulty      REAL    DEFAULT 0.5,                 -- 0..1 难度估计（可选）
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (book_id)      REFERENCES books(id),
  FOREIGN KEY (chapter_id)   REFERENCES chapters(id),
  FOREIGN KEY (paragraph_id) REFERENCES paragraphs(id)
);

CREATE INDEX IF NOT EXISTS idx_quiz_q_chapter ON quiz_questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_quiz_q_book    ON quiz_questions(book_id);
```

**`payload` / `answer` 的 JSON 结构**（§7.4 详述）：

```jsonc
// qtype = "choice"
// payload
{ "options": [{"key":"A","text":"味甘微寒"},{"key":"B","text":"味苦大寒"}, ...] }
// answer
{ "correct_key": "A" }

// qtype = "match"
// payload
{ "pairs": [{"left":"人参","right":"补气"},{"left":"黄连","right":"清热"}, ...], "shuffled": true }
// answer
{ "mapping": {"人参":"补气","黄连":"清热"} }

// qtype = "judge"
// payload
{ "statement": "《神农本草经》将人参列为下品。" }
// answer
{ "is_true": false }
```

### 4.4 quiz_results 表（测验作答与错题）

```sql
CREATE TABLE IF NOT EXISTS quiz_results (
  id              TEXT    PRIMARY KEY,
  quiz_question_id TEXT   NOT NULL,
  session_id      TEXT    NOT NULL,                    -- 一次测验会话（多题共享）
  user_answer     TEXT,                                -- 用户作答（JSON，与 answer 同构）
  is_correct      INTEGER NOT NULL,                    -- 0/1
  time_spent_ms   INTEGER,
  turned_to_card  INTEGER NOT NULL DEFAULT 0,          -- 是否已转卡（0/1，防重复转）
  answered_at     INTEGER NOT NULL,
  FOREIGN KEY (quiz_question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_r_session ON quiz_results(session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_r_correct ON quiz_results(is_correct, answered_at);
CREATE INDEX IF NOT EXISTS idx_quiz_r_chapter ON quiz_results(quiz_question_id); -- 配合 join 取 chapter
```

> 错题转卡时：将 `turned_to_card` 置 1，并在 `cards` 插入一条 `source='quiz_error'`、`deck='quiz-errors'`、`source_ref=<quiz_results.id>` 的卡。

---

## 5. IPC 接口

统一前缀 `learning:*`（架构 §4 约定 `<module>:<action>`）。handler 抛结构化 `AppError`。

| channel | 入参 | 返回 | 说明 / 是否长任务 |
|---|---|---|---|
| `learning:createCard` | `CardInput`（front/back/type/绑定/可选 tags） | `Card` | 新建卡（手写 / 阅读页加卡）。同段+同 front 存在时可选去重（`?dedupe=true`） |
| `learning:createCardsBatch` | `CardInput[]` | `{ created: number, ids: string[] }` | AI-06 草稿确认入库，单事务 |
| `learning:getCard` | `id` | `Card \| null` | |
| `learning:updateCard` | `id, Partial<CardEditable>` | `Card` | 编辑正反/绑定 |
| `learning:deleteCard` | `id` | `void` | 软删除（`deleted_at`） |
| `learning:getDueQueue` | `{ deck?, mode: 'today'\|'all'\|'random', limit?, newPerDay?, reviewOrder? }` | `Card[]` | 每日复习队列（§7.2），核心 |
| `learning:reviewCard` | `ReviewInput{ card_id, grade, grade_label, elapsed_ms? }` | `ReviewResult{ card, log }` | 评分 → 跑 SM-2 → 更新 cards + 写 review_log（事务） |
| `learning:undoReview` | `card_id` | `Card` | 回滚到上一条 review_log（误评还原） |
| `learning:getReviewStats` | `{ from, to }` | `DailyStats[]` | 仪表盘：按日复习量/正确量 |
| `learning:getDashboard` | `{ rangeDays?: number }` | `DashboardDTO` | 掌握度、热力图、streak、薄弱章节（§7.5） |
| `learning:generateQuiz` | `{ book_id?, chapter_id?, count, qtypes }` | `{ session_id, questions: QuizQuestion[] }` | 测验出题（规则+可选 AI），见 §7.4 |
| `learning:submitQuizAnswer` | `{ quiz_result_id?, session_id, quiz_question_id, user_answer }` | `{ is_correct, answer, explanation }` | 判分并写 quiz_results |
| `learning:finishQuizSession` | `{ session_id }` | `SessionSummary{ total, correct, wrongQuestions[] }` | 会话结算 + 错题列表 |
| `learning:turnErrorToCard` | `{ quiz_result_id }` | `Card` | 错题转卡（幂等：已转则返回原卡） |
| `learning:getHeatmap` | `{ year }` | `{ [yyyy-mm-dd]: count }` | 复习热力图数据 |

**长任务进度**：`generateQuiz` 当调 AI 生成题干时为长任务，主进程 `event.sender.send('learning:quizProgress', { done, total })` 推送进度（架构 §4）。

### IPC 暴露示例（preload）

```ts
// electron/preload/index.ts（节选）
contextBridge.exposeInMainWorld('api', {
  learning: {
    createCard: (input: CardInput) => ipcRenderer.invoke('learning:createCard', input),
    getDueQueue: (q: DueQueueInput) => ipcRenderer.invoke('learning:getDueQueue', q),
    reviewCard: (r: ReviewInput) => ipcRenderer.invoke('learning:reviewCard', r),
    undoReview: (cardId: string) => ipcRenderer.invoke('learning:undoReview', cardId),
    getDashboard: (q: DashboardInput) => ipcRenderer.invoke('learning:getDashboard', q),
    generateQuiz: (q: QuizGenInput) => ipcRenderer.invoke('learning:generateQuiz', q),
    submitQuizAnswer: (a: QuizAnswerInput) => ipcRenderer.invoke('learning:submitQuizAnswer', a),
    turnErrorToCard: (rid: string) => ipcRenderer.invoke('learning:turnErrorToCard', rid),
    onQuizProgress: (cb: (p: { done: number; total: number }) => void) => {
      const h = (_e: unknown, p: { done: number; total: number }) => cb(p);
      ipcRenderer.on('learning:quizProgress', h);
      return () => ipcRenderer.off('learning:quizProgress', h);
    },
  },
  // ...其它模块
});
```

---

## 6. 前端设计

### 6.1 组件树

```
<LearningModule>
├─ <DailyPlan/>                  // 顶部：今日到期数、模式切换（今天/全部/随机）、开始复习
│    └─ <FlashcardView/>         // 复习主循环（队列驱动）
├─ <FlashcardView/>              // 翻卡视图（独立可复用）
│    ├─ <CardFront/>             // 正面（按 type 渲染：原文/术语/标题/配图）
│    ├─ <CardBack/>              // 反面（点击/空格翻转后显示）
│    └─ <GradeButtons/>          // 重来/困难/良好/简单（翻转后出现）
├─ <CardEditor/>                 // 手写/编辑卡（含 type、绑定段落选择器）
├─ <AiCardsConfirm/>             // AI-06 草稿列表，勾选确认入库
├─ <QuizView/>                   // 测验作答（按 qtype 渲染 choice/match/judge）
└─ <Dashboard/>
     ├─ <MasteryRing/>           // 掌握度环形进度
     ├─ <StreakBadge/>           // 连续学习天数
     ├─ <Heatmap/>               // 全年复习热力图（GitHub 风格）
     └─ <WeakChapters/>          // 薄弱章节推荐列表（点击 → 跳阅读/加测验）
```

### 6.2 翻卡交互状态机（LRN-04）

翻卡是本模块最高频的交互，用显式状态机管理，避免「是否已翻转」的散落布尔。

```
状态: 'idle' → 'showingFront' → 'showingBack' → 'graded' → 'next' (循环) / 'done'

idle            : 队列加载中
showingFront    : 显示正面；用户可 Space/点击 → flip()
showingBack     : 显示反面 + 评分按钮；记录翻面时间
                 评分按钮 → grade(label) → 触发 learning:reviewCard
graded          : 等待 IPC 返回（loading）；成功后 → next()
next            : 若队列还有卡 → 回到 showingFront；否则 → done
done            : 显示本次复习小结（复习数、用时）
```

**Zustand store 结构**（`src/stores/learning.ts`）：

```ts
type FlipState = 'idle' | 'showingFront' | 'showingBack' | 'graded' | 'done';

interface LearningStore {
  // 队列
  queue: Card[];
  cursor: number;            // 当前卡在 queue 中的下标
  current: Card | null;
  // 翻卡状态机
  flipState: FlipState;
  flippedAt: number | null;  // 翻面时间戳（算 elapsed_ms）
  submitting: boolean;       // graded 阶段 IPC 进行中
  // 本会话统计
  sessionStats: { reviewed: number; again: number; totalMs: number };
  // 错误
  error: AppError | null;

  // actions
  loadQueue: (mode: 'today'|'all'|'random') => Promise<void>;
  flip: () => void;                       // showingFront → showingBack
  grade: (label: GradeLabel) => Promise<void>;  // showingBack → graded → next
  undo: () => Promise<void>;              // 回滚上一张
  next: () => void;                       // graded → showingFront/done
}
```

**键盘操作**（RD-09 体系一致）：`Space` 翻面；`1/2/3/4` 或 `A/H/G/E` 对应 重来/困难/良好/简单；`Ctrl+Z` 撤销上一评分；`Esc` 退出复习。

### 6.3 GradeLabel 与评分映射（UI）

UI 仅暴露四档（PRD LRN-04），内部映射到 SM-2 的 0–5：

| UI 按钮 | `grade_label` | `grade`（SM-2 0–5） | 语义 |
|---|---|---|---|
| 重来 | `again` | 0 | 完全忘记，重置 repetitions |
| 困难 | `hard` | 3 | 勉强回忆，间隔缩短、EF 略降 |
| 良好 | `good` | 4 | 正常回忆（默认推荐） |
| 简单 | `easy` | 5 | 轻松，间隔加大、EF 略升 |

> 不暴露 grade 1/2（避免选择疲劳）；映射在 `lib/sm2.ts` 内集中定义，便于单测与调整。

---

## 7. 核心流程

### 7.1 SM-2 间隔重复算法（LRN-01 核心）

SM-2（SuperMemo-2）是经典间隔重复算法，Anki 等主流软件在其上做变体。本模块实现**标准 SM-2 语义 + 四档评分映射**，保证可预测、可单测。

#### 7.1.1 变量定义

| 变量 | 含义 | 初始值 |
|---|---|---|
| `EF`（ease_factor） | 难度系数，越大表示越容易、间隔增长越快 | `2.5` |
| `n`（repetitions） | 连续答对次数（一旦 `again` 归 0） | `0` |
| `I(n)`（interval_days） | 第 n 次后的间隔（天） | `0` |
| `q`（grade） | 本次评分 `0..5` | — |

#### 7.1.2 间隔公式（标准 SM-2）

```
I(0) = 0                       （新卡，未复习）
I(1) = 1                       （第一次答对 → 1 天后）
I(2) = 6                       （第二次答对 → 6 天后）
I(n) = I(n-1) × EF   (n ≥ 3)   （之后按 EF 倍增）
```

#### 7.1.3 EF 更新公式（标准 SM-2）

```
EF' = EF + (0.1 - (5 - q) × (0.08 + (5 - q) × 0.02))
```

代入各 q 值的增量（便于核对）：

| q | ΔEF |
|---|---|
| 5 | +0.100 |
| 4 | +0.028 |
| 3 | -0.140 |
| 2 | -0.320 |
| 1 | -0.520 |
| 0 | -0.800 |

约束：`EF' = max(1.3, EF')`（EF 不低于 1.3，否则间隔无法增长）。

#### 7.1.4 repetitions 与遗忘（lapse）规则

- 若 `q >= 3`（即 hard/good/easy）：视为「答对」，`n := n + 1`，按 §7.1.2 算新间隔。
- 若 `q < 3`（即 again）：视为「遗忘」，`n := 0`，新间隔 = `1` 天（回到 I(1)），`lapsed_count += 1`。EF 仍按 §7.1.3 更新（会下降）。

> 注：本映射下 UI 的四档里只有 `again(q=0)` 触发遗忘；`hard(q=3)` 虽 EF 下降但仍计入答对，避免「困难」动辄归零造成体验挫败。

#### 7.1.5 完整伪代码（`lib/sm2.ts`，纯函数）

```ts
// 四档映射
const GRADE_MAP = { again: 0, hard: 3, good: 4, easy: 5 } as const;
type GradeLabel = keyof typeof GRADE_MAP;

interface SchedState {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
}

interface SchedResult extends SchedState {
  next_interval_days: number;
  next_due_at: number; // ms 时间戳
}

/**
 * 计算「下一间隔」：I(1)=1, I(2)=6, I(n)=I(n-1)*EF
 */
function nextInterval(n: number, ef: number, prevInterval: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  if (n === 2) return 6;
  return Math.round(prevInterval * ef);
}

/**
 * SM-2 调度核心：输入当前状态 + 评分，输出新调度状态与到期时间。
 * 纯函数，无副作用，便于单测。
 * @param prev     当前卡片调度状态
 * @param label    UI 四档评分
 * @param nowMs    当前时间戳（ms），默认 Date.now()
 */
export function schedule(prev: SchedState, label: GradeLabel, nowMs = Date.now()): SchedResult {
  const q = GRADE_MAP[label];
  let { ease_factor: ef, interval_days: ivl, repetitions: n } = prev;

  // 1) EF 更新（标准 SM-2 公式，下限 1.3）
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ef = Math.max(1.3, ef);

  // 2) repetitions 与间隔
  if (q < 3) {
    // 遗忘：归零，1 天后重见
    n = 0;
    ivl = 1;
  } else {
    // 答对：n++ 并按公式递推
    n = n + 1;
    ivl = nextInterval(n, ef, ivl);
  }

  // 3) 到期时间戳（ms）：now + interval_days 天（向上取整天，避免浮点漂移）
  const next_due_at = nowMs + ivl * 24 * 3600 * 1000;

  return {
    ease_factor: round2(ef),
    interval_days: ivl,
    repetitions: n,
    next_interval_days: ivl,
    next_due_at,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;
```

#### 7.1.6 新卡初始化

新卡（`createCard`）入库存入：`ease_factor=2.5, interval_days=0, repetitions=0, due_at=created_at`（即「立即可学」）。首次评分走 §7.1.5：`good` → `n=1, ivl=1, due=明天`。

#### 7.1.7 单测要点（见 §10）

- EF 各 q 增量与上表一致；EF 下限 1.3 生效。
- `again` 后 `repetitions=0`、`interval=1`。
- 连续 4 次 `good` 的间隔序列：1 → 6 → 15 → 37.5≈38（EF=2.5）。
- `due_at = now + interval*86400000`。

#### 7.1.8 `reviewCard` 落库流程（事务）

```ts
// electron/services/learning.ts
const reviewCard = db.transaction((input: ReviewInput) => {
  const card = getCard(input.card_id);               // 读当前调度
  const prev = { ease_factor: card.ease_factor, interval_days: card.interval_days, repetitions: card.repetitions };
  const r = schedule(prev, input.grade_label);        // 纯函数算

  // 1) 写 review_log（含 prev/next 快照）
  const logId = uuid();
  db.prepare(`INSERT INTO review_log (...) VALUES (...)`).run({
    id: logId, card_id: card.id, grade: GRADE_MAP[input.grade_label], grade_label: input.grade_label,
    prev_ease_factor: prev.ease_factor, prev_interval_days: prev.interval_days, prev_repetitions: prev.repetitions,
    next_ease_factor: r.ease_factor, next_interval_days: r.next_interval_days, next_repetitions: r.repetitions,
    next_due_at: r.next_due_at, elapsed_ms: input.elapsed_ms ?? null, reviewed_at: Date.now(),
  });

  // 2) 更新 cards 调度 + 计数
  const lapsed = input.grade_label === 'again' ? 1 : 0;
  db.prepare(`UPDATE cards SET ease_factor=?, interval_days=?, repetitions=?, due_at=?,
              reviewed_count = reviewed_count + 1, lapsed_count = lapsed_count + ?, updated_at=? WHERE id=?`)
    .run(r.ease_factor, r.interval_days, r.repetitions, r.next_due_at, lapsed, Date.now(), card.id);

  return { card: { ...card, ...r }, log: { id: logId } };
});
```

> `undoReview`：取该卡最近一条 `review_log`，用其 `prev_*` 字段回写 `cards`，并删除该条 log（或标记撤销）。

---

### 7.2 每日复习计划（LRN-02）

「计划」本质是「按规则从 `cards` 取出一组待复习卡 + 一组新卡，组成今日队列」。

#### 7.2.1 到期判定

到期卡：`status='active' AND deleted_at IS NULL AND due_at <= now`。

#### 7.2.2 三种模式（`getDueQueue`）

- **`today`**（默认）：先取到期复习卡（`due_at <= now`，按 `due_at` 升序——最该复习的在前），再补充新卡（`repetitions=0`），新卡数量受 `newPerDay` 上限约束（来自 settings，默认 20）。复习卡与新卡的先后由 `reviewOrder`（`reviews_first` / `new_first` / `mixed`）决定。
- **`all`**：忽略到期，取该 deck 全部 active 卡（用于临时突击），仍按 `due_at` 升序。
- **`random`**：从 active 卡中随机取 `limit` 张（用于自测/乱序复习）。

#### 7.2.3 查询 SQL（today 模式核心）

```sql
-- 到期复习卡
SELECT * FROM cards
WHERE deck = :deck AND status = 'active' AND deleted_at IS NULL
  AND repetitions > 0 AND due_at <= :now
ORDER BY due_at ASC
LIMIT :reviewLimit;

-- 新卡补充
SELECT * FROM cards
WHERE deck = :deck AND status = 'active' AND deleted_at IS NULL
  AND repetitions = 0
ORDER BY created_at ASC
LIMIT :newPerDay;
```

> 合并后在 service 层按 `reviewOrder` 重排；前端 store 按 `cursor` 顺序消费。

#### 7.2.4 上限保护

- `reviewLimit`：默认无上限（到期就复习）；可在 settings 配置「每日复习上限」，超过则截断并提示「今日还有 N 张待复习」。
- `newPerDay`：默认 20，防止新卡洪流压垮复习节奏。

---

### 7.3 卡片来源（LRN-03）

四种来源共用 `cards` 表，靠 `source` / `source_ref` 区分，落库走同一个 `createCard(s)`。

#### 7.3.1 阅读页一键加卡（`source='reading'`）

- 触发：阅读页选中文字 → 右键/快捷键（RD-09）「加入记忆卡」，或解读栏「本段加卡」。
- 入参：`front`=选中原文/段落、`back`=AI 译文/用户填写的解读、`paragraph_id`/`chapter_id`/`book_id` 自动带、`type` 默认 `'original_to_interpret'`。
- 去重：同 `paragraph_id` + `front` 已存在时，弹确认「该卡已存在，是否覆盖/跳过」。

#### 7.3.2 AI 批量生成（`source='ai_batch'`，对接 AI-06）

- AI 模块对选定段落调用 DeepSeek，返回 `CardDraft[]`（`{front, back, type, paragraph_id}`）。
- LRN 提供 `AiCardsConfirm` UI：列出草稿，用户勾选/编辑/删除 → 调 `createCardsBatch` 单事务入库。
- `source_ref` 存 `ai_cache.id`，便于追溯生成来源；AI 失败（AI-07）时该流程不可用，但不影响其它来源。

#### 7.3.3 测验错题转卡（`source='quiz_error'`，见 §7.4.4）

- 错题转卡：`front`=题干、`back`=正确答案+解析、`type` 按题型映射（judge→term_to_meaning 等）、`deck='quiz-errors'`。
- 幂等：`quiz_results.turned_to_card=1` 后不再转，返回已存在的卡。

#### 7.3.4 手写卡片（`source='manual'`）

- `CardEditor` 自由填写 front/back、选 type、可选绑定段落（不绑则为纯手写卡）。

---

### 7.4 测验（LRN-05）

#### 7.4.1 出题（`generateQuiz`）

- 输入：`book_id?` / `chapter_id?`（范围）、`count`、`qtypes: ('choice'|'match'|'judge')[]`。
- 题源策略（优先级）：
  1. **规则生成（本地，默认）**：从 `paragraphs` 取原文/译文/术语，按模板生成——如 `judge` 取原文陈述 + 正确性翻转；`choice` 取一个术语 + 干扰项（同章节其它术语）；`match` 取多对术语-释义。
  2. **AI 生成（可选，P2）**：当规则题量不足或用户勾选「AI 出题」，调 AI 模块生成更高质量题干（走 AI-06 类似 prompt），失败降级回规则（AI-07）。
- 生成结果写入 `quiz_questions`（首次生成可缓存复用），并创建 `session_id`。

#### 7.4.2 作答与判分（`submitQuizAnswer`）

- 渲染：`QuizView` 按 `qtype` 渲染对应交互（单选 / 拖拽匹配 / 是非）。
- 判分：`choice` 比对 `correct_key`；`match` 比对完整映射；`judge` 比对 `is_true`。
- 写 `quiz_results`：`is_correct`、`user_answer`、`time_spent_ms`。

#### 7.4.3 会话结算（`finishQuizSession`）

返回 `SessionSummary`：总数、正确数、正确率、错题列表（含正确答案与解析）。

#### 7.4.4 错题转卡流程（`turnErrorToCard`）

```
quiz_results(is_correct=0) → turnErrorToCard(result_id)
   → 读 quiz_question（stem/payload/answer/explanation/chapter_id）
   → 构造 CardInput{ front=stem, back=answer+explanation, source='quiz_error',
                     deck='quiz-errors', chapter_id, paragraph_id, type=映射 }
   → createCard（单事务内：UPDATE quiz_results SET turned_to_card=1）
   → 返回 Card
```

题型→卡片 type 映射：`choice/judge → 'term_to_meaning'`、`match → 'title_to_points'`（或多选拆成多张术语卡，按 payload 处理）。

---

### 7.5 学习仪表盘（LRN-06）

聚合查询均走 `learning:getDashboard` / `learning:getHeatmap`，主进程 SQL 聚合后返回 DTO。

#### 7.5.1 掌握度（Mastery）

定义：以卡为粒度的「掌握」比例。掌握判定 = `repetitions >= 2 AND interval_days >= 7 AND ease_factor >= 2.3`（即已稳定进入长间隔复习）。

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN repetitions >= 2 AND interval_days >= 7 AND ease_factor >= 2.3 THEN 1 ELSE 0 END) AS mastered
FROM cards WHERE status='active' AND deleted_at IS NULL;
-- mastery = mastered / total
```

> 阈值集中在 service 常量，可按用户反馈调整。

#### 7.5.2 复习热力图（Heatmap）

```sql
-- 按日聚合复习次数（review_log）
SELECT date(reviewed_at/1000,'unixepoch','localtime') AS day, COUNT(*) AS cnt
FROM review_log
WHERE reviewed_at >= :yearStart AND reviewed_at < :yearEnd
GROUP BY day;
```

返回 `{ '2026-06-16': 42, ... }`，前端 `Heatmap` 渲染 GitHub 风格方格。

#### 7.5.3 连续学习天数（streak）

从今天起向前回溯：连续每天都有 `review_log` 记录的最大天数。逻辑：

```
lastDay = today
streak = 0
while (countReviewLogOn(lastDay) > 0) {
  streak++; lastDay = lastDay - 1day
}
// 注：若今天还没复习，允许从昨天起算（"今日未断"宽容）
```

纯本地计算，存内存即可（不落库，按需重算）。

#### 7.5.4 薄弱章节推荐（WeakChapters）

基于「该章节卡片的遗忘率 + 复习量」排序：

```sql
SELECT c.chapter_id,
       ch.title,
       COUNT(*)                 AS card_count,
       SUM(c.lapsed_count)      AS total_lapse,
       AVG(c.lapsed_count * 1.0 / MAX(c.reviewed_count,1)) AS lapse_rate
FROM cards c LEFT JOIN chapters ch ON ch.id = c.chapter_id
WHERE c.status='active' AND c.deleted_at IS NULL AND c.chapter_id IS NOT NULL
GROUP BY c.chapter_id
HAVING card_count >= 3          -- 卡片过少的章节不参与推荐（噪声）
ORDER BY lapse_rate DESC, total_lapse DESC
LIMIT 5;
```

返回 Top 5 薄弱章节，点击 → 跳转阅读该章 / 一键生成该章测验。

#### 7.5.5 DashboardDTO

```ts
interface DashboardDTO {
  totalCards: number;
  dueToday: number;
  mastered: number;
  masteryRate: number;          // 0..1
  streak: number;
  heatmap: Record<string, number>; // day → count（默认近 365 天）
  weakChapters: { chapter_id: string; title: string; card_count: number; lapse_rate: number }[];
  recent7: { day: string; reviewed: number; again: number }[]; // 近 7 日趋势
}
```

---

## 8. 错误处理与边界

| 场景 | 处理 |
|---|---|
| `reviewCard` 时卡片已被软删除 | service 抛 `AppError(code='NotFound')`；前端跳过该卡、`next()` |
| `reviewCard` 事务中途失败（DB 锁等） | `db.transaction` 整体回滚，cards 与 review_log 一致；前端 `submitting=false` 并提示重试 |
| `undoReview` 无历史 log | 抛 `AppError(code='NotFound', details='no history')`；前端禁用撤销按钮 |
| 队列为空（today 模式无到期卡） | 返回空数组；UI 显示「今日已完成，去加新卡或随机复习」 |
| 新卡数超 `newPerDay` | 截断；UI 提示剩余新卡数 |
| AI-06 草稿确认入库时部分草稿非法（front 为空等） | service 逐条校验，跳过非法项并返回 `{ created, skipped, errors[] }`；不整批失败 |
| `generateQuiz` 规则题量不足（章节段落太少） | 降级：减少 count 或提示「内容不足，建议导入更多/切换章节」；AI 出题失败（AI-07）回退规则 |
| 错题转卡重复点击 | 幂等：`turned_to_card=1` 直接返回原卡 id |
| 时区/跨日 | `due_at` 存 ms 绝对值；热力图按 `localtime` 聚合，避免 UTC 偏移导致 streak 误判 |
| EF 长期被「困难」压到下限 | EF 已有 `max(1.3,·)` 下限；另可在仪表盘提示「该卡过难，建议重写或拆分」 |

---

## 9. 依赖关系

### 9.1 依赖（本模块需要）

- **IMP**：`paragraphs`（`paragraph_id`、`text`、`content_modern`、`content_explanation`）、`chapters`（`chapter_id`、`title`）。测验规则出题、阅读加卡的绑定均依赖。
- **AI 模块**：`CardDraft[]`（AI-06 产出）、可选 AI 出题。LRN 只消费 DTO，不直接调 DeepSeek。
- **SET**：`settings`（`newPerDay`、`reviewLimit`、`reviewOrder`、目标保留率等偏好）。
- **lib/sm2.ts**：纯函数，无外部依赖。

### 9.2 被依赖（其它模块调用本模块）

- **RD**：阅读页调 `learning:createCard`（一键加卡 / 快捷键）。
- **AI**：AI-06 确认入库调 `learning:createCardsBatch`。
- **Dashboard/全局**：仪表盘可作为独立入口（状态机式路由，架构 §2）。

### 9.3 共享类型（`electron/models/learning.ts` + `src/lib/types.ts`）

`Card`、`CardInput`、`ReviewInput`、`ReviewResult`、`DueQueueInput`、`DashboardDTO`、`QuizQuestion`、`QuizAnswerInput`、`SessionSummary`、`CardDraft`（与 AI 模块共享）、`GradeLabel`。

---

## 10. 测试策略

### 10.1 单元测试（Vitest，`services/` 与 `lib/`）

- **`lib/sm2.ts`（重点）**：
  - EF 增量表：各 q（0/3/4/5）的 ΔEF 与 §7.1.3 表一致。
  - EF 下限：连续多次 `again` 后 EF 收敛到 1.3 而非更低。
  - 间隔序列：连续 4 次 `good` → `1, 6, 15, 38`（EF=2.5）。
  - 遗忘：`again` 后 `repetitions=0`、`interval=1`、`due_at=now+1d`。
  - 新卡首次 `good`：`n=1, ivl=1`。
- **`services/learning.ts`**：
  - `getDueQueue` 三模式：构造不同 `due_at`/`repetitions` 的卡，验证 today/all/random 的取数与排序。
  - `reviewCard` 事务：写 log + 更新 cards 的一致性；`prev_*`/`next_*` 快照正确。
  - `undoReview`：回滚后 cards 调度恢复到 prev，log 删除/标记。
  - `turnErrorToCard` 幂等：二次调用不新增卡。

### 10.2 集成测试（`ipc/learning.ts`，mock DB）

- 端到端：createCard → getDueQueue(today) → reviewCard(good) → due_at 推到明天 → getDueQueue(today) 不再含该卡。
- 测验：generateQuiz → submitQuizAnswer（对/错）→ finishQuizSession → turnErrorToCard → 卡片库出现 quiz-error 卡。

### 10.3 前端测试（Vitest + Testing Library）

- 翻卡状态机：`showingFront --Space--> showingBack --grade('good')--> graded --> next`。
- 键盘映射：`1/2/3/4` 触发对应 grade。
- 仪表盘：mock `getDashboard` 数据，渲染热力图/streak/薄弱章节。

### 10.4 夹具

- 准备一组卡片夹具（新卡 / 到期卡 / 高 EF / 低 EF / 遗忘卡），覆盖调度分支。
- 测验夹具：三种 qtype 各若干题（含正确/错误作答）。

---

## 11. 开放问题

1. **SM-2 变体是否引入「 fuzz 」/「提前/延后」分散？** 标准 SM-2 会让同批卡在同一天到期（聚簇）。Anki 引入随机 fuzz（±5%~25%）打散。本期先按标准 SM-2 实现（可预测、易测），fuzz 作为 `settings` 开关留待 P2。
2. **目标保留率与 FSRS**：是否在 P2 引入基于「目标保留率」的自适应算法（如 FSRS）替代 SM-2？SM-2 字段已预留（ease_factor/interval/repetitions 可平滑迁移），但 FSRS 需额外 `difficulty`/`stability` 字段。暂不引入。
3. **AI 出题质量与审核**：AI 生成的测验题可能存在事实错误（尤其中医典籍）。是否在 `quiz_questions` 增加 `verified` 字段 + 用户标记纠错？本期依赖免责声明（SET-05）+ 解析展示，标记纠错留待反馈。
4. **卡片多媒体（配图→名称，LRN-01 type 之一）**：`image_to_name` 需要 `assets/` 图引用，依赖 AI 配图（AI-03，P2）。本期表结构预留 `back` 可存 `local://` 路径，UI 渲染随 AI-03 落地。
5. **跨 deck 全局复习 vs 分 deck**：当前 `getDueQueue` 默认查 `'default'` deck，多书多 deck 时是否提供「全局混合复习」？需 UX 决策（倾向提供 `deck='*'` 选项）。
6. **复习数据是否随备份导出（SET-03）**：cards/review_log/quiz_* 在 `app.db` 内，天然随整库导出；是否额外提供「仅导出/导入卡片包（.apkg 类似）」用于分享？本期不做。
