# 进度看板（PROGRESS）— 唯一进度事实来源

> 驱动规则见 `loop-engineering.md`。每轮循环首读本文件取下一个 `todo`，末写更新。
> 状态：`todo` / `doing` / `done` / `blocked` / `skipped`

最后更新：2026-06-16（导入改为全书 AI 解析 + 段落任务创建；剩 Phase 8 打包）

---

## Phase 0 · 工程脚手架
Exit：空壳可启动、质量门可跑、`window.api` 类型可用。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S0.1 | done | git init + Electron+React+Vite+TS 工程初始化、.gitignore | package.json, electron.vite.config.ts, tsconfig{,.node,.web}.json, electron/{main,preload}/index.ts, index.html, src/{main.tsx,App.tsx,global.d.ts,styles/main.css}, .gitignore, .npmrc | electron-vite v3（支持 vite6）；去掉 type:module 使 main/preload 输出 CJS index.js 匹配引用；npmmirror 源；烟雾测试启动 7s 无报错 |
| S0.2 | done | 目录骨架（electron/* + src/*） | electron/{services,db,ipc,ai,models,lib}/*/.gitkeep, src/modules/{8模块}/*/.gitkeep, src/{stores,lib,components}/.gitkeep | 与 00-architecture §3 完全对齐；.claude/ 纳入 gitignore 并取消跟踪 |
| S0.3 | done | better-sqlite3 集成 + 连接初始化(PRAGMA foreign_keys=ON) + 迁移runner骨架 | electron/db/{connection,migrate,index}.ts；main 接线 | better-sqlite3 12.11.1(Node24 兼容)+@electron/rebuild 重建；DB 在 userData/app.db，WAL+foreign_keys=ON；内联迁移注册表(S4.4 增强为文件式)；烟雾测试 `[db] ready schema v1 foreign_keys=1` |
| S0.4 | done | IPC 基建：contextBridge + ipcMain.handle 封装 + AppError + src/lib/ipc.ts | electron/lib/error.ts, electron/ipc/{registry,app,index}.ts, electron/preload/index.ts, src/lib/ipc.ts, src/global.d.ts | 用 {__ok} 信封保证结构化错误跨 IPC 可靠传递（规避 Electron 版本间错误序列化差异）；contextIsolation=true、nodeIntegration=false；app:getInfo 端到端打通 |
| S0.5 | done | 主题 token + 应用 shell + session store | src/styles/theme.css, src/styles/main.css, src/stores/{ui,session}.ts, src/main.tsx, src/App.tsx | 三主题(paper/ink/dark)语义 token 经 data-theme 切换；Zustand ui(store 主题/字号)+session(当前书/章/段/视图)；shell 含主题切换按钮 |
| S0.6 | done | 质量门脚本(tsc+eslint+vitest) 串成 npm run check | eslint.config.mjs, vitest.config.ts, electron/lib/error.test.ts, package.json scripts | ESLint 10 扁平配置(TS+react-hooks)+Vitest 4；首条测试覆盖 AppError/serializeError；npm run check 全绿(3 测试通过) |

- [x] Phase 0 exit 达成

---

## Phase 1 · 导入解析与书库（IMP + LIB + schema）
Exit：导入真实 EPUB → 校对 → 书库见章节树 → 删除干净。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S1.1 | done | schema: books/chapters/paragraphs（双键+软删+级联外键） | electron/db/migrate.ts v2(content_schema) | paragraphs 双键(TEXT PK + 隐式 rowid 供 FTS)；chapters 自引用 parent_id；级联 ON DELETE CASCADE；软删 deleted_at；main 启动日志列出 tables |
| S1.2 | done | EPUB 解析服务(node-stream-zip + fast-xml-parser) | electron/services/epub.ts(+test) | 纯解析器(container/opf/ncx/nav/head)单测覆盖；parseEpub 编排读 zip→spine→带 TOC 标题的章节；EPUB3 nav 优先、NCX 兜底；href 相对解析 |
| S1.3 | done | 段落切分 + 稳定ID(UUID) + parse_hash | electron/services/{paragraph,import}.ts(+test)、electron/models/content.ts | splitParagraphs 纯函数(快照测试)；importEpubFile 编排 parseEpub→切分→事务写库，randomUUID + sha256 前16位 parse_hash；FTS 由 S1.4 触发器自动同步（不手写） |
| S1.4 | done | FTS5 fts_paragraphs 同步（应用层+触发器） | electron/db/{migrate.ts v3,fts.ts,fts.test.ts}、index.ts 导出 rebuildFts | 外部内容表 content='paragraphs' content_rowid='rowid'，trigram 分词；ai/ad/au 触发器用 WHEN 过滤软删/噪声；rebuildFts 全量重建；注：FK CASCADE 不触发触发器（删书走 library 手动清 FTS） |
| S1.5 | done | 导入流程 IPC + 进度推送 + 段级校对界面 | electron/ipc/{import,library,segment,index}.ts、electron/services/segment.ts、electron/main/integration-check.ts、scripts/make-fixture-epub.mjs、fixtures/sample.epub、src/{lib/{types,ipc}.ts,modules/library/{LibraryView,ChapterTree,SegmentEditor}.tsx+library.css,App.tsx} | import:pickAndImport(主进程选文件+progress 事件)；段级校对：编辑/合并/拆分/删除/噪声，稳定 ID 保留+renumber，FTS 由触发器同步；ZYXX_INTEGRATION=1 端到端 PASS；修复 listBooks(reading_progress 未建表) 与 deleteBook(fts 用 rebuild 规避 SQLITE_CORRUPT_VTAB) |
| S1.6 | done | 书库浏览 + 目录树 + 删除级联事务 | electron/services/library.ts(+test) | listBooks 进度聚合(reading_progress 未到先 0)、getChapterTree 应用层 buildChapterTree、deleteBook 事务先手清 FTS 再靠 CASCADE；buildChapterTree 纯函数单测(含孤儿节点) |

- [x] Phase 1 exit 达成

---

## Phase 2 · 阅读（RD）
Exit：流畅阅读、进度可恢复、布局可调。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S2.1 | done | 三栏工作台 + 布局预设 | src/modules/reading/{ReadingWorkbench,store,panelRegistry,reading.css} | 可拖拽调宽/折叠；布局预设内存 store（持久化待 SET） |
| S2.2 | done | 原文栏渲染 + 古风排版 + 繁简/拼音占位 | OriginalPanel,ParagraphBlock,useChapterContent | 衬线/行高1.7；繁简拼音占位 toggle |
| S2.3 | done | 段级进度 + 书签 | useProgress；reading_progress/bookmarks 表(migrate v5)；reading:getProgress/saveProgress/listBookmarks 等 | book_id 唯一进度+scroll_ratio；书签段/章，段删 SET NULL 降级；防抖+hide/unload flush |
| S2.4 | done | 逐段锁定同步滚动 | useSyncScroll,syncScroll.ts+test,InterpretPanel | 元素锚定+段内比例纯函数(单测)；解读栏读 content_modern 空则占位 |
| S2.5 | done | 词条浮窗 | TermPopover；reading:lookupTerm(读 SRH dictionary_terms) | 占位→已接 Phase 3 真实词典 |
| S2.6 | done | 沉浸/主题/快捷键/多Tab | useReadingKeyboard,ResourcePanel | 快捷键翻段/书签；沉浸 toggle；主题复用 ui |

- [x] Phase 2 exit 达成

---

## Phase 3 · 检索（SRH）
Exit：跨书搜词命中段落可跳转。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S3.1 | done | 全文检索(FTS5 trigram) + 定位到段 | electron/services/search.ts,ipc/search.ts,search-api.ts | BM25+highlight/snippet；<3字降级 LIKE；导出 searchParagraphs 供 AI RAG |
| S3.2 | done | 全库高亮 + 结果列表 | src/modules/search/{SearchPanel,ResultList},stores/search.ts | 命中点击设 session 字段→RD 跳转；<mark> 安全渲染(非 dangerouslySetInnerHTML) |
| S3.3 | done | 术语词典 dictionary_terms | migrations/search.sql(migrate v4),term_occurrences,TermPopup | 用户自建 CRUD；paragraph_id SET NULL；预留 AI 标注 |

- [x] Phase 3 exit 达成

---

## Phase 4 · 设置与数据（SET）
Exit：可配 Key、切主题、备份换机。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S4.1 | done | safeStorage 加密 API Key + DeepSeek 预设 | electron/lib/keystore.ts(+机器绑定 AES fallback)、settings.ts | getActiveApiKey 稳定签名供 AI；明文不出主进程 |
| S4.2 | done | 设置面板 + 主题/字号 | src/modules/settings/SettingsView.tsx | 4 Tab；主题/字号复用 ui store + DB 持久化 |
| S4.3 | done | 数据备份导出/导入 | electron/services/backup.ts(adm-zip .tcmz) | 用 adm-zip(已有)；双校验 sha256；默认剥离 Key |
| S4.4 | done | 书籍文件管理 | settings.ts(listBookFiles/scanOrphans/cleanOrphans) | triggerReparse 委托(IMP-07 未实现抛 CONFLICT) |

- [x] Phase 4 exit 达成

---

## Phase 5 · AI 增强（AI）
Exit：DeepSeek 解读/问答可用、断网降级、缓存生效。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S5.1 | done | DeepSeek 客户端(fetch+重试+错误映射) | electron/ai/deepseek.ts | 60s 超时+指数退避 3 次+状态码→AppError；Key 从 getActiveApiKey(不日志/不过IPC) |
| S5.2 | done | ai_cache 表 + 命中策略 | electron/ai/cache.ts、migrations/ai.sql(v9) | prompt_hash=sha256(归一化prompt+model+temp)；scope_id+kind+hash+未失效 命中；段落编辑后 hash 变避免误命中 |
| S5.3 | done | 白话解读生成 → 解读栏填充 | electron/services/ai.ts(generateModern)、InterpretPanel 生成按钮 | 写 content_modern/explanation；InterpretPanel 生成后 reload chapter 保留位置 |
| S5.4 | done | RAG 智能问答(FTS top-k) | ai.ts(ask)、electron/ai/rag.ts、QaPanel | searchParagraphs top-k→拼 Prompt→DeepSeek→后置红线→[n] 引用可跳转 |
| S5.5 | done | 失败降级(AI-07) + 三层红线拦截 | electron/ai/guard.ts、DegradedNotice、useAiStore.run | System Prompt 硬禁+预检关键词(不联网)+后置剂量净化；失败降级不阻断阅读 |
| S5.6 | done | 记忆卡批量生成 | ai.ts(generateCards) | DeepSeek 抽要点→createCards(source='ai_batch') |

- [x] Phase 5 exit 达成

---

## Phase 6 · 学习闭环（LRN）
Exit：加卡→复习→测验→仪表盘闭环。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S6.1 | done | cards/review_log 表 + SM-2 纯函数+单测 | learning.ts(sm2 schedule)、sm2.test.ts、migrations/learning.sql | 公式实现(q=4 Δ=0，文档表格有误)；4 表 CASCADE |
| S6.2 | done | 翻卡 UI + 评分驱动调度 | FlashcardView.tsx、stores/learning.ts | 状态机 idle→front→back→graded；键盘 Space/1-4 |
| S6.3 | done | 每日复习计划(到期查询) | getDueQueue(到期/全部/随机) | due_at<=now 查询 |
| S6.4 | done | 测验 + 错题转卡 | QuizView.tsx、generateQuiz、turnErrorToCard | 规则生成(判断/选择/匹配)；错题幂等转卡 |
| S6.5 | done | 学习仪表盘 | Dashboard.tsx、getDashboard/getHeatmap | 掌握度/热力图/streak/薄弱章节 |

- [x] Phase 6 exit 达成

---

## Phase 7 · 笔记（NOTE）
Exit：边读边记、双链可跳、可导出。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S7.1 | done | notes 表 + 编辑器 | notes.sql、NotesView.tsx | 轻量 textarea+预览(非 Milkdown，免依赖)；Markdown 单一存储 |
| S7.2 | done | 双链[[ ]]解析 + note_links + backlinks | wikiLinks.ts(+测试)、notes.ts | 全量重算；resolveTarget 优先级；失效兜底 term |
| S7.3 | done | 标签/笔记本 + 段落绑定 | tags/tag_refs/notebooks、notes.paragraph_id SET NULL | 多态标签；绑段降级不丢 |
| S7.4 | done | 导出 MD/HTML/PDF | notes:export/exportParagraph | PDF 复用 Electron printToPDF(无 puppeteer) |

- [x] Phase 7 exit 达成

---

## Phase 8 · 打包发布
Exit：双平台安装包可装可用。

| # | 状态 | 摘要 | 产出 | 决策/阻塞 |
|---|---|---|---|---|
| S8.1 | todo | electron-builder(Win nsis / macOS dmg) | | |
| S8.2 | todo | 更新策略(前端热更 + electron-updater) | | |
| S8.3 | todo | EPUB 测试夹具回归套件 | | |

- [ ] Phase 8 exit 达成

---

## 变更日志
- 2026-06-16：初始化看板，8 Phase / 39 slice，全 todo。
- 2026-06-16：S0.1 完成 — Electron+React+Vite+TS 脚手架可启动，typecheck + build 全绿。
- 2026-06-16：S0.2 完成 — 按 00-architecture §3 建立完整目录骨架。
- 2026-06-16：S0.3 完成 — better-sqlite3 集成、foreign_keys=ON、迁移 runner 骨架。
- 2026-06-16：S0.4 完成 — IPC 基建（信封式结构化错误 + 类型化调用层）。
- 2026-06-16：S0.5 完成 — 主题 token + Zustand ui/session store + 应用 shell。
- 2026-06-16：S0.6 完成 — 质量门 `npm run check` 全绿（tsc + eslint + vitest）。**Phase 0 exit 达成，等待人工确认进入 Phase 1。**
- 2026-06-16：S1.1 完成 — content schema（books/chapters/paragraphs 双键 + 级联 + 软删）。
- 2026-06-16：S1.2 完成 — EPUB 解析服务（container/opf/ncx/nav 纯解析器 + parseEpub 编排）。
- 2026-06-16：S1.3/S1.4/S1.6 完成（subagent 并行）— 段落切分+导入编排 / FTS5 trigram 同步触发器 / 书库+目录树+级联删除。
- 2026-06-16：S1.5 完成 — import/library/segment IPC + 书库/目录树/段级校对 UI + 端到端集成检查（import→list→tree→fts→segment 编辑→delete 全 PASS）。**Phase 1 exit 达成。**
- 2026-06-16：Phase 2(RD)+3(SRH) 完成（dev-rd/dev-srh agent 并行产出 + 主 agent 集成）— 三栏阅读工作台/段级进度/书签/同步滚动/快捷键；FTS5 全文检索+全库高亮+术语词典。migrate v4(dictionary)+v5(reading)；端到端 PASS（含 search 断言）。**Phase 2 & 3 exit 达成。** 关键修复：导出 invokeRaw 共享、useProgress 去除 render 中写 ref、Node 需 22+（.nvmrc，vitest 4 require(ESM)）。
- 2026-06-16：Phase 4(SET)+6(LRN)+7(NOTE) 完成（dev-set/dev-lrn/dev-note agent 并行 fan-out + 主 agent 集成）— safeStorage Key/备份/设置、SM-2 记忆卡/测验/仪表盘、笔记/双链/导出。migrate v6(settings)+v7(learning)+v8(notes)；152 tests 全绿；smoke schema v8 全表。**Wave 1 全完，Phase 4/6/7 exit 达成。** 剩 Phase 5(AI, Wave 2，依赖 set+srh)。集成期修：3 处类型(sender.id/printToPDF marginsType/digest hex)、backup.test 移 node root、agent 测试 4 处断言修正、adm-zip 移 deps。
- 2026-06-16：Phase 5(AI) 完成（dev-ai agent + 主 agent 集成）— DeepSeek 客户端/ai_cache/白话解读/RAG 问答/失败降级/三层红线/AI 卡片。migrate v9(ai_cache)；203 tests 全绿；smoke schema v9。**所有功能模块(Phase 0-7)就绪，剩 Phase 8 打包。** 集成期修：splitAnswerAndCites 顶层块提取、normalizePrompt 空白归一、sanitizeOutput 中文剂量正则、eslint argsIgnorePattern^_、InterpretPanel 生成按钮+reload。
- 2026-06-16：导入解析流程调整 — AI 配置恢复为应用使用必要条件；EPUB 导入改为“读取 EPUB 全书文本 → 全书交给 AI 排除目录/版权/广告等非正文 → AI 输出章节段落 → 保存解析结果 → 基于已保存段落创建白话解析/图片生成任务”的主路径；新增 schema v10 `ai_generation_tasks`；IMP `reparseBook` 保留稳定 ID 保守复用，旧行软删避免破坏下游引用并补齐任务；SET `triggerReparse` 接入安全 reparse；`npm run check` 全绿（209 tests）。
