# 设置与数据 技术设计文档（08-settings-data）

> ⚠️ **状态：仅"AI 凭证 provider CRUD + 外观"保留（v3.0 收敛重构后）**
>
> 本文档描述的数据备份导出/导入（`.tcmz`）、书籍文件管理（scanOrphans/cleanOrphans/triggerReparse）、免责声明门、版本化迁移 runner **均未保留**。
>
> **当前实际状态**（`electron/services/settings.ts` + `electron/lib/keystore.ts` + `src/modules/settings/`）：
> - ✅ 保留：3 个 IPC —— `settings:listProviders`、`settings:saveProvider`、`settings:setActiveProvider`。返回安全 DTO（`hasKey` 布尔，**不含明文 Key**）。
> - ✅ 凭证：`api_credentials` 表（provider/label/base_url/model/api_key_enc safeStorage 加密/key_iv_hint/is_active）。`electron/lib/keystore.ts`：safeStorage 优先 + 机器绑定 AES fallback；`getActiveApiKey()` 明文仅存在于主进程单次调用局部变量，不日志、不过 IPC。
> - ✅ 外观：主题（paper/ink/dark）+ 字号，经 `ui` store + `data-theme` CSS token；设置页 `SettingsView` + `ProviderEditorModal`（未配置 Key 时 `App.tsx` 强制弹窗）。
> - ❌ 已删除：`backup.ts`（`.tcmz` 导入导出）、`filemgmt/`（orphan cleaner）、`security/` 目录、免责声明门/页脚、版本化迁移 runner（现 schema 为 reset 式，`migrations/` 空）。
> - 📌 `settings` 表仍存（KV），但当前主要用户设置经 Zustand `ui` store + 主题 CSS，凭证走 `api_credentials`。
>
> **权威参考**：`docs/PRD.md` v3.0 §3.7、`docs/dev/00-architecture.md` §5/§10。下文为原始愿景设计存档（safeStorage 加密 + 机器绑定 AES fallback 设计仍然准确，是当前实现的基础）。

## 1. 概述

### 1.1 模块职责

设置与数据模块（SET）是整个应用的「地基与守护层」，负责：

- **凭证安全**（SET-01）：AI API Key 的加密存储、运行时解密、多厂商预设与切换。核心是「明文不落盘、不进日志、不出本机」。
- **外观偏好**（SET-02）：字号 / 字体 / 主题（米白 / 墨绿 / 深色）/ 插图风格，通过 CSS token 作用于全局 UI。
- **数据备份与迁移**（SET-03）：整个用户库（`app.db` + `assets/` + `files/` 原始 EPUB）导出为单一归档，含完整性校验；支持导入恢复与换机迁移。
- **书籍文件管理**（SET-04）：查看原始导入文件、触发重新解析（与 IMP-07 协调）、清理孤立资源。
- **免责声明**（SET-05）：开屏必看 + 阅读页底部小字 + 首次启动确认流程。
- **DB 迁移机制**（横切）：版本化迁移脚本与 runner，保证 schema 演进不破坏稳定 ID（`paragraph_id` / `chapter_id`）。

### 1.2 模块边界

| 边界 | 说明 |
|---|---|
| 负责 | settings 表、API Key 加密存储、备份打包/校验/导入、外观 token 分发、迁移 runner、免责声明状态 |
| 不负责 | 实际调用 AI（由 AI 模块 `07-ai.md` 负责，SET 只提供解密后的 Key）；EPUB 解析逻辑（由 IMP 负责，SET 仅触发重新解析）；记忆卡/笔记业务表（由各业务模块定义，SET 仅在备份时整库搬移） |
| 唯一联网点 | 本模块**不直接联网**。解密后的 Key 经 IPC 传给主进程 AI 客户端（`electron/ai/`），由其向用户指定端点发请求。 |

### 1.3 与其它模块的关系

- **AI 模块（AI）**：依赖 SET-01 提供的 `getApiKey()` 解密接口与当前选中厂商配置（`base_url` / `model`）。Key 未配置或解密失败时 AI 模块按 AI-07 降级。
- **导入与解析（IMP）**：SET-04 触发重新解析时调用 IMP-07 的重新解析流程；SET-04 清理孤立资源需扫描 `assets/` `files/` 与 DB 引用关系。
- **阅读（RD）**：SET-02 的外观 token 直接作用于 RD 三栏阅读视图；RD-07 的主题切换最终写入 settings 表。
- **全模块**：DB 迁移 runner（本模块维护）对所有模块的表生效；备份（SET-03）对全库生效。

---

## 2. 相关需求

引用 `docs/PRD.md` §3.9：

| 编号 | 功能 | 优先级 | 验收标准（摘要） |
|---|---|---|---|
| SET-01 | AI API Key 管理 | P0 | 配置面板；默认预设 DeepSeek（填 Key 即用）；可切换/新增其他厂商；Key 本地加密存储，不明文日志；仅发往用户指定端点 |
| SET-02 | 外观设置 | P0 | 字号、字体、主题（米白/墨绿/深色）、插图风格偏好 |
| SET-03 | 数据备份 | P0 | 一键导出整个库（`app.db` + assets + 原始 EPUB）为单文件；支持导入恢复；换机可迁移 |
| SET-04 | 书籍文件管理 | P1 | 查看原始导入文件、重新解析、清理孤立资源 |
| SET-05 | 免责声明 | P0 | 开屏必看 + 阅读页底部小字；内容由用户自行导入，不构成医疗建议；用户须自行确保合法授权 |

相关非功能需求（PRD §4.2）：API Key 本地加密（OS keychain / 加密存储），不明文落盘、不进日志；备份文件完整性校验；段落/章节稳定 ID，迁移不破坏引用。

---

## 3. 目录与文件结构

本模块在 `electron/` 与 `src/` 下的代码组织：

