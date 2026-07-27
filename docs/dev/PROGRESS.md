# 进度看板（PROGRESS）— 唯一进度事实来源

> 驱动规则见 `loop-engineering.md`。每轮循环首读本文件取下一个 `todo`,末写更新。
> 状态：`todo` / `doing` / `done` / `blocked` / `skipped`

最后更新：2026-07-27（新增 Phase 9：在线化改造，todo，见方案文档 `docs/dev/proposal-online-membership-billing.md`）

---

## ⚠️ 关于本文档的本次重写

本项目在 Phase 0–7 完成后经历了一次**产品收敛重构**,大量已"done"的功能被刻意移除/简化,但本文档此前仍按原始愿景记录。为避免文档误导,本文按**当前代码真实形态**维护:

- **迁移机制**:`electron/db/schema.ts` 当前 `CURRENT_SCHEMA_VERSION=3`。v0/v2 开发期旧库 reset 重建;v3 起通过 `electron/db/migrate.ts` 的 `MIGRATIONS[]` forward-only 升级,保留用户数据。
- **内容来源**:从"用户导入 EPUB"改为**内置五本中医经典**(`data/{nanjing,suwen,lingshu,shanghanlun,jinkuiyaolue}-original.json`,`seedBuiltinContent()` 启动时 seed/sync)。
- **已移除的模块/能力**:导入 UI、完整段级校对工作台、书签、记忆卡/SM-2/测验、双链/笔记本/标签、术语词典/知识图谱、备份导入导出、书籍文件管理。
- **留存的核心**:三栏书籍详情页(章/段/AI 解读)、书/章/段轻量编辑、封面上传与书序调整、段级 AI 白话解读、FTS5 全文检索、段绑定笔记/自由笔记、AI 凭证(safeStorage)、阅读足迹仪表盘。

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

共 30 个 channel,全部经 `electron/ipc/registry.ts` 的 `handle()` 信封包装:

| 模块 | Channel |
|---|---|
| library | `library:list` · `library:tree` · `library:reorder` · `books:uploadCover` |
| editing | `books:updateTitle` · `books:create` · `books:delete` · `chapters:updateTitle` · `chapters:create` · `chapters:delete` · `paragraphs:editText` · `paragraphs:merge` · `paragraphs:split` · `paragraphs:delete` · `paragraphs:create` |
| reading | `reading:getChapter` · `reading:saveProgress` · `reading:getProgress` |
| search | `search:fulltext` |
| ai | `ai:status` · `ai:generateModern` |
| notes | `notes:create` · `notes:update` · `notes:delete` · `notes:getByParagraph` · `notes:listFree` |
| settings | `settings:listProviders` · `settings:saveProvider` · `settings:setActiveProvider` |
| learning | `learning:getDashboard` |

渲染进程经 `src/models/*/api.ts` 与 `src/models/shared/ipc.ts` 调用;preload(`electron/preload/index.ts`)只暴露 `{invoke, on}`。

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
| S1.3 | done | 内置五经 seed/sync(`builtin-content.ts`,读 `data/*-original.json`,hash 追踪 + 稳定 ID 同步 + rebuildFts) |
| S1.4 | done | 书库浏览 + 章节树(`library:list` 进度聚合、`library:tree` 内存建树、`library:reorder`) |
| S1.5 | done | 书籍详情页(`LibraryView`/`BookDetail`,章/段/析三栏 + 段绑定/自由笔记 + AI 解读 + 轻量编辑) |

> **已移除(原 PRD IMP-01~08)**:EPUB 导入 UI、完整段级校对工作台、重新解析 UI、导入去重 UI。轻量书/章/段编辑、封面上传、书籍软删除已恢复为当前书库能力。EPUB/网页抓取脚本与导入中间格式见 `docs/dev/book-import-json.md`,保留为内容生产工具链,不在应用运行路径内。

- [x] Phase 1 exit 达成

---

## Phase 2 · 阅读(done · 收敛后形态)
Exit:书籍详情页内可流畅阅读章节段落、AI 解读对齐。

