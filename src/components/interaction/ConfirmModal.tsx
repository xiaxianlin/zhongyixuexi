/**
 * ConfirmModal — generic confirm prompt built on the shared Modal shell.
 *
 * Used by the library view for delete-note and re-analyze flows. Stateless:
 * all behavior is passed via props so the parent (store) owns the open/busy
 * state. The shell (backdrop/head/actions/esc) is shared via Modal.
 */
import { Modal } from './Modal'

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
    <Modal
      title={title}
      onClose={onCancel}
      size="confirm"
      actions={
        <>
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
        </>
      }
    >
      <p className="bookdetail__confirmText">{message}</p>
    </Modal>
  )
}
