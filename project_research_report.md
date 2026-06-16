# 中医经典学习软件项目深度调研报告

调研日期：2026-06-16  
仓库：`/Users/bytedance/zhongyixuexi`

## 1. 一句话结论

这是一个架构骨架扎实、功能覆盖面已经很宽的 Electron 本地学习软件原型。调研时发现的两个方向性问题（AI 被做成导入/启动硬依赖、重新解析破坏稳定段落 ID）已经在 2026-06-16 的修复中处理：导入恢复离线默认路径，启动不再强制配置 AI，重新解析改为稳定 ID 保守复用。

质量门当前是绿的：`npm run check` 通过，207 个测试通过。

## 2. 产品定位与核心承诺

根据 `docs/PRD.md`，产品定位是一款本地运行的 PC 桌面专业学习软件，用户自行导入 EPUB，中医经典/古籍是主要场景。

核心承诺：
- 本地优先：数据、解析结果、笔记、卡片都在本地。
- 离线可用：除 AI 功能外，导入、解析、阅读、记忆、检索应全离线。
- AI 是增强层：默认 DeepSeek 用于白话解读、问答、卡片生成。
- EPUB 首期做扎实：PDF/OCR 后续再做。
- 稳定 ID：段落/章节 ID 在编辑、重新解析、迁移中不能破坏引用关系。

关键证据：
- `docs/PRD.md:173` 明确写着“导入与解析本身不依赖 AI；AI 用于对已解析内容做增强”。
- `docs/PRD.md:223` 明确写着“导入/解析/阅读/记忆/检索全离线”。
- `docs/PRD.md:217` 明确要求重新解析/段级编辑/迁移不破坏笔记、记忆卡、AI 解读引用关系。

## 3. 当前完成度

按 `docs/dev/PROGRESS.md`：
- Phase 0-7 均标记 done，覆盖脚手架、导入解析、阅读、检索、设置数据、AI、学习、笔记。
- Phase 8 仍是 todo：`electron-builder`、更新策略、EPUB 测试夹具回归套件。

从代码看，模块确实已经铺开：
- 主进程服务：`electron/services/*`
- 数据迁移：`electron/db/migrate.ts` 到 schema v9
- IPC：`electron/ipc/*`
- 前端模块：`src/modules/*`
- 测试：16 个测试文件，203 个测试用例

但完成度需要拆成两层看：
- 工程骨架与服务覆盖：较高。
- MVP 产品契约兑现：中等，有几处高优先级偏差。

## 4. 架构健康度

做得好的地方：
- Electron 主进程/渲染进程分层清楚。
- `package.json` 没有 `"type": "module"`，符合 AGENTS.md 对 CJS main/preload 的约束。
- `electron/db/connection.ts` 设置了 `journal_mode=WAL` 和 `foreign_keys=ON`。
- `electron/ipc/registry.ts` 实现了 `{ __ok: true, data } | { __ok: false, error }` 信封。
- `paragraphs.id` 是稳定 `TEXT PRIMARY KEY`，FTS 依赖隐式 `rowid`。
- FTS5 使用 external content + trigram，符合中文短语检索方向。
- `npm run check` 当前全绿。

需要警惕的地方：
- `electron/db/migrate.ts` 仍是大型内联迁移注册表，虽然可用，但随着 schema 增长会越来越难审计。
- 文档里的模块目录结构比实际代码更理想化，实际实现偏扁平，后续维护需要以代码为准或更新文档。
- 若继续引入 AI 解析/图像/TTS/打包 native 依赖，跨平台打包风险会上升。

## 5. 关键风险

### R1. AI 硬依赖破坏本地优先（已修复）

当前 `electron/services/import.ts` 在导入前调用 `ensureApiKey()`，未配置 AI Key 直接失败；随后把整本书章节文本发给 DeepSeek 做全书解析。

证据：
- `electron/services/import.ts:13-15` 注释说明导入要求配置 DeepSeek Key。
- `electron/services/import.ts:75-82` 未配置 Key 会抛 AI 错误。
- `electron/services/import.ts:106-122` 导入流程在写库前调用 `parseBookByAI`。
- `src/App.tsx:34-35` 启动时强制配置 AI Provider。
- `src/App.tsx:77` 渲染强制配置弹窗。