```
electron/
├── db/
│   ├── connection.ts            # better-sqlite3 单例连接（WAL、pragma）
│   ├── migrate.ts               # 迁移 runner（见 §7.6）
│   ├── schema.ts                # 初始 schema（v1 baseline）
│   └── migrations/              # 版本化迁移脚本（见 §4.3 / §7.6）
│       ├── 0001_baseline.sql
│       ├── 0002_add_xxx.sql
│       └── index.ts             # 迁移注册表
├── services/
│   └── settings.ts              # 设置读写、外观偏好、免责声明状态
├── security/                    # 凭证安全子层（独立目录，强调隔离）
│   ├── safeStorage.ts           # safeStorage 封装 + 平台可用性检测 + 回退
│   ├── apiKeyStore.ts           # API Key 加密存储/解密/校验（SET-01 核心）
│   └── presets.ts               # 厂商预设模板（DeepSeek/OpenAI/Anthropic/通义）
├── backup/                      # 备份导入导出（SET-03）
│   ├── export.ts                # 打包：app.db + assets + files → 单归档
│   ├── import.ts                # 导入恢复：校验 + 覆盖 + 冲突处理
│   ├── archive.ts               # tar/zip 打包解包 + checksum
│   └── manifest.ts              # 备份清单（版本、校验和、时间戳）
├── filemgmt/                    # 书籍文件管理（SET-04）
│   ├── orphanCleaner.ts         # 扫描并清理孤立 assets/files
│   └── reparse.ts               # 触发重新解析（委托 IMP-07）
├── ipc/
│   └── settings.ts              # settings:* channel 注册（薄层）
└── models/
    └── settings.ts              # 类型 / DTO（ProviderConfig、AppearanceSettings…）

src/
├── modules/settings/
│   ├── SettingsPage.tsx         # 设置主页（Tab：API/外观/备份/文件/关于）
│   ├── ApiKeyPanel.tsx          # SET-01 厂商配置面板
│   ├── AppearancePanel.tsx      # SET-02 外观设置
│   ├── BackupPanel.tsx          # SET-03 备份导入导出
│   ├── FileManagerPanel.tsx     # SET-04 书籍文件管理
│   ├── DisclaimerGate.tsx       # SET-05 开屏免责声明门
│   └── DisclaimerFooter.tsx     # SET-05 阅读页底部小字
├── stores/
│   └── settings.ts              # Zustand store（外观、当前厂商缓存）
└── styles/
    └── theme.ts                 # 外观 token → CSS 变量映射（见 §7.7）
```

---

## 4. 数据模型

### 4.1 settings 表（键值结构化，承载外观/布局/当前厂商等）

采用键值表承载「扁平、易扩展」的偏好；少量结构化配置（厂商列表）也以 JSON 文本存 value，由应用层序列化。

```sql
-- v1 baseline（见 migrations/0001_baseline.sql）
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,          -- 设置键，见 §4.2 键值约定
  value       TEXT NOT NULL,             -- 序列化值（JSON 字符串或标量）
  updated_at  INTEGER NOT NULL           -- unix ms
);
```

> 说明：API Key **不直接存 settings.value 明文**。settings 只存「当前选中厂商 id」「外观偏好」「免责声明确认状态」等非敏感数据。加密后的密文 Key 存独立表 `api_credentials`（见 §4.4），做到敏感数据隔离，便于备份时单独处理（默认导出可剥离 Key）。

### 4.2 settings 键值约定

| key | value 示例 | 说明 |
|---|---|---|
| `appearance.theme` | `"beige"` | 主题：`beige`(米白) / `moss`(墨绿) / `dark`(深色) |
| `appearance.fontFamily` | `"songti"` | 字体预设：`songti`(宋体衬线) / `kaiti`(楷体) / `system` |
| `appearance.fontSize` | `20` | 原文基准字号（px），范围 14–28 |
| `appearance.lineHeight` | `1.7` | 行高 |
| `appearance.illusStyle` | `"ink"` | 插图风格偏好：`ink`(水墨) / `color`(淡彩) / `none` |
| `layout.preset` | `"three-col"` | 布局预设名（与 RD-01 协调） |
| `ai.currentProvider` | `"deepseek-default"` | 当前选中厂商配置 id |
| `disclaimer.accepted` | `true` | 是否已确认免责声明（首次启动门控） |
| `disclaimer.acceptedAt` | `1718500000000` | 确认时间戳 |
| `schema.version` | `3` | 当前 DB schema 版本（迁移 runner 读写，见 §7.6） |

### 4.3 迁移脚本目录与版本号约定

```
electron/db/migrations/
├── 0001_baseline.sql    # 初始 schema：books/chapters/paragraphs/.../settings/api_credentials
├── 0002_<desc>.sql      # 增量变更（DDL）
├── 0003_<desc>.sql
└── index.ts             # 注册表：[{version, file, up()}]
```

- 文件名前缀 = 4 位版本号，单调递增、不跳跃、不复用。
- 每个 `.sql` 仅含**幂等可重放**的 DDL（`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`）。
- `schema.version` 记录已执行到的最大版本号；runner 启动时比对并顺序补执行未跑过的脚本（详见 §7.6）。

### 4.4 api_credentials 表（加密后的厂商凭证，SET-01 核心）

```sql
CREATE TABLE IF NOT EXISTS api_credentials (
  id            TEXT PRIMARY KEY,            -- 厂商配置 id（如 deepseek-default）
  provider      TEXT NOT NULL,               -- 厂商标识：deepseek / openai / anthropic / qwen
  label         TEXT NOT NULL,               -- 用户可读名（如 "DeepSeek 默认"）
  base_url      TEXT NOT NULL,               -- API 端点
  model         TEXT NOT NULL,               -- 默认模型
  api_key_enc   BLOB NOT NULL,               -- safeStorage 加密后的密文（见 §7.1）
  key_iv_hint   TEXT,                        -- 可选：平台/算法 hint（仅用于回退诊断，不含明文）
  is_active     INTEGER NOT NULL DEFAULT 0,  -- 是否当前启用（冗余于 settings.ai.currentProvider，便于查询）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_provider ON api_credentials(provider);
```

