/**
 * ProviderEditorModal — the single reusable dialog for adding OR editing an AI
 * provider credential (SET-01).
 *
 * Used in two places:
 *  1. ApiKeyPanel (Settings): "新增配置" / "编辑" open it in create/edit mode —
 *     dismissable (Esc / backdrop / cancel); the key is optional on create.
 *  2. App onboarding: when no provider is configured at startup it opens in
 *     'force' mode — no cancel, backdrop & Esc are disabled, a key is required,
 *     and the saved provider is auto-activated so AI becomes usable right away.
 *
 * create/force pre-fill the DeepSeek defaults (provider/baseUrl/model). edit
 * pre-fills from the selected provider and keeps the existing key when the field
 * is left blank.
 */
import { useCallback, useEffect, useState } from 'react'
import { settingsApi } from '@/lib/settings-api'
import type { ProviderConfig } from './types'

export type ProviderEditorMode = 'create' | 'edit' | 'force'

export interface ProviderEditorModalProps {
  open: boolean
  mode: ProviderEditorMode
  /** Required in 'edit' mode — the provider being edited. */
  provider?: ProviderConfig | null
  onClose?: () => void
  onSaved?: (id: string) => void
}

const DEEPSEEK_DEFAULTS = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
}

export function ProviderEditorModal({
  open,
  mode,
  provider,
  onClose,
  onSaved,
}: ProviderEditorModalProps): JSX.Element | null {
  const [providerType, setProviderType] = useState(DEEPSEEK_DEFAULTS.provider)
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState(DEEPSEEK_DEFAULTS.baseUrl)
  const [model, setModel] = useState(DEEPSEEK_DEFAULTS.model)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isEdit = mode === 'edit'
  const dismissable = mode !== 'force'

  // Reset the draft whenever the dialog opens or its target/mode changes.
  useEffect(() => {
    if (!open) return
    setError('')
    setApiKey('')
    if (isEdit && provider) {
      setProviderType(provider.provider)
      setLabel(provider.label)
      setBaseUrl(provider.baseUrl)
      setModel(provider.model)
    } else {
      setProviderType(DEEPSEEK_DEFAULTS.provider)
      setLabel('')
      setBaseUrl(DEEPSEEK_DEFAULTS.baseUrl)
      setModel(DEEPSEEK_DEFAULTS.model)
    }
  }, [open, isEdit, provider])

  // Esc closes only when the dialog is dismissable.
  useEffect(() => {
    if (!open || !dismissable) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismissable, onClose])

  const handleSave = useCallback(async () => {
    setError('')
    if (mode === 'force' && !apiKey.trim()) {
      setError('请填写 API Key 以完成首次配置。')
      return
    }
    setBusy(true)
    try {
      const { id } = await settingsApi.saveProvider({
        id: isEdit ? provider?.id : undefined,
        provider: providerType.trim(),
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      })
      // In force mode, activate the just-configured provider so AI is usable.
      if (mode === 'force') {
        await settingsApi.setActiveProvider(id)
      }
      onSaved?.(id)
    } catch (e) {
      setError(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [mode, isEdit, provider, providerType, label, baseUrl, model, apiKey, onSaved])

  if (!open) return null

  const title = isEdit ? '编辑配置' : mode === 'force' ? '配置 AI 服务' : '新增配置'

  return (
    <div
      className="pmodal-overlay"
      onClick={dismissable ? onClose : undefined}
      role="presentation"
    >
      <div
        className="pmodal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pmodal__head">
          <h3 className="pmodal__title">{title}</h3>
          {dismissable && (
            <button type="button" className="pmodal__close" onClick={onClose} aria-label="关闭">
              ×
            </button>
          )}
        </div>

        {mode === 'force' && (
          <p className="pmodal__hint">
            首次使用需配置一个 AI 服务才能启用解读与问答。密钥使用系统级加密存储，不会以明文落盘或进入日志。
          </p>
        )}

        <label className="field">
          <span>厂商标识</span>
          <input
            value={providerType}
            onChange={(e) => setProviderType(e.target.value)}
            placeholder="deepseek / openai / anthropic / qwen"
            autoFocus
          />
        </label>
        <label className="field">
          <span>显示名称</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="如：DeepSeek 主力"
          />
        </label>
        <label className="field">
          <span>API Base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </label>
        <label className="field">
          <span>默认模型</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
        <label className="field">
          <span>
            API Key{isEdit ? '（留空则保持不变）' : mode === 'force' ? ' *' : ''}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
        </label>

        {error && <p className="pmodal__error">{error}</p>}

        <div className="pmodal__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSave}
            disabled={busy}
          >
            {busy ? '保存中…' : '保存'}
          </button>
          {dismissable && (
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