影响：
- 用户没有 Key 时无法正常使用本地阅读软件。
- EPUB 导入不再离线。
- 用户导入的整本书正文会发往外部 AI，和“联网最小化/隐私可控”的期望不一致。
- 中型书 5 秒解析目标基本不可控，取决于网络与模型。

修复：
- EPUB 导入恢复为 `parseEpub + splitParagraphs` 的离线默认路径。
- App 启动取消强制 AI Provider 配置。
- AI 仍保留为解读、问答、卡片生成等增强功能。

### R2. 重新解析会破坏稳定 ID（已修复）

PRD 要求重新解析时保留段落稳定 ID 和下游引用，但当前实现并未做到。

证据：
- `electron/services/import.ts:250-253` 注释承认重新解析会生成新 UUID 并级联删除下游数据。
- `electron/services/import.ts:337-380` 实际删除旧章节，再插入新章节/段落。
- `electron/services/settings.ts:277-292` `triggerReparse` 仍抛 `CONFLICT`，提示 IMP-07 未实现。
- `docs/dev/PROGRESS.md:79` 也记录 `triggerReparse` 未实现。

影响：
- 笔记、卡片、书签、AI 解读可能随旧段落被删。
- 用户校对后的数据会在 reparse 中丢失。
- “稳定 ID”从产品卖点变成风险点。

修复：
- `reparseBook` 不再硬删旧章节/段落。
- 章节按 `content_hash`、标题、顺序保守复用。
- 段落按 `parse_hash`、顺序保守复用。
- 未匹配旧行软删除，避免级联销毁下游引用。
- SET `triggerReparse` 已接入 IMP 的安全 reparse。

### R3. 全书单次 AI 解析不稳定

当前新增的 `parseBookByAI` 一次性发送整本书，输出限制 8192 tokens。

风险：
- 大书输出 JSON 容易截断。
- 单次失败会导致整个导入失败。
- 模型可能误判正文/非正文，且结果不可复现。
- 成本与隐私风险高。

建议：
- 不作为默认导入路径。
- 如果保留 AI 解析，应做分章/分批、断点、可回退、可人工校对，并给用户选择。

### R4. Phase 8 未开始，不能算可发布

证据：
- `docs/dev/PROGRESS.md:130-139` Phase 8 三项仍为 todo。
- 仓库内未发现 `electron-builder.yml`。

影响：
- 无安装包配置。
- 原生依赖 `better-sqlite3` 的 Electron ABI 重建和产物验证还没闭环。
- 更新策略还停留在文档层。

建议：
- 下一阶段应先做 S8.1 打包最小闭环，再做更新策略。

### R5. 部分 done 项仍是占位

例子：
- 书库进度仍硬编码为 0：`electron/services/library.ts`。
- 繁简/拼音只是 toggle 占位：`src/modules/reading/OriginalPanel.tsx`、`ParagraphBlock.tsx`。
- 资源栏配图/经络图仍是占位：`src/modules/reading/ResourcePanel.tsx`。
- 笔记双链点击跳转 TODO：`src/modules/notes/NotesView.tsx`。

影响：
- `PROGRESS.md` 里的 done 容易给后续开发造成“已完成”的错觉。
- 需要区分“接口/占位完成”和“用户可用完成”。

## 6. 建议路线图

### 立即处理

1. 取消 AI 强制启动门槛。
2. 恢复离线 EPUB 导入默认路径。
3. 禁用或重写 reparse，避免破坏稳定 ID。
4. 更新 `PROGRESS.md`，把占位项和风险项写清楚。

### 下一开发切片

1. S8.1：增加 electron-builder 配置，产出 macOS dmg 和 Windows nsis。
2. S8.3：建设 EPUB 回归夹具，至少覆盖：
   - 标准 EPUB2/EPUB3
   - 多层 TOC
   - 含版权页/目录/封面/广告页
   - 大章节/多章节
   - 空章节/异常 HTML
3. 稳定 reparse：围绕 `parse_hash` 做映射合并和引用保护测试。
4. UI 验收：用真实导入书走一遍导入、校对、阅读、搜索、笔记、复习、AI 解读。

## 7. 验证结果

命令：`npm run check`

结果：
- TypeScript typecheck: passed
- ESLint: passed
- Vitest: passed
- Test files: 16 passed
- Tests: 207 passed

备注：npm 输出了 mirror config warning，不影响质量门通过。

## 8. 调研产物

- 计划：`task_plan.md`
- 证据笔记：`notes.md`
- 本报告：`project_research_report.md`