> 设计要点：
> - `api_key_enc` 是 `BLOB`（`safeStorage.encryptString` 返回 `Buffer`，直接写 BLOB）。
> - **不存明文、不存可逆 base64**；仅存 OS 级加密密文。
> - `base_url` / `model` 不算敏感（预设模板可见），明文存储以便 UI 展示与切换。
> - 备份导出时，`api_credentials` 默认**剥离 `api_key_enc`**（见 §7.3 备份清单），避免归档文件携带可解密凭证跨机。

### 4.5 orphan_scan_log 表（SET-04 清理记录，可选审计）

```sql
CREATE TABLE IF NOT EXISTS orphan_scan_log (
  id            TEXT PRIMARY KEY,
  scanned_at    INTEGER NOT NULL,
  orphan_count  INTEGER NOT NULL,           -- 发现的孤立资源数
  freed_bytes   INTEGER NOT NULL,           -- 释放空间
  details       TEXT                        -- JSON：清理的路径列表
);
```

---

## 5. IPC 接口

所有 channel 使用 `settings:*` 前缀（遵循架构 §4）。参数为可序列化对象或文件路径；返回 DTO；错误抛 `AppError`。

### 5.1 SET-01 API Key 管理

| channel | 入参 | 返回 | 说明 / 错误 |
|---|---|---|---|
| `settings:listProviders` | `{}` | `ProviderConfig[]`（不含 Key 明文，仅元信息） | 列出所有厂商配置；返回的 `hasKey: boolean` 标识是否已配置 Key |
| `settings:getProvider` | `{id}` | `ProviderConfig`（无 Key 明文） | 单个厂商配置；`NOT_FOUND` |
| `settings:saveProvider` | `{id?, provider, label, baseUrl, model, apiKey?}` | `{id}` | 新增或更新；`apiKey` 可选（不传则不变更 Key）；`apiKey` 为明文，主进程加密后写 `api_key_enc`；`VALIDATION` |
| `settings:deleteProvider` | `{id}` | `{ok}` | 删除厂商；若为当前选中则回退到默认；`NOT_FOUND` |
| `settings:setActiveProvider` | `{id}` | `{ok}` | 写 `settings.ai.currentProvider` 并刷新 `is_active`；`NOT_FOUND` |
| `settings:testProvider` | `{id}` | `{ok: boolean, latencyMs?, error?}` | 用解密 Key 发一次轻量 ping（如 models 列表），验证连通；`AI_AUTH` / `AI_NETWORK` |
| `settings:getActiveApiKey` | `{}` | `string`（明文） | **仅主进程内部/受控调用**：解密当前厂商 Key 供 AI 客户端使用。**不暴露到渲染进程的 preload 白名单**（见 §7.1 安全约束）。 |

> **安全约束**：`settings:getActiveApiKey` **不在 preload `contextBridge` 白名单中暴露给渲染进程**。AI 调用链为：渲染进程 `ai:*` → 主进程 AI service → 主进程内部调 `apiKeyStore.getActiveKey()`（同进程内存传递，不过 IPC）。渲染进程永远拿不到明文 Key。

#### ProviderConfig DTO

```ts
// electron/models/settings.ts
interface ProviderConfig {
  id: string;
  provider: 'deepseek' | 'openai' | 'anthropic' | 'qwen' | string;
  label: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;       // 是否已配置 Key（不返回 Key 本身）
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}
```

### 5.2 SET-02 外观设置

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `settings:getAppearance` | `{}` | `AppearanceSettings` | 读 settings 表相关键 |
| `settings:setAppearance` | `Partial<AppearanceSettings>` | `{ok}` | 增量更新外观键；写后主进程 `webContents.send('settings:appearanceChanged', next)` 通知所有窗口刷新 token |

```ts
interface AppearanceSettings {
  theme: 'beige' | 'moss' | 'dark';
  fontFamily: 'songti' | 'kaiti' | 'system';
  fontSize: number;        // 14–28
  lineHeight: number;      // 1.4–2.0
  illusStyle: 'ink' | 'color' | 'none';
}
```

### 5.3 SET-03 数据备份

| channel | 入参 | 返回 | 说明 / 进度 |
|---|---|---|---|
| `settings:exportBackup` | `{ outputPath?, includeApiKey?: boolean }` | `{ path: string, checksum: string, bytes: number, manifest: BackupManifest }` | 打包整库为单一归档；`includeApiKey` 默认 `false`（剥离 Key）；长任务，推送 `settings:backupProgress` |
| `settings:importBackup` | `{ archivePath, mode: 'replace' \| 'merge' }` | `{ ok, restoredBooks, conflicts?: ConflictInfo[] }` | 校验 → 导入恢复；`mode=replace` 覆盖当前库（先备份当前），`merge` 按书合并；长任务，推送 `settings:backupProgress` |
| `settings:verifyBackup` | `{ archivePath }` | `{ ok: boolean, manifest: BackupManifest, errors?: string[] }` | 仅校验归档完整性与 checksum，不写入 |

进度事件：`webContents.send('settings:backupProgress', { phase, current, total, bytesWritten? })`，phase ∈ `scan` / `pack` / `checksum` / `unpack` / `restore`。

### 5.4 SET-04 书籍文件管理

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `settings:listBookFiles` | `{}` | `BookFileEntry[]` | 列出 `files/` 下原始 EPUB 与对应 book 元信息、占用空间 |
| `settings:triggerReparse` | `{ bookId, options? }` | `{ jobId }` | 委托 IMP-07 重新解析；段落稳定 ID 保留；进度走 IMP 的 `import:progress` |
| `settings:scanOrphans` | `{}` | `{ orphanAssets: string[], orphanFiles: string[], totalBytes: number }` | 扫描 assets/files 与 DB 引用，找出孤立资源 |
| `settings:cleanOrphans` | `{ paths: string[] }` | `{ freedBytes, cleaned: number }` | 删除指定孤立资源并记 `orphan_scan_log` |

