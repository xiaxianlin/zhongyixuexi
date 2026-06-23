# 进度看板（PROGRESS）— 唯一进度事实来源

> 驱动规则见 `loop-engineering.md`。每轮循环首读本文件取下一个 `todo`,末写更新。
> 状态：`todo` / `doing` / `done` / `blocked` / `skipped`

最后更新：2026-06-23（Phase 9 详情页改造 v3.1 启动 · D1 完成）

---

## ⚠️ 关于本文档的本次重写

本项目在 Phase 0–7 完成后经历了一次**产品收敛重构**,大量已"done"的功能被刻意移除/简化,但本文档此前仍按原始愿景记录。为避免文档误导,本次按**当前代码真实形态**重写:

- **迁移机制**:从"forward-only migrations v1~v10"改为 `electron/db/schema.ts` 单一 `CURRENT_SCHEMA`(`CURRENT_SCHEMA_VERSION=2`),版本不符即 `resetDbFiles()` 删库重建(仅适用开发期)。
- **内容来源**:从"用户导入 EPUB"改为**内置三本中医经典**(`data/{nanjing,suwen,lingshu}-original.json`,`seedBuiltinContent()` 启动时 seed)。
- **已移除的模块/能力**:导入 UI、段级校对、书签、记忆卡/SM-2/测验、双链/笔记本/标签、术语词典/知识图谱、备份导入导出、书籍文件管理。
- **留存的核心**:三栏书籍详情页(章/段/AI 解读)、段级 AI 白话解读、FTS5 全文检索、段绑定笔记 CRUD、AI 凭证(safeStorage)、阅读足迹仪表盘。

下方表格按当前实际形态重排;旧 vision 的完整历史归档见文末「变更日志(重构前)」。

---

## 当前功能边界(以代码为准)

### 数据库(`electron/db/schema.ts`)

**现存 9 张表 + 1 张 FTS5 虚拟表**:

| 表 | 用途 |
|---|---|
| `books` | 书籍元信息(内置经典) |
| `chapters` | 章节层级(自引用 parent_id) |
| `paragraphs` | 段落正文(稳定 ID + parse_hash + rowid,FTS5 锚定) |
| `reading_progress` | 段级阅读进度(按 book_id 唯一) |
| `settings` | KV 设置 |
| `api_credentials` | AI 凭证(safeStorage 加密) |
| `notes` | 段绑定 Markdown 笔记 |
| `ai_cache` | AI 解读缓存(prompt_hash 命中) |
| `paragraph_analyses` | 段落解读版本化(active 唯一索引) |
| `fts_paragraphs` | FTS5 虚拟表(content='paragraphs', trigram) |

**不再存在的表**:`bookmarks / cards / review_log / quiz_questions / quiz_results / dictionary_terms / term_occurrences / tags / tag_refs / notebooks / note_links / entities / relations`。

### IPC 通道(`electron/ipc/`)

仅 12 个 channel,全部经 `electron/ipc/registry.ts` 的 `handle()` 信封包装:

| 模块 | Channel |
|---|---|
| library | `library:list` · `library:tree` |
| reading | `reading:getChapter` |
| search | `search:fulltext` |
| ai | `ai:status` · `ai:generateModern` |
| notes | `notes:create` · `notes:delete` · `notes:getByParagraph` |
| settings | `settings:listProviders` · `settings:saveProvider` · `settings:setActiveProvider` |
| learning | `learning:getDashboard` |

渲染进程经 `src/lib/*-api.ts`(`invokeRaw`)调用;preload(`electron/preload/index.ts`)只暴露 `{invoke, on}`。

---

## Phase 0 · 工程脚手架(done)
Exit:空壳可启动、质量门可跑、`window.api` 类型可用。