| # | 状态 | 摘要 |
|---|---|---|
| S2.1 | done | 三栏详情页布局(章目录 / 段列表 / 析面板),古风排版 |
| S2.2 | done | 段级阅读进度(`reading:saveProgress`/`reading:getProgress`,`reading_progress` 按 book_id 唯一) |
| S2.3 | done | 段落选择 + 解读面板联动(白话/医理/解读) |

> **已移除(原 RD)**:独立三栏工作台、拖拽调宽/折叠、布局预设、繁简/拼音、逐段锁定同步滚动、词条浮窗、沉浸模式、多 Tab/多窗、快捷键体系、书签。阅读能力收敛进 `src/views/LibraryView/BookDetailView.tsx`。

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
| S7.1 | done | `notes` 表 + 段绑定/自由笔记 CRUD(`notes:create` / `notes:update` / `notes:delete` / `notes:getByParagraph` / `notes:listFree`) |

> **已彻底移除(原 NOTE)**:双链 `[[ ]]`、`note_links`、`wikiLinks` 解析、backlinks、标签/笔记本(`tags`/`tag_refs`/`notebooks`)、导出 MD/HTML/PDF、笔记全文搜索。笔记收敛为轻量文本;段绑定入口在 `BookDetail` 抽屉/弹窗内,自由笔记在 `src/views/NotesView/`。

- [x] Phase 7 exit 达成

---

## Phase 8 · 打包发布(doing)

| # | 状态 | 摘要 | 决策/阻塞 |
|---|---|---|---|
| S8.1 | done | electron-builder(Win nsis / macOS dmg) + forward-only 迁移 | 迁移已重写为 forward-only(`migrate.ts`):v3 库升级保留数据,v0/v2 旧开发库 reset 重建(首版无真实用户)。electron-builder 配置已补全(macOS dmg arm64/x64 + Win nsis x64),`npm run dist:mac` 出 dmg。图标待补(build/icon.icns/.ico) |
| S8.2 | todo | 更新策略(前端热更 + electron-updater) | 首版延后,手动下载;macOS 自动更新需代码签名 |
| S8.3 | done | 内置经典数据回归夹具 | 校验 `data/*.json` 的 `quality` 计数与正文页脚污染;覆盖五本内置经典 |

- [ ] Phase 8 exit 达成

---

## Phase 9 · 在线化改造(邀请制 + Token 计费)(todo · 产品方向转型,尚未开始)

> **产品方向说明**:Phase 0-8 是本地 Electron 桌面应用,已上线/进行中,不受本 Phase 影响。Phase 9 是把产品转型为"部署在香港服务器、邀请码注册、三级权限(游客/免费会员/充值会员)、AI 问答按 token 用量人工记账计费"的在线站点,推翻了 PRD v3.1 的 C-1(只做 PC)与 C-2(本地优先无账号无服务端)。完整方案论证、架构草图、数据模型、合规结论见 `docs/dev/proposal-online-membership-billing.md`;PRD 已同步更新为 v4.0 目标形态。
>
> **在 Phase 9 完成前,当前实际运行的产品仍是 v3.1 描述的本地桌面应用**,不要假设在线版已存在。

Exit:邀请码注册/登录可用 → 三级权限矩阵在 API 层生效 → 管理员可通过内容后台上传/发布经典 → 免费会员可读原文+AI 解读 → 充值会员可发起多轮 AI 问答并按 token 实时扣减余额 → 管理员可生成邀请码、人工充值记账 → 站点部署在香港服务器可访问。