### 5.5 SET-05 免责声明

| channel | 入参 | 返回 | 说明 |
|---|---|---|---|
| `settings:getDisclaimerStatus` | `{}` | `{ accepted: boolean, acceptedAt?: number, version: string }` | 读 `disclaimer.*` 键 |
| `settings:acceptDisclaimer` | `{ version }` | `{ok}` | 写确认状态；首次启动门控依赖此 |

---

## 6. 前端设计

### 6.1 组件树

```
<SettingsPage>                       # Tab 容器
├── <ApiKeyPanel>                    # SET-01
│   ├── <ProviderList>               # 厂商卡片列表（含 hasKey 标记、激活态）
│   ├── <ProviderEditor>             # base_url / model / apiKey 输入（密码框，不回显明文）
│   └── <ProviderTester>             # 连通性测试按钮 → testProvider
├── <AppearancePanel>                # SET-02
│   ├── <ThemeSwitcher>              # 米白/墨绿/深色 三选一
│   ├── <FontControls>               # 字体/字号/行高
│   └── <IllusStyleSelect>
├── <BackupPanel>                    # SET-03
│   ├── <ExportButton>               # 选目录 → exportBackup，含 includeApiKey 复选（默认关）
│   ├── <ImportButton>               # 选归档 → verifyBackup → 确认 → importBackup
│   └── <ProgressBar>                # 监听 settings:backupProgress
├── <FileManagerPanel>               # SET-04
│   ├── <BookFileList>
│   ├── <ReparseButton>              # → triggerReparse
│   └── <OrphanCleaner>              # scanOrphans → 确认 → cleanOrphans
└── <AboutPanel>                     # 版本号、免责声明全文（SET-05）

<DisclaimerGate>                     # 应用根级：首次启动遮罩，未 acceptDisclaimer 则阻断
<DisclaimerFooter>                   # 阅读页底部小字（RD 模块嵌入）
```

### 6.2 Store 结构（Zustand）

```ts
// src/stores/settings.ts
interface SettingsStore {
  appearance: AppearanceSettings;
  providers: ProviderConfig[];        // 不含 Key 明文
  activeProviderId: string | null;
  disclaimerAccepted: boolean;

  loadAppearance: () => Promise<void>;
  setAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  loadProviders: () => Promise<void>;
  saveProvider: (input) => Promise<string>;
  setActiveProvider: (id: string) => Promise<void>;
  refreshOnAppearanceChanged: () => void;  // 监听主进程事件，更新 token
}
```

- 外观持久化一律走 SQLite；store 仅缓存当前会话值（遵循架构 §6「不做 store 持久化，避免双数据源」）。
- `setAppearance` 写库后由主进程广播 `settings:appearanceChanged`，所有打开窗口（含独立阅读窗）的 store 监听并刷新 CSS token，保证多窗一致。

### 6.3 关键交互与状态流转

- **API Key 输入框**：始终 `type="password"`，编辑态不回显明文（仅显示「已配置 / 未配置」徽标）。保存时把明文经 IPC 传主进程加密；传输后前端立即从内存清除（`apiKey = ''`）。
- **主题切换**：即时生效（先乐观更新 token，再异步写库）；失败回滚并提示。
- **备份导出**：默认 `includeApiKey=false`，UI 明确标注「API Key 默认不导出（安全），如需换机免重配可勾选」。

---

## 7. 核心流程

### 7.1 API Key 安全存储与运行时解密（SET-01 核心）

#### 7.1.1 加密存储流程（保存/更新 Key）

```
渲染进程                  主进程 (security/)                 OS (safeStorage)
   │  saveProvider({apiKey:"sk-xxx"})                              │
   │ ──────────settings:saveProvider────────►                      │
   │                            │ safeStorage.isEncryptionAvailable()?
   │                            │   ├─ 可用 → safeStorage.encryptString("sk-xxx")
   │                            │   │        └─ 返回 Buffer (OS keychain/DPAPI/keychain 托管密钥加密)
   │                            │   └─ 不可用 → 回退（见 §7.1.4）
   │                            │ 写 api_credentials.api_key_enc = <Buffer>
   │                            │ 不写明文、不记日志（apiKeyStore 内 logger 屏蔽 value 字段）
   │ ◄─────────── {id} ──────────
   │ 渲染进程立即 apiKey="" 清内存
```

- `safeStorage` 在 macOS 用 Keychain、Windows 用 DPAPI、Linux 用 libsecret；密钥由 OS 托管，应用自身不含主密钥。
- **日志红线**：`apiKeyStore.ts` 内所有日志/错误对象对 `apiKey` 字段做脱敏（替换为 `"<redacted>"`），架构 §7 的 `AppError.details` 也不得携带明文 Key。

#### 7.1.2 运行时解密流程（AI 调用时）

```
渲染进程 (AI 面板)            主进程
   │  ai:generateModern({paragraphId})                              │
   │ ─────────ai:generateModern────────►                             │
   │                                   │ aiService 调 apiKeyStore.getActiveKey()
   │                                   │   ├─ 读 settings.ai.currentProvider → id
   │                                   │   ├─ 读 api_credentials[id].api_key_enc (Buffer)
   │                                   │   ├─ safeStorage.decryptString(buf) → 明文 "sk-xxx"
   │                                   │   └─ 明文仅存在于主进程内存局部变量，调用后丢弃
   │                                   │ 用明文 Key + baseUrl/model 调 fetch(DeepSeek)
   │                                   │ 响应缓存入 ai_cache
   │ ◄────────── {modernText} ─────────
```

- **明文 Key 永不跨越 IPC 边界**：渲染进程不调用 `getActiveApiKey`，AI 调用在主进程内闭环完成。
- 明文 Key 生命周期 = 单次 API 调用；不缓存到全局变量、不写日志。

