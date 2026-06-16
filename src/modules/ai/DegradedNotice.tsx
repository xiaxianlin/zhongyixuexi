/**
 * DegradedNotice — top banner shown when the AI module is in a degraded state
 * (AI-07). Reads the reason from the AI store and renders user-facing copy +
 * a hint. Dismissible for the session (does not re-enable AI). Core reading/
 * learning/search paths remain fully usable while this banner is shown.
 *
 * Mount point: render at the top of the app shell (above the main content
 * area), so it's visible in every view. Suggested by main agent in App.tsx.
 */
import React from 'react'
import { useAiStore } from '@/stores/ai'
import { DEGRADED_COPY } from './types'

export function DegradedNotice(): JSX.Element | null {
  const degraded = useAiStore((s) => s.degraded)
  const reason = useAiStore((s) => s.degradedReason)
  const exit = useAiStore((s) => s.exitDegraded)

  if (!degraded || !reason) return null
  const copy = DEGRADED_COPY[reason]

  return (
    <div className="ai-degraded-notice" role="status" aria-live="polite">
      <div className="ai-degraded-notice__body">
        <strong>{copy.title}</strong>
        <span className="ai-degraded-notice__hint">{copy.hint}</span>
      </div>
      <button
        type="button"
        className="ai-degraded-notice__dismiss"
        aria-label="关闭提示"
        onClick={exit}
      >
        ×
      </button>
    </div>
  )
}