| # | 状态 | 摘要 |
|---|---|---|
| S9.1 | done | 后端服务脚手架:`server/`(Fastify + `pg`)+ PostgreSQL 连接(`server/src/db/connection.ts`)与 forward-only 迁移 runner(`server/src/db/migrate.ts`,`schema_migrations` 表跟踪已应用版本,镜像 `electron/db/migrate.ts` 的 per-migration 事务/失败回滚设计)。`server/src/index.ts` 暴露 `GET /health`,`DATABASE_URL` 未设置时跳过迁移并告警而非崩溃。新增 `tsconfig.server.json`(第三个 TS root,CommonJS 输出到 `out-server/`)、`typecheck:server`/`server:dev`/`server:build`/`server:start` script、eslint 的 `server/**` node globals 块。依赖新增 `fastify`/`pg`/`@types/pg`/`tsx`。`npm run check` 全绿(14 test files/98 tests,含 `migrate.test.ts` 对纯函数 `getPendingMigrations` 的单测,不依赖真实 DB)。另用本机 Homebrew Postgres 起了一个临时实例做端到端烟雾测试(server 启动 → 连接 → 建表 → `/health` 200),验证后已清理,未留存到仓库。**`electron/services/*`/`electron/ai/*` 的业务逻辑迁移复用留给后续 slice(S9.4/S9.7 等实际用到时再迁),本 slice 只搭地基。** |
| S9.2 | done | 账号与邀请码:migration v1 建 `invite_codes`/`users` 表(`invite_codes.created_by` 与 `users.id` 的循环外键通过迁移内先建表、后 `DO $$...` 幂等 `ADD CONSTRAINT` 解决);`POST /auth/register`(校验邀请码可用性 `canUseInviteCode` 纯函数 + 事务内 `use_count+1`)、`POST /auth/login`(scrypt 校验密码);密码用 `node:crypto` scrypt 加盐哈希(`server/src/auth/password.ts`,未引入 bcrypt 避免原生编译依赖),JWT 用 `jsonwebtoken`(`server/src/auth/jwt.ts`)。**邀请制注册的冷启动问题**:首个 admin 无法走 `/auth/register`(还没人能发邀请码),用 `ensureBootstrapAdmin()` 解决——若设置了 `ADMIN_BOOTSTRAP_USERNAME`/`ADMIN_BOOTSTRAP_PASSWORD` 环境变量且库里还没有 admin,启动时幂等创建一个。邀请码生成/作废的管理员 UI 留给 S9.5。本机 Postgres 端到端验证:bootstrap admin 登录、邀请码注册消耗 `use_count`、耗尽/无效邀请码拒绝、密码错误 401,全部符合预期,验证后已清理临时库。`npm run check` 全绿(17 test files/110 tests)。 |
| S9.3 | done | 三级权限中间件:`server/src/auth/tier.ts` 定义 `guest < free_member < paid_member` 排序 + 纯函数 `resolveAccessTier(actor, wallet)`/`meetsTier`;`request-actor.ts` 用 preHandler hook 从 `Authorization: Bearer` 解析/校验 JWT 写入 `request.actor`(缺失/非法 token 按游客处理,不 401,只在需要更高权限的路由上被拒);`require-tier.ts` 提供 `requireTier(minTier, wallet?)` 路由级 preHandler。**`wallets` 表要到 S9.6 才建**,`resolveAccessTier` 的钱包余额查询做成注入的 `WalletBalanceLookup` 接口,现阶段路由用 `NO_WALLET_YET` 桩(恒返回 0,即所有 member 暂时都只是 free_member),S9.6 换成真实查询即可,不用改调用方。测试用 Fastify `.inject()` 起临时 app 覆盖游客/免费会员/充值会员/admin 四种场景 + 非法 token 容错,不需要真实 DB。`npm run check` 全绿(19 test files/122 tests);另起本机 Postgres 做了一次烟雾测试确认接入 `registerActorDecoration` 后 `/health`/`/auth/login` 仍正常。 |
| S9.4 | done | 内容服务迁移:migration v2 建 `books`/`chapters`/`paragraphs`(全局共享表,无 `user_id`;`books` 加 `status`(draft/published)+`created_by` 供 S9.5 CMS 用)+ `CREATE EXTENSION pg_trgm` + `paragraphs.text` 上的 GIN trigram 索引。**放弃 SQLite FTS5 的 rowid/content_rowid + ai/ad/au 触发器同步设计**:Postgres 索引由引擎在每次 insert/update 时事务性维护,不需要额外触发器保持同步。**放弃了 `parse_hash`/`is_noise`/`quality_flag`/`edited` 这些原 EPUB 导入解析期字段**:内容现在由后台直接编写发布(S9.5 CMS),不再是"解析生成 → 用户校对 → 与源 JSON diff 同步"的流程,这些字段没有存在意义。检索侧:`SRH-01` 用 `ILIKE '%q%'`(GIN trgm 加速);**原 SRH-02 的"< 3 字符降级 LIKE 扫描"在 Postgres 下不需要对应实现**——FTS5 trigram tokenizer 要求 ≥3 字符才能组成合法 MATCH 词(短词只能退化到普通 LIKE 全表扫描),而 Postgres 的 `ILIKE` 天然支持任意长度,只是短 pattern 时优化器可能自动退化成顺序扫描,不需要应用层分支;已用 1 字符查询("阳")实测命中正确。新增只读路由 `GET /books`(仅 `published`)、`GET /books/:bookId`(树形详情,404 处理)、`GET /search?q=`,均不加 `requireTier` 门槛(原文/检索对三级权限都开放,对齐 PRD LIB/SRH)。纯函数 `buildChapterTree`(树形构建,含乱序输入、悬空 parent_id、空集合等边界)与 `sanitizeSearchQuery` 单测覆盖,不需要真实 DB;`npm run check` 全绿(21 test files/131 tests)。本机 Postgres 端到端验证:建表、seed 一本书三段两章、`/books`、`/books/:id` 树形结构、404、中文全文检索(含 1 字符查询)全部符合预期,验证后已清理。**AI 解读展示留给后续 slice**(需要 `paragraph_analyses`/`ai_cache` 迁移,不在 S9.4 范围)。**SRH-04(游客/免费会员是否可用检索)仍是 PRD §9 未决问题**,当前默认对所有人开放(沿用桌面版行为),后续如需收紧只需给 `/search` 加 `requireTier`。 |
| S9.5 | done | 内容管理后台 API(`/admin/*`,`requireAdmin` 角色门槛,与 `requireTier` 的会员计费分层正交):`server/src/content/admin.ts` port 了 `electron/services/editing.ts` 的 book/chapter/paragraph create/update/delete + merge/split + renumberChapter 语义(soft-delete、新 id、按 order_index 重排);因 Postgres 侧尚无 `notes` 表,省去了原版"soft-delete 时手动 SET NULL 解绑笔记"的步骤,merge/split 因此比原实现更简单。`server/src/auth/invite-code-admin.ts` 补 AUTH-04 的邀请码增删改查(创建含唯一码冲突映射为 400、列表、作废),复用 S9.2 已有的 `canUseInviteCode` 会员侧校验,不重复。`server/src/routes/admin.ts` 用 Fastify 的 `register(prefix:'/admin')` 封装 + 该子树的 `setErrorHandler` 把 `NotFoundError`/`ValidationError`(新增 `server/src/lib/errors.ts` 共享)统一映射 404/400,books/chapters/paragraphs/invite-codes 路由不重复 try/catch。**本 slice 只做管理员后台的 API,不做管理员 UI 页面**——PRD CMS-01/02 提到的"界面"留给 S9.8(Web 前端迁移,那时才有统一的前端项目脚手架可以挂管理页面,现在单独起一个前端会是重复工作)。`requireAdmin`(角色门槛)与 `requireTier`(会员计费分层)是两套正交的授权机制,新增 `require-admin.test.ts`(Fastify inject:游客/普通会员/admin 三态)。`npm run check` 全绿(22 test files/134 tests)。本机 Postgres 端到端验证:create→publish→游客可见、chapter/paragraph 增删、merge 两段→查询合并结果、split 还原、全文检索(含 1 字符查询,验证是 curl 命令行中文编码问题而非服务端 bug)、邀请码 create/list、非 admin 会员对 `/admin/*` 一律 403、book 删除级联隐藏其 chapter/paragraph(检索也查不到)——全部符合预期,验证后已清理。 |
| S9.6 | done | 钱包与人工充值记账:migration v3 建 `wallets`(`user_id` PK,`balance_tokens` BIGINT)+ `balance_adjustments`(append-only 审计表:`delta_tokens`/`amount_cny`/`note`/`created_by`/`created_at`)。`server/src/wallet/repository.ts` 的 `applyBalanceAdjustment` 在一个事务里 `INSERT ... ON CONFLICT DO UPDATE` upsert 余额 + 插入审计行,`createWalletBalanceLookup(pool)` 产出真正的 `WalletBalanceLookup` 实现,**替换掉 S9.3 里 `requireTier` 用的 `NO_WALLET_YET` 占位**(充值会员判定现在真正读 `wallets.balance_tokens > 0`,S9.7 的 AI 问答门槛直接复用这个实现,不用再改)。纯函数 `validateAdjustmentInput`(拒绝 0/非整数 delta、负 `amountCny`)单测覆盖。路由:`GET /wallet`(会员本人,`requireTier('free_member')` 即"已登录"门槛,WALLET-01/03)、`POST /admin/wallets/:userId/adjustments` + `GET /admin/wallets/:userId`(管理员,WALLET-02,复用 `/admin` 前缀已有的 `requireAdmin`+错误映射)。**本 slice 同样只做 API,管理员充值界面留给 S9.8**(与 S9.5 CMS 界面同一理由:等前端脚手架落地后一起做,不单独起前端)。`npm run check` 全绿(23 test files/140 tests)。本机 Postgres 端到端验证:邀请码注册会员→本人查余额为 0→管理员正充值(50 元→10 万 token)→会员本人看到余额与流水更新→管理员负向更正→流水按时间倒序列出两笔→零 delta 400→未知用户 404→非 admin 会员访问 `/admin/wallets/*` 403→游客访问 `/wallet` 403,全部符合预期,验证后已清理。 |
| S9.7 | done | AI 问答:migration v4 建 `conversations`/`messages`/`token_usage_ledger`(`tokens_deducted` 单独留列,当前恒等于 `total_tokens`,为以后"消费时加价"策略留 schema 口子,不用再迁移)。`server/src/ai/` 从 `electron/ai/*` port 过来(裁掉不需要的部分):`deepseek.ts` 只保留非流式 `chat()`(问答路由是一问一答,不需要 SSE),保留原版的重试/超时/退避策略;`guard.ts` 三层红线逐字复用(`shouldBlock`/`sanitizeOutput`);新增 `prompts.ts` 的 `buildQaPrompt`(复用红线 System Prompt 片段,拼「参考原文」+ 历史消息 + 本轮问题)。`server/src/ai/chat-service.ts` 编排完整链路:①开事务建/校验会话归属 + 存用户消息;②红线 layer 2 命中则直接存拒答、不联网不计费;③未命中则**事务外**做检索(复用 S9.4 `searchParagraphs`)+ 历史加载 + 调用 DeepSeek(网络慢调用不占事务/连接);④第二个事务里存 AI 回复 + 按 `usage.total_tokens` 从钱包扣款(复用 S9.6 `applyAdjustmentWithClient`,同一事务原子完成"存消息+记流水+扣余额")+ 写 `token_usage_ledger`。**允许余额扣至负数**:门槛只在调用前检查"余额>0"(见 S9.3/S9.6 的 `resolveAccessTier`),调用后按实际 usage 扣款,可能扣穿到负数,下一次调用会被门槛挡住——预付费模型下这是预期行为,不做额外处理。路由 `POST /chat`(`requireTier('paid_member')` 门槛,真实读钱包余额)。小重构:抽出 `server/src/db/with-transaction.ts` 共享事务包装,`content/admin.ts`/`wallet/repository.ts` 都改用它(消掉三处重复的 BEGIN/COMMIT/ROLLBACK 样板)。`npm run check` 全绿(26 test files/163 tests,含 port 过来的 `guard.test.ts`/`deepseek.test.ts`(伪 fetch)/新增 `prompts.test.ts`/`validation.test.ts`)。本机 Postgres + 一个假 DeepSeek HTTP 服务(返回固定 usage=160 token)端到端验证:免费会员(余额 0)发问 403 → 管理员充值 1000 → 充值会员发问成功,答案含检索到的原文引用,余额 1000→840→680→520(每次 -160,与 usage 完全对应)→ 显式传 `conversationId` 确认多轮延续同一会话(`turnA`/`turnB` 返回同一 id)→ 红线命中问题("我头痛该吃什么药")直接拒答、不联网(fake DeepSeek 未被调用)、余额不扣,全部符合预期,验证后已清理。**流式回复(SSE)留给以后按需再加**,当前是同步请求/响应。 |
| S9.8 | todo | Web 前端迁移:Electron 渲染进程 → 独立 Web 前端,`src/models/shared/ipc.ts` 换成 HTTP client;`src/views`/`src/components` 平移;按权限矩阵渲染/隐藏功能;删除 `api_credentials`/SET-01 用户自配 Key UI |
| S9.9 | todo | 部署上线:香港服务器部署、HTTPS、基础限流/防刷与监控 |