#### 7.1.3 默认 DeepSeek 预设模板

首次启动（或无任何厂商配置时）自动写入默认预设（`security/presets.ts`），用户填 Key 即用：

```ts
// electron/security/presets.ts
export const DEFAULT_PROVIDERS = [
  {
    id: 'deepseek-default',
    provider: 'deepseek',
    label: 'DeepSeek 默认',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKey: '',                // 待用户填写
    isActive: true,
  },
  // 预置（不激活）其他常见厂商模板，便于一键新增
  { id: 'openai-template', provider: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', isActive: false },
  { id: 'anthropic-template', provider: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet', apiKey: '', isActive: false },
  { id: 'qwen-template', provider: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', apiKey: '', isActive: false },
];
```

- 预设仅含 `base_url` / `model` 元信息，不含 Key；`saveProvider` 时若 `apiKey` 为空则 `hasKey=false`，AI 入口提示「未配置 Key」并降级（AI-07）。
- 用户可基于模板新增多份配置（如多个 DeepSeek Key 轮换），通过 `setActiveProvider` 切换。

#### 7.1.4 safeStorage 不可用的回退

Linux 无 keychain 或开发态 `isEncryptionAvailable()` 返回 false 时：

1. **首选**：提示用户「当前环境不支持系统级加密」，AI Key 功能仍可用但降级为「应用层 AES 加密 + 机器绑定」（派生密钥 = 机器指纹 SHA-256 + 固定盐，存于 `api_credentials`，标注 `key_iv_hint='fallback-aes-machinebound'`）。
2. 此回退**不提供**与 safeStorage 同等强度，仅在 UI 显著提示风险。
3. 生产打包（Win/Mac）下 safeStorage 默认可用，回退路径主要服务开发环境。

> 不采用完全明文回退：即便开发态也走机器绑定加密，避免明文落盘习惯带入生产。

---

### 7.2 外观设置与 CSS token 映射（SET-02）

#### token 定义与主题映射

```ts
// src/styles/theme.ts
const THEMES = {
  beige: { // 米白（默认，古纸风）
    '--bg': '#EDE4D5', '--ink': '#5C4033', '--accent': '#A67C5D',
    '--surface': '#F5EFE2', '--muted': '#8C7B6B',
  },
  moss: { // 墨绿（护眼）
    '--bg': '#2F3E33', '--ink': '#E4E0D4', '--accent': '#A3B18A',
    '--surface': '#3A4A3E', '--muted': '#9CA89B',
  },
  dark: { // 深色
    '--bg': '#1E1B16', '--ink': '#E8E2D5', '--accent': '#C9A57B',
    '--surface': '#2A2620', '--muted': '#8A8378',
  },
};

export function applyAppearance(a: AppearanceSettings) {
  const root = document.documentElement;
  Object.entries(THEMES[a.theme]).forEach(([k, v]) => root.style.setProperty(k, v));
  root.style.setProperty('--font-base-size', `${a.fontSize}px`);
  root.style.setProperty('--font-family-cn',
    a.fontFamily === 'songti' ? '"Source Han Serif SC", "Songti SC", serif'
    : a.fontFamily === 'kaiti' ? '"Kaiti SC", "STKaiti", serif'
    : 'system-ui, sans-serif');
  root.style.setProperty('--line-height', String(a.lineHeight));
  root.dataset.illusStyle = a.illusStyle; // 插图组件读 dataset 决定是否加载/滤镜
}
```

- 主题切换作用于 `:root` 的 CSS 变量，所有组件通过 Tailwind arbitrary value（`bg-[var(--bg)]`）或语义 class 引用，无需重新挂载组件树。
- 多窗口一致：主进程 `settings:appearanceChanged` 广播到所有 `BrowserWindow` 的 webContents，各窗口 store 监听后调 `applyAppearance`。
- 插图风格 `illusStyle`：`none` 时 AI 配图组件不渲染（节省渲染、护眼），`ink` 时套水墨滤镜（CSS filter），`color` 原图。

---

### 7.3 数据备份：打包方案与校验机制（SET-03 核心）

#### 7.3.1 备份归档结构

采用 **tar（无压缩内层） + 外层可选 gzip** 或 zip。推荐 tar.gz：跨平台、流式、便于 checksum。

```
<backup>.tcmz                      # TCM-Zip/Tar (中医学习备份，自定义后缀)
├── manifest.json                  # 备份清单（见下）
├── app.db                         # SQLite 整库文件（VACUUM INTO 导出的干净副本）
├── assets/                        # AI 生成图片/音频（原样）
│   └── ...
├── files/                         # 用户导入的原始 EPUB（原样）
│   └── shennong.epub
└── checksums.sha256               # 各文件 SHA-256（除自身）
```

#### 7.3.2 manifest.json（备份清单）

```json
{
  "format": "tcm-backup",
  "formatVersion": 1,
  "appVersion": "2.1.0",
  "schemaVersion": 3,
  "createdAt": 1718500000000,
  "machineHint": "macbook-arm64",
  "counts": { "books": 12, "paragraphs": 38421, "cards": 1205 },
  "dbBytes": 52428800,
  "assetsBytes": 134217728,
  "filesBytes": 67108864,
  "includeApiKey": false,
  "checksum": "sha256:abcdef...",        // 整个归档（除 manifest/checksums 自身）的滚动校验
  "checksumAlgo": "sha256"
}
```

- `formatVersion`：备份格式版本（与 DB `schemaVersion` 独立）。导入时若 `formatVersion` 高于本机支持，拒绝并提示升级应用。
- `schemaVersion`：导入恢复后由迁移 runner 兜底补齐（见 §7.6.3）。

#### 7.3.3 导出流程（export.ts）

