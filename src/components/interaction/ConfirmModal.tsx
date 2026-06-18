/**
 * ConfirmModal — generic interaction component (pure props, domain-agnostic).
 *
 * Used by the library view for delete-note and re-analyze flows. Stateless:
 * all behavior is passed via props so the parent (store) owns the open/busy
 * state. Promoted to the shared interaction layer so any view can reuse it.
 */
interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  busyLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  busyLabel,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmModalProps) {
  if (!open) return null
  return (
    <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
      <div className="bookdetail__modal bookdetail__modal--confirm">
        <div className="bookdetail__modalHead">
          <h3>{title}</h3>
          <button type="button" onClick={onCancel}>
            ×
          </button>
        </div>
        <p className="bookdetail__confirmText">{message}</p>
        <div className="bookdetail__modalActions">
          <button type="button" className="bookdetail__btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="bookdetail__dangerBtn"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
