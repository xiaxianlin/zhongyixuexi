/**
 * AiStatusBadge — compact indicator of AI availability.
 *
 * Shows one of: not-configured (gray, "未配置"), configured (green, model name),
 * or degraded (amber, "降级中"). Clicking it calls refreshStatus() so the user
 * can re-probe after configuring a key in Settings.
 *
 * Mount point: app header / toolbar (suggested by main agent).
 */
import React from 'react'
import { useAiStore } from '@/stores/ai'

export function AiStatusBadge(): JSX.Element {
  const status = useAiStore((s) => s.status)
  const degraded = useAiStore((s) => s.degraded)
  const refresh = useAiStore((s) => s.refreshStatus)

  let cls: string
  let label: string
  let title: string

  if (!status || !status.configured) {
    cls = 'ai-badge ai-badge--off'
    label = 'AI 未配置'
    title = '前往「设置 → AI 服务」配置 API Key'
  } else if (degraded) {
    cls = 'ai-badge ai-badge--degraded'
    label = 'AI 降级中'
    title = 'AI 功能暂时不可用，已切换本地模式'
  } else {
    cls = 'ai-badge ai-badge--on'
    label = `AI · ${status.model ?? 'ready'}`
    title = `已启用：${status.provider ?? 'unknown'} / ${status.model ?? ''}`
  }

  return (
    <button type="button" className={cls} title={title} onClick={() => refresh()}>
      <span className="ai-badge__dot" aria-hidden="true" />
      <span className="ai-badge__label">{label}</span>
    </button>
  )
}