```
1. VACUUM INTO '<tmp>/app.db'          # 产出干净一致副本（避免 WAL 半写）
2. 扫描 assets/ files/，收集文件列表 + 各自 sha256
3. 写 checksums.sha256
4. [includeApiKey=false] 打开 app.db 副本，执行
     UPDATE api_credentials SET api_key_enc = NULL, key_iv_hint='stripped'
   （剥离 Key；保留厂商元信息以便用户知道有哪些配置）
5. 流式 tar -czf <output> app.db assets/ files/ checksums.sha256 manifest.json
6. 计算归档整体 sha256 写入 manifest.checksum（重写 manifest 后再算最终归档 hash，存 .tcmz.sidecar 或末尾追加）
7. 每阶段推送 settings:backupProgress
```

> 校验机制两道：① 逐文件 sha256（`checksums.sha256`，导入时逐个核验）；② 归档整体校验和（防传输损坏）。

#### 7.3.4 导入恢复流程（import.ts）

```
1. verifyBackup：解 manifest → 检查 formatVersion ≤ 支持；
   逐文件核对 checksums.sha256（流式 sha256 对比）；失败则列出 errors，不写入。
2. 用户确认后：
   - mode=replace：
     a. 先对当前库自动做一次「导入前快照」备份（同 export）存 <userData>/pre-import-<ts>.tcmz，防误覆盖
     b. 关闭所有 DB 写句柄（通知业务模块暂停）→ 用归档 app.db 覆盖 <userData>/app.db
     c. 覆盖 assets/ files/
     d. 重新打开 DB → 跑迁移 runner 补齐 schemaVersion
   - mode=merge：
     a. 把归档 app.db 附加为 ATTACH 'backup' → 按 book 维度 UPSERT（同书冲突走 ConflictInfo：保留 / 覆盖 / 双副本）
     b. assets/files 按 book 复制去重
3. 重启业务模块（reload 窗口），推送 settings:backupProgress done
```

#### 7.3.5 冲突处理与换机迁移

- **版本兼容**：`formatVersion` 与 `schemaVersion` 双闸门。低 schemaVersion 备份导入新机后，由迁移 runner 自动升级到当前版本（向后兼容）。高 schemaVersion 备份导入旧机：拒绝，提示升级应用。
- **冲突（merge 模式）**：同 `book_id` 存在且内容不同（按 `parse_hash` 汇总比对）→ 产出 `ConflictInfo`，UI 让用户选「保留本地 / 用备份 / 双副本」。
- **换机迁移**：用户在新机装应用 → 首次启动免责声明确认后 → 设置 > 备份 > 导入 → 选旧机导出的 `.tcmz`。若旧机勾选了 `includeApiKey`，则 Key 一并迁移（safeStorage 密文在新机无法直接解密 —— 见下）。

> **跨机 Key 迁移注意**：safeStorage 密文绑定原机 OS 密钥，换机后无法解密。因此 `includeApiKey=true` 模式下，导出时对 Key **额外做一次应用层 AES**（导出密码：用户在导出时设置的「备份密码」），导入时用该密码解密回明文再走新机 safeStorage 重新加密。无密码则 Key 不导出（即便勾选也无法跨机）。此为可选增强，首期可仅支持「不迁移 Key，新机重配」。

---

### 7.4 书籍文件管理（SET-04）

#### 7.4.1 查看原始导入文件

- `listBookFiles` 遍历 `<userData>/files/`，关联 `books.source_file`，展示：书名 / 文件名 / 大小 / 导入时间 / EPUB 状态。
- 支持在系统文件管理器中「打开所在文件夹」（主进程 `shell.showItemInFolder`）。

#### 7.4.2 触发重新解析（与 IMP-07 协调）

- `triggerReparse({bookId})` 委托 IMP 模块的 `reparseBook(bookId)`（IMP-07）。
- **稳定 ID 约束**：重新解析必须复用原 `paragraph_id` / `chapter_id`（按 IMP 模块的 `parse_hash` 映射策略），确保已绑定的笔记、记忆卡、AI 解读引用不失效。
- SET 仅负责触发与进度展示；解析算法、ID 映射逻辑全在 IMP。进度复用 IMP 的 `import:progress` channel。
- 重新解析前可选「先备份该书数据」（调 IMP 提供的书级导出）。

#### 7.4.3 清理孤立资源

孤立资源定义：`assets/` 或 `files/` 中存在文件，但 DB 中无任何引用（`books.source_file` / `ai_cache` / 段落插图引用等均未指向）。

```
scanOrphans：
  1. 收集 assets/ files/ 全量文件路径集合 A
  2. 扫描 DB 收集所有被引用的资源路径集合 B
     （books.source_file、ai_cache.asset_path、paragraphs 内嵌 local:// 引用等）
  3. A - B = 孤立资源列表
cleanOrphans：
  1. 用户在 UI 勾选确认要删的项（默认全选，但需二次确认）
  2. 删除文件 → 记 orphan_scan_log
  3. 释放空间回收
```

- 保守策略：扫描结果先预览（路径 + 大小），用户确认才删；删除前可自动生成「清理前快照」清单（仅记录路径，不备份内容）。
- 与 LIB-04（删除书籍清理资源）配合：删书时应同步触发该书的资源回收；orphanCleaner 处理的是删书残留、重新解析旧版本残留等历史漏网。

---

### 7.5 免责声明（SET-05）

#### 7.5.1 内容（要点）

> 本软件为阅读与学习工具，所有书籍内容由用户自行导入，软件不内置、不分发任何内容，不构成任何医疗建议、诊断或处方。中医典籍所述功效为古籍记载，请勿据此自行用药。AI 生成内容为模型辅助输出，可能存在错误，请用户自行判断并核实。用户须自行确保所导入内容的合法授权与版权合规。

#### 7.5.2 首次启动确认流程

```
应用启动 → DisclaimerGate 组件挂载
  → getDisclaimerStatus
    ├─ accepted=true → 放行进入主界面
    └─ accepted=false 或 disclaimer.version 升级（文案变更）
        → 全屏遮罩展示完整免责声明 + 「我已阅读并同意」按钮（禁用 3 秒，防误点）
        → 点击 → acceptDisclaimer({version}) → 写 settings
        → 放行
```

