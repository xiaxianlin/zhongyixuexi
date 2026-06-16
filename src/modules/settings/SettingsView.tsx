/**
 * SettingsView — the SET module main panel.
 *
 * Tabbed layout: API Key (SET-01), Appearance (SET-02), Backup (SET-03),
 * File Management (SET-04). Each tab renders its own sub-component.
 *
 * Theme/fontScale reuse useUiStore (src/stores/ui.ts) for live preview —
 * the settings panel reads/writes the DB via settingsApi, but the immediate
 * visual change goes through the existing store's applyTheme/setFontScale.
 */

import { useState, useCallback, useEffect } from 'react'
import { settingsApi } from '@/lib/settings-api'
import { useUiStore } from '@/stores/ui'
import type { Theme } from '@/stores/ui'
import type { ProviderConfig, BookFileEntry, OrphanScanResult } from './types'
import './settings.css'

type Tab = 'api' | 'appearance' | 'backup' | 'files'

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('api')

  return (
    <div className="settings">
      <div className="settings__tabs">
        <button
          className={tab === 'api' ? 'settings__tab is-active' : 'settings__tab'}
          onClick={() => setTab('api')}
        >
          API 密钥
        </button>
        <button
          className={tab === 'appearance' ? 'settings__tab is-active' : 'settings__tab'}
          onClick={() => setTab('appearance')}
        >
          外观
        </button>
        <button
          className={tab === 'backup' ? 'settings__tab is-active' : 'settings__tab'}
          onClick={() => setTab('backup')}
        >
          备份
        </button>
        <button
          className={tab === 'files' ? 'settings__tab is-active' : 'settings__tab'}
          onClick={() => setTab('files')}
        >
          文件管理
        </button>
      </div>

      <div className="settings__content">
        {tab === 'api' && <ApiKeyPanel />}
        {tab === 'appearance' && <AppearancePanel />}
        {tab === 'backup' && <BackupPanel />}
        {tab === 'files' && <FileManagerPanel />}
      </div>
    </div>
  )
}

// ============================================================================
// SET-01: API Key Panel
// ============================================================================