- [ ] Phase 9 exit 达成

---

## 关键决策与约束(当前)

1. **schema 单源**:`electron/db/schema.ts` 是当前 DDL baseline,`CURRENT_SCHEMA_VERSION=3`。`prepareDatabase()` + `migrate.ts` `runMigrations()` 走 forward-only:v3 库升级保留数据,v0/v2 旧开发库 reset 重建。新 schema 改动在 `migrate.ts` 的 `MIGRATIONS[]` 加一条 + bump version。
2. **内置内容**:启动 `seedBuiltinContent()` 幂等 seed/sync 五本经典(难经/素问/灵枢/伤寒论/金匮要略)。`settings` 记录 `builtin.sha256.<bookId>`;源 JSON 变化时按稳定 ID 同步,保留用户编辑段落、用户新增内容与用户删除行。
3. **IPC 收紧**:preload 只暴露 `{invoke, on}`;模块 API 在 `src/models/*/api.ts` 与 `src/models/shared/ipc.ts` 用 `invokeRaw('module:action')` 包装。
4. **foreign_keys=ON**:每连接强制(`connection.ts`),否则 CASCADE 静默失效。
5. **paragraphs 双键**:`id TEXT PK`(稳定)+ 隐式 `rowid`(FTS5 `content_rowid`),不可破坏。
6. **FTS 同步归 IMP**:ai/ad/au 触发器 + `rebuildFts`,别处只读。