- 免责声明有 `version`（随应用版本/法务更新递增）；版本变化时即使曾确认过也会再次弹出。
- 阅读页底部小字（`DisclaimerFooter`）：常驻一行精简提示「内容由用户导入，不构成医疗建议；AI 生成仅供参考」，点击展开全文。

---

### 7.6 DB 迁移机制（版本化迁移 runner 设计）

#### 7.6.1 设计目标

- schema 变更走版本化脚本，**不破坏稳定 ID**（`paragraph_id` / `chapter_id` 永不重写、不删除已存在的稳定 ID 行）。
- 应用启动自动补执行未跑过的迁移；备份导入后兜底升级。
- 迁移失败要可回滚到迁移前状态（迁移前快照 DB 文件）。

#### 7.6.2 迁移 runner（migrate.ts）

```ts
// electron/db/migrate.ts（伪代码）
import migrations from './migrations/index';
import { backupDbFile } from '../backup/export';

export function runMigrations(db: Database): void {
  // 0. 迁移前快照（复制 app.db → app.db.pre-migrate-<ts>），失败可回滚
  backupDbFile();

  const currentVersion = getSchemaVersion(db); // 读 settings.schema.version，无则 0
  const pending = migrations.filter(m => m.version > currentVersion)
                            .sort((a, b) => a.version - b.version);

  if (pending.length === 0) return;

  db.exec('BEGIN');
  try {
    for (const m of pending) {
      m.up(db);                       // 执行 DDL（幂等：CREATE IF NOT EXISTS / ADD COLUMN）
      // 数据修补（如需）也在 m.up 内，用事务包裹
      setSchemaVersion(db, m.version);// 更新 settings.schema.version
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    // 回滚 DB 文件到迁移前快照
    restoreDbFromSnapshot();
    throw new AppError('Db', `迁移失败 (v${currentVersion}→)：${e.message}`, { version: currentVersion });
  }
}
```

#### 7.6.3 迁移脚本规范（migrations/index.ts）

```ts
// electron/db/migrations/index.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = __dirname;
export const migrations = [
  { version: 1, up: (db) => db.exec(readFileSync(join(dir, '0001_baseline.sql'), 'utf8')) },
  { version: 2, up: (db) => db.exec(readFileSync(join(dir, '0002_add_xxx.sql'), 'utf8')) },
  // ...
].sort((a, b) => a.version - b.version);
```

每个 `.sql` 文件规范：
- 只含**向前兼容的 DDL**（新增表/列/索引），不删除已稳定 ID 的列、不重命名稳定 ID 列。
- 需要数据回填时，`.sql` 内写 `UPDATE` 且限定条件、幂等（如 `UPDATE x SET col=val WHERE col IS NULL`）。
- 禁止 `DROP TABLE` 已投入使用的业务表；若必须废弃，新建替代表 + 数据迁移 + 保留旧表 N 个版本（双写过渡）。
- 注释头注明版本号、变更目的、是否破坏稳定 ID（默认否）。

#### 7.6.4 启动时序

```
app.whenReady()
  → 打开 DB 连接（WAL, foreign_keys=ON）
  → runMigrations(db)        # 自动补齐 schemaVersion
  → 注册 IPC handlers
  → 加载前端
  → DisclaimerGate 门控
  → 主界面
```

迁移在 IPC 注册前完成，保证业务调用时 schema 已就绪。

#### 7.6.5 备份导入后的迁移

导入 `.tcmz` 覆盖 `app.db` 后，该 DB 的 `schemaVersion` 可能低于本机代码版本 → 重新打开连接后立即调 `runMigrations`，自动把旧 schema 升到当前版本。这正是「向后兼容」的体现：旧备份能在新机上恢复。

---

### 7.7 外观设置作用链（端到端）

```
用户在 AppearancePanel 调字号
  → setAppearance({fontSize:22})
  → IPC settings:setAppearance
  → 主进程写 settings.appearance.fontSize=22
  → 主进程 webContents.send('settings:appearanceChanged', {fontSize:22,...}) 给所有窗口
  → 各窗口 store.refreshOnAppearanceChanged()
  → applyAppearance(next) → document.documentElement.style.setProperty('--font-base-size','22px')
  → 所有用 var(--font-base-size) 的组件即时生效
```

---

## 8. 错误处理与边界

### 8.1 失败场景与降级

| 场景 | 处理 |
|---|---|
| safeStorage 不可用（Linux/开发态） | 回退机器绑定 AES（§7.1.4），UI 显著提示风险；不采用明文 |
| 解密失败（Key 损坏/换机 safeStorage 密文） | 返回 `AI_AUTH` 错误；提示「Key 无法解密，请重新配置」；AI 功能降级（AI-07），不阻断阅读/学习 |
| 备份校验失败（checksum 不匹配） | `verifyBackup` 返回 errors 列表；`importBackup` 拒绝执行；提示文件损坏 |
| 备份空间不足 | 导出前预估空间（manifest 各 bytes 之和）；不足则提示并中止 |
| 导入覆盖当前库失败 | 先有「导入前快照」，失败时回滚到快照 |
| 迁移失败 | ROLLBACK 事务 + 恢复迁移前 DB 快照；抛错并提示用户（不静默继续） |
| 重新解析破坏稳定 ID | IMP-07 负责保证；SET 触发前提示「将保留笔记/卡片引用」，解析后做一次引用完整性校验（笔记/卡片的目标 ID 仍存在） |
| 清理孤立资源误删 | 必须用户二次确认；仅删确认项；记 orphan_scan_log 审计 |

### 8.2 边界条件