function ApiKeyPanel() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftProvider, setDraftProvider] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [draftBaseUrl, setDraftBaseUrl] = useState('')
  const [draftModel, setDraftModel] = useState('')
  const [draftKey, setDraftKey] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    const list = await settingsApi.listProviders()
    setProviders(list)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startEdit = useCallback((p: ProviderConfig) => {
    setEditingId(p.id)
    setDraftProvider(p.provider)
    setDraftLabel(p.label)
    setDraftBaseUrl(p.baseUrl)
    setDraftModel(p.model)
    setDraftKey('')
    setMsg('')
  }, [])

  const startNew = useCallback(() => {
    setEditingId('__new__')
    setDraftProvider('deepseek')
    setDraftLabel('')
    setDraftBaseUrl('https://api.deepseek.com/v1')
    setDraftModel('deepseek-chat')
    setDraftKey('')
    setMsg('')
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setDraftKey('')
  }, [])

  const onSave = useCallback(async () => {
    try {
      const input = {
        id: editingId === '__new__' ? undefined : editingId ?? undefined,
        provider: draftProvider,
        label: draftLabel,
        baseUrl: draftBaseUrl,
        model: draftModel,
        apiKey: draftKey || undefined,
      }
      await settingsApi.saveProvider(input)
      setDraftKey('')
      setEditingId(null)
      setMsg('已保存')
      await refresh()
    } catch (e) {
      setMsg(`保存失败: ${(e as Error).message}`)
    }
  }, [editingId, draftProvider, draftLabel, draftBaseUrl, draftModel, draftKey, refresh])

  const onActivate = useCallback(
    async (id: string) => {
      await settingsApi.setActiveProvider(id)
      await refresh()
    },
    [refresh],
  )

  const onDelete = useCallback(
    async (id: string) => {
      await settingsApi.deleteProvider(id)
      await refresh()
    },
    [refresh],
  )

  return (
    <div className="set-panel">
      <h3 className="set-panel__title">API 密钥管理</h3>
      <p className="set-panel__hint">
        密钥使用系统级加密存储（macOS Keychain / Windows DPAPI），不会以明文落盘或进入日志。
      </p>

      <div className="provider-list">
        {providers.map((p) => (
          <div key={p.id} className="provider-card">
            <div className="provider-card__head">
              <span className="provider-card__label">{p.label}</span>
              <div className="provider-card__badges">
                {p.isActive && <span className="badge badge--active">当前</span>}
                <span className={p.hasKey ? 'badge badge--ok' : 'badge badge--warn'}>
                  {p.hasKey ? '已配置' : '未配置'}
                </span>
              </div>
            </div>
            <div className="provider-card__meta">
              <span>{p.provider}</span>
              <span>·</span>
              <code>{p.model}</code>
            </div>
            <div className="provider-card__url">
              <code>{p.baseUrl}</code>
            </div>
            <div className="provider-card__actions">
              {!p.isActive && (
                <button className="btn btn--small" onClick={() => onActivate(p.id)}>
                  启用
                </button>
              )}
              <button className="btn btn--small" onClick={() => startEdit(p)}>
                编辑
              </button>
              <button
                className="btn btn--small btn--danger"
                onClick={() => onDelete(p.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="btn btn--primary" onClick={startNew}>
        + 新增配置
      </button>

      {editingId !== null && (
        <div className="provider-editor">
          <h4>{editingId === '__new__' ? '新增配置' : '编辑配置'}</h4>
          <label className="field">
            <span>厂商标识</span>
            <input
              value={draftProvider}
              onChange={(e) => setDraftProvider(e.target.value)}
              placeholder="deepseek / openai / anthropic / qwen"
            />
          </label>
          <label className="field">
            <span>显示名称</span>
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="如：DeepSeek 主力"
            />
          </label>
          <label className="field">
            <span>API Base URL</span>
            <input
              value={draftBaseUrl}
              onChange={(e) => setDraftBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
          <label className="field">
            <span>默认模型</span>
            <input
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              placeholder="deepseek-chat"
            />
          </label>
          <label className="field">
            <span>API Key {editingId !== '__new__' && '(留空则不变)'}</span>
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </label>
          <div className="provider-editor__actions">
            <button className="btn btn--primary" onClick={onSave}>
              保存
            </button>
            <button className="btn" onClick={cancelEdit}>
              取消
            </button>
          </div>
        </div>
      )}

      {msg && <p className="set-panel__msg">{msg}</p>}
    </div>
  )
}

// ============================================================================
// SET-02: Appearance Panel
// ============================================================================

const THEMES: { value: Theme; label: string }[] = [
  { value: 'paper', label: '米白' },
  { value: 'ink', label: '墨绿' },
  { value: 'dark', label: '深色' },
]

function AppearancePanel() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const fontScale = useUiStore((s) => s.fontScale)
  const setFontScale = useUiStore((s) => s.setFontScale)
  const [msg, setMsg] = useState('')

  const onTheme = useCallback(
    async (t: Theme) => {
      setTheme(t) // optimistic local update
      try {
        await settingsApi.setAppearance({ theme: t })
        setMsg('主题已保存')
      } catch {
        setMsg('保存失败')
      }
    },
    [setTheme],
  )

  const onFontScale = useCallback(
    async (v: number) => {
      setFontScale(v)
      try {
        await settingsApi.setAppearance({ fontScale: v })
      } catch {
        setMsg('保存失败')
      }
    },
    [setFontScale],
  )

  // Load persisted settings on mount
  useEffect(() => {
    void (async () => {
      try {
        const a = await settingsApi.getAppearance()
        if (a.theme) setTheme(a.theme as Theme)
        if (a.fontScale) setFontScale(a.fontScale)
      } catch {
        // DB not ready yet — ignore
      }
    })()
  }, [setTheme, setFontScale])

  return (
    <div className="set-panel">
      <h3 className="set-panel__title">外观设置</h3>

      <div className="field-group">
        <label className="field-label">主题</label>
        <div className="theme-switcher">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={theme === t.value ? 'theme-chip is-active' : 'theme-chip'}
              onClick={() => onTheme(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">
          字号缩放 ({fontScale.toFixed(1)}x)
        </label>
        <input
          type="range"
          min="0.8"
          max="1.6"
          step="0.1"
          value={fontScale}
          onChange={(e) => onFontScale(Number(e.target.value))}
          className="font-slider"
        />
      </div>

      {msg && <p className="set-panel__msg">{msg}</p>}
    </div>
  )
}

// ============================================================================
// SET-03: Backup Panel
// ============================================================================

function BackupPanel() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [includeKey, setIncludeKey] = useState(false)

  const onExport = useCallback(async () => {
    setBusy(true)
    setProgress('准备导出…')
    try {
      const result = await settingsApi.exportBackup({ includeApiKey: includeKey })
      if (result) {
        setProgress(`已导出到: ${result.path} (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`)
      } else {
        setProgress('')
      }
    } catch (e) {
      setProgress(`导出失败: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [includeKey])

  const onImport = useCallback(async () => {
    setBusy(true)
    setProgress('准备导入…')
    try {
      const result = await settingsApi.importBackup({ mode: 'replace' })
      if (result) {
        setProgress(
          `导入完成: ${result.restoredBooks} 本书已恢复。请重启应用以生效。`,
        )
      } else {
        setProgress('')
      }
    } catch (e) {
      setProgress(`导入失败: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <div className="set-panel">
      <h3 className="set-panel__title">数据备份</h3>
      <p className="set-panel__hint">
        导出包含完整数据库、资源文件和原始 EPUB 的归档文件。可用于换机迁移或数据备份。
      </p>

      <div className="backup-section">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={includeKey}
            onChange={(e) => setIncludeKey(e.target.checked)}
          />
          <span>导出时包含 API Key（密文，跨机不可解密；默认不导出更安全）</span>
        </label>
      </div>

      <div className="backup-actions">
        <button className="btn btn--primary" disabled={busy} onClick={onExport}>
          {busy ? '处理中…' : '导出备份'}
        </button>
        <button className="btn" disabled={busy} onClick={onImport}>
          导入恢复
        </button>
      </div>

      {progress && <p className="set-panel__msg">{progress}</p>}
    </div>
  )
}

// ============================================================================
// SET-04: File Manager Panel
// ============================================================================

function FileManagerPanel() {
  const [files, setFiles] = useState<BookFileEntry[]>([])
  const [orphans, setOrphans] = useState<OrphanScanResult | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    try {
      setFiles(await settingsApi.listBookFiles())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onScanOrphans = useCallback(async () => {
    try {
      const result = await settingsApi.scanOrphans()
      setOrphans(result)
      setMsg(
        result.orphanAssets.length + result.orphanFiles.length > 0
          ? `发现 ${result.orphanFiles.length} 个孤立文件 + ${result.orphanAssets.length} 个孤立资源 (${(result.totalBytes / 1024).toFixed(0)} KB)`
          : '未发现孤立资源',
      )
    } catch (e) {
      setMsg(`扫描失败: ${(e as Error).message}`)
    }
  }, [])

  const onCleanOrphans = useCallback(async () => {
    if (!orphans) return
    const allPaths = [...orphans.orphanFiles, ...orphans.orphanAssets]
    if (allPaths.length === 0) return
    if (!confirm(`确认删除 ${allPaths.length} 个孤立资源？此操作不可撤销。`)) return
    try {
      const result = await settingsApi.cleanOrphans(allPaths)
      setMsg(`已清理 ${result.cleaned} 项，释放 ${(result.freedBytes / 1024).toFixed(0)} KB`)
      setOrphans(null)
      await refresh()
    } catch (e) {
      setMsg(`清理失败: ${(e as Error).message}`)
    }
  }, [orphans, refresh])

  const fmtSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="set-panel">
      <h3 className="set-panel__title">书籍文件管理</h3>

      <div className="file-actions">
        <button className="btn" onClick={onScanOrphans}>
          扫描孤立资源
        </button>
        {orphans && orphans.orphanFiles.length + orphans.orphanAssets.length > 0 && (
          <button className="btn btn--danger" onClick={onCleanOrphans}>
            清理全部孤立资源
          </button>
        )}
      </div>

      {files.length === 0 ? (
        <p className="set-panel__empty">暂无导入文件。</p>
      ) : (
        <table className="file-table">
          <thead>
            <tr>
              <th>书名</th>
              <th>文件名</th>
              <th>大小</th>
              <th>导入时间</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.filePath}>
                <td>{f.title || '(未关联)'}</td>
                <td>
                  <code>{f.fileName}</code>
                </td>
                <td>{fmtSize(f.sizeBytes)}</td>
                <td>
                  {f.importedAt ? new Date(f.importedAt).toLocaleDateString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {msg && <p className="set-panel__msg">{msg}</p>}
    </div>
  )
}