---

## 变更日志

- 2026-07-27:**新增 Phase 9(在线化改造,todo)**。产品方向提议从本地桌面转型为邀请制在线站点(香港服务器、三级权限、AI 问答 token 计费、人工充值记账),PRD 同步升级为 v4.0 目标形态,方案细节见 `docs/dev/proposal-online-membership-billing.md`。Phase 0-8(本地桌面版)现状不受影响,仍是当前真实运行的代码。
- 2026-07-03:**文档再次对齐当前实现**。更新为五本内置经典、30 个 IPC、schema v3 forward-only 迁移、内置内容 hash 同步、自由笔记与轻量书/章/段编辑;补内置数据回归测试。
- 2026-06-18:**文档对齐重构**。本次重写按当时代码现状校正:内置经典(替换 EPUB 导入)、已移除模块清单(导入/卡片/测验/双链/词典/备份等)。旧愿景历史见下方「变更日志(重构前)」。
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
- 2026-06-16:导入解析流程调整 — EPUB 导入改为"全书 AI 解析"主路径;schema v10 `ai_generation_tasks`(注:此历史迁移版本号体系已被后续 v3 baseline 取代)。
- 重构期(2026-06-16 之后,跨多个 commit):
  - `refactor(notes): keep paragraph note surface only` — 笔记收缩为段绑定 CRUD。
  - `refactor(ipc): expose only current app surface` — IPC 从 50+ 收缩到当时的最小运行面。
  - `refactor(db): drop legacy data compatibility` — 移除旧兼容层。
  - `test(integration): cover current study surfaces` — 集成测试对齐收敛后形态。
  - `feat: split neijing into suwen+lingshu, rename nanjing, drop prefaces` — 内置经典先整理为独立书目,后续扩展为五本。