- **API Key 跨进程**：明文 Key 仅在主进程内存中、单次调用生命周期内存在；禁止进 IPC 返回值、禁止进日志、禁止进 `AppError.details`。
- **备份归档大小**：assets/files 可能很大（GB 级）；导出/导入用流式 tar + 进度事件，避免一次性加载到内存。
- **多窗口外观一致性**：任何窗口改外观都经主进程广播，独立阅读窗（RD-10）也收到刷新。
- **并发写 settings**：better-sqlite3 同步 + 事务，settings 写串行化；无竞态。
- **免责声明版本升级**：旧用户升级应用后若声明 version 变化，重新弹门控。

### 8.3 日志红线（重申）

- 永不记录：`api_key` 明文、`api_key_enc` 密文内容、备份密码。
- 可记录：provider id、hasKey 布尔、调用耗时、错误 code。
- `apiKeyStore` 内封装 logger，对所有含 Key 的对象做脱敏拦截。

---

## 9. 依赖关系

### 9.1 依赖（本模块依赖）

| 依赖 | 用途 |
|---|---|
| Electron `safeStorage` | API Key 加密（核心） |
| better-sqlite3 | settings / api_credentials / 迁移 / 备份整库 |
| `tar` / `archiver`（Node 库） | 备份打包解包（流式） |
| `node:crypto` | sha256 校验、回退 AES |
| IMP 模块（`reparseBook`） | SET-04 触发重新解析（委托） |
| 架构公共层 | `AppError`、logger、preload/contextBridge |

### 9.2 被依赖（其它模块依赖本模块）

| 模块 | 依赖点 |
|---|---|
| AI（07） | `apiKeyStore.getActiveKey()` 获取解密 Key；`getActiveProvider` 取 baseUrl/model；Key 缺失触发 AI-07 降级 |
| RD（03） | 外观 token（SET-02）；DisclaimerFooter 嵌入 |
| IMP（01） | 迁移 runner 维护 IMP 的表 schema |
| 全模块 | DB 迁移、备份整库、免责门控 |

### 9.3 共享类型（`electron/models/settings.ts`）

- `ProviderConfig`、`AppearanceSettings`、`BackupManifest`、`ConflictInfo`、`BookFileEntry`、`DisclaimerStatus`。
- 渲染进程通过 `src/lib/types.ts`（与主进程共享）引用同构类型。

---

## 10. 测试策略

### 10.1 单元测试（Vitest，主进程 `services/` `security/` `backup/`）

| 模块 | 测试点 |
|---|---|
| `apiKeyStore` | 加密→存储→解密回环；密文不含明文特征；safeStorage 不可用时回退 AES；删除/更新 Key 不残留 |
| `presets` | 默认 DeepSeek 预设正确写入；`isActive` 唯一性 |
| `settings.ts` | settings 读写、外观键序列化/反序列化、免责 version 升级触发 |
| `migrate.ts` | 顺序补执行；跳过已执行版本；失败 ROLLBACK + 快照回滚；幂等 DDL 重复执行不报错 |
| `backup/export` | VACUUM INTO 副本一致；剥离 Key 后 `api_key_enc` 为 NULL；逐文件 sha256 正确 |
| `backup/import` | checksum 不匹配拒绝；merge 冲突检测；replace 覆盖 + 回滚；旧 schemaVersion 备份导入后自动迁移 |
| `orphanCleaner` | 扫描准确性（A-B）；删除后空间回收；不删被引用资源 |

### 10.2 安全测试

- **明文不落盘**：grep DB 文件与所有日志文件，确认无 `sk-` 前缀明文。
- **明文不进 IPC**：mock preload，断言渲染进程无法调用 `getActiveApiKey`；AI 调用全程在主进程。
- **日志脱敏**：触发各类 AI/Key 错误，断言日志输出 `<redacted>`。

### 10.3 集成测试

- 端到端备份恢复：装几本书 + 配 Key + 笔记 + 卡片 → 导出（默认剥离 Key）→ 删库 → 导入 → 验证书/段落 ID/笔记引用/卡片完整；Key 需重配（符合预期）。
- 跨 schema 备份：用旧版本 DB 备份 → 新版本应用导入 → 迁移 runner 自动升级 → 业务正常。
- 换机 Key 迁移（增强）：带备份密码导出 → 新机导入 → Key 可解密重加密。

### 10.4 夹具

- 测试 EPUB（小、中、多层级）。
- 构造旧 `schemaVersion` 的 `app.db` 快照（v1 baseline + 若干假数据）用于迁移回归。
- 故意损坏的 `.tcmz`（翻转字节）用于校验失败路径。

---

## 11. 开放问题

1. **备份归档格式**：tar.gz vs zip？tar 流式更友好、跨平台工具链一致；zip 在 Windows 原生可解（用户手动查看更直观）。当前倾向 tar.gz（`.tcmz`），但保留 zip 作为导入兼容。待评审。
2. **跨机 Key 迁移强度**：应用层 AES + 备份密码是否足够？是否引入更强 KDF（Argon2）派生密钥？首期可只做「不迁移 Key，新机重配」，后续再加密码迁移。
3. **safeStorage 回退（机器绑定 AES）的密钥派生**：机器指纹取哪些维度（MAC/卷序列号/用户名）才能兼顾稳定与换机失效？需定义并测试不同机器不互通。
4. **多 Key 轮询/负载均衡**：用户配多个同厂商 Key 时是否支持自动轮换（限流时切下一个）？超出 SET-01 当前范围，AI 模块决定。
5. **备份自动定期**：是否做定时自动备份（如每周）到用户指定目录？PRD 仅要求手动一键，自动备份可作为 P2 增强。
6. **`includeApiKey` 默认值与法务**：默认剥离 Key 更安全，但换机体验差；是否在 UI 用更显著的双选确认而非默认勾选？需法务/产品确认。
7. **迁移「双写过渡」窗口长度**：废弃稳定 ID 列时保留旧表 N 个版本，N 取多少（3 个小版本 / 1 个大版本）？影响迁移复杂度。

---

*文档结束。变更请回溯 `docs/PRD.md` §3.9 与 `docs/dev/00-architecture.md` §10 更新策略保持一致。*