| # | 状态 | 摘要 |
|---|---|---|
| S0.1 | done | Electron+React+Vite+TS 工程初始化(无 `type:module`,main/preload 出 CJS) |
| S0.2 | done | 目录骨架(electron/* + src/modules/{8模块}) |
| S0.3 | done | better-sqlite3 + 连接初始化(`foreign_keys=ON`、WAL) |
| S0.4 | done | IPC 基建:`{__ok}` 信封 + `AppError` + `src/lib/ipc.ts` |
| S0.5 | done | 主题 token + 应用 shell + `session`/`ui` store |
| S0.6 | done | 质量门 `npm run check`(tsc + eslint + vitest) |

- [x] Phase 0 exit 达成

---

## Phase 1 · 内容与书库(done · 重构后形态)
Exit:内置经典 seed → 书库浏览 → 章节树 → 段落 → 详情页。

| # | 状态 | 摘要 |
|---|---|---|
| S1.1 | done | schema:`books / chapters / paragraphs`(双键 + 软删 + 级联) — 现归入单一 `schema.ts` |
| S1.2 | done | FTS5 `fts_paragraphs`(trigram + ai/ad/au 触发器,软删/噪声过滤) |
| S1.3 | done | 内置经典 seed(`builtin-content.ts`,读 `data/*-original.json`,事务写库 + rebuildFts) |
| S1.4 | done | 书库浏览 + 章节树(`library:list` 进度聚合、`library:tree` 内存建树) |
| S1.5 | done | 书籍详情页(`LibraryView`/`BookDetail`,章/段/析三栏 + 段绑定笔记 + AI 解读) |

> **已移除(原 PRD IMP-01~08 / LIB-03~04)**:EPUB 导入 UI、段级校对编辑器、章级编辑、去重、书籍元信息编辑、删除级联 UI。EPUB 解析服务代码(`electron/services/epub.ts` 等)与导入中间格式见 `docs/dev/book-import-json.md`,保留为内容生产工具链,不在应用运行路径内。

- [x] Phase 1 exit 达成

---

## Phase 2 · 阅读(done · 收敛后形态)
Exit:书籍详情页内可流畅阅读章节段落、AI 解读对齐。

| # | 状态 | 摘要 |
|---|---|---|
| S2.1 | done | 三栏详情页布局(章目录 / 段列表 / 析面板),古风排版 |
| S2.2 | done | 段级阅读进度(`reading_progress`,按 book_id 唯一) |
| S2.3 | done | 段落选择 + 解读面板联动(白话/医理/解读) |

> **已移除(原 RD)**:独立三栏工作台、拖拽调宽/折叠、布局预设、繁简/拼音、逐段锁定同步滚动、词条浮窗、沉浸模式、多 Tab/多窗、快捷键体系、书签、RD 模块目录(`src/modules/reading/` 仅剩 `types.ts`)。阅读能力收敛进 `src/modules/library/LibraryView.tsx` 的 `BookDetail`。

- [x] Phase 2 exit 达成

---

## Phase 3 · 检索(done · 收敛后形态)
Exit:跨书搜词命中段落可跳转。

| # | 状态 | 摘要 |
|---|---|---|
| S3.1 | done | 全文检索(FTS5 trigram + BM25 + snippet 高亮),`search:fulltext` |
| S3.2 | done | 结果列表 + 全库高亮(`<mark>` 安全渲染),命中跳转书库详情段 |

> **已移除(原 SRH)**:术语词典(`dictionary_terms`/`term_occurrences`)、结构化筛选、知识图谱(`entities`/`relations`)、向量检索。`searchParagraphs` 仍作为 AI RAG 检索基础保留。

- [x] Phase 3 exit 达成

---

## Phase 4 · 设置与凭证(done · 收敛后形态)
Exit:可配 AI Key、切主题/字号。

| # | 状态 | 摘要 |
|---|---|---|
| S4.1 | done | AI 凭证:safeStorage 加密 + 机器绑定 AES fallback(`electron/lib/keystore.ts`),`api_credentials` 表 |
| S4.2 | done | 设置面板 + 主题/字号(`src/modules/settings/SettingsView.tsx`) |

> **已移除(原 SET)**:数据备份导出/导入(`.tcmz`、`backup.ts` 已删)、书籍文件管理(scanOrphans/cleanOrphans)、免责声明门/页脚。SET 现仅暴露 provider CRUD(3 channel)。

- [x] Phase 4 exit 达成

---

## Phase 5 · AI 增强(done · 收敛后形态)
Exit:DeepSeek 段级白话解读可用、断网降级、缓存生效。

| # | 状态 | 摘要 |
|---|---|---|
| S5.1 | done | DeepSeek 客户端(fetch + 重试 + 错误映射,`electron/ai/deepseek.ts`) |
| S5.2 | done | `ai_cache`(prompt_hash 命中,段落编辑后 hash 变避免误命中) |
| S5.3 | done | 段级白话解读 → 写 `paragraph_analyses` active 版本 + `ai_cache`(`ai:generateModern`) |
| S5.4 | done | 三层红线拦截 + 失败降级(`guard.ts`、`DegradedNotice`) |

> **已移除(原 AI)**:RAG 智能问答(`ask`/`rag.ts` 接口已删)、记忆卡批量生成(`generateCards`)、配图、TTS、结构化标注。留存:段级解读 + 缓存 + 降级。

- [x] Phase 5 exit 达成

---

## Phase 6 · 学习足迹(done · 收敛后形态)
Exit:阅读足迹仪表盘可见。

| # | 状态 | 摘要 |
|---|---|---|
| S6.1 | done | 学习足迹仪表盘(`learning:getDashboard`):书/章/段总数、已解读段、解读率、笔记数、活跃阅读书、阅读秒数、热力图、最近书 |

> **已彻底移除(原 LRN)**:SM-2 记忆卡、翻卡 UI、每日复习计划、测验、错题转卡、掌握度/薄弱章节。`learning.ts` service 注释明确写明:"The current product no longer has review cards or quizzes. Learning is the user's real reading/study footprint."

- [x] Phase 6 exit 达成

---

## Phase 7 · 笔记(done · 收敛后形态)
Exit:段绑定笔记可增删查。

| # | 状态 | 摘要 |
|---|---|---|
| S7.1 | done | `notes` 表 + 段绑定笔记 CRUD(`notes:create` / `notes:delete` / `notes:getByParagraph`) |

> **已彻底移除(原 NOTE)**:双链 `[[ ]]`、`note_links`、`wikiLinks` 解析、backlinks、标签/笔记本(`tags`/`tag_refs`/`notebooks`)、导出 MD/HTML/PDF、笔记全文搜索。笔记退化为段绑定的轻量文本,UI 在 `BookDetail` 的抽屉/弹窗内。

- [x] Phase 7 exit 达成

---

## Phase 8 · 打包发布(doing)

| # | 状态 | 摘要 | 决策/阻塞 |
|---|---|---|---|
| S8.1 | doing | electron-builder(Win nsis / macOS dmg) + forward-only 迁移 | 迁移已重写为 forward-only(`migrate.ts`):v3 库升级保留数据,v0/v2 旧开发库 reset 重建(首版无真实用户)。electron-builder 配置已补全(macOS dmg arm64/x64 + Win nsis x64),`npm run dist:mac` 出 dmg。图标待补(build/icon.icns/.ico) |
| S8.2 | todo | 更新策略(前端热更 + electron-updater) | 首版延后,手动下载;macOS 自动更新需代码签名 |
| S8.3 | todo | 内置经典数据回归夹具 | 原为 EPUB 夹具,现改为校验 `data/*.json` seed 一致性 |

- [ ] Phase 8 exit 达成

---

## Phase 9 · 详情页改造 v3.1（doing）

> 来源：`docs/idea/20260622.md` · PRD `docs/prd/20260622-detail-revamp.md` · 技术 `docs/tech/20260622-detail-revamp.md` · 计划 `docs/dev/IMPLEMENTATION-v3.1.md`
> Exit：章级阅读 + 选区三连（摘录/笔记/引用）+ 章级 AI（解读/医理/白话）+ 对话 + 竖排 6 Tab 析栏。

| # | 状态 | 摘要 | 决策/阻塞 |
|---|---|---|---|
| D1 | done | schema v4 迁移（chapters.content/updated_at · chapter_analyses · excerpts · notes 选区列 · ai_threads/messages · ai_cache 重建扩 scope/kind · fts_chapters trigram + 三触发器） | 迁移幂等（columnExists / IF NOT EXISTS / aiCacheIsNarrow 守卫）；chapters.content 回填用 `\n\n` 拼 live paragraphs；builtin-content seed 同步写 content + updated_at；`books.category` backfill：五本内置经典→classic，其余→modern；ai_cache 重建段落_id 改可空。`npm run check` 绿（105 测试） |
| D2 | todo | 分类分组 + 多级章节树 UI（复用现有 buildChapterTree） |  |
| D3 | todo | 章级阅读区 + 文本选区 + 摘录 + 正文编辑（重新锚定） |  |
| D4 | todo | 章级 AI（解读/医理/白话）+ 析侧栏竖排 6 Tab |  |
| D5 | todo | 对话 + 引用 + 流式 token |  |
| D6 | todo | 笔记选区化（章 + 选区） |  |
| D7 | todo | 打磨 + NFR（虚拟滚动 / a11y / qa-review） |  |

- [ ] Phase 9 exit 达成

---

## 关键决策与约束(当前)

1. **schema 单源**:`electron/db/schema.ts` 是唯一 DDL 来源,`CURRENT_SCHEMA_VERSION=3`。`prepareDatabase()` + `migrate.ts` `runMigrations()` 走 forward-only:v3 库升级保留数据,v0/v2 旧开发库 reset 重建。新 schema 改动在 `migrate.ts` 的 `MIGRATIONS[]` 加一条 + bump version。
2. **内置内容**:启动 `seedBuiltinContent()` 幂等 seed 三本经典(难经/素问/灵枢),已存在则跳过。
3. **IPC 收紧**:preload 只暴露 `{invoke, on}`;模块 API 在 `src/lib/*-api.ts` 用 `invokeRaw('module:action')` 包装。
4. **foreign_keys=ON**:每连接强制(`connection.ts`),否则 CASCADE 静默失效。
5. **paragraphs 双键**:`id TEXT PK`(稳定)+ 隐式 `rowid`(FTS5 `content_rowid`),不可破坏。
6. **FTS 同步归 IMP**:ai/ad/au 触发器 + `rebuildFts`,别处只读。

---

## 变更日志

- 2026-06-18:**文档对齐重构**。本次重写按代码现状校正:迁移机制(reset 式)、内置经典(替换 EPUB 导入)、已移除模块清单(导入/卡片/测验/双链/词典/备份等)。旧愿景历史见下方「变更日志(重构前)」。
- 2026-06-16 ~ 2026-06-17:详见「变更日志(重构前)」。

---

## 变更日志(重构前 · 原始愿景历史)

> 以下保留重构前的逐 slice 记录,反映"原始 8 Phase / 39 slice 全 done"的过程,供追溯设计意图。注意其中大量产出已在重构中删除(见各 Phase「已移除」标注)。

- 2026-06-16:初始化看板,8 Phase / 39 slice,全 todo。
- 2026-06-16:S0.1 完成 — Electron+React+Vite+TS 脚手架可启动,typecheck + build 全绿。
- 2026-06-16:S0.2 完成 — 按 00-architecture §3 建立完整目录骨架。
- 2026-06-16:S0.3 完成 — better-sqlite3 集成、foreign_keys=ON、迁移 runner 骨架。
- 2026-06-16:S0.4 完成 — IPC 基建(信封式结构化错误 + 类型化调用层)。
- 2026-06-16:S0.5 完成 — 主题 token + Zustand ui/session store + 应用 shell。
- 2026-06-16:S0.6 完成 — 质量门 `npm run check` 全绿(tsc + eslint + vitest)。**Phase 0 exit 达成。**
- 2026-06-16:S1.1 完成 — content schema(books/chapters/paragraphs 双键 + 级联 + 软删)。
- 2026-06-16:S1.2 完成 — EPUB 解析服务(container/opf/ncx/nav 纯解析器 + parseEpub 编排)。
- 2026-06-16:S1.3/S1.4/S1.6 完成(subagent 并行)— 段落切分+导入编排 / FTS5 trigram 同步触发器 / 书库+目录树+级联删除。
- 2026-06-16:S1.5 完成 — import/library/segment IPC + 书库/目录树/段级校对 UI + 端到端集成检查。**Phase 1 exit 达成。**
- 2026-06-16:Phase 2(RD)+3(SRH) 完成(dev-rd/dev-srh agent 并行)— 三栏阅读工作台/段级进度/书签/同步滚动/快捷键;FTS5 全文检索+全库高亮+术语词典。**Phase 2 & 3 exit 达成。**
- 2026-06-16:Phase 4(SET)+6(LRN)+7(NOTE) 完成(dev-set/dev-lrn/dev-note agent 并行)— safeStorage Key/备份/设置、SM-2 记忆卡/测验/仪表盘、笔记/双链/导出。**Wave 1 全完,Phase 4/6/7 exit 达成。**
- 2026-06-16:Phase 5(AI) 完成(dev-ai agent)— DeepSeek 客户端/ai_cache/白话解读/RAG 问答/失败降级/三层红线/AI 卡片。**所有功能模块(Phase 0-7)就绪,剩 Phase 8 打包。**
- 2026-06-16:导入解析流程调整 — EPUB 导入改为"全书 AI 解析"主路径;schema v10 `ai_generation_tasks`(注:此迁移版本号体系已被后续 reset 式 schema 取代)。
- 重构期(2026-06-16 之后,跨多个 commit):
  - `refactor(notes): keep paragraph note surface only` — 笔记收缩为段绑定 CRUD。
  - `refactor(ipc): expose only current app surface` — IPC 从 50+ 收缩到 12 个。
  - `refactor(db): drop legacy data compatibility` — 移除兼容层,改为 reset 式 schema。
  - `test(integration): cover current study surfaces` — 集成测试对齐收敛后形态。
  - `feat: split neijing into suwen+lingshu, rename nanjing, drop prefaces` — 内置经典整理为三本独立书。
