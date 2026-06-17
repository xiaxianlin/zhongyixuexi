import { useCallback, useEffect, useState } from 'react'
import { settingsApi } from '@/lib/settings-api'
import { ProviderEditorModal } from './ProviderEditorModal'
import type { ProviderConfig } from './types'
import './settings.css'

interface AiConfigSlot {
  id: string
  title: string
  description: string
  provider: string
  baseUrl: string
  model: string
}

const AI_CONFIG_SLOTS: AiConfigSlot[] = [
  {
    id: 'conversation-ai',
    title: '会话配置',
    description: '用于 AI 解读、白话、医理等文本会话能力。',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'image-generation-ai',
    title: '图片生成配置',
    description: '用于后续图片生成、图片编辑等视觉生成能力。',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
  },
]

export function SettingsView() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [editingSlot, setEditingSlot] = useState<AiConfigSlot | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setProviders(await settingsApi.listProviders())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const providerById = useCallback(
    (id: string) => providers.find((provider) => provider.id === id) ?? null,
    [providers],
  )

  const onSaved = useCallback(
    async (id: string) => {
      if (editingSlot?.id === 'conversation-ai') {
        await settingsApi.setActiveProvider(id)
      }
      setEditingSlot(null)
      setMessage('配置已保存')
      await refresh()
    },
    [editingSlot, refresh],
  )

  return (
    <div className="settings settings--ai">
      <header className="settings__hero">
        <p className="settings__eyebrow">AI 配置</p>
        <h2>模型服务</h2>
        <p>每类能力保留一个固定配置，只能编辑，不能新增或删除。</p>
      </header>

      <div className="ai-config-grid">
        {AI_CONFIG_SLOTS.map((slot) => {
          const provider = providerById(slot.id)
          return (
            <article key={slot.id} className="ai-config-card">
              <div className="ai-config-card__head">
                <div>
                  <h3>{slot.title}</h3>
                  <p>{slot.description}</p>
                </div>
                <span className={provider?.hasKey ? 'badge badge--ok' : 'badge badge--warn'}>
                  {provider?.hasKey ? '已配置' : '未配置'}
                </span>
              </div>

              <dl className="ai-config-card__meta">
                <div>
                  <dt>厂商</dt>
                  <dd>{provider?.provider || slot.provider}</dd>
                </div>
                <div>
                  <dt>模型</dt>
                  <dd>{provider?.model || slot.model}</dd>
                </div>
                <div>
                  <dt>地址</dt>
                  <dd>{provider?.baseUrl || slot.baseUrl}</dd>
                </div>
              </dl>

              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setEditingSlot(slot)
                  setMessage('')
                }}
              >
                编辑
              </button>
            </article>
          )
        })}
      </div>

      {message && <p className="set-panel__msg">{message}</p>}

      {editingSlot && (
        <ProviderEditorModal
          open
          mode={providerById(editingSlot.id) ? 'edit' : 'create'}
          provider={providerById(editingSlot.id)}
          fixedProviderId={editingSlot.id}
          fixedLabel={editingSlot.title}
          defaults={{
            provider: editingSlot.provider,
            baseUrl: editingSlot.baseUrl,
            model: editingSlot.model,
          }}
          title={`编辑${editingSlot.title}`}
          hint="此配置为固定槽位，保存会覆盖当前槽位内容，不会新增配置。API Key 留空时保留原密钥。"
          onClose={() => setEditingSlot(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
